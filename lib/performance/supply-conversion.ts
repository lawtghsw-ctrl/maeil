import type { CaseRecord, DbLead } from "../types";
import { kstPerformanceDate } from "./firm";
import { getRetainedLeadIds } from "./lead-retainer-conversion";

export type SupplyConversionLead = Pick<DbLead, "id" | "_lawFirmId" | "convertedCaseId"> & { assignedStaff?: string };
export type SupplyConversionCase = Pick<CaseRecord, "id" | "_lawFirmId" | "fromLeadId" | "status" | "contractAmount">;
export interface SupplyConversionLedger {
  id: string; law_firm_id: string; lead_id: string | null; supplied_at: string;
  classification?: string | null; origin?: string | null;
}
export interface SupplyConversionQuality {
  unlinkedRows: number; missingLeads: number; duplicateSupplyRows: number;
  unknownSupplyRows: number; invalidSupplyDates: number; unresolvedContracts: number;
}
export interface SupplyConversionStaff {
  key: string; name: string; kind: "staff" | "unlinked";
  db: number; contractedDb: number; conversionRate: number | null;
}
export interface SupplyConversionCohort {
  /** Identified unique DBs plus unresolved null-ID rows. A nonzero unresolved
   * count makes this a provisional denominator and conversionRate stays null. */
  supplied: number; retained: number; conversionRate: number | null;
  staff: SupplyConversionStaff[]; quality: SupplyConversionQuality;
}
export interface SupplyConversionResult {
  supplyCohort: SupplyConversionCohort;
  matureCohort: SupplyConversionCohort & { cutoff: string };
}
export function supplyConversionUncertainty(quality: SupplyConversionQuality): number {
  return quality.unlinkedRows + quality.missingLeads + quality.unknownSupplyRows + quality.invalidSupplyDates + quality.unresolvedContracts;
}
function firstById<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) if (!result.has(row.id)) result.set(row.id, row);
  return result;
}

/** Read-only supply-date cohorts. Only actual new/reentry deliveries qualify;
 * billing status and price never change the population. The same lead delivered
 * repeatedly in a period is represented by its earliest eligible delivery.
 * Full firm leads/cases are required, including rows outside the supply period,
 * so reverse-pointer ambiguity and subsequent contracts are not hidden.
 */
