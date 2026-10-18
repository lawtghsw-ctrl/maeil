import { NextRequest, NextResponse } from "next/server";
import { getEformsignAccess, getEformsignDocumentStatus } from "@/lib/eformsign";
import { platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";
import { getFirmEsignCase } from "@/lib/eformsign-access";
import { readFirmEsignConfig, requireFirmEsignConfig } from "@/lib/eformsign-connections";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);

    const body = await request.json();
    const caseId = String(body.caseId || "").trim();
    if (!caseId) throw new Error("caseId가 필요합니다.");

    const caseRow = await getFirmEsignCase(admin, profile, caseId);

    const { data: binding, error: bindingError } = await admin.from("platform_firm_esign_documents").select("document_id,law_firm_id,connection_id,credential_source,company_id,status").eq("case_id", caseRow.id).maybeSingle();
    if (bindingError) throw new Error("전자문서 귀속정보를 읽지 못했습니다.");
    if (!binding) throw new Error("발송된 전자문서 귀속정보가 없습니다. 관리자에게 확인을 요청해주세요.");
    if (binding && binding.law_firm_id !== caseRow.law_firm_id) throw new Error("전자문서 로펌 귀속이 일치하지 않습니다.");
    const storedId = String(caseRow.data?.eformsignDocumentId || "").trim();
    if (binding?.document_id && storedId && binding.document_id !== storedId) throw new Error("계약과 전자문서 연결이 일치하지 않습니다. 관리자에게 확인을 요청해주세요.");
    const documentId = binding?.document_id || storedId;
    if (binding && !binding.document_id) throw new Error("이 계약은 이전 발송 결과 확인이 필요합니다. 관리자 확인 전 재발송하지 마세요.");
    if (!documentId) throw new Error("발송된 전자계약서가 없습니다.");

    // The additive migration binds existing Maeil documents. Client-editable
    // case JSON alone never grants access to an arbitrary provider document.
    const config = requireFirmEsignConfig(await readFirmEsignConfig(admin, caseRow.law_firm_id, binding.credential_source === "legacy_env" ? null : binding.connection_id));
    const access = await getEformsignAccess(config);
    if (binding?.company_id && binding.company_id !== access.companyId) throw new Error("전자문서 발송 회사와 현재 인증 회사가 다릅니다.");
    const checked = await getEformsignDocumentStatus(access, documentId);
    const now = new Date().toISOString();
    const nextData = {
      eformsignStatus: checked.status,
      eformsignStatusCode: checked.statusCode,
      eformsignCheckedAt: now,
      eformsignError: null,
      eformsignDocumentId: documentId,
    };

    const { error: updateError } = await admin.rpc("merge_firm_esign_case_metadata", { p_case_id: caseRow.id, p_law_firm_id: caseRow.law_firm_id, p_metadata: nextData });
    if (updateError) throw new Error("문서 상태는 확인했으나 계약 표시 갱신에 실패했습니다. 다시 상태를 확인해주세요.");

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
