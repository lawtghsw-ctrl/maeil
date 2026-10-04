import { NextRequest, NextResponse } from "next/server";
import { createEformsignDocument } from "@/lib/eformsign";
import { platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";

async function requireEcontractPermission(admin: any, profile: any) {
  if (profile.platform_role === "super_admin" || profile.platform_role === "firm_admin" || profile.role === "admin") return;
  const { data } = await admin.from("profiles").select("permissions").eq("id", profile.id).maybeSingle();
  if (data?.permissions?.["cases.econtract"] !== true) throw new Error("FORBIDDEN");
}

async function getCase(admin: any, profile: any, caseId: string) {
  let query = admin.from("app_cases").select("id,data,law_firm_id").eq("id", caseId);
  if (profile.platform_role !== "super_admin") query = query.eq("law_firm_id", profile.law_firm_id);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error("계약을 찾지 못했습니다.");
  return data;
}

async function assertMaeilEformsignFirm(admin: any, lawFirmId: string) {
  const { data: firm, error } = await admin
    .from("law_firms")
    .select("id,firm_code,name,is_legacy_default")
    .eq("id", lawFirmId)
    .maybeSingle();
  if (error || !firm) throw new Error("로펌 정보를 확인하지 못했습니다.");

  const configuredCode = process.env.EFORMSIGN_LAW_FIRM_CODE?.trim();
  const allowed = configuredCode ? firm.firm_code === configuredCode : firm.is_legacy_default === true;
  if (!allowed) throw new Error("현재 등록된 이폼사인 계정은 매일법률사무소 전용입니다.");
  return firm;
}

export async function POST(request: NextRequest) {
  let caseRow: any = null;
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    await requireEcontractPermission(admin, profile);

    const body = await request.json();
    const caseId = String(body.caseId || "").trim();
    if (!caseId) throw new Error("caseId가 필요합니다.");

    caseRow = await getCase(admin, profile, caseId);
    await assertMaeilEformsignFirm(admin, caseRow.law_firm_id);
    if (caseRow.data?.caseType !== "개인회생") {
      throw new Error("현재 연결된 전자계약 템플릿은 개인회생 사건 전용입니다.");
    }

    if (String(caseRow.data?.eformsignDocumentId || "").trim()) {
      throw new Error("이미 전자계약서가 발송된 계약입니다. 서명상태 확인을 이용해주세요.");
    }

    const input = {
      name: String(body.name || "").trim(),
      address: String(body.address || "").trim(),
      residentNumber: String(body.residentNumber || "").trim(),
      phone: String(body.phone || "").trim(),
      creditorCount: String(body.creditorCount || "").trim(),
      fee: String(body.fee || "").trim(),
      contractDate: String(body.contractDate || "").trim(),
      signerName: String(body.signerName || "").trim(),
      message: String(body.message || "").trim(),
    };

    const missing = Object.entries(input)
      .filter(([key, value]) => key !== "message" && !value)
      .map(([key]) => key);
    if (missing.length) throw new Error(`전자계약서 필수 입력값이 누락되었습니다: ${missing.join(", ")}`);

    const sent = await createEformsignDocument(input);
    const now = new Date().toISOString();
    const nextData = {
      ...(caseRow.data || {}),
      eformsignDocumentId: sent.documentId,
      eformsignStatus: sent.status,
      eformsignStatusCode: sent.statusCode,
      eformsignSentAt: now,
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
      action: "eformsign.send",
      targetType: "case",
      targetId: caseRow.id,
      detail: {
        documentId: sent.documentId,
        status: sent.status,
        statusCode: sent.statusCode,
      },
    });

    return NextResponse.json({
      ok: true,
      documentId: sent.documentId,
      status: sent.status,
      statusCode: sent.statusCode,
    });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
