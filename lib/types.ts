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

// 상담 후 진행 방향 — 예전에는 DB 접수 시점에 "신청분류"로 미리 지정했지만, 실제로는
// 상담을 해봐야 회생/파산/워크아웃 중 어느 방향이 맞는지 알 수 있는 경우가 많아
// "상담 후 방향"으로 명칭·시점을 바꿨습니다. 법원 사건(계약관리)은 회생/파산만 다루므로
// CaseType은 그대로 두고, 이 타입은 DB·고객 단계의 분류용으로 별도로 둡니다.
export const CONSULT_DIRECTIONS = ["개인회생", "개인파산", "워크아웃"] as const;
export type ConsultDirection = (typeof CONSULT_DIRECTIONS)[number];

export interface Client {
  id: string;
  name: string;
  phone: string;
  registeredAt: string; // ISO date
  assignedStaff?: StaffName;
  memo?: string;
  fromLeadId?: string; // DB관리에서 전환되어 생성된 경우 원본 리드 id
  applicationType?: ConsultDirection; // 상담 후 방향(개인회생/개인파산/워크아웃) — DB관리에서 승계, 고객관리 상단 탭 분류 기준
  consultation?: ConsultationInfo; // 상담일지(DB관리 또는 고객관리 수정 팝업에서 작성, 전환 시 승계됨)
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

// ---- 광고 인스턴트 양식 응답 (메타 광고 리드 폼 고정 질문 3종) ----
// "채무 총금액 / 실 월소득 / 상담가능시간" 3개 질문은 앞으로 고정 사용할 예정이라고
// 하셔서, DB 리드 스키마에 고정 필드로 넣어두었습니다. DB관리 리스트에서 색상 태그로
// 표시되고, 상담가능시간대는 클릭해서 그 시간대 리드만 걸러볼 수 있는 피벗 필터로도
// 씁니다.
export const DEBT_RANGE_OPTIONS = ["3천만원~5천만원", "5천만원~1억원", "1억원 이상"] as const;
export type DebtRange = (typeof DEBT_RANGE_OPTIONS)[number];

export const INCOME_RANGE_OPTIONS = ["100~200만원", "200~400만원", "400만원 이상"] as const;
export type IncomeRange = (typeof INCOME_RANGE_OPTIONS)[number];

export const CONSULT_TIME_OPTIONS = [
  "평일 오전(9시~12시)",
  "평일 점심(12시~1시)",
  "평일 오후(1시~6시)",
  "퇴근 후(6시~9시)",
] as const;
export type ConsultTimeSlot = (typeof CONSULT_TIME_OPTIONS)[number];

// 도원 Admin 시절 쓰던 "매일법률사무소 DB 구글시트 DB가공" 탭의 색상 구분 방식을 참고해
// 카테고리별로 구분되는 색을 지정했습니다(원본 시트 색상표에는 접근할 수 없어 유사한
// 톤으로 새로 설계 — 필요하면 언제든 값만 바꾸면 됩니다).
export const DEBT_RANGE_COLOR: Record<DebtRange, string> = {
  "3천만원~5천만원": "#0ea5e9", // sky-500
  "5천만원~1억원": "#f59e0b", // amber-500
  "1억원 이상": "#ef4444", // red-500
};
export const INCOME_RANGE_COLOR: Record<IncomeRange, string> = {
  "100~200만원": "#ef4444", // red-500 (소득 낮음 → 변제여력 낮음)
  "200~400만원": "#f59e0b", // amber-500
  "400만원 이상": "#22c55e", // green-500
};
export const CONSULT_TIME_COLOR: Record<ConsultTimeSlot, string> = {
  "평일 오전(9시~12시)": "#2563eb", // blue-600
  "평일 점심(12시~1시)": "#7c3aed", // violet-600
  "평일 오후(1시~6시)": "#059669", // emerald-600
  "퇴근 후(6시~9시)": "#d97706", // amber-600
};

// 고객 DB 유입경로 — 광고 채널별 반응률·전환율을 구분해서 볼 수 있도록 세분화.
// 목록은 언제든 필요에 맞게 값만 바꾸면 되도록 별도 상수로 뒀습니다.
export const LEAD_SOURCE_OPTIONS = [
  "메타(페이스북/인스타그램) 광고",
  "네이버 검색광고",
  "네이버 블로그/카페",
  "유튜브 광고",
  "당근마켓",
  "지인소개",
  "재방문(기존 상담고객)",
  "제휴사 연계",
  "기타",
] as const;
export type LeadSource = (typeof LEAD_SOURCE_OPTIONS)[number];

// ---- 상세 DB관리 — 단계별 세부 분류 ----
// "착수"·"서류"·"법원"·"워크아웃" 4개 트랙으로 나뉘는 세부 진행단계. 상담일지에서
// 담당자가 직접 지정하며, 상세 DB관리 화면에서 트랙별 통계 타일 + 단계별 고객 리스트로
// 집계됩니다. (참고 이미지의 분류 체계를 그대로 옮김 — 실제 운영 중 명칭이 바뀌면 아래
// 배열 값만 수정하면 됩니다.)
export const DB_DETAIL_STAGE_TRACKS = ["착수", "서류", "법원", "워크아웃"] as const;
export type DbDetailStageTrack = (typeof DB_DETAIL_STAGE_TRACKS)[number];

export const DB_DETAIL_STAGE_OPTIONS = [
  "착수금착수",
  "서류착수",
  "연체 워크아웃",
  "착수 추후진행",
  "착수 추후납부",
  "취소예정",
  "착수 1차안내",
  "1차 서류미비",
  "1차 서류완료",
  "2차서류안내",
  "2차서류미비",
  "2차서류완료",
  "접수보류",
  "법원접수(대기)",
  "법원접수",
  "금지명령",
  "금지기각",
  "개시결정",
  "인가결정",
  "종결",
  "워크아웃",
  "새출발",
  "워크아웃 신청",
  "새출발 신청",
  "워크아웃 완료",
  "새출발 완료",
  "파산",
] as const;
export type DbDetailStage = (typeof DB_DETAIL_STAGE_OPTIONS)[number];

export const DB_DETAIL_STAGE_GROUPS: Record<DbDetailStageTrack, DbDetailStage[]> = {
  착수: ["착수금착수", "서류착수", "연체 워크아웃", "착수 추후진행", "착수 추후납부", "취소예정"],
  서류: ["착수 1차안내", "1차 서류미비", "1차 서류완료", "2차서류안내", "2차서류미비", "2차서류완료", "접수보류"],
  법원: ["법원접수(대기)", "법원접수", "금지명령", "금지기각", "개시결정", "인가결정", "종결"],
  워크아웃: ["워크아웃", "새출발", "워크아웃 신청", "새출발 신청", "워크아웃 완료", "새출발 완료", "파산"],
};

export const DB_DETAIL_STAGE_TRACK_OF: Record<DbDetailStage, DbDetailStageTrack> = DB_DETAIL_STAGE_TRACKS.reduce(
  (acc, track) => {
    for (const s of DB_DETAIL_STAGE_GROUPS[track]) acc[s] = track;
    return acc;
  },
  {} as Record<DbDetailStage, DbDetailStageTrack>
);

// 트랙별 타일 색상 — 착수/서류는 보라 계열, 법원/워크아웃은 파랑 계열(참고 이미지 톤 참고)
export const DB_DETAIL_STAGE_TRACK_COLOR: Record<DbDetailStageTrack, string> = {
  착수: "#7c3aed", // violet-600
  서류: "#8b5cf6", // violet-500
  법원: "#2563eb", // blue-600
  워크아웃: "#0ea5e9", // sky-500
};

// ---- 상담일지 메모 게시판 ----
// 자유 텍스트 메모와 [재통화]/[부재중] 콜 태그를 함께 기록하는 누적 로그입니다.
// 태그가 붙은 항목(재통화/부재중)은 "하루 3회 이상 통화 시도" 경고 판정에도 쓰입니다
// (lib/consultation.ts의 checkCallWarning 참고).
export type MemoLogTag = "일반" | "재통화" | "부재중";

export interface MemoLogEntry {
  id: string;
  staff: StaffName;
  at: string; // ISO datetime
  text: string;
  tag: MemoLogTag;
}

export interface DbLead {
  id: string;
  name: string;
  phone: string;
  applicationType?: ConsultDirection; // 상담 후 방향(개인회생/개인파산/워크아웃) — 상담원이 상담 후 지정, 고객 전환 시 그대로 승계
  receivedAt: string; // ISO datetime — DB 접수 시각
  status: DbLeadStatus;
  assignedStaff: StaffName;
  source?: LeadSource; // 유입경로
  memo?: string; // 상담원이 남기는 기초정보 메모(간단 요약용 — 상세 이력은 상담일지 메모 게시판 참고)
  detailStage?: DbDetailStage; // 상세 DB관리 분류 — 상담일지에서 지정
  debtRange?: DebtRange; // 광고 인스턴트 양식 — 채무 총금액
  incomeRange?: IncomeRange; // 광고 인스턴트 양식 — 실 월소득
  consultTime?: ConsultTimeSlot; // 광고 인스턴트 양식 — 상담가능시간
  consultation?: ConsultationInfo; // 상담일지 — DB 단계에서부터 작성 가능, 고객 전환 시 그대로 승계
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
  // ---- v12 추가 — 상담일지 전면개편(대형 팝업) 요청 반영, 기존 필드는 위 그대로 유지 ----
  age?: number; // 나이 (생년월일을 모르는 경우를 위한 수동 입력 — 있으면 화면에 우선 표시)
  residenceRegion?: string; // 거주지역(시/군/구 요약) — address(상세주소)와 별개의 짧은 지역명
  workRegion?: string; // 회사지역
  maritalNote?: string; // 혼인/이혼 및 배우자 관련 메모
  parentCount?: number; // 부모 수
  parentAgeStatus?: string; // 부모 연령/상태
  parentSupportNote?: string; // 부모 소득 또는 부양여부
  callRequestTime?: string; // 통화 요청시간(자유 기재) — 광고 인스턴트양식의 상담가능시간(consultTime)과 별개로 상담 중 확인한 시간대
  dischargeHistory?: boolean; // 면책이력 여부
  dischargeHistoryNote?: string; // 면책이력 상세내용
  riskyAssetActivity?: boolean; // 코인/주식/도박/사행성 여부
  riskyAssetNote?: string; // 관련 메모
}

export interface ConsultationIncome {
  incomeType?: string; // 소득유형(근로소득/사업소득 등)
  workplaceName?: string; // 회사명·사업자명
  tenureInfo?: string; // 재직기간·사업장정보(자유 기재 — 기존 필드, 그대로 유지)
  tenureMonths?: number; // 재직기간(개월수) — v12 추가. tenureInfo(자유기재)와 별도로 "OO개월" 단위 빠른입력용
  monthlyAvgIncome?: number; // 월평균소득(최근 3개월)
  secondaryIncome?: number; // 2중소득(부업)
  pensionIncome?: number; // 연금소득(국민/노령)
  note?: string;
  // ---- v12 추가 ----
  hasFourInsurances?: boolean; // 4대보험 여부
  severancePayEstimate?: number; // 퇴직금(예상액) — 재산현황 표의 "퇴직금" 청산가치 평가액과는 별개로, 상담 중 확인한 개략 금액을 바로 기록
  salaryAccountBank?: string; // 급여통장 은행 (계좌 자체는 salaryAccount로 별도 기록)
  salaryAccount?: string; // 급여통장(은행 제외 계좌 메모 — 예: 입출금통장/OO은행 급여이체 등)
  salaryAccountChangeable?: boolean; // 급여통장 변경 가능 여부
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

// 기대출 리스트 — 채무현황 탭의 5개 고정 카테고리 합계표와는 별도로, 개별 대출 건을
// 하나씩 추가/삭제하며 기록하는 상세 목록입니다. 본인신용정보 열람서비스에서 내려받은
// 채무 내역을 보면서 하나씩 옮겨 적거나(파일 자동추출은 현재 미지원 — 서류를 보며
// 수기로 추가), 상담 중 구두로 확인한 대출을 즉시 추가할 수 있습니다.
export const LOAN_KIND1_OPTIONS = ["신용", "담보", "보증", "기타"] as const;
export type LoanKind1 = (typeof LOAN_KIND1_OPTIONS)[number];

export interface LoanRecord {
  id: string;
  kind1: LoanKind1; // 구분1 — 대출 성격
  kind2?: string; // 구분2 — 구체적 상품명 (예: 신용대출(100))
  lender?: string; // 금융사
  executedAt?: string; // 실행일(ISO date)
  balance: number; // 잔액(원)
  note?: string;
  // ---- v12 추가 — 채무 파일 업로드 파서(lib/debt-parsers)가 채워주는 정규화 필드.
  // 기존 5개(kind1/kind2/lender/executedAt/balance) + note는 그대로 두고, 자동계산(채무
  // 요약: 총이자·월불입금 등)과 파일 파싱 출처 구분에 필요한 필드만 additive로 추가했습니다.
  originalAmount?: number; // 실행 당시 원금
  monthlyPayment?: number; // 월 납입금
  interestRate?: number; // 금리(%)
  securedAmount?: number; // 담보설정액(담보대출인 경우)
  source?: "manual" | "file"; // 입력 경로 — 수기입력 / 파일 업로드에서 자동 추출
  sourceFileName?: string; // 파일에서 가져온 경우 원본 파일명(첨부파일 목록과 연결 참고용)
}

// 상담기록지에 첨부한 파일(신용정보 열람서비스 다운로드 파일 등)의 메타정보만 기록합니다.
// 이 데모에는 파일 업로드 백엔드가 없어 실제 파일 내용은 서버에 저장되지 않고, 첨부
// 사실과 파일명만 상담기록에 남습니다 — 실제 자동 추출(OCR/파싱)은 아직 지원하지 않습니다.
export interface AttachedFileMeta {
  id: string;
  name: string;
  sizeKb: number;
  attachedAt: string; // ISO datetime
}

// ---- v12 추가 — "자산" 영역(거주형태·차량). 기존 재산현황(AssetRow, 청산가치 산정용
// 표)과는 성격이 달라 별도 타입으로 두었습니다(기존 assets 필드는 그대로 유지).
export const HOUSING_TYPES = ["자가", "전세", "월세", "배우자 자가", "배우자 전세", "기타"] as const;
export type HousingType = (typeof HOUSING_TYPES)[number];

export interface ConsultationHousing {
  housingType?: HousingType;
  housingNote?: string; // 거주 관련 메모
  hasVehicle?: boolean; // 차량 보유 여부
  vehicleInfo?: string; // 차량 정보
  spouseHasVehicle?: boolean; // 배우자 차량 보유 여부
  spouseVehicleInfo?: string; // 배우자 차량 정보
}

// ---- v12 추가 — "의사/상담판단" 영역 ----
export interface ConsultationJudgment {
  workoutFeasible?: boolean; // 추후 워크아웃 가능 여부
  workoutGuided?: boolean; // 안내 여부
  costGuided?: boolean; // 부채발급비용/송달료/인지대 안내 여부
  workoutInProgress?: boolean; // 워크아웃 진행 여부
  workoutAmount?: number; // 금액
  judgmentNote?: string; // 판단 관련 메모
}

// ---- v12 추가 — "상담 플랜" 영역. 법원 변제계획 자동계산(RepaymentPlanInput/Result,
// 기존 그대로 유지)과 달리 상담원이 자유롭게 적는 예상 플랜·비율 메모입니다.
export interface ConsultationCounselPlan {
  rehabPlanNote?: string; // 회생 예상플랜
  recoveryPlanNote?: string; // 회복 예상플랜
  principalReductionPct?: number; // 원금 탕감율(%)
  paymentReductionPct?: number; // 변제금 감소율(%)
}

// ---- v12 추가 — "채무 요약"의 자동계산 대상이 아닌 수동 입력 보조 항목 ----
export interface ConsultationDebtSummaryExtra {
  salaryPayDay?: number; // 급여일(1~31)
  cardPaymentAmount?: number; // 카드결제금액
  cardPaymentDay?: number; // 카드결제일(1~31)
  heldCreditCards?: string; // 보유중인 신용카드(자유 텍스트, 콤마 구분)
}

// ---- v12 추가 — "최근 대출 / 보험" 영역 ----
export interface ConsultationRecentLoanInsurance {
  recentLoanUsage?: string; // 최근 3개월 내 대출 사용처
  insurancePremium?: number; // 보험료
  insuranceRefundAmount?: number; // 환급금액
  insuranceNote?: string; // 보험 관련 메모
}

export interface ConsultationInfo {
  personal?: ConsultationPersonal;
  income?: ConsultationIncome;
  assets?: AssetRow[];
  debts?: DebtRow[];
  plan?: RepaymentPlanInput;
  memo?: string; // (구) 단일 상담메모 — 화면에서는 더 이상 편집하지 않고 memoLog로 대체됨. 과거 데이터 호환용으로 필드만 유지.
  memoLog?: MemoLogEntry[]; // 상담메모 게시판 — 작성자·시각·태그(재통화/부재중/일반)가 남는 누적 로그
  loanRecords?: LoanRecord[]; // 기대출 리스트(개별 대출 상세)
  attachedFiles?: AttachedFileMeta[]; // 첨부파일 메타정보
  // ---- v12 추가 — 아래 5개는 모두 additive. 기존 필드는 이름·의미 변경 없이 그대로 둠 ----
  housing?: ConsultationHousing;
  judgment?: ConsultationJudgment;
  counselPlan?: ConsultationCounselPlan;
  debtSummaryExtra?: ConsultationDebtSummaryExtra;
  recentLoanInsurance?: ConsultationRecentLoanInsurance;
}
