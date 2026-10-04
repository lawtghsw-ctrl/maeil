import { NextRequest, NextResponse } from "next/server";
import { getEformsignAccess, getEformsignDocumentStatus } from "@/lib/eformsign";
import { platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";

async function requireEcontractPermission(admin: any, profile: any) {
  if (profile.platform_role === "super_admin" || profile.platform_role === "firm_admin" || profile.role === "admin") return;
  const { data } = await admin.from("profiles").select("permissions").eq("id", profile.id).maybeSingle();
  if (data?.permissions?.["cases.econtract"] !== true) throw new Error("FORBIDDEN");
}

export async function POST(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    await requireEcontractPermission(admin, profile);

    const body = await request.json();
    const caseId = String(body.caseId || "").trim();
    if (!caseId) throw new Error("caseId가 필요합니다.");

    let query = admin.from("app_cases").select("id,data,law_firm_id").eq("id", caseId);
    if (profile.platform_role !== "super_admin") query = query.eq("law_firm_id", profile.law_firm_id);
    const { data: caseRow, error } = await query.maybeSingle();
    if (error || !caseRow) throw new Error("계약을 찾지 못했습니다.");

    const documentId = String(caseRow.data?.eformsignDocumentId || "").trim();
    if (!documentId) throw new Error("발송된 전자계약서가 없습니다.");

    const access = await getEformsignAccess();
    const checked = await getEformsignDocumentStatus(access, documentId);
    const now = new Date().toISOString();
    const nextData = {
      ...(caseRow.data || {}),
      eformsignStatus: checked.status,
      eformsignStatusCode: checked.statusCode,
      eformsignCheckedAt: now,
      eformsignError: null,
    };

    const { error: updateError } = await admin
      .from("app_cases")
      .update({ data: nextData })
      .eq("id", caseRow.id)
      .eq("law_firm_id", caseRow.law_firm_id);
    if (updateError) throw updateError;

    await writePlatformAudit(admin, request, profile, {
      lawFirmId: caseRow.law_firm_id,
      action: "eformsign.status",
      targetType: "case",
      targetId: caseRow.id,
      detail: {
        documentId,
        status: checked.status,
        statusCode: checked.statusCode,
      },
    });

    return NextResponse.json({
      ok: true,
      documentId,
      status: checked.status,
      statusCode: checked.statusCode,
    });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
