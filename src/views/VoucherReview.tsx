import { useMemo, useState } from 'react';
import { AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight } from 'lucide-react';
import type { MappedRow } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import { runReviewChecks, reviewKey } from '@/lib/reviewChecks';
import { fmtWon } from '@/lib/format';
import { periodLabel } from '@/lib/normalize';
import { MonthSelect, PageHeader, KpiCard } from '@/components/shared';

interface Props {
  rows: MappedRow[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
  settings: AppSettings;
  reviews: Record<string, 'done' | 'flagged'>;
  setReviewStatus: (key: string, status: 'done' | 'flagged' | null) => void;
}

const sevIcon = {
  danger: <AlertCircle className="h-4 w-4 text-destructive" />,
  warning: <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />,
  info: <Info className="h-4 w-4 text-muted-foreground" />,
};

export default function VoucherReview({ rows, periods, period, setPeriod, settings, reviews, setReviewStatus }: Props) {
  const checks = useMemo(() => runReviewChecks(rows, period, settings), [rows, period, settings]);
  const [open, setOpen] = useState<string | null>(checks.find(c => c.hits.length > 0)?.id ?? null);

  const totalHits = checks.reduce((s, c) => s + c.hits.length, 0);
  const doneCount = checks.reduce((s, c) => s + c.hits.filter(h => reviews[reviewKey(c.id, h.row)] === 'done').length, 0);
  const flaggedCount = checks.reduce((s, c) => s + c.hits.filter(h => reviews[reviewKey(c.id, h.row)] === 'flagged').length, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="전표 · 경비 검토"
        desc={`${periodLabel(period)} 마감 전 점검 — 법인카드·개인경비·전표 이상 항목`}
        right={<MonthSelect periods={periods} value={period} onChange={setPeriod} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="검출 항목" value={`${totalHits}건`} sub={`검사 규칙 ${checks.length}종`} />
        <KpiCard label="검토 완료" value={`${doneCount}건`} subClass="text-primary" sub={totalHits > 0 ? `${Math.round((doneCount / totalHits) * 100)}% 처리` : undefined} />
        <KpiCard label="소명 필요" value={`${flaggedCount}건`} subClass={flaggedCount > 0 ? 'text-destructive' : undefined} sub="담당 부서 확인 요청" />
        <KpiCard label="미처리" value={`${totalHits - doneCount - flaggedCount}건`} />
      </div>

      <div className="space-y-2.5">
        {checks.map(check => {
          const isOpen = open === check.id;
          const pending = check.hits.filter(h => !reviews[reviewKey(check.id, h.row)]).length;
          return (
            <div key={check.id} className="panel overflow-hidden">
              <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40" onClick={() => setOpen(isOpen ? null : check.id)}>
                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                {sevIcon[check.severity]}
                <span className="font-medium">{check.label}</span>
                <span className="text-xs text-muted-foreground flex-1">{check.description}</span>
                <span className={`num text-sm ${check.hits.length > 0 ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {check.hits.length}건{pending > 0 && <span className="text-xs text-muted-foreground ml-1">(미처리 {pending})</span>}
                </span>
              </button>

              {isOpen && check.hits.length > 0 && (
                <div className="border-t border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary">
                      <tr className="text-xs text-muted-foreground">
                        <th className="px-4 py-2 text-left font-medium">전표일자</th>
                        <th className="px-4 py-2 text-left font-medium">전표번호</th>
                        <th className="px-4 py-2 text-left font-medium">계정 / 부서</th>
                        <th className="px-4 py-2 text-left font-medium">거래처</th>
                        <th className="px-4 py-2 text-right font-medium">금액</th>
                        <th className="px-4 py-2 text-left font-medium">검출 내용</th>
                        <th className="px-4 py-2 text-center font-medium w-44">처리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {check.hits.map((hit, i) => {
                        const key = reviewKey(check.id, hit.row);
                        const status = reviews[key];
                        return (
                          <tr key={hit.row.row_id ?? i} className={`border-t border-border ${status === 'done' ? 'opacity-50' : ''}`}>
                            <td className="px-4 py-2 num text-xs">{hit.row.posting_date ?? '-'}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{hit.row.voucher_number ?? '-'}</td>
                            <td className="px-4 py-2 text-xs">{hit.row.account_name}<span className="text-muted-foreground"> / {hit.row.cost_center ?? '-'}</span></td>
                            <td className="px-4 py-2 text-xs">{hit.row.vendor ?? '-'}</td>
                            <td className="px-4 py-2 text-right num">{fmtWon(hit.row.gross_amount ?? hit.row.curr_amount)}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{hit.detail}{hit.row.memo ? '' : check.id !== 'memo' ? ' · 적요 없음' : ''}</td>
                            <td className="px-4 py-2">
                              <div className="flex justify-center gap-1.5">
                                <button
                                  onClick={() => setReviewStatus(key, status === 'done' ? null : 'done')}
                                  className={`text-[11px] px-2 py-1 rounded border ${status === 'done' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
                                >검토 완료</button>
                                <button
                                  onClick={() => setReviewStatus(key, status === 'flagged' ? null : 'flagged')}
                                  className={`text-[11px] px-2 py-1 rounded border ${status === 'flagged' ? 'bg-destructive text-destructive-foreground border-destructive' : 'border-border hover:bg-muted'}`}
                                >소명 필요</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {isOpen && check.hits.length === 0 && (
                <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">검출된 항목이 없습니다.</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        판정 기준(건당 고액 금액, 중복 판정 기간, VAT 허용오차)은 환경 설정에서 조정할 수 있습니다. 검출 항목은 오류 확정이 아닌 "확인 필요" 목록입니다.
      </p>
    </div>
  );
}
