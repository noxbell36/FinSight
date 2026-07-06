import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AppStore, CommentaryEntry, DatasetMeta, MappingProfile } from '@/types/finance';
import { EMPTY_STORE } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/types/settings';
import { kvGet, kvSet, kvClearAll } from '@/lib/db';
import { availablePeriods, budgetVersions } from '@/lib/insights';
import { generateDemoTransactions, generateDemoBudgets, demoDatasetMetas } from '@/lib/demoData';
import FileUpload, { type SheetData } from '@/components/FileUpload';
import ColumnMapper, { type MappingConfirmPayload } from '@/components/ColumnMapper';
import AppSidebar from '@/components/AppSidebar';
import MonthlyOverview from '@/views/MonthlyOverview';
import BvaView from '@/views/BvaView';
import VarianceView from '@/views/VarianceView';
import VoucherReview from '@/views/VoucherReview';
import VendorView from '@/views/VendorView';
import TrendView from '@/views/TrendView';
import ReportView from '@/views/ReportView';
import DataManager from '@/views/DataManager';
import SettingsView from '@/views/SettingsView';

const STORE_KEYS = ['transactions', 'budgets', 'datasets', 'commentary', 'reviews', 'profiles', 'reportNotes'] as const;

interface UploadFlow {
  kind: 'actual' | 'budget';
  fileName: string;
  sheets: SheetData[];
}

