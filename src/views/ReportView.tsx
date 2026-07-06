import { useMemo, useState } from 'react';
import { Printer, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { MappedRow, BudgetRecord, CommentaryEntry } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import { computeKpis, bvaByAccount } from '@/lib/insights';
import { fmtWon, fmtPct, fmtChange } from '@/lib/format';
import { periodLabel } from '@/lib/normalize';
import { MonthSelect, PageHeader } from '@/components/shared';
import { geminiGenerate, hasGeminiKey, SYSTEM_REPORT } from '@/lib/gemini';

interface Props {
  rows: MappedRow[];
  budgets: BudgetRecord[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
  version: string | null;
  settings: AppSettings;
  commentary: CommentaryEntry[];
  reportNote: string;
  setReportNote: (period: string, note: string) => void;
}

export default function ReportView({ rows, budgets, periods, period, setPeriod, version, settings, commentary, reportNote, setReportNote }: Props) {
  const [aiLoading, setAiLoading] = useState(false);
  const kpi = useMemo(() => computeKpis(rows, budgets, period, version), [rows, budgets, period, version]);
  const bva = useMemo(() => bvaByAccount(rows, budgets, period, version), [rows, budgets, period, version]);

  const topVariances = useMemo(
    () => bva.filter(r => r.variance != null).sort((a, b) => Math.abs(b.variance!) - Math.abs(a.variance!)).slice(0, 8),
    [bva],
  );
  const confirmed = useMemo(
    () => commentary.filter(c => c.period === period && c.status === 'confirmed'),
    [commentary, period],
  );

  const handleAISummary = async () => {
    setAiLoading(true);
    try {
      const prompt = [
        `${settings.company_name || '회사'} ${periodLabel(period)} 비용 실적 요약 데이터:`,
        `당월 총비용 ${fmtWon(kpi.total)}원, 전월비 ${kpi.momRate != null ? fmtChange(kpi.momRate) : '데이터 없음'}, 전년동월비 ${kpi.yoyRate != null ? fmtChange(kpi.yoyRate) : '데이터 없음'}, 예산 집행률 ${kpi.execRate != null ? fmtPct(kpi.execRate) : '예산 없음'}, 예산 초과 ${kpi.overBudgetCount}개 계정`,
        '',
        '예산 차이 상위 계정 (차이 = 예산-실적, 음수는 초과):',
        ...topVariances.map(r => `- ${r.account_name}: 예산 ${fmtWon(r.budget)}원 / 실적 ${fmtWon(r.actual)}원 / 차이 ${fmtWon(r.variance)}원`),
        '',
        confirmed.length > 0 ? '확정된 변동사유:' : '확정된 변동사유 없음',
        ...confirmed.map(c => `- ${c.account_name}: ${c.reason}`),
        '',
        '위 데이터만으로 월간 비용 리포트 종합 코멘트를 작성하십시오.',
      ].join('\n');
      const text = await geminiGenerate(prompt, { system: SYSTEM_REPORT, model: settings.gemini_model });
      setReportNote(period, text);
      toast.success('AI 종합 코멘트 생성 완료 — 검토 후 필요 시 수정하세요.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 요약 생성 실패');
    } finally {
      setAiLoading(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="no-print">
        <PageHeader
          title="월간 리포트"
          desc="인쇄(PDF 저장)용 월마감 보고 양식"
          right={
            <>
              <MonthSelect periods={periods} value={period} onChange={setPeriod} />
              {hasGeminiKey() && (
                <Button variant="outline" onClick={handleAISummary} disabled={aiLoading} className="gap-1.5">
                  <Sparkles className="h-4 w-4" /> {aiLoading ? '생성 중…' : 'AI 종합 코멘트'}
                </Button>
              )}
              <Button onClick={() => window.print()} className="gap-1.5"><Printer className="h-4 w-4" /> 인쇄 / PDF 저장</Button>
            </>
          }
        />
      </div>

      <div id="print-area" className="panel p-8">
        {/* 헤더 */}
        <div className="border-b-2 border-foreground pb-4 mb-6">
          <h1 className="text-xl font-bold">{periodLabel(period)} 비용 실적 보고</h1>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{settings.company_name || '(회사명 미설정 — 환경 설정에서 입력)'}</span>
            <span>기준: 예산버전 {version ?? '-'} · 작성일 {today}</span>
          </div>
        </div>

        {/* 1. 요약 */}
        <section className="mb-6">
          <h2 className="text-sm font-bold mb-2">1. 당월 요약</h2>
          <table className="w-full text-sm border border-border">
            <tbody>
              <tr className="border-b border-border">
                <td className="px-3 py-2 bg-secondary font-medium w-40">당월 총비용</td>
                <td className="px-3 py-2 num text-right">{fmtWon(kpi.total)}원</td>
                <td className="px-3 py-2 bg-secondary font-medium w-40">YTD 누계</td>
                <td className="px-3 py-2 num text-right">{fmtWon(kpi.ytd)}원</td>
              </tr>
              <tr className="border-b border-border">
                <td className="px-3 py-2 bg-secondary font-medium">전월비</td>
                <td className="px-3 py-2 num text-right">{kpi.momRate != null ? `${fmtChange(kpi.momRate)} (${kpi.momAmount! >= 0 ? '+' : '△'}${fmtWon(Math.abs(kpi.momAmount!))}원)` : '-'}</td>
                <td className="px-3 py-2 bg-secondary font-medium">전년동월비</td>
                <td className="px-3 py-2 num text-right">{kpi.yoyRate != null ? `${fmtChange(kpi.yoyRate)} (${kpi.yoyAmount! >= 0 ? '+' : '△'}${fmtWon(Math.abs(kpi.yoyAmount!))}원)` : '-'}</td>
              </tr>
              <tr>
                <td className="px-3 py-2 bg-secondary font-medium">예산 집행률</td>
                <td className="px-3 py-2 num text-right">{kpi.execRate != null ? fmtPct(kpi.execRate) : '예산 없음'}</td>
                <td className="px-3 py-2 bg-secondary font-medium">예산 초과 계정</td>
                <td className="px-3 py-2 num text-right">{kpi.overBudgetCount}개</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 2. 예산 차이 상위 */}
        <section className="mb-6">
          <h2 className="text-sm font-bold mb-2">2. 예산 대비 차이 상위 계정</h2>
          {topVariances.length === 0 ? (
            <p className="text-xs text-muted-foreground">예산 데이터가 없습니다.</p>
          ) : (
            <table className="w-full text-sm border border-border">
              <thead>
                <tr className="bg-secondary text-xs">
                  <th className="px-3 py-2 text-left font-medium border-b border-border">계정명</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-border">예산</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-border">실적</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-border">차이 B/(W)</th>
                  <th className="px-3 py-2 text-right font-medium border-b border-border">집행률</th>
                </tr>
              </thead>
              <tbody>
                {topVariances.map(r => (
                  <tr key={r.account_name} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{r.account_name}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtWon(r.budget)}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtWon(r.actual)}</td>
                    <td className={`px-3 py-1.5 text-right num ${r.variance! < 0 ? 'text-destructive' : ''}`}>{fmtWon(r.variance)}</td>
                    <td className="px-3 py-1.5 text-right num">{fmtPct(r.execRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 3. 변동사유 */}
        <section className="mb-6">
          <h2 className="text-sm font-bold mb-2">3. 주요 변동사유 (확정)</h2>
          {confirmed.length === 0 ? (
            <p className="text-xs text-muted-foreground">확정된 변동사유가 없습니다. 차이분석·변동사유 탭에서 사유를 확정하면 이곳에 표시됩니다.</p>
          ) : (
            <div className="space-y-2">
              {confirmed.map(c => (
                <div key={c.id} className="text-sm border-l-2 border-primary pl-3">
                  <p className="font-medium">{c.account_name}</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">{c.reason}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. 종합 코멘트 */}
        <section>
          <h2 className="text-sm font-bold mb-2">4. 종합 코멘트</h2>
          <div className="no-print">
            <Textarea
              value={reportNote}
              onChange={e => setReportNote(period, e.target.value)}
              placeholder="종합 코멘트를 작성하거나 AI 종합 코멘트 버튼으로 초안을 생성하세요."
              className="min-h-[110px] text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">AI 생성 코멘트는 초안입니다 — 보고 전 반드시 담당자 검토가 필요합니다.</p>
          </div>
          <div className="hidden print:block text-sm leading-relaxed whitespace-pre-wrap">
            {reportNote || '(종합 코멘트 미작성)'}
          </div>
        </section>
      </div>
    </div>
  );
}
