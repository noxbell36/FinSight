import { useState } from 'react';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AppSettings } from '@/types/settings';
import { getGeminiKey, setGeminiKey, geminiGenerate } from '@/lib/gemini';
import { PageHeader } from '@/components/shared';

interface Props {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}

export default function SettingsView({ settings, setSettings }: Props) {
  const [keyInput, setKeyInput] = useState(getGeminiKey());
  const [testing, setTesting] = useState(false);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings({ ...settings, [key]: value });
  };

  const numField = (key: keyof AppSettings, value: string, transform: (n: number) => number = n => n) => {
    const n = parseFloat(value);
    if (!isNaN(n)) update(key, transform(n) as AppSettings[typeof key]);
  };

  const handleSaveKey = () => {
    setGeminiKey(keyInput);
    toast.success(keyInput ? 'API 키 저장 완료 (이 브라우저에만 저장됨)' : 'API 키 삭제 완료');
  };

  const handleTest = async () => {
    setGeminiKey(keyInput);
    setTesting(true);
    try {
      await geminiGenerate('연결 테스트입니다. "OK"라고만 답하십시오.', { model: settings.gemini_model });
      toast.success('Gemini API 연결 성공');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '연결 실패');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <PageHeader title="환경 설정" desc="회사 정보, AI 연동, 검토 판정 기준을 설정합니다." />

      {/* 회사 */}
      <div className="panel p-5 mb-5">
        <h2 className="text-sm font-semibold mb-3">회사 정보</h2>
        <label className="text-xs text-muted-foreground block mb-1">회사명 (월간 리포트 표기)</label>
        <Input value={settings.company_name} onChange={e => update('company_name', e.target.value)} placeholder="(주)회사명" className="max-w-sm" />
      </div>

      {/* Gemini */}
      <div className="panel p-5 mb-5">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><KeyRound className="h-4 w-4" /> Google Gemini API</h2>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          변동사유 초안·컬럼 매핑 제안·리포트 요약에 사용됩니다. 키는 <b>이 브라우저의 localStorage에만</b> 저장되며 서버·저장소로 전송되지 않습니다.
          키는 Google AI Studio(aistudio.google.com)에서 무료로 발급받을 수 있습니다.
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <Input
            type="password"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            placeholder="AIza… 형식의 API 키"
            className="max-w-md font-mono text-sm"
            autoComplete="off"
          />
          <Button variant="outline" size="sm" onClick={handleSaveKey}>저장</Button>
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || !keyInput} className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> {testing ? '테스트 중…' : '연결 테스트'}
          </Button>
        </div>
        <div className="mt-4">
          <label className="text-xs text-muted-foreground block mb-1">모델</label>
          <Input value={settings.gemini_model} onChange={e => update('gemini_model', e.target.value)} className="max-w-xs font-mono text-sm" />
          <p className="text-[11px] text-muted-foreground mt-1">기본값 gemini-2.5-flash. 사용 가능한 다른 모델명으로 변경할 수 있습니다.</p>
        </div>
      </div>

      {/* 판정 기준 */}
      <div className="panel p-5">
        <h2 className="text-sm font-semibold mb-4">검토 판정 기준</h2>
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">예산 집행률 경보 기준 (%)</label>
            <Input type="number" value={Math.round(settings.budget_warning_threshold * 100)}
              onChange={e => numField('budget_warning_threshold', e.target.value, n => n / 100)} className="max-w-[120px] num" />
            <p className="text-[11px] text-muted-foreground mt-1">이 비율을 넘으면 차이분석 검토 대상에 포함</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">전월비 변동 검토 기준 (±%)</label>
            <Input type="number" value={Math.round(settings.change_rate_threshold * 100)}
              onChange={e => numField('change_rate_threshold', e.target.value, n => n / 100)} className="max-w-[120px] num" />
            <p className="text-[11px] text-muted-foreground mt-1">전월비 증감률이 기준 초과 시 변동사유 작성 대상</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">건당 고액 기준 (원)</label>
            <Input type="number" value={settings.high_amount_threshold}
              onChange={e => numField('high_amount_threshold', e.target.value)} className="max-w-[160px] num" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">중복 결제 판정 기간 (일)</label>
            <Input type="number" value={settings.duplicate_window_days}
              onChange={e => numField('duplicate_window_days', e.target.value)} className="max-w-[120px] num" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">VAT 검증 허용오차 (원)</label>
            <Input type="number" value={settings.vat_tolerance}
              onChange={e => numField('vat_tolerance', e.target.value)} className="max-w-[120px] num" />
            <p className="text-[11px] text-muted-foreground mt-1">단수차이(원단위 절사) 허용 범위</p>
          </div>
        </div>
      </div>
    </div>
  );
}
