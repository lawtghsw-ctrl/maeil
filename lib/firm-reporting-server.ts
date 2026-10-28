import { requirePlatformUser } from "@/lib/platform/server";
import { summarizeFirmSupply, type FirmSupplyContract, type SupplyLedgerRow } from "@/lib/firm-reporting";
import type { CaseRecord, DbLead } from "@/lib/types";
import { kstPerformanceDate, performanceRange } from "@/lib/performance/firm";

type Admin = Awaited<ReturnType<typeof requirePlatformUser>>["admin"];

/** Cumulative exports do not need the prior-period comparison used by performance pages. */
export function firmSupplyRange(start: string, end: string, cumulative = false): { start: string; end: string } {
  if (!cumulative) return performanceRange(start, end);
  const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && kstPerformanceDate(value) === value;
  if (!validDay(start) || !validDay(end) || start > end) {
    throw new Error("시작일과 종료일을 YYYY-MM-DD 형식의 올바른 기간으로 선택해주세요.");
  }
  const maxEnd = `${new Date().getUTCFullYear() + 1}-12-31`;
  if (end < "1900-01-01" || end > maxEnd) throw new Error("누적 실적 기준일을 확인해주세요.");
  return { start: `${start.slice(0, 7)}-01`, end };
}
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
export async function readFirmSupply(admin: Admin, firmId: string, start: string, end: string, cumulative = false) {
  if (cumulative) ({ start, end } = firmSupplyRange(start, end, true));
  const [contracts, ledger, adjustments, cases, leads, staff, payments] = await Promise.all([
    readFirmRows(admin, "platform_supply_contracts", firmId, "id,law_firm_id,product,category,unit_price,monthly_quantity,start_date,end_date,status,confirmed_at"),
    readFirmRows(admin, "lead_supply_ledger", firmId, "id,law_firm_id,lead_id,supplied_at,billable,unit_price_snapshot,classification,origin"),
    readFirmRows(admin, "platform_supply_adjustments", firmId, "id,law_firm_id,event_date,kind,quantity"),
    readFirmRows(admin, "app_cases", firmId, "id,law_firm_id,fromLeadId:data->>fromLeadId,status:data->>status,contractAmount:data->>contractAmount,contractDate:data->>contractDate"),
    readFirmRows(admin, "app_leads", firmId, "id,law_firm_id,receivedAt:data->>receivedAt,assignedStaff:data->>assignedStaff,convertedCaseId:data->>convertedCaseId,source:data->>source"),
    readFirmRows(admin, "profiles", firmId, "id,law_firm_id,staff_name,display_name,platform_role,is_work_staff"),
    cumulative ? readFirmRows(admin, "app_installments", firmId, "id,law_firm_id,paidDate:data->>paidDate,status:data->>status") : Promise.resolve([]),
  ]);
  if (cumulative) {
    // Derive real history on the server, never from a caller-supplied epoch.
    // Empty reports begin in the selected month. Fail, never truncate, bad history.
    start = `${end.slice(0, 7)}-01`;
    const sourceDates = [...ledger.map(row=>row.supplied_at), ...cases.map(row=>row.contractDate),
      ...leads.map(row=>row.receivedAt), ...adjustments.map(row=>row.event_date),
      ...payments.filter(row=>row.status==="완료").map(row=>row.paidDate)];
    for (const value of sourceDates) {
      const day = kstPerformanceDate(value);
      if (day && day <= end && day < start) start = `${day.slice(0, 7)}-01`;
    }
    const months = (Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7))+1;
    if (months > 1200) throw new Error("집계 원본 날짜가 100년 범위를 초과합니다. 최초 기록일을 확인해주세요.");
  }
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
