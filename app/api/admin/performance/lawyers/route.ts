import { NextRequest, NextResponse } from "next/server";
import { requirePlatformUser, platformError, writePlatformAudit } from "@/lib/platform/server";
import {
  LAWYER_SETTINGS_KEY, MAX_LAWYER_JSON_BYTES, emptyLawyerConfig, missingLawyerCaseIds,
  normalizeLawyerConfig, resolveLawyerFirmId, type LawyerConfig,
} from "@/lib/performance/lawyers";

export const dynamic = "force-dynamic";

type Admin = Awaited<ReturnType<typeof requirePlatformUser>>["admin"];

async function requireManager(request: NextRequest) {
  const context = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
  const { profile } = context;
  if (profile.platform_role !== "super_admin" && profile.platform_role !== "firm_admin" && profile.role !== "admin") throw new Error("FORBIDDEN");
  return context;
}
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
function fail(error: unknown) {
  const result = platformError(error);
  if (error instanceof Error && error.message === "CONFLICT") return json({ error: "다른 관리자가 설정을 변경했습니다. 입력 내용은 유지됩니다. 최신 설정을 불러온 뒤 다시 확인해주세요." }, 409);
  return json({ error: result.message }, result.status);
}
async function targetFirm(admin: Admin, firmId: string, platformRole: string) {
  const { data, error } = await admin.from("law_firms").select("id,name,status").eq("id", firmId).maybeSingle();
  if (error) throw new Error("로펌 정보를 확인하지 못했습니다.");
  if (!data) throw new Error("NO_FIRM");
  if (platformRole !== "super_admin" && data.status !== "active") throw new Error("FIRM_SUSPENDED");
  return data;
}
async function existingAssignmentIds(admin: Admin, firmId: string, config: LawyerConfig) {
  const ids = Object.keys(config.assignments);
  const found = new Set<string>();
  // Bound request URLs and preserve validation for every assignment, not only
  // cases currently visible in the date/search filters.
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunks: string[][] = [];
    for (let start = offset; start < Math.min(offset + 500, ids.length); start += 100) chunks.push(ids.slice(start, Math.min(start + 100, ids.length)));
    const results = await Promise.all(chunks.map((chunk) => admin.from("app_cases").select("id").eq("law_firm_id", firmId).in("id", chunk)));
    for (const { data, error } of results) {
      if (error) throw new Error("사건 소속을 확인하지 못했습니다. 다시 시도해주세요.");
      for (const row of data ?? []) found.add(String(row.id));
    }
  }
  return found;
}
async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new Error("JSON 형식으로 요청해주세요.");
  if (Number(request.headers.get("content-length")) > MAX_LAWYER_JSON_BYTES) throw new Error("저장할 설정 용량이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("저장할 설정이 없습니다.");
  const decoder = new TextDecoder();
  let text = "", size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_LAWYER_JSON_BYTES) { await reader.cancel(); throw new Error("저장할 설정 용량이 너무 큽니다."); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error("JSON 설정 형식이 올바르지 않습니다."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("설정 형식이 올바르지 않습니다.");
  const object = body as Record<string, unknown>;
  if (Object.keys(object).some((key) => !["firmId", "value", "expectedUpdatedAt"].includes(key))) throw new Error("지원하지 않는 요청 항목이 있습니다.");
  if (!(object.expectedUpdatedAt === null || (typeof object.expectedUpdatedAt === "string" && object.expectedUpdatedAt.length <= 40 && Number.isFinite(Date.parse(object.expectedUpdatedAt))))) throw new Error("설정 버전이 없습니다. 설정을 다시 불러와주세요.");
  return object;
}

export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requireManager(request);
    const firmId = resolveLawyerFirmId(profile, request.nextUrl.searchParams.get("firmId"));
    await targetFirm(admin, firmId, profile.platform_role);
    const { data, error } = await admin.from("firm_settings").select("value,updated_at").eq("law_firm_id", firmId).eq("key", LAWYER_SETTINGS_KEY).maybeSingle();
    if (error) throw new Error("변호사 설정을 불러오지 못했습니다.");
    const value = data ? normalizeLawyerConfig(data.value, false) : emptyLawyerConfig();
    const existingIds = await existingAssignmentIds(admin, firmId, value);
    return json({ firmId, value, updatedAt: data?.updated_at ?? null, missingCaseIds: missingLawyerCaseIds(value, existingIds) });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, user, profile } = await requireManager(request);
    const body = await readBody(request);
    const firmId = resolveLawyerFirmId(profile, body.firmId);
    const value = normalizeLawyerConfig(body.value);
    await targetFirm(admin, firmId, profile.platform_role);
    const existingIds = await existingAssignmentIds(admin, firmId, value);
    if (missingLawyerCaseIds(value, existingIds).length) throw new Error("현재 로펌에 없는 사건 배정이 포함되어 있습니다. 해당 배정을 해제한 뒤 저장해주세요.");
    const expectedUpdatedAt = body.expectedUpdatedAt as string | null;
    const updatedAt = new Date(Math.max(Date.now(), expectedUpdatedAt ? Date.parse(expectedUpdatedAt) + 1 : 0)).toISOString();
    const payload = { law_firm_id: firmId, key: LAWYER_SETTINGS_KEY, value, updated_by: user.id, updated_at: updatedAt };
    // Atomic compare-and-set prevents a stale manager tab replacing newer edits.
    const query = expectedUpdatedAt === null
      ? admin.from("firm_settings").insert(payload)
      : admin.from("firm_settings").update(payload).eq("law_firm_id", firmId).eq("key", LAWYER_SETTINGS_KEY).eq("updated_at", expectedUpdatedAt);
    const { data, error } = await query.select("value,updated_at").maybeSingle();
    if (error?.code === "23505") throw new Error("CONFLICT");
    if (error) throw new Error("변호사 설정을 저장하지 못했습니다. 입력 내용은 유지됩니다.");
    if (!data) throw new Error("CONFLICT");
    await writePlatformAudit(admin, request, profile, {
      lawFirmId: firmId, action: "performance_lawyers.update", targetType: "firm_settings", targetId: LAWYER_SETTINGS_KEY,
      detail: { lawyerCount: value.lawyers.length, assignmentCount: Object.keys(value.assignments).length },
    });
    return json({ firmId, value, updatedAt: data.updated_at, missingCaseIds: [] });
  } catch (error) { return fail(error); }
}
