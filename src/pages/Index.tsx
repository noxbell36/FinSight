import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { AppStore, CommentaryEntry, DatasetMeta, MappingProfile, MonthlyAnalysis } from '@/types/finance';
import { EMPTY_STORE } from '@/types/finance';
import type { AppSettings } from '@/types/settings';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/types/settings';
import { kvGet, kvSet, kvClearAll } from '@/lib/db';
import { availablePeriods, budgetVersions } from '@/lib/insights';
import { buildMonthlyInsights } from '@/lib/insightEngine';
import { runMonthlyAnalysis, analysisMapKey, analysisCacheKey, isAnalysisAttempted, type AnalysisStatus } from '@/lib/aiPipeline';
import { hasGeminiKey, geminiCooldownRemaining } from '@/lib/gemini';
import { generateDemoTransactions, generateDemoBudgets, demoDatasetMetas } from '@/lib/demoData';
import FileUpload, { type SheetData } from '@/components/FileUpload';
import ColumnMapper, { type MappingConfirmPayload } from '@/components/ColumnMapper';
import AppSidebar from '@/components/AppSidebar';
import MonthlyOverview from '@/views/MonthlyOverview';
import BvaView from '@/views/BvaView';
import DetailView from '@/views/DetailView';
import ClosingView from '@/views/ClosingView';
import ReportView from '@/views/ReportView';
import DataManager from '@/views/DataManager';
import SettingsView from '@/views/SettingsView';

const STORE_KEYS = ['transactions', 'budgets', 'datasets', 'commentary', 'reviews', 'profiles', 'reportNotes', 'analyses'] as const;

interface UploadFlow {
  kind: 'actual' | 'budget';
  fileName: string;
  sheets: SheetData[];
}

