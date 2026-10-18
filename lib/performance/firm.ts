import type { CaseRecord, Client, DbLead, Installment } from "../types";
import { getRetainedLeadIds } from "./lead-retainer-conversion";

/** Read-only analytics. Period flows use KST calendar dates; current stock values
 * (activeDb/activeCases/outstanding/overdueAmount) are not historical snapshots.
 * Conversion is the current convertedClientId of the intake-date cohort, since
 * the CRM has no conversion timestamp. No cost/profit assumptions are made.
 */
export interface PerformanceMetrics {
  db: number;
  converted: number;
  conversionRate: number;
  /** Intake-cohort leads with a current positive-fee, non-cancelled contract. */
  contractedDb: number;
  contractConversionRate: number;
  consulted: number;
  contacts: number;
  contracts: number;
  contractAmount: number;
  cash: number;
  outstanding: number;
  overdueAmount: number;
  activeCases: number;
  cancelled: number;
  activeDb: number;
  zeroFeeCases: number;
}

export interface StaffPerformance extends PerformanceMetrics { name: string }
export interface DailyPerformance {
  date: string;
  db: number;
  converted: number;
  contracts: number;
  contractAmount: number;
  cash: number;
}
export interface PerformanceCase {
  id: string;
  clientName: string;
  caseNumber: string;
  assignedStaff: string;
  caseType: string;
  stage: string;
  status: string;
  contractDate: string;
  contractAmount: number;
  paidTotal: number;
  periodCash: number;
  outstanding: number;
  overdueAmount: number;
  /** Contract date is in the selected period, including cancelled/zero-fee rows. */
  inPeriod: boolean;
}
/** Firm-wide data-quality counts, independent of the optional staff filter. */
export interface PerformanceQuality {
  orphanPayments: number;
  orphanCases: number;
  unlinkedConvertedLeads: number;
  undatedCompletedPayments: number;
  invalidLeadDates: number;
  invalidCaseDates: number;
  duplicateLeads: number;
  duplicateCases: number;
  duplicateClients: number;
  duplicateInstallments: number;
  legacyPaidCases: number;
  paidTotalMismatches: number;
}
export interface FirmPerformanceReport {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  scope: { firmId: string; firmName: string };
  selectedStaff?: string;
  summary: PerformanceMetrics;
  /** Previous period flows; stock fields remain the current snapshot. */
  previous: PerformanceMetrics;
  /** All staff remain visible for comparison even with selectedStaff set. */
  staff: StaffPerformance[];
  trend: DailyPerformance[];
  /** Exact stored detailStage/status distribution of selected intake cohort. */
  funnel: Array<{ name: string; count: number }>;
  caseTypes: Array<{ name: string; contracts: number; contractAmount: number; cash: number }>;
  /** Current stages of valid, non-cancelled positive-fee cases. */
  stages: Array<{ name: string; count: number }>;
  /** All current cases in scope, including old cases receiving cash this period. */
  cases: PerformanceCase[];
  quality: PerformanceQuality;
}
export interface FirmPerformanceInput {
  leads: DbLead[];
  cases: CaseRecord[];
  clients: Client[];
  installments: Installment[];
  /** Registered work staff, including staff with no activity yet. */
  staffNames?: string[];
}
export interface PerformanceRange { start: string; end: string; previousStart: string; previousEnd: string }

const DAY_MS = 86_400_000;
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function shiftDate(value: string, days: number): string {
  return new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}
export function performanceRange(start: string, end: string): PerformanceRange {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error("시작일과 종료일을 YYYY-MM-DD 형식의 올바른 기간으로 선택해주세요.");
  const days = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / DAY_MS) + 1;
  if (days > 366) throw new Error("한 번에 최대 366일의 성과를 조회할 수 있습니다.");
  const previousStart = shiftDate(start, -days), previousEnd = shiftDate(start, -1);
  if (!validDate(previousStart) || !validDate(previousEnd)) throw new Error("이전 기간을 비교할 수 있는 날짜를 선택해주세요.");
  return { start, end, previousStart, previousEnd };
}

