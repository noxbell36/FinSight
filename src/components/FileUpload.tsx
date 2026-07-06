import { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, PlayCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';

export interface SheetData {
  name: string;
  rows: unknown[][];
}

interface FileUploadProps {
  kind: 'actual' | 'budget';
  compact?: boolean; // 데이터 관리 탭 내 임베드용
  onWorkbookLoaded: (sheets: SheetData[], fileName: string) => void;
  onLoadDemo?: () => void;
}

export default function FileUpload({ kind, compact, onWorkbookLoaded, onLoadDemo }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback((file: File) => {
    setError(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      setError('지원 형식: .xlsx, .xls, .csv');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const sheets: SheetData[] = workbook.SheetNames.slice(0, 10).map(name => ({
          name,
          rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' }) as unknown[][],
        })).filter(s => s.rows.length > 0);
        if (sheets.length === 0) {
          setError('빈 파일입니다. 데이터가 포함된 파일을 업로드해주세요.');
          return;
        }
        onWorkbookLoaded(sheets, file.name);
      } catch {
        setError('파일을 읽는 중 오류가 발생했습니다.');
      }
    };
    reader.readAsArrayBuffer(file);
  }, [onWorkbookLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const title = kind === 'actual' ? '실적(전표) 파일 업로드' : '예산 파일 업로드';
  const desc = kind === 'actual'
    ? 'ERP에서 내려받은 전표·비용 명세 엑셀을 그대로 올려주세요. 양식이 달라도 컬럼 매핑으로 맞춥니다.'
    : '계정×월 형태의 예산 엑셀을 올려주세요. 세로형(월 컬럼 1개)·가로형(1월~12월 컬럼) 모두 지원합니다.';

  return (
    <div className={compact ? '' : 'min-h-screen flex items-center justify-center p-6 bg-background'}>
      <div className={compact ? 'w-full' : 'w-full max-w-xl'}>
        {!compact && (
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground">FinPilot</h1>
            <p className="text-sm text-muted-foreground mt-1">비용 및 예산 대비 실적 분석</p>
          </div>
        )}
        <div
          className={`panel p-10 text-center border-2 border-dashed transition-colors cursor-pointer ${
            isDragging ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById(`file-input-${kind}`)?.click()}
        >
          <input
            id={`file-input-${kind}`}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}
          />
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-lg bg-accent">
              {kind === 'actual' ? <FileSpreadsheet className="h-7 w-7 text-primary" /> : <Upload className="h-7 w-7 text-primary" />}
            </div>
          </div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{desc}</p>
          <p className="text-xs text-muted-foreground mt-3">클릭 또는 파일을 끌어다 놓기 · .xlsx / .xls / .csv</p>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}

        {onLoadDemo && (
          <div className="mt-6 text-center">
            <Button variant="outline" onClick={onLoadDemo} className="gap-2">
              <PlayCircle className="h-4 w-4" />
              가상 데이터로 시작하기 (실적 18개월 + 예산 2개 버전)
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              회사 데이터 없이 전체 기능을 검토할 수 있습니다. 모든 데이터는 이 브라우저에만 저장됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
