import type { MappedRow, MatchConfidence } from '@/types/finance';

export interface FieldDef {
  key: string;
  label: string;
  aliases: string[];
  required?: boolean;
  kind: 'text' | 'number' | 'date' | 'period';
}

/** 실적(전표) 표준 필드 — 별칭 중복 제거 완료 (합계금액은 gross_amount 전용) */
export const ACTUAL_FIELDS: FieldDef[] = [
  { key: 'posting_date', label: '전표일자', kind: 'date', required: true, aliases: ['전표일자', '전표일', '일자', '날짜', '회계일자', 'date', 'posting date', 'gl date'] },
  { key: 'account_name', label: '계정명', kind: 'text', required: true, aliases: ['계정명', '계정과목', '계정과목명', 'account', 'account name', 'gl name'] },
  { key: 'account_code', label: '계정코드', kind: 'text', aliases: ['계정코드', '계정과목코드', 'gl', 'gl code', 'account code'] },
  { key: 'curr_amount', label: '금액(발생액)', kind: 'number', required: true, aliases: ['금액', '발생액', '당월', '당월금액', 'amount', 'current'] },
  { key: 'cost_center', label: '부서(코스트센터)', kind: 'text', aliases: ['부서', '부서명', '코스트센터', '부서(코스트센터)', 'cc', 'cost center', '팀'] },
  { key: 'net_amount', label: '공급가액', kind: 'number', aliases: ['공급가액', '공급가', 'net', 'net amount'] },
  { key: 'vat', label: '부가세', kind: 'number', aliases: ['부가세', '부가세액', '세액', 'vat'] },
  { key: 'gross_amount', label: '합계금액(공급대가)', kind: 'number', aliases: ['합계금액', '공급대가', '총액', '합계', 'gross', 'gross amount'] },
  { key: 'vendor', label: '거래처명', kind: 'text', aliases: ['거래처', '거래처명', '업체', '업체명', 'vendor', 'vendor name'] },
  { key: 'memo', label: '적요', kind: 'text', aliases: ['적요', '적요내용', '내용', '비고', 'memo', 'description'] },
  { key: 'voucher_code', label: '전표코드', kind: 'text', aliases: ['전표코드', 'voucher code', 'slip code'] },
  { key: 'voucher_number', label: '전표번호', kind: 'text', aliases: ['전표번호', 'voucher number', 'slip no', 'slip number'] },
  { key: 'line_number', label: '라인', kind: 'text', aliases: ['라인', '행번호', 'line', 'line number'] },
  { key: 'evidence_date', label: '증빙일자', kind: 'date', aliases: ['증빙일자', '증빙일', 'evidence date'] },
  { key: 'business_reg_number', label: '사업자등록번호', kind: 'text', aliases: ['사업자등록번호', '사업자번호', 'biz reg no'] },
  { key: 'evidence_type', label: '증빙유형', kind: 'text', aliases: ['증빙유형', '증빙종류', '증빙', 'evidence type'] },
  { key: 'tax_code', label: '세금코드', kind: 'text', aliases: ['세금코드', '세금구분', '과세구분', 'tax code'] },
  { key: 'period', label: '귀속월', kind: 'period', aliases: ['귀속월', '귀속연월', '회계월', '월', 'period', 'month'] },
];

/** 예산 표준 필드 (세로형 기준; 가로형은 월 컬럼 자동 인식) */
export const BUDGET_FIELDS: FieldDef[] = [
  { key: 'account_name', label: '계정명', kind: 'text', required: true, aliases: ['계정명', '계정과목', '계정과목명', 'account', 'account name'] },
  { key: 'account_code', label: '계정코드', kind: 'text', aliases: ['계정코드', 'gl code', 'account code'] },
  { key: 'cost_center', label: '부서(코스트센터)', kind: 'text', aliases: ['부서', '부서명', '코스트센터', 'cc', 'cost center'] },
  { key: 'period', label: '귀속월', kind: 'period', required: true, aliases: ['귀속월', '귀속연월', '월', '예산월', 'period', 'month'] },
  { key: 'amount', label: '예산금액', kind: 'number', required: true, aliases: ['예산', '예산액', '예산금액', '월예산', 'budget', 'amount'] },
  { key: 'version', label: '예산버전', kind: 'text', aliases: ['버전', '예산버전', '예산구분', 'version'] },
];

