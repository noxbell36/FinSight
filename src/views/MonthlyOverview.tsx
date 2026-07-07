import { useMemo } from 'react';
import type { MappedRow, BudgetRecord, MonthlyAnalysis } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { computeKpis, monthlyTotals, totalOf } from '@/lib/insights';
import { fmtWon, fmtCompact, fmtPct, fmtChange } from '@/lib/format';
import { periodLabel, prevPeriod } from '@/lib/normalize';
import { MonthSelect, KpiCard, PageHeader } from '@/components/shared';
import { WaterfallChart } from '@/components/charts';
import InsightBriefing, { type AnalysisStatus } from '@/components/InsightBriefing';

interface Props {
  rows: MappedRow[];
  budgets: BudgetRecord[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
  version: string | null;
  settings: AppSettings;
  pack: MonthlyInsightPack | null;
  analysis: MonthlyAnalysis | null;
  analysisStatus: AnalysisStatus;
  onRetryAnalysis: () => void;
  goToDetail: () => void;
}

/**
 * 월간 현황 — "이번 달 뭐가 문제인가"에만 답한다.
 * 판단(요약·이슈) → 근거(KPI·워터폴)까지. 원자료·추이·구성은 상세 분석 탭으로.
 */
export default function MonthlyOverview({ rows, budgets, periods, period, setPeriod, version, settings, pack, analysis, analysisStatus, onRetryAnalysis, goToDetail }: Props) {
  const kpi = useMemo(() => computeKpis(rows, budgets, period, version), [rows, budgets, period, version]);
  const sparkTotals = useMemo(
    () => monthlyTotals(rows).filter(d => d.period <= period).slice(-12).map(d => d.amount),
    [rows, period],
  );

  const prevP = prevPeriod(period);
  const hasPrev = periods.includes(prevP);
  const prevTotal = hasPrev ? totalOf(rows, prevP) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="월간 현황"
        desc={`${periodLabel(period)} 마감 기준 · 판관비 집계`}
        right={<MonthSelect periods={periods} value={period} onChange={setPeriod} />}
      />

      {/* 판단: 요약 + 확인 필요 항목 */}
      {pack && (
        <InsightBriefing items={pack.items} analysis={analysis} status={analysisStatus} onRetry={onRetryAnalysis} />
      )}

      {/* 근거: KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="당월 총비용" value={fmtCompact(kpi.total)} sub={`${fmtWon(kpi.total)}원`} spark={sparkTotals} />
        <KpiCard
          label="전월비"
          value={kpi.momRate != null ? fmtChange(kpi.momRate) : '-'}
          sub={kpi.momAmount != null ? `${kpi.momAmount >= 0 ? '+' : '△'}${fmtWon(Math.abs(kpi.momAmount))}원` : '전월 데이터 없음'}
          subClass={kpi.momAmount != null && kpi.momAmount > 0 ? 'text-destructive' : 'text-primary'}
        />
        <KpiCard
          label="전년동월비"
          value={kpi.yoyRate != null ? fmtChange(kpi.yoyRate) : '-'}
          sub={kpi.yoyAmount != null ? `${kpi.yoyAmount >= 0 ? '+' : '△'}${fmtWon(Math.abs(kpi.yoyAmount))}원` : '전년 데이터 없음'}
          subClass={kpi.yoyAmount != null && kpi.yoyAmount > 0 ? 'text-destructive' : 'text-primary'}
        />
        <KpiCard
          label={`예산 집행률${version ? ` (${version})` : ''}`}
          value={kpi.execRate != null ? fmtPct(kpi.execRate) : '-'}
          sub={kpi.execRate != null ? `예산 초과 ${kpi.overBudgetCount}개 계정` : '예산 데이터 없음'}
          subClass={kpi.overBudgetCount > 0 ? 'text-destructive' : undefined}
        />
      </div>

      {/* 근거: 전월비 증감 분해 */}
      <div className="panel p-4">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-sm font-semibold">전월비 증감 분해</h2>
          <button onClick={goToDetail} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
            계정·부서·거래처 상세 →
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">어느 계정이 총비용을 움직였는지 — 붉은색 증가 / 파란색 감소</p>
        {pack && hasPrev ? (
          <WaterfallChart
            prevTotal={prevTotal}
            currTotal={kpi.total}
            steps={pack.waterfall}
            prevLabel={prevP.slice(2).replace('-', '.')}
            currLabel={period.slice(2).replace('-', '.')}
          />
        ) : (
          <p className="text-xs text-muted-foreground py-8 text-center">전월 데이터가 있어야 표시됩니다.</p>
        )}
      </div>
    </div>
  );
}
