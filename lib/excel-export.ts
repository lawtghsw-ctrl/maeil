"use client";

// 상담일지 엑셀 다운로드 — 고객이 전달해주신 "개인회생·개인파산 상담일지" 엑셀 서식의
// 섹션 구성(인적사항/소득현황/재산현황/채무현황/변제계획 자동계산/상담메모)을 그대로
// 재현합니다. 브라우저에서 버튼 클릭 시 바로 .xlsx 파일이 생성/다운로드됩니다.
// (SheetJS `xlsx` 패키지 사용 — 최초 1회 `npm install`로 내려받아야 합니다.)
import * as XLSX from "xlsx";
import type { AssetRow, ConsultationIncome, ConsultationPersonal, DebtRow, RepaymentPlanInput } from "./types";
import { computeRepaymentPlan } from "./consultation";

export interface ConsultationExportInput {
  clientName: string;
  phone: string;
  registeredAt: string;
  assignedStaff?: string;
  applicationType?: string;
  personal: ConsultationPersonal;
  income: ConsultationIncome;
  assets: AssetRow[];
  debts: DebtRow[];
  plan: RepaymentPlanInput;
  consultMemo?: string;
  contractMemo?: string;
}

function won(v: number | undefined): string {
  return v ? v.toLocaleString("ko-KR") + "원" : "";
}

function yesNo(v: boolean | undefined): string {
  return v === undefined ? "" : v ? "예" : "아니오";
}

export function exportConsultationExcel(input: ConsultationExportInput) {
  const { personal, income, assets, debts, plan } = input;
  const result = computeRepaymentPlan(
    income.monthlyAvgIncome ?? 0,
    income.secondaryIncome ?? 0,
    income.pensionIncome ?? 0,
    assets,
    debts,
    plan
  );

  const rows: (string | number)[][] = [];
  const section = (title: string) => rows.push([title]);
  const row = (label: string, value: string | number = "") => rows.push([label, value]);
  const blank = () => rows.push([]);

  section("개인회생·개인파산 상담일지");
  row("고객명", input.clientName);
  row("연락처", input.phone);
  row("등록일", input.registeredAt);
  row("담당자", input.assignedStaff ?? "");
  row("신청분류", input.applicationType ?? "");
  blank();

  section("1. 인적사항");
  row("생년월일", personal.birthDate ?? "");
  row("성별", personal.gender ?? "");
  row("거주지(초본주소)", personal.address ?? "");
  row("관할법원", personal.jurisdictionCourt ?? "");
  row("직업", personal.occupationType ?? "");
  row("배우자 유무", yesNo(personal.spouse));
  row("자녀 인원", personal.childrenCount ?? "");
  row("자녀 나이", personal.childrenAges ?? "");
  row("기타 부양가족", personal.otherDependents ?? "");
  row("중대질환·장기요양 여부", yesNo(personal.seriousIllness));
  row("부양가족 특이사항", personal.dependentNote ?? "");
  blank();

  section("2. 소득현황");
  row("소득유형", income.incomeType ?? "");
  row("회사명·사업자명", income.workplaceName ?? "");
  row("재직기간·사업장정보", income.tenureInfo ?? "");
  row("월평균소득(최근 3개월)", won(income.monthlyAvgIncome));
  row("2중소득(부업)", won(income.secondaryIncome));
  row("연금소득(국민/노령)", won(income.pensionIncome));
  row("연소득(자동)", won(result.totalIncome));
  row("비고", income.note ?? "");
  blank();

  section("3. 재산현황 (청산가치 산정용)");
  rows.push(["구분", "평가액", "담보·대출 여부", "담보·대출 금액", "비고"]);
  for (const a of assets) {
    rows.push([a.category, won(a.value), a.hasSecurity ? "예" : "아니오", won(a.securityAmount), a.note ?? ""]);
  }
  row("자산합계(자동)", won(result.assetTotal));
  row("소액임차인 최우선변제 참고메모", plan.smallLeaseNote ?? "");
  blank();

  section("4. 채무현황");
  rows.push(["구분", "채권자", "내용", "금액", "비고"]);
  for (const d of debts) {
    rows.push([d.category, d.creditor ?? "", d.detail ?? "", won(d.amount), d.note ?? ""]);
  }
  row("채무합계(자동)", won(result.debtTotal));
  row("담보채무합계(자동)", won(result.securedDebtTotal));
  row("신용채무(탕감대상)", won(result.unsecuredDebtTotal));
  blank();

  section("5. 변제계획 자동계산");
  row("가구원수", plan.householdSize);
  row("최저생계비", won(plan.minLivingCost));
  row("월평균소득(연동)", won(income.monthlyAvgIncome));
  row("기타공제금", won(plan.otherDeduction));
  row("변제개월수", plan.repaymentMonths);
  row("월 가용소득(자동)", won(result.monthlyDisposableIncome));
  row("총변제예정액(자동)", won(result.totalPlannedRepayment));
  row("청산가치(자동=자산-담보채무)", won(result.liquidationValue));
  row("청산가치 보장 여부", result.liquidationCovered ? "보장됨" : "미달");
  row("최종 월 변제금(자동)", won(result.finalMonthlyRepayment));
  row("최종 총변제예정액(자동)", won(result.finalTotalRepayment));
  row("기존 신용채무총액(연동)", won(result.unsecuredDebtTotal));
  row("탕감액(자동)", won(result.writeOffAmount));
  row("탕감률(자동)", `${result.writeOffRate.toFixed(1)}%`);
  row("진행가능여부(자동판정)", result.feasible ? "가능" : "재검토 필요");
  row("판정 사유", result.feasibilityNote);
  row("", "※ 추정치이며 최종 산정은 담당변호사 확인 필요");
  blank();

  section("6. 상담메모 / 상담내역");
  row("상담메모", input.consultMemo ?? "");
  row("계약 관련 메모", input.contractMemo ?? "");

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 26 }, { wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "상담일지");

  const safeName = input.clientName.replace(/[\\/:*?"<>|]/g, "");
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `상담일지_${safeName}_${dateStr}.xlsx`);
}
