/** 재무 표기 관행: 표에는 전체 자릿수+콤마, 음수는 (괄호), KPI에만 억/만 축약 */

export function fmtWon(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '-';
  const abs = Math.round(Math.abs(n)).toLocaleString('ko-KR');
  return n < 0 ? `(${abs})` : abs;
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '-';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)}억`;
  if (abs >= 10000) return `${sign}${Math.round(abs / 10000).toLocaleString('ko-KR')}만`;
  return `${sign}${Math.round(abs).toLocaleString('ko-KR')}`;
}

export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || isNaN(ratio) || !isFinite(ratio)) return '-';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 증감률 표기: +12.3% / △12.3% (재무 관행상 감소는 △) */
export function fmtChange(ratio: number | null | undefined): string {
  if (ratio == null || isNaN(ratio) || !isFinite(ratio)) return '-';
  const pct = (Math.abs(ratio) * 100).toFixed(1);
  return ratio >= 0 ? `+${pct}%` : `△${pct}%`;
}

export function numClass(n: number | null | undefined): string {
  return n != null && n < 0 ? 'num num-neg' : 'num';
}
