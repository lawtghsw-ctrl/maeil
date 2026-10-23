import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { requirePlatformUser } from "@/lib/platform/server";
import { isWritingStaff } from "@/lib/writing-staff";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MOBILE = /^\d{9,11}$/;
export const APPROVED_SENDERS = new Set(["01026492494", "01096191379", "01059156310"]);
export const CAPABILITIES = { sms: true, lms: true, mms: true, maxRecipients: 1000, maxImages: 3, minReservationMinutes: 10 };
export type SmsAdmin = Awaited<ReturnType<typeof requirePlatformUser>>["admin"];
export type SmsActor = { admin: SmsAdmin; actorId: string; firmId: string; canManage: boolean };
export type DeliveryGate = { law_firm_id: string; manual_enabled: boolean; auto_enabled: boolean; epoch_id: string; relay_epoch: string; activated_at: string; updated_at?: string };
export type DeliveryJob = {
  id: string; outbox_id: string; law_firm_id: string; epoch_id: string; relay_epoch: string;
  attempt_id: string | null; source: string; lead_id: string | null; sender_number_id: string;
  sender_number: string; receiver_number: string; receiver_name: string | null; message: string;
  title: string | null; msg_type: "SMS" | "LMS" | "MMS"; image_paths: string[]; reserved_at: string | null;
  status: string; provider_message_id: string | null; provider_code?: number | null; error_code?: string | null;
  created_at: string; completed_at?: string | null; expires_at: string; delivery_state?: string; delivery_checked_at?: string | null;
};

export class SmsError extends Error {
  constructor(readonly status: number, message: string, readonly code = "SMS_ERROR") { super(message); }
}
export function fail(status: number, message: string, code?: string): never { throw new SmsError(status, message, code); }
export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) fail(400, `${label} 정보가 올바르지 않습니다.`);
  return value;
}
export async function readJson(request: NextRequest, allowedKeys: readonly string[], maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) fail(415, "JSON 요청이 필요합니다.");
  const size = request.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || Number(size) > maxBytes)) fail(413, "요청 내용이 너무 큽니다.");
  if (!request.body) fail(400, "요청 내용이 없습니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); fail(413, "요청 내용이 너무 큽니다."); } chunks.push(part.value); }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "요청 형식이 올바르지 않습니다.");
    const object = value as Record<string, unknown>;
    if (Object.keys(object).some(key => !allowedKeys.includes(key))) fail(400, "지원하지 않는 요청 항목이 있습니다.");
    return object;
  } catch (error) { if (error instanceof SmsError) throw error; fail(400, "JSON 요청 내용이 올바르지 않습니다."); }
  finally { reader.releaseLock(); }
}

export async function requireSmsActor(request: NextRequest, requestedFirm: unknown, permission: "sms.view" | "sms.send" | "sms.view_history" | "sms.manage_settings"): Promise<SmsActor> {
  const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
  const { data: details, error } = await admin.from("profiles").select("permissions").eq("id", profile.id).maybeSingle();
  if (error || !details) fail(403, "문자 권한을 확인할 수 없습니다.");
  if (isWritingStaff({ ...profile, permissions: details.permissions })) fail(403, "문자 기능을 사용할 권한이 없습니다.");
  const superAdmin = profile.platform_role === "super_admin";
  const manager = superAdmin || profile.platform_role === "firm_admin" || profile.role === "admin";
  const permissions = details.permissions as Record<string, unknown> | null;
  if (!manager && permissions?.[permission] !== true) fail(403, "문자 기능을 사용할 권한이 없습니다.");
  const firmId = superAdmin ? requireUuid(requestedFirm, "로펌") : requireUuid(profile.law_firm_id, "소속 로펌");
  if (!superAdmin && requestedFirm != null && requestedFirm !== firmId) fail(403, "다른 로펌의 문자에 접근할 수 없습니다.");
  const { data: firm, error: firmError } = await admin.from("law_firms").select("id,name,status,firm_code").eq("id", firmId).maybeSingle();
  if (firmError || !firm || firm.status !== "active") fail(403, "활성 로펌만 문자 기능을 사용할 수 있습니다.");
  return { admin, actorId: profile.id, firmId, canManage: manager };
}

