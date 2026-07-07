import { periodLabel } from '@/lib/normalize';
import { Sparkline } from '@/components/charts';

export function MonthSelect({ periods, value, onChange }: { periods: string[]; value: string; onChange: (p: string) => void }) {
  const desc = [...periods].sort().reverse();
  return (
    <select
      className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      {desc.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}
    </select>
  );
}

export function KpiCard({ label, value, sub, subClass, spark }: {
  label: string; value: string; sub?: string; subClass?: string; spark?: number[];
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold num mt-1.5">{value}</p>
      {sub && <p className={`text-xs mt-1 ${subClass ?? 'text-muted-foreground'}`}>{sub}</p>}
      {spark && spark.length > 1 && <div className="mt-2 opacity-80"><Sparkline data={spark} /></div>}
    </div>
  );
}

export function PageHeader({ title, desc, right }: { title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        {desc && <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel p-10 text-center text-sm text-muted-foreground">{children}</div>
  );
}
