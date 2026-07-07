export interface RawRow {
  [key: string]: string | number | null | undefined;
}

/** 실적(전표) 표준 스키마 — 귀속월(period) 포함 */
export interface MappedRow {
  row_id?: string;
  dataset_id?: string;
  period?: string; // 귀속월 YYYY-MM
  account_name?: string;
  account_code?: string;
  curr_amount?: number;
  cost_center?: string;
  net_amount?: number;
  vat?: number;
  gross_amount?: number;
  memo?: string;
  vendor?: string;
  posting_date?: string; // ISO YYYY-MM-DD
  voucher_code?: string;
  voucher_number?: string;
  line_number?: string;
  evidence_date?: string;
  business_reg_number?: string;
  evidence_type?: string;
  tax_code?: string;
}

/** 예산 표준 스키마 — 계정×부서×월×버전 */
export interface BudgetRecord {
  dataset_id?: string;
  account_name: string;
  account_code?: string;
  cost_center?: string;
  period: string; // YYYY-MM
  amount: number;
  version: string; // 본예산 / 수정예산 / FCST_... / SIM_...
}

export interface DatasetMeta {
  id: string;
  name: string;
  kind: 'actual' | 'budget';
  uploaded_at: string;
  row_count: number;
  periods: string[];
  version?: string; // budget only (대표 버전)
}

/** 변동사유 (월마감 후 확인 업무) */
export interface CommentaryEntry {
  id: string; // `${period}:${account_name}`
  period: string;
  account_name: string;
  variance_amount: number; // 예산 - 실적 (음수 = 불리)
  mom_amount: number; // 전월비 증감액
  reason: string;
  status: 'draft' | 'confirmed';
  source: 'user' | 'ai-draft';
  updated_at: string;
}

export interface MappingProfile {
  id: string;
  name: string;
  kind: 'actual' | 'budget';
  signature: string; // 정규화된 헤더 시그니처
  headerRowIndex: number;
  sheetName?: string;
  mapping: Record<string, string | null>;
  unit: 1 | 1000;
  periodMode?: 'from_date' | 'fixed';
  budgetLayout?: 'long' | 'wide';
  created_at: string;
}

export interface ColumnMapping {
  [originalColumn: string]: keyof MappedRow | null;
}

export type MatchConfidence = 'high' | 'medium' | 'none';


/** 월간 AI 분석 결과 (캐시) — 규칙 엔진 검출 항목에 대한 AI 해석 */
export interface AiAccountFinding {
  account_name: string;
  cause: string;   // 원인 추론 (데이터 근거)
  action: string;  // 권고 액션
  draft: string;   // 변동사유 보고 초안
}

export interface MonthlyAnalysis {
  key: string;          // `${period}|${version}|${fingerprint}`
  period: string;
  generated_at: string;
  summary: string;               // Executive Summary (4~6문장)
  findings: AiAccountFinding[];  // 검토 대상 계정별 해석
  error?: string;
}

export interface AppStore {
  transactions: MappedRow[];
  budgets: BudgetRecord[];
  datasets: DatasetMeta[];
  commentary: CommentaryEntry[];
  reviews: Record<string, 'done' | 'flagged'>; // `${checkId}:${rowId}`
  profiles: MappingProfile[];
  reportNotes: Record<string, string>; // period -> AI/수기 종합 코멘트
  analyses: Record<string, MonthlyAnalysis>; // 월간 AI 분석 캐시 (key -> 결과)
}

export const EMPTY_STORE: AppStore = {
  transactions: [],
  budgets: [],
  datasets: [],
  commentary: [],
  reviews: {},
  profiles: [],
  reportNotes: {},
  analyses: {},
};
