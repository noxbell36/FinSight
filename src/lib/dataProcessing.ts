import type { RawRow, MappedRow, BudgetRecord } from '@/types/finance';
import { parseAmount, normalizeDate, parsePeriod, toPeriod } from '@/lib/normalize';

export interface ValidationIssue {
  row: number; // 1-based (헤더 제외)
  field: string;
  value: string;
  problem: string;
}

export interface MappingApplyResult<T> {
  records: T[];
  issues: ValidationIssue[];
  skipped: number;
  periods: string[];
}

const NUMERIC_KEYS = new Set(['curr_amount', 'net_amount', 'vat', 'gross_amount']);

/** 실적 매핑 적용 + 검증 리포트 생성 */
export function applyActualMapping(
  rawData: RawRow[],
  mapping: Record<string, string | null>,
  opts: { unit: 1 | 1000; periodMode: 'from_date' | 'fixed'; fixedPeriod?: string; datasetId: string },
): MappingApplyResult<MappedRow> {
  const records: MappedRow[] = [];
  const issues: ValidationIssue[] = [];
  let skipped = 0;
  const periodSet = new Set<string>();

  rawData.forEach((row, i) => {
    const mapped: MappedRow = { dataset_id: opts.datasetId, row_id: `${opts.datasetId}-${i}` };
    for (const [col, key] of Object.entries(mapping)) {
      if (!key) continue;
      const value = row[col];
      if (NUMERIC_KEYS.has(key)) {
        const n = parseAmount(value);
        if (n == null && value !== '' && value != null) {
          issues.push({ row: i + 1, field: key, value: String(value), problem: '금액 숫자 변환 실패' });
        }
        (mapped as Record<string, unknown>)[key] = n != null ? n * opts.unit : undefined;
      } else if (key === 'posting_date' || key === 'evidence_date') {
        const iso = normalizeDate(value);
        if (!iso && value !== '' && value != null) {
          issues.push({ row: i + 1, field: key, value: String(value), problem: '날짜 형식 인식 실패' });
        }
        (mapped as Record<string, unknown>)[key] = iso ?? undefined;
      } else if (key === 'period') {
        const p = parsePeriod(value);
        (mapped as Record<string, unknown>)[key] = p ?? undefined;
      } else {
        (mapped as Record<string, unknown>)[key] = value != null && value !== '' ? String(value).trim() : undefined;
      }
    }

    // 귀속월 결정: 명시 컬럼 > 전표일자 파생 > 고정 지정
    if (!mapped.period) {
      if (opts.periodMode === 'fixed' && opts.fixedPeriod) mapped.period = opts.fixedPeriod;
      else if (mapped.posting_date) mapped.period = toPeriod(mapped.posting_date);
    }

    // 필수 필드 검증
    const emptyRow = !mapped.account_name && mapped.curr_amount == null;
    if (emptyRow) { skipped++; return; }
    if (!mapped.account_name) issues.push({ row: i + 1, field: 'account_name', value: '', problem: '계정명 누락' });
    if (mapped.curr_amount == null) {
      // 금액 미지정 시 합계금액으로 보완
      if (mapped.gross_amount != null) mapped.curr_amount = mapped.gross_amount;
      else issues.push({ row: i + 1, field: 'curr_amount', value: '', problem: '금액 누락' });
    }
    if (!mapped.period) issues.push({ row: i + 1, field: 'period', value: String(row[findCol(mapping, 'posting_date') ?? ''] ?? ''), problem: '귀속월 결정 불가(전표일자 확인)' });
    else periodSet.add(mapped.period);

    records.push(mapped);
  });

  return { records, issues, skipped, periods: Array.from(periodSet).sort() };
}

function findCol(mapping: Record<string, string | null>, key: string): string | undefined {
  return Object.keys(mapping).find(c => mapping[c] === key);
}

