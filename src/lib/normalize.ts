/** 금액/일자/귀속월 정규화 유틸 — 회사마다 다른 엑셀 양식을 흡수하는 계층 */

export function parseAmount(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, '').replace(/원$/, '');
  if (s === '' || s === '-') return null;
  // 회계 관행 음수 표기: (1,234)
  const paren = s.match(/^\((\d+(?:\.\d+)?)\)$/);
  if (paren) return -parseFloat(paren[1]);
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** 엑셀 시리얼 넘버 → ISO 날짜 (1900 date system) */
export function excelSerialToISO(serial: number): string | null {
  if (serial < 20000 || serial > 60000) return null; // 1954~2064 범위만 인정
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function normalizeDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelSerialToISO(v);
  const s = String(v).trim();
  // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD
  let m = s.match(/^(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})일?/);
  if (m) {
    const [, y, mo, d] = m;
    const mm = mo.padStart(2, '0');
    const dd = d.padStart(2, '0');
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${y}-${mm}-${dd}`;
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function toPeriod(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** 귀속월 파싱: '2026-01' '2026/1' '202601' '2026.1' '2026년 1월' '1월'(연도 별도) 날짜 시리얼 */
export function parsePeriod(v: unknown, fallbackYear?: number): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const iso = excelSerialToISO(v);
    if (iso) return toPeriod(iso);
    // 202601 형태 숫자
    const s = String(Math.round(v));
    const m6 = s.match(/^(\d{4})(\d{2})$/);
    if (m6 && +m6[2] >= 1 && +m6[2] <= 12) return `${m6[1]}-${m6[2]}`;
    // 1~12 단독 (연도 필요)
    if (v >= 1 && v <= 12 && fallbackYear) return `${fallbackYear}-${String(v).padStart(2, '0')}`;
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[.\-/년\s]*(\d{1,2})월?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})월?$/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && fallbackYear) return `${fallbackYear}-${m[1].padStart(2, '0')}`;
  const iso = normalizeDate(s);
  if (iso) return toPeriod(iso);
  return null;
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-');
  return `${y}년 ${+m}월`;
}

export function prevPeriod(period: string, back = 1): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function sameMonthLastYear(period: string): string {
  const [y, m] = period.split('-');
  return `${+y - 1}-${m}`;
}
