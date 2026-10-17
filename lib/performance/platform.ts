/** Read-only platform supply analytics. No CRM mutations or accounting assumptions. */
export interface PerformanceFirmRecord {
  id: string;
  name: string;
  status: string;
  billing_type: string | null;
  lead_unit_price: number | string | null;
  created_at?: string | null;
}

export interface PerformanceLedgerRecord {
  id: string;
  law_firm_id: string;
  lead_id: string | null;
  classification: string;
  billable: boolean;
  billing_type: string | null;
  unit_price_snapshot: number | string | null;
  origin: string;
  supplied_at: string;
}

export interface PerformanceLeadRecord {
  id: string;
  law_firm_id: string;
  convertedClientId?: string | null;
  convertedCaseId?: string | null;
}

export interface PerformanceSettingsRecord { law_firm_id: string; value: unknown }
export type AdSpendStatus = "registered" | "unregistered" | "invalid";

export interface PlatformFirmMonth {
  month: string;
  hasActivity: boolean;
  rawEvents: number;
  newEvents: number;
  reentryEvents: number;
  duplicateEvents: number;
  otherEvents: number;
  suppliedLeads: number;
  unlinkedSupplyEvents: number;
  convertedLeads: number;
  missingConversionLeads: number;
  conversionRate: number | null;
  billableEvents: number;
  perLeadBillableEvents: number;
  perLeadBillingRevenue: number;
  billingRevenue: number | null;
  billingNeedsConfirmation: boolean;
  unconfirmedBillingEvents: number;
  invalidBillingEvents: number;
  billingTypes: string[];
  avgSoldUnitPrice: number | null;
  adSpend: number | null;
  registeredAdSpend: number;
  adSpendEntryCount: number;
  adSpendStatus: AdSpendStatus;
  adSpendSource: "month_closing" | "current_settings" | "missing";
  closedAt: string | null;
  contribution: number | null;
}

export interface PlatformFirmPerformance extends PlatformFirmMonth {
  lawFirmId: string;
  firmName: string;
  firmStatus: string;
  currentBillingType: string;
  currentUnitPrice: number | null;
  history: PlatformFirmMonth[];
}

export interface PlatformMonthSummary {
  month: string;
  firmCount: number;
  activeFirmCount: number;
  rawEvents: number;
  newEvents: number;
  reentryEvents: number;
  duplicateEvents: number;
  suppliedLeads: number;
  convertedLeads: number;
  conversionRate: number | null;
  missingConversionLeads: number;
  unlinkedSupplyEvents: number;
  billableEvents: number;
  perLeadBillableEvents: number;
  perLeadBillingRevenue: number;
  pendingBillingFirmCount: number;
  invalidBillingEvents: number;
  avgSoldUnitPrice: number | null;
  registeredAdSpend: number;
  adSpend: number | null;
  unregisteredCostFirmCount: number;
  invalidCostFirmCount: number;
  contribution: number | null;
}

export const PLATFORM_PERFORMANCE_DEFINITIONS = [
  { label: "공급 DB", description: "선택 월 신규·재유입 원장에서 리드 ID를 중복 제거한 수입니다. 중복 유입과 과거 이관(backfill)은 제외합니다. 삭제 등으로 ID가 없는 공급은 별도로 표시합니다." },
  { label: "건별 청구매출", description: "과금 원장 중 건별(per_lead) 과금의 공급 당시 단가 합계입니다. 0원 단가도 그대로 반영합니다. 월정액·수기 청구 및 금액 오류는 확인 필요로 표시하며 실제 수납액을 뜻하지 않습니다." },
  { label: "현재 단가 · 평균판매가", description: "현재 단가는 로펌 설정값, 평균판매가는 선택 월 건별 과금 원장의 공급 당시 단가 평균입니다. 현재 단가로 과거 매출을 다시 계산하지 않습니다." },
  { label: "광고비", description: "로펌 정산설정에 등록된 해당 월 광고비입니다. 월마감 스냅샷이 있으면 우선 적용합니다. 입력 내역 없음과 명시적으로 입력한 0원을 구분합니다." },
  { label: "광고비 차감이익", description: "확인 가능한 청구매출에서 등록 광고비만 뺀 값입니다. 인건비·고정비·세금 등을 제외한 회계 순이익이 아니며, 청구액이나 광고비가 미확정이면 계산하지 않습니다." },
  { label: "공급월 전환율", description: "공급 DB 중 현재 고객 또는 계약 전환 ID가 존재하는 고유 리드의 비율입니다. 연결 ID가 없거나 현재 상태를 확인할 수 없는 공급이 있으면 표시하지 않습니다. 전환 발생월 실적이나 월말 확정값이 아니므로 이후 전환에 따라 과거 월 수치가 바뀔 수 있습니다." },
] as const;

