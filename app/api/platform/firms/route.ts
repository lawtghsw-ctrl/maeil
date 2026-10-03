import { NextRequest, NextResponse } from "next/server";
import { requirePlatformUser, platformError, writePlatformAudit } from "@/lib/platform/server";

async function firmCode(admin: any) {
  const { data, error } = await admin.rpc("generate_firm_code");
  if (error || !data) throw error || new Error("로펌 ID 생성에 실패했습니다.");
  return String(data);
}


export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    const { data: firms, error } = await admin.from("law_firms").select("*").order("created_at", { ascending: false });
    if (error) throw error;

    const rows = await Promise.all((firms ?? []).map(async (firm: any) => {
      const [members, leads, cases, sheets, metaAccounts, duplicateImports, ingestErrors, queuePending, queueFailed, supply24h, billable24h] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).eq("is_active", true),
        admin.from("app_leads").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id),
        admin.from("app_cases").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id),
        admin.from("firm_sheet_integrations").select("id,last_received_at,active").eq("law_firm_id", firm.id).eq("active", true).order("last_received_at", { ascending: false, nullsFirst: false }).limit(1),
        admin.from("firm_meta_accounts").select("id,last_success_at,last_error_at,last_error_message,active").eq("law_firm_id", firm.id).eq("active", true),
        admin.from("app_lead_imports").select("external_key", { count: "exact", head: true }).eq("law_firm_id", firm.id).in("classification", ["duplicate_external", "duplicate_meta", "duplicate_phone"]),
        admin.from("integration_ingest_errors").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        admin.from("meta_event_queue").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).in("status", ["pending", "processing"]),
        admin.from("meta_event_queue").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).eq("status", "failed"),
        admin.from("lead_supply_ledger").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).gte("supplied_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        admin.from("lead_supply_ledger").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).eq("billable", true).gte("supplied_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      ]);
      const activeMeta = metaAccounts.data ?? [];
      const latestMetaSuccess = activeMeta.map((x:any)=>x.last_success_at).filter(Boolean).sort().reverse()[0] ?? null;
      const latestMetaError = activeMeta.map((x:any)=>x.last_error_at).filter(Boolean).sort().reverse()[0] ?? null;
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
        activeMetaAccountCount: activeMeta.length,
        lastSheetReceivedAt: sheets.data?.[0]?.last_received_at ?? null,
        lastMetaSuccessAt: latestMetaSuccess,
        lastMetaErrorAt: latestMetaError,
      };
    }));
    const { data: auditLogs, error: auditError } = await admin.from("platform_audit_logs")
      .select("id,actor_name,actor_role,law_firm_id,action,target_type,target_id,detail,created_at")
      .order("created_at", { ascending: false }).limit(50);
    if (auditError) throw auditError;
    return NextResponse.json({ firms: rows, auditLogs: auditLogs ?? [] });
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
    {
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
