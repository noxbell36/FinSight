import { useMemo, Fragment } from 'react';
import { Printer, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { MappedRow, BudgetRecord, CommentaryEntry, MonthlyAnalysis } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { computeKpis, bvaByAccount } from '@/lib/insights';
import { runReviewChecks, reviewKey } from '@/lib/reviewChecks';
import { findingOf } from '@/lib/aiPipeline';
import { fmtWon, fmtPct, fmtChange, fmtCompact } from '@/lib/format';
import { periodLabel } from '@/lib/normalize';
import { MonthSelect, PageHeader } from '@/components/shared';
import { RateGauge } from '@/components/charts';
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
  onRetryAnalysis: () => void;
}

/** 금액·배수·%에 자동 굵게 (원본 리포트의 강조 스타일) */
function EmphNum({ text }: { text: string }) {
  const parts = text.split(/([\d,.]+(?:억|만)?(?:원|%|배|개월|개|건))/g);
  return (
    <>
      {parts.map((p, i) =>
        /^[\d,.]+(?:억|만)?(?:원|%|배|개월|개|건)$/.test(p)
          ? <strong key={i} className="num font-semibold text-foreground">{p}</strong>
          : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

const clsBadge: Record<string, { label: string; cls: string }> = {
  '고정성(반복)': { label: '고정비', cls: 'bg-secondary text-muted-foreground' },
  '준변동': { label: '준변동비', cls: 'bg-secondary text-muted-foreground' },
  '변동성': { label: '변동비', cls: 'bg-accent text-accent-foreground' },
  '간헐/일회성': { label: '일회성', cls: 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))]' },
};

export default function ReportView({
  rows, budgets, periods, period, setPeriod, version, settings,
  commentary, reviews, reportNote, setReportNote, pack, analysis, analysisStatus, onRetryAnalysis,
}: Props) {
  const kpi = useMemo(() => computeKpis(rows, budgets, period, version), [rows, budgets, period, version]);
  const bva = useMemo(() => bvaByAccount(rows, budgets, period, version), [rows, budgets, period, version]);
  const checks = useMemo(() => runReviewChecks(rows, period, settings), [rows, period, settings]);

  const reMap = useMemo(() => new Map((pack?.recurrence ?? []).map(r => [r.account_name, r.cls])), [pack]);
  const bvaMap = useMemo(() => new Map(bva.map(r => [r.account_name, r])), [bva]);

  // 이슈 카드 대상: 검토 대상 계정 (영향액 순)
  const issueAccounts = useMemo(() => {
    const accs = pack?.flaggedAccounts ?? [];
    return accs
      .map(acc => ({ acc, impact: Math.abs(bvaMap.get(acc)?.variance ?? 0) + Math.abs(bvaMap.get(acc)?.actual ?? 0) * 0.001 }))
      .sort((a, b) => b.impact - a.impact)
      .map(x => x.acc);
  }, [pack, bvaMap]);

  const entryOf = (acc: string) => commentary.find(c => c.id === `${period}:${acc}`);

  // 주요 계정 표 (상위 5 + AI 특이사항)
  const topAccounts = useMemo(() => bva.slice(0, 5).map(r => ({
    name: r.account_name,
    actual: r.actual,
    share: kpi.total > 0 ? r.actual / kpi.total : 0,
    note: analysis?.highlights.find(h => h.account_name === r.account_name)?.note ?? '',
  })), [bva, kpi.total, analysis]);

  const top2Share = topAccounts.slice(0, 2).reduce((s, a) => s + a.share, 0);
  const flaggedRows = useMemo(() => {
    const out: { row: MappedRow; label: string }[] = [];
    for (const c of checks) for (const h of c.hits) {
      if (reviews[reviewKey(c.id, h.row)] === 'flagged') out.push({ row: h.row, label: c.label });
    }
    return out;
  }, [checks, reviews]);
  const reviewTotal = checks.reduce((s, c) => s + c.hits.length, 0);
  const reviewDone = checks.reduce((s, c) => s + c.hits.filter(h => reviews[reviewKey(c.id, h.row)] === 'done').length, 0);

  const summaryText = reportNote || analysis?.summary || '';
  const today = new Date().toISOString().slice(0, 10);
  const landingOver = (pack?.landing ?? []).filter(l => l.ratio > 1).slice(0, 5);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="no-print">
        <PageHeader
          title="월간 리포트"
          desc="월마감 보고서 — 초안이 자동으로 채워지며, 인쇄(PDF 저장) 시 화면 그대로 출력됩니다"
          right={
            <>
              {analysisStatus === 'error' && (
                <Button variant="outline" onClick={onRetryAnalysis} className="gap-1.5"><RotateCcw className="h-4 w-4" /> 분석 다시 시도</Button>
              )}
              <MonthSelect periods={periods} value={period} onChange={setPeriod} />
              <Button onClick={() => window.print()} className="gap-1.5"><Printer className="h-4 w-4" /> 인쇄 / PDF 저장</Button>
            </>
          }
        />
        {analysisStatus === 'running' && (
          <div className="panel p-3 mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 보고서 초안을 작성하는 중입니다…
          </div>
        )}
        {analysisStatus === 'error' && (
          <div className="panel p-3 mb-4 text-sm text-destructive">{analysis?.error || '분석 실패'} — 우측 상단 "분석 다시 시도"를 눌러주세요.</div>
        )}
      </div>

      <div id="print-area" className="panel p-7">
        {/* 헤더 */}
        <div className="border-b-2 border-foreground pb-3 mb-5 report-section">
          <div className="flex items-end justify-between">
            <h1 className="text-xl font-bold">{periodLabel(period)} 비용 실적 보고</h1>
            <RateGauge ratio={kpi.execRate} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{settings.company_name || '(회사명 미설정 — 환경 설정에서 입력)'}</span>
            <span>예산버전 {version ?? '-'} · 작성일 {today}</span>
          </div>
        </div>

        {/* 종합 코멘트 */}
        <section className="report-section mb-5">
          <h2 className="text-sm font-bold mb-2">종합 코멘트</h2>
          <div className="no-print">
            <Textarea
              value={summaryText}
              onChange={e => setReportNote(period, e.target.value)}
              placeholder={analysisStatus === 'running' ? '초안 작성 중…' : '종합 코멘트 (초안이 자동으로 채워지며 수정 가능합니다)'}
              className="min-h-[96px] text-sm"
            />
            {!reportNote && analysis?.summary && (
              <p className="text-[11px] text-muted-foreground mt-1">자동 작성 초안 — 수정하면 수정본이 보고서에 사용됩니다.</p>
            )}
          </div>
          <div className="hidden print:block text-sm leading-relaxed whitespace-pre-wrap">
            {summaryText || '(종합 코멘트 미작성)'}
          </div>
        </section>

        {/* 본문 2단: 좌 = 계정별 상세, 우 = 통합 요약 */}
        <div className="grid lg:grid-cols-5 gap-5 report-grid">
          {/* 좌: 계정별 상세 카드 */}
          <div className="lg:col-span-3 space-y-3">
            <h2 className="text-sm font-bold">주요 변동 계정 분석</h2>
            {issueAccounts.length === 0 && (
              <p className="text-xs text-muted-foreground">검토 기준을 초과한 계정이 없습니다.</p>
            )}
            {issueAccounts.map(acc => {
              const b = bvaMap.get(acc);
              const f = findingOf(analysis, acc);
              const entry = entryOf(acc);
              const cls = reMap.get(acc);
              const badge = cls ? clsBadge[cls] : null;
              const body = entry?.reason || f?.draft || f?.cause || '';
              return (
                <div key={acc} className="panel p-4 report-section">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{acc}</span>
                    {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>}
                    {b?.execRate != null && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded num ${b.execRate > 1 ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-muted-foreground'}`}>
                        집행률 {fmtPct(b.execRate)}
                      </span>
                    )}
                    <span className="flex-1" />
                    {entry?.status === 'confirmed' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground">사유 확정</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">초안 · 검토 전</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground my-2">
                    <span>실적 <span className="num text-foreground">{fmtWon(b?.actual ?? 0)}원</span></span>
                    <span>예산 <span className="num text-foreground">{b?.budget != null ? `${fmtWon(b.budget)}원` : '미편성'}</span></span>
                    <span>차이 <span className={`num ${b?.variance != null && b.variance < 0 ? 'text-destructive' : 'text-foreground'}`}>{b?.variance != null ? `${fmtWon(b.variance)}원` : '-'}</span></span>
                  </div>
                  {body && <p className="text-sm leading-relaxed">{body}</p>}
                  {f?.cause && body !== f.cause && !entry?.reason && (
                    <p className="text-xs text-muted-foreground mt-1.5"><span className="font-medium">사유 후보 —</span> {f.cause}</p>
                  )}
                  {f?.action && (
                    <div className="mt-2 rounded-md bg-accent/50 border border-primary/15 px-3 py-2 text-xs leading-relaxed">
                      <span className="font-semibold text-primary">확인 포인트</span> · {f.action}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 우: 통합 요약 레일 */}
          <div className="lg:col-span-2 space-y-4">
            {/* 당월 비용 총괄 */}
            <div className="panel p-4 report-section">
              <h3 className="text-sm font-bold mb-2">당월 비용 총괄</h3>
              <ul className="text-xs space-y-1.5 leading-relaxed">
                <li>· 총 비용: <strong className="num">{fmtWon(kpi.total)}원</strong> (약 {fmtCompact(kpi.total)}) — 전월비 {kpi.momRate != null ? fmtChange(kpi.momRate) : '-'}, 전년동월비 {kpi.yoyRate != null ? fmtChange(kpi.yoyRate) : '-'}</li>
                <li>· 주요 구성: {topAccounts.slice(0, 2).map(a => `${a.name}(${fmtPct(a.share, 0)})`).join(', ')} 합계가 전체의 약 <strong className="num">{fmtPct(top2Share, 0)}</strong></li>
                <li>· YTD 누계 <strong className="num">{fmtWon(kpi.ytd)}원</strong> · 예산 초과 <strong className="num">{kpi.overBudgetCount}개</strong> 계정</li>
              </ul>
            </div>

            {/* 주요 계정 분석 */}
            <div className="panel p-4 report-section">
              <h3 className="text-sm font-bold mb-2">주요 계정 분석</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="py-1 text-left font-medium">계정명</th>
                    <th className="py-1 text-right font-medium">금액</th>
                    <th className="py-1 text-right font-medium">비중</th>
                    <th className="py-1 text-left font-medium pl-2">특이사항</th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.map(a => (
                    <tr key={a.name} className="border-b border-border last:border-0">
                      <td className="py-1.5">{a.name}</td>
                      <td className="py-1.5 text-right num">{fmtWon(a.actual)}</td>
                      <td className="py-1.5 text-right num text-muted-foreground">{fmtPct(a.share)}</td>
                      <td className="py-1.5 pl-2 text-muted-foreground">{a.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 리스크 항목 */}
            <div className="panel p-4 report-section">
              <h3 className="text-sm font-bold mb-2">리스크 항목</h3>
              {analysis && analysis.risks.length > 0 ? (
                <ul className="text-xs space-y-1.5 leading-relaxed">
                  {analysis.risks.map((r, i) => <li key={i}>· <EmphNum text={r} /></li>)}
                </ul>
              ) : (
                <ul className="text-xs space-y-1.5 leading-relaxed">
                  {(pack?.items ?? []).filter(i => i.severity === 'danger').slice(0, 4).map(i => (
                    <li key={i.id}>· <span className="font-medium">{i.title}</span> — <EmphNum text={i.detail} /></li>
                  ))}
                </ul>
              )}
            </div>

            {/* 개선 제안 */}
            {analysis && analysis.improvements.length > 0 && (
              <div className="panel p-4 report-section">
                <h3 className="text-sm font-bold mb-2">개선 제안</h3>
                <ol className="text-xs space-y-1.5 leading-relaxed list-decimal list-inside">
                  {analysis.improvements.map((im, i) => <li key={i}><EmphNum text={im} /></li>)}
                </ol>
              </div>
            )}

            {/* 내부통제 요약 */}
            <div className="panel p-4 report-section">
              <h3 className="text-sm font-bold mb-2">전표·경비 검토 (내부통제)</h3>
              <p className="text-xs text-muted-foreground mb-1.5">
                검출 <strong className="num text-foreground">{reviewTotal}건</strong> · 처리 <strong className="num text-foreground">{reviewDone}건</strong> · 소명 필요 <strong className={`num ${flaggedRows.length > 0 ? 'text-destructive' : 'text-foreground'}`}>{flaggedRows.length}건</strong>
              </p>
              {flaggedRows.slice(0, 6).map(({ row, label }, i) => (
                <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">
                  – [{label}] {row.posting_date} {row.account_name} / {row.vendor ?? '-'} <span className="num">{fmtWon(row.gross_amount ?? row.curr_amount)}원</span>
                </p>
              ))}
            </div>

            {/* 다음 달 관리 포인트 */}
            <div className="panel p-4 report-section">
              <h3 className="text-sm font-bold mb-2">다음 달 관리 포인트</h3>
              <ul className="text-xs space-y-1.5 leading-relaxed">
                {analysis && analysis.next_points.length > 0
                  ? analysis.next_points.map((p, i) => <li key={i}>· <EmphNum text={p} /></li>)
                  : landingOver.map(l => (
                      <li key={l.account_name}>· {l.account_name}: 현재 속도 유지 시 연간예산 대비 <strong className="num">{fmtPct(l.ratio, 0)}</strong> 착지 전망 — 수정예산 반영 여부 검토</li>
                    ))}
                {(!analysis || analysis.next_points.length === 0) && landingOver.length === 0 && (
                  <li className="text-muted-foreground">· 특이 관리 포인트 없음</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