export interface PlatformPerformanceResponse {
  month: string;
  months: string[];
  generatedAt: string;
  totals: PlatformMonthSummary;
  trend: PlatformMonthSummary[];
  firms: PlatformFirmPerformance[];
  definitions: ReadonlyArray<{ label: string; description: string }>;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function amount(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "") || typeof value === "boolean") return null;
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

export function performanceMonthNow(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isPerformanceMonth(value: string): boolean {
  return /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
}

export function shiftPerformanceMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function performanceMonthBounds(month: string): { start: string; end: string } {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error("조회월은 YYYY-MM 형식으로 입력해주세요.");
  return { start: new Date(`${month}-01T00:00:00+09:00`).toISOString(), end: new Date(`${shiftPerformanceMonth(month, 1)}-01T00:00:00+09:00`).toISOString() };
}

export function performanceMonths(month: string): string[] {
  if (!isPerformanceMonth(month)) throw new Error("조회월은 YYYY-MM 형식으로 입력해주세요.");
  return Array.from({ length: 6 }, (_, index) => shiftPerformanceMonth(month, index - 5));
}

function readAdSpend(value: unknown, month: string) {
  const settings = record(value);
  const closing = record(record(settings.monthClosings)[month]);
  const hasSnapshot = closing.snapshot !== null && typeof closing.snapshot === "object" && !Array.isArray(closing.snapshot);
  const config = hasSnapshot ? record(closing.snapshot) : settings;
  const source: PlatformFirmMonth["adSpendSource"] = hasSnapshot ? "month_closing" : value == null ? "missing" : "current_settings";
  const rows = Array.isArray(config.adSpendEntries) ? config.adSpendEntries : [];
  let registered = 0;
  let validCount = 0;
  let invalidCount = 0;
  for (const item of rows) {
    const row = record(item);
    const date = typeof row.date === "string" ? row.date : "";
    if (date.slice(0, 7) !== month) continue;
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    const validDate = Number.isFinite(parsedDate) && new Date(parsedDate).toISOString().slice(0, 10) === date;
    const value = amount(row.amount);
    if (!validDate || value === null) { invalidCount++; continue; }
    if (!Number.isFinite(registered + value) || registered + value > Number.MAX_SAFE_INTEGER) throw new Error("등록 광고비 합계가 정확하게 표시할 수 있는 금액 범위를 초과했습니다.");
    registered += value;
    validCount++;
  }
  const status: AdSpendStatus = invalidCount > 0 ? "invalid" : validCount > 0 ? "registered" : "unregistered";
  return { adSpend: status === "registered" ? registered : null, registeredAdSpend: registered, adSpendEntryCount: validCount, adSpendStatus: status, adSpendSource: source, closedAt: hasSnapshot && typeof closing.closedAt === "string" ? closing.closedAt : null };
}

function firmMonth(firm: PerformanceFirmRecord, month: string, rows: PerformanceLedgerRecord[], settings: unknown, conversion: Map<string, boolean>): PlatformFirmMonth {
  const supplied = new Set<string>();
  let newEvents = 0, reentryEvents = 0, duplicateEvents = 0, otherEvents = 0, unlinkedSupplyEvents = 0;
  let billableEvents = 0, perLeadBillableEvents = 0, perLeadBillingRevenue = 0, unconfirmedBillingEvents = 0, invalidBillingEvents = 0;
  const billingTypes = new Set<string>();
  let hasNonPerLeadSnapshot = false;
  for (const row of rows) {
    if (row.classification === "new") newEvents++;
    else if (row.classification === "reentry") reentryEvents++;
    else if (row.classification.startsWith("duplicate_")) duplicateEvents++;
    else otherEvents++;
    if (row.classification === "new" || row.classification === "reentry") {
      if (row.lead_id) supplied.add(row.lead_id);
      else unlinkedSupplyEvents++;
    }
    // Duplicate/nonbillable events still preserve the billing mode in effect.
    // A monthly or manual invoice cannot be confirmed from per-lead charges.
    billingTypes.add(row.billing_type || "unknown");
    if (row.billing_type !== "per_lead") hasNonPerLeadSnapshot = true;
    if (row.billable !== true) continue;
    billableEvents++;
    if (row.billing_type !== "per_lead") { unconfirmedBillingEvents++; continue; }
    perLeadBillableEvents++;
    const price = amount(row.unit_price_snapshot);
    if (price === null || !Number.isSafeInteger(price)) { invalidBillingEvents++; continue; }
    if (!Number.isSafeInteger(perLeadBillingRevenue + price)) throw new Error("건별 청구매출이 정확하게 표시할 수 있는 금액 범위를 초과했습니다.");
    perLeadBillingRevenue += price;
  }
  const adSpend = readAdSpend(settings, month);
  const createdAt = firm.created_at ? Date.parse(firm.created_at) : NaN;
  const existed = !Number.isFinite(createdAt) || createdAt < Date.parse(performanceMonthBounds(month).end);
  const unknownFixedBilling = billableEvents === 0 && existed && firm.billing_type !== "per_lead";
  if (unknownFixedBilling) billingTypes.add(firm.billing_type || "unknown");
  const billingNeedsConfirmation = unknownFixedBilling || hasNonPerLeadSnapshot || unconfirmedBillingEvents > 0 || invalidBillingEvents > 0 || !Number.isSafeInteger(perLeadBillingRevenue);
  const billingRevenue = billingNeedsConfirmation ? null : perLeadBillingRevenue;
  let convertedLeads = 0, missingConversionLeads = 0;
  for (const id of supplied) {
    const key = `${firm.id}\u0000${id}`;
    if (!conversion.has(key)) missingConversionLeads++;
    else if (conversion.get(key)) convertedLeads++;
  }
  return {
    month, hasActivity: rows.length > 0 || adSpend.adSpendStatus !== "unregistered" || unknownFixedBilling,
    rawEvents: rows.length, newEvents, reentryEvents, duplicateEvents, otherEvents,
    suppliedLeads: supplied.size, unlinkedSupplyEvents, convertedLeads, missingConversionLeads,
    conversionRate: supplied.size > 0 && missingConversionLeads === 0 && unlinkedSupplyEvents === 0 ? convertedLeads / supplied.size * 100 : null,
    billableEvents, perLeadBillableEvents, perLeadBillingRevenue,
    billingRevenue, billingNeedsConfirmation, unconfirmedBillingEvents, invalidBillingEvents, billingTypes: [...billingTypes],
    avgSoldUnitPrice: perLeadBillableEvents > 0 && invalidBillingEvents === 0 ? perLeadBillingRevenue / perLeadBillableEvents : null,
    ...adSpend,
    contribution: billingRevenue !== null && adSpend.adSpend !== null ? billingRevenue - adSpend.adSpend : null,
  };
}

export function summarizePlatformMonth(rows: PlatformFirmMonth[], month: string): PlatformMonthSummary {
  const active = rows.filter(row => row.hasActivity);
  const sum = (key: "rawEvents" | "newEvents" | "reentryEvents" | "duplicateEvents" | "suppliedLeads" | "convertedLeads" | "missingConversionLeads" | "unlinkedSupplyEvents" | "billableEvents" | "perLeadBillableEvents" | "perLeadBillingRevenue" | "invalidBillingEvents" | "registeredAdSpend") => rows.reduce((total, row) => total + row[key], 0);
  const suppliedLeads = sum("suppliedLeads"), convertedLeads = sum("convertedLeads"), missingConversionLeads = sum("missingConversionLeads");
  const unlinkedSupplyEvents = sum("unlinkedSupplyEvents");
  const perLeadBillableEvents = sum("perLeadBillableEvents"), perLeadBillingRevenue = sum("perLeadBillingRevenue"), invalidBillingEvents = sum("invalidBillingEvents");
  const pendingBillingFirmCount = active.filter(row => row.billingNeedsConfirmation).length;
  const unregisteredCostFirmCount = active.filter(row => row.adSpendStatus === "unregistered").length;
  const invalidCostFirmCount = active.filter(row => row.adSpendStatus === "invalid").length;
  const registeredAdSpend = sum("registeredAdSpend");
  if (!Number.isSafeInteger(perLeadBillingRevenue) || !Number.isFinite(registeredAdSpend) || registeredAdSpend > Number.MAX_SAFE_INTEGER) throw new Error("합계가 정확하게 표시할 수 있는 금액 범위를 초과했습니다.");
  const adSpend = active.length > 0 && unregisteredCostFirmCount === 0 && invalidCostFirmCount === 0 ? registeredAdSpend : null;
  return {
    month, firmCount: rows.length, activeFirmCount: active.length,
    rawEvents: sum("rawEvents"), newEvents: sum("newEvents"), reentryEvents: sum("reentryEvents"), duplicateEvents: sum("duplicateEvents"),
    suppliedLeads, convertedLeads, missingConversionLeads, unlinkedSupplyEvents,
    conversionRate: suppliedLeads > 0 && missingConversionLeads === 0 && unlinkedSupplyEvents === 0 ? convertedLeads / suppliedLeads * 100 : null,
    billableEvents: sum("billableEvents"), perLeadBillableEvents, perLeadBillingRevenue, pendingBillingFirmCount, invalidBillingEvents,
    avgSoldUnitPrice: perLeadBillableEvents > 0 && invalidBillingEvents === 0 ? perLeadBillingRevenue / perLeadBillableEvents : null,
    registeredAdSpend, adSpend, unregisteredCostFirmCount, invalidCostFirmCount,
    contribution: active.length > 0 && pendingBillingFirmCount === 0 && adSpend !== null ? perLeadBillingRevenue - adSpend : null,
  };
}

export function aggregatePlatformPerformance(input: {
  month: string;
  firms: PerformanceFirmRecord[];
  ledger: PerformanceLedgerRecord[];
  settings: PerformanceSettingsRecord[];
  leads: PerformanceLeadRecord[];
  generatedAt?: string;
}): PlatformPerformanceResponse {
  const months = performanceMonths(input.month);
  const monthSet = new Set(months);
  const firmSet = new Set(input.firms.map(firm => firm.id));
  const grouped = new Map<string, PerformanceLedgerRecord[]>();
  const seen = new Set<string>();
  for (const row of input.ledger) {
    if (row.origin === "backfill" || !firmSet.has(row.law_firm_id) || seen.has(row.id)) continue;
    const time = Date.parse(row.supplied_at);
    if (!Number.isFinite(time)) continue;
    const month = performanceMonthNow(new Date(time));
    if (!monthSet.has(month)) continue;
    seen.add(row.id);
    const key = `${row.law_firm_id}\u0000${month}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const settings = new Map(input.settings.map(row => [row.law_firm_id, row.value]));
  const conversion = new Map(input.leads.map(row => [`${row.law_firm_id}\u0000${row.id}`, Boolean(row.convertedCaseId || row.convertedClientId)]));
  const firms = input.firms.map(firm => {
    const history = months.map(month => firmMonth(firm, month, grouped.get(`${firm.id}\u0000${month}`) ?? [], settings.get(firm.id), conversion));
    return {
      lawFirmId: firm.id, firmName: firm.name, firmStatus: firm.status,
      currentBillingType: firm.billing_type || "unknown", currentUnitPrice: amount(firm.lead_unit_price),
      ...history[history.length - 1], history,
    };
  });
  const trend = months.map((month, index) => summarizePlatformMonth(firms.map(firm => firm.history[index]), month));
  return { month: input.month, months, generatedAt: input.generatedAt ?? new Date().toISOString(), totals: trend[trend.length - 1], trend, firms, definitions: PLATFORM_PERFORMANCE_DEFINITIONS };
}
