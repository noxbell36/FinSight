import { useMemo, useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { MappedRow, BudgetRecord, CommentaryEntry } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import { bvaByAccount, accountChanges, accountContext } from '@/lib/insights';
import { fmtWon, fmtPct, fmtChange } from '@/lib/format';
import { periodLabel } from '@/lib/normalize';
import { MonthSelect, PageHeader, EmptyHint } from '@/components/shared';
import { geminiGenerate, hasGeminiKey, SYSTEM_VARIANCE } from '@/lib/gemini';

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
}

interface TargetItem {
  account_name: string;
  actual: number;
  budget: number | null;
  variance: number | null;
  execRate: number | null;
  momDiff: number;
  momRate: number | null;
  reasons: string[]; // 검토 대상 사유
}

export default function VarianceView({ rows, budgets, periods, period, setPeriod, version, settings, commentary, upsertCommentary }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);

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

    // ① 예산 집행률 임계치 초과
    for (const r of bva) {
      if (r.execRate != null && r.execRate > settings.budget_warning_threshold) {
        ensure(r.account_name).reasons.push(r.execRate > 1 ? `예산 초과 (집행률 ${fmtPct(r.execRate)})` : `집행률 경보 (${fmtPct(r.execRate)})`);
      }
    }
    // ② 전월비 변동률 임계치 초과
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

  const handleAIDraft = async (item: TargetItem) => {
    setAiLoading(item.account_name);
    try {
      const ctx = accountContext(rows, period, item.account_name);
      const prompt = [
        `계정: ${item.account_name} / 귀속월: ${periodLabel(period)}`,
        `당월 실적: ${fmtWon(item.actual)}원`,
        item.budget != null ? `당월 예산(${version}): ${fmtWon(item.budget)}원, 차이: ${fmtWon(item.variance)}원, 집행률: ${fmtPct(item.execRate)}` : '예산 미편성',
        `전월비 증감: ${item.momDiff >= 0 ? '+' : '△'}${fmtWon(Math.abs(item.momDiff))}원 (${item.momRate != null ? fmtChange(item.momRate) : '신규'})`,
        `검토 대상 사유: ${item.reasons.join(' / ')}`,
        `당월 전표 ${ctx.txCount}건`,
        ctx.memos.length ? `적요: ${ctx.memos.join(' | ')}` : '적요 미기재',
        ctx.vendors.length ? `주요 거래처: ${ctx.vendors.join(', ')}` : '',
        '',
        '위 데이터에 근거해 변동사유 보고 초안을 작성하십시오.',
      ].join('\n');
      const text = await geminiGenerate(prompt, { system: SYSTEM_VARIANCE, model: settings.gemini_model });
      setDrafts(prev => ({ ...prev, [item.account_name]: text }));
      toast.success('AI 초안 생성 완료 — 검토 후 저장해주세요.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 초안 생성 실패');
    } finally {
      setAiLoading(null);
    }
  };

  const handleSave = (item: TargetItem, status: 'draft' | 'confirmed') => {
    const text = (drafts[item.account_name] ?? entryOf(item.account_name)?.reason ?? '').trim();
    if (!text) { toast.error('사유를 입력해주세요.'); return; }
    upsertCommentary({
      id: `${period}:${item.account_name}`,
      period,
      account_name: item.account_name,
      variance_amount: item.variance ?? 0,
      mom_amount: item.momDiff,
      reason: text,
      status,
      source: drafts[item.account_name] && drafts[item.account_name] === text ? 'ai-draft' : 'user',
      updated_at: new Date().toISOString(),
    });
    toast.success(status === 'confirmed' ? '변동사유 확정 완료 (월간 리포트에 반영)' : '임시 저장 완료');
  };

  const confirmedCount = targets.filter(t => entryOf(t.account_name)?.status === 'confirmed').length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="차이분석 · 변동사유"
        desc={`${periodLabel(period)} · 집행률 ${Math.round(settings.budget_warning_threshold * 100)}% 초과 또는 전월비 ±${Math.round(settings.change_rate_threshold * 100)}% 이상 계정 · 확정 ${confirmedCount}/${targets.length}`}
        right={<MonthSelect periods={periods} value={period} onChange={setPeriod} />}
      />

      {targets.length === 0 ? (
        <EmptyHint>이번 달은 검토 기준을 초과한 계정이 없습니다. 환경 설정에서 임계치를 조정할 수 있습니다.</EmptyHint>
      ) : (
        <div className="space-y-2.5">
          {targets.map(item => {
            const entry = entryOf(item.account_name);
            const isOpen = expanded === item.account_name;
            const draftText = drafts[item.account_name] ?? entry?.reason ?? '';
            return (
              <div key={item.account_name} className="panel overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                  onClick={() => setExpanded(isOpen ? null : item.account_name)}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="font-medium w-36 shrink-0">{item.account_name}</span>
                  <span className="text-xs text-muted-foreground flex-1">{item.reasons.join(' · ')}</span>
                  <span className="num text-sm w-32 text-right shrink-0">{fmtWon(item.actual)}원</span>
                  {entry?.status === 'confirmed' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-accent text-accent-foreground shrink-0">확정</span>
                  ) : entry ? (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">작성 중</span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))] shrink-0">미작성</span>
                  )}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-border">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground my-3">
                      <div>당월 실적 <span className="num text-foreground block">{fmtWon(item.actual)}원</span></div>
                      <div>당월 예산 <span className="num text-foreground block">{item.budget != null ? `${fmtWon(item.budget)}원` : '미편성'}</span></div>
                      <div>차이 B/(W) <span className={`num block ${item.variance != null && item.variance < 0 ? 'text-destructive' : 'text-foreground'}`}>{item.variance != null ? `${fmtWon(item.variance)}원` : '-'}</span></div>
                      <div>전월비 <span className="num text-foreground block">{item.momDiff >= 0 ? '+' : '△'}{fmtWon(Math.abs(item.momDiff))}원</span></div>
                    </div>
                    <Textarea
                      value={draftText}
                      onChange={e => setDrafts(prev => ({ ...prev, [item.account_name]: e.target.value }))}
                      placeholder="변동사유를 입력하세요. (예: 2026-06 신규 채용 3명분 급여 반영, 7월부터 정상화 예정)"
                      className="min-h-[88px] text-sm"
                    />
                    <div className="flex items-center gap-2 mt-2.5">
                      {hasGeminiKey() && (
                        <Button variant="outline" size="sm" className="gap-1.5" disabled={aiLoading === item.account_name} onClick={() => handleAIDraft(item)}>
                          <Sparkles className="h-3.5 w-3.5" />
                          {aiLoading === item.account_name ? '생성 중…' : 'AI 초안 (검토 필요)'}
                        </Button>
                      )}
                      <div className="flex-1" />
                      <Button variant="outline" size="sm" onClick={() => handleSave(item, 'draft')}>임시 저장</Button>
                      <Button size="sm" onClick={() => handleSave(item, 'confirmed')}>사유 확정</Button>
                    </div>
                    {entry?.source === 'ai-draft' && (
                      <p className="text-[11px] text-muted-foreground mt-2">이 사유는 AI 초안 기반입니다 — 담당자 검토를 거쳐 확정하십시오.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
