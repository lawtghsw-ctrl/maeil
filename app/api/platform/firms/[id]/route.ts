import { NextRequest, NextResponse } from "next/server";
import { requirePlatformUser, platformError } from "@/lib/platform/server";

function startOfTodayIso() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`).toISOString();
}

function since24hIso() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { admin } = await requirePlatformUser(request, ["super_admin"]);
    const lawFirmId = String(context.params.id || "").trim();
    if (!lawFirmId) throw new Error("로펌 ID가 없습니다.");

    const { data: firm, error: firmError } = await admin.from("law_firms").select("*").eq("id", lawFirmId).maybeSingle();
    if (firmError || !firm) throw firmError || new Error("로펌 정보를 찾지 못했습니다.");

    const today = startOfTodayIso();
    const since24h = since24hIso();
    const [
      membersRes,
      leadsCountRes,
      leadsTodayRes,
      casesCountRes,
      clientsCountRes,
      recentLeadsRes,
      recentCasesRes,
      changesRes,
      auditRes,
      sheetsRes,
      metaRes,
      sourcesRes,
      rulesRes,
      queuePendingRes,
      queueFailedRes,
      ingestErrorsRes,
      supply24Res,
      billable24Res,
      supplyRecentRes,
      duplicateRes,
      reentryRes,
    ] = await Promise.all([
      admin.from("profiles").select("id,email,display_name,staff_name,platform_role,role,is_active,is_work_staff,auto_assign_leads,lead_assignment_order,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("app_leads").select("id", { count: "exact", head: true }).eq("law_firm_id", lawFirmId),
      admin.from("app_leads").select("id", { count: "exact", head: true }).eq("law_firm_id", lawFirmId).gte("created_at", today),
      admin.from("app_cases").select("id", { count: "exact", head: true }).eq("law_firm_id", lawFirmId),
      admin.from("app_clients").select("id", { count: "exact", head: true }).eq("law_firm_id", lawFirmId),
      admin.from("app_leads").select("id,data,created_at,ad_source_id,meta_account_id,meta_lead_id").eq("law_firm_id", lawFirmId).order("created_at", { ascending: false }).limit(30),
      admin.from("app_cases").select("id,data,created_at").eq("law_firm_id", lawFirmId).order("created_at", { ascending: false }).limit(20),
      admin.from("app_change_logs").select("id,data,created_at").eq("law_firm_id", lawFirmId).order("created_at", { ascending: false }).limit(80),
      admin.from("platform_audit_logs").select("id,actor_name,actor_role,action,target_type,target_id,detail,created_at").eq("law_firm_id", lawFirmId).order("created_at", { ascending: false }).limit(80),
      admin.from("firm_sheet_integrations").select("id,name,spreadsheet_id,sheet_name,active,last_received_at,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("firm_meta_accounts").select("id,name,business_id,ad_account_id,page_id,dataset_id,test_event_code,active,last_success_at,last_error_at,last_error_message,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("ad_sources").select("id,name,source_key,sheet_integration_id,meta_account_id,meta_form_id,campaign_id,adset_id,ad_id,active,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("firm_meta_event_rules").select("id,trigger_type,trigger_value,event_name,enabled,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("meta_event_queue").select("id", { count: "exact", head: true }).eq("law_firm_id", lawFirmId).in("status", ["pending", "processing"]),
      admin.from("meta_event_queue").select("id", { count: "exact", head: true }).eq("law_firm_id", lawFirmId).eq("status", "failed"),
      admin.from("integration_ingest_errors").select("id,source_key,sheet_id,sheet_name,form_id,external_key,row_number,reason,created_at").eq("law_firm_id", lawFirmId).gte("created_at", since24h).order("created_at", { ascending: false }).limit(50),
      admin.from("lead_supply_ledger").select("id", { count: "exact", head: true }).eq("law_firm_id", lawFirmId).neq("origin", "backfill").gte("supplied_at", since24h),
      admin.from("lead_supply_ledger").select("id", { count: "exact", head: true }).eq("law_firm_id", lawFirmId).eq("billable", true).neq("origin", "backfill").gte("supplied_at", since24h),
      admin.from("lead_supply_ledger").select("id,external_key,lead_id,classification,billable,billing_type,unit_price_snapshot,ad_source_id,meta_account_id,origin,supplied_at").eq("law_firm_id", lawFirmId).neq("origin", "backfill").order("supplied_at", { ascending: false }).limit(80),
      admin.from("app_lead_imports").select("external_key", { count: "exact", head: true }).eq("law_firm_id", lawFirmId).in("classification", ["duplicate_external", "duplicate_meta", "duplicate_phone"]),
      admin.from("app_lead_imports").select("external_key", { count: "exact", head: true }).eq("law_firm_id", lawFirmId).eq("classification", "reentry"),
    ]);

    for (const result of [membersRes, recentLeadsRes, recentCasesRes, changesRes, auditRes, sheetsRes, metaRes, sourcesRes, rulesRes, ingestErrorsRes, supplyRecentRes]) {
      if (result.error) throw result.error;
    }

    const { data: authUsers, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authError) throw authError;
    const authMap = new Map((authUsers?.users ?? []).map((user: any) => [user.id, user]));

    const members = (membersRes.data ?? []).map((member: any) => {
      const authUser: any = authMap.get(member.id);
      return {
        ...member,
        last_sign_in_at: authUser?.last_sign_in_at ?? null,
        auth_created_at: authUser?.created_at ?? null,
      };
    });

    const recentLeads = (recentLeadsRes.data ?? []).map((row: any) => ({
      id: row.id,
      createdAt: row.created_at,
      name: row.data?.name ?? "-",
      phone: row.data?.phone ?? "-",
      assignedStaff: row.data?.assignedStaff ?? "-",
      status: row.data?.status ?? "-",
      detailStage: row.data?.detailStage ?? "-",
      source: row.data?.source ?? "-",
      adName: row.data?.adName ?? null,
      adSourceId: row.ad_source_id,
      metaAccountId: row.meta_account_id,
      metaLeadId: row.meta_lead_id,
    }));

    const recentCases = (recentCasesRes.data ?? []).map((row: any) => ({
      id: row.id,
      createdAt: row.created_at,
      caseNumber: row.data?.caseNumber ?? row.id,
      caseType: row.data?.caseType ?? "-",
      stage: row.data?.stage ?? "-",
      status: row.data?.status ?? "-",
      assignedStaff: row.data?.assignedStaff ?? "-",
      contractAmount: Number(row.data?.contractAmount ?? 0),
      paidAmount: Number(row.data?.paidAmount ?? 0),
    }));

    const recentChanges = (changesRes.data ?? []).map((row: any) => ({
      id: row.id,
      category: row.data?.category ?? "업무",
      action: row.data?.action ?? "변경",
      targetName: row.data?.targetName ?? "-",
      detail: row.data?.detail ?? "",
      staff: row.data?.staff ?? "시스템",
      at: row.data?.at ?? row.created_at,
    }));

    return NextResponse.json({
      firm,
      metrics: {
        leadCount: leadsCountRes.count ?? 0,
        leadsToday: leadsTodayRes.count ?? 0,
        caseCount: casesCountRes.count ?? 0,
        clientCount: clientsCountRes.count ?? 0,
        activeMembers: members.filter((m: any) => m.is_active).length,
        duplicateCount: duplicateRes.count ?? 0,
        reentryCount: reentryRes.count ?? 0,
        supply24hCount: supply24Res.count ?? 0,
        billable24hCount: billable24Res.count ?? 0,
        queuePendingCount: queuePendingRes.count ?? 0,
        queueFailedCount: queueFailedRes.count ?? 0,
        ingestError24hCount: (ingestErrorsRes.data ?? []).length,
      },
      members,
      recentLeads,
      recentCases,
      recentChanges,
      platformAudits: auditRes.data ?? [],
      sheets: sheetsRes.data ?? [],
      metaAccounts: metaRes.data ?? [],
      sources: sourcesRes.data ?? [],
      metaRules: rulesRes.data ?? [],
      ingestErrors: ingestErrorsRes.data ?? [],
      supplyLedger: supplyRecentRes.data ?? [],
    });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
