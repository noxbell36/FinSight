export interface AppSettings {
  company_name: string;
  budget_warning_threshold: number; // 0.9 = 집행률 90% 경보
  change_rate_threshold: number;    // 0.2 = 전월비 ±20% 검토 대상
  vat_tolerance: number;            // 원 단위 허용오차
  high_amount_threshold: number;    // 건당 고액 기준(원)
  duplicate_window_days: number;    // 중복 의심 판정 기간(일)
  gemini_model: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  company_name: '',
  budget_warning_threshold: 0.9,
  change_rate_threshold: 0.2,
  vat_tolerance: 1,
  high_amount_threshold: 1000000,
  duplicate_window_days: 3,
  gemini_model: 'gemini-2.5-flash',
};

export const SETTINGS_STORAGE_KEY = 'finpilot-settings';
