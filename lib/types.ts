// 로파워(LawPower) 도메인 모델
// 회생/파산 사건관리 어드민의 핵심 타입 정의.
// 추후 Supabase 테이블 스키마로 그대로 옮길 수 있도록 필드명을 snake_case가 아닌
// camelCase로 우선 정의하고(프론트 우선), 실제 DB 연동 시 lib/data.ts의 매핑 함수만
// 교체하면 되도록 데이터 레이어를 분리해 둠.

export type CaseType = "개인회생" | "개인파산";

// 절차 진행 단계 — 개인회생/개인파산 공통 파이프라인으로 단순화.
// (실무상 회생은 '변제계획인가' 단계를 거치고 파산은 '파산선고'를 거치는 차이가 있으나,
//  1차 버전에서는 하나의 파이프라인 인덱스로 관리하고 stageLabel로 사건유형별 명칭만 다르게 표기)
export const CASE_STAGES = [
  "상담접수",
  "서류준비",
  "신청서작성",
  "법원접수",
  "보정대기",
  "개시_선고",
  "변제계획_면책심문",
  "면책결정",
  "종결",
] as const;

export type CaseStage = (typeof CASE_STAGES)[number];

// 사건유형별로 파이프라인 단계에 붙일 실제 표시 라벨
export const STAGE_LABELS: Record<CaseType, Record<CaseStage, string>> = {
  개인회생: {
    상담접수: "상담접수",
    서류준비: "서류준비",
    신청서작성: "신청서작성",
    법원접수: "법원접수",
    보정대기: "보정대기",
    개시_선고: "개시결정",
    변제계획_면책심문: "변제계획인가",
    면책결정: "면책결정",
    종결: "종결",
  },
  개인파산: {
    상담접수: "상담접수",
    서류준비: "서류준비",
    신청서작성: "신청서작성",
    법원접수: "법원접수",
    보정대기: "보정대기",
    개시_선고: "파산선고",
    변제계획_면책심문: "면책심문",
    면책결정: "면책결정",
    종결: "종결",
  },
};

// 사건유형을 구분하지 않고 파이프라인 전체를 한눈에 보여줄 때 쓰는 공용 라벨
// (대시보드의 절차단계별 사건 현황처럼 개인회생/개인파산이 섞여 있는 집계 화면용)
export const STAGE_GENERIC_LABELS: Record<CaseStage, string> = {
  상담접수: "상담접수",
  서류준비: "서류준비",
  신청서작성: "신청서작성",
  법원접수: "법원접수",
  보정대기: "보정대기",
  개시_선고: "개시/선고",
  변제계획_면책심문: "인가/면책심문",
  면책결정: "면책결정",
  종결: "종결",
};

export type CaseStatus = "진행중" | "보류" | "취하" | "종결";

// 담당 직원 목록 — 데모 버전에서는 실명 대신 직원1/직원2/직원3으로 표기.
// DB관리·고객관리의 담당자 필드는 모두 이 목록을 드롭다운으로 사용합니다.
export const STAFF_LIST = ["직원1", "직원2", "직원3"] as const;
export type StaffName = (typeof STAFF_LIST)[number];

export interface Client {
  id: string;
  name: string;
  phone: string;
  registeredAt: string; // ISO date
  assignedStaff?: StaffName;
  memo?: string;
  fromLeadId?: string; // DB관리에서 전환되어 생성된 경우 원본 리드 id
  applicationType?: CaseType; // 신청분류(개인회생/개인파산) — DB관리에서 지정, 고객관리 상단 탭 분류 기준
  consultation?: ConsultationInfo; // 상담일지(고객정보 수정 팝업에서 작성)
}

// 결제수단 4종 — 회파산 업무매뉴얼 6장(비용구조 안내) 기준. 결제수단에 따라 정산금이
// 달라지므로(정산요율은 store.tsx의 settlementRates에서 담당자별로 설정), 여기서는
// 결제수단 종류와 설명만 정의합니다.
export type PaymentMethod = "단순분납" | "로피분납" | "신카할부완납" | "캐피탈분납";

export const PAYMENT_METHOD_NOTE: Record<PaymentMethod, string> = {
  단순분납: "'로피' 지정일 결제 · 최대 6개월",
  로피분납: "계약금+대행비 40만원 선결제 후 잔액 최대 6개월 분납(연 5.2~6% 수준)",
  신카할부완납: "카드사 일반결제 할부로 전액 완납 · 구상권 청구 가능성 사전고지 필요",
  캐피탈분납: "캐피탈사 대출 연계 분납 · 심사 결과에 따라 한도/기간 상이",
};

