import type { createAdminClient } from "@/lib/supabase/admin";
import { readOperationsMeta } from "./operations-meta";
import { buildOperationsReport, opsBounds, opsDate, shiftOpsMonth, validateOperationsConfig, type OperationSale, type CommercialProfile, type OperationFirm, type OperationLedger, type OperationsInput, type OperationsMonth, type OperationsResponse, type SupplyContract, type SupplyAdjustment, type OperationsClosing, type OperationLead, type OperationCase } from "./operations";

type Admin = ReturnType<typeof createAdminClient>;
type Result = { data: unknown[] | null; error: { message: string } | null };
export async function allOperationRows<T>(page: (from: number, to: number) => PromiseLike<Result>, identity: (row: T) => string): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>();
  for (let offset = 0; ;) {
    const { data, error } = await page(offset, offset + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    for (const row of data as T[]) { const id = identity(row); if (!id || seen.has(id)) throw new Error("집계 중 원장이 변경되었습니다. 다시 조회해주세요."); seen.add(id); rows.push(row); }
    offset += data.length;
  }
}
function legacyAds(rows: Array<{ law_firm_id: string; value: unknown }>, months: string[]): OperationsInput["adSpend"] {
  return rows.flatMap(row => months.map(month => {
    const current = (row.value && typeof row.value === "object" ? row.value : {}) as Record<string, any>;
    const snapshot = current.monthClosings?.[month]?.snapshot;
    const config = snapshot && typeof snapshot === "object" ? snapshot : current;
    const entries = (Array.isArray(config.adSpendEntries) ? config.adSpendEntries : []).filter((e: any) => typeof e?.date === "string" && e.date.slice(0, 7) === month);
    let total = 0; let valid = entries.length > 0;
    for (const entry of entries) {
      const value = entry.amount, amount = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
      if (!opsDate(entry.date) || !Number.isSafeInteger(amount) || amount < 0) { valid = false; break; }
      total += amount; if (!Number.isSafeInteger(total)) throw new Error("광고비 합계가 계산 범위를 초과했습니다.");
    }
    return { firmId: row.law_firm_id, month, amount: valid ? total : null, source: (snapshot ? "month_closing" : entries.length ? "firm_settings" : "missing") as "month_closing" | "firm_settings" | "missing" };
  }));
}
export async function loadOperations(admin: Admin, month: string, includeDemo: boolean, signal?: AbortSignal, now = new Date(), ledgerOffset = 0): Promise<OperationsResponse> {
  const months = Array.from({ length: 6 }, (_, i) => shiftOpsMonth(month, i - 5));
  const end = shiftOpsMonth(month, 1) + "-01T00:00:00+09:00";
  const abort = (q: any) => signal ? q.abortSignal(signal) : q;
  const [firms, contracts, adjustments, ledger, monthRows, settingRows, closings, commercialProfiles, sales, metaCosts, adSources, stageRows, caseRows] = await Promise.all([
    allOperationRows<OperationFirm>((f, t) => abort(admin.from("law_firms").select("id,name,status,firm_code,billing_type").order("id").range(f, t)), r => r.id),
    allOperationRows<SupplyContract>((f, t) => abort(admin.from("platform_supply_contracts").select("*").order("id").range(f, t)), r => r.id),
    allOperationRows<SupplyAdjustment>((f, t) => abort(admin.from("platform_supply_adjustments").select("id,law_firm_id,contract_id,ledger_id,event_date,kind,quantity,amount,reason,created_at").gte("event_date", months[0] + "-01").lte("event_date", opsBounds(month).end).order("id").range(f, t)), r => r.id),
    allOperationRows<OperationLedger>((f, t) => abort(admin.from("lead_supply_ledger").select("id,law_firm_id,lead_id,classification,billable,billing_type,unit_price_snapshot,supplied_at,origin,supply_contract_id,supply_contract_revision,ad_source_id").neq("origin", "backfill").lt("supplied_at", end).order("id").range(f, t)), r => r.id),
    allOperationRows<OperationsMonth>((f, t) => abort(admin.from("platform_operations_months").select("*").gte("month", months[0]).lte("month", month).order("month").range(f, t)), r => r.month),
    allOperationRows<{ law_firm_id: string; value: unknown }>((f, t) => abort(admin.from("firm_settings").select("law_firm_id,value").eq("key", "management_analytics_v1").order("law_firm_id").range(f, t)), r => r.law_firm_id),
    allOperationRows<OperationsClosing>((f, t) => abort(admin.from("platform_operations_closings").select("id,month,action,created_at,actor_id").eq("month", month).order("created_at", { ascending: false }).order("id").range(f, t)), r => r.id),
    allOperationRows<CommercialProfile>((f, t) => abort(admin.from("platform_firm_commercial_profiles").select("*").order("law_firm_id").range(f, t)), r => r.law_firm_id),
    allOperationRows<OperationSale>((f, t) => abort(admin.from("platform_sales_leads").select("id,stage,data,proposal,signed_at,law_firm_id").order("id").range(f, t)), r => r.id),
    readOperationsMeta(admin, months, allOperationRows, signal, now),
    allOperationRows<{ id: string; law_firm_id: string; name: string }>((f, t) => abort(admin.from("ad_sources").select("id,law_firm_id,name").order("id").range(f, t)), r => r.id),
    allOperationRows<any>((f, t) => abort(admin.from("app_leads").select("id,law_firm_id,assignedStaff:data->>assignedStaff,convertedClientId:data->>convertedClientId,convertedCaseId:data->>convertedCaseId,detailStage:data->>detailStage,status:data->>status,stageUpdatedAt:data->>stageUpdatedAt").order("id").range(f, t)), r => r.id),
    // Both explicit fromLeadId links and reverse convertedCaseId links are
    // needed. Do not limit contracts to pointers present in this month's DBs.
    allOperationRows<any>((f, t) => abort(admin.from("app_cases").select("id,law_firm_id,fromLeadId:data->>fromLeadId,status:data->>status,contractAmount:data->>contractAmount").order("id").range(f, t)), r => r.id),
  ]);
  for (const row of monthRows) row.config = validateOperationsConfig(row.config);
  const leadIds = [...new Set(ledger.filter(l => l.lead_id && Date.parse(l.supplied_at) >= Date.parse(months[0] + "-01T00:00:00+09:00")).map(l => l.lead_id!))];
  const currentStageLeads: OperationLead[] = stageRows.map(({ id, law_firm_id, ...data }) => ({ id, law_firm_id, data }));
  const leadsByFirmId = new Map(currentStageLeads.map(row => [`${row.law_firm_id}\0${row.id}`, row]));
  const cases: OperationCase[] = caseRows.map(({ id, law_firm_id, ...data }) => ({ id, law_firm_id, data }));
  for (let i = 0; i < leadIds.length; i += 100) {
    const rows = await allOperationRows<any>((f, t) => abort(admin.from("app_leads").select("id,law_firm_id,assignedStaff:data->>assignedStaff,convertedCaseId:data->>convertedCaseId,convertedClientId:data->>convertedClientId,detailStage:data->>detailStage,status:data->>status,stageUpdatedAt:data->>stageUpdatedAt,contactLog:data->contactLog").in("id", leadIds.slice(i, i + 100)).order("id").range(f, t)), r => r.id);
    for (const { id, law_firm_id, ...data } of rows) leadsByFirmId.set(`${law_firm_id}\0${id}`, { id, law_firm_id, data });
  }
  const leads = [...leadsByFirmId.values()];
  const input: OperationsInput = { firms, contracts, adjustments, ledger, leads, cases, monthRows, adSpend: legacyAds(settingRows, months), commercialProfiles, sales, metaCosts, adSources, currentStageLeads };
  const selectedMonth = monthRows.find(m => m.month === month) ?? null;
  const report = !includeDemo && selectedMonth?.closed_at && selectedMonth.snapshot ? structuredClone(selectedMonth.snapshot) : buildOperationsReport(input, month, includeDemo, now);
  report.trend = months.map(m => {
    const saved = monthRows.find(row => row.month === m);
    const r = !includeDemo && saved?.closed_at && saved.snapshot ? saved.snapshot : buildOperationsReport(input, m, includeDemo, now);
    return { month: m, revenue: r.totals.revenue, adSpend: r.totals.adSpend, profit: r.totals.profit };
  });
  const selectedLedger = ledger.filter(l => Date.parse(l.supplied_at) >= Date.parse(month + "-01T00:00:00+09:00")).sort((a, b) => b.supplied_at.localeCompare(a.supplied_at) || a.id.localeCompare(b.id));
  return { firms, contracts, adjustments: adjustments.filter(a => a.event_date.slice(0, 7) === month), ledger: selectedLedger.slice(ledgerOffset, ledgerOffset + 500), ledgerTruncated: selectedLedger.length > ledgerOffset + 500, ledgerOffset, ledgerCount: selectedLedger.length, month: selectedMonth, closings, report, commercialProfiles };
}