export function buildSupplyConversionCohorts(input: {
  firmId: string; start: string; end: string; asOf: string;
  ledger: readonly SupplyConversionLedger[]; leads: readonly SupplyConversionLead[];
  cases: readonly SupplyConversionCase[]; staffNames?: readonly string[];
}): SupplyConversionResult {
  const { firmId, start, end } = input;
  if (kstPerformanceDate(start) !== start || kstPerformanceDate(end) !== end || start > end || kstPerformanceDate(input.asOf) !== input.asOf) throw new Error("공급 전환 집계 날짜를 확인해주세요.");
  for (const row of input.ledger) if (row.law_firm_id !== firmId) throw new Error("FORBIDDEN");
  for (const row of [...input.leads, ...input.cases]) if (row._lawFirmId && row._lawFirmId !== firmId) throw new Error("FORBIDDEN");
  const leads = firstById(input.leads), cases = firstById(input.cases);
  // JSON numeric projections can be strings; booleans/objects are not fees.
  const retained = getRetainedLeadIds([...leads.values()], [...cases.values()].filter(row =>
    typeof row.contractAmount === "number" || (typeof row.contractAmount === "string" && String(row.contractAmount).trim() !== "")));
  const claims = new Map<string, number>();
  for (const lead of leads.values()) if (lead.convertedCaseId) claims.set(lead.convertedCaseId, (claims.get(lead.convertedCaseId) ?? 0) + 1);
  const unresolved = new Set<string>();
  for (const lead of leads.values()) {
    if (!lead.convertedCaseId || retained.has(lead.id)) continue;
    const record = cases.get(lead.convertedCaseId);
    if (!record || (record.fromLeadId && record.fromLeadId !== lead.id) || (!record.fromLeadId && (claims.get(record.id) ?? 0) > 1)) unresolved.add(lead.id);
  }
  const cutoff = new Date(Date.parse(`${input.asOf}T00:00:00Z`) - 60 * 86400000).toISOString().slice(0, 10);
  const eligible: Array<{ row: SupplyConversionLedger; day: string }> = [];
  const unknownDates: string[] = [];
  let invalidSupplyDates = 0;
  for (const row of firstById(input.ledger).values()) {
    // Known non-supply events do not enter either the cohort or its uncertainty.
    if (row.origin === "backfill" || ["duplicate_external", "duplicate_meta", "duplicate_phone"].includes(row.classification ?? "")) continue;
    const day = kstPerformanceDate(row.supplied_at);
    if (!day) { invalidSupplyDates++; continue; }
    if (day < start || day > end) continue;
    if (!row.origin || !["new", "reentry"].includes(row.classification ?? "")) { unknownDates.push(day); continue; }
    eligible.push({ row, day });
  }
  function cohort(mature: boolean): SupplyConversionCohort {
    const quality: SupplyConversionQuality = { unlinkedRows: 0, missingLeads: 0, duplicateSupplyRows: 0,
      unknownSupplyRows: unknownDates.filter(day => !mature || day <= cutoff).length, invalidSupplyDates, unresolvedContracts: 0 };
    const byStaff = new Map<string, SupplyConversionStaff>();
    function staff(name: string): SupplyConversionStaff {
      const key = `staff:${name}`;
      let row = byStaff.get(key);
      if (!row) { row = { key, name, kind: "staff", db: 0, contractedDb: 0, conversionRate: null }; byStaff.set(key, row); }
      return row;
    }
    for (const value of input.staffNames ?? []) if (typeof value === "string" && value.trim()) staff(value.trim());
    for (const lead of leads.values()) staff(typeof lead.assignedStaff === "string" && lead.assignedStaff.trim() ? lead.assignedStaff.trim() : "미지정");
    const byLead = new Map<string, { row: SupplyConversionLedger; day: string }>();
    for (const entry of eligible) {
      if (mature && entry.day > cutoff) continue;
      const id = entry.row.lead_id;
      if (!id) { quality.unlinkedRows++; continue; }
      const previous = byLead.get(id);
      if (previous) quality.duplicateSupplyRows++;
      if (!previous || entry.day < previous.day || (entry.day === previous.day && Date.parse(entry.row.supplied_at) < Date.parse(previous.row.supplied_at))) byLead.set(id, entry);
    }
    let retainedCount = 0;
    for (const id of byLead.keys()) {
      const lead = leads.get(id);
      if (!lead) { quality.missingLeads++; continue; }
      const row = staff(typeof lead.assignedStaff === "string" && lead.assignedStaff.trim() ? lead.assignedStaff.trim() : "미지정");
      row.db++;
      if (retained.has(id)) { row.contractedDb++; retainedCount++; }
      if (unresolved.has(id)) quality.unresolvedContracts++;
    }
    const unknown = quality.unlinkedRows + quality.missingLeads;
    if (unknown) byStaff.set("unlinked", { key: "unlinked", name: "담당 확인 필요(미연결 공급)", kind: "unlinked", db: unknown, contractedDb: 0, conversionRate: null });
    const supplied = byLead.size + quality.unlinkedRows, uncertain = supplyConversionUncertainty(quality) > 0;
    const staffRows = [...byStaff.values()].map(row => ({ ...row, conversionRate: !uncertain && row.db ? row.contractedDb / row.db * 100 : null }));
    return { supplied, retained: retainedCount, conversionRate: !uncertain && supplied ? retainedCount / supplied * 100 : null,
      staff: staffRows.sort((a, b) => b.db - a.db || a.name.localeCompare(b.name, "ko")), quality };
  }
  return { supplyCohort: cohort(false), matureCohort: { ...cohort(true), cutoff } };
}
