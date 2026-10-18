import type { ConsultationInfo, ConsultDirection, DbDetailStage, MemoLogTag } from "./types";
import type { RepaymentPlanResult } from "./consultation";
import { visibleMemoEntries } from "./consultation-memos";

export interface ConsultationPdfMemoDraft { text: string; tag: MemoLogTag; staff: string }
export interface ConsultationPdfSnapshot {
  name: string;
  phone: string;
  joinedAtLabel: string;
  caseNumberLabel: string;
  applicationType?: ConsultDirection;
  detailStage?: DbDetailStage;
  reservationChoice?: boolean;
  reservationAt?: string;
  consultation: ConsultationInfo;
  result?: RepaymentPlanResult;
  finance?: { contractAmount: number; paidAmount: number; outstandingAmount: number };
  memoDraft?: ConsultationPdfMemoDraft;
  exportedAt: string;
  hasUnsavedChanges: boolean;
}
export interface ConsultationPdfSection { title: string; head: string[]; rows: string[][]; widths?: number[] }
type Value = string | number | boolean | undefined | null;
type Field = [string, Value];

// Keep text as text, never HTML. Preserve otherwise unsupported astral characters reversibly.
export function consultationPdfText(value: Value): string {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("ko-KR") : "확인 필요";
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u{10000}-\u{10ffff}]/gu, character => `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`);
}
function won(value: number | undefined): string | undefined {
  return value == null ? undefined : `${consultationPdfText(value)}원`;
}
function suffix(value: number | undefined, unit: string): string | undefined {
  return value == null ? undefined : `${consultationPdfText(value)}${unit}`;
}
export function consultationPdfDateTime(value: string | undefined): string {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+09:00`);
  if (!Number.isFinite(date.getTime())) return consultationPdfText(value);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${kst.slice(0, 10)} ${kst.slice(11, 16)}`;
}