export function readLiveConfiguration() {
  const endpoint = process.env.ALIGO_LIVE_RELAY_URL || "";
  const token = process.env.ALIGO_LIVE_RELAY_TOKEN || "";
  const epoch = process.env.ALIGO_LIVE_APPROVAL_EPOCH || "";
  const key = process.env.ALIGO_API_KEY || "", userId = process.env.ALIGO_USER_ID || "";
  if (process.env.SMS_LIVE_ENABLED !== "true" || !/^[A-Za-z0-9_-]{32,256}$/.test(token) || !UUID.test(epoch) || !key || !userId) fail(503, "문자 발송 연결이 준비되지 않았습니다.", "SMS_NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(endpoint); } catch { fail(503, "문자 중계 서버 설정을 확인해주세요."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port || url.pathname !== "/v1/aligo/send") fail(503, "문자 중계 서버 설정을 확인해주세요.");
  return { endpoint: url.href, origin: url.origin, token, epoch, provider: { key, userId } };
}
export async function assertRelayReady() {
  const configuration = readLiveConfiguration();
  try {
    const response = await fetch(`${configuration.origin}/v1/aligo/ready`, { headers: { authorization: `Bearer ${configuration.token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000) });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok || result.ready !== true || result.approvalEpoch !== configuration.epoch) throw new Error("not ready");
    return configuration;
  } catch { fail(503, "문자 중계 서버가 준비되지 않았습니다. 잠시 후 다시 확인해주세요.", "SMS_RELAY_UNAVAILABLE"); }
}
export function gateView(gate: DeliveryGate | null, epoch: string | null) {
  const current = gate && gate.relay_epoch === epoch;
  return { epochId: gate?.epoch_id || null, liveEnabled: !!current && gate.manual_enabled, autoEnabled: !!current && gate.auto_enabled, activatedAt: gate?.activated_at || null };
}
export async function readGate(admin: SmsAdmin, firmId: string): Promise<DeliveryGate | null> {
  const { data, error } = await admin.from("sms_delivery_gates").select("*").eq("law_firm_id", firmId).maybeSingle();
  if (error) fail(503, "새 문자 발송 대기열을 준비 중입니다.", "SMS_SCHEMA_NOT_READY");
  return data as DeliveryGate | null;
}
export async function isDemoFirm(admin: SmsAdmin, firmId: string): Promise<boolean> {
  const { data, error } = await admin.from("law_firms").select("name,firm_code").eq("id", firmId).maybeSingle();
  if (error || !data) fail(403, "로펌 정보를 확인할 수 없습니다.");
  return data.name === "TEST" && data.firm_code === "0000000000";
}
export function assertRpc(error: { message?: string } | null) {
  if (!error) return;
  const message = error.message || "";
  const failures: [RegExp, number, string][] = [
    [/EPOCH|STALE|GATE_CHANGED|GATE_CLOSED_OR_CHANGED/,409,"문자 활성 상태가 변경되었습니다. 새로고침 후 다시 확인해주세요."],
    [/GATE_DISABLED|DELIVERY_DISABLED/,409,"해당 로펌의 실제 문자 발송이 꺼져 있습니다."],
    [/IDEMPOTENCY|REQUEST_CONFLICT/,409,"같은 요청 번호의 내용이 달라졌습니다. 이전 접수 결과를 확인해주세요."],
    [/SENDER/,400,"활성 상태이며 알리고에 등록된 발신번호를 선택해주세요."],
    [/RESERV|SCHEDULE/,400,"예약 시간은 현재 시각보다 10분 이상 뒤여야 합니다."],
    [/DEMO/,403,"TEST 로펌은 시연용이므로 실제 문자를 발송할 수 없습니다."],
    [/FORBIDDEN|ACTOR|PERMISSION|FIRM/,403,"문자 발송 권한 또는 로펌 상태를 확인해주세요."],
    [/INVALID|MESSAGE|RECIPIENT|IMAGE|PHONE|BATCH/,400,"수신번호, 문구 또는 첨부파일을 확인해주세요."],
  ];
  for (const [pattern,status,text] of failures) if (pattern.test(message)) fail(status,text);
  fail(503,"문자 요청을 처리하지 못했습니다. 같은 요청으로 접수 여부를 확인해주세요.");
}
export function workerAuthorized(request: NextRequest): boolean {
  const expected = process.env.SMS_DISPATCH_SECRET;
  const supplied = request.headers.get("authorization") || "";
  if (!expected || !/^[A-Za-z0-9_-]{32,256}$/.test(expected)) return false;
  return timingSafeEqual(createHash("sha256").update(supplied).digest(),createHash("sha256").update(`Bearer ${expected}`).digest());
}
export function smsErrorResponse(error: unknown) {
  if (error instanceof SmsError) return { status: error.status, error: error.message };
  const key = error instanceof Error ? error.message : "";
  if (["UNAUTHORIZED"].includes(key)) return { status: 401, error: "로그인이 필요합니다." };
  if (["FORBIDDEN","NO_FIRM","FIRM_SUSPENDED"].includes(key)) return { status: 403, error: "문자 기능에 접근할 권한이 없습니다." };
  return { status: 503, error: "문자 기능을 처리하지 못했습니다. 잠시 후 다시 확인해주세요." };
}
