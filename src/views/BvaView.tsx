import { useMemo } from 'react';
import type { MappedRow, BudgetRecord } from '@/types/finance';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import type { AppSettings } from '@/types/settings';
import { bvaByAccount, budgetVersions, monthlyTotals } from '@/lib/insights';
import { fmtWon, fmtPct, fmtCompact } from '@/lib/format';
import { periodLabel } from '@/lib/normalize';
import { MonthSelect, PageHeader, EmptyHint, KpiCard } from '@/components/shared';
import { BudgetActualCombo } from '@/components/charts';

interface Props {
  rows: MappedRow[];
  budgets: BudgetRecord[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
  version: string | null;
  setVersion: (v: string) => void;
  settings: AppSettings;
  goToData: () => void;
  pack: MonthlyInsightPack | null;
}

export default function BvaView({ rows, budgets, periods, period, setPeriod, version, setVersion, settings, goToData, pack }: Props) {
  const versions = useMemo(() => budgetVersions(budgets), [budgets]);
  const bva = useMemo(() => bvaByAccount(rows, budgets, period, version), [rows, budgets, period, version]);

  const totals = useMemo(() => {
    const withB = bva.filter(r => r.budget != null);
    const budget = withB.reduce((s, r) => s + (r.budget || 0), 0);
    const actual = withB.reduce((s, r) => s + r.actual, 0);
    const ytdB = withB.reduce((s, r) => s + (r.ytdBudget || 0), 0);
    const ytdA = withB.reduce((s, r) => s + r.ytdActual, 0);
    return {
      budget, actual, variance: budget - actual,
      execRate: budget > 0 ? actual / budget : null,
      ytdRate: ytdB > 0 ? ytdA / ytdB : null,
      overCount: withB.filter(r => (r.execRate ?? 0) > 1).length,
      warnCount: withB.filter(r => (r.execRate ?? 0) > settings.budget_warning_threshold && (r.execRate ?? 0) <= 1).length,
    };
  }, [bva, settings.budget_warning_threshold]);

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

  if (budgets.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <PageHeader title="예산 대비 실적" desc="계정별 예산·실적·차이 분석" />
        <EmptyHint>
          예산 데이터가 없습니다.{' '}
          <button onClick={goToData} className="text-primary underline underline-offset-2">데이터 관리</button>
          에서 예산 파일을 업로드하거나 가상 데이터를 불러와 주세요.
        </EmptyHint>
      </div>
    );
  }