// ---- DB(상담 리드) 관리 ----
// 매뉴얼 5장 상담 파이프라인 + 구글시트 대시보드 상태값을 통합한 DB 리드 상태
export const DB_LEAD_STATUSES = [
  "신규접수",
  "상담예정",
  "상담완료",
  "재통화필요",
  "고려중",
  "서류검토중",
  "계약진행중",
  "수임전환",
  "부재중",
  "거절",
  "부적합",
  "종결_중단",
] as const;

export type DbLeadStatus = (typeof DB_LEAD_STATUSES)[number];

export const DB_LEAD_STATUS_LABEL: Record<DbLeadStatus, string> = {
  신규접수: "신규접수",
  상담예정: "상담예정",
  상담완료: "상담완료",
  재통화필요: "재통화필요",
  고려중: "고려중",
  서류검토중: "서류검토중",
  계약진행중: "계약진행중",
  수임전환: "전환 완료",
  부재중: "부재중",
  거절: "거절",
  부적합: "부적합",
  종결_중단: "종결(중단)",
};

export interface DbLead {
  id: string;
  name: string;
  phone: string;
  applicationType?: CaseType; // 신청분류(개인회생/개인파산) — DB관리 리스트에서 드롭다운으로 지정, 고객 전환 시 그대로 승계
  receivedAt: string; // ISO datetime — DB 접수 시각
  status: DbLeadStatus;
  assignedStaff: StaffName;
  memo?: string; // 상담원이 남기는 기초정보 메모
  callCount?: number; // 콜(통화 시도) 횟수 — DB관리 리스트에서 ▲▼ 버튼으로 직접 증감
  convertedClientId?: string; // 고객관리로 전환된 경우 생성된 Client id
  convertedCaseId?: string;
}

export interface CaseRecord {
  id: string;
  caseNumber: string; // 법원 사건번호, 접수 전에는 임시 내부관리번호
  clientId: string;
  caseType: CaseType;
  court: string; // 관할법원
  stage: CaseStage;
  stageUpdatedAt: string; // ISO date
  status: CaseStatus;
  assignedStaff: string;
  filingDate?: string; // 법원접수일 (접수 전이면 미정)
  nextHearingDate?: string; // 다음 기일/기한
  totalDebt: number; // 총 채무액
  monthlyRepayment?: number; // 회생 인가 후 월 변제금
  contractAmount: number; // 수임료 계약금액
  contractDate: string; // 계약일 (ISO date) — 매출 집계 기준일
  paidAmount: number; // 기납부액
  paymentMethod: PaymentMethod;
  docsSentAt?: string; // 서류제출안내문 발송일 (ISO date)
  memo?: string;
  fromLeadId?: string; // DB관리에서 전환되어 생성된 경우 원본 리드 id
}

export type InstallmentStatus = "완료" | "예정" | "연체" | "실패";

export interface Installment {
  id: string;
  caseId: string;
  seq: number; // 회차, 1=계약금
  dueDate: string; // ISO date
  amount: number;
  status: InstallmentStatus;
  paidDate?: string; // 완료된 경우 실제 입금일
}

export type ScheduleType = "법원기일" | "서류제출기한" | "상담예약" | "분납안내";

export interface ScheduleItem {
  id: string;
  caseId?: string;
  clientId?: string;
  type: ScheduleType;
  date: string; // ISO date
  title: string;
  done: boolean;
}

// 기간 엔진에서 사용하는 하루 단위 집계 데이터
export interface DayAggregate {
  date: string; // ISO date (YYYY-MM-DD)
  newConsultCount: number; // 신규 상담 접수
  newContractCount: number; // 신규 계약 건수
  contractAmount: number; // 신규 계약금액(청구 개념)
  paymentAmount: number; // 그날 실제 입금액(결제 완료)
  caseTypeSplit: Record<CaseType, number>; // 그날 결제완료액의 사건유형별 구성비(0~1)
}

// ---- 내부 게시판 (도원 Admin '내부 게시판'과 동일 기능) ----
// 실제 백엔드가 없어 첨부파일은 이름/용량만 기록하고 실제 바이트는 저장하지 않습니다.
export interface BoardAttachment {
  id: string;
  name: string;
  size: number; // bytes
}

