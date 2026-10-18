import { decryptIntegrationSecret } from "@/lib/platform/server";
import { MAEIL_ESIGN_FIRM_ID, defaultEsignTemplate, validateEsignTemplates, type FirmEsignConfig, type FirmEsignView } from "@/lib/eformsign-config";

export function legacyMaeilEsignConfig(lawFirmId: string): FirmEsignConfig {
  if (lawFirmId !== MAEIL_ESIGN_FIRM_ID) throw new Error("이 로펌의 이폼사인 연결이 등록되지 않았습니다. 로파워 관리자에게 연결을 요청해주세요.");
  return { lawFirmId, connectionId: null, source: "legacy_env", apiKey: process.env.EFORMSIGN_API_KEY?.trim() || "", privateKey: process.env.EFORMSIGN_PRIVATE_KEY?.trim() || "", memberId: process.env.EFORMSIGN_MEMBER_ID?.trim() || "", senderMemberId: process.env.EFORMSIGN_SENDER_MEMBER_ID?.trim() || "", companyId: "", templates: [defaultEsignTemplate(process.env.EFORMSIGN_TEMPLATE_ID?.trim() || "")] };
}
export async function readFirmEsignConfig(admin: any, lawFirmId: string, connectionId?: string | null): Promise<FirmEsignConfig | null> {
  if (connectionId === null) return legacyMaeilEsignConfig(lawFirmId);
  let query = admin.from("platform_firm_esign_connections").select("id,law_firm_id,credentials_ciphertext,company_id,templates,updated_at").eq("law_firm_id", lawFirmId);
  query = connectionId ? query.eq("id", connectionId) : query.eq("active", true);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("로펌 전자계약 연결정보를 읽지 못했습니다.");
  if (!data) {
    if (connectionId) throw new Error("이 문서에 연결된 이폼사인 계정정보를 찾지 못했습니다.");
    return lawFirmId === MAEIL_ESIGN_FIRM_ID ? legacyMaeilEsignConfig(lawFirmId) : null;
  }
  let secrets: any;
  try { secrets = JSON.parse(decryptIntegrationSecret(data.credentials_ciphertext)); } catch { throw new Error("전자계약 연결정보 복호화 설정을 확인해주세요."); }
  return { lawFirmId, connectionId: data.id, source: "connection", apiKey: String(secrets.apiKey || ""), privateKey: String(secrets.privateKey || ""), memberId: String(secrets.memberId || ""), senderMemberId: String(secrets.senderMemberId || ""), companyId: data.company_id || "", templates: validateEsignTemplates(data.templates) };
}
export function requireFirmEsignConfig(config: FirmEsignConfig | null): FirmEsignConfig {
  if (!config || !config.apiKey || !config.privateKey || !config.memberId) throw new Error("이 로펌의 이폼사인 연결이 완료되지 않았습니다. 로파워 관리자에게 연결을 요청해주세요.");
  return config;
}
export function safeFirmEsignView(lawFirmId: string, config: FirmEsignConfig | null, canManage: boolean, updatedAt: string | null = null): FirmEsignView {
  return { lawFirmId, connectionId: config?.connectionId || null, canManage, configured: Boolean(config?.apiKey && config?.privateKey && config?.memberId && config.templates.some(t => t.templateId)), source: config?.source || "none", companyId: config?.companyId || "", templates: config?.templates || [], updatedAt, presence: { apiKey: Boolean(config?.apiKey), privateKey: Boolean(config?.privateKey), memberId: Boolean(config?.memberId), senderMemberId: Boolean(config?.senderMemberId) } };
}
