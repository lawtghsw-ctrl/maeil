import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import { sendMetaLeadEvent } from "@/lib/platform/meta";

export async function POST(request: NextRequest) {
  try {
    const { admin } = await requirePlatformUser(request, ["super_admin"]);
    const body = await request.json();

    const leadId = String(body.leadId || "");
    const eventName = String(body.eventName || "").trim();
    if (!leadId || !eventName) throw new Error("leadId와 eventName이 필요합니다.");

    const { data: lead, error: leadError } = await admin
      .from("app_leads")
      .select("id,data,law_firm_id,ad_source_id,meta_account_id,meta_lead_id")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead) throw new Error("DB를 찾지 못했습니다.");
    if (!lead.meta_account_id) {
      throw new Error("이 DB에는 유입 당시 Meta 광고계정이 연결되어 있지 않습니다.");
    }
    if (!String(lead.meta_lead_id || "").trim()) {
      throw new Error(
        "이 DB에는 Meta Lead ID(leadgen_id)가 없습니다. Conversion Leads 테스트 전 Sheet 원본 컬럼을 확인해주세요."
      );
    }

    const eventId = String(body.eventId || `LP-MANUAL-${crypto.randomUUID()}`);
    const logId = crypto.randomUUID();

    await admin.from("meta_event_logs").insert({
      id: logId,
      law_firm_id: lead.law_firm_id,
      lead_id: lead.id,
      ad_source_id: lead.ad_source_id,
      meta_account_id: lead.meta_account_id,
      event_name: eventName,
      event_id: eventId,
      status: "pending",
    });

    try {
      const sent = await sendMetaLeadEvent(admin, {
        leadId: lead.id,
        lawFirmId: lead.law_firm_id,
        metaAccountId: lead.meta_account_id,
        eventName,
        eventId,
        eventTime: Number(body.eventTime) || Math.floor(Date.now() / 1000),
        leadStatus: String(body.leadStatus || lead.data?.status || "").trim() || undefined,
        leadStage: String(body.leadStage || lead.data?.detailStage || "").trim() || undefined,
      });

      await admin
        .from("meta_event_logs")
        .update({
          status: sent.ok ? "success" : "failed",
          response_code: sent.status,
          error_message: sent.ok ? null : sent.responseText.slice(0, 1500),
          responded_at: new Date().toISOString(),
        })
        .eq("id", logId);

      await admin
        .from("firm_meta_accounts")
        .update(
          sent.ok
            ? {
                last_success_at: new Date().toISOString(),
                last_error_message: null,
              }
            : {
                last_error_at: new Date().toISOString(),
                last_error_message: sent.responseText.slice(0, 1000),
              }
        )
        .eq("id", lead.meta_account_id);

      if (!sent.ok) {
        throw new Error(
          `Meta 전송 실패 (${sent.status}): ${sent.responseText.slice(0, 300)}`
        );
      }

      return NextResponse.json({
        ok: true,
        eventId,
        metaAccountId: lead.meta_account_id,
        metaLeadId: lead.meta_lead_id,
        crmStatus: sent.crm.leadStatus,
        crmStage: sent.crm.leadStage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta 전송 실패";
      await admin
        .from("meta_event_logs")
        .update({
          status: "failed",
          error_message: message.slice(0, 1500),
          responded_at: new Date().toISOString(),
        })
        .eq("id", logId);
      throw error;
    }
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
