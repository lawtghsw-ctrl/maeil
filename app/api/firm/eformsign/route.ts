import { createPrivateKey } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { encryptIntegrationSecret, platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";
import { readFirmEsignConfig, safeFirmEsignView } from "@/lib/eformsign-connections";
import { validateEsignTemplates } from "@/lib/eformsign-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
const headers = { "Cache-Control": "private, no-store" };
function firmId(request: NextRequest, profile: any, body?: any) {
  const requested = String(body?.lawFirmId || request.nextUrl.searchParams.get("lawFirmId") || "");
  if (profile.platform_role !== "super_admin" && requested && requested !== profile.law_firm_id) throw new Error("FORBIDDEN");
  const id = profile.platform_role === "super_admin" ? requested : profile.law_firm_id;
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new Error("로펌을 선택해주세요.");
  return id;
}
export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin"]);
    const lawFirmId = firmId(request, profile);
    const config = await readFirmEsignConfig(admin, lawFirmId);
    return NextResponse.json(safeFirmEsignView(lawFirmId, config, profile.platform_role === "super_admin"), { headers });
  } catch (error) { const e = platformError(error); return NextResponse.json({ error: e.message }, { status: e.status, headers }); }
}
export async function PUT(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    const text = await request.text();
    if (text.length > 50_000) throw new Error("연결 설정이 너무 큽니다.");
    let body: any; try { body = JSON.parse(text); } catch { throw new Error("설정 형식이 올바르지 않습니다."); }
    const lawFirmId = firmId(request, profile, body);
    if (!Object.prototype.hasOwnProperty.call(body, "expectedConnectionId") || (body.expectedConnectionId !== null && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.expectedConnectionId))) throw new Error("연결 설정을 새로 불러온 뒤 저장해주세요.");
    const { data: firm, error } = await admin.from("law_firms").select("id").eq("id", lawFirmId).maybeSingle();
    if (error || !firm) throw new Error("로펌 정보를 찾지 못했습니다.");
    const previous = await readFirmEsignConfig(admin, lawFirmId);
    const value = (key: "apiKey" | "privateKey" | "memberId" | "senderMemberId") => typeof body[key] === "string" && body[key].trim() ? body[key].trim() : previous?.[key] || "";
    const secrets = { apiKey: value("apiKey"), privateKey: value("privateKey"), memberId: value("memberId"), senderMemberId: body.clearSenderMemberId === true ? "" : value("senderMemberId") };
    if (!secrets.apiKey || !secrets.privateKey || !secrets.memberId) throw new Error("API 키·서명키·멤버 ID를 모두 등록해주세요.");
    if (secrets.apiKey.length > 8192 || secrets.privateKey.length > 20000 || secrets.memberId.length > 320 || secrets.senderMemberId.length > 320 || /[\r\n]/.test(secrets.apiKey + secrets.memberId + secrets.senderMemberId)) throw new Error("연결정보 길이와 형식을 확인해주세요.");
    try {
      const raw = secrets.privateKey.replace(/\\n/g, "\n").trim();
      if (raw.includes("BEGIN")) createPrivateKey(raw);
      else { if (!/^(?:[\da-f]{2})+$/i.test(raw.replace(/\s/g, ""))) throw new Error(); createPrivateKey({ key: Buffer.from(raw.replace(/\s/g, ""), "hex"), format: "der", type: "pkcs8" }); }
    } catch { throw new Error("서명키는 유효한 PEM 또는 PKCS8 HEX 형식으로 입력해주세요."); }
    const companyId = String(body.companyId || previous?.companyId || "").trim();
    if (!/^[\w-]{1,128}$/.test(companyId)) throw new Error("이 로펌 이폼사인 계정의 회사 ID를 입력해주세요.");
    const templates = validateEsignTemplates(body.templates);
    const encrypted = encryptIntegrationSecret(JSON.stringify(secrets));
    const { error: savedError } = await admin.rpc("replace_firm_esign_connection", { p_law_firm_id: lawFirmId, p_company_id: companyId, p_credentials_ciphertext: encrypted, p_templates: templates, p_updated_by: profile.id, p_expected_connection_id: body.expectedConnectionId });
    if (savedError?.message?.includes("ESIGN_CONNECTION_CONFLICT")) return NextResponse.json({ error: "다른 관리자가 연결 설정을 변경했습니다. 화면을 새로 불러와 변경사항을 확인한 뒤 다시 저장해주세요." }, { status: 409, headers });
    if (savedError) throw new Error("로펌 전자계약 연결정보를 저장하지 못했습니다.");
    await writePlatformAudit(admin, request, profile, { lawFirmId, action: "eformsign.connection.update", targetType: "law_firm", targetId: lawFirmId, detail: { templateCount: templates.length, configured: true } });
    return NextResponse.json({ ok: true, message: "설정을 암호화 저장했습니다. 실제 문서 발송은 실행하지 않았습니다." }, { headers });
  } catch (error) { const e = platformError(error); return NextResponse.json({ error: e.message }, { status: e.status, headers }); }
}