export function normalizeHeader(h: string): string {
  return String(h).toLowerCase().replace(/[\s()\[\]_\-./·]/g, '');
}

export function headerSignature(headers: string[]): string {
  return headers.map(normalizeHeader).filter(Boolean).sort().join('|');
}

export interface AutoMapResult {
  mapping: Record<string, string | null>;
  confidence: Record<string, MatchConfidence>;
}

/**
 * 자동 매핑: ① 정규화 완전일치 → high ② 별칭 포함일치 → medium.
 * 동일 표준 필드에 두 컬럼이 걸리면 먼저(높은 신뢰도) 매칭된 컬럼만 유지.
 */
export function autoMapColumns(headers: string[], fields: FieldDef[]): AutoMapResult {
  const mapping: Record<string, string | null> = {};
  const confidence: Record<string, MatchConfidence> = {};
  const used = new Map<string, MatchConfidence>(); // fieldKey -> best confidence taken

  const tryAssign = (header: string, fieldKey: string, conf: MatchConfidence) => {
    const taken = used.get(fieldKey);
    if (taken === 'high') return false;
    if (taken === 'medium' && conf !== 'high') return false;
    // 기존 medium 배정 해제
    if (taken) {
      for (const h of Object.keys(mapping)) {
        if (mapping[h] === fieldKey) { mapping[h] = null; confidence[h] = 'none'; }
      }
    }
    mapping[header] = fieldKey;
    confidence[header] = conf;
    used.set(fieldKey, conf);
    return true;
  };

  // 1차: 완전일치
  for (const header of headers) {
    const nh = normalizeHeader(header);
    mapping[header] = null;
    confidence[header] = 'none';
    for (const f of fields) {
      if (f.aliases.some(a => normalizeHeader(a) === nh)) {
        tryAssign(header, f.key, 'high');
        break;
      }
    }
  }
  // 2차: 포함일치 (긴 별칭 우선 — '부서명'이 '부서'보다 먼저 검사되도록)
  for (const header of headers) {
    if (mapping[header]) continue;
    const nh = normalizeHeader(header);
    if (!nh) continue;
    let best: { key: string; len: number } | null = null;
    for (const f of fields) {
      for (const a of f.aliases) {
        const na = normalizeHeader(a);
        if (na.length >= 2 && (nh.includes(na) || na.includes(nh))) {
          if (!best || na.length > best.len) best = { key: f.key, len: na.length };
        }
      }
    }
    if (best) tryAssign(header, best.key, 'medium');
  }

  return { mapping, confidence };
}

/** 가로형 예산: 헤더 중 월로 해석되는 컬럼 탐지 */
export function detectMonthColumns(headers: string[], fallbackYear?: number): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    const p = parseHeaderAsPeriod(h, fallbackYear);
    if (p) result[h] = p;
  }
  return result;
}

function parseHeaderAsPeriod(h: string, fallbackYear?: number): string | null {
  const s = String(h).trim();
  let m = s.match(/^(\d{4})[.\-/년\s]*(\d{1,2})월?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})월$/);
  if (m && fallbackYear) return `${fallbackYear}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`;
  return null;
}

/** 헤더 행 자동 감지: 앞 10행 중 비어있지 않은 셀이 가장 많은 행 (3개 이상) */
export function detectHeaderRow(rows: unknown[][]): number {
  let bestIdx = 0;
  let bestCount = 0;
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const count = (rows[i] || []).filter(c => c != null && String(c).trim() !== '').length;
    if (count > bestCount) { bestCount = count; bestIdx = i; }
  }
  return bestCount >= 3 ? bestIdx : 0;
}

export function getFieldDef(fields: FieldDef[], key: string | null): FieldDef | undefined {
  return key ? fields.find(f => f.key === key) : undefined;
}

export type { MappedRow };
