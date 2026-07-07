import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell, PieChart, Pie, Legend, AreaChart, Area,
} from 'recharts';
import { fmtWon, fmtCompact } from '@/lib/format';
import type { WaterfallStep } from '@/lib/insightEngine';

const GREEN = 'hsl(152 60% 34%)';
const GREEN_SOFT = 'hsl(152 60% 34% / 0.35)';
const RED = 'hsl(0 72% 45%)';
const GRID = 'hsl(220 13% 90%)';
const MUTED = 'hsl(220 9% 46%)';

/** KPI 카드용 미니 추이 (경량 SVG) */
export function Sparkline({ data, height = 26 }: { data: number[]; height?: number }) {
  if (data.length < 2) return null;
  const w = 100;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - 3 - ((v - min) / range) * (height - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={GREEN} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** 전월비 증감 워터폴: 전월 → 계정별 증감 → 당월 */
export function WaterfallChart({ prevTotal, currTotal, steps, prevLabel, currLabel, height = 240 }: {
  prevTotal: number; currTotal: number; steps: WaterfallStep[]; prevLabel: string; currLabel: string; height?: number;
}) {
  let running = prevTotal;
  const data: { name: string; base: number; value: number; kind: 'total' | 'up' | 'down' }[] = [
    { name: prevLabel, base: 0, value: prevTotal, kind: 'total' },
  ];
  for (const s of steps) {
    const base = s.value >= 0 ? running : running + s.value;
    data.push({ name: s.name, base, value: Math.abs(s.value), kind: s.value >= 0 ? 'up' : 'down' });
    running += s.value;
  }
  data.push({ name: currLabel, base: 0, value: currTotal, kind: 'total' });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10.5 }} tickLine={false} axisLine={false} interval={0} angle={-14} textAnchor="end" height={44} />
        <YAxis tickFormatter={v => fmtCompact(v)} tick={{ fontSize: 10.5 }} tickLine={false} axisLine={false} width={50} />
        <Tooltip
          formatter={(v: number, _n: string, p: { payload?: { kind?: string } }) =>
            [`${fmtWon(v)}원`, p?.payload?.kind === 'down' ? '감소' : p?.payload?.kind === 'up' ? '증가' : '총액']}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.kind === 'total' ? GREEN : d.kind === 'up' ? RED : 'hsl(210 70% 50%)'} fillOpacity={d.kind === 'total' ? 0.9 : 0.75} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** 월별 실적(막대) vs 예산(선) 콤보 */
export function BudgetActualCombo({ data, height = 240 }: {
  data: { label: string; actual: number; budget: number | null }[]; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={v => fmtCompact(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
        <Tooltip formatter={(v: number, name: string) => [`${fmtWon(v)}원`, name === 'actual' ? '실적' : '예산']} contentStyle={{ fontSize: 12 }} />
        <Legend formatter={(v) => (v === 'actual' ? '실적' : '예산')} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="actual" fill={GREEN_SOFT} radius={[3, 3, 0, 0]} />
        <Line type="monotone" dataKey="budget" stroke={MUTED} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const DONUT_COLORS = ['hsl(152 60% 34%)', 'hsl(152 45% 48%)', 'hsl(200 60% 45%)', 'hsl(220 30% 55%)', 'hsl(38 80% 50%)', 'hsl(0 55% 55%)', 'hsl(260 35% 55%)', 'hsl(180 35% 45%)'];

/** 부서(또는 임의 구성) 도넛 */
export function CompositionDonut({ data, height = 220 }: { data: { name: string; value: number }[]; height?: number }) {
  const top = data.slice(0, 7);
  const rest = data.slice(7).reduce((s, d) => s + d.value, 0);
  const chart = rest > 0 ? [...top, { name: '기타', value: rest }] : top;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={chart} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={1.5} strokeWidth={1}>
          {chart.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => `${fmtWon(v)}원`} contentStyle={{ fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11.5 }} iconSize={9} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** 일별 지출 라인 (전표 검토 보조) */
export function DailyExpenseArea({ data, height = 160 }: { data: { date: string; amount: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={d => d.slice(8)} />
        <YAxis tickFormatter={v => fmtCompact(v)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={46} />
        <Tooltip formatter={(v: number) => [`${fmtWon(v)}원`, '일 지출']} contentStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="amount" stroke={GREEN} fill={GREEN_SOFT} strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
