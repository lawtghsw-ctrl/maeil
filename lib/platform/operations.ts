/** Platform-only commercial operations. Amounts are integer KRW; absent facts remain null. */
export type SupplyContractStatus = "draft" | "active" | "paused" | "ended";
export interface SupplyContract {
  id: string; law_firm_id: string; product: string; category: string;
  unit_price: number | null; monthly_quantity: number | null; start_date: string; end_date: string;
  status: SupplyContractStatus; confirmed_at: string | null; revision: number; created_at: string; updated_at: string;
}
export interface SupplyAdjustment {
  id: string; law_firm_id: string; contract_id: string | null; ledger_id: string | null;
  event_date: string; kind: "replacement" | "receipt"; quantity: number; amount: number; reason: string; created_at: string;
}
export interface OperationFirm { id: string; name: string; status: string; firm_code: string; billing_type: string }
export interface CommercialProfile { law_firm_id: string; service_mode: "crm_only" | "db_supply"; revision: number; updated_at: string }
export interface OperationLedger {
  id: string; law_firm_id: string; lead_id: string | null; classification: string; billable: boolean;
  billing_type: string; unit_price_snapshot: number | string | null; supplied_at: string; origin: string;
  supply_contract_id: string | null; supply_contract_revision: number | null; ad_source_id: string | null;
}
export function operationSupplyLabel(classification: string): string {
  return ({ new: "신규", reentry: "재유입", duplicate_external: "중복 · 동일 유입", duplicate_meta: "중복 · Meta", duplicate_phone: "중복 · 전화번호" } as Record<string, string>)[classification] ?? "확인 필요";
}
export interface OperationLead { id: string; law_firm_id: string; data: { convertedCaseId?: string; convertedClientId?: string; detailStage?: string; status?: string; stageUpdatedAt?: string; contactLog?: Array<{ at: string; type: string; connected?: boolean }> } }
export interface OperationCase { id: string; law_firm_id: string; data: { status?: string; contractAmount?: number } }
export interface OperationsConfig {
  goals: { newFirms: number | null; activeFirms: number | null; newMrr: number | null; supply: number | null; margin: number | null };
  costs: Array<{ id: string; name: string; amount: number; category: "fixed" | "sales_ad" }>;
  people: Array<{ id: string; name: string; base: number; incentive: number; employerCost: number; salesOwner?: string; incentiveRate?: number | null; incentiveMonths?: number | null }>;
  /** Manual production-ad cost is an alternative to legacy monthly input, never added to Meta actuals. */
  adSpend: Array<{ firmId: string; amount: number; note: string }>;
  rules: { fulfillmentWarning: number; fulfillmentRisk: number; marginWarning: number; cplGoal: number | null; replacementWarning: number; pipelineMeeting: number; pipelineProposal: number; pipelineSent: number };
}
export interface OperationsMonth { month: string; revision: number; config: OperationsConfig; closed_at: string | null; snapshot: OperationsReport | null; updated_at: string }
export interface OperationsClosing { id: string; month: string; action: "close" | "reopen"; created_at: string; actor_id: string }
export interface ContractProgress {
  contract: SupplyContract; firmName: string; expectedToDate: number | null; totalExpected: number | null;
  delivered: number; remaining: number | null; fulfillment: number | null; forecast: number | null;
  neededPerDay: number | null; status: "normal" | "warning" | "risk" | "unregistered";
}
export interface OperationsFirmMetrics {
  firmId: string; firmName: string; supplied: number; billable: number; replacements: number;
  revenue: number | null; knownRevenue: number; missingPrices: number; paid: number | null; receivable: number | null;
  adSpend: number | null; adSource: "operations_manual" | "firm_settings" | "month_closing" | "missing" | "meta_actual" | "meta_incomplete" | "meta_ambiguous";
  profit: number | null; margin: number | null; cpl: number | null; averagePrice: number | null;
  replacementRate: number | null; mature: number; converted: number; missingConversions: number;
  conversionRate: number | null; absence: number; absenceRate: number | null; unlinked: number; contractCount: number;
  phoneAttempts: number; phoneConnected: number; phoneConnectionRate: number | null; firstCallMedianMinutes: number | null; firstCallSamples: number;
  suppliedDb: number; phoneAttemptedDb: number; connectedDb: number; unconnectedDb: number; unknownConnectionDb: number; contactRate: number | null;
  consultedDb: number; missingConsultationDb: number; consultationRate: number | null;
  neglectedDb: number; stageRecordedDb: number; stageUnrecordedDb: number;
}
export interface OperationsReport {
  month: string; generatedAt: string; includeDemo: boolean; excludedDemo: number; firms: OperationsFirmMetrics[];
  totals: Omit<OperationsFirmMetrics, "firmId" | "firmName" | "adSource">;
  contracts: ContractProgress[]; operatingCost: number | null; operatingProfit: number | null;
  projectedRevenue: number | null; projectedProfit: number | null; projectedOperatingProfit: number | null;
  trend: Array<{ month: string; revenue: number | null; adSpend: number | null; profit: number | null }>;
  sources: Array<{ firmName: string; source: string; sourceName?: string; denominator: number; numerator: number; missing: number; rate: number | null }>;
  forecastMonths: Array<{ month: string; committed: number; pipeline: number; projectedRevenue: number; projectedProfit: number | null; projectedOperatingProfit: number | null; pendingProposals: number }>;
  peopleCosts: Array<{ id: string; name: string; incentive: number; total: number; automatic: boolean }>;
  /** Compare inside the month lock before closing, so a concurrent receipt cannot disappear from a snapshot. */
  adjustmentCount: number;
  activeFirmCount: number; remainingRevenue: number | null;
  unregisteredFirms: number;
  alerts: Array<{ kind: "risk" | "warning" | "renewal"; firmId: string; message: string }>;
}
export interface OperationsResponse {
  firms: OperationFirm[]; contracts: SupplyContract[]; adjustments: SupplyAdjustment[]; ledger: OperationLedger[];
  month: OperationsMonth | null; closings: OperationsClosing[]; report: OperationsReport; ledgerTruncated: boolean; ledgerOffset: number; ledgerCount: number; commercialProfiles: CommercialProfile[];
}
export const OPERATIONS_DEFINITIONS = [
  "공급수는 신규·재유입 공급 원장의 건수입니다. 과거 이관(backfill)은 제외하며, 수임료 매출과 구분합니다.",
  "청구매출은 건별 과금 원장의 공급 당시 단가 합계입니다. 0원·미확정 단가와 월정액·수기 청구는 확인 필요입니다.",
  "수납·미수는 로파워가 로펌으로부터 받은 입금입니다. 수납 미등록은 0원으로 추정하지 않습니다.",
  "교체는 별도 무상 대체공급 기록입니다. 기존 원장 과금액을 바꾸거나 차감하지 않습니다.",
  "광고비는 운영설정 수동입력을 우선합니다. 없으면 광고명에 ‘회생’이 포함된 Meta 완료 조회(KRW·현재 연결·로펌 단독 귀속)를 사용합니다. 현재 월은 월초부터 한국시간 오늘까지 당일 조회, 과거 월은 월 종료 후 조회한 월 전체 자료입니다. Meta 연결 자체가 없을 때만 기존 로펌 월 광고비를 사용하며 서로 합산하지 않습니다.",
  "60일 경과 공급의 현재 유효 계약(금액 양수·취하 제외) 전환율입니다. 분모 30건 미만은 회색 참고값이며 분자/분모를 함께 표시합니다.",
  "컨택 기록이 있는 전화 시도 DB 중 연결 기록이 전혀 없고 모든 결과가 미연결인 DB를 부재로 집계합니다. 컨택율은 연결 DB/공급 DB, 상담진행률은 명시적으로 상담에 도달한 DB/공급 DB입니다. 반복 공급은 같은 DB를 한 번만 계산하며 과거 미기록은 추정하지 않습니다.",
  "방치 DB는 현재 진행 중인 DB 전체 중 유효한 단계 변경 기록이 7일 이상 경과한 건수입니다. 단계 변경 기록이 없는 과거 DB는 확인 불가로 따로 표시합니다.",
  "계약일부터 달력월 실제 일수로 약정량을 일할합니다. 예측은 현재 일평균 공급 속도를 계약 종료일까지 유지한 경우입니다.",
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function opsUuid(v: unknown): v is string { return typeof v === "string" && UUID.test(v); }
export function opsMonth(v: unknown): v is string { return typeof v === "string" && /^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(v); }
export function opsDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(v)) return false;
  const n = Date.parse(v + "T00:00:00Z"); return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === v;
}
export function opsToday(now = new Date()): string { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function shiftOpsMonth(month: string, delta: number): string { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7); }
export function opsBounds(month: string) { if (!opsMonth(month)) throw new Error("올바른 조회월을 선택해주세요."); return { start: month + "-01", end: new Date(Date.parse(shiftOpsMonth(month, 1) + "-01T00:00:00Z") - 86400000).toISOString().slice(0, 10) }; }
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("입력 형식을 확인해주세요."); return v as Record<string, unknown>; };
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error("허용되지 않은 입력 항목입니다."); }
function str(v: unknown, max: number, empty = false): string { if (typeof v !== "string" || v.length > max || (!empty && !v.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error("문자 입력 길이와 내용을 확인해주세요."); return v.trim(); }
function num(v: unknown, max = 1e12): number { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max) throw new Error("금액과 수량은 범위 내 0 이상의 정수여야 합니다."); return v; }
function nullable(v: unknown, max = 1e12): number | null { return v === null ? null : num(v, max); }
export function emptyOperationsConfig(): OperationsConfig {
  return { goals: { newFirms: null, activeFirms: null, newMrr: null, supply: null, margin: null }, costs: [], people: [], adSpend: [], rules: { fulfillmentWarning: 98, fulfillmentRisk: 90, marginWarning: 40, cplGoal: null, replacementWarning: 5, pipelineMeeting: 30, pipelineProposal: 50, pipelineSent: 80 } };
}
export function validateOperationsConfig(input: unknown): OperationsConfig {
  const v = obj(input); keys(v, ["goals", "costs", "people", "adSpend", "rules"]);
  const goals = obj(v.goals); keys(goals, ["newFirms", "activeFirms", "newMrr", "supply", "margin"]);
  const rules = obj(v.rules); keys(rules, Object.keys(emptyOperationsConfig().rules));
  const list = (value: unknown, max = 100) => { if (!Array.isArray(value) || value.length > max) throw new Error("입력 항목 수를 확인해주세요."); return value; };
  const unique = <T>(rows: T[], key: (v: T) => string) => { if (new Set(rows.map(key)).size !== rows.length) throw new Error("중복 항목을 제거해주세요."); return rows; };
  const parsed: OperationsConfig = {
    goals: { newFirms: nullable(goals.newFirms, 100000), activeFirms: nullable(goals.activeFirms, 100000), newMrr: nullable(goals.newMrr), supply: nullable(goals.supply, 10000000), margin: nullable(goals.margin, 100) },
    costs: unique(list(v.costs).map(value => { const r = obj(value); keys(r, ["id", "name", "amount", "category"]); if (!["fixed", "sales_ad"].includes(String(r.category))) throw new Error("비용 구분을 확인해주세요."); return { id: str(r.id, 100), name: str(r.name, 100), amount: num(r.amount), category: r.category as "fixed" | "sales_ad" }; }), r => r.id),
    people: unique(list(v.people).map(value => { const r = obj(value); keys(r, ["id", "name", "base", "incentive", "employerCost", "salesOwner", "incentiveRate", "incentiveMonths"]); return { id: str(r.id, 100), name: str(r.name, 100), base: num(r.base), incentive: num(r.incentive), employerCost: num(r.employerCost), salesOwner: r.salesOwner === undefined ? "" : str(r.salesOwner, 200, true), incentiveRate: nullable(r.incentiveRate ?? null, 100), incentiveMonths: nullable(r.incentiveMonths ?? null, 120) }; }), r => r.id),
    adSpend: unique(list(v.adSpend, 1000).map(value => { const r = obj(value); keys(r, ["firmId", "amount", "note"]); if (!opsUuid(r.firmId)) throw new Error("로펌을 선택해주세요."); return { firmId: r.firmId, amount: num(r.amount), note: str(r.note, 300, true) }; }), r => r.firmId),
    rules: { fulfillmentWarning: num(rules.fulfillmentWarning, 200), fulfillmentRisk: num(rules.fulfillmentRisk, 200), marginWarning: num(rules.marginWarning, 100), cplGoal: nullable(rules.cplGoal), replacementWarning: num(rules.replacementWarning, 100), pipelineMeeting: num(rules.pipelineMeeting, 100), pipelineProposal: num(rules.pipelineProposal, 100), pipelineSent: num(rules.pipelineSent, 100) },
  };
  if (parsed.rules.fulfillmentRisk > parsed.rules.fulfillmentWarning) throw new Error("위험 기준은 주의 기준보다 높을 수 없습니다.");
  const owners = parsed.people.filter(p => p.salesOwner && p.incentiveRate !== null && p.incentiveMonths !== null).map(p => p.salesOwner);
  if (new Set(owners).size !== owners.length) throw new Error("동일 영업담당자의 자동 인센티브를 중복 등록할 수 없습니다.");
  return parsed;
}
export function validateOperationCommand(input: unknown): Record<string, unknown> {
  const v = obj(input); const action = v.action;
  if (action === "commercial") {
    keys(v, ["action", "law_firm_id", "service_mode", "expectedRevision"]);
    if (!opsUuid(v.law_firm_id) || !["crm_only", "db_supply"].includes(String(v.service_mode))) throw new Error("로펌 서비스 구분을 확인해주세요.");
    return { ...v, expectedRevision: num(v.expectedRevision, 2147483646) };
  }
  if (action === "contract") {
    keys(v, ["action", "id", "expectedRevision", "law_firm_id", "product", "category", "unit_price", "monthly_quantity", "start_date", "end_date", "status"]);
    if ((v.id !== null && !opsUuid(v.id)) || !opsUuid(v.law_firm_id)) throw new Error("계약 또는 로펌 ID를 확인해주세요.");
    if (!opsDate(v.start_date) || !opsDate(v.end_date) || v.end_date < v.start_date || Date.parse(v.end_date) - Date.parse(v.start_date) > 3660 * 86400000) throw new Error("계약 기간은 10년 이내의 올바른 날짜여야 합니다.");
    if (!["draft", "active", "paused", "ended"].includes(String(v.status))) throw new Error("계약 상태를 확인해주세요.");
    const unit_price = nullable(v.unit_price), monthly_quantity = nullable(v.monthly_quantity, 10000000);
    if (v.status === "active" && (!unit_price || !monthly_quantity)) throw new Error("확정 활성 계약은 단가와 월 약정량을 입력해야 합니다.");
    if (unit_price !== null && monthly_quantity !== null && !Number.isSafeInteger(unit_price * monthly_quantity)) throw new Error("월 약정금액이 정확하게 계산할 수 있는 범위를 초과했습니다.");
    return { action, id: v.id, expectedRevision: num(v.expectedRevision, 2147483646), law_firm_id: v.law_firm_id, product: str(v.product, 100), category: str(v.category, 100), unit_price, monthly_quantity, start_date: v.start_date, end_date: v.end_date, status: v.status };
  }
  if (action === "adjustment") {
    keys(v, ["action", "id", "law_firm_id", "contract_id", "ledger_id", "event_date", "kind", "quantity", "amount", "reason"]);
    if (!opsUuid(v.id) || !opsUuid(v.law_firm_id) || (v.contract_id !== null && !opsUuid(v.contract_id)) || (v.ledger_id !== null && !opsUuid(v.ledger_id))) throw new Error("원장 연결 ID를 확인해주세요.");
    if (!opsDate(v.event_date) || !["replacement", "receipt"].includes(String(v.kind))) throw new Error("기록 날짜와 구분을 확인해주세요.");
    const quantity = num(v.quantity, 10000000), amount = num(v.amount);
    if (v.kind === "receipt" ? quantity !== 0 : amount !== 0 || quantity < 1) throw new Error("수납은 금액만, 무상 교체는 수량만 입력해주세요.");
    return { ...v, quantity, amount, reason: str(v.reason, 500) };
  }
  if (["settings", "close", "reopen"].includes(String(action))) {
    keys(v, action === "settings" ? ["action", "month", "expectedRevision", "config"] : ["action", "month", "expectedRevision"]);
    if (!opsMonth(v.month)) throw new Error("설정 월을 확인해주세요.");
    return { action, month: v.month, expectedRevision: num(v.expectedRevision, 2147483646), ...(action === "settings" ? { config: validateOperationsConfig(v.config) } : {}) };
  }
  throw new Error("지원하지 않는 작업입니다.");
}
export function plannedSupply(contract: Pick<SupplyContract, "start_date" | "end_date" | "monthly_quantity">, through: string): number | null {
  if (!contract.monthly_quantity) return null;
  const end = through < contract.end_date ? through : contract.end_date;
  if (end < contract.start_date) return 0;
  let month = contract.start_date.slice(0, 7), total = 0;
  while (month <= end.slice(0, 7)) {
    const b = opsBounds(month); const first = b.start > contract.start_date ? b.start : contract.start_date; const last = b.end < end ? b.end : end;
    const days = (Date.parse(last) - Date.parse(first)) / 86400000 + 1;
    if (days > 0) total += contract.monthly_quantity * days / Number(b.end.slice(8));
    month = shiftOpsMonth(month, 1);
  }
  return total;
}
function sum(xs: number[]): number { const value = xs.reduce((a, b) => a + b, 0); if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("집계 금액이 계산 범위를 초과했습니다."); return value; }
const ratio = (n: number, d: number) => d > 0 ? n / d * 100 : null;
const knownSum = (xs: Array<number | null>) => xs.some(x => x === null) ? null : sum(xs as number[]);
const kstDate = (value: string) => opsToday(new Date(value));
export interface OperationsInput {
  firms: OperationFirm[]; contracts: SupplyContract[]; adjustments: SupplyAdjustment[]; ledger: OperationLedger[];
  leads: OperationLead[]; cases: OperationCase[]; monthRows: OperationsMonth[];
  /** Current-stage census is separate from the selected supply cohort and contains no contact content. */
  currentStageLeads?: OperationLead[];
  adSources?: Array<{ id: string; law_firm_id: string; name: string }>;
  commercialProfiles?: CommercialProfile[];
  sales?: OperationSale[];
  metaCosts?: Array<{ firmId: string; month: string; amount: number | null; source: "meta_actual" | "meta_incomplete" | "meta_ambiguous" }>;
  adSpend: Array<{ firmId: string; month: string; amount: number | null; source: "firm_settings" | "month_closing" | "missing" }>;
}
export interface OperationSale { id: string; stage: string; data: { owner?: string; expectedMonthly?: number }; proposal: { quantity: number; unitPrice: number; startDate: string; endDate: string; vat?: string } | null; signed_at?: string | null; law_firm_id: string | null }
export function incentiveForPerson(person: OperationsConfig["people"][number], sales: OperationSale[], month: string): { amount: number; automatic: boolean } {
  const automatic = Boolean(person.salesOwner) && person.incentiveRate != null && person.incentiveMonths != null;
  if (!automatic) return { amount: person.incentive, automatic: false };
  const amount = sum(sales.filter(s => s.stage === "서명완료" && s.signed_at && s.data.owner === person.salesOwner && s.proposal && s.proposal.vat === "excluded").map(s => {
    const start = opsToday(new Date(s.signed_at!)).slice(0, 7);
    return month >= start && month < shiftOpsMonth(start, person.incentiveMonths!) ? s.proposal!.quantity * s.proposal!.unitPrice * person.incentiveRate! / 100 : 0;
  }));
  return { amount: Math.round(amount), automatic: true };
}
export function buildOperationsReport(input: OperationsInput, month: string, includeDemo = false, now = new Date()): OperationsReport {
  const bounds = opsBounds(month), today = opsToday(now), through = today < bounds.end ? today : bounds.end;
  const monthRow = input.monthRows.find(x => x.month === month), config = monthRow?.config ?? emptyOperationsConfig();
  const demoFiltered = input.firms.filter(f => includeDemo || !(f.name === "TEST" && f.firm_code === "0000000000"));
  const crmOnly = new Set((input.commercialProfiles ?? []).filter(p => p.service_mode === "crm_only").map(p => p.law_firm_id));
  const dbSupply = new Set((input.commercialProfiles ?? []).filter(p => p.service_mode === "db_supply").map(p => p.law_firm_id));
  const selected = demoFiltered.filter(f => !crmOnly.has(f.id));
  const selectedIds = new Set(selected.map(f => f.id));
  const leads = new Map(input.leads.map(l => [`${l.law_firm_id}\0${l.id}`, l]));
  const cases = new Map(input.cases.map(c => [`${c.law_firm_id}\0${c.id}`, c]));
  const sourceNames = new Map((input.adSources ?? []).map(s => [`${s.law_firm_id}\0${s.id}`, s.name]));
  const stagesByFirm = new Map<string, Map<string, OperationLead>>();
  for (const lead of input.currentStageLeads ?? input.leads) {
    const group = stagesByFirm.get(lead.law_firm_id) ?? new Map<string, OperationLead>(); group.set(lead.id, lead); stagesByFirm.set(lead.law_firm_id, group);
  }
  const ledgerByFirm = new Map<string, OperationLedger[]>(), adjustmentsByFirm = new Map<string, SupplyAdjustment[]>();
  for (const row of input.ledger) if (row.origin !== "backfill" && selectedIds.has(row.law_firm_id)) { const group = ledgerByFirm.get(row.law_firm_id) ?? []; group.push(row); ledgerByFirm.set(row.law_firm_id, group); }
  for (const row of input.adjustments) { const group = adjustmentsByFirm.get(row.law_firm_id) ?? []; group.push(row); adjustmentsByFirm.set(row.law_firm_id, group); }
  const sources: OperationsReport["sources"] = [];
  const firms = selected.map(firm => {
    const all = ledgerByFirm.get(firm.id) ?? [];
    const rows = all.filter(r => kstDate(r.supplied_at).slice(0, 7) === month);
    const supplies = rows.filter(r => r.classification === "new" || r.classification === "reentry");
    const billed = rows.filter(r => r.billable);
    const valid = billed.filter(r => r.billing_type === "per_lead" && Number.isSafeInteger(Number(r.unit_price_snapshot)) && Number(r.unit_price_snapshot) > 0);
    const missingPrices = billed.length - valid.length;
    const knownRevenue = sum(valid.map(r => Number(r.unit_price_snapshot)));
    const billingUnknown = rows.some(r => r.billing_type !== "per_lead") || (!rows.length && firm.billing_type !== "per_lead");
    const revenue = missingPrices || billingUnknown || !dbSupply.has(firm.id) ? null : knownRevenue;
    const adj = (adjustmentsByFirm.get(firm.id) ?? []).filter(a => a.event_date.slice(0, 7) === month);
    const receipts = adj.filter(a => a.kind === "receipt"), replacements = sum(adj.filter(a => a.kind === "replacement").map(a => a.quantity));
    const paid = receipts.length ? sum(receipts.map(a => a.amount)) : null;
    const manual = config.adSpend.find(a => a.firmId === firm.id), old = input.adSpend.find(a => a.firmId === firm.id && a.month === month);
    const meta = input.metaCosts?.find(a => a.firmId === firm.id && a.month === month);
    const adSpend = manual ? manual.amount : meta ? meta.amount : old?.amount ?? null;
    const adSource: OperationsFirmMetrics["adSource"] = manual ? "operations_manual" : meta?.source ?? old?.source ?? "missing";
    const profit = revenue !== null && adSpend !== null ? revenue - adSpend : null;
    // Distinct lead cohort: first supply within the selected month, not CRM contract-date cohort.
    const unique = new Map<string, OperationLedger>();
    for (const r of supplies) if (r.lead_id && (!unique.has(r.lead_id) || unique.get(r.lead_id)!.supplied_at > r.supplied_at)) unique.set(r.lead_id, r);
    let mature = 0, converted = 0, missingConversions = 0, phoneAttempts = 0, phoneConnected = 0, phoneUnknownResults = 0;
    let phoneAttemptedDb = 0, connectedDb = 0, unconnectedDb = 0, unknownConnectionDb = 0, consultedDb = 0, missingConsultationDb = 0;
    const firstCallMinutes: number[] = [];
    const sourceGroups = new Map<string, { denominator: number; numerator: number; missing: number }>();
    for (const row of unique.values()) {
      const lead = leads.get(`${firm.id}\0${row.lead_id}`);
      const calls = Array.isArray(lead?.data.contactLog) ? lead.data.contactLog.filter(log => log && log.type === "phone" && Number.isFinite(Date.parse(log.at)) && Date.parse(log.at) >= Date.parse(row.supplied_at) && Date.parse(log.at) <= now.getTime()) : [];
      phoneAttempts += calls.length; phoneConnected += calls.filter(c => c.connected === true).length;
      phoneUnknownResults += calls.filter(c => typeof c.connected !== "boolean").length;
      if (calls.length) {
        phoneAttemptedDb++;
        if (calls.some(c => c.connected === true)) connectedDb++;
        else if (calls.every(c => c.connected === false)) unconnectedDb++;
        else unknownConnectionDb++;
      }
      // Match the existing firm report's consultStarted: explicit detailStage wins
      // over its legacy status fallback; a recorded client conversion also qualifies.
      if (!lead || (!lead.data.detailStage && !lead.data.status && !lead.data.convertedClientId)) missingConsultationDb++;
      else {
        const stage = lead.data.detailStage ?? ({ 상담완료: "상담", 재통화필요: "설득필요", 고려중: "설득필요" } as Record<string, string>)[lead.data.status ?? ""];
        if (lead.data.convertedClientId || ["상담", "설득필요", "착수금 안내"].includes(stage ?? "")) consultedDb++;
      }
      if (calls.length) firstCallMinutes.push((calls.reduce((earliest, c) => Math.min(earliest, Date.parse(c.at)), Infinity) - Date.parse(row.supplied_at)) / 60000);
      if ((Date.parse(today + "T00:00:00Z") - Date.parse(kstDate(row.supplied_at) + "T00:00:00Z")) / 86400000 < 60) continue;
      mature++;
      const source = row.ad_source_id ?? "미연결"; const group = sourceGroups.get(source) ?? { denominator: 0, numerator: 0, missing: 0 }; group.denominator++;
      const target = lead?.data.convertedCaseId ? cases.get(`${firm.id}\0${lead.data.convertedCaseId}`) : undefined;
      if (!lead || (lead.data.convertedCaseId && !target)) { missingConversions++; group.missing++; }
      else if (target && typeof target.data.contractAmount !== "boolean" && Number.isFinite(Number(target.data.contractAmount)) && Number(target.data.contractAmount) > 0 && target.data.status !== "취하") { converted++; group.numerator++; }
      sourceGroups.set(source, group);
    }
    for (const [source, group] of sourceGroups) sources.push({ firmName: firm.name, source, sourceName: sourceNames.get(`${firm.id}\0${source}`), ...group, rate: group.missing ? null : ratio(group.numerator, group.denominator) });
    let neglectedDb = 0, stageRecordedDb = 0, stageUnrecordedDb = 0;
    for (const lead of stagesByFirm.get(firm.id)?.values() ?? []) {
      // Match the existing firm report's terminalLead; do not reinterpret stages.
      if (lead.data.convertedClientId || ["거절", "부적합", "종결_중단"].includes(lead.data.status ?? "")) continue;
      const at = lead.data.stageUpdatedAt ? Date.parse(lead.data.stageUpdatedAt) : NaN;
      if ((!lead.data.detailStage && !lead.data.status) || !Number.isFinite(at) || at > now.getTime()) { stageUnrecordedDb++; continue; }
      stageRecordedDb++; if (now.getTime() - at >= 7 * 86400000) neglectedDb++;
    }
    const unlinked = supplies.filter(r => !r.lead_id).length, suppliedDb = unique.size + unlinked;
    missingConsultationDb += unlinked;
    firstCallMinutes.sort((a, b) => a - b); const mid = Math.floor(firstCallMinutes.length / 2);
    const firstCallMedianMinutes = firstCallMinutes.length ? firstCallMinutes.length % 2 ? firstCallMinutes[mid] : (firstCallMinutes[mid - 1] + firstCallMinutes[mid]) / 2 : null;
    return { firmId: firm.id, firmName: firm.name, supplied: supplies.length, billable: billed.length, replacements, revenue, knownRevenue, missingPrices, paid,
      receivable: revenue !== null && paid !== null ? revenue - paid : null, adSpend, adSource, profit, margin: profit !== null && revenue !== null ? ratio(profit, revenue) : null,
      cpl: adSpend !== null && supplies.length + replacements ? adSpend / (supplies.length + replacements) : null,
      averagePrice: revenue !== null && billed.length ? revenue / billed.length : null, replacementRate: ratio(replacements, supplies.length + replacements),
      mature, converted, missingConversions, conversionRate: missingConversions ? null : ratio(converted, mature), absence: unconnectedDb, absenceRate: unknownConnectionDb ? null : ratio(unconnectedDb, phoneAttemptedDb),
      unlinked, contractCount: input.contracts.filter(c => c.law_firm_id === firm.id && c.status === "active" && c.start_date <= bounds.end && c.end_date >= bounds.start).length,
      phoneAttempts, phoneConnected, phoneConnectionRate: phoneUnknownResults ? null : ratio(phoneConnected, phoneAttempts), firstCallMedianMinutes, firstCallSamples: firstCallMinutes.length,
      suppliedDb, phoneAttemptedDb, connectedDb, unconnectedDb, unknownConnectionDb, contactRate: unknownConnectionDb || !phoneAttemptedDb || unlinked ? null : ratio(connectedDb, suppliedDb),
      consultedDb, missingConsultationDb, consultationRate: missingConsultationDb ? null : ratio(consultedDb, suppliedDb), neglectedDb, stageRecordedDb, stageUnrecordedDb };
  });
  const total = (key: "supplied" | "billable" | "replacements" | "knownRevenue" | "missingPrices" | "mature" | "converted" | "missingConversions" | "absence" | "unlinked" | "contractCount") => sum(firms.map(f => f[key]));
  const active = firms.filter(f => f.supplied || f.billable || f.replacements || f.paid !== null || f.adSpend !== null || f.contractCount);
  const revenue = active.length ? knownSum(active.map(f => f.revenue)) : null, paid = active.length ? knownSum(active.map(f => f.paid)) : null, adSpend = active.length ? knownSum(active.map(f => f.adSpend)) : null;
  const supplied = total("supplied"), replacements = total("replacements"), billable = total("billable");
  const profit = revenue !== null && adSpend !== null ? revenue - adSpend : null;
  const totals = { supplied, replacements, billable, revenue, paid, adSpend, profit, receivable: revenue !== null && paid !== null ? revenue - paid : null,
    knownRevenue: total("knownRevenue"), missingPrices: total("missingPrices"), mature: total("mature"), converted: total("converted"), missingConversions: total("missingConversions"),
    margin: revenue !== null && profit !== null ? ratio(profit, revenue) : null, cpl: adSpend !== null && supplied + replacements ? adSpend / (supplied + replacements) : null,
    averagePrice: revenue !== null && billable ? revenue / billable : null, replacementRate: ratio(replacements, supplied + replacements),
    conversionRate: total("missingConversions") ? null : ratio(total("converted"), total("mature")), absence: total("absence"), absenceRate: firms.some(f => f.unknownConnectionDb) ? null : ratio(total("absence"), sum(firms.map(f => f.phoneAttemptedDb))), unlinked: total("unlinked"), contractCount: total("contractCount"),
    phoneAttempts: sum(firms.map(f => f.phoneAttempts)), phoneConnected: sum(firms.map(f => f.phoneConnected)), phoneConnectionRate: firms.some(f => f.phoneAttempts && f.phoneConnectionRate === null) ? null : ratio(sum(firms.map(f => f.phoneConnected)), sum(firms.map(f => f.phoneAttempts))), firstCallMedianMinutes: null, firstCallSamples: sum(firms.map(f => f.firstCallSamples)),
    suppliedDb: sum(firms.map(f => f.suppliedDb)), phoneAttemptedDb: sum(firms.map(f => f.phoneAttemptedDb)), connectedDb: sum(firms.map(f => f.connectedDb)), unconnectedDb: total("absence"), unknownConnectionDb: sum(firms.map(f => f.unknownConnectionDb)),
    contactRate: firms.some(f => f.suppliedDb && f.contactRate === null) ? null : ratio(sum(firms.map(f => f.connectedDb)), sum(firms.map(f => f.suppliedDb))),
    consultedDb: sum(firms.map(f => f.consultedDb)), missingConsultationDb: sum(firms.map(f => f.missingConsultationDb)), consultationRate: firms.some(f => f.missingConsultationDb) ? null : ratio(sum(firms.map(f => f.consultedDb)), sum(firms.map(f => f.suppliedDb))),
    neglectedDb: sum(firms.map(f => f.neglectedDb)), stageRecordedDb: sum(firms.map(f => f.stageRecordedDb)), stageUnrecordedDb: sum(firms.map(f => f.stageUnrecordedDb)) };
  const contracts = input.contracts.filter(c => selectedIds.has(c.law_firm_id) && c.start_date <= bounds.end && c.end_date >= bounds.start).map(contract => {
    const expectedToDate = plannedSupply(contract, through), totalExpected = plannedSupply(contract, contract.end_date);
    const delivered = (ledgerByFirm.get(contract.law_firm_id) ?? []).filter(l => l.supply_contract_id === contract.id && (l.classification === "new" || l.classification === "reentry") && kstDate(l.supplied_at) <= through).length;
    const remaining = totalExpected === null ? null : Math.max(0, totalExpected - delivered);
    const elapsed = Math.max(0, (Date.parse((through < contract.end_date ? through : contract.end_date)) - Date.parse(contract.start_date)) / 86400000 + 1);
    const duration = (Date.parse(contract.end_date) - Date.parse(contract.start_date)) / 86400000 + 1;
    const daysLeft = Math.max(0, (Date.parse(contract.end_date) - Date.parse(through)) / 86400000);
    const forecast = totalExpected && elapsed ? delivered / elapsed * duration / totalExpected * 100 : null;
    const fulfillment = expectedToDate ? delivered / expectedToDate * 100 : null;
    const status: ContractProgress["status"] = forecast === null || !contract.confirmed_at ? "unregistered" : forecast < config.rules.fulfillmentRisk ? "risk" : forecast < config.rules.fulfillmentWarning ? "warning" : "normal";
    return { contract, firmName: selected.find(f => f.id === contract.law_firm_id)?.name ?? "", expectedToDate, totalExpected, delivered, remaining, fulfillment, forecast, neededPerDay: remaining !== null && daysLeft ? remaining / daysLeft : null, status };
  });
  const sales = (input.sales ?? []).filter(s => !s.law_firm_id || selectedIds.has(s.law_firm_id));
  const peopleCosts = config.people.map(p => { const incentive = incentiveForPerson(p, sales, month); return { id: p.id, name: p.name, incentive: incentive.amount, total: p.base + incentive.amount + p.employerCost, automatic: incentive.automatic }; });
  const operatingCost = monthRow && (config.costs.length || config.people.length) ? sum([...config.costs.map(c => c.amount), ...peopleCosts.map(p => p.total)]) : null;
  const elapsedDays = today < bounds.start ? 0 : Math.min(Number(today.slice(8)), Number(bounds.end.slice(8)));
  const factor = today > bounds.end ? 1 : elapsedDays ? Number(bounds.end.slice(8)) / elapsedDays : null;
  const projectedRevenue = revenue !== null && factor !== null ? revenue * factor : null;
  const projectedProfit = profit !== null && factor !== null ? profit * factor : null;
  const operatingProfit = profit !== null && operatingCost !== null ? profit - operatingCost * (factor ? 1 / factor : 0) : null;
  const forecastMonths = Array.from({ length: 3 }, (_, i) => {
    const key = shiftOpsMonth(month, i + 1), b = opsBounds(key), prior = new Date(Date.parse(b.start) - 86400000).toISOString().slice(0, 10);
    const activeContracts = input.contracts.filter(c => selectedIds.has(c.law_firm_id) && c.status === "active" && c.confirmed_at && c.unit_price && c.start_date <= b.end && c.end_date >= b.start);
    const committed = sum(activeContracts.map(c => ((plannedSupply(c, b.end) ?? 0) - (plannedSupply(c, prior) ?? 0)) * c.unit_price!));
    let pendingProposals = 0; const values: number[] = [];
    for (const sale of sales) {
      const weight = ({ "미팅예정": config.rules.pipelineMeeting, "제안 · 조건협의": config.rules.pipelineProposal, "계약서발송": config.rules.pipelineSent, "서명완료": sale.signed_at ? 100 : 0 } as Record<string, number>)[sale.stage];
      if (weight === undefined || weight === 0) continue;
      const p = sale.proposal;
      if (!p || !opsDate(p.startDate) || !opsDate(p.endDate) || p.endDate < p.startDate || !p.quantity || !p.unitPrice || p.vat !== "excluded") { pendingProposals++; continue; }
      if (p.startDate > b.end || p.endDate < b.start || (sale.law_firm_id && activeContracts.some(c => c.law_firm_id === sale.law_firm_id))) continue;
      const plan = { start_date: p.startDate, end_date: p.endDate, monthly_quantity: p.quantity };
      values.push(((plannedSupply(plan, b.end) ?? 0) - (plannedSupply(plan, prior) ?? 0)) * p.unitPrice * weight / 100);
    }
    const pipeline = sum(values), projectedRevenue = committed + pipeline;
    const projectedProfit = config.goals.margin === null ? null : projectedRevenue * config.goals.margin / 100;
    const futureOperatingCost = monthRow && (config.costs.length || config.people.length) ? sum([...config.costs.map(c => c.amount), ...config.people.map(p => p.base + incentiveForPerson(p, sales, key).amount + p.employerCost)]) : null;
    return { month: key, committed, pipeline, projectedRevenue, projectedProfit, projectedOperatingProfit: projectedProfit !== null && futureOperatingCost !== null ? projectedProfit - futureOperatingCost : null, pendingProposals };
  });
  const activeProgress = contracts.filter(p => p.contract.status === "active" && p.contract.confirmed_at);
  const remainingRevenue = activeProgress.length ? knownSum(activeProgress.map(p => p.remaining !== null && p.contract.unit_price !== null ? p.remaining * p.contract.unit_price : null)) : null;
  const alerts: OperationsReport["alerts"] = [];
  for (const p of activeProgress) {
    if (p.status === "risk" || p.status === "warning") {
      const deficit = p.totalExpected !== null && p.forecast !== null ? Math.max(0, p.totalExpected * (1 - p.forecast / 100)) : null;
      alerts.push({ kind: p.status, firmId: p.contract.law_firm_id, message: `${p.firmName} · 현재 속도 예상 이행 ${p.forecast?.toFixed(1)}%${deficit !== null ? ` · 예상 부족 ${Math.ceil(deficit)}건` : ""}` });
    }
    const days = Math.ceil((Date.parse(p.contract.end_date) - Date.parse(today)) / 86400000);
    if (days >= 0 && days <= 45) alerts.push({ kind: "renewal", firmId: p.contract.law_firm_id, message: `${p.firmName} · 계약 종료 ${days}일 전 (${p.contract.end_date}) · ${days <= 30 ? "갱신·해지 의사 확인" : "갱신 준비"} · 자동갱신 조건은 계약서 확인 필요` });
  }
  return { month, generatedAt: now.toISOString(), includeDemo, excludedDemo: input.firms.length - demoFiltered.length, firms, totals, contracts, operatingCost, operatingProfit, projectedRevenue, projectedProfit,
    projectedOperatingProfit: projectedProfit !== null && operatingCost !== null ? projectedProfit - operatingCost : null, trend: [], sources, forecastMonths, peopleCosts,
    adjustmentCount: input.adjustments.filter(a => a.event_date.slice(0, 7) === month).length, activeFirmCount: new Set(activeProgress.map(p => p.contract.law_firm_id)).size, remainingRevenue, alerts,
    unregisteredFirms: selected.filter(f => !dbSupply.has(f.id)).length };
}
