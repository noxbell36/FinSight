import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MappedRow, BudgetRecord, MonthlyAnalysis } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import type { AnalysisStatus } from '@/lib/aiPipeline';
import { computeKpis, accountChanges, byAccount, byCostCenter, monthlyTotals, totalOf } from '@/lib/insights';
import { runReviewChecks } from '@/lib/reviewChecks';
import { fmtWon, fmtCompact, fmtPct, fmtChange } from '@/lib/format';
import { periodLabel, prevPeriod } from '@/lib/normalize';
import { MonthSelect, PageHeader } from '@/components/shared';
import { Sparkline, WaterfallChart, CompositionDonut, BudgetActualCombo } from '@/components/charts';

interface Props {
  rows: MappedRow[];
  budgets: BudgetRecord[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
  version: string | null;
  settings: AppSettings;
  pack: MonthlyInsightPack | null;
  analysis: MonthlyAnalysis | null;
  analysisStatus: AnalysisStatus;
  cooldownLeft: number;
  onRetryAnalysis: () => void;
  goToDetail: () => void;
  goToClosing: () => void;
}

/**
 * 월간 현황 = 경영 요약(Executive Summary).
 * 구성: ① 요약 카드 4그룹 ② 12개월 실적·예산 추이 ③ 구성(계정/부서)
 *       ④ 전월비 증감 분해 ⑤ 검토 포인트 블록
 */
export default function MonthlyOverview({
  rows, budgets, periods, period, setPeriod, version, settings,
  pack, analysis, analysisStatus, cooldownLeft, onRetryAnalysis, goToDetail, goToClosing,
}: Props) {
  const kpi = useMemo(() => computeKpis(rows, budgets, period, version), [rows, budgets, period, version]);
  const changes = useMemo(() => accountChanges(rows, period), [rows, period]);
  const checks = useMemo(() => runReviewChecks(rows, period, settings), [rows, period, settings]);

  const sparkTotals = useMemo(
    () => monthlyTotals(rows).filter(d => d.period <= period).slice(-12).map(d => d.amount),
    [rows, period],
  );

  const comboData = useMemo(() => {
    const actuals = monthlyTotals(rows).filter(d => d.period <= period).slice(-12);
    const budgetByPeriod = new Map<string, number>();
    for (const b of budgets) {
      if (version && b.version !== version) continue;
      budgetByPeriod.set(b.period, (budgetByPeriod.get(b.period) || 0) + b.amount);
    }
    return actuals.map(d => ({
      label: d.period.slice(2).replace('-', '.'),
      actual: d.amount,
      budget: budgetByPeriod.has(d.period) ? budgetByPeriod.get(d.period)! : null,
    }));
  }, [rows, budgets, version, period]);

  const accountTop = useMemo(() => {
    const m = byAccount(rows, period);
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
    return Array.from(m.entries())
      .map(([name, value]) => ({ name: name.length > 7 ? name.slice(0, 7) + '…' : name, fullName: name, value, share: total > 0 ? value / total : 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [rows, period]);

  const ccData = useMemo(() =>
    Array.from(byCostCenter(rows, period).entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  [rows, period]);

  const topUp = changes.filter(c => c.diff > 0).slice(0, 3);
  const topDown = changes.filter(c => c.diff < 0).slice(0, 3);

  // 부서별 전월비 변동
  const ccChanges = useMemo(() => {
    const curr = byCostCenter(rows, period);
    const prev = byCostCenter(rows, prevPeriod(period));
    return Array.from(new Set([...curr.keys(), ...prev.keys()]))
      .map(k => ({ name: k, diff: (curr.get(k) || 0) - (prev.get(k) || 0) }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 3);
  }, [rows, period]);

  const budgetVar = kpi.execRate != null
    ? { diff: kpi.total - kpi.total / kpi.execRate, over: kpi.execRate > 1 }
    : null;

  const prevP = prevPeriod(period);
  const hasPrev = periods.includes(prevP);
  const prevTotal = hasPrev ? totalOf(rows, prevP) : 0;

  // 검토 포인트 재료
  const overItems = (pack?.items ?? []).filter(i => i.category === '예산' && i.severity === 'danger').slice(0, 3);
  const trendItems = (pack?.items ?? []).filter(i => i.category === '추세').slice(0, 3);
  const reviewDanger = checks.filter(c => c.severity === 'danger').reduce((s, c) => s + c.hits.length, 0);
  const memoMissing = checks.find(c => c.id === 'memo')?.hits.length ?? 0;
  const landingOver = (pack?.landing ?? []).filter(l => l.ratio > 1).slice(0, 3);
  const newVendorItem = useMemo(() => {
    const first = new Map<string, string>();
    for (const r of rows) {
      const v = r.vendor || '미분류';
      if (r.period && (!first.has(v) || r.period < first.get(v)!)) first.set(v, r.period);
    }
    return Array.from(first.entries()).filter(([, p]) => p === period).length;
  }, [rows, period]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="월간 비용 현황"
        desc={`${periodLabel(period)} 마감 기준 · 판관비 집계`}
        right={<MonthSelect periods={periods} value={period} onChange={setPeriod} />}
      />

      {/* 상태 배너 (한도 대기/오류만 — 평시에는 표시하지 않음) */}
      {analysisStatus === 'cooldown' && (
        <div className="panel p-3 mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 호출 한도 대기 중 — 약 {cooldownLeft}초 후 자동으로 검토 코멘트를 이어서 작성합니다.
        </div>
      )}
      {analysisStatus === 'error' && (
        <div className="panel p-3 mb-4 flex items-center gap-3 text-sm">
          <span className="text-destructive flex-1">{analysis?.error || '코멘트 생성 실패'} — 아래 수치·검토 포인트는 계산 결과로 정상 표시됩니다.</span>
          <Button variant="outline" size="sm" onClick={onRetryAnalysis} className="gap-1.5 shrink-0"><RotateCcw className="h-3.5 w-3.5" /> 다시 시도</Button>
        </div>
      )}

      {/* ① 요약 카드 4그룹 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="panel p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">전체 실적</p>
          <p className="text-xl font-bold num">{fmtCompact(kpi.total)}</p>
          <p className="text-xs text-muted-foreground num mt-0.5">{fmtWon(kpi.total)}원 · YTD {fmtCompact(kpi.ytd)}</p>
          <div className="mt-2 opacity-80"><Sparkline data={sparkTotals} /></div>
        </div>
        <div className="panel p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">전월 대비 변동</p>
          <p className={`text-xl font-bold num ${kpi.momAmount != null && kpi.momAmount > 0 ? 'text-destructive' : 'text-primary'}`}>
            {kpi.momRate != null ? fmtChange(kpi.momRate) : '-'}
          </p>
          <p className="text-xs text-muted-foreground num mt-0.5">
            {kpi.momAmount != null ? `${kpi.momAmount >= 0 ? '+' : '△'}${fmtWon(Math.abs(kpi.momAmount))}원` : '전월 데이터 없음'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
            {topUp[0] ? `증가: ${topUp[0].account_name} +${fmtCompact(topUp[0].diff)}` : ''}
            {topDown[0] ? ` · 감소: ${topDown[0].account_name} △${fmtCompact(Math.abs(topDown[0].diff))}` : ''}
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">예산 대비 ({version ?? '예산 없음'})</p>
          <p className={`text-xl font-bold num ${budgetVar?.over ? 'text-destructive' : ''}`}>
            {kpi.execRate != null ? fmtPct(kpi.execRate) : '-'}
          </p>
          <p className="text-xs text-muted-foreground num mt-0.5">
            {budgetVar ? `차이 ${budgetVar.over ? '' : '+'}${fmtWon(-budgetVar.diff)}원 · ${budgetVar.over ? '초과' : '예산 내'}` : '예산 데이터 미업로드'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">예산 초과 {kpi.overBudgetCount}개 계정</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">확인 필요 항목</p>
          <p className={`text-xl font-bold num ${(pack?.flaggedAccounts.length ?? 0) + reviewDanger > 0 ? '' : 'text-primary'}`}>
            {(pack?.flaggedAccounts.length ?? 0) + reviewDanger}건
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">변동사유 {pack?.flaggedAccounts.length ?? 0} · 전표 필수확인 {reviewDanger}</p>
          <button onClick={goToClosing} className="text-[11px] text-primary underline underline-offset-2 mt-2">마감 검토로 이동 →</button>
        </div>
      </div>

      {/* ② 12개월 실적·예산 추이 */}
      <div className="panel p-4 mb-4">
        <h2 className="text-sm font-semibold mb-2">월별 실적 vs 예산 (최근 12개월)</h2>
        <BudgetActualCombo data={comboData} height={220} />
      </div>

      {/* ③ 구성: 계정 Top10 + 부서 */}
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <div className="panel p-4">
          <h2 className="text-sm font-semibold mb-2">계정별 구성 상위 10 ({periodLabel(period)})</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={accountTop} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 90%)" horizontal={false} />
              <XAxis type="number" tickFormatter={v => fmtCompact(v)} tick={{ fontSize: 10.5 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={74} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number, _n, p: { payload?: { share?: number } }) => [`${fmtWon(v)}원 (${fmtPct(p?.payload?.share)})`, '당월']} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="value" fill="hsl(152 60% 34%)" radius={[0, 3, 3, 0]} barSize={13} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4">
          <h2 className="text-sm font-semibold mb-2">부서별 구성 ({periodLabel(period)})</h2>
          <CompositionDonut data={ccData} height={250} />
        </div>
      </div>

      {/* ④ 전월비 증감 분해 */}
      <div className="panel p-4 mb-4">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-sm font-semibold">전월비 증감 분해</h2>
          <button onClick={goToDetail} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">계정·부서·거래처 상세 →</button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">어느 계정이 총비용을 움직였는지 — 붉은색 증가 / 파란색 감소</p>
        {pack && hasPrev ? (
          <WaterfallChart
            prevTotal={prevTotal}
            currTotal={kpi.total}
            steps={pack.waterfall}
            prevLabel={prevP.slice(2).replace('-', '.')}
            currLabel={period.slice(2).replace('-', '.')}
            height={220}
          />
        ) : (
          <p className="text-xs text-muted-foreground py-8 text-center">전월 데이터가 있어야 표시됩니다.</p>
        )}
      </div>

      {/* ⑤ 검토 포인트 블록 */}
      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center">
          <h2 className="text-sm font-semibold">이번 달 검토 포인트</h2>
          {analysisStatus === 'running' && (
            <span className="ml-3 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> 코멘트 작성 중</span>
          )}
          {analysis?.summary && analysisStatus === 'done' && (
            <span className="text-[11px] text-muted-foreground ml-auto">코멘트 초안 · 검토 후 사용</span>
          )}
        </div>
        {analysis?.summary && analysisStatus === 'done' && (
          <p className="px-4 py-3 text-sm leading-relaxed border-b border-border bg-secondary/40 whitespace-pre-wrap">{analysis.summary}</p>
        )}
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          <div className="p-4 space-y-3">
            <CheckBlock title="가장 중요한 비용 변동">
              {changes.slice(0, 3).map(c => (
                <li key={c.account_name}>
                  <span className="font-medium">{c.account_name}</span>{' '}
                  <span className={`num ${c.diff > 0 ? 'text-destructive' : 'text-primary'}`}>{c.diff >= 0 ? '+' : '△'}{fmtWon(Math.abs(c.diff))}원</span>
                  {pack?.drivers[c.account_name]?.vendorTop[0] && pack.drivers[c.account_name].vendorTop[0].share != null && Math.abs(pack.drivers[c.account_name].vendorTop[0].share!) >= 0.3 && (
                    <span className="text-muted-foreground"> — '{pack.drivers[c.account_name].vendorTop[0].name}' 기여 약 {Math.round(Math.abs(pack.drivers[c.account_name].vendorTop[0].share!) * 100)}%</span>
                  )}
                </li>
              ))}
            </CheckBlock>
            <CheckBlock title="예산 대비 주의 항목">
              {overItems.length === 0 && <li className="text-muted-foreground">예산 초과 계정 없음</li>}
              {overItems.map(i => <li key={i.id}>{i.title} <span className="text-muted-foreground">— {i.detail}</span></li>)}
            </CheckBlock>
            <CheckBlock title="변동 성격 확인 필요">
              {trendItems.length === 0 && <li className="text-muted-foreground">추세성/일회성 특이 항목 없음</li>}
              {trendItems.map(i => <li key={i.id}>{i.title} <span className="text-muted-foreground">— {i.detail}</span></li>)}
            </CheckBlock>
          </div>
          <div className="p-4 space-y-3">
            <CheckBlock title="부서·거래처 확인">
              {ccChanges.map(c => (
                <li key={c.name}><span className="font-medium">{c.name}</span> 전월비 <span className={`num ${c.diff > 0 ? 'text-destructive' : 'text-primary'}`}>{c.diff >= 0 ? '+' : '△'}{fmtWon(Math.abs(c.diff))}원</span></li>
              ))}
              {newVendorItem > 0 && <li>당월 신규 거래처 <span className="num font-medium">{newVendorItem}개</span> — 사업자 상태·지급 조건 확인 권장</li>}
            </CheckBlock>
            <CheckBlock title="다음 달 관리 포인트">
              {(analysis?.next_points.length ? analysis.next_points.slice(0, 3) : landingOver.map(l => `${l.account_name}: 현재 속도 유지 시 연간예산 대비 ${fmtPct(l.ratio, 0)} 착지 전망 — 수정예산 반영 검토`)).map((t, i) => <li key={i}>{t}</li>)}
              {!analysis?.next_points.length && landingOver.length === 0 && <li className="text-muted-foreground">특이 사항 없음</li>}
            </CheckBlock>
            <CheckBlock title="데이터 품질">
              <li>적요 미기재 <span className={`num ${memoMissing > 0 ? 'font-medium' : ''}`}>{memoMissing}건</span>{memoMissing > 0 && ' — 사유 파악 정확도에 영향, 입력 기준 안내 필요'}</li>
              <li>마감 전 필수 확인 <span className={`num ${reviewDanger > 0 ? 'text-destructive font-medium' : ''}`}>{reviewDanger}건</span> (VAT 불일치·중복 의심)</li>
            </CheckBlock>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-1.5">{title}</p>
      <ul className="text-xs space-y-1 leading-relaxed [&>li]:pl-2.5 [&>li]:relative [&>li]:before:content-['·'] [&>li]:before:absolute [&>li]:before:left-0">
        {children}
      </ul>
    </div>
  );
}
