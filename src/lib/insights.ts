import type { MappedRow, BudgetRecord } from '@/types/finance';
import { prevPeriod, sameMonthLastYear } from '@/lib/normalize';

const amt = (r: MappedRow) => r.curr_amount ?? 0;

export function availablePeriods(rows: MappedRow[]): string[] {
  return Array.from(new Set(rows.map(r => r.period).filter(Boolean) as string[])).sort();
}

export function rowsOf(rows: MappedRow[], period: string): MappedRow[] {
  return rows.filter(r => r.period === period);
}

export function totalOf(rows: MappedRow[], period: string): number {
  return rowsOf(rows, period).reduce((s, r) => s + amt(r), 0);
}

export function byAccount(rows: MappedRow[], period?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (period && r.period !== period) continue;
    const k = r.account_name || '미분류';
    m.set(k, (m.get(k) || 0) + amt(r));
  }
  return m;
}

export function byCostCenter(rows: MappedRow[], period?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (period && r.period !== period) continue;
    const k = r.cost_center || '미분류';
    m.set(k, (m.get(k) || 0) + amt(r));
  }
  return m;
}

export function byVendor(rows: MappedRow[], period?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (period && r.period !== period) continue;
    const k = r.vendor || '미분류';
    m.set(k, (m.get(k) || 0) + amt(r));
  }
  return m;
}

export function monthlyTotals(rows: MappedRow[], accountFilter?: string): { period: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.period) continue;
    if (accountFilter && r.account_name !== accountFilter) continue;
    m.set(r.period, (m.get(r.period) || 0) + amt(r));
  }
  return Array.from(m.entries()).map(([period, amount]) => ({ period, amount })).sort((a, b) => a.period.localeCompare(b.period));
}

export interface Kpis {
  total: number;
  momAmount: number | null;
  momRate: number | null;
  yoyAmount: number | null;
  yoyRate: number | null;
  ytd: number;
  execRate: number | null; // 가중 집행률 = 당월 총실적 / 당월 총예산 (예산 존재 계정 기준)
  overBudgetCount: number;
}

export function computeKpis(rows: MappedRow[], budgets: BudgetRecord[], period: string, version: string | null): Kpis {
  const total = totalOf(rows, period);
  const prev = prevPeriod(period);
  const yoy = sameMonthLastYear(period);
  const periods = availablePeriods(rows);

  const prevTotal = periods.includes(prev) ? totalOf(rows, prev) : null;
  const yoyTotal = periods.includes(yoy) ? totalOf(rows, yoy) : null;

  const year = period.slice(0, 4);
  const ytd = rows.filter(r => r.period && r.period.startsWith(year) && r.period <= period).reduce((s, r) => s + amt(r), 0);

  const bva = bvaByAccount(rows, budgets, period, version);
  const withBudget = bva.filter(r => r.budget != null && r.budget > 0);
  const budgetSum = withBudget.reduce((s, r) => s + (r.budget || 0), 0);
  const actualOnBudgeted = withBudget.reduce((s, r) => s + r.actual, 0);
  const execRate = budgetSum > 0 ? actualOnBudgeted / budgetSum : null;
  const overBudgetCount = withBudget.filter(r => r.actual > (r.budget || 0)).length;

  return {
    total,
    momAmount: prevTotal != null ? total - prevTotal : null,
    momRate: prevTotal != null && prevTotal !== 0 ? (total - prevTotal) / prevTotal : null,
    yoyAmount: yoyTotal != null ? total - yoyTotal : null,
    yoyRate: yoyTotal != null && yoyTotal !== 0 ? (total - yoyTotal) / yoyTotal : null,
    ytd,
    execRate,
    overBudgetCount,
  };
}

export interface AccountChange {
  account_name: string;
  curr: number;
  prev: number;
  diff: number;
  rate: number | null;
}

