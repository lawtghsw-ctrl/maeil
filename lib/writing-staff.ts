import { WRITING_STAFF_PERMISSIONS, type PermissionKey, type PermissionMap } from "@/lib/permissions";
import { DB_DETAIL_STAGE_TRACK_OF, DB_LEAD_DEFAULT_STAGE_BY_STATUS, type CaseRecord, type Client, type DbLead, type Installment, type ScheduleItem } from "@/lib/types";
import { caseConsultationLead } from "@/lib/case-consultation";

type WritingProfile = {
  role?: string; platformRole?: string; platform_role?: string;
  isActive?: boolean; lawFirmId?: string; staffName?: string; displayName?: string; permissions?: PermissionMap;
};

export function isWritingStaff(profile: WritingProfile | null | undefined): boolean {
  return profile?.role === "staff" && !["super_admin", "firm_admin"].includes(profile.platformRole ?? profile.platform_role ?? "staff") && profile.permissions?.["staff.writer"] === true;
}

export function isWritingLead(lead: Pick<DbLead, "detailStage" | "status">): boolean {
  const stage = lead.detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status];
  return ["착수", "서류", "법원", "워크아웃"].includes(DB_DETAIL_STAGE_TRACK_OF[stage]);
}

export function writingPathAllowed(pathname: string): boolean {
  return ["/db", "/cases"].some(path => pathname === path || pathname.startsWith(`${path}/`));
}

export function writingPermission(permission: PermissionKey): boolean {
  return WRITING_STAFF_PERMISSIONS[permission] === true;
}

/** Only the new, same-firm shared scope. Never substitutes for write permission. */
export function isSharedLongAbsentLead(profile: WritingProfile | null | undefined, lead: DbLead, can: (permission: PermissionKey) => boolean): boolean {
  return !!profile && profile.isActive === true && !isWritingStaff(profile)
    && !!profile.lawFirmId && lead._lawFirmId === profile.lawFirmId && can("db.view")
    && (lead.detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status]) === "장기부재";
}

export function isSharedLeadReadOnly(profile: WritingProfile | null | undefined, lead: DbLead, can: (permission: PermissionKey) => boolean, currentStaff?: string): boolean {
  if (!isSharedLongAbsentLead(profile, lead, can) || can("db.view_all")) return false;
  const names = [currentStaff, profile?.staffName, profile?.displayName].map(name => name?.trim()).filter(Boolean);
  return !names.includes(lead.assignedStaff?.trim());
}

export function canReadLeadForProfile(profile: WritingProfile | null | undefined, lead: DbLead, can: (permission: PermissionKey) => boolean, currentStaff?: string): boolean {
  if (!can("db.view") || (profile?.platformRole !== "super_admin" && profile?.lawFirmId && lead._lawFirmId && profile.lawFirmId !== lead._lawFirmId)) return false;
  if (isWritingStaff(profile) && !isWritingLead(lead)) return false;
  if (can("db.view_all") || isSharedLongAbsentLead(profile, lead, can)) return true;
  const names = [currentStaff, profile?.staffName, profile?.displayName].map(name => name?.trim()).filter(Boolean);
  return names.includes(lead.assignedStaff?.trim());
}

export function writingCaseAllowed(record: CaseRecord, clients: readonly Client[], leads: readonly DbLead[], firmId: string | undefined): boolean {
  const client = clients.find(row => row.id === record.clientId);
  if (!client) return false;
  const lead = caseConsultationLead(record, client, leads, firmId);
  return !!lead && isWritingLead(lead);
}

export function writingWorkspaceData(data: { leads: DbLead[]; clients: Client[]; cases: CaseRecord[]; installments: Installment[]; scheduleItems: ScheduleItem[] }, firmId: string | undefined) {
  const sameFirm = (row: { _lawFirmId?: string }) => !!firmId && (!row._lawFirmId || row._lawFirmId === firmId);
  const leads = data.leads.filter(lead => sameFirm(lead) && isWritingLead(lead));
  const cases = data.cases.filter(record => sameFirm(record) && writingCaseAllowed(record, data.clients, data.leads, firmId));
  const clientIds = new Set(cases.map(record => record.clientId));
  const clients = data.clients.filter(client => {
    if (!sameFirm(client)) return false;
    const linked = client.fromLeadId
      ? data.leads.filter(lead => lead.id === client.fromLeadId && sameFirm(lead))
      : data.leads.filter(lead => lead.convertedClientId === client.id && sameFirm(lead));
    return linked.length === 1 ? isWritingLead(linked[0]) : !client.fromLeadId && linked.length === 0 && clientIds.has(client.id);
  });
  const allowedClientIds = new Set(clients.map(client => client.id));
  const allowedCases = cases.filter(record => allowedClientIds.has(record.clientId));
  const caseIds = new Set(allowedCases.map(record => record.id));
  return { leads, clients, cases: allowedCases, installments: data.installments.filter(row => sameFirm(row) && caseIds.has(row.caseId)), scheduleItems: [] as ScheduleItem[] };
}
