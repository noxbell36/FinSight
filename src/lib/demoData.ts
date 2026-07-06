import type { MappedRow, BudgetRecord, DatasetMeta } from '@/types/finance';

/**
 * 가상 데이터 생성기 (2025-01 ~ 2026-06, 18개월).
 * 실무 검토 데모가 가능하도록 의도된 시나리오 포함:
 *  - 지급수수료: 월 3% 상승 추세 → 2025 하반기부터 본예산 초과 (수정예산으로 증액)
 *  - 클라우드사용료: 우상향 → 예산 압박
 *  - 광고선전비: 3/6/9/12월 캠페인 스파이크
 *  - 임차료·감가상각비: 2025-08 사무실 증평으로 계단식 상승
 *  - 소모품비: 2025-07 사무실 이전 일회성 급증
 *  - 급여: 완만한 상승 + 2025-12 상여 스파이크
 *  - VAT 불일치 3건 / 중복 결제 1쌍 / 분할 결제 1세트 / 적요 미기재 일부 / 주말 전표 2건
 */

// 시드 고정 RNG (결과 재현 가능)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CCS = ['경영지원', '영업1팀', '마케팅', '개발', 'CS', '물류'];

interface AccDef {
  name: string; code: string; taxed: boolean;
  vendors: string[]; memos: string[];
  base: number; // 월 기준액
  ccs: string[];
  txPerMonth: [number, number];
  amount: (m: number, rnd: () => number) => number; // m: 0-based month index from 2025-01
}

const spike = (m: number, months: number[], mult: number) => (months.includes(m % 12) ? mult : 1);

