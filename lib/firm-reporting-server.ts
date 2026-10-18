import { requirePlatformUser } from "@/lib/platform/server";
import { summarizeFirmSupply, type FirmSupplyContract, type SupplyLedgerRow } from "@/lib/firm-reporting";
import type { CaseRecord, DbLead } from "@/lib/types";

type Admin = Awaited<ReturnType<typeof requirePlatformUser>>["admin"];
export async function readFirmRows(admin: Admin, table: string, firmId: string, columns: string): Promise<Record<string, any>[]> {
  const result: Record<string, any>[] = [];
  let after: string | undefined;
  for (;;) {
    let query = admin.from(table).select(columns).eq("law_firm_id", firmId).order("id", { ascending: true }).limit(500);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(`자료를 읽지 못했습니다. (${table})`);
    const rows = (data ?? []) as unknown as Record<string, any>[];
    if (!rows.length) return result;
    for (const row of rows) { if (row.law_firm_id !== firmId) throw new Error("FORBIDDEN"); result.push(row); }
    const next = String(rows[rows.length - 1].id);
    if (!next || next === after) throw new Error("자료 페이지를 확인할 수 없습니다.");
    after = next;
  }
}
export async function readFirmSupply(admin: Admin, firmId: string, start: string, end: string) {
  const [contracts, ledger, adjustments, cases, leads, staff] = await Promise.all([
    readFirmRows(admin, "platform_supply_contracts", firmId, "id,law_firm_id,product,category,unit_price,monthly_quantity,start_date,end_date,status,confirmed_at"),
    readFirmRows(admin, "lead_supply_ledger", firmId, "id,law_firm_id,lead_id,supplied_at,billable,unit_price_snapshot,classification,origin"),
    readFirmRows(admin, "platform_supply_adjustments", firmId, "id,law_firm_id,event_date,kind,quantity"),
    readFirmRows(admin, "app_cases", firmId, "id,law_firm_id,fromLeadId:data->>fromLeadId,status:data->>status,contractAmount:data->>contractAmount,contractDate:data->>contractDate"),
    readFirmRows(admin, "app_leads", firmId, "id,law_firm_id,assignedStaff:data->>assignedStaff,convertedCaseId:data->>convertedCaseId,source:data->>source"),
    readFirmRows(admin, "profiles", firmId, "id,law_firm_id,staff_name,display_name,platform_role,is_work_staff"),
  ]);
  const visibleContracts: FirmSupplyContract[] = contracts.map(row => ({ id: row.id, product: row.product, category: row.category, unitPrice: row.unit_price === null ? null : Number(row.unit_price), monthlyQuantity: row.monthly_quantity, startDate: row.start_date, endDate: row.end_date, status: row.status, confirmedAt: row.confirmed_at }));
  const replaced = adjustments.filter(row => row.kind === "replacement" && row.event_date >= start && row.event_date <= end).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const { data: commercial, error: commercialError } = await admin.from("platform_firm_commercial_profiles").select("law_firm_id,service_mode").eq("law_firm_id", firmId).maybeSingle();
  if (commercialError) throw new Error("로펌 이용 계약 분류를 읽지 못했습니다.");
  if (commercial && commercial.law_firm_id !== firmId) throw new Error("FORBIDDEN");
  const staffNames = staff.filter(row => row.is_work_staff === true && ["staff", "firm_admin"].includes(row.platform_role || "staff")).map(row => String(row.staff_name || row.display_name || "").trim()).filter(Boolean);
  const summary = summarizeFirmSupply(firmId, start, end, ledger as SupplyLedgerRow[], visibleContracts, replaced,
    cases.map(row => ({ id: row.id, _lawFirmId: row.law_firm_id, fromLeadId: row.fromLeadId, status: row.status, contractAmount: row.contractAmount, contractDate: row.contractDate } as CaseRecord)),
    undefined, leads.map(row => ({ id: row.id, _lawFirmId: row.law_firm_id, assignedStaff: row.assignedStaff, convertedCaseId: row.convertedCaseId, source: row.source } as DbLead)), staffNames);
  summary.serviceMode = commercial?.service_mode === "crm_only" ? "crm_only" : commercial?.service_mode === "db_supply" ? "db_supply" : "unregistered";
  if (summary.serviceMode === "crm_only") { summary.purchaseCost = 0; summary.knownPurchaseCost = 0; summary.missingPriceCount = 0; summary.contracts = []; summary.byLead = []; summary.monthly = summary.monthly.map(row => ({ ...row, purchaseCost: 0 })); }
  if (summary.serviceMode === "unregistered") summary.purchaseCost = null;
  return summary;
}
