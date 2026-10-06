import { NextRequest, NextResponse } from "next/server";
import { requirePlatformUser, platformError, writePlatformAudit } from "@/lib/platform/server";

async function firmCode(admin: any) {
  const { data, error } = await admin.rpc("generate_firm_code");
  if (error || !data) throw error || new Error("로펌 ID 생성에 실패했습니다.");
  return String(data);
}

const since24h = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function kstMonthNow() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

function validMonth(value: string | null) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : kstMonthNow();
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  return {
    start: new Date(`${month}-01T00:00:00+09:00`).toISOString(),
    end: new Date(`${shiftMonth(month, 1)}-01T00:00:00+09:00`).toISOString(),
  };
}

async function fetchLedgerRange(admin: any, start: string, end: string) {
  const result: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from("lead_supply_ledger")
      .select("law_firm_id,lead_id,classification,billable,unit_price_snapshot,origin,supplied_at")
      .neq("origin", "backfill")
      .gte("supplied_at", start)
      .lt("supplied_at", end)
      .order("supplied_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    result.push(...rows);
    if (rows.length < pageSize) break;
  }
  return result;
}

async function fetchLeadConversionMap(admin: any, leadIds: string[]) {
  const map = new Map<string, boolean>();
  const unique = Array.from(new Set(leadIds.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const { data, error } = await admin.from("app_leads").select("id,data").in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) map.set(String(row.id), Boolean(row.data?.convertedCaseId || row.data?.convertedClientId));
  }
  return map;
}

function adSpendForMonth(settings: any, month: string) {
  const entries = Array.isArray(settings?.adSpendEntries) ? settings.adSpendEntries : [];
  return entries.reduce((sum: number, row: any) => {
    const date = String(row?.date || "");
    const amount = Number(row?.amount || 0);
    return sum + (date.startsWith(month) && Number.isFinite(amount) ? amount : 0);
  }, 0);
}