/** Explicit allowlist prevents attachment bytes, URLs, hidden IDs or unrelated customer data entering the PDF. */
export function consultationPdfSections(snapshot: ConsultationPdfSnapshot): ConsultationPdfSection[] {
  const c = snapshot.consultation;
  const p = c.personal ?? {}, i = c.income ?? {}, h = c.housing ?? {}, j = c.judgment ?? {};
  const cp = c.counselPlan ?? {}, de = c.debtSummaryExtra ?? {}, ri = c.recentLoanInsurance ?? {};
  const sections: ConsultationPdfSection[] = [];
  function fields(title: string, entries: Field[]) {
    const present = entries.filter(([, value]) => value != null && value !== "");
    const rows: string[][] = [];
    for (let index = 0; index < present.length; index += 2) {
      const left = present[index], right = present[index + 1];
      rows.push([left[0], consultationPdfText(left[1]), right?.[0] ?? "", right ? consultationPdfText(right[1]) : ""]);
    }
    sections.push({ title, head: ["항목", "내용", "항목", "내용"], rows: rows.length ? rows : [["입력 내용", "미입력", "", ""]], widths: [27, 64, 27, 64] });
  }
  fields("기본정보", [
    ["성명", snapshot.name], ["연락처", snapshot.phone], ["접수 / 등록", snapshot.joinedAtLabel], ["사건번호", snapshot.caseNumberLabel],
    ["상담 후 방향", snapshot.applicationType], ["상세 단계", snapshot.detailStage], ["예약 여부", snapshot.reservationChoice], ["예약 일시", snapshot.reservationAt ? consultationPdfDateTime(snapshot.reservationAt) : undefined],
    ["생년월일", p.birthDate], ["나이", suffix(p.age, "세")], ["성별", p.gender], ["직군", p.occupationType],
    ["거주지역", p.residenceRegion], ["상세주소", p.address], ["관할법원", p.jurisdictionCourt], ["회사지역", p.workRegion], ["회사 관할법원", p.workJurisdictionCourt],
    ["배우자 유무", p.spouse], ["혼인 / 배우자 메모", p.maritalNote], ["자녀 수", suffix(p.childrenCount, "명")], ["자녀 나이", p.childrenAges],
    ["부모 수", suffix(p.parentCount, "명")], ["부모 연령 / 상태", p.parentAgeStatus], ["부모 소득 / 부양", p.parentSupportNote],
    ["기타 부양가족", p.otherDependents], ["중대질환 / 요양", p.seriousIllness], ["부양가족 특이사항", p.dependentNote],
    ["소득 확인내용", p.basicIncomeNote], ["통화 요청시간", p.callRequestTime], ["면책이력", p.dischargeHistory], ["면책 상세내용", p.dischargeHistoryNote],
  ]);
  fields("소득", [
    ["소득유형", i.incomeType], ["회사 / 사업자명", i.workplaceName], ["첫 취직일", i.employmentStartDate], ["재직기간", i.tenureInfo], ["재직 개월", suffix(i.tenureMonths, "개월")],
    ["월평균 소득", won(i.monthlyAvgIncome)], ["부업 소득", won(i.secondaryIncome)], ["연금 소득", won(i.pensionIncome)], ["4대보험", i.hasFourInsurances],
    ["예상 퇴직금", won(i.severancePayEstimate)], ["급여 은행", i.salaryAccountBank], ["급여통장 메모", i.salaryAccount], ["급여통장 변경", i.salaryAccountChangeable], ["소득 메모", i.note],
  ]);
  fields("주거 / 차량 / 기타 재산", [
    ["거주형태", h.housingType], ["거주 메모", h.housingNote], ["차량 보유", h.hasVehicle], ["차량 정보", h.vehicleInfo], ["배우자 차량", h.spouseHasVehicle], ["배우자 차량 정보", h.spouseVehicleInfo],
    ["본인명의 다른 재산", p.otherAssetsNote], ["개인채무", p.personalDebtNote], ["채무사실 공유", p.debtDisclosureShared], ["공유 메모", p.debtDisclosureNote], ["코인 / 주식 / 사행성", p.riskyAssetActivity], ["관련 메모", p.riskyAssetNote],
  ]);
  if (c.assets?.length) sections.push({ title: "재산 현황", head: ["구분", "평가액", "담보 여부 / 금액", "메모"], widths: [39, 32, 43, 68], rows: c.assets.map(row => [row.category, won(row.value)!, `${consultationPdfText(row.hasSecurity)} / ${won(row.securityAmount)}`, consultationPdfText(row.note)]) });
  const loans = c.loanRecords ?? [];
  const autoDebt = loans.reduce((total, row) => total + (row.balance || 0), 0);
  const autoCredit = loans.filter(row => row.kind1 === "신용").reduce((total, row) => total + (row.balance || 0), 0);
  const autoSecured = loans.filter(row => row.kind1 === "담보").reduce((total, row) => total + (row.balance || 0), 0);
  const autoInterest = loans.reduce((total, row) => total + (row.balance || 0) * ((row.interestRate || 0) / 100), 0);
  const autoMonthly = loans.reduce((total, row) => total + (row.monthlyPayment || 0), 0);
  fields("채무 요약", [
    ["총 채무금액", won(de.totalDebtAmount ?? (autoDebt || undefined))], ["총 신용금액", won(de.totalCreditAmount ?? (autoCredit || undefined))], ["총 담보금액", won(de.totalSecuredAmount ?? (autoSecured || undefined))],
    ["총 이자금액", won(de.totalInterestAmount ?? (autoInterest || undefined))], ["월 불입금", won(de.monthlyPaymentAmount ?? (autoMonthly || undefined))],
    ["급여일", suffix(de.salaryPayDay, "일")], ["카드결제 금액", won(de.cardPaymentAmount)], ["대출결제일", suffix(de.cardPaymentDay, "일")], ["보유 신용카드", de.heldCreditCards],
  ]);
  if (c.debts?.length) sections.push({ title: "채무 현황", head: ["구분", "채권자 / 내용", "금액", "메모"], widths: [44, 56, 30, 52], rows: c.debts.map(row => [row.category, [row.creditor, row.detail].filter(Boolean).join("\n") || "-", won(row.amount)!, consultationPdfText(row.note)]) });
  if (loans.length) sections.push({ title: `기대출 리스트 (${loans.length}건)`, head: ["번호 / 구분", "금융사 / 상품 / 실행일", "금액 / 납입 / 금리", "메모 / 출처"], widths: [25, 49, 52, 56], rows: loans.map((row, index) => [
    `${index + 1} / ${row.kind1}`,
    [row.lender, row.kind2, row.executedAt].filter(Boolean).join("\n") || "-",
    [`잔액 ${won(row.balance)}`, row.originalAmount != null ? `원금 ${won(row.originalAmount)}` : "", row.monthlyPayment != null ? `월 납입 ${won(row.monthlyPayment)}` : "", row.interestRate != null ? `금리 ${suffix(row.interestRate, "%")}` : "", row.securedAmount != null ? `담보설정 ${won(row.securedAmount)}` : ""].filter(Boolean).join("\n"),
    [row.note, row.source === "file" ? "파일 추출" : row.source === "manual" ? "수기 입력" : "", row.sourceFileName].filter(Boolean).join("\n") || "-",
  ]) });
  fields("상담 판단 / 최근 대출 / 보험", [
    ["워크아웃 가능", j.workoutFeasible], ["워크아웃 안내", j.workoutGuided], ["비용 안내", j.costGuided], ["워크아웃 진행", j.workoutInProgress], ["워크아웃 금액", won(j.workoutAmount)], ["판단 메모", j.judgmentNote],
    ["최근 3개월 대출 사용처", ri.recentLoanUsage], ["보험료", won(ri.insurancePremium)], ["보험 환급금", won(ri.insuranceRefundAmount)], ["보험 메모", ri.insuranceNote],
  ]);
  fields("상담 플랜", [
    ["회생 예상플랜", cp.rehabPlanNote], ["회복 예상플랜", cp.recoveryPlanNote], ["원금 탕감율", cp.principalReductionRange ?? suffix(cp.principalReductionPct, "%")], ["변제금 감소율", cp.paymentReductionRange ?? suffix(cp.paymentReductionPct, "%")],
    ["가구원수", suffix(c.plan?.householdSize, "명")], ["최저생계비", won(c.plan?.minLivingCost)], ["기타 공제금", won(c.plan?.otherDeduction)], ["변제개월수", suffix(c.plan?.repaymentMonths, "개월")], ["소액임차인 참고", c.plan?.smallLeaseNote],
  ]);
  if (snapshot.result) {
    const r = snapshot.result;
    fields("화면의 변제계획 계산값 (상담 참고)", [["연소득", won(r.totalIncome)], ["자산합계", won(r.assetTotal)], ["채무합계", won(r.debtTotal)], ["담보채무", won(r.securedDebtTotal)], ["신용채무", won(r.unsecuredDebtTotal)], ["월 가용소득", won(r.monthlyDisposableIncome)], ["총 변제예정액", won(r.totalPlannedRepayment)], ["청산가치", won(r.liquidationValue)], ["청산가치 보장", r.liquidationCovered], ["최종 월 변제금", won(r.finalMonthlyRepayment)], ["최종 총 변제액", won(r.finalTotalRepayment)], ["예상 탕감액", won(r.writeOffAmount)], ["예상 탕감률", suffix(r.writeOffRate, "%")], ["진행가능 추정", r.feasible], ["판정 참고", r.feasibilityNote]]);
  }
  if (snapshot.finance) fields("계약 / 수납 요약", [["계약금액", won(snapshot.finance.contractAmount)], ["납부금액", won(snapshot.finance.paidAmount)], ["미수금액", won(snapshot.finance.outstandingAmount)]]);
  if (snapshot.memoDraft?.text.trim()) sections.push({ title: "작성 중 메모 (미등록)", head: ["작성자 / 태그", "현재 입력 내용"], widths: [40, 142], rows: [[`${snapshot.memoDraft.staff}\n${snapshot.memoDraft.tag === "재통화" ? "통화완료" : snapshot.memoDraft.tag}`, snapshot.memoDraft.text]] });
  if (c.memo) sections.push({ title: "기존 상담 메모", head: ["내용"], rows: [[c.memo]] });
  const memoEntries = visibleMemoEntries(c.memoLog);
  sections.push({ title: `상담 메모 (${memoEntries.length}건)`, head: ["작성자 / 일시 / 태그", "내용"], widths: [43, 139], rows: memoEntries.length ? memoEntries.map(entry => [`${entry.pinned ? "[고정] " : ""}${entry.staff}\n${consultationPdfDateTime(entry.at)}\n${entry.tag === "재통화" ? "통화완료" : entry.tag}`, entry.text || "(내용 없음)"]) : [["-", "등록된 메모 없음"]] });
  if (c.attachedFiles?.length) sections.push({ title: "첨부파일 목록 (파일 내용 미포함)", head: ["파일명", "크기", "첨부 일시"], widths: [112, 25, 45], rows: c.attachedFiles.map(file => [file.name, `${consultationPdfText(file.sizeKb)} KB`, consultationPdfDateTime(file.attachedAt)]) });
  return sections.map(section => ({ ...section, rows: section.rows.map(row => row.map(value => consultationPdfText(value))) }));
}

export function consultationPdfFilename(snapshot: Pick<ConsultationPdfSnapshot, "name" | "exportedAt">): string {
  const name = (snapshot.name || "고객").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 60).trim() || "고객";
  const date = consultationPdfDateTime(snapshot.exportedAt).slice(0, 10).replace(/[^0-9-]/g, "");
  return `상담일지_${name}_${date || "내보내기"}.pdf`;
}