/** 예산(세로형) 매핑 적용 */
export function applyBudgetLongMapping(
  rawData: RawRow[],
  mapping: Record<string, string | null>,
  opts: { unit: 1 | 1000; fallbackYear?: number; fixedVersion: string; datasetId: string },
): MappingApplyResult<BudgetRecord> {
  const records: BudgetRecord[] = [];
  const issues: ValidationIssue[] = [];
  let skipped = 0;
  const periodSet = new Set<string>();

  rawData.forEach((row, i) => {
    const get = (key: string) => { const c = findCol(mapping, key); return c ? row[c] : undefined; };
    const account = get('account_name');
    const amountRaw = get('amount');
    if ((account == null || account === '') && (amountRaw == null || amountRaw === '')) { skipped++; return; }

    const amount = parseAmount(amountRaw);
    const period = parsePeriod(get('period'), opts.fallbackYear);
    if (!account) { issues.push({ row: i + 1, field: 'account_name', value: '', problem: '계정명 누락' }); return; }
    if (amount == null) { issues.push({ row: i + 1, field: 'amount', value: String(amountRaw ?? ''), problem: '예산금액 변환 실패' }); return; }
    if (!period) { issues.push({ row: i + 1, field: 'period', value: String(get('period') ?? ''), problem: '귀속월 인식 실패' }); return; }

    periodSet.add(period);
    const versionCell = get('version');
    records.push({
      dataset_id: opts.datasetId,
      account_name: String(account).trim(),
      account_code: get('account_code') ? String(get('account_code')).trim() : undefined,
      cost_center: get('cost_center') ? String(get('cost_center')).trim() : undefined,
      period,
      amount: amount * opts.unit,
      version: versionCell ? String(versionCell).trim() : opts.fixedVersion,
    });
  });

  return { records, issues, skipped, periods: Array.from(periodSet).sort() };
}

/** 예산(가로형: 행=계정, 열=1월..12월) 매핑 적용 */
export function applyBudgetWideMapping(
  rawData: RawRow[],
  accountCol: string,
  monthCols: Record<string, string>, // 헤더 -> YYYY-MM
  opts: { unit: 1 | 1000; codeCol?: string; ccCol?: string; fixedVersion: string; datasetId: string },
): MappingApplyResult<BudgetRecord> {
  const records: BudgetRecord[] = [];
  const issues: ValidationIssue[] = [];
  let skipped = 0;
  const periodSet = new Set<string>();

  rawData.forEach((row, i) => {
    const account = row[accountCol];
    if (account == null || String(account).trim() === '') { skipped++; return; }
    for (const [col, period] of Object.entries(monthCols)) {
      const raw = row[col];
      if (raw == null || raw === '') continue;
      const amount = parseAmount(raw);
      if (amount == null) {
        issues.push({ row: i + 1, field: period, value: String(raw), problem: '예산금액 변환 실패' });
        continue;
      }
      periodSet.add(period);
      records.push({
        dataset_id: opts.datasetId,
        account_name: String(account).trim(),
        account_code: opts.codeCol && row[opts.codeCol] != null ? String(row[opts.codeCol]).trim() : undefined,
        cost_center: opts.ccCol && row[opts.ccCol] != null ? String(row[opts.ccCol]).trim() : undefined,
        period,
        amount: amount * opts.unit,
        version: opts.fixedVersion,
      });
    }
  });

  return { records, issues, skipped, periods: Array.from(periodSet).sort() };
}

/** VAT 검증: 공급가액 + 부가세 ≠ 합계금액 */
export interface VATError {
  row: MappedRow;
  expected: number;
  difference: number;
}
export function checkVATErrors(data: MappedRow[], tolerance = 1): VATError[] {
  const errors: VATError[] = [];
  for (const row of data) {
    if (row.net_amount != null && row.vat != null && row.gross_amount != null) {
      const expected = row.net_amount + row.vat;
      if (Math.abs(expected - row.gross_amount) > tolerance) {
        errors.push({ row, expected, difference: expected - row.gross_amount });
      }
    }
  }
  return errors;
}
