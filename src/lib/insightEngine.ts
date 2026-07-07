import type { MappedRow, BudgetRecord } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import { bvaByAccount, byAccount, byVendor, monthlyTotals, availablePeriods } from '@/lib/insights';
import { runReviewChecks } from '@/lib/reviewChecks';
import { prevPeriod, sameMonthLastYear, periodLabel } from '@/lib/normalize';
import { fmtWon, fmtPct, fmtChange } from '@/lib/format';

/**
 * 규칙 엔진 — AI 없이 즉시 계산되는 1차 인사이트.
 * 원본의 리스크 카드를 계승하되, 다개월 시계열 근거로 판정한다.
 */

export type InsightSeverity = 'danger' | 'warning' | 'info' | 'good';

export interface InsightItem {
  id: string;
  severity: InsightSeverity;
  category: '예산' | '추세' | '구조' | '검토' | '전망';
  title: string;
  detail: string;
  account?: string;
}

export interface RecurrenceRow {
  account_name: string;
  cls: '고정성(반복)' | '준변동' | '변동성' | '간헐/일회성';
  cv: number | null;        // 변동계수
  monthsPresent: number;
  monthsTotal: number;
  avg: number;
}

export interface LandingRow {
  account_name: string;
  annualBudget: number;
  ytdActual: number;
  projected: number;   // YTD + 최근 3개월 평균 × 잔여월
  ratio: number;       // projected / annualBudget
}

export interface WaterfallStep {
  name: string;
  value: number;       // 증감액 (+/-)
}

export interface MonthlyInsightPack {
  period: string;
  items: InsightItem[];              // 인사이트 카드 (심각도순)
  recurrence: RecurrenceRow[];       // 비용 성격 분류
  fixedShare: number | null;         // 고정성 비용 비중
  landing: LandingRow[];             // 연말 착지 전망 (초과 예상 위주)
  waterfall: WaterfallStep[];        // 전월비 증감 분해
  accountConcentration: { top3Share: number; names: string[] } | null;
  vendorConcentration: { top5Share: number } | null;
  flaggedAccounts: string[];         // AI 해석 대상 계정 (변동사유 대상과 동일 기준)
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/** 계정별 월 시계열 맵 생성 */
function accountSeries(rows: MappedRow[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.period) continue;
    const acc = r.account_name || '미분류';
    if (!m.has(acc)) m.set(acc, new Map());
    const s = m.get(acc)!;
    s.set(r.period, (s.get(r.period) || 0) + (r.curr_amount ?? 0));
  }
  return m;
}

