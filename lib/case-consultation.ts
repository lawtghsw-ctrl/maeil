import type { CaseRecord, Client, DbLead } from "@/lib/types";

/** Resolve a stored relationship only; names/phones never establish a link. */
export function caseConsultationLead(
  record: CaseRecord,
  client: Client | undefined,
  leads: readonly DbLead[],
  firmId: string | undefined,
): DbLead | undefined {
  if (!firmId || (record._lawFirmId && record._lawFirmId !== firmId)) return undefined;
  if (client && (client.id !== record.clientId || (client._lawFirmId && client._lawFirmId !== firmId))) return undefined;
  if (record.fromLeadId && client?.fromLeadId && record.fromLeadId !== client.fromLeadId) return undefined;
  const sameFirm = (lead: DbLead) => !lead._lawFirmId || lead._lawFirmId === firmId;
  const directId = record.fromLeadId || client?.fromLeadId;
  // An explicit but missing/inaccessible original DB is not replaced by another
  // lead that happens to claim this case or share a customer name/phone.
  const matches = directId
    ? leads.filter(lead => lead.id === directId && sameFirm(lead))
    : leads.filter(lead => lead.convertedCaseId === record.id && sameFirm(lead));
  return matches.length === 1 ? matches[0] : undefined;
}
