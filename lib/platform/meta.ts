import { createHash } from "crypto";
import { decryptIntegrationSecret } from "@/lib/platform/server";

function normalizePhoneForMeta(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  // LawPower is currently Korea-focused. Meta matching works better with country code rather than a local leading 0.
  if (digits.startsWith("82")) return digits;
  if (digits.startsWith("0")) return `82${digits.slice(1)}`;
  return digits;
}
function sha(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex");
}

export async function sendMetaLeadEvent(admin: any, args: {
  leadId: string;
  lawFirmId: string;
  metaAccountId: string;
  eventName: string;
  eventId: string;
  eventTime?: number;
}) {
  const [{ data: lead, error: leadError }, { data: account, error: accountError }] = await Promise.all([
    admin.from("app_leads").select("id,data,law_firm_id,ad_source_id,meta_account_id,meta_lead_id").eq("id", args.leadId).eq("law_firm_id", args.lawFirmId).maybeSingle(),
    admin.from("firm_meta_accounts").select("id,law_firm_id,dataset_id,access_token_ciphertext,test_event_code,active").eq("id", args.metaAccountId).eq("law_firm_id", args.lawFirmId).maybeSingle(),
  ]);
  if (leadError || !lead) throw new Error("DB를 찾지 못했습니다.");
  if (accountError || !account || !account.active) throw new Error("활성 Meta 광고계정을 찾지 못했습니다.");
  if (!account.dataset_id || !account.access_token_ciphertext) throw new Error("Dataset ID 또는 암호화된 Access Token이 설정되지 않았습니다.");

  const graphVersion = process.env.META_GRAPH_API_VERSION?.trim();
  if (!graphVersion) throw new Error("META_GRAPH_API_VERSION 환경변수가 필요합니다.");
  const accessToken = decryptIntegrationSecret(account.access_token_ciphertext);
  const phone = normalizePhoneForMeta(String(lead.data?.phone || ""));
  const email = String(lead.data?.email || "").trim().toLowerCase();
  const userData: Record<string, unknown> = {};
  if (phone) userData.ph = [sha(phone)];
  if (email) userData.em = [sha(email)];
  if (lead.meta_lead_id) userData.lead_id = lead.meta_lead_id;
  if (!phone && !email && !lead.meta_lead_id) throw new Error("Meta 전송에 사용할 전화번호/이메일/Lead ID가 없습니다.");

  const endpoint = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.dataset_id)}/events`;
  const payload = {
    data: [{
      event_name: args.eventName,
      event_time: args.eventTime || Math.floor(Date.now() / 1000),
      event_id: args.eventId,
      action_source: "system_generated",
      user_data: userData,
    }],
    ...(account.test_event_code ? { test_event_code: account.test_event_code } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responseText = (await response.text()).slice(0, 5000);
    return { ok: response.ok, status: response.status, responseText, lead, account };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Meta API 요청이 15초 안에 완료되지 않았습니다.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
