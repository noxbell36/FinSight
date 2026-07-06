import {
  LayoutDashboard, Scale, MessageSquareText, ClipboardCheck, Building2,
  TrendingUp, FileText, Database, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const navGroups = [
  {
    label: '분석',
    items: [
      { id: 'overview', label: '월별 비용 현황', icon: LayoutDashboard },
      { id: 'bva', label: '예산 대비 실적', icon: Scale },
      { id: 'trend', label: '추이 분석', icon: TrendingUp },
      { id: 'vendor', label: '거래처 분석', icon: Building2 },
    ],
  },
  {
    label: '마감 검토',
    items: [
      { id: 'variance', label: '차이분석·변동사유', icon: MessageSquareText },
      { id: 'review', label: '전표·경비 검토', icon: ClipboardCheck },
      { id: 'report', label: '월간 리포트', icon: FileText },
    ],
  },
  {
    label: '관리',
    items: [
      { id: 'data', label: '데이터 관리', icon: Database },
      { id: 'settings', label: '환경 설정', icon: Settings },
    ],
  },
];

export default function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  return (
    <aside className="w-56 shrink-0 border-r border-sidebar-border bg-sidebar-background min-h-screen flex flex-col no-print">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <h1 className="text-base font-bold text-sidebar-foreground">FinPilot</h1>
        <p className="text-[11px] text-muted-foreground mt-0.5">비용·예산 대비 실적 분석</p>
      </div>
      <nav className="flex-1 py-3 space-y-4">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="px-5 pb-1.5 text-[11px] font-medium text-muted-foreground">{group.label}</p>
            {group.items.map(item => (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-5 py-2 text-sm transition-colors',
                  activeTab === item.id
                    ? 'bg-sidebar-accent text-sidebar-primary font-semibold border-r-2 border-sidebar-primary'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-sidebar-border">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          데이터는 이 브라우저(로컬)에만 저장됩니다.
        </p>
      </div>
    </aside>
  );
}
