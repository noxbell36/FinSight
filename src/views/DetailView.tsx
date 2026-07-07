import { useMemo, useState } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import type { MappedRow } from '@/types/finance';
import type { MonthlyInsightPack } from '@/lib/insightEngine';
import { byAccount, byCostCenter, byVendor, monthlyTotals } from '@/lib/insights';
import { fmtWon, fmtCompact, fmtPct, fmtChange } from '@/lib/format';
import { periodLabel, prevPeriod } from '@/lib/normalize';
import { MonthSelect, PageHeader } from '@/components/shared';
import { CompositionDonut } from '@/components/charts';

type Dim = 'account' | 'cc' | 'vendor';

interface Props {
  rows: MappedRow[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
  pack: MonthlyInsightPack | null;
}

const DIM_LABEL: Record<Dim, string> = { account: '계정', cc: '부서', vendor: '거래처' };

/**
 * 상세 분석 — "원인이 어디에 있나".
 * 차원(계정/부서/거래처) 선택 → 항목별 표 → 항목 선택 시 추이·구성 드릴다운.
 * 기존 '추이 분석'과 '거래처 분석' 탭을 흡수.
 */
export default function DetailView({ rows, periods, period, setPeriod, pack }: Props) {
  const [dim, setDim] = useState<Dim>('account');
  const [selected, setSelected] = useState<string>('');

  const dimKey = (r: MappedRow) =>
    dim === 'account' ? (r.account_name || '미분류') : dim === 'cc' ? (r.cost_center || '미분류') : (r.vendor || '미분류');

  // 항목별 당월/전월/YTD/비중 + 신규 여부(거래처)
  const table = useMemo(() => {
    const grouper = dim === 'account' ? byAccount : dim === 'cc' ? byCostCenter : byVendor;
    const curr = grouper(rows, period);
    const prev = grouper(rows, prevPeriod(period));
    const year = period.slice(0, 4);
    const ytd = new Map<string, number>();
    const firstPeriod = new Map<string, string>();
    for (const r of rows) {
      const k = dimKey(r);
      if (r.period) {
        const fp = firstPeriod.get(k);
        if (!fp || r.period < fp) firstPeriod.set(k, r.period);
      }
      if (r.period && r.period.startsWith(year) && r.period <= period) {
        ytd.set(k, (ytd.get(k) || 0) + (r.curr_amount ?? 0));
      }
    }
    const total = Array.from(curr.values()).reduce((a, b) => a + b, 0);
    const reMap = new Map((pack?.recurrence ?? []).map(r => [r.account_name, r.cls]));
    return {
      total,
      rows: Array.from(curr.entries()).map(([name, amount]) => ({
        name, amount,
        share: total > 0 ? amount / total : 0,
        prev: prev.get(name) || 0,
        diff: amount - (prev.get(name) || 0),
        ytd: ytd.get(name) || 0,
        isNew: dim === 'vendor' && firstPeriod.get(name) === period,
        cls: dim === 'account' ? reMap.get(name) : undefined,
      })).sort((a, b) => b.amount - a.amount),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, period, dim, pack]);

  // 선택 항목 시계열 (전체 = '')
  const series = useMemo(() => {
    const filtered = selected ? rows.filter(r => dimKey(r) === selected) : rows;
    const totals = monthlyTotals(filtered);
    return totals.filter(d => d.period <= period).map((d, i, arr) => {
      const window = arr.slice(Math.max(0, i - 2), i + 1);
      const ma3 = window.reduce((s, w) => s + w.amount, 0) / window.length;
      const prevAmt = i > 0 ? arr[i - 1].amount : null;
      return {
        period: d.period,
        label: d.period.slice(2).replace('-', '.'),
        amount: d.amount,
        ma3: Math.round(ma3),
        momRate: prevAmt != null && prevAmt !== 0 ? (d.amount - prevAmt) / prevAmt : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selected, dim, period]);

  // 선택 항목의 구성 (계정 선택 시 → 거래처 구성 / 부서 선택 시 → 계정 구성 / 거래처 선택 시 → 계정 구성)
  const breakdown = useMemo(() => {
    if (!selected) return [];
    const target = rows.filter(r => r.period === period && dimKey(r) === selected);
    const m = new Map<string, number>();
    for (const r of target) {
      const k = dim === 'account' ? (r.vendor || '미분류') : (r.account_name || '미분류');
      m.set(k, (m.get(k) || 0) + (r.curr_amount ?? 0));
    }
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selected, dim, period]);

  const newVendors = dim === 'vendor' ? table.rows.filter(r => r.isNew) : [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="상세 분석"
        desc={`${periodLabel(period)} · 계정·부서·거래처 기준으로 원인을 추적합니다`}
        right={
          <>
            <div className="flex rounded-md border border-border overflow-hidden text-sm">
              {(['account', 'cc', 'vendor'] as Dim[]).map(d => (
                <button key={d} onClick={() => { setDim(d); setSelected(''); }}
                  className={`px-3 py-1.5 ${dim === d ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
                  {DIM_LABEL[d]}
                </button>
              ))}
            </div>
            <MonthSelect periods={periods} value={period} onChange={setPeriod} />
          </>
        }
      />

      {/* 추이 차트 (선택 항목 or 전체) */}
      <div className="panel p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">{selected || '전체 비용'} 월별 추이 · 3개월 이동평균</h2>
          {selected && (
            <button onClick={() => setSelected('')} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">전체로 돌아가기</button>
          )}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 90%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={v => fmtCompact(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={54} />
            <Tooltip
              formatter={(v: number, name: string) => [`${fmtWon(v)}원`, name === 'amount' ? '발생액' : '3개월 이동평균']}
              labelFormatter={l => `20${l}`}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend formatter={(v) => (v === 'amount' ? '발생액' : '3개월 이동평균')} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="amount" fill="hsl(152 60% 34% / 0.35)" radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="ma3" stroke="hsl(152 60% 30%)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-muted-foreground mt-1.5">발생액이 이동평균을 지속 상회하면 추세적 증가, 단월만 튀면 일회성 가능성이 높습니다.</p>
      </div>

      {/* 선택 항목 구성 + 신규 거래처 */}
      {(selected || newVendors.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          {selected && breakdown.length > 0 && (
            <div className="panel p-4">
              <h2 className="text-sm font-semibold mb-2">
                {selected} — {dim === 'account' ? '거래처' : '계정'} 구성 ({periodLabel(period)})
              </h2>
              <CompositionDonut data={breakdown} />
            </div>
          )}
          {newVendors.length > 0 && (
            <div className="panel p-4">
              <h2 className="text-sm font-semibold mb-2">신규 거래처 (당월 최초 거래)</h2>
              <div className="space-y-1.5">
                {newVendors.map(v => (
                  <div key={v.name} className="flex items-center justify-between text-sm border-b border-border pb-1.5 last:border-0">
                    <span>{v.name}</span>
                    <span className="num">{fmtWon(v.amount)}원</span>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground pt-1">신규 거래처는 사업자 상태·지급 조건 확인을 권장합니다.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 항목별 표 */}
      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{DIM_LABEL[dim]}별 상세 ({periodLabel(period)}) — 행을 누르면 추이가 위에 표시됩니다</h2>
        </div>
        <div className="overflow-x-auto max-h-[460px] overflow-y-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="bg-secondary sticky top-0">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">{DIM_LABEL[dim]}명</th>
                {dim === 'account' && <th className="px-4 py-2 text-left font-medium">성격</th>}
                <th className="px-4 py-2 text-right font-medium">당월</th>
                <th className="px-4 py-2 text-right font-medium">비중</th>
                <th className="px-4 py-2 text-right font-medium">전월</th>
                <th className="px-4 py-2 text-right font-medium">증감</th>
                <th className="px-4 py-2 text-right font-medium">증감률</th>
                <th className="px-4 py-2 text-right font-medium">YTD</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map(r => (
                <tr key={r.name}
                    onClick={() => setSelected(selected === r.name ? '' : r.name)}
                    className={`border-t border-border cursor-pointer hover:bg-muted/40 ${selected === r.name ? 'bg-accent/40' : ''}`}>
                  <td className="px-4 py-1.5">
                    {r.name}
                    {r.isNew && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))]">신규</span>}
                  </td>
                  {dim === 'account' && <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.cls ?? '-'}</td>}
                  <td className="px-4 py-1.5 text-right num">{fmtWon(r.amount)}</td>
                  <td className="px-4 py-1.5 text-right num text-muted-foreground">{fmtPct(r.share)}</td>
                  <td className="px-4 py-1.5 text-right num text-muted-foreground">{fmtWon(r.prev)}</td>
                  <td className={`px-4 py-1.5 text-right num ${r.diff > 0 ? 'text-destructive' : ''}`}>
                    {r.diff >= 0 ? `+${fmtWon(r.diff)}` : `(${fmtWon(Math.abs(r.diff))})`}
                  </td>
                  <td className="px-4 py-1.5 text-right num text-muted-foreground">
                    {r.prev !== 0 ? fmtChange(r.diff / r.prev) : r.amount > 0 ? '신규' : '-'}
                  </td>
                  <td className="px-4 py-1.5 text-right num">{fmtWon(r.ytd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
