import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Sparkles, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { SheetData } from '@/components/FileUpload';
import type { MappedRow, BudgetRecord, MappingProfile, MatchConfidence, RawRow } from '@/types/finance';
import {
  ACTUAL_FIELDS, BUDGET_FIELDS, autoMapColumns, detectHeaderRow, detectMonthColumns, headerSignature,
} from '@/lib/columnMapping';
import {
  applyActualMapping, applyBudgetLongMapping, applyBudgetWideMapping, type ValidationIssue,
} from '@/lib/dataProcessing';
import { geminiJSON, hasGeminiKey } from '@/lib/gemini';
import { periodLabel } from '@/lib/normalize';

export interface MappingConfirmPayload {
  kind: 'actual' | 'budget';
  fileName: string;
  actualRows?: MappedRow[];
  budgetRows?: BudgetRecord[];
  periods: string[];
  version?: string;
}

interface ColumnMapperProps {
  kind: 'actual' | 'budget';
  fileName: string;
  sheets: SheetData[];
  profiles: MappingProfile[];
  geminiModel: string;
  onConfirm: (payload: MappingConfirmPayload) => void;
  onSaveProfile: (p: MappingProfile) => void;
  onCancel: () => void;
}

const confBadge: Record<MatchConfidence, { label: string; cls: string }> = {
  high: { label: '자동', cls: 'bg-accent text-accent-foreground' },
  medium: { label: '추정 — 확인', cls: 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning-foreground))]' },
  none: { label: '미지정', cls: 'bg-muted text-muted-foreground' },
};

