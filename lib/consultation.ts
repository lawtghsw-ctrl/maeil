// 상담일지 "5. 변제계획 자동계산" 섹션 로직.
// 고객이 전달한 엑셀 서식의 계산식을 그대로 옮긴 것으로, 어디까지나 상담 단계의
// 추정치입니다(서식 원문 문구: "※ 추정치이며 최종 산정은 담당변호사 확인 필요").
//
// 법정 최저생계비 표(가구원수별)와 소액임차인 최우선변제 기준액(지역별)은 매년 고시가
// 바뀌고 실제 회생/파산 인가 여부에 직결되는 민감한 법적 수치이므로, 이 파일에서는
// 임의의 표를 만들어 자동판정하지 않습니다. 최저생계비는 1인가구 기준값만 상담일지
// 원본 수치(1,538,543원)로 미리 채워두고 그 외에는 상담원이 매년 고시된 기준중위소득표를
// 보고 직접 입력하도록 하며, 소액임차인 최우선변제는 참고 메모 필드로만 제공합니다.

import type { AssetRow, ConsultationInfo, ConsultDirection, DebtRow, RepaymentPlanInput } from "./types";
import { ASSET_CATEGORIES, DEBT_CATEGORIES, SECURED_DEBT_CATEGORIES, UNSECURED_DEBT_CATEGORY } from "./types";

// 상담일지 원본에 명시된 1인가구 기준 최저생계비(2025년 기준중위소득 60% 수준 예시값).
// 2인 이상 가구는 매년 고시되는 기준중위소득표를 상담원이 직접 확인해 입력해야 하므로
// 기본값을 제공하지 않습니다.
export const MIN_LIVING_COST_1P = 1538543;

// ---- 최저생계비 계산기 (메뉴: "최저생계비 계산기") ----
// 가구원수별 최저생계비는 매년 고시가 바뀌는 법적으로 민감한 수치라, LawPower가 임의의
// 표를 만들어 자동판정하지 않습니다. 대신 '최저생계비 계산기' 화면에서 로펌 관리자가
// 매년 고시된 최신 기준중위소득표를 직접 입력해 관리하고, 그 값이 고객 상담일지의
// 변제계획 탭에 자동 반영되도록 합니다(1인가구만 상담일지 원문 수치로 미리 채워둠).
export interface MinLivingCostTable {
  sizes: Record<number, number>; // 가구원수(1~6) -> 최저생계비
  extraPerPerson: number; // 7인 이상부터 1인 추가마다 더할 금액(관리자 설정, 기본 0)
}

export const MIN_LIVING_COST_HOUSEHOLD_SIZES = [1, 2, 3, 4, 5, 6] as const;