const ACCOUNTS: AccDef[] = [
  { name: '급여', code: '510101', taxed: false, vendors: ['급여대장'], memos: ['월 급여 지급'], base: 55000000, ccs: ['경영지원'], txPerMonth: [1, 1],
    amount: (m, r) => 55000000 * Math.pow(1.004, m) * (m % 12 === 11 ? 1.8 : 1) * (0.99 + r() * 0.02) },
  { name: '퇴직급여', code: '510301', taxed: false, vendors: ['퇴직연금운용사'], memos: ['퇴직연금 부담금 납입'], base: 4500000, ccs: ['경영지원'], txPerMonth: [1, 1],
    amount: (m, r) => 4500000 * Math.pow(1.004, m) * (0.98 + r() * 0.04) },
  { name: '복리후생비', code: '550101', taxed: true, vendors: ['단체보험사', '구내식당', '복지몰'], memos: ['임직원 식대 지원', '단체보험료', '복지포인트 정산'], base: 6200000, ccs: CCS, txPerMonth: [3, 5],
    amount: (m, r) => 6200000 * (0.92 + r() * 0.16) },
  { name: '지급수수료', code: '580101', taxed: true, vendors: ['PG사', '회계법인C', '로펌A', '채용플랫폼'], memos: ['결제대행 수수료 정산', '기장·세무 자문료', '법률 자문 수수료', '채용 공고 이용료'], base: 8000000, ccs: ['경영지원', '영업1팀'], txPerMonth: [3, 5],
    amount: (m, r) => 8000000 * Math.pow(1.03, m) * (0.93 + r() * 0.14) },
  { name: '광고선전비', code: '510201', taxed: false, vendors: ['Google Ads', 'Meta', '네이버광고', '옥외광고대행'], memos: ['검색광고 집행', 'SNS 캠페인 집행', '브랜드 캠페인 매체비'], base: 12000000, ccs: ['마케팅'], txPerMonth: [2, 4],
    amount: (m, r) => 12000000 * spike(m, [2, 5, 8, 11], 1.9) * (0.9 + r() * 0.2) },
  { name: '클라우드사용료', code: '520101', taxed: false, vendors: ['Amazon Web Services', 'Google Cloud'], memos: ['AWS 사용량 정산', 'GCP 사용량 정산'], base: 9000000, ccs: ['개발'], txPerMonth: [1, 2],
    amount: (m, r) => 9000000 * Math.pow(1.025, m) * (0.95 + r() * 0.1) },
  { name: '임차료', code: '530101', taxed: true, vendors: ['XX빌딩관리사무소'], memos: ['사무실 임차료(정기)'], base: 14000000, ccs: ['경영지원'], txPerMonth: [1, 1],
    amount: (m) => (m >= 7 ? 16100000 : 14000000) }, // 2025-08 사무실 증평
  { name: '관리비', code: '530201', taxed: true, vendors: ['XX빌딩관리사무소'], memos: ['건물 관리비'], base: 2300000, ccs: ['경영지원'], txPerMonth: [1, 1],
    amount: (m, r) => (m >= 7 ? 2760000 : 2300000) * (0.97 + r() * 0.06) },
  { name: '감가상각비', code: '590101', taxed: false, vendors: ['월마감 결산분개'], memos: ['유형자산 감가상각(결산)'], base: 6000000, ccs: ['경영지원'], txPerMonth: [1, 1],
    amount: (m) => (m >= 7 ? 7300000 : 6000000) },
  { name: '소모품비', code: '560201', taxed: true, vendors: ['쿠팡', '오피스디포', '가구업체B'], memos: ['사무용 소모품 구입', '비품 구입'], base: 1500000, ccs: CCS, txPerMonth: [2, 4],
    amount: (m, r) => (m === 6 ? 7500000 : 1500000) * (0.85 + r() * 0.3) }, // 2025-07 이전 비품 일괄 구입
  { name: '여비교통비', code: '540201', taxed: false, vendors: ['법인카드-교통', '항공사K', '철도공사'], memos: ['고객 미팅 출장(교통/숙박)', '지방 출장 교통비'], base: 3200000, ccs: ['영업1팀', 'CS', '물류'], txPerMonth: [3, 6],
    amount: (m, r) => 3200000 * (0.85 + r() * 0.3) },
  { name: '접대비', code: '540401', taxed: true, vendors: ['한정식당G', '일식당S', '골프장V'], memos: ['고객사 접대', '거래처 미팅 식사'], base: 2600000, ccs: ['영업1팀'], txPerMonth: [3, 6],
    amount: (m, r) => 2600000 * (0.8 + r() * 0.4) },
  { name: '통신비', code: '560101', taxed: true, vendors: ['KT', 'SKT'], memos: ['인터넷·전용회선 요금', '법인폰 요금'], base: 1200000, ccs: ['경영지원'], txPerMonth: [1, 2],
    amount: (m, r) => 1200000 * (0.98 + r() * 0.04) },
  { name: '교육훈련비', code: '550201', taxed: true, vendors: ['교육기관E', '온라인클래스'], memos: ['직무교육 수강료', '온라인 교육 구독'], base: 1000000, ccs: CCS, txPerMonth: [1, 2],
    amount: (m, r) => 1000000 * spike(m, [1, 4, 7, 10], 1.6) * (0.8 + r() * 0.4) },
  { name: '운반비', code: '560301', taxed: true, vendors: ['CJ대한통운', '한진택배'], memos: ['출고 택배비 정산'], base: 4200000, ccs: ['물류'], txPerMonth: [2, 3],
    amount: (m, r) => 4200000 * Math.pow(1.012, m) * (0.9 + r() * 0.2) },
  { name: '외주용역비', code: '570101', taxed: true, vendors: ['스튜디오K', '개발에이전시D'], memos: ['프로젝트 개발 외주', '디자인 외주 용역'], base: 10000000, ccs: ['개발', '마케팅'], txPerMonth: [1, 3],
    amount: (m, r) => 10000000 * (0.7 + r() * 0.6) },
  { name: '보험료', code: '580201', taxed: false, vendors: ['손해보험사H'], memos: ['재산종합보험료(월할)'], base: 900000, ccs: ['경영지원'], txPerMonth: [1, 1],
    amount: () => 900000 },
  { name: '차량유지비', code: '560401', taxed: true, vendors: ['주유소', '정비업체'], memos: ['법인차량 주유', '차량 정기점검'], base: 800000, ccs: ['영업1팀', '물류'], txPerMonth: [1, 3],
    amount: (m, r) => 800000 * (0.8 + r() * 0.4) },
];

