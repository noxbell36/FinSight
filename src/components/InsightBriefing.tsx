import { Sparkles, AlertCircle, AlertTriangle, Info, CheckCircle2, Loader2 } from 'lucide-react';
import type { MonthlyAnalysis } from '@/types/finance';
import type { InsightItem } from '@/lib/insightEngine';
import { findingOf } from '@/lib/aiPipeline';

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error' | 'no-key';

const sevStyle: Record<InsightItem['severity'], { icon: JSX.Element; cls: string }> = {
  danger: { icon: <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />, cls: 'border-l-destructive' },
  warning: { icon: <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--warning))] shrink-0 mt-0.5" />, cls: 'border-l-[hsl(var(--warning))]' },
  info: { icon: <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />, cls: 'border-l-border' },
  good: { icon: <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />, cls: 'border-l-primary' },
};

interface Props {
  items: InsightItem[];
  analysis: MonthlyAnalysis | null;
  status: AnalysisStatus;
}

/** 월별 현황 상단 상시 노출 브리핑: AI 요약 + 규칙 엔진 인사이트 카드(+AI 원인·권고) */
export default function InsightBriefing({ items, analysis, status }: Props) {
  return (
    <div className="space-y-3 mb-5">
      {/* Executive Summary */}
      <div className="panel p-4 border-l-2 border-l-primary">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">월간 브리핑</h2>
          {status === 'running' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> AI 분석 중…</span>
          )}
          {status === 'done' && analysis && (
            <span className="text-[11px] text-muted-foreground ml-auto">AI 생성 — 검토 필요 · {new Date(analysis.generated_at).toLocaleString('ko-KR')}</span>
          )}
        </div>
        {status === 'no-key' && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            환경 설정에서 Gemini API 키를 입력하면 월 선택 시 AI 브리핑·원인 분석·변동사유 초안이 자동 생성됩니다. 아래 검출 항목은 AI 없이 규칙 기반으로 계산된 결과입니다.
          </p>
        )}
        {status === 'error' && (
          <p className="text-sm text-destructive">AI 분석 실패{analysis?.error ? ` — ${analysis.error}` : ''}. 아래 규칙 기반 검출은 정상 동작합니다.</p>
        )}
        {status === 'running' && !analysis?.summary && (
          <p className="text-sm text-muted-foreground">데이터를 근거로 종합 브리핑을 작성하고 있습니다…</p>
        )}
        {analysis?.summary && status !== 'error' && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{analysis.summary}</p>
        )}
      </div>

      {/* 인사이트 카드 그리드 — 상시 펼침 */}
      {items.length > 0 && (
        <div className="grid md:grid-cols-2 gap-2.5">
          {items.map(item => {
            const s = sevStyle[item.severity];
            const finding = item.account ? findingOf(analysis, item.account) : undefined;
            return (
              <div key={item.id} className={`panel p-3 border-l-2 ${s.cls}`}>
                <div className="flex items-start gap-2">
                  {s.icon}
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.detail}</p>
                    {finding?.cause && (
                      <p className="text-xs mt-1.5 leading-relaxed"><span className="text-muted-foreground">원인(AI):</span> {finding.cause}</p>
                    )}
                    {finding?.action && (
                      <p className="text-xs mt-0.5 leading-relaxed"><span className="text-muted-foreground">권고:</span> {finding.action}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
