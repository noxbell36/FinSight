import { useMemo, useState } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import type { MappedRow } from '@/types/finance';
import { monthlyTotals, byAccount } from '@/lib/insights';
import { fmtWon, fmtCompact, fmtChange } from '@/lib/format';
import { periodLabel } from '@/lib/normalize';
import { PageHeader } from '@/components/shared';

interface Props {
  rows: MappedRow[];
}

export default function TrendView({ rows }: Props) {
  const accounts = useMemo(() => Array.from(byAccount(rows).keys()).sort(), [rows]);
  const [account, setAccount] = useState<string>('all');

  const series = useMemo(() => {
    const totals = monthlyTotals(rows, account === 'all' ? undefined : account);
    return totals.map((d, i) => {
      const window = totals.slice(Math.max(0, i - 2), i + 1);
      const ma3 = window.reduce((s, w) => s + w.amount, 0) / window.length;
      const prev = i > 0 ? totals[i - 1].amount : null;
      return {
        period: d.period,
        label: d.period.slice(2).replace('-', '.'),
        amount: d.amount,
        ma3: Math.round(ma3),
        momDiff: prev != null ? d.amount - prev : null,
        momRate: prev != null && prev !== 0 ? (d.amount - prev) / prev : null,
      };
    });
  }, [rows, account]);

  const reversed = [...series].reverse();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="추이 분석"
        desc="월별 발생액과 3개월 이동평균으로 추세성/일회성 구분"
        right={
          <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={account} onChange={e => setAccount(e.target.value)}>
            <option value="all">전체 비용</option>
            {accounts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        }
      />

      <div className="panel p-4 mb-5">
        <h2 className="text-sm font-semibold mb-3">{account === 'all' ? '전체 비용' : account} 월별 추이</h2>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 90%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={v => fmtCompact(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
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
        <p className="text-[11px] text-muted-foreground mt-2">발생액이 이동평균을 지속 상회하면 추세적 증가, 단월만 튀면 일회성 가능성이 높습니다.</p>
      </div>

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">월별 상세 (최신순)</h2>
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="bg-secondary sticky top-0">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">귀속월</th>
                <th className="px-4 py-2 text-right font-medium">발생액</th>
                <th className="px-4 py-2 text-right font-medium">3개월 이동평균</th>
                <th className="px-4 py-2 text-right font-medium">전월비 증감</th>
                <th className="px-4 py-2 text-right font-medium">증감률</th>
              </tr>
            </thead>
            <tbody>
              {reversed.map(d => (
                <tr key={d.period} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-2">{periodLabel(d.period)}</td>
                  <td className="px-4 py-2 text-right num">{fmtWon(d.amount)}</td>
                  <td className="px-4 py-2 text-right num text-muted-foreground">{fmtWon(d.ma3)}</td>
                  <td className={`px-4 py-2 text-right num ${d.momDiff != null && d.momDiff > 0 ? 'text-destructive' : ''}`}>
                    {d.momDiff == null ? '-' : d.momDiff >= 0 ? `+${fmtWon(d.momDiff)}` : `(${fmtWon(Math.abs(d.momDiff))})`}
                  </td>
                  <td className="px-4 py-2 text-right num text-muted-foreground">{fmtChange(d.momRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
