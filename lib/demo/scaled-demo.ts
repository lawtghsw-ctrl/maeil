import type { CaseRecord, Client, ConsultationInfo, DbLead, Installment, ScheduleItem } from "@/lib/types";

/** Pure, synthetic append-only plan. This module never reads or writes a service. */
export const SCALED_DEMO_KIND = "lawpower_scaled_demo_v2";
export const SCALED_DEMO_RANGE = { start: "2026-10-01", end: "2026-10-18" } as const;
export const SCALED_DEMO_STAFF = ["TEST1", "TEST2", "TEST3", "TEST4", "TEST5", "TEST6"] as const;
export const SCALED_DEMO_TARGETS = {
  leads: 500, cases: 90, activePerStaff: 40, casesPerStaff: 15, unitPrice: 50_000,
  staffLeads: [84, 84, 83, 83, 83, 83],
  groups: { retained: 90, fresh: 40, absent: 80, longAbsent: 30, reserved: 40, consulting: 50, closed: 170 },
} as const;

type Group = keyof typeof SCALED_DEMO_TARGETS.groups;
type ExistingLead = Readonly<Pick<DbLead, "id" | "assignedStaff" | "receivedAt" | "status" | "detailStage" | "convertedClientId" | "convertedCaseId" | "_lawFirmId">>;
type ExistingCase = Readonly<Pick<CaseRecord, "id" | "clientId" | "assignedStaff" | "status" | "contractAmount" | "fromLeadId" | "_lawFirmId">>;
export interface ScaledSalesDemoInput {
  firmId: string;
  /** Persist this together with the original 12/4 baseline; reuse it on retry. */
  batchKey: string;
  existingLeads: readonly ExistingLead[];
  existingCases: readonly ExistingCase[];
}
const groups = Object.keys(SCALED_DEMO_TARGETS.groups) as Group[];
const activeGroups: Group[] = ["fresh", "absent", "longAbsent", "reserved", "consulting"];
const terminalStatuses = new Set(["거절", "부적합", "종결_중단"]);
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const timestamp = (date: string, hour = 14, minute = 0) => `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const emptyGroups = () => Object.fromEntries(groups.map(key => [key, 0])) as Record<Group, number>;
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function groupOf(lead: ExistingLead): Group {
  if (lead.convertedClientId) return "retained";
  if (terminalStatuses.has(lead.status)) return "closed";
  if (lead.detailStage === "장기부재") return "longAbsent";
  if (lead.detailStage === "부재" || (!lead.detailStage && lead.status === "부재중")) return "absent";
  if (lead.detailStage === "예약") return "reserved";
  if (["신규디비", "미상담", "문자발송완료"].includes(lead.detailStage ?? "") || (!lead.detailStage && ["신규접수", "상담예정"].includes(lead.status))) return "fresh";
  return "consulting";
}
function receivedDay(value: string) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  requireCondition(Number.isFinite(parsed), "기존 DB 접수일을 확인해주세요.");
  const date = new Date(parsed + 9 * 60 * 60_000).toISOString().slice(0, 10);
  requireCondition(date >= SCALED_DEMO_RANGE.start && date <= SCALED_DEMO_RANGE.end, "기존 DB가 시연 집계 기간 밖에 있습니다. 원본을 변경하지 않고 계획을 중단합니다.");
  return Number(date.slice(8));
}

export function buildScaledSalesDemo(input: ScaledSalesDemoInput) {
  const { firmId, batchKey, existingLeads, existingCases } = input;
  requireCondition(typeof firmId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firmId), "시연 로펌 ID를 확인해주세요.");
  requireCondition(typeof batchKey === "string" && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$/.test(batchKey), "시연 배치 키를 확인해주세요.");
  requireCondition(Array.isArray(existingLeads) && existingLeads.length === 12 && Array.isArray(existingCases) && existingCases.length === 4, "보존할 기존 12개 DB와 4개 계약의 최초 스냅샷이 필요합니다. 확장된 자료를 새 기준으로 다시 생성하지 않습니다.");
  const id = (kind: string, n: number) => `DEMO2-${firmId}-${batchKey}-${kind}-${String(n).padStart(3, "0")}`;
  const byStaff = SCALED_DEMO_STAFF.map((staff, index) => ({ staff, target: SCALED_DEMO_TARGETS.staffLeads[index], leads: 0, retained: 0, active: 0, closed: 0 }));
  const staffIndex = new Map<string, number>(SCALED_DEMO_STAFF.map((staff, index) => [staff, index]));
  const originalLeadIds = new Set<string>(), originalCaseIds = new Set<string>(), originalClientIds = new Set<string>();
  const leadById = new Map<string, ExistingLead>();
  const beforeGroups = emptyGroups(), dayCounts = Array.from({ length: 18 }, () => 0);
  for (const lead of existingLeads) {
    requireCondition(typeof lead.id === "string" && !!lead.id && !originalLeadIds.has(lead.id), "기존 DB ID가 비어 있거나 중복됩니다.");
    requireCondition(!lead._lawFirmId || lead._lawFirmId === firmId, "기존 DB의 소속 로펌이 일치하지 않습니다.");
    const index = staffIndex.get(lead.assignedStaff);
    requireCondition(index !== undefined, "기존 DB 담당자가 TEST1~TEST6 범위를 벗어납니다.");
    originalLeadIds.add(lead.id); leadById.set(lead.id, lead);
    const group = groupOf(lead), staff = byStaff[index];
    staff.leads += 1; beforeGroups[group] += 1; dayCounts[receivedDay(lead.receivedAt) - 1] += 1;
    if (group === "retained") { staff.retained += 1; originalClientIds.add(lead.convertedClientId!); }
    else if (group === "closed") staff.closed += 1;
    else staff.active += 1;
  }
  const retainedLeadIds = new Set<string>();
  for (const record of existingCases) {
    requireCondition(typeof record.id === "string" && !!record.id && !originalCaseIds.has(record.id), "기존 계약 ID가 비어 있거나 중복됩니다.");
    requireCondition(!record._lawFirmId || record._lawFirmId === firmId, "기존 계약의 소속 로펌이 일치하지 않습니다.");
    requireCondition(Number.isFinite(record.contractAmount) && record.contractAmount > 0 && record.status !== "취하", "기존 4개 계약은 유효한 양수 수임이어야 합니다.");
    const lead = record.fromLeadId ? leadById.get(record.fromLeadId) : undefined;
    requireCondition(lead && lead.convertedCaseId === record.id && lead.convertedClientId === record.clientId && lead.assignedStaff === record.assignedStaff && !retainedLeadIds.has(lead.id), "기존 DB·고객·계약의 명시적 연결 또는 담당자가 일치하지 않습니다.");
    retainedLeadIds.add(lead.id); originalCaseIds.add(record.id);
  }
  requireCondition(beforeGroups.retained === 4 && originalClientIds.size === 4, "기존 전환 DB와 고객은 각각 4개여야 합니다.");
  for (const lead of existingLeads) requireCondition(!lead.convertedCaseId || retainedLeadIds.has(lead.id), "연결되지 않은 기존 계약 참조가 있습니다.");

  const deficits = Object.fromEntries(groups.map(group => [group, SCALED_DEMO_TARGETS.groups[group] - beforeGroups[group]])) as Record<Group, number>;
  requireCondition(groups.every(group => deficits[group] >= 0), "기존 단계 수가 시연 목표를 초과합니다. 원본 변경 없이 계획을 다시 확인해주세요.");
  type Spec = { staff: string; staffIndex: number; group: Group; order: number; receivedDay?: number };
  const specs: Spec[] = [];
  const activeRemaining = byStaff.map(staff => SCALED_DEMO_TARGETS.activePerStaff - staff.active);
  for (const [index, staff] of byStaff.entries()) {
    const retained = SCALED_DEMO_TARGETS.casesPerStaff - staff.retained;
    const closed = staff.target - SCALED_DEMO_TARGETS.activePerStaff - SCALED_DEMO_TARGETS.casesPerStaff - staff.closed;
    requireCondition(retained >= 0 && closed >= 0 && activeRemaining[index] >= 0, "기존 직원별 배정 수가 시연 목표를 초과합니다.");
    for (const group of ["retained", "closed"] as const) {
      const count = group === "retained" ? retained : closed;
      for (let n = 0; n < count; n++) specs.push({ staff: staff.staff, staffIndex: index, group, order: specs.length });
    }
  }
  let cursor = 0;
  for (const group of activeGroups) {
    for (let n = 0; n < deficits[group]; n++) {
      let attempts = 0;
      while (activeRemaining[cursor] <= 0 && attempts++ < 6) cursor = (cursor + 1) % 6;
      requireCondition(activeRemaining[cursor] > 0, "직원별 활성 DB 배정 계획을 확인해주세요.");
      specs.push({ staff: SCALED_DEMO_STAFF[cursor], staffIndex: cursor, group, order: specs.length });
      activeRemaining[cursor] -= 1; cursor = (cursor + 1) % 6;
    }
  }
  requireCondition(specs.length === 488 && activeRemaining.every(count => count === 0), "추가 DB 수 또는 활성 배정 수가 목표와 다릅니다.");
  // Deterministic permutation prevents contiguous staff/stage/date blocks.
  const ordered = specs.map((_, index) => specs[(index * 137) % specs.length]);
  const chooseDay = (maximum: number) => {
    let best = 0;
    for (let index = 1; index < maximum; index++) if (dayCounts[index] < dayCounts[best]) best = index;
    dayCounts[best] += 1;
    return best + 1;
  };
  // Long-absence records have enough elapsed days; all intake days remain balanced.
  for (const spec of ordered.filter(spec => spec.group === "longAbsent")) spec.receivedDay = chooseDay(10);
  for (const spec of ordered) if (!spec.receivedDay) spec.receivedDay = chooseDay(18);

  const leads: DbLead[] = [], clients: Client[] = [], cases: CaseRecord[] = [], installments: Installment[] = [], schedules: ScheduleItem[] = [];
  for (const [index, spec] of ordered.entries()) {
    const n = index + 13, date = day(spec.receivedDay!), group = spec.group;
    const stageDate = day(Math.min(18, spec.receivedDay! + (group === "longAbsent" ? 6 : group === "fresh" ? 0 : 1)));
    const debt = (28 + n % 67) * 1_000_000, firstDebt = Math.floor(debt * 0.6 / 1_000_000) * 1_000_000;
    const income = 2_400_000 + (n % 10) * 150_000, deposit = (5 + n % 6) * 1_000_000;
    const connected = !["fresh", "absent", "longAbsent"].includes(group);
    const note = connected ? "[시연] 가상 상담에서 확인한 예시 정보입니다." : "[시연] 가상 신청서 입력 정보이며 통화 확인 전입니다.";
    const consultation: ConsultationInfo = {
      personal: { age: 28 + n % 32, gender: n % 2 ? "여" : "남", residenceRegion: "시연지역", address: "가상 주소 · 실제 거주지 아님", workRegion: "시연 근무지역", occupationType: n % 4 ? "직장인" : "프리랜서", spouse: n % 3 === 0, childrenCount: n % 3 === 0 ? 1 : 0, childrenAges: n % 3 === 0 ? "가상 자녀 8세" : "없음", otherDependents: "추가 부양 없음", callRequestTime: n % 2 ? "오후 2~4시" : "오전 10~12시", dischargeHistory: false, basicIncomeNote: note, debtDisclosureShared: n % 2 === 0, debtDisclosureNote: "시연용 가족 공유 여부 예시" },
      income: { incomeType: n % 4 ? "근로소득" : "사업소득", workplaceName: `가상사업장 ${String(n % 20 + 1).padStart(2, "0")}`, tenureMonths: 12 + n % 48, tenureInfo: `${12 + n % 48}개월`, monthlyAvgIncome: income, secondaryIncome: n % 7 === 0 ? 150_000 : 0, hasFourInsurances: n % 4 !== 0, salaryAccountBank: "가상은행", salaryAccount: "계좌번호 미기재", note },
      housing: { housingType: n % 3 ? "월세" : "전세", housingNote: `[시연] 임차보증금 ${deposit.toLocaleString("ko-KR")}원, 계약서 확인 ${connected ? "예정" : "전"}`, hasVehicle: n % 5 === 0, vehicleInfo: n % 5 === 0 ? "가상 중고차 · 평가 예시 300만원" : "차량 없음" },
      assets: [ { category: "임차보증금(반환채권)", value: deposit, hasSecurity: false, securityAmount: 0, note: "시연용 임차보증금" }, { category: "예금/적금", value: 300_000 + n % 5 * 100_000, hasSecurity: false, securityAmount: 0, note: "가상 예금 잔액" }, { category: "자동차", value: n % 5 === 0 ? 3_000_000 : 0, hasSecurity: false, securityAmount: 0, note: "시연용 차량 평가" } ],
      debts: [{ category: "신용채무(카드/캐피탈/저축은행 등)", creditor: "가상금융 A · 가상금융 B", detail: "생활비 및 가상 대환대출", amount: debt, note: "실제 금융기관·계좌 없음" }],
      loanRecords: [firstDebt, debt - firstDebt].map((balance, loanIndex) => ({ id: id("LOAN", n * 10 + loanIndex), kind1: "신용", kind2: loanIndex ? "가상 카드대출" : "가상 신용대출", lender: loanIndex ? "가상금융 B" : "가상금융 A", executedAt: loanIndex ? "2025-09-15" : "2024-06-10", balance, originalAmount: balance + 2_000_000, monthlyPayment: loanIndex ? 450_000 : 650_000, interestRate: loanIndex ? 14 : 12, source: "manual", note: "시연용 채무 내역" })),
      debtSummaryExtra: { totalDebtAmount: debt, totalCreditAmount: debt, totalSecuredAmount: 0, totalInterestAmount: Math.round((firstDebt * 0.12 + (debt - firstDebt) * 0.14) / 12), monthlyPaymentAmount: 1_100_000, salaryPayDay: 25, cardPaymentDay: 15, cardPaymentAmount: 200_000, heldCreditCards: "가상카드 A" },
      judgment: { costGuided: connected, workoutGuided: connected, workoutInProgress: false, judgmentNote: connected ? "[시연] 소득·채무 자료를 추가 확인한 뒤 진행 방향 검토" : "[시연] 미연결 상태로 상담 판단 보류" },
      counselPlan: { rehabPlanNote: "[시연] 36개월 변제 예시를 상담에서 검토하고 서류 확인 후 확정", recoveryPlanNote: "[시연] 소득 변동 및 채무 자료 보완 필요" },
      recentLoanInsurance: { recentLoanUsage: "가상 생활비 및 대환 예시", insurancePremium: 80_000, insuranceRefundAmount: 300_000, insuranceNote: "시연용 보험 정보" },
      memoLog: [{ id: id("MEMO", n * 10), staff: spec.staff, at: timestamp(date, 10), tag: "일반", text: `[시연] 가상고객${String(n).padStart(3, "0")} 신청 내용 등록. 채무 ${debt / 10_000}만원, 월소득 ${income / 10_000}만원. ${connected ? "후속 상담 기록을 확인해주세요." : "신청서 기준이며 통화 확인 전입니다."}` }],
    };
    const state = stageFor(group, n);
    const lead: DbLead = { id: id("DB", n), name: `가상고객${String(n).padStart(3, "0")}`, phone: "", assignedStaff: spec.staff, receivedAt: timestamp(date, 9, n % 60), status: state.status, detailStage: state.detailStage, stageUpdatedAt: timestamp(stageDate, 15), applicationType: "개인회생", source: "기타", memo: "[시연] 합성 고객입니다. 실제 연락처·광고 연결·외부 발송 정보가 없습니다.", consultation, contactLog: [] };
    if (group !== "fresh") {
      const attempts = group === "longAbsent" ? 3 : 2;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const contactDate = day(Math.min(18, spec.receivedDay! + (group === "longAbsent" ? attempt * 3 : attempt)));
        const didConnect = connected && attempt === attempts - 1;
        const text = didConnect ? connectedMemo(group) : "[시연] 전화 연결 실패. 가능 시간에 재확인 예정.";
        lead.contactLog!.push({ id: id("CONTACT", n * 10 + attempt), at: timestamp(contactDate, 11 + attempt), staff: spec.staff, type: "phone", connected: didConnect, durationSeconds: didConnect ? 180 + n % 12 * 30 : 0, note: text });
        consultation.memoLog!.unshift({ id: id("MEMO", n * 10 + attempt + 1), staff: spec.staff, at: timestamp(contactDate, 11 + attempt, 5), tag: didConnect ? group === "reserved" ? "재통화" : "일반" : "부재중", text });
      }
    }
    if (group === "closed") {
      if (state.status === "부적합") lead.invalidReason = "대상 아님";
      else lead.nonContractReason = state.status === "거절" ? "비용 부담" : "진행 보류";
    }
    if (group === "reserved") {
      const reservationDate = day(Math.min(18, Number(stageDate.slice(8)) + 1));
      lead.reservationAt = `${reservationDate}T${n % 2 ? "14:00" : "16:00"}`;
      schedules.push({ id: id("RESERVATION", n), type: "상담예약", date: reservationDate, title: `[시연] ${lead.name} 상담예약 · ${spec.staff}`, done: reservationDate < SCALED_DEMO_RANGE.end });
    }
    if (group === "retained") {
      const contractDate = stageDate, amount = [3_300_000, 3_600_000, 3_960_000, 4_200_000, 4_500_000, 4_800_000][n % 6];
      const clientId = id("CLIENT", n), caseId = id("CASE", n);
      lead.convertedClientId = clientId; lead.convertedCaseId = caseId;
      clients.push({ id: clientId, name: lead.name, phone: "", registeredAt: contractDate, assignedStaff: spec.staff, fromLeadId: lead.id, applicationType: "개인회생", consultation: JSON.parse(JSON.stringify(consultation)) as ConsultationInfo, memo: "[시연] 합성 고객·계약입니다." });
      const caseStages: CaseRecord["stage"][] = ["서류준비", "신청서작성", "법원접수", "보정대기", "개시_선고", "변제계획_면책심문", "면책결정", "종결"];
      const caseStage = caseStages[n % caseStages.length];
      const paidCount = n % 7 === 0 || caseStage === "종결" ? 6 : n % 3 === 0 ? 2 : 1;
      const casePayments: Installment[] = Array.from({ length: 6 }, (_, offset) => {
        const dueDate = addDays(contractDate, offset * 7), completed = offset < paidCount;
        return { id: id("PAY", n * 10 + offset + 1), caseId, seq: offset + 1, dueDate, amount: amount / 6, status: completed ? "완료" : dueDate < SCALED_DEMO_RANGE.end ? "연체" : "예정", ...(completed ? { actualPaidAmount: amount / 6, paidDate: dueDate <= SCALED_DEMO_RANGE.end ? dueDate : contractDate } : {}) };
      });
      installments.push(...casePayments);
      cases.push({ id: caseId, clientId, caseNumber: `시연-202610-${String(n).padStart(3, "0")}`, caseType: "개인회생", court: "시연 관할법원", stage: caseStage, stageUpdatedAt: stageDate, status: caseStage === "종결" ? "종결" : "진행중", assignedStaff: spec.staff, totalDebt: debt, monthlyRepayment: 300_000 + n % 6 * 50_000, contractAmount: amount, contractDate, paidAmount: casePayments.reduce((sum, payment) => sum + (payment.actualPaidAmount ?? 0), 0), installmentCount: 6, paymentMethod: "단순분납", fromLeadId: lead.id, memo: "[시연] 실제 사건·전자계약이 아닌 가상 수임입니다." });
      schedules.push({ id: id("CASE-SCHEDULE", n), caseId, clientId, type: n % 2 ? "서류제출기한" : "법원기일", date: addDays(contractDate, 3 + n % 7), title: `[시연] ${lead.name} ${n % 2 ? "서류 확인" : "가상 사건 일정"}`, done: caseStage === "종결" });
    }
    leads.push(lead);
  }
  for (const lead of leads) requireCondition(!originalLeadIds.has(lead.id), "추가 DB ID가 기존 자료와 충돌합니다.");
  for (const client of clients) requireCondition(!originalClientIds.has(client.id), "추가 고객 ID가 기존 자료와 충돌합니다.");
  for (const record of cases) requireCondition(!originalCaseIds.has(record.id), "추가 계약 ID가 기존 자료와 충돌합니다.");
  const afterGroups = { ...beforeGroups };
  for (const lead of leads) {
    const group = groupOf(lead), staff = byStaff[staffIndex.get(lead.assignedStaff)!];
    afterGroups[group] += 1; staff.leads += 1;
    if (group === "retained") staff.retained += 1;
    else if (group === "closed") staff.closed += 1;
    else staff.active += 1;
  }
  requireCondition(cases.length === 86 && clients.length === 86 && groups.every(group => afterGroups[group] === SCALED_DEMO_TARGETS.groups[group]), "생성 후 수임·고객·단계 검증에 실패했습니다.");
  requireCondition(byStaff.every(staff => staff.leads === staff.target && staff.active === 40 && staff.retained === 15), "생성 후 직원별 배정 검증에 실패했습니다.");
  return {
    seed: { kind: SCALED_DEMO_KIND, firmId, batchKey, ...SCALED_DEMO_RANGE },
    leads, clients, cases, installments, schedules,
    summary: {
      before: { leads: existingLeads.length, cases: existingCases.length, groups: beforeGroups },
      added: { leads: leads.length, clients: clients.length, cases: cases.length, installments: installments.length, schedules: schedules.length },
      after: { leads: 500, cases: 90, active: 240, conversionRate: 18, unitPrice: 50_000, supplyValue: 25_000_000, groups: afterGroups, staff: byStaff.map(({ target: _target, ...staff }) => staff), intakeDays: dayCounts.map((count, index) => ({ date: day(index + 1), count })) },
    },
  };
}

function stageFor(group: Group, n: number): Pick<DbLead, "status" | "detailStage"> {
  switch (group) {
    case "retained": return { status: "수임전환", detailStage: "착수금착수" };
    case "fresh": return { status: "신규접수", detailStage: "신규디비" };
    case "absent": return { status: "부재중", detailStage: "부재" };
    case "longAbsent": return { status: "부재중", detailStage: "장기부재" };
    case "reserved": return { status: "재통화필요", detailStage: "예약" };
    case "consulting": return n % 3 === 0 ? { status: "고려중", detailStage: "설득필요" } : n % 3 === 1 ? { status: "상담완료", detailStage: "상담" } : { status: "계약진행중", detailStage: "착수금 안내" };
    case "closed": return { status: (["거절", "부적합", "종결_중단"] as const)[n % 3], detailStage: "불가" };
  }
}
function connectedMemo(group: Group) {
  if (group === "retained") return "[시연] 소득·채무 상담 후 가상 계약 완료. 분납 및 서류 준비 일정 안내.";
  if (group === "reserved") return "[시연] 짧은 통화로 상담 가능 시간을 확인하고 예약 등록. 다음 상담에서 자료 보완 예정.";
  if (group === "closed") return "[시연] 상담 후 비용 부담·진행 조건·보류 의사를 확인하여 상담 종료. 실제 연락 기록 아님.";
  return "[시연] 월소득과 채무 사용처 상담 완료. 추가 서류 및 예상 비용을 안내하고 후속 상담 예정.";
}
