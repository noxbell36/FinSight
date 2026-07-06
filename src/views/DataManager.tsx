import { useState } from 'react';
import { Trash2, Download, PlayCircle, RotateCcw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import FileUpload, { type SheetData } from '@/components/FileUpload';
import type { AppStore } from '@/types/finance';
import { generateDemoTransactions } from '@/lib/demoData';
import { PageHeader } from '@/components/shared';

interface Props {
  store: AppStore;
  onStartMapping: (kind: 'actual' | 'budget', sheets: SheetData[], fileName: string) => void;
  onLoadDemo: () => void;
  onDeleteDataset: (id: string) => void;
  onDeleteProfile: (id: string) => void;
  onResetAll: () => void;
}

export default function DataManager({ store, onStartMapping, onLoadDemo, onDeleteDataset, onDeleteProfile, onResetAll }: Props) {
  const [uploadKind, setUploadKind] = useState<'actual' | 'budget'>('actual');

  const downloadSample = () => {
    const rows = generateDemoTransactions().slice(0, 120).map(r => ({
      '전표일자': r.posting_date, '전표번호': r.voucher_number, '부서': r.cost_center,
      '계정코드': r.account_code, '계정명': r.account_name, '거래처명': r.vendor,
      '적요': r.memo, '공급가액': r.net_amount, '부가세': r.vat, '합계금액': r.gross_amount,
      '금액': r.curr_amount, '증빙유형': r.evidence_type, '세금구분': r.tax_code,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '전표내역');
    XLSX.writeFile(wb, 'FinPilot_샘플_전표양식.xlsx');
    toast.success('샘플 엑셀 다운로드 완료');
  };

  const handleReset = () => {
    if (window.confirm('모든 데이터(실적·예산·변동사유·검토 상태·프로파일)를 삭제합니다. 계속하시겠습니까?')) {
      onResetAll();
      toast.success('전체 초기화 완료');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="데이터 관리" desc="업로드된 데이터셋과 매핑 프로파일을 관리합니다. 모든 데이터는 이 브라우저에만 저장됩니다." />

      {/* 업로드 */}
      <div className="panel p-4 mb-5">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-semibold flex-1">파일 업로드</h2>
          <div className="flex rounded-md border border-border overflow-hidden text-sm">
            <button onClick={() => setUploadKind('actual')} className={`px-3 py-1.5 ${uploadKind === 'actual' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>실적(전표)</button>
            <button onClick={() => setUploadKind('budget')} className={`px-3 py-1.5 ${uploadKind === 'budget' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>예산</button>
          </div>
        </div>
        <FileUpload kind={uploadKind} compact onWorkbookLoaded={(sheets, name) => onStartMapping(uploadKind, sheets, name)} />
        <div className="flex flex-wrap gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={downloadSample} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> 샘플 전표 엑셀 다운로드
          </Button>
          <Button variant="outline" size="sm" onClick={onLoadDemo} className="gap-1.5">
            <PlayCircle className="h-3.5 w-3.5" /> 가상 데이터 불러오기 (기존 데모 대체)
          </Button>
        </div>
      </div>

      {/* 데이터셋 목록 */}
      <div className="panel overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">데이터셋 ({store.datasets.length})</h2>
        </div>
        {store.datasets.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">업로드된 데이터가 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary">
              <tr className="text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">이름</th>
                <th className="px-4 py-2 text-left font-medium">구분</th>
                <th className="px-4 py-2 text-right font-medium">행 수</th>
                <th className="px-4 py-2 text-left font-medium">기간</th>
                <th className="px-4 py-2 text-left font-medium">업로드 시각</th>
                <th className="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {store.datasets.map(ds => (
                <tr key={ds.id} className="border-t border-border">
                  <td className="px-4 py-2">{ds.name}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded ${ds.kind === 'actual' ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'}`}>
                      {ds.kind === 'actual' ? '실적' : `예산${ds.version ? ` · ${ds.version}` : ''}`}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right num">{ds.row_count.toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {ds.periods.length > 0 ? `${ds.periods[0]} ~ ${ds.periods[ds.periods.length - 1]}` : '-'}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(ds.uploaded_at).toLocaleString('ko-KR')}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => { if (window.confirm(`"${ds.name}" 데이터셋을 삭제하시겠습니까?`)) onDeleteDataset(ds.id); }}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 매핑 프로파일 */}
      <div className="panel overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">매핑 프로파일 ({store.profiles.length})</h2>
        </div>
        {store.profiles.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">저장된 프로파일이 없습니다. 컬럼 매핑 화면에서 저장하면 같은 양식은 자동 적용됩니다.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {store.profiles.map(p => (
                <tr key={p.id} className="border-t border-border first:border-0">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{p.kind === 'actual' ? '실적' : '예산'} · 컬럼 {Object.values(p.mapping).filter(Boolean).length}개 매핑 · {new Date(p.created_at).toLocaleDateString('ko-KR')}</td>
                  <td className="px-4 py-2 text-right w-16">
                    <button onClick={() => onDeleteProfile(p.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 초기화 */}
      <div className="panel p-4 flex items-center gap-3">
        <RotateCcw className="h-4 w-4 text-destructive shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium">전체 초기화</p>
          <p className="text-xs text-muted-foreground">브라우저에 저장된 모든 데이터를 삭제합니다. (Gemini API 키·환경 설정은 유지)</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleReset} className="text-destructive border-destructive/40 hover:bg-destructive/10">초기화</Button>
      </div>
    </div>
  );
}