const Index = () => {
  const [store, setStore] = useState<AppStore | null>(null); // null = 로딩 중
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState('overview');
  const [uploadFlow, setUploadFlow] = useState<UploadFlow | null>(null);
  const [period, setPeriodState] = useState<string>('');
  const [version, setVersionState] = useState<string | null>(null);
  const loaded = useRef(false);

  // ── 초기 로드 (IndexedDB + localStorage 설정) ──
  useEffect(() => {
    (async () => {
      const next: AppStore = { ...EMPTY_STORE };
      for (const key of STORE_KEYS) {
        const v = await kvGet<unknown>(key);
        if (v != null) (next as Record<string, unknown>)[key] = v;
      }
      try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
      } catch { /* noop */ }
      setStore(next);
      loaded.current = true;
    })();
  }, []);

  // ── 저장 (로드 완료 후 변경 시) ──
  useEffect(() => {
    if (!loaded.current || !store) return;
    for (const key of STORE_KEYS) kvSet(key, store[key]);
  }, [store]);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); } catch { /* noop */ }
  }, [settings]);

  // ── 파생 상태 ──
  const periods = useMemo(() => (store ? availablePeriods(store.transactions) : []), [store]);
  const versions = useMemo(() => (store ? budgetVersions(store.budgets) : []), [store]);

  // 선택 월 기본값: 최신월
  useEffect(() => {
    if (periods.length === 0) return;
    if (!period || !periods.includes(period)) setPeriodState(periods[periods.length - 1]);
  }, [periods, period]);

  // 예산 버전 기본값: '수정예산' 우선, 없으면 마지막
  useEffect(() => {
    if (versions.length === 0) { setVersionState(null); return; }
    if (!version || !versions.includes(version)) {
      setVersionState(versions.includes('수정예산') ? '수정예산' : versions[versions.length - 1]);
    }
  }, [versions, version]);

  // ── 액션들 ──
  const mutate = useCallback((fn: (prev: AppStore) => AppStore) => {
    setStore(prev => (prev ? fn(prev) : prev));
  }, []);

  const loadDemo = useCallback(() => {
    const tx = generateDemoTransactions();
    const budgets = generateDemoBudgets();
    const metas = demoDatasetMetas(tx.length, budgets.length);
    mutate(prev => ({
      ...prev,
      transactions: [...prev.transactions.filter(r => r.dataset_id !== 'demo-actual'), ...tx],
      budgets: [...prev.budgets.filter(b => b.dataset_id !== 'demo-budget'), ...budgets],
      datasets: [...prev.datasets.filter(d => !d.id.startsWith('demo-')), ...metas],
    }));
    setActiveTab('overview');
    toast.success(`가상 데이터 로드 완료 — 실적 ${tx.length.toLocaleString()}건, 예산 ${budgets.length.toLocaleString()}건`);
  }, [mutate]);

  const startMapping = useCallback((kind: 'actual' | 'budget', sheets: SheetData[], fileName: string) => {
    setUploadFlow({ kind, sheets, fileName });
  }, []);

  const confirmMapping = useCallback((payload: MappingConfirmPayload) => {
    const dsId = (payload.actualRows?.[0]?.dataset_id) || (payload.budgetRows?.[0]?.dataset_id) || `ds-${Date.now()}`;
    const meta: DatasetMeta = {
      id: dsId,
      name: payload.fileName,
      kind: payload.kind,
      uploaded_at: new Date().toISOString(),
      row_count: payload.kind === 'actual' ? (payload.actualRows?.length ?? 0) : (payload.budgetRows?.length ?? 0),
      periods: payload.periods,
      version: payload.version,
    };
    mutate(prev => ({
      ...prev,
      transactions: payload.actualRows ? [...prev.transactions, ...payload.actualRows] : prev.transactions,
      budgets: payload.budgetRows ? [...prev.budgets, ...payload.budgetRows] : prev.budgets,
      datasets: [...prev.datasets, meta],
    }));
    setUploadFlow(null);
    setActiveTab(payload.kind === 'actual' ? 'overview' : 'bva');
    toast.success(`반영 완료 — ${meta.row_count.toLocaleString()}건`);
  }, [mutate]);

  const saveProfile = useCallback((p: MappingProfile) => {
    mutate(prev => ({ ...prev, profiles: [...prev.profiles.filter(x => !(x.kind === p.kind && x.signature === p.signature)), p] }));
  }, [mutate]);

  const deleteDataset = useCallback((id: string) => {
    mutate(prev => ({
      ...prev,
      transactions: prev.transactions.filter(r => r.dataset_id !== id),
      budgets: prev.budgets.filter(b => b.dataset_id !== id),
      datasets: prev.datasets.filter(d => d.id !== id),
    }));
    toast.success('데이터셋 삭제 완료');
  }, [mutate]);

  const deleteProfile = useCallback((id: string) => {
    mutate(prev => ({ ...prev, profiles: prev.profiles.filter(p => p.id !== id) }));
  }, [mutate]);

  const resetAll = useCallback(() => {
    kvClearAll();
    setStore({ ...EMPTY_STORE });
    setPeriodState('');
    setVersionState(null);
    setActiveTab('data');
  }, []);

  const upsertCommentary = useCallback((entry: CommentaryEntry) => {
    mutate(prev => ({ ...prev, commentary: [...prev.commentary.filter(c => c.id !== entry.id), entry] }));
  }, [mutate]);

  const setReviewStatus = useCallback((key: string, status: 'done' | 'flagged' | null) => {
    mutate(prev => {
      const reviews = { ...prev.reviews };
      if (status) reviews[key] = status; else delete reviews[key];
      return { ...prev, reviews };
    });
  }, [mutate]);

  const setReportNote = useCallback((p: string, note: string) => {
    mutate(prev => ({ ...prev, reportNotes: { ...prev.reportNotes, [p]: note } }));
  }, [mutate]);

  // ── 렌더 분기 ──
  if (!store) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">데이터를 불러오는 중…</div>;
  }

  if (uploadFlow) {
    return (
      <ColumnMapper
        kind={uploadFlow.kind}
        fileName={uploadFlow.fileName}
        sheets={uploadFlow.sheets}
        profiles={store.profiles}
        geminiModel={settings.gemini_model}
        onConfirm={confirmMapping}
        onSaveProfile={saveProfile}
        onCancel={() => setUploadFlow(null)}
      />
    );
  }

  // 실적 데이터가 없으면 랜딩(업로드) 화면
  if (store.transactions.length === 0) {
    return (
      <FileUpload
        kind="actual"
        onWorkbookLoaded={(sheets, name) => startMapping('actual', sheets, name)}
        onLoadDemo={loadDemo}
      />
    );
  }

  const hasPeriod = periods.length > 0 && !!period;

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 min-w-0">
        {activeTab === 'overview' && hasPeriod && (
          <MonthlyOverview rows={store.transactions} budgets={store.budgets} periods={periods} period={period} setPeriod={setPeriodState} version={version} settings={settings} />
        )}
        {activeTab === 'bva' && hasPeriod && (
          <BvaView rows={store.transactions} budgets={store.budgets} periods={periods} period={period} setPeriod={setPeriodState}
            version={version} setVersion={setVersionState} settings={settings} goToData={() => setActiveTab('data')} />
        )}
        {activeTab === 'trend' && <TrendView rows={store.transactions} />}
        {activeTab === 'vendor' && hasPeriod && (
          <VendorView rows={store.transactions} periods={periods} period={period} setPeriod={setPeriodState} />
        )}
        {activeTab === 'variance' && hasPeriod && (
          <VarianceView rows={store.transactions} budgets={store.budgets} periods={periods} period={period} setPeriod={setPeriodState}
            version={version} settings={settings} commentary={store.commentary} upsertCommentary={upsertCommentary} />
        )}
        {activeTab === 'review' && hasPeriod && (
          <VoucherReview rows={store.transactions} periods={periods} period={period} setPeriod={setPeriodState}
            settings={settings} reviews={store.reviews} setReviewStatus={setReviewStatus} />
        )}
        {activeTab === 'report' && hasPeriod && (
          <ReportView rows={store.transactions} budgets={store.budgets} periods={periods} period={period} setPeriod={setPeriodState}
            version={version} settings={settings} commentary={store.commentary}
            reportNote={store.reportNotes[period] ?? ''} setReportNote={setReportNote} />
        )}
        {activeTab === 'data' && (
          <DataManager store={store} onStartMapping={startMapping} onLoadDemo={loadDemo}
            onDeleteDataset={deleteDataset} onDeleteProfile={deleteProfile} onResetAll={resetAll} />
        )}
        {activeTab === 'settings' && <SettingsView settings={settings} setSettings={setSettings} />}
      </main>
    </div>
  );
};

export default Index;
