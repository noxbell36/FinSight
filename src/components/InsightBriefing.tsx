import { useState } from 'react';
import { Loader2, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MonthlyAnalysis } from '@/types/finance';
import type { InsightItem } from '@/lib/insightEngine';
import { findingOf } from '@/lib/aiPipeline';

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error' | 'no-key';

const dot: Record<InsightItem['severity'], string> = {
  danger: 'bg-destructive',
  warning: 'bg-[hsl(var(--warning))]',
  info: 'bg-muted-foreground/50',
  good: 'bg-primary',
};

interface Props {
  items: InsightItem[];
  analysis: MonthlyAnalysis | null;
  status: AnalysisStatus;
  onRetry?: () => void;
  maxItems?: number; // 우선 노출 개수 (danger/warning 우선), 나머지는 접힘
}

/** 월간 요약: 종합 코멘트 + 검출 항목 (절제된 스타일, 심각 항목 우선) */
export default function InsightBriefing({ items, analysis, status, onRetry, maxItems = 6 }: Props) {
  const [showAll, setShowAll] = useState(false);
  const primary = items.filter(i => i.severity === 'danger' || i.severity === 'warning');
  const secondary = items.filter(i => i.severity === 'info' || i.severity === 'good');
  const visible = showAll ? items : primary.slice(0, maxItems);
  const hiddenCount = items.length - visible.length;

  return (
    <div className="space-y-3 mb-5">
      {/* 종합 코멘트 */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <h2 className="text-sm font-semibold">월간 요약</h2>
          {status === 'running' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> 초안 작성 중</span>
          )}
          {status === 'done' && analysis && (
            <span className="text-[11px] text-muted-foreground ml-auto">자동 작성 초안 · 검토 후 사용 · {new Date(analysis.generated_at).toLocaleString('ko-KR')}</span>
          )}
        </div>
        {status === 'no-key' && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            환경 설정에서 Gemini API 키를 입력하면 월 선택 시 종합 코멘트·사유 후보·변동사유 초안이 자동 작성됩니다. 아래 검출 항목은 규칙 기반으로 계산된 결과입니다.
          </p>
        )}
        {status === 'error' && (
          <div className="flex items-start gap-3">
            <p className="text-sm text-destructive flex-1 leading-relaxed">{analysis?.error || '분석에 실패했습니다.'}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5 shrink-0">
                <RotateCcw className="h-3.5 w-3.5" /> 다시 시도
              </Button>
            )}
          </div>
        )}
        {status === 'running' && !analysis?.summary && (
          <p className="text-sm text-muted-foreground">데이터를 근거로 종합 코멘트를 작성하고 있습니다…</p>
        )}
        {analysis?.summary && status === 'done' && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{analysis.summary}</p>
        )}
      </div>

      {/* 검출 항목 — 심각/경보 우선, 참고 항목은 접힘 */}
      {items.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">확인 필요 항목 <span className="text-muted-foreground font-normal">({primary.length}건 · 참고 {secondary.length}건)</span></h3>
            {hiddenCount > 0 && !showAll && (
              <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5" onClick={() => setShowAll(true)}>
                전체 보기 <ChevronDown className="h-3 w-3" />
              </button>
            )}
            {showAll && (
              <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5" onClick={() => setShowAll(false)}>
                접기 <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="divide-y divide-border">
            {visible.map(item => {
              const finding = item.account ? findingOf(analysis, item.account) : undefined;
              return (
                <div key={item.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot[item.severity]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{item.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.detail}</p>
                      {finding?.cause && (
                        <p className="text-xs mt-1 leading-relaxed"><span className="text-muted-foreground">사유 후보 —</span> {finding.cause}</p>
                      )}
                      {finding?.action && (
                        <p className="text-xs mt-0.5 leading-relaxed"><span className="text-muted-foreground">확인 포인트 —</span> {finding.action}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hiddenCount > 0 && !showAll && (
            <button className="w-full px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 border-t border-border" onClick={() => setShowAll(true)}>
              참고 항목 포함 {hiddenCount}건 더 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
