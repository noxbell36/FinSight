/**
 * Google Gemini API 직접 호출 (서버 없음).
 * API 키는 사용자가 환경 설정에서 직접 입력하며 localStorage에만 저장된다.
 * 키는 코드·저장소에 절대 포함하지 않는다.
 */
const KEY_STORAGE = 'finpilot-gemini-key';

export function getGeminiKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}

export function setGeminiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* noop */ }
}

export function hasGeminiKey(): boolean {
  return getGeminiKey().length > 0;
}

export async function geminiGenerate(prompt: string, opts: { system?: string; model: string; maxTokens?: number }): Promise<string> {
  const key = getGeminiKey();
  if (!key) throw new Error('Gemini API 키가 설정되지 않았습니다. 환경 설정에서 입력해주세요.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${encodeURIComponent(key)}`;
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: opts.maxTokens ?? 1024 },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 403) throw new Error('API 키가 유효하지 않습니다. 키를 확인해주세요.');
    if (res.status === 429) throw new Error('요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.');
    throw new Error(`Gemini API 오류 (HTTP ${res.status})`);
  }

  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text || '')
    .join('') || '';
  if (!text) throw new Error('AI 응답이 비어 있습니다.');
  return text.trim();
}

/** JSON 응답 전용 (매핑 제안 등) */
export async function geminiJSON<T>(prompt: string, opts: { system?: string; model: string; maxTokens?: number }): Promise<T> {
  const raw = await geminiGenerate(prompt + '\n\n반드시 JSON만 출력하십시오. 마크다운 코드펜스·설명 금지.', opts);
  const cleaned = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
  return JSON.parse(cleaned) as T;
}

export const SYSTEM_VARIANCE = `당신은 기업 재무팀의 관리회계 담당자입니다.
월마감 후 비용 변동사유 보고 초안을 작성합니다.
원칙:
- 제공된 데이터(금액, 적요, 거래처)에 근거해서만 작성. 데이터에 없는 내용은 추론 금지.
- 적요가 없으면 "적요 미기재, 담당 부서 확인 필요"라고 명시.
- 2~3문장, 보고서 문체(개조식 지양, 간결한 서술).
- 금액은 원 단위 콤마 표기.`;

export const SYSTEM_REPORT = `당신은 CFO에게 보고하는 관리회계 담당자입니다.
주어진 월간 실적·예산 대비 데이터와 확정된 변동사유를 바탕으로 4~6문장의 종합 코멘트를 작성합니다.
데이터에 없는 내용은 언급하지 말고, 확정 사유가 없는 항목은 "사유 확인 중"으로 표기하십시오.`;
