import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import { sendMetaLeadEvent } from "@/lib/platform/meta";

function backoffMinutes(attempts: number) {
  if (attempts <= 1) return 5;
  if (attempts === 2) return 15;
  if (attempts === 3) return 60;
  if (attempts === 4) return 360;
  return 1440;
}

async function resolveAccess(request: NextRequest, body?: any) {
  const configuredSecrets = [process.env.META_QUEUE_SECRET?.trim(), process.env.CRON_SECRET?.trim()].filter(Boolean) as string[];
  const headerSecret = request.headers.get("x-lawpower-meta-queue-secret")?.trim();
  const bearer = request.headers.get("authorization") || "";
  const bearerValue = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
  const serviceAuthorized = configuredSecrets.some((secret) => secret === headerSecret || secret === bearerValue);
  if (serviceAuthorized) {
    return { admin: createAdminClient(), lawFirmId: body?.lawFirmId || request.nextUrl.searchParams.get("lawFirmId") || null, mode: "service" as const };
  }

  const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
  const requestedFirm = body?.lawFirmId || request.nextUrl.searchParams.get("lawFirmId") || null;
  const lawFirmId = profile.platform_role === "super_admin" ? requestedFirm : profile.law_firm_id;
  if (profile.platform_role === "super_admin" && !lawFirmId) throw new Error("로펌을 선택해주세요.");
  return { admin, lawFirmId, mode: "user" as const };
}

async function run(request: NextRequest, body?: any) {
  const access = await resolveAccess(request, body);
  const limit = Math.max(1, Math.min(50, Number(body?.limit || request.nextUrl.searchParams.get("limit")) || 20));
  const { data: claimed, error: claimError } = await access.admin.rpc("claim_meta_event_queue", {
    p_law_firm_id: access.lawFirmId || null,
    p_limit: limit,
  });
  if (claimError) throw claimError;

  let success = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const item of claimed ?? []) {
    const logId = crypto.randomUUID();
    await access.admin.from("meta_event_logs").insert({
      id: logId,
      law_firm_id: item.law_firm_id,
      lead_id: item.lead_id,
      ad_source_id: item.ad_source_id,
      meta_account_id: item.meta_account_id,
      event_name: item.event_name,
      event_id: item.event_id,
      status: "pending",
    });

    try {
      const sent = await sendMetaLeadEvent(access.admin, {
        leadId: item.lead_id,
        lawFirmId: item.law_firm_id,
        metaAccountId: item.meta_account_id,
        eventName: item.event_name,
        eventId: item.event_id,
        eventTime: Math.floor(new Date(item.created_at).getTime() / 1000),
      });

      await access.admin.from("meta_event_logs").update({
        status: sent.ok ? "success" : "failed",
        response_code: sent.status,
        error_message: sent.ok ? null : sent.responseText.slice(0, 1500),
        responded_at: new Date().toISOString(),
      }).eq("id", logId);

      if (sent.ok) {
        success += 1;
        await Promise.all([
          access.admin.from("meta_event_queue").update({ status: "success", last_error: null, updated_at: new Date().toISOString() }).eq("id", item.id),
          access.admin.from("firm_meta_accounts").update({ last_success_at: new Date().toISOString(), last_error_message: null }).eq("id", item.meta_account_id),
        ]);
        results.push({ id: item.id, ok: true, eventId: item.event_id });
      } else {
        throw new Error(`Meta ${sent.status}: ${sent.responseText.slice(0, 500)}`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Meta 전송 실패";
      const nextAttempt = new Date(Date.now() + backoffMinutes(Number(item.attempts || 1)) * 60_000).toISOString();
      await Promise.all([
        access.admin.from("meta_event_queue").update({
          status: "failed",
          last_error: message.slice(0, 1500),
          next_attempt_at: nextAttempt,
          updated_at: new Date().toISOString(),
        }).eq("id", item.id),
        access.admin.from("meta_event_logs").update({ status: "failed", error_message: message.slice(0, 1500), responded_at: new Date().toISOString() }).eq("id", logId),
        access.admin.from("firm_meta_accounts").update({ last_error_at: new Date().toISOString(), last_error_message: message.slice(0, 1000) }).eq("id", item.meta_account_id),
      ]);
      results.push({ id: item.id, ok: false, eventId: item.event_id, error: message, nextAttemptAt: nextAttempt });
    }
  }

  return NextResponse.json({ ok: true, claimed: claimed?.length ?? 0, success, failed, results });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return await run(request, body);
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

export async function GET(request: NextRequest) {
  try {
    return await run(request, {});
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
