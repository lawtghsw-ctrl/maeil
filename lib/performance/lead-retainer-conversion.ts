import type { CaseRecord, DbLead } from "../types";

type RetainerLead = Pick<DbLead, "id" | "convertedCaseId" | "_lawFirmId">;
type RetainerCase = Pick<CaseRecord, "id" | "fromLeadId" | "contractAmount" | "status" | "_lawFirmId">;

function sameFirm(lead: RetainerLead, record: RetainerCase): boolean {
  return !lead._lawFirmId || !record._lawFirmId || lead._lawFirmId === record._lawFirmId;
}

/** Current retained lead identities, independent of intake/contract date and staff.
 * Explicit case.fromLeadId wins over a lead's convertedCaseId. The latter is
 * accepted only for an otherwise unlinked case claimed by exactly one lead.
 * Client identity alone never establishes a lead-to-contract relationship.
 * Duplicate IDs use the first supplied row, matching the performance report;
 * neither input array is modified.
 */
export function getRetainedLeadIds(leads: readonly RetainerLead[], cases: readonly RetainerCase[]): Set<string> {
  const leadById = new Map<string, RetainerLead>();
  const caseById = new Map<string, RetainerCase>();
  for (const lead of leads) if (!leadById.has(lead.id)) leadById.set(lead.id, lead);
  for (const record of cases) if (!caseById.has(record.id)) caseById.set(record.id, record);
  const fallbackClaims = new Map<string, string | null>();
  for (const lead of leadById.values()) {
    if (!lead.convertedCaseId) continue;
    fallbackClaims.set(lead.convertedCaseId, fallbackClaims.has(lead.convertedCaseId) ? null : lead.id);
  }

  const retained = new Set<string>();
  for (const record of caseById.values()) {
    const amount = Number(record.contractAmount);
    if (!Number.isFinite(amount) || amount <= 0 || record.status === "취하") continue;
    const leadId = record.fromLeadId || fallbackClaims.get(record.id);
    if (!leadId) continue;
    const lead = leadById.get(leadId);
    if (lead && sameFirm(lead, record)) retained.add(lead.id);
  }
  return retained;
}