export default function ColumnMapper({ kind, fileName, sheets, profiles, geminiModel, onConfirm, onSaveProfile, onCancel }: ColumnMapperProps) {
  const fields = kind === 'actual' ? ACTUAL_FIELDS : BUDGET_FIELDS;
  const [sheetIdx, setSheetIdx] = useState(0);
  const rows2d = sheets[sheetIdx]?.rows ?? [];
  const [headerRow, setHeaderRow] = useState(() => detectHeaderRow(rows2d));

  const headers = useMemo(
    () => (rows2d[headerRow] || []).map((c, i) => (c != null && String(c).trim() !== '' ? String(c).trim() : `(빈 컬럼 ${i + 1})`)),
    [rows2d, headerRow],
  );

  const dataRows: RawRow[] = useMemo(() => {
    return rows2d.slice(headerRow + 1).map(arr => {
      const o: RawRow = {};
      headers.forEach((h, i) => { o[h] = (arr as unknown[])[i] as string | number | null; });
      return o;
    });
  }, [rows2d, headerRow, headers]);

  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [confidence, setConfidence] = useState<Record<string, MatchConfidence>>({});
  const [unit, setUnit] = useState<1 | 1000>(1);
  const [periodMode, setPeriodMode] = useState<'from_date' | 'fixed'>('from_date');
  const [fixedPeriod, setFixedPeriod] = useState('');
  const [budgetLayout, setBudgetLayout] = useState<'long' | 'wide'>('long');
  const [wideYear, setWideYear] = useState(String(new Date().getFullYear()));
  const [version, setVersion] = useState('본예산');
  const [profileName, setProfileName] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [appliedProfile, setAppliedProfile] = useState<string | null>(null);

  const signature = useMemo(() => headerSignature(headers), [headers]);

  // 자동 매핑 + 프로파일 자동 적용
  useEffect(() => {
    const matched = profiles.find(p => p.kind === kind && p.signature === signature);
    if (matched) {
      setMapping(prev => ({ ...Object.fromEntries(headers.map(h => [h, null])), ...matched.mapping }));
      setConfidence(Object.fromEntries(headers.map(h => [h, matched.mapping[h] ? 'high' : 'none'])) as Record<string, MatchConfidence>);
      setUnit(matched.unit);
      if (matched.periodMode) setPeriodMode(matched.periodMode);
      if (matched.budgetLayout) setBudgetLayout(matched.budgetLayout);
      setAppliedProfile(matched.name);
      return;
    }
    const auto = autoMapColumns(headers, fields);
    setMapping(auto.mapping);
    setConfidence(auto.confidence);
    setAppliedProfile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, kind]);

  // 가로형 예산: 월 컬럼 자동 인식
  const monthCols = useMemo(
    () => (kind === 'budget' && budgetLayout === 'wide' ? detectMonthColumns(headers, parseInt(wideYear) || undefined) : {}),
    [kind, budgetLayout, headers, wideYear],
  );

  const setField = (header: string, key: string | null) => {
    setMapping(prev => {
      const next = { ...prev };
      // 동일 필드 중복 배정 해제
      if (key) for (const h of Object.keys(next)) if (next[h] === key && h !== header) next[h] = null;
      next[header] = key;
      return next;
    });
    setConfidence(prev => ({ ...prev, [header]: key ? 'high' : 'none' }));
  };

  // ── 미리 적용해서 검증 리포트 생성 ──
  const preview = useMemo(() => {
    const datasetId = `ds-${Date.now()}`;
    if (kind === 'actual') {
      return { kind: 'actual' as const, result: applyActualMapping(dataRows, mapping, { unit, periodMode, fixedPeriod: fixedPeriod || undefined, datasetId }) };
    }
    if (budgetLayout === 'wide') {
      const accountCol = Object.keys(mapping).find(h => mapping[h] === 'account_name');
      if (!accountCol) return { kind: 'budget' as const, result: null };
      return {
        kind: 'budget' as const,
        result: applyBudgetWideMapping(dataRows, accountCol, monthCols, {
          unit,
          codeCol: Object.keys(mapping).find(h => mapping[h] === 'account_code'),
          ccCol: Object.keys(mapping).find(h => mapping[h] === 'cost_center'),
          fixedVersion: version || '본예산',
          datasetId,
        }),
      };
    }
    return {
      kind: 'budget' as const,
      result: applyBudgetLongMapping(dataRows, mapping, { unit, fallbackYear: parseInt(wideYear) || undefined, fixedVersion: version || '본예산', datasetId }),
    };
  }, [kind, dataRows, mapping, unit, periodMode, fixedPeriod, budgetLayout, monthCols, version, wideYear]);

  const requiredMissing = useMemo(() => {
    const assigned = new Set(Object.values(mapping).filter(Boolean));
    if (kind === 'budget' && budgetLayout === 'wide') {
      const miss: string[] = [];
      if (!assigned.has('account_name')) miss.push('계정명');
      if (Object.keys(monthCols).length === 0) miss.push('월 컬럼(자동 인식 실패)');
      return miss;
    }
    return fields.filter(f => f.required && !assigned.has(f.key))
      .filter(f => !(kind === 'actual' && f.key === 'posting_date' && periodMode === 'fixed' && fixedPeriod))
      .map(f => f.label);
  }, [mapping, fields, kind, budgetLayout, monthCols, periodMode, fixedPeriod]);

  const issues: ValidationIssue[] = preview.result?.issues ?? [];
  const recordCount = preview.kind === 'actual'
    ? (preview.result?.records.length ?? 0)
    : (preview.result?.records.length ?? 0);

  const handleAISuggest = async () => {
    const unmapped = headers.filter(h => !mapping[h] && !h.startsWith('(빈 컬럼'));
    if (unmapped.length === 0) { toast.info('미지정 컬럼이 없습니다.'); return; }
    setAiLoading(true);
    try {
      const samples = unmapped.map(h => ({ header: h, samples: dataRows.slice(0, 3).map(r => String(r[h] ?? '')).filter(Boolean) }));
      const fieldList = fields.map(f => `${f.key}: ${f.label}`).join('\n');
      const res = await geminiJSON<Record<string, string | null>>(
        `다음은 회계 엑셀의 컬럼명과 샘플 값입니다. 각 컬럼을 표준 필드에 매핑하십시오. 해당 없으면 null.\n\n표준 필드:\n${fieldList}\n\n컬럼:\n${JSON.stringify(samples, null, 2)}\n\n출력 형식: {"컬럼명": "필드key 또는 null", ...}`,
        { model: geminiModel },
      );
      let applied = 0;
      const validKeys = new Set(fields.map(f => f.key));
      setMapping(prev => {
        const next = { ...prev };
        for (const [h, k] of Object.entries(res)) {
          if (k && validKeys.has(k) && next[h] === null && !Object.values(next).includes(k)) { next[h] = k; applied++; }
        }
        return next;
      });
      setConfidence(prev => {
        const next = { ...prev };
        for (const [h, k] of Object.entries(res)) if (k) next[h] = 'medium';
        return next;
      });
      toast.success(`AI 제안 ${applied}건 적용 (추정 표시 — 확인 필요)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 매핑 제안 실패');
    } finally {
      setAiLoading(false);
    }
  };

  const handleConfirm = () => {
    if (requiredMissing.length > 0) {
      toast.error(`필수 항목 미지정: ${requiredMissing.join(', ')}`);
      return;
    }
    if (!preview.result || recordCount === 0) {
      toast.error('반영할 데이터가 없습니다. 헤더 행과 매핑을 확인해주세요.');
      return;
    }
    if (preview.kind === 'actual') {
      onConfirm({ kind: 'actual', fileName, actualRows: preview.result.records as MappedRow[], periods: preview.result.periods });
    } else {
      onConfirm({ kind: 'budget', fileName, budgetRows: preview.result.records as BudgetRecord[], periods: preview.result.periods, version });
    }
  };

  const handleSaveProfile = () => {
    if (!profileName.trim()) { toast.error('프로파일 이름을 입력해주세요.'); return; }
    onSaveProfile({
      id: `prof-${Date.now()}`,
      name: profileName.trim(),
      kind, signature,
      headerRowIndex: headerRow,
      sheetName: sheets[sheetIdx]?.name,
      mapping, unit, periodMode, budgetLayout,
      created_at: new Date().toISOString(),
    });
    toast.success('매핑 프로파일 저장 완료 — 같은 양식은 다음부터 자동 적용됩니다.');
    setProfileName('');
  };

  const sampleRows = dataRows.slice(0, 5);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <button onClick={onCancel} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1">
              <ArrowLeft className="h-4 w-4" /> 돌아가기
            </button>
            <h1 className="text-xl font-bold">{kind === 'actual' ? '실적 데이터' : '예산 데이터'} 컬럼 매핑</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {fileName}
              {appliedProfile && <span className="ml-2 text-primary">· 프로파일 "{appliedProfile}" 자동 적용됨</span>}
            </p>
          </div>
          <Button onClick={handleConfirm} className="gap-2"><Check className="h-4 w-4" /> 매핑 확정 및 반영</Button>
        </div>

        {/* 시트 / 헤더 행 / 단위 / 옵션 */}
        <div className="panel p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">시트 선택</label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-2"
              value={sheetIdx} onChange={e => { setSheetIdx(+e.target.value); setHeaderRow(detectHeaderRow(sheets[+e.target.value]?.rows ?? [])); }}>
              {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length}행)</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">헤더(제목) 행 — {headerRow + 1}행</label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-2"
              value={headerRow} onChange={e => setHeaderRow(+e.target.value)}>
              {rows2d.slice(0, 10).map((r, i) => (
                <option key={i} value={i}>{i + 1}행: {(r as unknown[]).slice(0, 4).map(c => String(c ?? '')).join(' | ').slice(0, 40) || '(빈 행)'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">금액 단위</label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-2" value={unit} onChange={e => setUnit(+e.target.value as 1 | 1000)}>
              <option value={1}>원</option>
              <option value={1000}>천원 (×1,000 반영)</option>
            </select>
          </div>
          {kind === 'actual' ? (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">귀속월 결정</label>
              <div className="flex gap-2">
                <select className="flex-1 h-9 rounded-md border border-input bg-background px-2" value={periodMode} onChange={e => setPeriodMode(e.target.value as 'from_date' | 'fixed')}>
                  <option value="from_date">전표일자에서 파생</option>
                  <option value="fixed">직접 지정</option>
                </select>
                {periodMode === 'fixed' && (
                  <Input className="w-28 h-9" placeholder="2026-06" value={fixedPeriod} onChange={e => setFixedPeriod(e.target.value)} />
                )}
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">예산 양식 / 버전</label>
              <div className="flex gap-2">
                <select className="h-9 rounded-md border border-input bg-background px-2" value={budgetLayout} onChange={e => setBudgetLayout(e.target.value as 'long' | 'wide')}>
                  <option value="long">세로형(월 컬럼 1개)</option>
                  <option value="wide">가로형(1월~12월 컬럼)</option>
                </select>
                <Input className="w-24 h-9" placeholder="버전" value={version} onChange={e => setVersion(e.target.value)} />
                {budgetLayout === 'wide' && (
                  <Input className="w-20 h-9" placeholder="연도" value={wideYear} onChange={e => setWideYear(e.target.value)} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* 매핑 테이블 */}
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">컬럼 매핑 ({headers.length}개 컬럼)</h2>
            {hasGeminiKey() && (
              <Button variant="outline" size="sm" onClick={handleAISuggest} disabled={aiLoading} className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> {aiLoading ? '분석 중…' : '미지정 컬럼 AI 제안'}
              </Button>
            )}
          </div>
          <div className="overflow-x-auto scrollbar-thin max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">원본 컬럼</th>
                  <th className="px-4 py-2 font-medium">샘플 값</th>
                  <th className="px-4 py-2 font-medium w-56">표준 필드</th>
                  <th className="px-4 py-2 font-medium w-28">상태</th>
                </tr>
              </thead>
              <tbody>
                {headers.map(h => {
                  const isMonthCol = kind === 'budget' && budgetLayout === 'wide' && monthCols[h];
                  return (
                    <tr key={h} className="border-t border-border hover:bg-muted/40">
                      <td className="px-4 py-2 font-medium">{h}</td>
                      <td className="px-4 py-2 text-muted-foreground text-xs">
                        {sampleRows.map(r => String(r[h] ?? '')).filter(Boolean).slice(0, 2).join(' · ').slice(0, 40)}
                      </td>
                      <td className="px-4 py-2">
                        {isMonthCol ? (
                          <span className="text-xs text-primary font-medium">월 컬럼 → {periodLabel(monthCols[h])}</span>
                        ) : (
                          <select className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                            value={mapping[h] ?? ''} onChange={e => setField(h, e.target.value || null)}>
                            <option value="">매핑 안 함</option>
                            {fields.map(f => <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {isMonthCol ? (
                          <span className={`text-[11px] px-2 py-0.5 rounded ${confBadge.high.cls}`}>자동</span>
                        ) : (
                          <span className={`text-[11px] px-2 py-0.5 rounded ${confBadge[confidence[h] ?? 'none'].cls}`}>
                            {confBadge[confidence[h] ?? 'none'].label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 검증 리포트 */}
        <div className="panel p-4">
          <h2 className="text-sm font-semibold mb-2">반영 전 검증</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-md bg-secondary p-3">
              <div className="text-xs text-muted-foreground">반영 예정</div>
              <div className="font-semibold num">{recordCount.toLocaleString()}건</div>
            </div>
            <div className="rounded-md bg-secondary p-3">
              <div className="text-xs text-muted-foreground">빈 행 제외</div>
              <div className="font-semibold num">{(preview.result?.skipped ?? 0).toLocaleString()}건</div>
            </div>
            <div className={`rounded-md p-3 ${issues.length > 0 ? 'bg-[hsl(var(--warning))]/10' : 'bg-secondary'}`}>
              <div className="text-xs text-muted-foreground">검증 경고</div>
              <div className="font-semibold num">{issues.length.toLocaleString()}건</div>
            </div>
            <div className="rounded-md bg-secondary p-3">
              <div className="text-xs text-muted-foreground">귀속월 범위</div>
              <div className="font-semibold text-xs pt-1">
                {preview.result && preview.result.periods.length > 0
                  ? `${preview.result.periods[0]} ~ ${preview.result.periods[preview.result.periods.length - 1]} (${preview.result.periods.length}개월)`
                  : '-'}
              </div>
            </div>
          </div>
          {requiredMissing.length > 0 && (
            <p className="text-sm text-destructive mt-3">필수 항목 미지정: {requiredMissing.join(', ')}</p>
          )}
          {issues.length > 0 && (
            <div className="mt-3 max-h-36 overflow-y-auto scrollbar-thin rounded-md border border-border">
              <table className="w-full text-xs">
                <tbody>
                  {issues.slice(0, 50).map((it, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5 text-muted-foreground w-20">{it.row}행</td>
                      <td className="px-3 py-1.5 w-32">{it.field}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{it.problem}{it.value ? ` — "${it.value.slice(0, 24)}"` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {issues.length > 50 && <p className="px-3 py-1.5 text-xs text-muted-foreground">외 {issues.length - 50}건</p>}
            </div>
          )}
        </div>

        {/* 프로파일 저장 */}
        <div className="panel p-4 flex items-center gap-3">
          <Save className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input placeholder='매핑 프로파일 이름 (예: "ERP 전표 다운로드 양식")' value={profileName} onChange={e => setProfileName(e.target.value)} className="max-w-sm h-9" />
          <Button variant="outline" size="sm" onClick={handleSaveProfile}>프로파일 저장</Button>
          <p className="text-xs text-muted-foreground">저장하면 동일한 헤더 구성의 파일은 다음부터 자동 매핑됩니다.</p>
        </div>
      </div>
    </div>
  );
}
