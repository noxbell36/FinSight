import { useMemo, useState } from 'react';
import type { MappedRow, BudgetRecord, CommentaryEntry, MonthlyAnalysis } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { runReviewChecks, reviewKey } from '@/lib/reviewChecks';
import { periodLabel } from '@/lib/normalize';
import { MonthSelect, PageHeader, KpiCard } from '@/components/shared';
import VarianceView from '@/views/VarianceView';
import VoucherReview from '@/views/VoucherReview';
import type { AnalysisStatus } from '@/lib/aiPipeline';

interface Props {
  rows: MappedRow[];
  budgets: BudgetRecord[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
  version: string | null;
  settings: AppSettings;
  commentary: CommentaryEntry[];
  upsertCommentary: (entry: CommentaryEntry) => void;
  reviews: Record<string, 'done' | 'flagged'>;
  setReviewStatus: (key: string, status: 'done' | 'flagged' | null) => void;
  pack: MonthlyInsightPack | null;
  analysis: MonthlyAnalysis | null;
  analysisStatus: AnalysisStatus;
  cooldownLeft: number;
}

/** 마감 검토 — "마감 전 처리할 일". 변동사유 확정 + 전표 검토를 한 워크플로로. */
export default function ClosingView(props: Props) {
  const { rows, periods, period, setPeriod, settings, commentary, reviews, pack } = props;
  const [section, setSection] = useState<'variance' | 'voucher'>('variance');

  // 진행률 계산
  const varianceTargets = pack?.flaggedAccounts.length ?? 0;
  const varianceConfirmed = useMemo(
    () => (pack?.flaggedAccounts ?? []).filter(acc =>
      commentary.find(c => c.id === `${period}:${acc}` && c.status === 'confirmed')).length,
    [pack, commentary, period],
  );
  const checks = useMemo(() => runReviewChecks(rows, period, settings), [rows, period, settings]);
  const voucherTotal = checks.reduce((s, c) => s + c.hits.length, 0);
  const voucherDone = checks.reduce((s, c) => s + c.hits.filter(h => reviews[reviewKey(c.id, h.row)]).length, 0);
  const flagged = checks.reduce((s, c) => s + c.hits.filter(h => reviews[reviewKey(c.id, h.row)] === 'flagged').length, 0);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="마감 검토"
        desc={`${periodLabel(period)} · 변동사유 확정과 전표 점검을 마치면 월간 리포트가 완성됩니다`}
        right={<MonthSelect periods={periods} value={period} onChange={setPeriod} />}
      />

      {/* 진행 현황 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="변동사유 확정" value={`${varianceConfirmed} / ${varianceTargets}`}
          sub={varianceTargets > 0 ? `${Math.round((varianceConfirmed / varianceTargets) * 100)}% 완료` : '대상 없음'}
          subClass={varianceConfirmed === varianceTargets && varianceTargets > 0 ? 'text-primary' : undefined} />
        <KpiCard label="전표 검토 처리" value={`${voucherDone} / ${voucherTotal}`}
          sub={voucherTotal > 0 ? `${Math.round((voucherDone / voucherTotal) * 100)}% 처리` : '검출 없음'}
          subClass={voucherDone === voucherTotal && voucherTotal > 0 ? 'text-primary' : undefined} />
        <KpiCard label="소명 필요" value={`${flagged}건`} sub="담당 부서 회신 대기" subClass={flagged > 0 ? 'text-destructive' : undefined} />
        <KpiCard label="마감 상태"
          value={varianceConfirmed >= varianceTargets && voucherDone >= voucherTotal ? '완료 가능' : '진행 중'}
          sub={varianceConfirmed >= varianceTargets && voucherDone >= voucherTotal ? '월간 리포트 확인' : '미처리 항목 확인'} />
      </div>

      {/* 섹션 전환 */}
      <div className="flex rounded-md border border-border overflow-hidden text-sm w-fit mb-4">
        <button onClick={() => setSection('variance')}
          className={`px-4 py-1.5 ${section === 'variance' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
          변동사유 ({varianceConfirmed}/{varianceTargets})
        </button>
        <button onClick={() => setSection('voucher')}
          className={`px-4 py-1.5 ${section === 'voucher' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
          전표·경비 검토 ({voucherDone}/{voucherTotal})
        </button>
      </div>

      {section === 'variance' ? (
        <VarianceView {...props} embedded />
      ) : (
        <VoucherReview rows={rows} periods={periods} period={period} setPeriod={setPeriod}
          settings={settings} reviews={reviews} setReviewStatus={props.setReviewStatus} embedded />
      )}
    </div>
  );
}