const Index = () => {
  const [store, setStore] = useState<AppStore | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState('overview');
  const [uploadFlow, setUploadFlow] = useState<UploadFlow | null>(null);
  const [period, setPeriodState] = useState<string>('');
  const [version, setVersionState] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [keyBump, setKeyBump] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const loaded = useRef(false);
  const runningKey = useRef<string | null>(null);

  // ── 초기 로드 ──
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

  // ── 저장 ──
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

  useEffect(() => {
    if (periods.length === 0) return;
    if (!period || !periods.includes(period)) setPeriodState(periods[periods.length - 1]);
  }, [periods, period]);

  useEffect(() => {
    if (versions.length === 0) { setVersionState(null); return; }
    if (!version || !versions.includes(version)) {
      setVersionState(versions.includes('수정예산') ? '수정예산' : versions[versions.length - 1]);
    }
  }, [versions, version]);

  const pack = useMemo(() => {
    if (!store || !period || store.transactions.length === 0) return null;
    return buildMonthlyInsights(store.transactions, store.budgets, period, version, settings);
  }, [store, period, version, settings]);

  const mapKey = period ? analysisMapKey(period, version) : '';
  // 구버전 캐시(highlights 등 신규 필드 없음) 호환: 읽을 때 기본값으로 정규화
  const analysis: MonthlyAnalysis | null = useMemo(() => {
    const raw = store && mapKey ? store.analyses[mapKey] : null;
    if (!raw) return null;
    return {
      highlights: [], risks: [], improvements: [], next_points: [],
      ...raw,
      findings: Array.isArray(raw.findings) ? raw.findings : [],
    } as MonthlyAnalysis;
  }, [store, mapKey]);

  const mutate = useCallback((fn: (prev: AppStore) => AppStore) => {
    setStore(prev => (prev ? fn(prev) : prev));
  }, []);

  /**
   * 월 선택 시 자동 실행.
   * 핵심: 오류 결과도 캐시에 남아 "시도됨"으로 취급 → 자동 재호출 루프 없음.
   * 재시도는 사용자가 "다시 시도" 버튼을 누를 때만 (retryAnalysis).
   */
  useEffect(() => {
    if (!store || !period || !pack || store.transactions.length === 0) return;
    if (!hasGeminiKey()) { setAnalysisStatus('no-key'); return; }

    const cacheKey = analysisCacheKey(store.transactions, period, version);
    const cached = store.analyses[mapKey];
    if (isAnalysisAttempted(cached, cacheKey)) {
      setAnalysisStatus(cached!.error ? 'error' : 'done');
      return;
    }

    // 전역 쿨다운 중이면 호출하지 않고 대기 (월을 옮겨도 추가 호출 없음)
    const cd = geminiCooldownRemaining();
    if (cd > 0) {
      setAnalysisStatus('cooldown');
      setCooldownLeft(cd);
      return;
    }

    if (runningKey.current === cacheKey) return;

    runningKey.current = cacheKey;
    setAnalysisStatus('running');
    runMonthlyAnalysis(store.transactions, store.budgets, period, version, settings, pack)
      .then(result => {
        const is429 = !!result.error && result.error.includes('429');
        if (is429) {
          // 한도 초과는 캐시하지 않음 → 쿨다운 종료 후 자동 재시도
          setAnalysisStatus('cooldown');
          setCooldownLeft(Math.max(geminiCooldownRemaining(), 5));
        } else {
          mutate(prev => ({ ...prev, analyses: { ...prev.analyses, [mapKey]: result } }));
          setAnalysisStatus(result.error ? 'error' : 'done');
        }
      })
      .finally(() => {
        if (runningKey.current === cacheKey) runningKey.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, period, version, pack, mapKey, settings.gemini_model, keyBump]);

  // 쿨다운 카운트다운 — 0이 되면 자동 재시도
  useEffect(() => {
    if (analysisStatus !== 'cooldown') return;
    const t = setInterval(() => {
      setCooldownLeft(prev => {
        if (prev <= 1) {
          clearInterval(t);
          setKeyBump(k => k + 1); // 효과 재실행 → 재시도
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [analysisStatus]);

  /** 수동 재시도: 해당 월 캐시를 지우면 위 효과가 1회 재실행 */
  const retryAnalysis = useCallback(() => {
    if (!mapKey) return;
    mutate(prev => {
      const analyses = { ...prev.analyses };
      delete analyses[mapKey];
      return { ...prev, analyses };
    });
    setKeyBump(k => k + 1);
  }, [mapKey, mutate]);

  // ── 데이터 액션 ──
  const loadDemo = useCallback(() => {
    const tx = generateDemoTransactions();
    const budgets = generateDemoBudgets();
    const metas = demoDatasetMetas(tx.length, budgets.length);
    mutate(prev => ({
      ...prev,
      transactions: [...prev.transactions.filter(r => r.dataset_id !== 'demo-actual'), ...tx],
      budgets: [...prev.budgets.filter(b => b.dataset_id !== 'demo-budget'), ...budgets],
      datasets: [...prev.datasets.filter(d => !d.id.startsWith('demo-')), ...metas],
      analyses: {},
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
      analyses: {},
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
      analyses: {},
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
    setAnalysisStatus('idle');
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

  // ── 렌더 ──
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
  const actualDs = store.datasets.filter(d => d.kind === 'actual');
  const isDemo = actualDs.some(d => d.id === 'demo-actual');
  const rangeLabel = periods.length > 0 ? `${periods[0].replace('-', '.')} ~ ${periods[periods.length - 1].replace('-', '.')}` : '';

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 min-w-0">
        {/* 데이터셋 헤더 — 어떤 데이터를 보고 있는지 상시 표시 */}
        <div className="no-print flex items-center gap-3 px-6 py-2 border-b border-border bg-card/60 text-xs text-muted-foreground">
          {isDemo && <span className="px-1.5 py-0.5 rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))] font-medium">데모 데이터</span>}
          <span>실적 {store.transactions.length.toLocaleString()}건 · {rangeLabel}{versions.length > 0 ? ` · 예산 ${versions.join('/')}` : ' · 예산 없음'}</span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setActiveTab('data')}>
            <Upload className="h-3 w-3" /> 파일 업로드 / 데이터 관리
          </Button>
        </div>

        {activeTab === 'overview' && hasPeriod && (
          <MonthlyOverview rows={store.transactions} budgets={store.budgets} periods={periods} period={period} setPeriod={setPeriodState}
            version={version} settings={settings} pack={pack} analysis={analysis} analysisStatus={analysisStatus}
            cooldownLeft={cooldownLeft} onRetryAnalysis={retryAnalysis}
            goToDetail={() => setActiveTab('detail')} goToClosing={() => setActiveTab('closing')} />
        )}
        {activeTab === 'bva' && hasPeriod && (
          <BvaView rows={store.transactions} budgets={store.budgets} periods={periods} period={period} setPeriod={setPeriodState}
            version={version} setVersion={setVersionState} settings={settings} goToData={() => setActiveTab('data')} pack={pack} />
        )}
        {activeTab === 'detail' && hasPeriod && (
          <DetailView rows={store.transactions} periods={periods} period={period} setPeriod={setPeriodState} pack={pack} />
        )}
        {activeTab === 'closing' && hasPeriod && (
          <ClosingView rows={store.transactions} budgets={store.budgets} periods={periods} period={period} setPeriod={setPeriodState}
            version={version} settings={settings} commentary={store.commentary} upsertCommentary={upsertCommentary}
            reviews={store.reviews} setReviewStatus={setReviewStatus} pack={pack} analysis={analysis} analysisStatus={analysisStatus} cooldownLeft={cooldownLeft} />
        )}
        {activeTab === 'report' && hasPeriod && (
          <ReportView rows={store.transactions} budgets={store.budgets} periods={periods} period={period} setPeriod={setPeriodState}
            version={version} settings={settings} commentary={store.commentary} reviews={store.reviews}
            reportNote={store.reportNotes[period] ?? ''} setReportNote={setReportNote}
            pack={pack} analysis={analysis} analysisStatus={analysisStatus} cooldownLeft={cooldownLeft} onRetryAnalysis={retryAnalysis} />
        )}
        {activeTab === 'data' && (
          <DataManager store={store} onStartMapping={startMapping} onLoadDemo={loadDemo}
            onDeleteDataset={deleteDataset} onDeleteProfile={deleteProfile} onResetAll={resetAll} />
        )}
        {activeTab === 'settings' && (
          <SettingsView settings={settings} setSettings={setSettings} onKeyChanged={() => setKeyBump(k => k + 1)} />
        )}
      </main>
    </div>
  );
};

export default Index;
