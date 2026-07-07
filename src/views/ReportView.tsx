import { useMemo, Fragment } from 'react';
import { Printer, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { MappedRow, BudgetRecord, CommentaryEntry, MonthlyAnalysis } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { buildLocalDraft, natureOf } from '@/lib/insightEngine';
import type { AnalysisStatus } from '@/lib/aiPipeline';
import { findingOf } from '@/lib/aiPipeline';
import { computeKpis, bvaByAccount, accountChanges, monthlyTotals, totalOf } from '@/lib/insights';
import { runReviewChecks, reviewKey } from '@/lib/reviewChecks';
import { fmtWon, fmtPct, fmtChange, fmtCompact } from '@/lib/format';
import { periodLabel, prevPeriod } from '@/lib/normalize';
import { MonthSelect, PageHeader } from '@/components/shared';
import { RateGauge, WaterfallChart, BudgetActualCombo } from '@/components/charts';

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
  cooldownLeft: number;
  onRetryAnalysis: () => void;
}

/** 금액·배수·% 자동 굵게 */
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

const clsBadge: Record<string, string> = {
  '고정성(반복)': '고정비',
  '준변동': '준변동비',
  '변동성': '변동비',
  '간헐/일회성': '일회성',
};

export default function ReportView({
  rows, budgets, periods, period, setPeriod, version, settings,
  commentary, reviews, reportNote, setReportNote, pack, analysis, analysisStatus, cooldownLeft, onRetryAnalysis,
}: Props) {
  const kpi = useMemo(() => computeKpis(rows, budgets, period, version), [rows, budgets, period, version]);
  const bva = useMemo(() => bvaByAccount(rows, budgets, period, version), [rows, budgets, period, version]);
  const changes = useMemo(() => accountChanges(rows, period), [rows, period]);
  const checks = useMemo(() => runReviewChecks(rows, period, settings), [rows, period, settings]);

  const reMap = useMemo(() => new Map((pack?.recurrence ?? []).map(r => [r.account_name, r.cls])), [pack]);
  const bvaMap = useMemo(() => new Map(bva.map(r => [r.account_name, r])), [bva]);
  const changeMap = useMemo(() => new Map(changes.map(c => [c.account_name, c])), [changes]);

  const hasBudget = budgets.length > 0 && bva.some(r => r.budget != null);

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

  // §2 주요 변동: 증가/감소 Top5 + 동인
  const topUp = changes.filter(c => c.diff > 0).slice(0, 5);
  const topDown = changes.filter(c => c.diff < 0).slice(0, 5);
  const totalMoM = kpi.momAmount ?? 0;

  // §3 예산 차이: 초과/미달
  const overBudget = bva.filter(r => r.variance != null && r.variance < 0).sort((a, b) => a.variance! - b.variance!).slice(0, 5);
  const underBudget = bva.filter(r => r.variance != null && r.variance > 0).sort((a, b) => b.variance! - a.variance!).slice(0, 5);

  // §4 상세 확인 필요 항목 (규칙 기반 분리)
  const checkItems = useMemo(() => {
    const items: { label: string; detail: string }[] = [];
    for (const c of changes.slice(0, 30)) {
      const d = pack?.drivers[c.account_name];
      if (c.prev === 0 && c.curr > 0) {
        items.push({ label: `${c.account_name} — 신규 발생`, detail: `당월 ${fmtWon(c.curr)}원, 전월 실적 없음. ${d?.memoTop[0] ? `적요 '${d.memoTop[0].memo}'.` : '적요 정보 부족.'} 반복 여부 확인 필요.` });
      } else if (c.rate != null && Math.abs(c.rate) > settings.change_rate_threshold && d && d.memoTop.length === 0) {
        items.push({ label: `${c.account_name} — 정보 부족`, detail: `전월비 ${fmtChange(c.rate)} 변동했으나 적요 미기재로 사유 판단 근거 부족. 담당 부서 확인 필요.` });
      }
    }
    for (const acc of pack?.flaggedAccounts ?? []) {
      const d = pack?.drivers[acc];
      const cls = reMap.get(acc);
      if (d?.ccTop && d.ccTop.share >= 0.8 && d.txCount >= 3) {
        items.push({ label: `${acc} — 부서 집중`, detail: `당월 발생액의 ${fmtPct(d.ccTop.share, 0)}가 ${d.ccTop.name} 귀속. 특정 부서 집중 사유 확인 필요.` });
      }
      if (cls === '간헐/일회성') {
        const b = bvaMap.get(acc);
        items.push({ label: `${acc} — 반복성 확인`, detail: `과거 발생 이력이 간헐적(당월 ${fmtWon(b?.actual ?? changeMap.get(acc)?.curr ?? 0)}원). 다음 달 비용 전망 반영 여부 확인 필요.` });
      }
    }
    const seen = new Set<string>();
    return items.filter(i => (seen.has(i.label) ? false : (seen.add(i.label), true))).slice(0, 8);
  }, [changes, pack, reMap, bvaMap, changeMap, settings.change_rate_threshold]);

  // §5 관리 제안 (로컬 폴백)
  const localSuggestions = useMemo(() => {
    const out: string[] = [];
    const landing = (pack?.landing ?? []).filter(l => l.ratio > 1);
    if (landing[0]) out.push(`${landing[0].account_name}은 현재 지출 속도 유지 시 연간예산 대비 ${fmtPct(landing[0].ratio, 0)} 착지가 전망되어, 수정예산 반영 또는 지출 통제 여부 검토가 필요합니다.`);
    const trend = (pack?.items ?? []).find(i => i.id.startsWith('trend-') && i.severity === 'warning');
    if (trend?.account) out.push(`${trend.account}은 3개월 연속 증가 추세로, 다음 달에도 추이 확인이 필요합니다.`);
    const memoMissing = checks.find(c => c.id === 'memo')?.hits.length ?? 0;
    if (memoMissing > 0) out.push(`적요 미기재 전표 ${memoMissing}건 — 사유 파악 정확도를 위해 전표 입력 기준 안내가 필요합니다.`);
    return out;
  }, [pack, checks]);

  // §6 보고 코멘트 초안 (로컬 폴백)
  const localReportNote = useMemo(() => {
    const lines: string[] = [];
    lines.push(`${periodLabel(period)} 판관비는 ${fmtWon(kpi.total)}원으로 전월비 ${kpi.momRate != null ? fmtChange(kpi.momRate) : '-'}${kpi.momAmount != null ? `(${kpi.momAmount >= 0 ? '+' : '△'}${fmtWon(Math.abs(kpi.momAmount))}원)` : ''} 수준입니다.`);
    if (kpi.execRate != null) lines.push(`예산 집행률은 ${fmtPct(kpi.execRate)}이며, 초과 계정은 ${kpi.overBudgetCount}개입니다.`);
    if (topUp[0]) {
      const d = pack?.drivers[topUp[0].account_name];
      const drv = d?.vendorTop[0];
      lines.push(`주요 증가 요인은 ${topUp[0].account_name}(+${fmtWon(topUp[0].diff)}원)${drv && drv.share != null && Math.abs(drv.share) >= 0.3 ? `로, 증가분의 약 ${Math.round(Math.abs(drv.share) * 100)}%가 '${drv.name}' 거래에서 발생한 것으로 파악됩니다` : '입니다'}. 상세 사유는 추가 확인이 필요합니다.`);
    }
    return lines.join(' ');
  }, [period, kpi, topUp, pack]);

  const noteText = reportNote || analysis?.report_note || localReportNote;
  const summaryBullets = useMemo(() => {
    if (analysis?.summary && analysisStatus === 'done') return null; // AI 요약이 있으면 그걸 사용
    const b: string[] = [];
    b.push(`총비용 ${fmtWon(kpi.total)}원 — 전월비 ${kpi.momRate != null ? fmtChange(kpi.momRate) : '-'}, 전년동월비 ${kpi.yoyRate != null ? fmtChange(kpi.yoyRate) : '-'}.`);
    if (topUp[0]) {
      const nat = pack ? natureOf(pack, topUp[0].account_name) : null;
      b.push(`가장 의미 있는 변동: ${topUp[0].account_name} +${fmtWon(topUp[0].diff)}원${nat ? ` (${nat})` : ''}.`);
    }
    if (hasBudget && overBudget[0]) b.push(`예산 대비 최대 주의: ${overBudget[0].account_name} ${fmtWon(Math.abs(overBudget[0].variance!))}원 초과 (집행률 ${fmtPct(overBudget[0].execRate)}).`);
    if (!hasBudget) b.push('예산 데이터 미업로드 — 비용 실적 중심으로 구성된 리포트입니다.');
    return b;
  }, [analysis, analysisStatus, kpi, topUp, overBudget, hasBudget, pack]);

  const flaggedRows = useMemo(() => {
    const out: { row: MappedRow; label: string }[] = [];
    for (const c of checks) for (const h of c.hits) {
      if (reviews[reviewKey(c.id, h.row)] === 'flagged') out.push({ row: h.row, label: c.label });
    }
    return out;
  }, [checks, reviews]);
  const reviewTotal = checks.reduce((s, c) => s + c.hits.length, 0);
  const reviewDone = checks.reduce((s, c) => s + c.hits.filter(h => reviews[reviewKey(c.id, h.row)] === 'done').length, 0);

  const today = new Date().toISOString().slice(0, 10);

  const draftOf = (acc: string): { text: string; state: '확정' | '작성 중' | '초안' } => {
    const entry = commentary.find(c => c.id === `${period}:${acc}`);
    if (entry?.status === 'confirmed') return { text: entry.reason, state: '확정' };
    if (entry?.reason) return { text: entry.reason, state: '작성 중' };
    const f = findingOf(analysis, acc);
    if (f?.draft) return { text: f.draft, state: '초안' };
    const b = bvaMap.get(acc);
    const c = changeMap.get(acc);
    if (pack) {
      return {
        text: buildLocalDraft(pack, acc, {
          actual: b?.actual ?? c?.curr ?? 0,
          budget: b?.budget ?? null,
          execRate: b?.execRate ?? null,
          momDiff: c?.diff ?? 0,
          momRate: c?.rate ?? null,
        }),
        state: '초안',
      };
    }
    return { text: '', state: '초안' };
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="no-print">
        <PageHeader
          title="월간 리포트"
          desc="경영진 보고자료 초안 — 인쇄(PDF 저장) 시 화면 그대로 출력됩니다"
          right={
            <>
              {analysisStatus === 'error' && (
                <Button variant="outline" onClick={onRetryAnalysis} className="gap-1.5"><RotateCcw className="h-4 w-4" /> 코멘트 다시 생성</Button>
              )}
              <MonthSelect periods={periods} value={period} onChange={setPeriod} />
              <Button onClick={() => window.print()} className="gap-1.5"><Printer className="h-4 w-4" /> 인쇄 / PDF 저장</Button>
            </>
          }
        />
        {analysisStatus === 'running' && (
          <div className="panel p-3 mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 검토 코멘트를 작성하는 중입니다 — 수치·표는 계산 결과로 이미 채워져 있습니다.
          </div>
        )}
        {analysisStatus === 'cooldown' && (
          <div className="panel p-3 mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 호출 한도 대기 중 — 약 {cooldownLeft}초 후 코멘트 작성을 이어갑니다. 아래 내용은 계산 결과 기준입니다.
          </div>
        )}
      </div>

      <div id="print-area" className="panel p-7 space-y-6">
        {/* 헤더 */}
        <div className="border-b-2 border-foreground pb-3 report-section">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold">{periodLabel(period)} 비용 실적 보고</h1>
              <p className="text-xs text-muted-foreground mt-1">{settings.company_name || '(회사명 미설정)'} · 예산버전 {version ?? '-'} · 작성일 {today}</p>
            </div>
            <RateGauge ratio={kpi.execRate} />
          </div>
        </div>

        {/* 1. 이번 달 핵심 요약 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">1. 이번 달 핵심 요약</h2>
          {analysis?.summary && analysisStatus === 'done' ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{analysis.summary}</p>
          ) : (
            <ul className="text-sm space-y-1 leading-relaxed">
              {(summaryBullets ?? []).map((b, i) => <li key={i}>· <EmphNum text={b} /></li>)}
            </ul>
          )}
          <div className="mt-3">
            <BudgetActualCombo data={comboData} height={190} />
          </div>
        </section>

        {/* 2. 주요 비용 변동 요인 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">2. 주요 비용 변동 요인 <span className="font-normal text-xs text-muted-foreground">— 전월비 {totalMoM >= 0 ? '+' : '△'}{fmtWon(Math.abs(totalMoM))}원</span></h2>
          <div className="grid md:grid-cols-2 gap-4 mb-3">
            <VarTable title="증가 상위" rows2={topUp.map(c => varRow(c, totalMoM, pack, reMap))} up />
            <VarTable title="감소 상위" rows2={topDown.map(c => varRow(c, totalMoM, pack, reMap))} />
          </div>
          {pack && hasPrev && (
            <WaterfallChart
              prevTotal={prevTotal} currTotal={kpi.total} steps={pack.waterfall}
              prevLabel={prevP.slice(2).replace('-', '.')} currLabel={period.slice(2).replace('-', '.')} height={190}
            />
          )}
        </section>

        {/* 3. 예산 대비 주요 차이 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">3. 예산 대비 주요 차이 {version && <span className="font-normal text-xs text-muted-foreground">({version} 기준)</span>}</h2>
          {!hasBudget ? (
            <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
              예산 데이터 미업로드 — 데이터 관리에서 예산 파일을 업로드하면 이 섹션이 채워집니다. 본 리포트는 비용 실적 분석 중심으로 구성되었습니다.
            </p>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-4 mb-2">
                <BudgetTable title="예산 초과" rows2={overBudget} analysis={analysis} />
                <BudgetTable title="예산 미달 (여유)" rows2={underBudget} analysis={analysis} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                다음 달 예산 확인 포인트: {(pack?.landing ?? []).filter(l => l.ratio > 1).slice(0, 3).map(l => `${l.account_name}(착지 전망 ${fmtPct(l.ratio, 0)})`).join(', ') || '착지 초과 예상 계정 없음'} — 초과 지속 시 수정예산 반영 여부 검토 필요.
              </p>
            </>
          )}
        </section>

        {/* 4. 상세 확인 필요 항목 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">4. 상세 확인 필요 항목 <span className="font-normal text-xs text-muted-foreground">— 판단 근거가 부족해 실무 확인이 필요한 항목</span></h2>
          {checkItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">특이 항목 없음.</p>
          ) : (
            <div className="space-y-1.5">
              {checkItems.map((item, i) => (
                <div key={i} className="flex gap-2 text-xs leading-relaxed">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--warning))] shrink-0" />
                  <p><span className="font-medium">{item.label}</span> — <EmphNum text={item.detail} /></p>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            전표·경비 검토: 검출 <strong className="num text-foreground">{reviewTotal}건</strong> 중 처리 <strong className="num text-foreground">{reviewDone}건</strong>, 소명 필요 <strong className={`num ${flaggedRows.length > 0 ? 'text-destructive' : 'text-foreground'}`}>{flaggedRows.length}건</strong>
            {flaggedRows.slice(0, 3).map((f, i) => <span key={i}> · [{f.label}] {f.row.account_name} {fmtWon(f.row.gross_amount ?? f.row.curr_amount)}원</span>)}
          </p>
        </section>

        {/* 5. 관리 제안 및 개선 방향 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">5. 관리 제안 및 개선 방향 <span className="font-normal text-xs text-muted-foreground">— 검토 제안이며 확정 지시가 아닙니다</span></h2>
          <ol className="text-sm space-y-1.5 leading-relaxed list-decimal list-inside">
            {(analysis && analysisStatus === 'done' && analysis.improvements.length > 0 ? analysis.improvements : localSuggestions).map((s, i) => (
              <li key={i}><EmphNum text={s} /></li>
            ))}
            {(!analysis || analysis.improvements.length === 0) && localSuggestions.length === 0 && (
              <li className="text-muted-foreground list-none">특이 제안 없음.</li>
            )}
          </ol>
        </section>

        {/* 6. 보고용 코멘트 초안 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">6. 보고용 코멘트 초안 <span className="font-normal text-xs text-muted-foreground">— 그대로 복사해 보고자료에 활용할 수 있는 문장</span></h2>
          <div className="no-print">
            <Textarea
              value={noteText}
              onChange={e => setReportNote(period, e.target.value)}
              className="min-h-[110px] text-sm leading-relaxed"
            />
            {!reportNote && (
              <p className="text-[11px] text-muted-foreground mt-1">코멘트 초안 · 검토 후 사용 — 수정하면 수정본이 보고서에 사용됩니다.</p>
            )}
          </div>
          <div className="hidden print:block text-sm leading-relaxed whitespace-pre-wrap border-l-2 border-border pl-3">
            {noteText}
          </div>
        </section>

        {/* 부록: 주요 변동 계정 사유 */}
        <section className="report-section">
          <h2 className="text-sm font-bold mb-2">부록. 주요 변동 계정 사유 <span className="font-normal text-xs text-muted-foreground">— 마감 검토에서 확정한 사유가 우선 반영됩니다</span></h2>
          <div className="space-y-2">
            {(pack?.flaggedAccounts ?? []).slice(0, 10).map(acc => {
              const { text, state } = draftOf(acc);
              const cls = reMap.get(acc);
              const f = findingOf(analysis, acc);
              return (
                <div key={acc} className="panel p-3 report-section">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{acc}</span>
                    {/* 뱃지 그룹: 항상 우측 고정 — 계정명 길이와 무관 */}
                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                      {cls && <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{clsBadge[cls]}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${state === '확정' ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'}`}>
                        {state === '확정' ? '사유 확정' : state === '작성 중' ? '작성 중' : '초안 · 검토 전'}
                      </span>
                    </div>
                  </div>
                  {text && <p className="text-xs leading-relaxed mt-1.5"><EmphNum text={text} /></p>}
                  {f?.action && (
                    <p className="text-[11px] mt-1.5 rounded bg-accent/50 border border-primary/15 px-2.5 py-1.5 leading-relaxed">
                      <span className="font-semibold text-primary">확인 포인트</span> · {f.action}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── 표 컴포넌트: 숫자 열 고정폭으로 배치 일관성 유지 ──
interface VarRowData {
  name: string;
  diff: number;
  contrib: number | null;
  driver: string;
  nature: string;
}

function varRow(
  c: { account_name: string; diff: number },
  totalMoM: number,
  pack: MonthlyInsightPack | null,
  reMap: Map<string, string>,
): VarRowData {
  const d = pack?.drivers[c.account_name];
  const v = d?.vendorTop[0];
  const driver = v && v.share != null && Math.abs(v.share) >= 0.3
    ? `'${v.name}' 기여 ${Math.round(Math.abs(v.share) * 100)}%`
    : d?.memoTop[0] ? `적요 '${d.memoTop[0].memo.slice(0, 14)}${d.memoTop[0].memo.length > 14 ? '…' : ''}'` : '-';
  const cls = reMap.get(c.account_name);
  return {
    name: c.account_name,
    diff: c.diff,
    contrib: totalMoM !== 0 ? c.diff / totalMoM : null,
    driver,
    nature: cls ? (clsBadge[cls] ?? '-') : '-',
  };
}

function VarTable({ title, rows2, up }: { title: string; rows2: VarRowData[]; up?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-1">{title}</p>
      <table className="w-full text-xs border border-border table-fixed">
        <colgroup>
          <col /><col className="w-24" /><col className="w-12" /><col className="w-28" /><col className="w-14" />
        </colgroup>
        <thead>
          <tr className="bg-secondary text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">계정</th>
            <th className="px-2 py-1.5 text-right font-medium">증감액</th>
            <th className="px-2 py-1.5 text-right font-medium">기여</th>
            <th className="px-2 py-1.5 text-left font-medium">주요 동인 후보</th>
            <th className="px-2 py-1.5 text-center font-medium">성격</th>
          </tr>
        </thead>
        <tbody>
          {rows2.length === 0 && <tr><td colSpan={5} className="px-2 py-2 text-muted-foreground">해당 없음</td></tr>}
          {rows2.map(r => (
            <tr key={r.name} className="border-t border-border">
              <td className="px-2 py-1.5 truncate">{r.name}</td>
              <td className={`px-2 py-1.5 text-right num ${up ? 'text-destructive' : 'text-primary'}`}>
                {r.diff >= 0 ? '+' : '△'}{fmtCompact(Math.abs(r.diff))}
              </td>
              <td className="px-2 py-1.5 text-right num text-muted-foreground">{r.contrib != null ? `${Math.round(Math.abs(r.contrib) * 100)}%` : '-'}</td>
              <td className="px-2 py-1.5 text-muted-foreground truncate">{r.driver}</td>
              <td className="px-2 py-1.5 text-center text-muted-foreground">{r.nature}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetTable({ title, rows2, analysis }: {
  title: string;
  rows2: { account_name: string; budget: number | null; actual: number; variance: number | null; execRate: number | null }[];
  analysis: MonthlyAnalysis | null;
}) {
  return (
    <div>
      <p className="text-xs font-semibold mb-1">{title}</p>
      <table className="w-full text-xs border border-border table-fixed">
        <colgroup>
          <col /><col className="w-20" /><col className="w-20" /><col className="w-20" /><col className="w-14" />
        </colgroup>
        <thead>
          <tr className="bg-secondary text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">계정</th>
            <th className="px-2 py-1.5 text-right font-medium">예산</th>
            <th className="px-2 py-1.5 text-right font-medium">실적</th>
            <th className="px-2 py-1.5 text-right font-medium">차이</th>
            <th className="px-2 py-1.5 text-right font-medium">집행률</th>
          </tr>
        </thead>
        <tbody>
          {rows2.length === 0 && <tr><td colSpan={5} className="px-2 py-2 text-muted-foreground">해당 없음</td></tr>}
          {rows2.map(r => {
            const cause = findingOf(analysis, r.account_name)?.cause;
            return (
              <Fragment key={r.account_name}>
                <tr className="border-t border-border">
                  <td className="px-2 py-1.5 truncate">{r.account_name}</td>
                  <td className="px-2 py-1.5 text-right num">{fmtCompact(r.budget ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right num">{fmtCompact(r.actual)}</td>
                  <td className={`px-2 py-1.5 text-right num ${r.variance != null && r.variance < 0 ? 'text-destructive' : ''}`}>{fmtCompact(r.variance ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right num">{fmtPct(r.execRate)}</td>
                </tr>
                {cause && (
                  <tr className="border-t border-dashed border-border/60">
                    <td colSpan={5} className="px-2 py-1 text-[11px] text-muted-foreground">↳ 사유 후보: {cause}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
