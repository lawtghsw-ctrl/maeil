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

export type LeadSource =
  | "메타광고"
  | "커뮤니티"
  | "지인소개"
  | "네이버검색"
  | "재상담";

export interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  registeredAt: string; // ISO date
  source: LeadSource;
  memo?: string;
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
  memo?: string;
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
