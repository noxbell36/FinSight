import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { MappedRow, BudgetRecord, MonthlyAnalysis } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { computeKpis, accountChanges, byAccount, byCostCenter, monthlyTotals, totalOf } from '@/lib/insights';
import { fmtWon, fmtCompact, fmtPct, fmtChange } from '@/lib/format';
import { periodLabel, prevPeriod } from '@/lib/normalize';
import { MonthSelect, KpiCard, PageHeader } from '@/components/shared';
import { WaterfallChart, CompositionDonut } from '@/components/charts';
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
}

export default function MonthlyOverview({ rows, budgets, periods, period, setPeriod, version, settings, pack, analysis, analysisStatus }: Props) {
  const kpi = useMemo(() => computeKpis(rows, budgets, period, version), [rows, budgets, period, version]);
  const changes = useMemo(() => accountChanges(rows, period), [rows, period]);
  const [ccFilter, setCcFilter] = useState('all');

  const totalSeries = useMemo(() => monthlyTotals(rows).filter(d => d.period <= period).slice(-12), [rows, period]);
  const sparkTotals = totalSeries.map(d => d.amount);

  const accountTable = useMemo(() => {
    const filtered = ccFilter === 'all' ? rows : rows.filter(r => (r.cost_center || '미분류') === ccFilter);
    const curr = byAccount(filtered, period);
    const prev = byAccount(filtered, prevPeriod(period));
    const total = Array.from(curr.values()).reduce((a, b) => a + b, 0);
    return Array.from(curr.entries())
      .map(([name, amount]) => ({
        name, amount,
        share: total > 0 ? amount / total : 0,
        prev: prev.get(name) || 0,
        diff: amount - (prev.get(name) || 0),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [rows, period, ccFilter]);

  const ccData = useMemo(() =>
    Array.from(byCostCenter(rows, period).entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  [rows, period]);

  const trend = useMemo(() => totalSeries.map(d => ({ ...d, label: d.period.slice(2).replace('-', '.') })), [totalSeries]);
  const ccList = useMemo(() => Array.from(new Set(rows.map(r => r.cost_center || '미분류'))).sort(), [rows]);

  const prevP = prevPeriod(period);
  const hasPrev = periods.includes(prevP);
  const prevTotal = hasPrev ? totalOf(rows, prevP) : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="월별 비용 현황"
        desc={`${periodLabel(period)} 마감 기준 · 판관비 집계`}
        right={<MonthSelect periods={periods} value={period} onChange={setPeriod} />}
      />

      {/* AI 브리핑 + 인사이트 카드 — 상시 노출 */}
      {pack && <InsightBriefing items={pack.items} analysis={analysis} status={analysisStatus} />}

      {/* KPI */}
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

      {/* 워터폴 + 부서 도넛 */}
      <div className="grid lg:grid-cols-3 gap-4 mb-5">
        <div className="panel p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold mb-1">전월비 증감 분해 (워터폴)</h2>
          <p className="text-xs text-muted-foreground mb-2">어느 계정이 총비용을 밀어올리고 끌어내렸는지 — 붉은색 증가 / 파란색 감소</p>
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
        <div className="panel p-4">
          <h2 className="text-sm font-semibold mb-2">부서별 구성 ({periodLabel(period)})</h2>
          <CompositionDonut data={ccData} />
        </div>
      </div>

      {/* 12개월 추이 */}
      <div className="panel p-4 mb-5">
        <h2 className="text-sm font-semibold mb-3">월별 총비용 추이 (최근 12개월)</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={trend} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 90%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
            <Tooltip formatter={(v: number) => [`${fmtWon(v)}원`, '총비용']} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="amount" radius={[3, 3, 0, 0]} fill="hsl(152 60% 34%)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 계정별 상세 — 상시 전체 노출 */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">계정별 상세 ({periodLabel(period)})</h2>
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={ccFilter} onChange={e => setCcFilter(e.target.value)}>
            <option value="all">전체 부서</option>
            {ccList.map(cc => <option key={cc} value={cc}>{cc}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">계정명</th>
                <th className="px-4 py-2 text-right font-medium">당월 금액</th>
                <th className="px-4 py-2 text-right font-medium">비중</th>
                <th className="px-4 py-2 text-right font-medium">전월</th>
                <th className="px-4 py-2 text-right font-medium">증감액</th>
                <th className="px-4 py-2 text-right font-medium">증감률</th>
              </tr>
            </thead>
            <tbody>
              {accountTable.map(a => (
                <tr key={a.name} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2 text-right num">{fmtWon(a.amount)}</td>
                  <td className="px-4 py-2 text-right num text-muted-foreground">{fmtPct(a.share)}</td>
                  <td className="px-4 py-2 text-right num text-muted-foreground">{fmtWon(a.prev)}</td>
                  <td className={`px-4 py-2 text-right num ${a.diff > 0 ? 'text-destructive' : ''}`}>
                    {a.diff >= 0 ? `+${fmtWon(a.diff)}` : `(${fmtWon(Math.abs(a.diff))})`}
                  </td>
                  <td className="px-4 py-2 text-right num text-muted-foreground">
                    {a.prev !== 0 ? fmtChange(a.diff / a.prev) : a.amount > 0 ? '신규' : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