  const warnTh = settings.budget_warning_threshold;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="예산 대비 실적"
        desc={`${periodLabel(period)} · 차이는 예산-실적 기준, 음수(괄호)=예산 초과`}
        right={
          <>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={version ?? ''} onChange={e => setVersion(e.target.value)}>
              {versions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <MonthSelect periods={periods} value={period} onChange={setPeriod} />
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="당월 예산 (편성 계정 합계)" value={fmtCompact(totals.budget)} sub={`${fmtWon(totals.budget)}원`} />
        <KpiCard label="당월 실적 (동일 계정)" value={fmtCompact(totals.actual)} sub={`${fmtWon(totals.actual)}원`} />
        <KpiCard
          label="집행률 (가중)"
          value={totals.execRate != null ? fmtPct(totals.execRate) : '-'}
          sub={totals.ytdRate != null ? `YTD 누계 ${fmtPct(totals.ytdRate)}` : undefined}
          subClass={totals.execRate != null && totals.execRate > 1 ? 'text-destructive' : undefined}
        />
        <KpiCard
          label="확인 필요 계정"
          value={`${totals.overCount + totals.warnCount}개`}
          sub={`초과 ${totals.overCount} · 경보(${Math.round(warnTh * 100)}%↑) ${totals.warnCount}`}
          subClass={totals.overCount > 0 ? 'text-destructive' : undefined}
        />
      </div>

      <div className="panel p-4 mb-5">
        <h2 className="text-sm font-semibold mb-2">월별 실적 vs 예산 ({version ?? '-'}, 최근 12개월)</h2>
        <BudgetActualCombo data={comboData} />
      </div>

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">계정별 예산 대비 실적 — {version}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">계정명</th>
                <th className="px-4 py-2 text-right font-medium">당월 예산</th>
                <th className="px-4 py-2 text-right font-medium">당월 실적</th>
                <th className="px-4 py-2 text-right font-medium">차이 B/(W)</th>
                <th className="px-4 py-2 text-right font-medium">집행률</th>
                <th className="px-4 py-2 text-right font-medium">YTD 예산</th>
                <th className="px-4 py-2 text-right font-medium">YTD 실적</th>
                <th className="px-4 py-2 text-right font-medium">YTD 집행률</th>
                <th className="px-4 py-2 text-right font-medium">연간예산 소진율</th>
              </tr>
            </thead>
            <tbody>
              {bva.map(r => {
                const over = (r.execRate ?? 0) > 1;
                const warn = !over && (r.execRate ?? 0) > warnTh;
                return (
                  <tr key={r.account_name} className={`border-t border-border hover:bg-muted/40 ${over ? 'bg-destructive/5' : warn ? 'bg-[hsl(var(--warning))]/8' : ''}`}>
                    <td className="px-4 py-2">
                      {r.account_name}
                      {over && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">초과</span>}
                      {warn && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))]">경보</span>}
                    </td>
                    <td className="px-4 py-2 text-right num text-muted-foreground">{r.budget != null ? fmtWon(r.budget) : '미편성'}</td>
                    <td className="px-4 py-2 text-right num">{fmtWon(r.actual)}</td>
                    <td className={`px-4 py-2 text-right num ${r.variance != null && r.variance < 0 ? 'text-destructive' : 'text-primary'}`}>
                      {r.variance != null ? fmtWon(r.variance) : '-'}
                    </td>
                    <td className={`px-4 py-2 text-right num ${over ? 'text-destructive font-semibold' : warn ? 'font-semibold' : ''}`}>{fmtPct(r.execRate)}</td>
                    <td className="px-4 py-2 text-right num text-muted-foreground">{r.ytdBudget != null ? fmtWon(r.ytdBudget) : '-'}</td>
                    <td className="px-4 py-2 text-right num">{fmtWon(r.ytdActual)}</td>
                    <td className="px-4 py-2 text-right num">{fmtPct(r.ytdRate)}</td>
                    <td className="px-4 py-2 text-right num">{fmtPct(r.annualBurn)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-xs text-muted-foreground border-t border-border">
          B/(W): Better/(Worse). 괄호(음수)는 실적이 예산을 초과한 불리한 차이입니다. "미편성"은 실적은 있으나 해당 버전 예산이 없는 계정입니다.
        </p>
      </div>

      {/* 연말 착지 전망 */}
      {pack && pack.landing.filter(l => l.ratio > 1).length > 0 && (
        <div className="panel overflow-hidden mt-5">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">연말 착지 전망 — 연간예산 초과 우려 계정</h2>
            <p className="text-xs text-muted-foreground mt-0.5">전망 = YTD 실적 + 최근 3개월 평균 × 잔여월 (계절성·일회성 계획 미반영 단순 추정)</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">계정명</th>
                <th className="px-4 py-2 text-right font-medium">연간예산</th>
                <th className="px-4 py-2 text-right font-medium">YTD 실적</th>
                <th className="px-4 py-2 text-right font-medium">착지 전망</th>
                <th className="px-4 py-2 text-right font-medium">예산 대비</th>
              </tr>
            </thead>
            <tbody>
              {pack.landing.filter(l => l.ratio > 1).slice(0, 10).map(l => (
                <tr key={l.account_name} className="border-t border-border">
                  <td className="px-4 py-1.5">{l.account_name}</td>
                  <td className="px-4 py-1.5 text-right num">{fmtWon(l.annualBudget)}</td>
                  <td className="px-4 py-1.5 text-right num">{fmtWon(l.ytdActual)}</td>
                  <td className="px-4 py-1.5 text-right num">{fmtWon(l.projected)}</td>
                  <td className="px-4 py-1.5 text-right num text-destructive font-semibold">{fmtPct(l.ratio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