export interface BoardPost {
  id: string;
  title: string;
  body: string;
  writer: string;
  date: string; // ISO date — 등록일
  isNotice: boolean;
  noticeOrder: number;
  attachments: BoardAttachment[];
}

// ---- 상담일지(개인회생·개인파산 상담일지) ----
// 고객이 제공한 '개인회생·개인파산 상담일지' 엑셀 서식을 그대로 옮긴 구조.
// 화면(고객관리 수정 팝업)에서 섹션별 탭으로 나눠 입력하며, 놓치기 쉬운 상담 항목을
// 누락 없이 기록하는 것이 목적입니다.
// ※ 법정 최저생계비 · 소액임차인 최우선변제 기준액은 매년/지역별로 바뀌고 법적으로
//    민감한 수치이므로 이 데모에서는 임의의 표를 만들어 자동판정하지 않고, 수동 입력
//    (최저생계비는 1인가구 기준값만 참고로 채워둠) 또는 참고 메모로만 다룹니다.

export type Gender = "남" | "여";
export type OccupationType = "사업자" | "직장인" | "프리랜서" | "무직" | "기타";

export interface ConsultationPersonal {
  birthDate?: string; // 생년월일
  gender?: Gender;
  address?: string; // 거주지(초본주소)
  jurisdictionCourt?: string; // 관할법원
  occupationType?: OccupationType;
  spouse?: boolean; // 배우자 유무
  childrenCount?: number; // 자녀 인원
  childrenAges?: string; // 자녀 나이
  otherDependents?: string; // 기타 부양가족
  seriousIllness?: boolean; // 중대질환·장기요양 여부
  dependentNote?: string; // 부양가족 특이사항
}

export interface ConsultationIncome {
  incomeType?: string; // 소득유형(근로소득/사업소득 등)
  workplaceName?: string; // 회사명·사업자명
  tenureInfo?: string; // 재직기간·사업장정보
  monthlyAvgIncome?: number; // 월평균소득(최근 3개월)
  secondaryIncome?: number; // 2중소득(부업)
  pensionIncome?: number; // 연금소득(국민/노령)
  note?: string;
}

// 재산현황(청산가치 산정용) — 상담일지 서식의 고정 행 구성을 그대로 사용
export const ASSET_CATEGORIES = [
  "주택/토지",
  "임차보증금(반환채권)",
  "예금/적금",
  "보험(해약환급금)",
  "자동차",
  "퇴직금",
  "주식/펀드",
  "기타(재고자산 등)",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export interface AssetRow {
  category: AssetCategory;
  value: number; // 평가액
  hasSecurity: boolean; // 담보·대출 여부
  securityAmount: number; // 담보·대출 금액
  note?: string;
}

// 채무현황 — 상담일지 서식의 고정 행 구성을 그대로 사용
export const DEBT_CATEGORIES = [
  "세금체납",
  "건강보험체납",
  "담보채무(부동산저당)",
  "담보채무(자동차)",
  "신용채무(카드/캐피탈/저축은행 등)",
] as const;
export type DebtCategory = (typeof DEBT_CATEGORIES)[number];

// 담보채무로 집계할 카테고리 — 청산가치(자산-담보채무) 계산에 사용
export const SECURED_DEBT_CATEGORIES: DebtCategory[] = ["담보채무(부동산저당)", "담보채무(자동차)"];
// 탕감 대상(변제계획 계산 기준) 신용채무 카테고리
export const UNSECURED_DEBT_CATEGORY: DebtCategory = "신용채무(카드/캐피탈/저축은행 등)";

export interface DebtRow {
  category: DebtCategory;
  creditor?: string; // 채권자
  detail?: string; // 내용
  amount: number;
  note?: string;
}

export interface RepaymentPlanInput {
  householdSize: number; // 가구원수
  minLivingCost: number; // 최저생계비 — 수동 입력(1인가구 기준값만 참고 제공)
  otherDeduction: number; // 기타공제금
  repaymentMonths: number; // 변제개월수
  smallLeaseNote?: string; // 소액임차인 최우선변제 참고 메모(자동조회 대신 수기 확인 기록)
}

export interface ConsultationInfo {
  personal?: ConsultationPersonal;
  income?: ConsultationIncome;
  assets?: AssetRow[];
  debts?: DebtRow[];
  plan?: RepaymentPlanInput;
  memo?: string; // 상담메모/상담내역
}