/** Date-only values are literal business days; timezone-less CRM datetimes are KST. */
export function kstPerformanceDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validDate(value) ? value : undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || !validDate(value.slice(0, 10))) return undefined;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+09:00`;
  const date = new Date(zoned);
  if (!Number.isFinite(date.getTime())) return undefined;
  const key = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return validDate(key) ? key : undefined;
}

export function resolvePerformanceFirmId(profile: { platform_role?: string | null; role?: string | null; law_firm_id?: string | null }, requested?: string | null): string {
  const role = profile.platform_role || "staff";
  if (role !== "super_admin" && role !== "firm_admin" && profile.role !== "admin") throw new Error("FORBIDDEN");
  const requestedId = requested?.trim();
  if (role === "super_admin") {
    if (!requestedId) throw new Error("성과를 조회할 로펌을 선택해주세요.");
    return requestedId;
  }
  if (!profile.law_firm_id) throw new Error("NO_FIRM");
  if (requestedId && requestedId !== profile.law_firm_id) throw new Error("FORBIDDEN");
  return profile.law_firm_id;
}

function money(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? Math.max(0, n) : 0; }
function name(value: unknown): string { return typeof value === "string" && value.trim() ? value.trim() : "미지정"; }
function inPeriod(date: string | undefined, start: string, end: string): boolean { return !!date && date >= start && date <= end; }
function validContract(record: CaseRecord): boolean { return money(record.contractAmount) > 0 && record.status !== "취하"; }
function emptyMetrics(): PerformanceMetrics {
  return { db: 0, converted: 0, conversionRate: 0, contractedDb: 0, contractConversionRate: 0, consulted: 0, contacts: 0, contracts: 0, contractAmount: 0, cash: 0, outstanding: 0, overdueAmount: 0, activeCases: 0, cancelled: 0, activeDb: 0, zeroFeeCases: 0 };
}
function unique<T extends { id: string }>(rows: readonly T[]): { rows: T[]; duplicates: number } {
  const byId = new Map<string, T>();
  let duplicates = 0;
  for (const row of rows) { if (byId.has(row.id)) duplicates += 1; else byId.set(row.id, row); }
  return { rows: [...byId.values()], duplicates };
}
function increment(map: Map<string, number>, key: string, amount = 1) { map.set(key, (map.get(key) ?? 0) + amount); }

export function buildFirmPerformanceReport(
  input: FirmPerformanceInput,
  start: string,
  end: string,
  scope: { firmId: string; firmName: string },
  selectedStaff?: string,
  now = new Date(),
): FirmPerformanceReport {
  const range = performanceRange(start, end);
  const today = kstPerformanceDate(now.toISOString())!;
  const leadSet = unique(input.leads), caseSet = unique(input.cases), clientSet = unique(input.clients), installmentSet = unique(input.installments);
  const { rows: leads } = leadSet, { rows: cases } = caseSet, { rows: clients } = clientSet, { rows: installments } = installmentSet;
  const retainedLeadIds = getRetainedLeadIds(leads, cases);
  const caseById = new Map(cases.map((record) => [record.id, record]));
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const clientsWithCases = new Set(cases.map((record) => record.clientId));
  const leadsWithCases = new Set(cases.map((record) => record.fromLeadId).filter(Boolean));
  const quality: PerformanceQuality = {
    orphanPayments: 0, orphanCases: 0, unlinkedConvertedLeads: 0, undatedCompletedPayments: 0,
    invalidLeadDates: 0, invalidCaseDates: 0, duplicateLeads: leadSet.duplicates, duplicateCases: caseSet.duplicates,
    duplicateClients: clientSet.duplicates, duplicateInstallments: installmentSet.duplicates, legacyPaidCases: 0, paidTotalMismatches: 0,
  };
  const rowsByCase = new Map<string, Installment[]>();
  for (const installment of installments) {
    if (!caseById.has(installment.caseId)) quality.orphanPayments += 1;
    if (installment.status === "완료" && !kstPerformanceDate(installment.paidDate)) quality.undatedCompletedPayments += 1;
    const rows = rowsByCase.get(installment.caseId);
    if (rows) rows.push(installment); else rowsByCase.set(installment.caseId, [installment]);
  }
  const periodPayments = new Map<string, number>();
  const currentByStaff = new Map<string, PerformanceMetrics>(), previousByStaff = new Map<string, PerformanceMetrics>();
  function metrics(map: Map<string, PerformanceMetrics>, staff: string) {
    let row = map.get(staff);
    if (!row) { row = emptyMetrics(); map.set(staff, row); }
    return row;
  }
  for (const staff of input.staffNames ?? []) {
    if (typeof staff !== "string" || !staff.trim()) continue;
    metrics(currentByStaff, name(staff));
    metrics(previousByStaff, name(staff));
  }
  const requestedStaff = selectedStaff?.trim() || undefined;
  const selected = (staff: string) => !requestedStaff || staff === requestedStaff;
  const trend = new Map<string, DailyPerformance>();
  for (let date = start; ; date = shiftDate(date, 1)) {
    trend.set(date, { date, db: 0, converted: 0, contracts: 0, contractAmount: 0, cash: 0 });
    if (date === end) break;
  }
  const funnel = new Map<string, number>(), stages = new Map<string, number>();
  const caseTypes = new Map<string, { name: string; contracts: number; contractAmount: number; cash: number }>();
  function caseType(type: string) {
    let row = caseTypes.get(type);
    if (!row) { row = { name: type, contracts: 0, contractAmount: 0, cash: 0 }; caseTypes.set(type, row); }
    return row;
  }

  for (const lead of leads) {
    const staff = name(lead.assignedStaff), date = kstPerformanceDate(lead.receivedAt);
    const current = metrics(currentByStaff, staff), previous = metrics(previousByStaff, staff);
    if (!date) quality.invalidLeadDates += 1;
    if (lead.convertedClientId && (!clientById.has(lead.convertedClientId)
      || (lead.convertedCaseId ? !caseById.has(lead.convertedCaseId) : !clientsWithCases.has(lead.convertedClientId) && !leadsWithCases.has(lead.id)))) quality.unlinkedConvertedLeads += 1;
    if (!lead.convertedClientId && !["거절", "부적합", "종결_중단"].includes(lead.status)) { current.activeDb += 1; previous.activeDb += 1; }
    const converted = !!lead.convertedClientId;
    // Count only an explicit stored consultation state, never infer it from text.
    const consulted = lead.status === "상담완료" || lead.detailStage === "상담";
    for (const [target, from, to] of [[current, start, end], [previous, range.previousStart, range.previousEnd]] as const) {
      if (inPeriod(date, from, to)) { target.db += 1; if (converted) target.converted += 1; if (retainedLeadIds.has(lead.id)) target.contractedDb += 1; if (consulted) target.consulted += 1; }
    }
    if (selected(staff) && inPeriod(date, start, end)) {
      const day = trend.get(date!)!; day.db += 1; if (converted) day.converted += 1;
      increment(funnel, lead.detailStage || lead.status || "미지정");
    }
    for (const memo of lead.consultation?.memoLog ?? []) {
      const contact = memo.tag === "재통화" || memo.tag === "부재중" || (memo.tag === "일반" && !!memo.text?.trim());
      if (!contact) continue;
      const contactDate = kstPerformanceDate(memo.at);
      if (inPeriod(contactDate, start, end)) current.contacts += 1;
      if (inPeriod(contactDate, range.previousStart, range.previousEnd)) previous.contacts += 1;
    }
  }

  // Cash is actual completed receipts by paidDate, including old/cancelled cases.
  // An orphan receipt cannot be attributed and is excluded, with a quality count.
  for (const installment of installments) {
    const record = caseById.get(installment.caseId);
    if (!record || installment.status !== "완료") continue;
    const amount = money(installment.actualPaidAmount ?? installment.amount), date = kstPerformanceDate(installment.paidDate), staff = name(record.assignedStaff);
    if (inPeriod(date, start, end)) {
      metrics(currentByStaff, staff).cash += amount;
      increment(periodPayments, record.id, amount);
      if (selected(staff)) { trend.get(date!)!.cash += amount; caseType(record.caseType || "미지정").cash += amount; }
    }
    if (inPeriod(date, range.previousStart, range.previousEnd)) metrics(previousByStaff, staff).cash += amount;
  }

  const leanCases: PerformanceCase[] = [];
  for (const record of cases) {
    const staff = name(record.assignedStaff), current = metrics(currentByStaff, staff), previous = metrics(previousByStaff, staff);
    const date = kstPerformanceDate(record.contractDate), amount = money(record.contractAmount), valid = validContract(record);
    if (!date) quality.invalidCaseDates += 1;
    const client = clientById.get(record.clientId);
    if (!client) quality.orphanCases += 1;
    const payments = rowsByCase.get(record.id) ?? [];
    // Prefer the installment ledger. Only cases without any ledger rows can use
    // legacy paidAmount; never add that cached total on top of the ledger.
    const paidTotal = payments.length
      ? payments.reduce((sum, payment) => sum + (payment.status === "완료" ? money(payment.actualPaidAmount ?? payment.amount) : 0), 0)
      : money(record.paidAmount);
    if (!payments.length && paidTotal > 0) quality.legacyPaidCases += 1;
    if (payments.length && Math.abs(paidTotal - money(record.paidAmount)) > 0.01) quality.paidTotalMismatches += 1;
    const outstanding = valid ? Math.max(0, amount - paidTotal) : 0;
    const scheduledOverdue = payments.reduce((sum, payment) => {
      if (payment.status === "완료") return sum;
      const due = kstPerformanceDate(payment.dueDate);
      const overdue = payment.status === "연체" || payment.status === "실패" || (!!due && due < today);
      return sum + (overdue ? money(payment.amount) : 0);
    }, 0);
    const overdueAmount = Math.min(outstanding, scheduledOverdue);
    for (const target of [current, previous]) {
      target.outstanding += outstanding; target.overdueAmount += overdueAmount;
      if (valid && record.status === "진행중") target.activeCases += 1;
    }
    for (const [target, from, to] of [[current, start, end], [previous, range.previousStart, range.previousEnd]] as const) {
      if (!inPeriod(date, from, to)) continue;
      if (record.status === "취하") target.cancelled += 1;
      else if (amount <= 0) target.zeroFeeCases += 1;
      else { target.contracts += 1; target.contractAmount += amount; }
    }
    if (selected(staff)) {
      if (valid) increment(stages, record.stage || "미지정");
      if (valid && inPeriod(date, start, end)) {
        const day = trend.get(date!)!; day.contracts += 1; day.contractAmount += amount;
        const category = caseType(record.caseType || "미지정"); category.contracts += 1; category.contractAmount += amount;
      }
      leanCases.push({ id: record.id, clientName: client?.name || "연결 고객 없음", caseNumber: record.caseNumber || "", assignedStaff: staff,
        caseType: record.caseType || "미지정", stage: record.stage || "미지정", status: record.status || "미지정", contractDate: date || "",
        contractAmount: amount, paidTotal, periodCash: periodPayments.get(record.id) ?? 0, outstanding, overdueAmount, inPeriod: inPeriod(date, start, end) });
    }
  }

  function total(map: Map<string, PerformanceMetrics>): PerformanceMetrics {
    const result = emptyMetrics();
    for (const [staff, row] of map) {
      if (!selected(staff)) continue;
      for (const key of Object.keys(result) as Array<keyof PerformanceMetrics>) if (key !== "conversionRate" && key !== "contractConversionRate") result[key] += row[key];
    }
    result.conversionRate = result.db ? result.converted / result.db * 100 : 0;
    result.contractConversionRate = result.db ? result.contractedDb / result.db * 100 : 0;
    return result;
  }
  const staff = [...currentByStaff].map(([staffName, row]) => ({ name: staffName, ...row, conversionRate: row.db ? row.converted / row.db * 100 : 0, contractConversionRate: row.db ? row.contractedDb / row.db * 100 : 0 }))
    .sort((a, b) => b.cash - a.cash || b.contracts - a.contracts || a.name.localeCompare(b.name, "ko"));
  const counts = (map: Map<string, number>) => [...map].map(([label, count]) => ({ name: label, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
  return { ...range, scope, selectedStaff: requestedStaff, summary: total(currentByStaff), previous: total(previousByStaff), staff,
    trend: [...trend.values()], funnel: counts(funnel), caseTypes: [...caseTypes.values()].sort((a, b) => b.contracts - a.contracts || a.name.localeCompare(b.name, "ko")),
    stages: counts(stages), cases: leanCases.sort((a, b) => b.contractDate.localeCompare(a.contractDate) || a.id.localeCompare(b.id)), quality };
}
