import { useMemo } from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { MappedRow, BudgetRecord, CommentaryEntry, MonthlyAnalysis } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { computeKpis, bvaByAccount, monthlyTotals, totalOf } from '@/lib/insights';
import { runReviewChecks, reviewKey } from '@/lib/reviewChecks';
import { findingOf } from '@/lib/aiPipeline';
import { fmtWon, fmtPct, fmtChange } from '@/lib/format';
import { periodLabel, prevPeriod } from '@/lib/normalize';
import { MonthSelect, PageHeader } from '@/components/shared';
import { WaterfallChart, BudgetActualCombo } from '@/components/charts';
import type { AnalysisStatus } from '@/components/InsightBriefing';

interface Props {
  rows: MappedRow[];
  budgets: BudgetRecord[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
  version: string | null;
  settings: AppSettings;
  commentary: CommentaryEntry[];
  reviews: Record<string, 'done' | 'flagged'>;
  reportNote: string;
  setReportNote: (period: string, note: string) => void;
  pack: MonthlyInsightPack | null;
  analysis: MonthlyAnalysis | null;
  analysisStatus: AnalysisStatus;
}

export default function ReportView({
  rows, budgets, periods, period, setPeriod, version, settings,
  commentary, reviews, reportNote, setReportNote, pack, analysis, analysisStatus,
}: Props) {
  const kpi = useMemo(() => computeKpis(rows, budgets, period, version), [rows, budgets, period, version]);
  const bva = useMemo(() => bvaByAccount(rows, budgets, period, version), [rows, budgets, period, version]);
  const checks = useMemo(() => runReviewChecks(rows, period, settings), [rows, period, settings]);

  const topVariances = useMemo(
    () => bva.filter(r => r.variance != null).sort((a, b) => Math.abs(b.variance!) - Math.abs(a.variance!)).slice(0, 8),
    [bva],
  );

  // 변동사유: 확정 우선, 미확정은 AI 초안으로 자동 채움 (빈 보고서 방지)
  const varianceRows = useMemo(() => {
    const accounts = pack?.flaggedAccounts ?? [];
    return accounts.map(acc => {
      const entry = commentary.find(c => c.id === `${period}:${acc}`);
      if (entry?.status === 'confirmed') return { account: acc, reason: entry.reason, state: '확정' as const };
      if (entry?.reason) return { account: acc, reason: entry.reason, state: '작성 중' as const };
      const draft = findingOf(analysis, acc)?.draft;
      if (draft) return { account: acc, reason: draft, state: 'AI 초안' as const };
      return { account: acc, reason: '', state: '미작성' as const };
    }).filter(r => r.reason || r.state === '미작성');
  }, [pack, commentary, analysis, period]);

  // 월별 예산 vs 실적 콤보 데이터 (최근 12개월)
  const comboData = useMemo(() => {
    const actuals = monthlyTotals(rows).filter(d => d.period <= period).slice(-12);
    const budgetByPeriod = new Map<string, number>();
    for (const b of budgets) {
      if (version && b.version !== version) continue;
      budgetByPeriod.set(b.period, (budgetByPeriod.get(b.period) || 0) + b.amount);
    }
    return actuals.map(d => ({
      label: d.period.slice(2).replace('-', '.'),
      actual: d.amount,
      budget: budgetByPeriod.has(d.period) ? budgetByPeriod.get(d.period)! : null,
    }));
  }, [rows, budgets, version, period]);

  const prevP = prevPeriod(period);
  const hasPrev = periods.includes(prevP);
  const prevTotal = hasPrev ? totalOf(rows, prevP) : 0;

  const riskItems = (pack?.items ?? []).filter(i => i.severity === 'danger' || i.severity === 'warning');
  const actionList = riskItems
    .map(i => ({ title: i.title, action: i.account ? findingOf(analysis, i.account)?.action : undefined }))
    .filter(a => a.action);

  const summaryText = reportNote || analysis?.summary || '';
  const today = new Date().toISOString().slice(0, 10);
  const reviewTotal = checks.reduce((s, c) => s + c.hits.length, 0);
  const reviewDone = checks.reduce((s, c) => s + c.hits.filter(h => reviews[reviewKey(c.id, h.row)] === 'done').length, 0);
  const reviewFlagged = checks.reduce((s, c) => s + c.hits.filter(h => reviews[reviewKey(c.id, h.row)] === 'flagged').length, 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="no-print">
        <PageHeader
          title="월간 리포트"
          desc="월마감 보고서 — AI 초안이 자동으로 채워지며, 인쇄(PDF 저장) 시 화면 그대로 출력됩니다"
          right={
            <>
              <MonthSelect periods={periods} value={period} onChange={setPeriod} />
              <Button onClick={() => window.print()} className="gap-1.5"><Printer className="h-4 w-4" /> 인쇄 / PDF 저장</Button>
            </>
          }
        />
        {analysisStatus === 'running' && (
          <div className="panel p-3 mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> AI가 보고서 초안을 작성하는 중입니다…
          </div>
        )}
      </div>

      <div id="print-area" className="panel p-8 space-y-7">
        {/* 헤더 */}
        <div className="border-b-2 border-foreground pb-4 report-section">
          <h1 className="text-xl font-bold">{periodLabel(period)} 비용 실적 보고</h1>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{settings.company_name || '(회사명 미설정 — 환경 설정에서 입력)'}</span>
            <span>기준: 예산버전 {version ?? '-'} · 작성일 {today}</span>
          </div>
        </div>

        {/* 1. 요약 + 종합 코멘트 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">1. 당월 요약</h2>
          <table className="w-full text-sm border border-border mb-3">
            <tbody>
              <tr className="border-b border-border">
                <td className="px-3 py-2 bg-secondary font-medium w-36">당월 총비용</td>
                <td className="px-3 py-2 num text-right">{fmtWon(kpi.total)}원</td>
                <td className="px-3 py-2 bg-secondary font-medium w-36">YTD 누계</td>
                <td className="px-3 py-2 num text-right">{fmtWon(kpi.ytd)}원</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 bg-secondary font-medium">전월비</td>
                <td className="px-3 py-2 num text-right">{kpi.momRate != null ? `${fmtChange(kpi.momRate)} (${kpi.momAmount! >= 0 ? '+' : '△'}${fmtWon(Math.abs(kpi.momAmount!))}원)` : '-'}</td>
                <td className="px-3 py-2 bg-secondary font-medium">전년동월비</td>
                <td className="px-3 py-2 num text-right">{kpi.yoyRate != null ? `${fmtChange(kpi.yoyRate)} (${kpi.yoyAmount! >= 0 ? '+' : '△'}${fmtWon(Math.abs(kpi.yoyAmount!))}원)` : '-'}</td>
              </tr>
              <tr>
                <td className="px-3 py-2 bg-secondary font-medium">예산 집행률</td>
                <td className="px-3 py-2 num text-right">{kpi.execRate != null ? fmtPct(kpi.execRate) : '예산 없음'}</td>
                <td className="px-3 py-2 bg-secondary font-medium">예산 초과 계정</td>
                <td className="px-3 py-2 num text-right">{kpi.overBudgetCount}개</td>
              </tr>
            </tbody>
          </table>
          <div className="no-print">
            <Textarea
              value={summaryText}
              onChange={e => setReportNote(period, e.target.value)}
              placeholder={analysisStatus === 'running' ? 'AI 종합 코멘트 작성 중…' : '종합 코멘트 (AI 초안이 자동으로 채워지며 수정 가능합니다)'}
              className="min-h-[100px] text-sm"
            />
            {!reportNote && analysis?.summary && (
              <p className="text-[11px] text-muted-foreground mt-1">AI 생성 초안입니다 — 수정하면 수정본이 보고서에 사용됩니다.</p>
            )}
          </div>
          <div className="hidden print:block text-sm leading-relaxed whitespace-pre-wrap">
            {summaryText || '(종합 코멘트 미작성)'}
          </div>
        </section>

        {/* 2. 월간 추이 차트 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">2. 월별 실적 vs 예산 · 전월비 증감 분해</h2>
          <div className="mb-4">
            <BudgetActualCombo data={comboData} height={210} />
          </div>
          {pack && hasPrev && (
            <WaterfallChart
              prevTotal={prevTotal}
              currTotal={kpi.total}
              steps={pack.waterfall}
              prevLabel={prevP.slice(2).replace('-', '.')}
              currLabel={period.slice(2).replace('-', '.')}
              height={210}
            />
          )}
        </section>

        {/* 3. 예산 대비 차이 상위 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">3. 예산 대비 차이 상위 계정</h2>
          {topVariances.length === 0 ? (
            <p className="text-xs text-muted-foreground">예산 데이터가 없습니다.</p>
          ) : (
            <table className="w-full text-sm border border-border">
              <thead>
                <tr className="bg-secondary text-xs">
                  <th className="px-3 py-2 text-left font-medium border-b border-border">계정명</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-border">예산</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-border">실적</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-border">차이 B/(W)</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-border">집행률</th>
                </tr>
              </thead>
              <tbody>
                {topVariances.map(r => (
                  <tr key={r.account_name} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{r.account_name}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtWon(r.budget)}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtWon(r.actual)}</td>
                    <td className={`px-3 py-1.5 text-right num ${r.variance! < 0 ? 'text-destructive' : ''}`}>{fmtWon(r.variance)}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtPct(r.execRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 4. 주요 변동사유 — 확정 + AI 초안 자동 채움 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">4. 주요 변동사유</h2>
          {varianceRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">검토 기준을 초과한 계정이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {varianceRows.map(v => (
                <div key={v.account} className="text-sm border-l-2 border-primary pl-3">
                  <p className="font-medium">
                    {v.account}
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded align-middle ${
                      v.state === '확정' ? 'bg-accent text-accent-foreground'
                      : v.state === 'AI 초안' ? 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))]'
                      : 'bg-secondary text-muted-foreground'
                    }`}>{v.state === 'AI 초안' ? 'AI 초안 — 검토 전' : v.state}</span>
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">{v.reason || '사유 확인 중'}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5. 비용 구조 분석 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">5. 비용 구조 분석</h2>
          <div className="text-xs text-muted-foreground space-y-1 mb-2">
            {pack?.fixedShare != null && <p>· 고정성 비용 비중: <span className="num text-foreground">{fmtPct(pack.fixedShare)}</span> (변동계수 기반 분류)</p>}
            {pack?.accountConcentration && (
              <p>· 상위 3개 계정 집중도: <span className="num text-foreground">{fmtPct(pack.accountConcentration.top3Share)}</span> ({pack.accountConcentration.names.join(', ')})</p>
            )}
            {pack?.vendorConcentration && (
              <p>· 상위 5개 거래처 집중도: <span className="num text-foreground">{fmtPct(pack.vendorConcentration.top5Share)}</span></p>
            )}
          </div>
          {pack && pack.recurrence.length > 0 && (
            <table className="w-full text-xs border border-border">
              <thead>
                <tr className="bg-secondary">
                  <th className="px-3 py-1.5 text-left font-medium border-b border-border">계정명</th>
                  <th className="px-3 py-1.5 text-left font-medium border-b border-border">성격 분류</th>
                  <th className="px-3 py-1.5 text-right font-medium border-b border-border">발생 월수</th>
                  <th className="px-3 py-1.5 text-right font-medium border-b border-border">월평균</th>
                </tr>
              </thead>
              <tbody>
                {pack.recurrence.slice(0, 10).map(r => (
                  <tr key={r.account_name} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{r.account_name}</td>
                    <td className="px-3 py-1.5">{r.cls}</td>
                    <td className="px-3 py-1.5 text-right num">{r.monthsPresent}/{r.monthsTotal}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtWon(r.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 6. 전표·경비 검토 요약 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">6. 전표·경비 검토 결과 (내부통제)</h2>
          <p className="text-xs text-muted-foreground mb-2">검출 {reviewTotal}건 · 검토 완료 {reviewDone}건 · 소명 필요 {reviewFlagged}건</p>
          <table className="w-full text-xs border border-border">
            <tbody>
              {checks.map(c => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 w-52">{c.label}</td>
                  <td className={`px-3 py-1.5 text-right num w-20 ${c.hits.length > 0 && c.severity === 'danger' ? 'text-destructive font-semibold' : ''}`}>{c.hits.length}건</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 7. 리스크 및 제언 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">7. 리스크 및 제언</h2>
          {riskItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">특이 리스크가 검출되지 않았습니다.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              {riskItems.map(i => (
                <div key={i.id} className="flex gap-2">
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${i.severity === 'danger' ? 'bg-destructive' : 'bg-[hsl(var(--warning))]'}`} />
                  <div>
                    <p className="leading-snug">{i.title} <span className="text-xs text-muted-foreground">— {i.detail}</span></p>
                    {i.account && findingOf(analysis, i.account)?.action && (
                      <p className="text-xs text-muted-foreground mt-0.5">↳ 권고: {findingOf(analysis, i.account)!.action}</p>
                    )}
                  </div>
                </div>
              ))}
              {actionList.length === 0 && analysisStatus === 'no-key' && (
                <p className="text-[11px] text-muted-foreground">Gemini 키 설정 시 항목별 권고 액션이 함께 생성됩니다.</p>
              )}
            </div>
          )}
        </section>

        {/* 8. 연말 착지 전망 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">8. 연말 착지 전망 (연간예산 초과 우려)</h2>
          {!pack || pack.landing.filter(l => l.ratio > 1).length === 0 ? (
            <p className="text-xs text-muted-foreground">현재 지출 속도 기준으로 연간예산 초과가 우려되는 계정이 없습니다.</p>
          ) : (
            <table className="w-full text-xs border border-border">
              <thead>
                <tr className="bg-secondary">
                  <th className="px-3 py-1.5 text-left font-medium border-b border-border">계정명</th>
                  <th className="px-3 py-1.5 text-right font-medium border-b border-border">연간예산</th>
                  <th className="px-3 py-1.5 text-right font-medium border-b border-border">YTD 실적</th>
                  <th className="px-3 py-1.5 text-right font-medium border-b border-border">착지 전망</th>
                  <th className="px-3 py-1.5 text-right font-medium border-b border-border">예산 대비</th>
                </tr>
              </thead>
              <tbody>
                {pack.landing.filter(l => l.ratio > 1).slice(0, 10).map(l => (
                  <tr key={l.account_name} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{l.account_name}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtWon(l.annualBudget)}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtWon(l.ytdActual)}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtWon(l.projected)}</td>
                    <td className={`px-3 py-1.5 text-right num ${l.ratio > 1 ? 'text-destructive font-semibold' : ''}`}>{fmtPct(l.ratio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-muted-foreground mt-1.5">전망 = YTD 실적 + 최근 3개월 평균 × 잔여월. 단순 추정치이며 계절성·일회성 계획은 반영되지 않습니다.</p>
        </section>
      </div>
    </div>
  );
}