export function buildMonthlyInsights(
  rows: MappedRow[],
  budgets: BudgetRecord[],
  period: string,
  version: string | null,
  settings: AppSettings,
): MonthlyInsightPack {
  const periods = availablePeriods(rows).filter(p => p <= period);
  const items: InsightItem[] = [];
  const series = accountSeries(rows);
  const bva = bvaByAccount(rows, budgets, period, version);
  const currByAcc = byAccount(rows, period);
  const prevByAcc = byAccount(rows, prevPeriod(period));
  const flagged = new Set<string>();

  // ── 1) 예산 초과 / 경보 ──
  for (const r of bva) {
    if (r.execRate == null) continue;
    if (r.execRate > 1) {
      flagged.add(r.account_name);
      items.push({
        id: `budget-over-${r.account_name}`, severity: 'danger', category: '예산', account: r.account_name,
        title: `${r.account_name} 예산 초과`,
        detail: `집행률 ${fmtPct(r.execRate)} — 예산 ${fmtWon(r.budget)}원 대비 ${fmtWon(r.actual - (r.budget || 0))}원 초과 지출.`,
      });
    } else if (r.execRate > settings.budget_warning_threshold) {
      flagged.add(r.account_name);
      items.push({
        id: `budget-warn-${r.account_name}`, severity: 'warning', category: '예산', account: r.account_name,
        title: `${r.account_name} 집행률 경보`,
        detail: `집행률 ${fmtPct(r.execRate)} — 경보 기준(${Math.round(settings.budget_warning_threshold * 100)}%) 초과, 잔여 예산 ${fmtWon((r.budget || 0) - r.actual)}원.`,
      });
    }
  }

  // ── 2) 추세/일회성/계절성/계단식 판정 (계정별 시계열) ──
  for (const [acc, s] of series) {
    const hist = periods.map(p => s.get(p) ?? 0);
    const curr = s.get(period) ?? 0;
    if (curr === 0 || hist.length < 4) continue;
    const past = hist.slice(0, -1); // 당월 제외
    const ma3 = mean(past.slice(-3));
    if (ma3 <= 0) continue;
    const dev = curr / ma3 - 1;

    if (Math.abs(dev) >= 0.15) {
      // 계절성 확인: 전년 동월도 인접월 대비 튀었는가
      const lastYear = sameMonthLastYear(period);
      const lyIdx = periods.indexOf(lastYear);
      let seasonal = false;
      if (lyIdx >= 2) {
        const ly = s.get(lastYear) ?? 0;
        const lyNeighbors = mean([s.get(periods[lyIdx - 1]) ?? 0, s.get(periods[lyIdx - 2]) ?? 0]);
        if (lyNeighbors > 0 && Math.sign(ly / lyNeighbors - 1) === Math.sign(dev) && Math.abs(ly / lyNeighbors - 1) >= 0.15) seasonal = true;
      }
      // 추세성 확인: 직전 3개월이 연속 같은 방향으로 이동
      const recent = past.slice(-3);
      const trending = recent.length === 3 && (
        (dev > 0 && recent[0] < recent[1] && recent[1] < recent[2]) ||
        (dev < 0 && recent[0] > recent[1] && recent[1] > recent[2])
      );

      flagged.add(acc);
      if (seasonal) {
        items.push({
          id: `seasonal-${acc}`, severity: 'info', category: '추세', account: acc,
          title: `${acc} 계절성 변동`,
          detail: `3개월 평균 대비 ${fmtChange(dev)} — 전년 동월(${periodLabel(lastYear)})에도 유사한 변동이 있어 계절성 패턴으로 판단.`,
        });
      } else if (trending) {
        const mAvg = past.length >= 6 ? Math.pow(curr / past[past.length - 6], 1 / 6) - 1 : dev / 3;
        items.push({
          id: `trend-${acc}`, severity: dev > 0 ? 'warning' : 'good', category: '추세', account: acc,
          title: `${acc} 추세적 ${dev > 0 ? '증가' : '감소'}`,
          detail: `3개월 연속 ${dev > 0 ? '상승' : '하락'}, 이동평균 대비 ${fmtChange(dev)} (최근 월평균 ${fmtChange(mAvg)}). 일회성이 아닌 구조적 ${dev > 0 ? '증가로 예산 압박 요인' : '감소'}.`,
        });
      } else {
        items.push({
          id: `oneoff-${acc}`, severity: Math.abs(dev) >= 0.5 ? 'warning' : 'info', category: '추세', account: acc,
          title: `${acc} 일회성 변동 의심`,
          detail: `3개월 평균 대비 ${fmtChange(dev)} (${fmtWon(curr - ma3)}원). 과거 패턴에 없는 단발성 변동 — 적요·전표 확인 필요.`,
        });
      }
    }

    // 계단식 수준 변화: 최근 3개월 평균 vs 그 이전 3개월 평균
    if (past.length >= 6) {
      const recent3 = past.slice(-3);
      const before3 = past.slice(-6, -3);
      const r3 = mean(recent3), b3 = mean(before3);
      const lowVar = b3 > 0 && stdev(recent3) / r3 < 0.08 && stdev(before3) / b3 < 0.08;
      if (lowVar && b3 > 0 && Math.abs(r3 / b3 - 1) >= 0.12) {
        items.push({
          id: `step-${acc}`, severity: 'info', category: '구조', account: acc,
          title: `${acc} 지출 수준 자체가 변경됨`,
          detail: `직전 3개월 평균 ${fmtWon(r3)}원 — 그 이전 3개월(${fmtWon(b3)}원) 대비 ${fmtChange(r3 / b3 - 1)}의 계단식 변화. 계약 변경·자산 취득 등 구조 변화 확인.`,
        });
      }
    }
  }

  // ── 3) 비용 성격 분류 (반복성/변동성) + 고정비 비중 ──
  const recurrence: RecurrenceRow[] = [];
  let fixedSum = 0, totalSum = 0;
  for (const [acc, s] of series) {
    const vals = periods.map(p => s.get(p) ?? 0);
    const present = vals.filter(v => v > 0).length;
    const nonZero = vals.filter(v => v > 0);
    const avg = mean(nonZero);
    const curr = s.get(period) ?? 0;
    totalSum += curr;
    let cls: RecurrenceRow['cls'];
    let cv: number | null = null;
    if (present / Math.max(periods.length, 1) < 0.4 || present < 3) {
      cls = '간헐/일회성';
    } else {
      cv = avg > 0 ? stdev(nonZero) / avg : null;
      if (cv != null && cv < 0.1) { cls = '고정성(반복)'; fixedSum += curr; }
      else if (cv != null && cv < 0.35) cls = '준변동';
      else cls = '변동성';
    }
    recurrence.push({ account_name: acc, cls, cv, monthsPresent: present, monthsTotal: periods.length, avg });
  }
  recurrence.sort((a, b) => (currByAcc.get(b.account_name) || 0) - (currByAcc.get(a.account_name) || 0));
  const fixedShare = totalSum > 0 ? fixedSum / totalSum : null;

  // ── 4) 집중도 ──
  const accTotals = Array.from(currByAcc.entries()).sort((a, b) => b[1] - a[1]);
  const accSum = accTotals.reduce((s, [, v]) => s + v, 0);
  let accountConcentration: MonthlyInsightPack['accountConcentration'] = null;
  if (accTotals.length >= 3 && accSum > 0) {
    const top3 = accTotals.slice(0, 3);
    const share = top3.reduce((s, [, v]) => s + v, 0) / accSum;
    accountConcentration = { top3Share: share, names: top3.map(([n]) => n) };
    if (share > 0.6) {
      items.push({
        id: 'conc-account', severity: 'info', category: '구조',
        title: `상위 3개 계정 집중도 ${fmtPct(share, 0)}`,
        detail: `${top3.map(([n]) => n).join(', ')}에 당월 비용이 집중. 해당 계정 변동이 전체 손익에 직결되는 구조.`,
      });
    }
  }
  const vendorTotals = Array.from(byVendor(rows, period).entries()).sort((a, b) => b[1] - a[1]);
  const vSum = vendorTotals.reduce((s, [, v]) => s + v, 0);
  let vendorConcentration: MonthlyInsightPack['vendorConcentration'] = null;
  if (vendorTotals.length >= 5 && vSum > 0) {
    const share = vendorTotals.slice(0, 5).reduce((s, [, v]) => s + v, 0) / vSum;
    vendorConcentration = { top5Share: share };
    if (share > 0.7) {
      items.push({
        id: 'conc-vendor', severity: 'info', category: '구조',
        title: `상위 5개 거래처 의존도 ${fmtPct(share, 0)}`,
        detail: `소수 거래처 의존도가 높음 — 단가 인상·계약 종료 시 대체 리스크 점검 권고.`,
      });
    }
  }

  // ── 5) 전표 검토 요약 ──
  const checks = runReviewChecks(rows, period, settings);
  const dangerHits = checks.filter(c => c.severity === 'danger').reduce((s, c) => s + c.hits.length, 0);
  const warnHits = checks.filter(c => c.severity === 'warning').reduce((s, c) => s + c.hits.length, 0);
  if (dangerHits > 0) {
    const names = checks.filter(c => c.severity === 'danger' && c.hits.length > 0).map(c => `${c.label} ${c.hits.length}건`).join(', ');
    items.push({
      id: 'review-danger', severity: 'danger', category: '검토',
      title: `마감 전 필수 확인 ${dangerHits}건`,
      detail: `${names} — 전표·경비 검토 탭에서 처리 필요.`,
    });
  } else if (warnHits > 0) {
    items.push({
      id: 'review-warn', severity: 'warning', category: '검토',
      title: `검토 권고 항목 ${warnHits}건`,
      detail: `적요 미기재·분할 결제 의심 등 — 전표·경비 검토 탭 참조.`,
    });
  }

  // ── 6) 연말 착지 전망 (Landing Estimate) ──
  const landing: LandingRow[] = [];
  const [yStr, mStr] = period.split('-');
  const remaining = 12 - parseInt(mStr, 10);
  if (remaining > 0) {
    for (const r of bva) {
      if (r.annualBudget == null || r.annualBudget <= 0) continue;
      const s = series.get(r.account_name);
      const recent3 = s ? periods.slice(-3).map(p => s.get(p) ?? 0) : [];
      const projected = r.ytdActual + mean(recent3) * remaining;
      const ratio = projected / r.annualBudget;
      landing.push({ account_name: r.account_name, annualBudget: r.annualBudget, ytdActual: r.ytdActual, projected, ratio });
    }
    landing.sort((a, b) => b.ratio - a.ratio);
    const overLanding = landing.filter(l => l.ratio > 1.05);
    if (overLanding.length > 0) {
      const top = overLanding[0];
      flagged.add(top.account_name);
      items.push({
        id: 'landing', severity: 'warning', category: '전망',
        title: `현재 속도 유지 시 연간예산 초과 예상 ${overLanding.length}개 계정`,
        detail: `${top.account_name}는 ${yStr}년 예산 대비 ${fmtPct(top.ratio, 0)} 착지 전망(최근 3개월 지출 속도 기준). 수정예산 반영 또는 지출 통제 검토.`,
      });
    }
  }

  // ── 7) 전월비 워터폴 분해 ──
  const keys = new Set([...currByAcc.keys(), ...prevByAcc.keys()]);
  const diffs = Array.from(keys).map(k => ({ name: k, value: (currByAcc.get(k) || 0) - (prevByAcc.get(k) || 0) }))
    .filter(d => d.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const topDiffs = diffs.slice(0, 6);
  const rest = diffs.slice(6).reduce((s, d) => s + d.value, 0);
  const waterfall: WaterfallStep[] = [...topDiffs];
  if (rest !== 0) waterfall.push({ name: '기타', value: rest });

  // 전월비 큰 변동 계정도 flagged에 (변동사유 대상과 동일 기준)
  for (const d of diffs) {
    const prev = prevByAcc.get(d.name) || 0;
    if (prev > 0 && Math.abs(d.value / prev) > settings.change_rate_threshold) flagged.add(d.name);
    if (prev === 0 && d.value > 0) flagged.add(d.name);
  }

  const sevOrder: Record<InsightSeverity, number> = { danger: 0, warning: 1, info: 2, good: 3 };
  items.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return {
    period, items, recurrence, fixedShare, landing, waterfall,
    accountConcentration, vendorConcentration,
    flaggedAccounts: Array.from(flagged),
  };
}

/** 데이터 지문 — 캐시 무효화 키 (행수+합계 조합, 저비용) */
export function dataFingerprint(rows: MappedRow[], period: string): string {
  let count = 0, sum = 0;
  const prev = prevPeriod(period);
  for (const r of rows) {
    if (r.period === period || r.period === prev) {
      count++;
      sum += r.curr_amount ?? 0;
    }
  }
  return `${count}-${Math.round(sum)}`;
}