const MONTHS: string[] = (() => {
  const out: string[] = [];
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 6) break;
      out.push(`${y}-${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

function weekdayDate(period: string, rnd: () => number): string {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  for (let tries = 0; tries < 10; tries++) {
    const d = 1 + Math.floor(rnd() * last);
    const date = new Date(y, m - 1, d);
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      return `${period}-${String(d).padStart(2, '0')}`;
    }
  }
  return `${period}-15`;
}

export function generateDemoTransactions(): MappedRow[] {
  const rnd = mulberry32(20260706);
  const rows: MappedRow[] = [];
  let seq = 0;
  const codes = ['GJ', 'AP', 'JV'];
  const evidences = ['세금계산서', '카드', '이체', '현금영수증'];

  for (let mi = 0; mi < MONTHS.length; mi++) {
    const period = MONTHS[mi];
    for (const acc of ACCOUNTS) {
      const monthTotal = Math.round(acc.amount(mi, rnd) / 100) * 100;
      const [tMin, tMax] = acc.txPerMonth;
      const txCount = tMin + Math.floor(rnd() * (tMax - tMin + 1));
      // 월 총액을 txCount건으로 분할
      const weights = Array.from({ length: txCount }, () => 0.5 + rnd());
      const wSum = weights.reduce((a, b) => a + b, 0);
      let remain = monthTotal;
      for (let t = 0; t < txCount; t++) {
        const amount = t === txCount - 1 ? remain : Math.round((monthTotal * weights[t]) / wSum / 100) * 100;
        remain -= amount;
        if (amount <= 0) continue;
        seq++;
        const vendor = acc.vendors[Math.floor(rnd() * acc.vendors.length)];
        const memoIdx = Math.floor(rnd() * acc.memos.length);
        // 적요 미기재 시나리오: 약 4%
        const memo = rnd() < 0.04 ? '' : acc.memos[memoIdx];
        const net = acc.taxed ? Math.round(amount / 1.1 / 10) * 10 : amount;
        const vat = acc.taxed ? amount - net : 0;
        rows.push({
          row_id: `demo-${seq}`,
          dataset_id: 'demo-actual',
          period,
          posting_date: weekdayDate(period, rnd),
          voucher_code: codes[Math.floor(rnd() * codes.length)],
          voucher_number: `${period.replace('-', '')}-${String(seq).padStart(5, '0')}`,
          cost_center: acc.ccs[Math.floor(rnd() * acc.ccs.length)],
          account_name: acc.name,
          account_code: acc.code,
          vendor,
          evidence_type: evidences[Math.floor(rnd() * evidences.length)],
          tax_code: acc.taxed ? '과세(10%)' : '면세',
          net_amount: net,
          vat,
          gross_amount: amount,
          curr_amount: amount,
          memo,
        });
      }
    }
  }

  // ── 의도된 검토 시나리오 주입 ──
  // VAT 불일치 3건
  const taxedRows = rows.filter(r => r.vat && r.vat > 0);
  [50, 180, 400].forEach((idx, i) => {
    const r = taxedRows[idx % taxedRows.length];
    if (r && r.gross_amount) r.gross_amount += (i + 1) * 100; // 합계금액을 어긋나게
  });
  // 중복 결제 의심 1쌍 (2026-05 접대비)
  seq++;
  const dupBase: MappedRow = {
    row_id: `demo-${seq}`, dataset_id: 'demo-actual', period: '2026-05',
    posting_date: '2026-05-12', voucher_code: 'AP', voucher_number: `202605-${String(seq).padStart(5, '0')}`,
    cost_center: '영업1팀', account_name: '접대비', account_code: '540401',
    vendor: '한정식당G', evidence_type: '카드', tax_code: '과세(10%)',
    net_amount: 418182, vat: 41818, gross_amount: 460000, curr_amount: 460000, memo: '고객사 접대',
  };
  seq++;
  rows.push(dupBase, { ...dupBase, row_id: `demo-${seq}`, posting_date: '2026-05-14', voucher_number: `202605-${String(seq).padStart(5, '0')}` });
  // 분할 결제 의심 1세트 (2026-06 소모품비, 같은 날 3건)
  for (let i = 0; i < 3; i++) {
    seq++;
    rows.push({
      row_id: `demo-${seq}`, dataset_id: 'demo-actual', period: '2026-06',
      posting_date: '2026-06-18', voucher_code: 'AP', voucher_number: `202606-${String(seq).padStart(5, '0')}`,
      cost_center: '경영지원', account_name: '소모품비', account_code: '560201',
      vendor: '오피스디포', evidence_type: '카드', tax_code: '과세(10%)',
      net_amount: 445455, vat: 44545, gross_amount: 490000, curr_amount: 490000,
      memo: i === 0 ? '비품 구입' : '',
    });
  }
  // 주말 전표 2건
  const w1 = rows.find(r => r.period === '2026-04' && r.account_name === '여비교통비');
  if (w1) w1.posting_date = '2026-04-19'; // 일요일
  const w2 = rows.find(r => r.period === '2026-03' && r.account_name === '접대비');
  if (w2) w2.posting_date = '2026-03-14'; // 토요일

  return rows;
}

/** 예산: 본예산(연초 편성) + 수정예산(2025-07 증액 반영, 2025-07 이후 적용) */
export function generateDemoBudgets(): BudgetRecord[] {
  const out: BudgetRecord[] = [];
  const plan: Record<string, (m: number, year: number) => number> = {
    '급여': (m, y) => (y === 2025 ? 56000000 : 59500000) * (m === 11 ? 1.8 : 1),
    '퇴직급여': (_, y) => (y === 2025 ? 4600000 : 4900000),
    '복리후생비': () => 6500000,
    '지급수수료': () => 8500000, // 상승 추세 미반영 → 하반기 초과 발생
    '광고선전비': (m) => ([2, 5, 8, 11].includes(m) ? 22000000 : 12000000),
    '클라우드사용료': (_, y) => (y === 2025 ? 10000000 : 11000000), // 우상향 미반영
    '임차료': () => 14000000,
    '관리비': () => 2400000,
    '감가상각비': () => 6000000,
    '소모품비': () => 1800000,
    '여비교통비': () => 3500000,
    '접대비': () => 3000000,
    '통신비': () => 1300000,
    '교육훈련비': (m) => ([1, 4, 7, 10].includes(m) ? 1700000 : 1000000),
    '운반비': (_, y) => (y === 2025 ? 4300000 : 4800000),
    '외주용역비': () => 11000000,
    '보험료': () => 900000,
    '차량유지비': () => 900000,
  };
  // 수정예산 조정 (2025-07 이후): 상승 추세 계정 증액 + 사무실 이전 반영
  const revised: Record<string, (m: number, year: number) => number> = {
    '지급수수료': (_, y) => (y === 2025 ? 10000000 : 11500000),
    '클라우드사용료': (_, y) => (y === 2025 ? 11500000 : 12500000),
    '임차료': () => 16100000,
    '관리비': () => 2800000,
    '감가상각비': () => 7300000,
    '소모품비': (m, y) => (y === 2025 && m === 6 ? 8000000 : 1800000),
  };

  const codeMap = Object.fromEntries(ACCOUNTS.map(a => [a.name, a.code]));

  for (let y = 2025; y <= 2026; y++) {
    for (let m = 0; m < 12; m++) {
      const period = `${y}-${String(m + 1).padStart(2, '0')}`;
      for (const [name, fn] of Object.entries(plan)) {
        const base = Math.round(fn(m, y) / 10000) * 10000;
        out.push({ dataset_id: 'demo-budget', account_name: name, account_code: codeMap[name], period, amount: base, version: '본예산' });
        const after = y > 2025 || m >= 6; // 2025-07 이후
        const revFn = revised[name];
        const revAmount = after && revFn ? Math.round(revFn(m, y) / 10000) * 10000 : base;
        out.push({ dataset_id: 'demo-budget', account_name: name, account_code: codeMap[name], period, amount: revAmount, version: '수정예산' });
      }
    }
  }
  return out;
}

export function demoDatasetMetas(txCount: number, budgetCount: number): DatasetMeta[] {
  const now = new Date().toISOString();
  return [
    { id: 'demo-actual', name: '가상 실적 데이터 (2025.01~2026.06)', kind: 'actual', uploaded_at: now, row_count: txCount, periods: MONTHS },
    { id: 'demo-budget', name: '가상 예산 데이터 (본예산·수정예산)', kind: 'budget', uploaded_at: now, row_count: budgetCount, periods: [], version: '본예산/수정예산' },
  ];
}