function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requirePlatformUser(request, ["super_admin"]);
    const selectedMonth = validMonth(request.nextUrl.searchParams.get("month"));
    const trendMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(selectedMonth, i - 5));
    const trendStart = monthBounds(trendMonths[0]).start;
    const selectedEnd = monthBounds(selectedMonth).end;

    const [{ data: firms, error }, { data: settingsRows, error: settingsError }, ledgerRows] = await Promise.all([
      admin.from("law_firms").select("*").order("created_at", { ascending: false }),
      admin.from("firm_settings").select("law_firm_id,value").eq("key", "management_analytics_v1"),
      fetchLedgerRange(admin, trendStart, selectedEnd),
    ]);
    if (error) throw error;
    if (settingsError) throw settingsError;

    const conversionMap = await fetchLeadConversionMap(admin, ledgerRows.map((row: any) => String(row.lead_id || "")).filter(Boolean));
    const settingsByFirm = new Map((settingsRows ?? []).map((row: any) => [String(row.law_firm_id), row.value ?? {}]));
    const selectedBounds = monthBounds(selectedMonth);
    const selectedLedger = ledgerRows.filter((row: any) => row.supplied_at >= selectedBounds.start && row.supplied_at < selectedBounds.end);

    const rows = await Promise.all((firms ?? []).map(async (firm: any) => {
      const [members, leads, cases, sheets, metaAccounts, duplicateImports, ingestErrors, queuePending, queueFailed, supply24h, billable24h, activity24h, latestActivity] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).eq("is_active", true),
        admin.from("app_leads").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id),
        admin.from("app_cases").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id),
        admin.from("firm_sheet_integrations").select("id,last_received_at,active").eq("law_firm_id", firm.id).eq("active", true).order("last_received_at", { ascending: false, nullsFirst: false }).limit(1),
        admin.from("firm_meta_accounts").select("id,last_success_at,last_error_at,last_error_message,active").eq("law_firm_id", firm.id).eq("active", true),
        admin.from("app_lead_imports").select("external_key", { count: "exact", head: true }).eq("law_firm_id", firm.id).in("classification", ["duplicate_external", "duplicate_meta", "duplicate_phone"]),
        admin.from("integration_ingest_errors").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).gte("created_at", since24h()),
        admin.from("meta_event_queue").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).in("status", ["pending", "processing"]),
        admin.from("meta_event_queue").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).eq("status", "failed"),
        admin.from("lead_supply_ledger").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).neq("origin", "backfill").gte("supplied_at", since24h()),
        admin.from("lead_supply_ledger").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).eq("billable", true).neq("origin", "backfill").gte("supplied_at", since24h()),
        admin.from("app_change_logs").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).gte("created_at", since24h()),
        admin.from("app_change_logs").select("id,data,created_at").eq("law_firm_id", firm.id).order("created_at", { ascending: false }).limit(1),
      ]);
      const activeMeta = metaAccounts.data ?? [];
      const latestMetaSuccess = activeMeta.map((x:any)=>x.last_success_at).filter(Boolean).sort().reverse()[0] ?? null;
      const latestMetaError = activeMeta.map((x:any)=>x.last_error_at).filter(Boolean).sort().reverse()[0] ?? null;
      const last = latestActivity.data?.[0] ?? null;
      return {
        ...firm,
        memberCount: members.count ?? 0,
        leadCount: leads.count ?? 0,
        caseCount: cases.count ?? 0,
        duplicateCount: duplicateImports.count ?? 0,
        ingestError24hCount: ingestErrors.count ?? 0,
        metaPendingCount: queuePending.count ?? 0,
        metaFailedCount: queueFailed.count ?? 0,
        supply24hCount: supply24h.count ?? 0,
        billable24hCount: billable24h.count ?? 0,
        activity24hCount: activity24h.count ?? 0,
        lastActivityAt: last?.created_at ?? null,
        lastActivityStaff: last?.data?.staff ?? null,
        lastActivityAction: last ? `${last.data?.category ?? "업무"} · ${last.data?.action ?? "변경"}` : null,
        activeMetaAccountCount: activeMeta.length,
        lastSheetReceivedAt: sheets.data?.[0]?.last_received_at ?? null,
        lastMetaSuccessAt: latestMetaSuccess,
        lastMetaErrorAt: latestMetaError,
      };
    }));

    const firmNameById = new Map((firms ?? []).map((firm:any)=>[String(firm.id), firm.name]));
    const platformFirmRows = (firms ?? []).map((firm: any) => {
      const firmId = String(firm.id);
      const supply = selectedLedger.filter((row: any) => String(row.law_firm_id) === firmId);
      const supplied = supply.length;
      const billableRows = supply.filter((row: any) => row.billable === true);
      const billable = billableRows.length;
      const reentry = supply.filter((row: any) => row.classification === "reentry").length;
      const converted = supply.filter((row: any) => row.lead_id && conversionMap.get(String(row.lead_id)) === true).length;
      const billingRevenue = billableRows.reduce((sum: number, row: any) => sum + Number(row.unit_price_snapshot || 0), 0);
      const adSpend = adSpendForMonth(settingsByFirm.get(firmId), selectedMonth);
      const profit = billingRevenue - adSpend;
      return {
        lawFirmId: firmId,
        firmName: firm.name,
        supplied,
        billable,
        reentry,
        converted,
        conversionRate: pct(converted, supplied),
        avgSalePrice: billable ? Math.round(billingRevenue / billable) : 0,
        billingRevenue,
        adSpend,
        dbCost: supplied ? Math.round(adSpend / supplied) : 0,
        profit,
        margin: billingRevenue ? Math.round((profit / billingRevenue) * 1000) / 10 : 0,
      };
    });

    const trend = trendMonths.map((month) => {
      const bounds = monthBounds(month);
      const monthLedger = ledgerRows.filter((row: any) => row.supplied_at >= bounds.start && row.supplied_at < bounds.end);
      const billableRows = monthLedger.filter((row: any) => row.billable === true);
      const billingRevenue = billableRows.reduce((sum: number, row: any) => sum + Number(row.unit_price_snapshot || 0), 0);
      const adSpend = (firms ?? []).reduce((sum: number, firm: any) => sum + adSpendForMonth(settingsByFirm.get(String(firm.id)), month), 0);
      const converted = monthLedger.filter((row: any) => row.lead_id && conversionMap.get(String(row.lead_id)) === true).length;
      return {
        month,
        supplied: monthLedger.length,
        billable: billableRows.length,
        converted,
        conversionRate: pct(converted, monthLedger.length),
        billingRevenue,
        adSpend,
        profit: billingRevenue - adSpend,
      };
    });

    const totalRevenue = platformFirmRows.reduce((sum: number, row: any) => sum + row.billingRevenue, 0);
    const totalAdSpend = platformFirmRows.reduce((sum: number, row: any) => sum + row.adSpend, 0);
    const totalSupply = platformFirmRows.reduce((sum: number, row: any) => sum + row.supplied, 0);
    const totalBillable = platformFirmRows.reduce((sum: number, row: any) => sum + row.billable, 0);
    const totalConverted = platformFirmRows.reduce((sum: number, row: any) => sum + row.converted, 0);
    const totalProfit = totalRevenue - totalAdSpend;
    const platformAnalytics = {
      month: selectedMonth,
      totals: {
        billingRevenue: totalRevenue,
        adSpend: totalAdSpend,
        profit: totalProfit,
        margin: totalRevenue ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : 0,
        supplied: totalSupply,
        billable: totalBillable,
        billableRate: pct(totalBillable, totalSupply),
        converted: totalConverted,
        conversionRate: pct(totalConverted, totalSupply),
        dbCost: totalSupply ? Math.round(totalAdSpend / totalSupply) : 0,
        avgSalePrice: totalBillable ? Math.round(totalRevenue / totalBillable) : 0,
      },
      firms: platformFirmRows,
      trend,
      basis: {
        revenue: "lead_supply_ledger의 과금대상 DB × 공급 당시 unit_price_snapshot 합계",
        adSpend: "각 로펌 정산설정에 입력된 해당 월 광고비(adSpendEntries) 합계",
        conversion: "해당 월 공급 DB 중 고객/계약 전환 ID가 생성된 DB 기준",
      },
    };

    const [{ data: auditLogs, error: auditError }, { data: operationalLogs, error: operationError }] = await Promise.all([
      admin.from("platform_audit_logs")
        .select("id,actor_name,actor_role,law_firm_id,action,target_type,target_id,detail,created_at")
        .order("created_at", { ascending: false }).limit(100),
      admin.from("app_change_logs")
        .select("id,law_firm_id,data,created_at")
        .order("created_at", { ascending: false }).limit(100),
    ]);
    if (auditError) throw auditError;
    if (operationError) throw operationError;

    const recentActivities = (operationalLogs ?? []).map((row:any)=>({
      id: row.id,
      lawFirmId: row.law_firm_id,
      firmName: firmNameById.get(String(row.law_firm_id)) ?? "알 수 없는 로펌",
      category: row.data?.category ?? "업무",
      action: row.data?.action ?? "변경",
      targetName: row.data?.targetName ?? "-",
      detail: row.data?.detail ?? "",
      staff: row.data?.staff ?? "시스템",
      at: row.data?.at ?? row.created_at,
    }));

    return NextResponse.json({ firms: rows, auditLogs: auditLogs ?? [], recentActivities, platformAnalytics });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    const body = await request.json();
    const name = String(body.name || "").trim();
    const representativeName = String(body.representativeName || "").trim() || null;
    const businessNumber = String(body.businessNumber || "").trim() || null;
    const phone = String(body.phone || "").trim() || null;
    if (!name) throw new Error("로펌명을 입력해주세요.");
    const adminEmail = String(body.adminEmail || "").trim().toLowerCase();
    const adminName = String(body.adminName || "").trim();
    const adminPassword = String(body.adminPassword || "");
    if (!adminEmail.includes("@")) throw new Error("초기 로펌 관리자 이메일을 입력해주세요.");
    if (!adminName) throw new Error("초기 로펌 관리자 이름을 입력해주세요.");
    if (adminPassword.length < 8) throw new Error("초기 로펌 관리자 임시 비밀번호는 8자 이상이어야 합니다.");

    const code = await firmCode(admin);
    const { data: firm, error: firmError } = await admin.from("law_firms").insert({
      firm_code: code,
      name,
      representative_name: representativeName,
      business_number: businessNumber,
      phone,
      status: "active",
    }).select("*").single();
    if (firmError) throw firmError;

    let adminUserId: string | null = null;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { display_name: adminName, staff_name: adminName },
    });
    if (createError || !created.user) {
      await admin.from("law_firms").delete().eq("id", firm.id);
      throw createError || new Error("로펌 관리자 계정 생성에 실패했습니다.");
    }
    adminUserId = created.user.id;
    const { error: profileError } = await admin.from("profiles").update({
      email: adminEmail,
      display_name: adminName,
      staff_name: adminName,
      role: "admin",
      platform_role: "firm_admin",
      law_firm_id: firm.id,
      is_active: true,
      is_work_staff: true,
      auto_assign_leads: true,
      lead_assignment_order: 10,
      updated_at: new Date().toISOString(),
    }).eq("id", created.user.id);
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      await admin.from("law_firms").delete().eq("id", firm.id);
      throw profileError;
    }

    await writePlatformAudit(admin, request, profile, { lawFirmId: firm.id, action: "firm.create", targetType: "law_firm", targetId: firm.id, detail: { firmCode: firm.firm_code, name: firm.name, adminUserId, adminEmail, adminName } });
    return NextResponse.json({ ok: true, firm, adminUserId });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    const body = await request.json();
    const id = String(body.id || "");
    if (!id) throw new Error("로펌 ID가 없습니다.");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (body.status === "active" || body.status === "suspended") patch.status = body.status;
    if (typeof body.representativeName === "string") patch.representative_name = body.representativeName.trim() || null;
    if (typeof body.businessNumber === "string") patch.business_number = body.businessNumber.trim() || null;
    if (typeof body.phone === "string") patch.phone = body.phone.trim() || null;
    const { data, error } = await admin.from("law_firms").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    await writePlatformAudit(admin, request, profile, { lawFirmId: id, action: "firm.update", targetType: "law_firm", targetId: id, detail: { patch } });
    return NextResponse.json({ ok: true, firm: data });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
