import type { MappedRow } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import { checkVATErrors } from '@/lib/dataProcessing';

export interface ReviewHit {
  row: MappedRow;
  detail: string;
}

export interface ReviewCheck {
  id: string;
  label: string;
  description: string;
  severity: 'danger' | 'warning' | 'info';
  hits: ReviewHit[];
}

const amt = (r: MappedRow) => r.gross_amount ?? r.curr_amount ?? 0;

export function runReviewChecks(rows: MappedRow[], period: string | null, settings: AppSettings): ReviewCheck[] {
  const target = period ? rows.filter(r => r.period === period) : rows;

  // 1) VAT 불일치
  const vat = checkVATErrors(target, settings.vat_tolerance);
  const vatCheck: ReviewCheck = {
    id: 'vat', label: 'VAT 불일치', severity: 'danger',
    description: '공급가액+부가세와 합계금액이 일치하지 않는 전표',
    hits: vat.map(e => ({ row: e.row, detail: `기대값 ${e.expected.toLocaleString()} 대비 차이 ${e.difference.toLocaleString()}원` })),
  };

  // 2) 적요 미기재
  const memoCheck: ReviewCheck = {
    id: 'memo', label: '적요 미기재', severity: 'warning',
    description: '적요가 비어 있어 발생 사유 확인이 필요한 전표',
    hits: target.filter(r => !r.memo || !r.memo.trim()).map(row => ({ row, detail: '적요 없음' })),
  };

  // 3) 증빙유형 누락
  const evidenceCheck: ReviewCheck = {
    id: 'evidence', label: '증빙유형 누락', severity: 'warning',
    description: '증빙유형이 입력되지 않은 전표 (증빙 수취 여부 확인)',
    hits: target.filter(r => r.evidence_type !== undefined ? !String(r.evidence_type).trim() : false)
      .map(row => ({ row, detail: '증빙유형 미입력' })),
  };

  // 4) 주말·공휴일 전표 (주말만 판정)
  const weekendCheck: ReviewCheck = {
    id: 'weekend', label: '주말 일자 전표', severity: 'info',
    description: '전표일자가 토·일요일인 건 (실제 발생일 확인)',
    hits: target.filter(r => {
      if (!r.posting_date) return false;
      const d = new Date(r.posting_date + 'T00:00:00');
      const day = d.getDay();
      return day === 0 || day === 6;
    }).map(row => ({ row, detail: new Date(row.posting_date + 'T00:00:00').getDay() === 0 ? '일요일' : '토요일' })),
  };

  // 5) 건당 고액
  const highCheck: ReviewCheck = {
    id: 'high', label: `건당 고액 (≥ ${settings.high_amount_threshold.toLocaleString()}원)`, severity: 'info',
    description: '설정 기준 이상 단일 건 지출 (승인 절차 확인)',
    hits: target.filter(r => amt(r) >= settings.high_amount_threshold)
      .map(row => ({ row, detail: `${amt(row).toLocaleString()}원` })),
  };

  // 6) 중복 결제 의심: 동일 거래처 + 동일 금액 + N일 이내
  const dupCheck: ReviewCheck = {
    id: 'dup', label: '중복 결제 의심', severity: 'danger',
    description: `동일 거래처·동일 금액 전표가 ${settings.duplicate_window_days}일 이내 반복 발생`,
    hits: [],
  };
  const groups = new Map<string, MappedRow[]>();
  for (const r of target) {
    if (!r.vendor || !r.posting_date) continue;
    const key = `${r.vendor}|${amt(r)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => (a.posting_date || '').localeCompare(b.posting_date || ''));
    for (let i = 1; i < sorted.length; i++) {
      const d1 = new Date(sorted[i - 1].posting_date + 'T00:00:00');
      const d2 = new Date(sorted[i].posting_date + 'T00:00:00');
      const days = (d2.getTime() - d1.getTime()) / 86400000;
      if (days <= settings.duplicate_window_days) {
        dupCheck.hits.push({ row: sorted[i - 1], detail: `${sorted[i].posting_date}건과 동일 (${amt(sorted[i]).toLocaleString()}원)` });
        dupCheck.hits.push({ row: sorted[i], detail: `${sorted[i - 1].posting_date}건과 동일 (${amt(sorted[i]).toLocaleString()}원)` });
      }
    }
  }

  // 7) 분할 결제 의심: 동일일 + 동일 거래처 3건 이상
  const splitCheck: ReviewCheck = {
    id: 'split', label: '분할 결제 의심', severity: 'warning',
    description: '같은 날 같은 거래처에 3건 이상 결제 (한도 회피 여부 확인)',
    hits: [],
  };
  const dayGroups = new Map<string, MappedRow[]>();
  for (const r of target) {
    if (!r.vendor || !r.posting_date) continue;
    const key = `${r.posting_date}|${r.vendor}`;
    if (!dayGroups.has(key)) dayGroups.set(key, []);
    dayGroups.get(key)!.push(r);
  }
  for (const [key, g] of dayGroups) {
    if (g.length >= 3) {
      const sum = g.reduce((s, r) => s + amt(r), 0);
      for (const row of g) splitCheck.hits.push({ row, detail: `동일일 ${g.length}건, 합계 ${sum.toLocaleString()}원 (${key.split('|')[1]})` });
    }
  }

  // 중복 제거 (같은 행이 dup에 두 번 들어갈 수 있음)
  dupCheck.hits = dedupeByRow(dupCheck.hits);

  return [vatCheck, dupCheck, splitCheck, memoCheck, evidenceCheck, highCheck, weekendCheck];
}

function dedupeByRow(hits: ReviewHit[]): ReviewHit[] {
  const seen = new Set<string>();
  return hits.filter(h => {
    const id = h.row.row_id || JSON.stringify(h.row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function reviewKey(checkId: string, row: MappedRow): string {
  return `${checkId}:${row.row_id}`;
}
