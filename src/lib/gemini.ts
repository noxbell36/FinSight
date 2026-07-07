/**
 * Google Gemini API 직접 호출 (서버 없음).
 * API 키는 사용자가 환경 설정에서 직접 입력하며 localStorage에만 저장된다.
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

/** ── 429 전역 쿨다운: 한도 초과 시 일정 시간 모든 자동 호출 중단 ── */
const COOLDOWN_STORAGE = 'finpilot-gemini-cooldown-until';
const COOLDOWN_SECONDS = 75;

export function setGeminiCooldown(seconds = COOLDOWN_SECONDS) {
  try { localStorage.setItem(COOLDOWN_STORAGE, String(Date.now() + seconds * 1000)); } catch { /* noop */ }
}

/** 남은 쿨다운(초). 0이면 호출 가능 */
export function geminiCooldownRemaining(): number {
  try {
    const until = parseInt(localStorage.getItem(COOLDOWN_STORAGE) || '0', 10);
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  } catch { return 0; }
}

interface GenOpts {
  system?: string;
  model: string;
  maxTokens?: number;
  json?: boolean; // responseMimeType: application/json
}

export async function geminiGenerate(prompt: string, opts: GenOpts): Promise<string> {
  const key = getGeminiKey();
  if (!key) throw new Error('Gemini API 키가 설정되지 않았습니다. 환경 설정에서 입력해주세요.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${encodeURIComponent(key)}`;
  const generationConfig: Record<string, unknown> = {
    temperature: 0.3,
    maxOutputTokens: opts.maxTokens ?? 2048,
    // 2.5 계열의 내부 추론(thinking)이 출력 토큰을 소진해 응답이 잘리는 문제 방지
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (opts.json) generationConfig.responseMimeType = 'application/json';

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // 실제 원인 메시지를 그대로 노출 (키/모델/한도 구분 가능하게)
    let apiMsg = '';
    try {
      const err = await res.json();
      apiMsg = err?.error?.message || '';
    } catch { /* noop */ }
    if (res.status === 429) { setGeminiCooldown(); throw new Error(`요청 한도 초과(429). 무료 등급은 분당 호출 제한이 있습니다 — 잠시 후 자동 재시도됩니다.${apiMsg ? ` (${apiMsg.slice(0, 120)})` : ''}`); }
    if (res.status === 404) throw new Error(`모델을 찾을 수 없습니다(404). 환경 설정의 모델명을 확인해주세요.${apiMsg ? ` (${apiMsg.slice(0, 120)})` : ''}`);
    if (res.status === 400 || res.status === 403) throw new Error(`요청 거부(${res.status}) — ${apiMsg ? apiMsg.slice(0, 160) : 'API 키 또는 요청 형식을 확인해주세요.'}`);
    throw new Error(`Gemini API 오류 (HTTP ${res.status})${apiMsg ? ` — ${apiMsg.slice(0, 120)}` : ''}`);
  }

  const data = await res.json();
  const finish = data?.candidates?.[0]?.finishReason;
  const text: string = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text || '')
    .join('') || '';
  if (!text) {
    if (finish === 'MAX_TOKENS') throw new Error('응답이 토큰 한도로 잘렸습니다. 다시 시도해주세요.');
    if (finish === 'SAFETY') throw new Error('안전 필터로 응답이 차단되었습니다.');
    throw new Error('AI 응답이 비어 있습니다. 다시 시도해주세요.');
  }
  return text.trim();
}

/** JSON 응답 전용 — 코드펜스/서두 텍스트가 섞여도 첫 { ~ 마지막 } 만 추출해 파싱 */
export async function geminiJSON<T>(prompt: string, opts: Omit<GenOpts, 'json'>): Promise<T> {
  const raw = await geminiGenerate(prompt, { ...opts, json: true });
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('AI 응답에서 JSON을 찾지 못했습니다. 다시 시도해주세요.');
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    throw new Error('AI 응답 JSON 해석에 실패했습니다. 다시 시도해주세요.');
  }
}
