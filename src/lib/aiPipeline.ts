import type { MappedRow, BudgetRecord, MonthlyAnalysis, AiAccountFinding } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { dataFingerprint } from '@/lib/insightEngine';
import { bvaByAccount, accountChanges, accountContext, computeKpis } from '@/lib/insights';
import { geminiJSON } from '@/lib/gemini';
import { periodLabel } from '@/lib/normalize';
import { fmtWon, fmtPct, fmtChange } from '@/lib/format';

/**
 * 월간 AI 분석 파이프라인 — 규칙 엔진 결과를 근거로 Gemini 1회 배치 호출.
 * 산출물: Executive Summary + 검토 대상 계정별 (원인 추론 / 권고 액션 / 변동사유 초안).
 * 결과는 store.analyses에 캐시되어 데이터가 바뀌지 않는 한 재호출하지 않는다.
 */

export function analysisMapKey(period: string, version: string | null): string {
  return `${period}|${version ?? ''}`;
}

export function analysisCacheKey(rows: MappedRow[], period: string, version: string | null): string {
  return `${period}|${version ?? ''}|${dataFingerprint(rows, period)}`;
}

export function isAnalysisValid(a: MonthlyAnalysis | undefined, cacheKey: string): boolean {
  return !!a && a.key === cacheKey && !a.error;
}

const SYSTEM_PIPELINE = `당신은 기업 재무팀의 관리회계 담당자입니다. 월마감 후 CFO 보고를 준비합니다.
원칙:
- 제공된 데이터(금액·추세 판정·적요·거래처)에만 근거하여 작성. 데이터에 없는 사실은 추론 금지.
- 적요가 없으면 "적요 미기재, 담당 부서 확인 필요"를 명시.
- cause(원인)는 1~2문장으로 구체적 근거(적요/거래처/추세)를 인용.
- action(권고)은 실행 가능한 조치 1문장 (예: 수정예산 반영 검토, 요율 재협상, 담당 부서 소명 요청).
- draft(변동사유 초안)는 보고서 문체 2~3문장, 금액은 콤마 표기.
- summary는 4~6문장의 종합 브리핑: 총비용 흐름 → 예산 대비 → 핵심 원인 → 확인 필요 사항 순.
반드시 JSON만 출력.`;

interface PipelineResponse {
  summary: string;
  findings: AiAccountFinding[];
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
  const kpi = computeKpis(rows, budgets, period, version);
  const bva = bvaByAccount(rows, budgets, period, version);
  const changes = accountChanges(rows, period);
  const changeMap = new Map(changes.map(c => [c.account_name, c]));
  const bvaMap = new Map(bva.map(r => [r.account_name, r]));

  // 검토 대상 계정 컨텍스트 (토큰 통제: 최대 20계정, 적요 6개, 거래처 5개)
  const targets = pack.flaggedAccounts.slice(0, 20).map(acc => {
    const b = bvaMap.get(acc);
    const c = changeMap.get(acc);
    const ctx = accountContext(rows, period, acc);
    return {
      account: acc,
      actual: Math.round(b?.actual ?? c?.curr ?? 0),
      budget: b?.budget != null ? Math.round(b.budget) : null,
      exec_rate: b?.execRate != null ? +(b.execRate * 100).toFixed(1) : null,
      mom_diff: Math.round(c?.diff ?? 0),
      mom_rate: c?.rate != null ? +(c.rate * 100).toFixed(1) : null,
      memos: ctx.memos.slice(0, 6),
      vendors: ctx.vendors.slice(0, 5),
    };
  });

  const insightLines = pack.items.slice(0, 14).map(i => `[${i.category}/${i.severity}] ${i.title} — ${i.detail}`);
  const landingLines = pack.landing.slice(0, 6).map(l =>
    `${l.account_name}: 연간예산 ${fmtWon(l.annualBudget)} / 착지전망 ${fmtWon(l.projected)} (${fmtPct(l.ratio)})`);

  const prompt = [
    `# ${periodLabel(period)} 월마감 데이터 (예산버전: ${version ?? '없음'})`,
    `총비용 ${fmtWon(kpi.total)}원, 전월비 ${kpi.momRate != null ? fmtChange(kpi.momRate) : '-'}, 전년동월비 ${kpi.yoyRate != null ? fmtChange(kpi.yoyRate) : '-'}, 예산 집행률 ${kpi.execRate != null ? fmtPct(kpi.execRate) : '예산 없음'}, 예산 초과 ${kpi.overBudgetCount}개 계정`,
    pack.fixedShare != null ? `고정성 비용 비중 약 ${fmtPct(pack.fixedShare)}` : '',
    '',
    '## 규칙 엔진 검출 사항',
    ...insightLines,
    landingLines.length ? '\n## 연말 착지 전망 (초과 우려)' : '',
    ...landingLines,
    '',
    '## 검토 대상 계정 상세 (JSON)',
    JSON.stringify(targets),
    '',
    '## 출력 형식 (JSON만)',
    '{"summary": "4~6문장 종합 브리핑", "findings": [{"account_name": "계정명", "cause": "원인 추론", "action": "권고 액션", "draft": "변동사유 보고 초안 2~3문장"}]}',
    'findings는 검토 대상 계정 전체에 대해 각 1개씩 작성.',
  ].filter(Boolean).join('\n');

  try {
    const res = await geminiJSON<PipelineResponse>(prompt, {
      system: SYSTEM_PIPELINE,
      model: settings.gemini_model,
      maxTokens: 4096,
    });
    return {
      key: cacheKey,
      period,
      generated_at: new Date().toISOString(),
      summary: (res.summary || '').trim(),
      findings: Array.isArray(res.findings)
        ? res.findings.filter(f => f && f.account_name).map(f => ({
            account_name: String(f.account_name),
            cause: String(f.cause || '').trim(),
            action: String(f.action || '').trim(),
            draft: String(f.draft || '').trim(),
          }))
        : [],
    };
  } catch (e) {
    return {
      key: cacheKey,
      period,
      generated_at: new Date().toISOString(),
      summary: '',
      findings: [],
      error: e instanceof Error ? e.message : 'AI 분석 실패',
    };
  }
}

export function findingOf(analysis: MonthlyAnalysis | null | undefined, account: string): AiAccountFinding | undefined {
  return analysis?.findings.find(f => f.account_name === account);
}
