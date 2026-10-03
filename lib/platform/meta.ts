"use server";

import { createHash } from "crypto";
import { decryptIntegrationSecret } from "@/lib/platform/server";

function normalizePhoneForMeta(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  // LawPower는 현재 한국 리드가 기본이므로 국제번호(82) 기준으로 정규화합니다.
  if (digits.startsWith("82")) return digits;
  if (digits.startsWith("0")) return `82${digits.slice(1)}`;
  return digits;
}

function sha(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex");
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function sendMetaLeadEvent(admin: any, args: {
  leadId: string;
  lawFirmId: string;
  metaAccountId: string;
  eventName: string;
  eventId: string;
  eventTime?: number;
  leadStatus?: string | null;
  leadStage?: string | null;
}) {
  const [{ data: lead, error: leadError }, { data: account, error: accountError }] = await Promise.all([
    admin
      .from("app_leads")
      .select("id,data,law_firm_id,ad_source_id,meta_account_id,meta_lead_id")
      .eq("id", args.leadId)
      .eq("law_firm_id", args.lawFirmId)
      .maybeSingle(),
    admin
      .from("firm_meta_accounts")
      .select("id,law_firm_id,dataset_id,access_token_ciphertext,test_event_code,active")
      .eq("id", args.metaAccountId)
      .eq("law_firm_id", args.lawFirmId)
      .maybeSingle(),
  ]);

  if (leadError || !lead) throw new Error("DB를 찾지 못했습니다.");
  if (accountError || !account || !account.active) throw new Error("활성 Meta 광고계정을 찾지 못했습니다.");
  if (!account.dataset_id || !account.access_token_ciphertext) {
    throw new Error("Dataset ID 또는 암호화된 Access Token이 설정되지 않았습니다.");
  }

  // Conversion Leads / CRM 최적화의 가장 중요한 원본 식별자입니다.
  // Instant Form -> Sheet 단계에서 leadgen_id(또는 lead_id)가 반드시 보존되어야 합니다.
  const metaLeadId = clean(lead.meta_lead_id);
  if (!metaLeadId) {
    throw new Error(
      "Meta Lead ID(leadgen_id)가 없습니다. Conversion Leads 최적화를 위해 Raw2의 leadgen_id/lead_id 컬럼 수집을 확인해주세요."
    );
  }

  const graphVersion = process.env.META_GRAPH_API_VERSION?.trim();
  if (!graphVersion) throw new Error("META_GRAPH_API_VERSION 환경변수가 필요합니다.");

  const accessToken = decryptIntegrationSecret(account.access_token_ciphertext);
  const phone = normalizePhoneForMeta(String(lead.data?.phone || ""));
  const email = clean(lead.data?.email).toLowerCase();

  // lead_id는 Meta가 발급한 원본 ID이므로 해시하지 않습니다.
  // 전화번호/이메일은 SHA-256 해시만 전송하며 상담내용/채무/소득 등의 상세정보는 보내지 않습니다.
  const userData: Record<string, unknown> = { lead_id: metaLeadId };
  if (phone) userData.ph = [sha(phone)];
  if (email) userData.em = [sha(email)];

  const leadStatus = clean(args.leadStatus) || clean(lead.data?.status);
  const leadStage = clean(args.leadStage) || clean(lead.data?.detailStage);
  const leadEventSource = process.env.META_CRM_LEAD_EVENT_SOURCE?.trim() || "LawPower";

  const customData: Record<string, unknown> = {
    event_source: "crm",
    lead_event_source: leadEventSource,
  };
  if (leadStatus) customData.lead_status = leadStatus;
  if (leadStage) customData.lead_stage = leadStage;

  const endpoint = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.dataset_id)}/events`;
  const payload = {
    data: [
      {
        event_name: args.eventName,
        event_time: args.eventTime || Math.floor(Date.now() / 1000),
        event_id: args.eventId,
        action_source: "system_generated",
        user_data: userData,
        custom_data: customData,
      },
    ],
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
    return {
      ok: response.ok,
      status: response.status,
      responseText,
      lead,
      account,
      crm: {
        metaLeadId,
        leadStatus: leadStatus || null,
        leadStage: leadStage || null,
        leadEventSource,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Meta API 요청이 15초 안에 완료되지 않았습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
