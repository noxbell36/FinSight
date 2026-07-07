import type { MappedRow, BudgetRecord, MonthlyAnalysis, AiAccountFinding } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { dataFingerprint } from '@/lib/insightEngine';
import { bvaByAccount, accountChanges, computeKpis } from '@/lib/insights';
import { geminiJSON } from '@/lib/gemini';
import { periodLabel, prevPeriod } from '@/lib/normalize';
import { fmtWon, fmtPct, fmtChange } from '@/lib/format';

/**
 * 월간 AI 분석 파이프라인 — 규칙 엔진 결과를 근거로 Gemini 1회 배치 호출.
 * 산출물: 종합 코멘트 / 계정별 (사유 후보·확인 포인트·변동사유 초안) /
 *        주요 계정 특이사항 / 리스크 / 개선 제안 / 다음 달 관리 포인트.
 * 오류 결과도 캐시되어 자동 재시도 루프를 만들지 않는다 (수동 재시도만).
 */

export function analysisMapKey(period: string, version: string | null): string {
  return `${period}|${version ?? ''}`;
}

export function analysisCacheKey(rows: MappedRow[], period: string, version: string | null): string {
  return `${period}|${version ?? ''}|${dataFingerprint(rows, period)}`;
}

/** 성공/실패 무관 — 같은 데이터로 이미 시도했는지 (자동 재호출 차단) */
export function isAnalysisAttempted(a: MonthlyAnalysis | undefined | null, cacheKey: string): boolean {
  return !!a && a.key === cacheKey;
}

/** 계정의 전월비 증감을 견인한 거래처/부서 산출 (AI 근거용) */
function accountDrivers(rows: MappedRow[], period: string, account: string) {
  const prev = prevPeriod(period);
  const vCurr = new Map<string, number>();
  const vPrev = new Map<string, number>();
  const cc = new Map<string, number>();
  const memos = new Set<string>();
  let txCount = 0;
  for (const r of rows) {
    if (r.account_name !== account) continue;
    const v = r.vendor || '미상';
    if (r.period === period) {
      txCount++;
      vCurr.set(v, (vCurr.get(v) || 0) + (r.curr_amount ?? 0));
      cc.set(r.cost_center || '미분류', (cc.get(r.cost_center || '미분류') || 0) + (r.curr_amount ?? 0));
      if (r.memo) memos.add(r.memo);
    } else if (r.period === prev) {
      vPrev.set(v, (vPrev.get(v) || 0) + (r.curr_amount ?? 0));
    }
  }
  const vendors = new Set([...vCurr.keys(), ...vPrev.keys()]);
  const diffSum = Array.from(vendors).reduce((s, v) => s + ((vCurr.get(v) || 0) - (vPrev.get(v) || 0)), 0);
  let topDriver: { vendor: string; diff: number } | null = null;
  for (const v of vendors) {
    const d = (vCurr.get(v) || 0) - (vPrev.get(v) || 0);
    if (!topDriver || Math.abs(d) > Math.abs(topDriver.diff)) topDriver = { vendor: v, diff: d };
  }
  const topCc = Array.from(cc.entries()).sort((a, b) => b[1] - a[1])[0];
  return {
    txCount,
    memos: Array.from(memos).slice(0, 6),
    top_vendor_driver: topDriver
      ? { name: topDriver.vendor, diff: Math.round(topDriver.diff), diff_share_pct: diffSum !== 0 ? +((topDriver.diff / diffSum) * 100).toFixed(0) : null }
      : null,
    main_cost_center: topCc ? { name: topCc[0], amount: Math.round(topCc[1]) } : null,
  };
}

const SYSTEM_PIPELINE = `당신은 기업 재무팀의 관리회계 담당자입니다. 월마감 후 CFO 보고 자료를 작성합니다.
작성 원칙:
- 제공된 데이터에만 근거. 데이터에 없는 사실 창작 금지.
- 현상 묘사 금지: 화면에 이미 보이는 숫자를 단순 반복하는 문장 금지. 숫자는 반드시 해석·연결(부서/거래처/예산/추세)과 함께 쓸 것.
- 단정 금지: 원인은 "사유 후보"로, 조치는 "확인 포인트"로 표현. "~로 확인됨" 대신 "~로 추정, 확인 필요".
- cause: 사유 후보 1~2문장 — 거래처·부서·추세 근거를 반드시 인용 (예: "증가분의 72%가 PG사 결제대행 수수료 — 매출 연동 변동비로 추정").
- action: 확인 포인트 1문장 — 실무자가 당장 할 일 (예: "PG사 정산서 요율 대사 및 수정예산 반영 여부 검토").
- draft: 변동사유 보고 초안 2~3문장, 보고서 문체, 금액 콤마 표기.
- summary: 4~6문장 — 총비용 흐름 → 예산 대비 → 핵심 원인 연결 → 확인 필요 사항 순. 과장·감탄 금지.
- highlights.note: 12자 내외 특이사항 (예: "PG 수수료 상승 추세 지속").
- risks: 금액·배수 근거가 들어간 리스크 문장 2~4개.
- improvements: 실행 가능한 개선 제안 2~3개.
- next_points: 다음 달 관리 포인트 2~3개 (착지 전망·미확정 사유 후속 확인 포함).
반드시 JSON만 출력.`;