/** 전월비 계정별 증감 (증감액 절대값 기준 정렬) */
export function accountChanges(rows: MappedRow[], period: string): AccountChange[] {
  const prev = prevPeriod(period);
  const currMap = byAccount(rows, period);
  const prevMap = byAccount(rows, prev);
  const keys = new Set([...currMap.keys(), ...prevMap.keys()]);
  const out: AccountChange[] = [];
  for (const k of keys) {
    const c = currMap.get(k) || 0;
    const p = prevMap.get(k) || 0;
    out.push({ account_name: k, curr: c, prev: p, diff: c - p, rate: p !== 0 ? (c - p) / p : null });
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

export interface BvaRow {
  account_name: string;
  actual: number;
  budget: number | null;
  variance: number | null;   // 예산 - 실적 (음수 = 불리 U)
  execRate: number | null;   // 실적 / 예산
  ytdActual: number;
  ytdBudget: number | null;
  ytdRate: number | null;
  annualBudget: number | null;
  annualBurn: number | null; // 연간예산 대비 YTD 소진율
}

export function budgetVersions(budgets: BudgetRecord[]): string[] {
  return Array.from(new Set(budgets.map(b => b.version))).sort();
}

function budgetMap(budgets: BudgetRecord[], version: string | null, filter: (b: BudgetRecord) => boolean): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of budgets) {
    if (version && b.version !== version) continue;
    if (!filter(b)) continue;
    m.set(b.account_name, (m.get(b.account_name) || 0) + b.amount);
  }
  return m;
}

/** 계정별 예산 대비 실적 (부서 예산은 계정 레벨로 합산) */
export function bvaByAccount(rows: MappedRow[], budgets: BudgetRecord[], period: string, version: string | null): BvaRow[] {
  const year = period.slice(0, 4);
  const actualMap = byAccount(rows, period);
  const monthBudget = budgetMap(budgets, version, b => b.period === period);
  const ytdBudgetM = budgetMap(budgets, version, b => b.period.startsWith(year) && b.period <= period);
  const annualBudgetM = budgetMap(budgets, version, b => b.period.startsWith(year));

  const ytdActualM = new Map<string, number>();
  for (const r of rows) {
    if (!r.period || !r.period.startsWith(year) || r.period > period) continue;
    const k = r.account_name || '미분류';
    ytdActualM.set(k, (ytdActualM.get(k) || 0) + amt(r));
  }

  const keys = new Set([...actualMap.keys(), ...monthBudget.keys()]);
  const out: BvaRow[] = [];
  for (const k of keys) {
    const actual = actualMap.get(k) || 0;
    const budget = monthBudget.has(k) ? monthBudget.get(k)! : null;
    const ytdActual = ytdActualM.get(k) || 0;
    const ytdBudget = ytdBudgetM.has(k) ? ytdBudgetM.get(k)! : null;
    const annualBudget = annualBudgetM.has(k) ? annualBudgetM.get(k)! : null;
    out.push({
      account_name: k,
      actual,
      budget,
      variance: budget != null ? budget - actual : null,
      execRate: budget != null && budget > 0 ? actual / budget : null,
      ytdActual,
      ytdBudget,
      ytdRate: ytdBudget != null && ytdBudget > 0 ? ytdActual / ytdBudget : null,
      annualBudget,
      annualBurn: annualBudget != null && annualBudget > 0 ? ytdActual / annualBudget : null,
    });
  }
  return out.sort((a, b) => b.actual - a.actual);
}

/** 특정 계정·월의 적요/거래처 요약 (AI 초안 컨텍스트용) */
export function accountContext(rows: MappedRow[], period: string, account: string) {
  const target = rows.filter(r => r.period === period && r.account_name === account);
  const memos = Array.from(new Set(target.map(r => r.memo).filter(Boolean) as string[])).slice(0, 8);
  const vendors = Array.from(new Set(target.map(r => r.vendor).filter(Boolean) as string[])).slice(0, 8);
  return { txCount: target.length, memos, vendors };
}
