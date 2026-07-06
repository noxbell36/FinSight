import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { MappedRow } from '@/types/finance';
import { byVendor } from '@/lib/insights';
import { fmtWon, fmtCompact, fmtPct } from '@/lib/format';
import { periodLabel } from '@/lib/normalize';
import { MonthSelect, PageHeader, KpiCard } from '@/components/shared';

interface Props {
  rows: MappedRow[];
  periods: string[];
  period: string;
  setPeriod: (p: string) => void;
}

export default function VendorView({ rows, periods, period, setPeriod }: Props) {
  const table = useMemo(() => {
    const curr = byVendor(rows, period);
    const year = period.slice(0, 4);
    // 누계 (연초~당월)
    const ytd = new Map<string, number>();
    const firstPeriod = new Map<string, string>();
    const txCount = new Map<string, number>();
    for (const r of rows) {
      const v = r.vendor || '미분류';
      if (r.period) {
        const fp = firstPeriod.get(v);
        if (!fp || r.period < fp) firstPeriod.set(v, r.period);
      }
      if (r.period && r.period.startsWith(year) && r.period <= period) {
        ytd.set(v, (ytd.get(v) || 0) + (r.curr_amount ?? 0));
      }
      if (r.period === period) txCount.set(v, (txCount.get(v) || 0) + 1);
    }
    const total = Array.from(curr.values()).reduce((a, b) => a + b, 0);
    return {
      total,
      rows: Array.from(curr.entries())
        .map(([name, amount]) => ({
          name, amount,
          share: total > 0 ? amount / total : 0,
          ytd: ytd.get(name) || 0,
          count: txCount.get(name) || 0,
          isNew: firstPeriod.get(name) === period,
        }))
        .sort((a, b) => b.amount - a.amount),
    };
  }, [rows, period]);

  const top10 = table.rows.slice(0, 10).map(r => ({ name: r.name.length > 8 ? r.name.slice(0, 8) + '…' : r.name, amount: r.amount }));
  const newVendors = table.rows.filter(r => r.isNew);
  const top5Share = table.rows.slice(0, 5).reduce((s, r) => s + r.share, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="거래처 분석"
        desc={`${periodLabel(period)} · 거래처별 지출 집중도 및 신규 거래처 확인`}
        right={<MonthSelect periods={periods} value={period} onChange={setPeriod} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiCard label="당월 거래처 수" value={`${table.rows.length}개`} />
        <KpiCard label="상위 5개 집중도" value={fmtPct(top5Share)} sub="당월 지출 기준" subClass={top5Share > 0.7 ? 'text-destructive' : undefined} />
        <KpiCard label="신규 거래처" value={`${newVendors.length}개`} sub="당월 최초 거래 발생" subClass={newVendors.length > 0 ? 'text-[hsl(var(--warning-foreground))]' : undefined} />
        <KpiCard label="당월 총지출" value={fmtCompact(table.total)} sub={`${fmtWon(table.total)}원`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-5">
        <div className="panel p-4">
          <h2 className="text-sm font-semibold mb-3">거래처별 지출 상위 10 ({periodLabel(period)})</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={top10} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 90%)" horizontal={false} />
              <XAxis type="number" tickFormatter={v => fmtCompact(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={86} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number) => [`${fmtWon(v)}원`, '당월 지출']} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="amount" fill="hsl(152 60% 34%)" radius={[0, 3, 3, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel p-4">
          <h2 className="text-sm font-semibold mb-3">신규 거래처 (검토 대상)</h2>
          {newVendors.length === 0 ? (
            <p className="text-xs text-muted-foreground">당월 신규 발생 거래처가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {newVendors.map(v => (
                <div key={v.name} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0">
                  <div>
                    <span>{v.name}</span>
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))]">신규</span>
                  </div>
                  <span className="num">{fmtWon(v.amount)}원 <span className="text-xs text-muted-foreground">({v.count}건)</span></span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground pt-1">신규 거래처는 사업자 상태·지급 조건 확인 후 거래하는 것이 안전합니다.</p>
            </div>
          )}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">거래처별 상세</h2>
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="bg-secondary sticky top-0">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">거래처명</th>
                <th className="px-4 py-2 text-right font-medium">당월 지출</th>
                <th className="px-4 py-2 text-right font-medium">비중</th>
                <th className="px-4 py-2 text-right font-medium">당월 건수</th>
                <th className="px-4 py-2 text-right font-medium">연간 누계(YTD)</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map(v => (
                <tr key={v.name} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-2">
                    {v.name}
                    {v.isNew && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))]">신규</span>}
                  </td>
                  <td className="px-4 py-2 text-right num">{fmtWon(v.amount)}</td>
                  <td className="px-4 py-2 text-right num text-muted-foreground">{fmtPct(v.share)}</td>
                  <td className="px-4 py-2 text-right num text-muted-foreground">{v.count}</td>
                  <td className="px-4 py-2 text-right num">{fmtWon(v.ytd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
