import { NextRequest, NextResponse } from "next/server";
import { buildEformsignPayload, createEformsignDocument, getEformsignAccess } from "@/lib/eformsign";
import { platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";
import { getFirmEsignCase } from "@/lib/eformsign-access";
import { readFirmEsignConfig, requireFirmEsignConfig } from "@/lib/eformsign-connections";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

// Read-only preflight for staff with the existing e-contract permission.
// It reports server ownership without authenticating with the external provider.
export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    const row = await getFirmEsignCase(admin, profile, request.nextUrl.searchParams.get("caseId") || "");
    const { data: binding, error } = await admin.from("platform_firm_esign_documents").select("document_id,status,law_firm_id").eq("case_id", row.id).maybeSingle();
    if (error || (binding && binding.law_firm_id !== row.law_firm_id)) throw new Error("전자문서 귀속정보를 확인하지 못했습니다.");
    const config = await readFirmEsignConfig(admin, row.law_firm_id);
    const template = config?.templates.find(t => t.caseType === row.data?.caseType);
    const configured = Boolean(config?.apiKey && config.privateKey && config.memberId && template?.templateId);
    return NextResponse.json({ configured, templateName: template?.documentName || null, fixedYear: template?.fixedYear ?? null, documentId: binding?.document_id || null, sendBlocked: Boolean(binding || row.data?.eformsignDocumentId), status: binding?.status === "unknown" || (binding && !binding.document_id) ? "발송 결과 확인 필요" : row.data?.eformsignStatus || (binding?.document_id ? "서명상태 확인 필요" : "미발송") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) { const e = platformError(err); return NextResponse.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "private, no-store" } }); }
}

export async function POST(request: NextRequest) {
  let caseRow: any = null;
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);

    const body = await request.json();
    const caseId = String(body.caseId || "").trim();
    if (!caseId) throw new Error("caseId가 필요합니다.");

    caseRow = await getFirmEsignCase(admin, profile, caseId);
    const config = requireFirmEsignConfig(await readFirmEsignConfig(admin, caseRow.law_firm_id));
    const template = config.templates.find(t => t.caseType === caseRow.data?.caseType);
    if (!template) throw new Error("이 사건유형에 사용할 로펌 전자계약 템플릿이 등록되지 않았습니다.");

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

    buildEformsignPayload(input, template);
    const access = await getEformsignAccess(config);
    // Claim before the only document creation call. A timeout or lost response
    // remains blocked for reconciliation rather than issuing a second document.
    const { error: claimError } = await admin.from("platform_firm_esign_documents").insert({ case_id: caseRow.id, law_firm_id: caseRow.law_firm_id, connection_id: config.connectionId, credential_source: config.source, company_id: access.companyId || null, status: "requesting", created_by: profile.id });
    if (claimError) throw new Error("이 계약의 전자문서 발송이 이미 진행되었거나 기록을 확인할 수 없습니다. 결과 확인 전 재발송하지 마세요.");
    let sent;
    try {
      sent = await createEformsignDocument(input, config, template, access);
      const { error: bindingError } = await admin.from("platform_firm_esign_documents").update({ document_id: sent.documentId, status: "created" }).eq("case_id", caseRow.id).eq("law_firm_id", caseRow.law_firm_id);
      if (bindingError) throw new Error("전자문서 발송 결과를 기록하지 못했습니다. 관리자 확인 전 재발송하지 마세요.");
    } catch (error) {
      await admin.from("platform_firm_esign_documents").update({ status: "unknown" }).eq("case_id", caseRow.id).eq("law_firm_id", caseRow.law_firm_id);
      throw error;
    }
    const now = new Date().toISOString();
    const nextData = {
      eformsignDocumentId: sent.documentId,
      eformsignStatus: sent.status,
      eformsignStatusCode: sent.statusCode,
      eformsignSentAt: now,
      eformsignCheckedAt: now,
      eformsignError: null,
      eformsignLawFirmId: caseRow.law_firm_id,
      eformsignConnectionId: config.connectionId,
    };

    const { error: updateError } = await admin.rpc("merge_firm_esign_case_metadata", { p_case_id: caseRow.id, p_law_firm_id: caseRow.law_firm_id, p_metadata: nextData });
    if (updateError) throw new Error("전자문서는 발송되었으나 계약 표시 갱신에 실패했습니다. 서명상태 확인을 이용해주세요. 재발송하지 마세요.");

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