interface PipelineResponse {
  summary: string;
  findings: AiAccountFinding[];
  highlights: { account_name: string; note: string }[];
  risks: string[];
  improvements: string[];
  next_points: string[];
}

export async function runMonthlyAnalysis(
  rows: MappedRow[],
  budgets: BudgetRecord[],
  period: string,
  version: string | null,
  settings: AppSettings,
  pack: MonthlyInsightPack,
): Promise<MonthlyAnalysis> {
  const cacheKey = analysisCacheKey(rows, period, version);
  const base: MonthlyAnalysis = {
    key: cacheKey,
    period,
    generated_at: new Date().toISOString(),
    summary: '',
    findings: [],
    highlights: [],
    risks: [],
    improvements: [],
    next_points: [],
  };

  try {
    const kpi = computeKpis(rows, budgets, period, version);
    const bva = bvaByAccount(rows, budgets, period, version);
    const changes = accountChanges(rows, period);
    const changeMap = new Map(changes.map(c => [c.account_name, c]));
    const bvaMap = new Map(bva.map(r => [r.account_name, r]));

    const targets = pack.flaggedAccounts.slice(0, 12).map(acc => {
      const b = bvaMap.get(acc);
      const c = changeMap.get(acc);
      const drv = accountDrivers(rows, period, acc);
      return {
        account: acc,
        actual: Math.round(b?.actual ?? c?.curr ?? 0),
        budget: b?.budget != null ? Math.round(b.budget) : null,
        exec_rate_pct: b?.execRate != null ? +(b.execRate * 100).toFixed(1) : null,
        mom_diff: Math.round(c?.diff ?? 0),
        mom_rate_pct: c?.rate != null ? +(c.rate * 100).toFixed(1) : null,
        ...drv,
      };
    });

    const topAccounts = bva.slice(0, 5).map(r => ({
      account: r.account_name,
      actual: Math.round(r.actual),
      share_pct: kpi.total > 0 ? +((r.actual / kpi.total) * 100).toFixed(1) : 0,
    }));

    const insightLines = pack.items.slice(0, 14).map(i => `[${i.category}/${i.severity}] ${i.title} — ${i.detail}`);
    const landingLines = pack.landing.filter(l => l.ratio > 1).slice(0, 5).map(l =>
      `${l.account_name}: 연간예산 ${fmtWon(l.annualBudget)} / 착지전망 ${fmtWon(l.projected)} (${fmtPct(l.ratio)})`);

    const prompt = [
      `# ${periodLabel(period)} 월마감 데이터 (예산버전: ${version ?? '없음'})`,
      `총비용 ${fmtWon(kpi.total)}원, 전월비 ${kpi.momRate != null ? fmtChange(kpi.momRate) : '-'}, 전년동월비 ${kpi.yoyRate != null ? fmtChange(kpi.yoyRate) : '-'}, 예산 집행률 ${kpi.execRate != null ? fmtPct(kpi.execRate) : '예산 없음'}, 예산 초과 ${kpi.overBudgetCount}개 계정`,
      pack.fixedShare != null ? `고정성 비용 비중 약 ${fmtPct(pack.fixedShare)}` : '',
      '',
      '## 규칙 엔진 검출 사항 (이미 화면에 표시됨 — 단순 반복 금지, 연결 해석에만 사용)',
      ...insightLines,
      landingLines.length ? '## 연말 착지 전망 (초과 우려)' : '',
      ...landingLines,
      '',
      '## 상위 5개 계정 (highlights 작성 대상)',
      JSON.stringify(topAccounts),
      '',
      '## 검토 대상 계정 상세 (findings 작성 대상 — top_vendor_driver.diff_share_pct = 전월비 증감 중 해당 거래처 기여율%)',
      JSON.stringify(targets),
      '',
      '## 출력 JSON 스키마',
      '{"summary":"...","findings":[{"account_name":"","cause":"","action":"","draft":""}],"highlights":[{"account_name":"","note":""}],"risks":["..."],"improvements":["..."],"next_points":["..."]}',
      'findings는 검토 대상 계정 전체, highlights는 상위 5개 계정 전체에 대해 작성.',
    ].filter(Boolean).join('\n');

    const res = await geminiJSON<PipelineResponse>(prompt, {
      system: SYSTEM_PIPELINE,
      model: settings.gemini_model,
      maxTokens: 8192,
    });

    return {
      ...base,
      summary: (res.summary || '').trim(),
      findings: Array.isArray(res.findings)
        ? res.findings.filter(f => f && f.account_name).map(f => ({
            account_name: String(f.account_name),
            cause: String(f.cause || '').trim(),
            action: String(f.action || '').trim(),
            draft: String(f.draft || '').trim(),
          }))
        : [],
      highlights: Array.isArray(res.highlights)
        ? res.highlights.filter(h => h && h.account_name).map(h => ({ account_name: String(h.account_name), note: String(h.note || '').trim() }))
        : [],
      risks: Array.isArray(res.risks) ? res.risks.map(String) : [],
      improvements: Array.isArray(res.improvements) ? res.improvements.map(String) : [],
      next_points: Array.isArray(res.next_points) ? res.next_points.map(String) : [],
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'AI 분석 실패' };
  }
}

export function findingOf(analysis: MonthlyAnalysis | null | undefined, account: string): AiAccountFinding | undefined {
  return analysis?.findings.find(f => f.account_name === account);
}
