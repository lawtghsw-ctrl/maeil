import type { CaseRecord, DbLead, Installment } from "@/lib/types";
import { buildSupplyConversionCohorts, buildPeriodSupplyContracts, type SupplyConversionResult, type SupplyPeriodContracts } from "./performance/supply-conversion";

/** Cash is the actual recorded amount. An explicit zero never falls back to the schedule. */
export function actualPayment(row: Pick<Installment, "amount" | "actualPaidAmount">): number {
  return Math.max(0, Number(row.actualPaidAmount ?? row.amount) || 0);
}
export function isValidRetainer(row: Pick<CaseRecord, "status" | "contractAmount">): boolean {
  return row.status !== "취하" && row.contractAmount > 0;
}
export function kstDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10) : "";
}
export function maturityCutoff(asOf: string): string {
  return new Date(new Date(`${asOf}T00:00:00Z`).getTime() - 60 * 86400000).toISOString().slice(0, 10);
}
export function ratioLabel(numerator: number, denominator: number): string {
  return denominator > 0 ? `${numerator}/${denominator} · ${(numerator / denominator * 100).toFixed(1)}%` : "판단 유예 · 0/0";
}
export function standardFeeForCase(row: CaseRecord, fallback?: number): number | undefined {
  const snapshot = (row as CaseRecord & { feeStandardSnapshot?: { baseFee?: number } }).feeStandardSnapshot;
  return snapshot && Number.isFinite(snapshot.baseFee) ? snapshot.baseFee : fallback;
}
export type StructuredContact = { id: string; at: string; staff: string; type: "phone" | "sms"; connected?: boolean; durationSeconds?: number };
export function structuredContacts(lead: DbLead): StructuredContact[] | undefined {
  const rows = (lead as DbLead & { contactLog?: StructuredContact[] }).contactLog;
  return Array.isArray(rows) ? rows : undefined;
}
export function firstCallMinutes(lead: DbLead): number | undefined {
  const received = new Date(lead.receivedAt).getTime();
  const times = (structuredContacts(lead) ?? []).filter(row => row.type === "phone").map(row => new Date(row.at).getTime()).filter(time => Number.isFinite(time) && time >= received);
  return Number.isFinite(received) && times.length ? Math.round((Math.min(...times) - received) / 60000) : undefined;
}
/** Old rows without a recorded stage change have unknown dwell time. */
export function leadStageDays(lead: DbLead, now = Date.now()): number | undefined {
  if (!lead.stageUpdatedAt) return undefined;
  const at = new Date(lead.stageUpdatedAt).getTime();
  return Number.isFinite(at) && at <= now ? Math.floor((now - at) / 86400000) : undefined;
}

export interface FirmSupplyContract { id: string; product: string; category: string; unitPrice: number | null; monthlyQuantity: number | null; startDate: string; endDate: string; status: string; confirmedAt: string | null }
export interface FirmSupplySummary {
  firmId: string; start: string; end: string;
  serviceMode: "crm_only" | "db_supply" | "unregistered";
  contracts: FirmSupplyContract[];
  suppliedCount: number; billableCount: number; replacedCount: number;
  purchaseCost: number | null; knownPurchaseCost: number; missingPriceCount: number; unlinkedCount: number;
  monthly: { month: string; suppliedCount: number; billableCount: number; purchaseCost: number | null }[];
  weekly: { week: string; suppliedCount: number; billableCount: number }[];
  byLead: { leadId: string; purchaseCost: number | null }[];
  supplyCohort: SupplyConversionResult["supplyCohort"];
  matureCohort: SupplyConversionResult["matureCohort"];
  periodContracts: SupplyPeriodContracts;
}
export type SupplyLedgerRow = { id: string; law_firm_id: string; lead_id: string | null; supplied_at: string; billable: boolean; unit_price_snapshot: number | null; classification?: string | null; origin?: string | null };

export function summarizeFirmSupply(firmId: string, start: string, end: string, ledger: SupplyLedgerRow[], contracts: FirmSupplyContract[], replacedCount: number, cases: CaseRecord[], asOf = kstDay(new Date().toISOString()), cohortLeads: DbLead[] = [], staffNames: string[] = []): FirmSupplySummary {
  const conversion = buildSupplyConversionCohorts({ firmId, start, end, ledger, cases, leads: cohortLeads, staffNames, asOf });
  const periodContracts = buildPeriodSupplyContracts({ firmId, start, end, ledger, cases, leads: cohortLeads });
  const result: FirmSupplySummary = { firmId, start, end, serviceMode: "db_supply", contracts, suppliedCount: 0, billableCount: 0, replacedCount, purchaseCost: 0, knownPurchaseCost: 0, missingPriceCount: 0, unlinkedCount: 0, monthly: [], weekly: [], byLead: [], ...conversion, periodContracts };
  const months = new Map<string, { month: string; suppliedCount: number; billableCount: number; purchaseCost: number | null }>();
  const weeks = new Map<string, { week: string; suppliedCount: number; billableCount: number }>();
  const leads = new Map<string, number | null>();
  for (const row of ledger) {
    if (row.law_firm_id !== firmId) throw new Error("FORBIDDEN");
    const day = kstDay(row.supplied_at);
    if (!day || day < start || day > end) continue;
    result.suppliedCount++;
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const week = date.toISOString().slice(0, 10);
    const weekly = weeks.get(week) ?? { week, suppliedCount: 0, billableCount: 0 };
    weekly.suppliedCount++; if (row.billable) weekly.billableCount++;
    weeks.set(week, weekly);
    if (!row.lead_id) result.unlinkedCount++;
    const month = day.slice(0, 7);
    const item = months.get(month) ?? { month, suppliedCount: 0, billableCount: 0, purchaseCost: 0 };
    item.suppliedCount++;
    const cost = row.billable ? (row.unit_price_snapshot !== null && Number(row.unit_price_snapshot) > 0 ? Number(row.unit_price_snapshot) : null) : 0;
    if (row.billable) {
      result.billableCount++; item.billableCount++;
      if (cost === null) { result.missingPriceCount++; item.purchaseCost = null; }
      else { result.knownPurchaseCost += cost; if (item.purchaseCost !== null) item.purchaseCost += cost; }
    }
    months.set(month, item);
    if (row.lead_id) {
      const previous = leads.get(row.lead_id);
      leads.set(row.lead_id, cost === null || previous === null ? null : (previous ?? 0) + cost);
    }
  }
  result.purchaseCost = result.missingPriceCount ? null : result.knownPurchaseCost;
  result.monthly = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  result.weekly = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
  result.byLead = [...leads].map(([leadId, purchaseCost]) => ({ leadId, purchaseCost }));
  return result;
}
