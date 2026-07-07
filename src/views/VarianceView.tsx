import { useMemo, useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { MappedRow, BudgetRecord, CommentaryEntry, MonthlyAnalysis } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import { bvaByAccount, accountChanges } from '@/lib/insights';
import { findingOf } from '@/lib/aiPipeline';
import { fmtWon, fmtPct, fmtChange } from '@/lib/format';
import { periodLabel } from '@/lib/normalize';
import { MonthSelect, PageHeader, EmptyHint } from '@/components/shared';
import type { AnalysisStatus } from '@/components/InsightBriefing';

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
  analysis: MonthlyAnalysis | null;
  analysisStatus: AnalysisStatus;
  embedded?: boolean;
}

interface TargetItem {
  account_name: string;
  actual: number;
  budget: number | null;
  variance: number | null;
  execRate: number | null;
  momDiff: number;
  momRate: number | null;
  reasons: string[];
}

export default function VarianceView({ rows, budgets, periods, period, setPeriod, version, settings, commentary, upsertCommentary, analysis, analysisStatus, embedded }: Props) {
  const [edits, setEdits] = useState<Record<string, string>>({}); // 사용자가 손댄 텍스트만 보관

  const targets = useMemo<TargetItem[]>(() => {
    const bva = bvaByAccount(rows, budgets, period, version);
    const changes = accountChanges(rows, period);
    const changeMap = new Map(changes.map(c => [c.account_name, c]));
    const map = new Map<string, TargetItem>();

    const ensure = (name: string): TargetItem => {
      if (!map.has(name)) {
        const b = bva.find(r => r.account_name === name);
        const c = changeMap.get(name);
        map.set(name, {
          account_name: name,
          actual: b?.actual ?? c?.curr ?? 0,
          budget: b?.budget ?? null,
          variance: b?.variance ?? null,
          execRate: b?.execRate ?? null,
          momDiff: c?.diff ?? 0,
          momRate: c?.rate ?? null,
          reasons: [],
        });
      }
      return map.get(name)!;
    };

    for (const r of bva) {
      if (r.execRate != null && r.execRate > settings.budget_warning_threshold) {
        ensure(r.account_name).reasons.push(r.execRate > 1 ? `예산 초과 (집행률 ${fmtPct(r.execRate)})` : `집행률 경보 (${fmtPct(r.execRate)})`);
      }
    }
    for (const c of changes) {
      if (c.rate != null && Math.abs(c.rate) > settings.change_rate_threshold && Math.abs(c.diff) > 0) {
        ensure(c.account_name).reasons.push(`전월비 ${fmtChange(c.rate)} (${c.diff >= 0 ? '+' : '△'}${fmtWon(Math.abs(c.diff))}원)`);
      } else if (c.rate == null && c.curr > 0 && c.prev === 0) {
        ensure(c.account_name).reasons.push('당월 신규 발생');
      }
    }
    return Array.from(map.values()).sort((a, b) => Math.abs(b.momDiff) - Math.abs(a.momDiff));
  }, [rows, budgets, period, version, settings]);

  const entryOf = (account: string) => commentary.find(c => c.id === `${period}:${account}`);

  /** 표시 우선순위: 사용자 수정 중 텍스트 > 저장된 사유 > AI 배치 초안 */
  const textOf = (item: TargetItem): { text: string; origin: 'edit' | 'saved' | 'ai' | 'empty' } => {
    const key = `${period}:${item.account_name}`;
    if (edits[key] !== undefined) return { text: edits[key], origin: 'edit' };
    const entry = entryOf(item.account_name);
    if (entry?.reason) return { text: entry.reason, origin: 'saved' };
    const draft = findingOf(analysis, item.account_name)?.draft;
    if (draft) return { text: draft, origin: 'ai' };
    return { text: '', origin: 'empty' };
  };

  const handleSave = (item: TargetItem, status: 'draft' | 'confirmed') => {
    const { text, origin } = textOf(item);
    const trimmed = text.trim();
    if (!trimmed) { toast.error('사유가 비어 있습니다.'); return; }
    upsertCommentary({
      id: `${period}:${item.account_name}`,
      period,
      account_name: item.account_name,
      variance_amount: item.variance ?? 0,
      mom_amount: item.momDiff,
      reason: trimmed,
      status,
      source: origin === 'ai' ? 'ai-draft' : 'user',
      updated_at: new Date().toISOString(),
    });
    toast.success(status === 'confirmed' ? `${item.account_name} 사유 확정 (월간 리포트 반영)` : '임시 저장 완료');
  };

  const handleConfirmAll = () => {
    let n = 0;
    for (const item of targets) {
      const { text, origin } = textOf(item);
      if (!text.trim()) continue;
      const entry = entryOf(item.account_name);
      if (entry?.status === 'confirmed' && origin !== 'edit') continue;
      upsertCommentary({
        id: `${period}:${item.account_name}`,
        period,
        account_name: item.account_name,
        variance_amount: item.variance ?? 0,
        mom_amount: item.momDiff,
        reason: text.trim(),
        status: 'confirmed',
        source: origin === 'ai' ? 'ai-draft' : 'user',
        updated_at: new Date().toISOString(),
      });
      n++;
    }
    toast.success(`${n}건 일괄 확정 완료`);
  };

  const confirmedCount = targets.filter(t => entryOf(t.account_name)?.status === 'confirmed').length;

  return (
    <div className={embedded ? '' : 'p-6 max-w-5xl mx-auto'}>
      {!embedded ? (
        <PageHeader
          title="차이분석 · 변동사유"
          desc={`${periodLabel(period)} · 초안이 자동 작성됩니다 — 검토 후 수정·확정하면 월간 리포트에 반영 · 확정 ${confirmedCount}/${targets.length}`}
          right={
            <>
              <Button variant="outline" size="sm" onClick={handleConfirmAll} disabled={targets.length === 0}>전체 일괄 확정</Button>
              <MonthSelect periods={periods} value={period} onChange={setPeriod} />
            </>
          }
        />
      ) : (
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-muted-foreground">초안을 검토해 수정·확정하면 월간 리포트에 반영됩니다 · 확정 {confirmedCount}/{targets.length}</p>
          <Button variant="outline" size="sm" onClick={handleConfirmAll} disabled={targets.length === 0}>전체 일괄 확정</Button>
        </div>
      )}

      {analysisStatus === 'running' && (
        <div className="panel p-3 mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 변동사유 초안을 작성하는 중입니다… 완료되면 아래 입력란에 자동으로 채워집니다.
        </div>
      )}
      {analysisStatus === 'no-key' && (
        <div className="panel p-3 mb-4 text-sm text-muted-foreground">
          환경 설정에서 Gemini API 키를 입력하면 초안이 자동 생성됩니다. 현재는 직접 입력만 가능합니다.
        </div>
      )}

      {targets.length === 0 ? (
        <EmptyHint>이번 달은 검토 기준을 초과한 계정이 없습니다. 환경 설정에서 임계치를 조정할 수 있습니다.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {targets.map(item => {
            const entry = entryOf(item.account_name);
            const { text, origin } = textOf(item);
            const finding = findingOf(analysis, item.account_name);
            const key = `${period}:${item.account_name}`;
            return (
              <div key={item.account_name} className="panel p-4">
                {/* 헤더 라인 */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold">{item.account_name}</span>
                  <span className="text-xs text-muted-foreground flex-1 min-w-[180px]">{item.reasons.join(' · ')}</span>
                  {entry?.status === 'confirmed' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-accent text-accent-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 확정</span>
                  ) : origin === 'ai' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))]">초안 · 검토 전</span>
                  ) : entry ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-secondary text-muted-foreground">작성 중</span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">미작성</span>
                  )}
                </div>

                {/* 수치 요약 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground my-3">
                  <div>당월 실적 <span className="num text-foreground block">{fmtWon(item.actual)}원</span></div>
                  <div>당월 예산 <span className="num text-foreground block">{item.budget != null ? `${fmtWon(item.budget)}원` : '미편성'}</span></div>
                  <div>차이 B/(W) <span className={`num block ${item.variance != null && item.variance < 0 ? 'text-destructive' : 'text-foreground'}`}>{item.variance != null ? `${fmtWon(item.variance)}원` : '-'}</span></div>
                  <div>전월비 <span className="num text-foreground block">{item.momDiff >= 0 ? '+' : '△'}{fmtWon(Math.abs(item.momDiff))}원 {item.momRate != null ? `(${fmtChange(item.momRate)})` : ''}</span></div>
                </div>

                {/* AI 원인/권고 (있을 때) */}
                {(finding?.cause || finding?.action) && (
                  <div className="rounded-md bg-secondary/60 px-3 py-2 mb-2.5 text-xs leading-relaxed space-y-0.5">
                    {finding.cause && <p><span className="text-muted-foreground">원인(AI):</span> {finding.cause}</p>}
                    {finding.action && <p><span className="text-muted-foreground">권고:</span> {finding.action}</p>}
                  </div>
                )}

                <Textarea
                  value={text}
                  onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={analysisStatus === 'running' ? 'AI 초안 작성 중…' : '변동사유를 입력하세요.'}
                  className="min-h-[76px] text-sm"
                />
                <div className="flex items-center gap-2 mt-2.5">
                  <p className="text-[11px] text-muted-foreground flex-1">
                    {origin === 'ai' && '자동 작성 초안입니다 — 검토 후 확정하십시오.'}
                    {entry?.source === 'ai-draft' && origin === 'saved' && 'AI 초안 기반으로 저장된 사유입니다.'}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => handleSave(item, 'draft')}>임시 저장</Button>
                  <Button size="sm" onClick={() => handleSave(item, 'confirmed')}>사유 확정</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