export function defaultMinLivingCostTable(): MinLivingCostTable {
  return {
    sizes: { 1: MIN_LIVING_COST_1P, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    extraPerPerson: 0,
  };
}

// 가구원수에 해당하는 최저생계비를 조회. 6인 초과는 6인 기준값 + (초과 인원 × 1인당 추가금액).
// 관리자가 아직 해당 가구원수를 설정하지 않아 0으로 남아있으면 0을 그대로 반환합니다
// (화면에서 "관리자 설정 필요"로 안내).
export function lookupMinLivingCost(householdSize: number, table: MinLivingCostTable): number {
  const size = Math.max(1, Math.round(householdSize || 1));
  if (size <= 6) return table.sizes[size] ?? 0;
  const base = table.sizes[6] ?? 0;
  return base + (size - 6) * (table.extraPerPerson || 0);
}

export function emptyAssetRows(): AssetRow[] {
  return ASSET_CATEGORIES.map((category) => ({
    category,
    value: 0,
    hasSecurity: false,
    securityAmount: 0,
    note: "",
  }));
}

export function emptyDebtRows(): DebtRow[] {
  return DEBT_CATEGORIES.map((category) => ({
    category,
    creditor: "",
    detail: "",
    amount: 0,
    note: "",
  }));
}

export function emptyPlanInput(): RepaymentPlanInput {
  return {
    householdSize: 1,
    minLivingCost: MIN_LIVING_COST_1P,
    otherDeduction: 0,
    repaymentMonths: 36,
    smallLeaseNote: "",
  };
}

export function sumAssets(rows: AssetRow[]): number {
  return rows.reduce((a, r) => a + (r.value || 0), 0);
}

export function sumDebts(rows: DebtRow[]): number {
  return rows.reduce((a, r) => a + (r.amount || 0), 0);
}

export function sumSecuredDebts(rows: DebtRow[]): number {
  return rows
    .filter((r) => SECURED_DEBT_CATEGORIES.includes(r.category))
    .reduce((a, r) => a + (r.amount || 0), 0);
}

export function sumUnsecuredDebt(rows: DebtRow[]): number {
  return rows.filter((r) => r.category === UNSECURED_DEBT_CATEGORY).reduce((a, r) => a + (r.amount || 0), 0);
}

export interface RepaymentPlanResult {
  totalIncome: number; // 연소득(자동) 근사 — 월평균소득 등의 합 × 12
  assetTotal: number; // 자산합계(자동)
  debtTotal: number; // 채무합계(자동)
  securedDebtTotal: number; // 담보채무합계(자동)
  unsecuredDebtTotal: number; // 신용채무(탕감대상)
  monthlyDisposableIncome: number; // 월 가용소득(자동)
  totalPlannedRepayment: number; // 총변제예정액(자동)
  liquidationValue: number; // 청산가치(자동=자산-담보채무)
  liquidationCovered: boolean; // 청산가치 보장 여부
  finalMonthlyRepayment: number; // 최종 월 변제금(자동)
  finalTotalRepayment: number; // 최종 총변제예정액(자동)
  writeOffAmount: number; // 탕감액(자동)
  writeOffRate: number; // 탕감률(자동, %)
  feasible: boolean; // 진행가능여부(자동판정)
  feasibilityNote: string;
}

// ---- 상담기록지 필수항목 체크 ----
// "실제 계약(=완결된 상담기록지)을 하지 않는 이상 고객관리로 넘기지 않도록" 요청 반영.
// 상담기록지 전체를 다 채우도록 강제하면 오히려 상담 초기 단계 기록이 막혀버리므로,
// '고객 전환' 판단에 실제로 필요한 핵심 항목만 필수로 두었습니다. 화면에서는 이 항목이
// 비어있으면 하늘색으로 강조 표시하고, 하나라도 비어있으면 '고객 전환' 버튼을 막습니다.
// 필요에 따라 이 목록은 언제든 추가/조정할 수 있습니다.
export interface ConsultationCompleteness {
  ok: boolean;
  missing: string[]; // 사람이 읽을 수 있는 누락 항목 설명
}

export function checkConsultationRequired(
  applicationType: ConsultDirection | undefined,
  consultation: ConsultationInfo | undefined
): ConsultationCompleteness {
  const missing: string[] = [];

  if (!applicationType) missing.push("상담 후 방향(개인회생/개인파산/워크아웃) 미지정");

  const personal = consultation?.personal;
  if (!personal?.address?.trim()) missing.push("[인적사항] 거주지(초본주소) 미입력");
  if (!personal?.occupationType) missing.push("[인적사항] 직업 미선택");

  const income = consultation?.income;
  if (!income?.monthlyAvgIncome || income.monthlyAvgIncome <= 0) missing.push("[소득현황] 월평균소득 미입력");

  const debts = consultation?.debts ?? [];
  const loanRecords = consultation?.loanRecords ?? [];
  const hasDebtAmount = debts.some((d) => (d.amount || 0) > 0) || loanRecords.some((l) => (l.balance || 0) > 0);
  if (!hasDebtAmount) missing.push("[채무현황] 총 채무금액 미입력(채무현황 표 또는 기대출 리스트 중 하나는 있어야 함)");

  return { ok: missing.length === 0, missing };
}

export function computeRepaymentPlan(
  monthlyAvgIncome: number,
  secondaryIncome: number,
  pensionIncome: number,
  assets: AssetRow[],
  debts: DebtRow[],
  plan: RepaymentPlanInput
): RepaymentPlanResult {
  const monthlyIncomeTotal = (monthlyAvgIncome || 0) + (secondaryIncome || 0) + (pensionIncome || 0);
  const totalIncome = monthlyIncomeTotal * 12;

  const assetTotal = sumAssets(assets);
  const debtTotal = sumDebts(debts);
  const securedDebtTotal = sumSecuredDebts(debts);
  const unsecuredDebtTotal = sumUnsecuredDebt(debts);

  const months = Math.max(1, plan.repaymentMonths || 1);
  const monthlyDisposableIncome = Math.max(
    0,
    monthlyIncomeTotal - (plan.minLivingCost || 0) - (plan.otherDeduction || 0)
  );
  const totalPlannedRepayment = monthlyDisposableIncome * months;

  const liquidationValue = Math.max(0, assetTotal - securedDebtTotal);
  const liquidationCovered = totalPlannedRepayment >= liquidationValue;

  // 청산가치 보장의 원칙: 총변제예정액이 청산가치에 못 미치면 청산가치를 변제기간으로
  // 나눈 금액을 최종 월 변제금으로 끌어올림.
  const finalMonthlyRepayment = liquidationCovered
    ? monthlyDisposableIncome
    : Math.max(monthlyDisposableIncome, Math.ceil(liquidationValue / months));
  const finalTotalRepayment = finalMonthlyRepayment * months;

  const writeOffAmount = Math.max(0, unsecuredDebtTotal - finalTotalRepayment);
  const writeOffRate = unsecuredDebtTotal > 0 ? (writeOffAmount / unsecuredDebtTotal) * 100 : 0;

  let feasible = true;
  let feasibilityNote = "월 가용소득과 변제기간을 기준으로 진행 가능한 것으로 추정됩니다.";
  if (monthlyIncomeTotal <= 0) {
    feasible = false;
    feasibilityNote = "소득 정보가 입력되지 않아 판정할 수 없습니다.";
  } else if (monthlyDisposableIncome <= 0) {
    feasible = false;
    feasibilityNote = "월 가용소득이 0원 이하입니다 — 최저생계비·공제금 대비 소득 재확인이 필요합니다.";
  } else if (finalMonthlyRepayment > monthlyIncomeTotal) {
    feasible = false;
    feasibilityNote = "청산가치 보장을 위한 월 변제금이 월 소득을 초과합니다 — 담당변호사 재검토가 필요합니다.";
  }

  return {
    totalIncome,
    assetTotal,
    debtTotal,
    securedDebtTotal,
    unsecuredDebtTotal,
    monthlyDisposableIncome,
    totalPlannedRepayment,
    liquidationValue,
    liquidationCovered,
    finalMonthlyRepayment,
    finalTotalRepayment,
    writeOffAmount,
    writeOffRate,
    feasible,
    feasibilityNote,
  };
}
