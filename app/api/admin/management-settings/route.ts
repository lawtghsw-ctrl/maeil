import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writePlatformAudit } from "@/lib/platform/server";

const KEY = "management_analytics_v1";
type PlatformRole = "super_admin" | "firm_admin" | "staff";

async function requireManager(request: NextRequest) {
  const admin = createAdminClient();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("UNAUTHORIZED");

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new Error("UNAUTHORIZED");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,email,display_name,staff_name,is_active,law_firm_id,platform_role,role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.is_active !== true) throw new Error("FORBIDDEN");
  const platformRole = (profile.platform_role || "staff") as PlatformRole;
  const manager = platformRole === "super_admin" || platformRole === "firm_admin" || profile.role === "admin";
  if (!manager) throw new Error("FORBIDDEN");

  return { admin, user: userData.user, profile: { ...profile, platform_role: platformRole } };
}

function resolveFirmId(
  profile: { platform_role?: string | null; law_firm_id?: string | null },
  requested?: unknown,
) {
  const requestedFirmId = String(requested || "").trim();
  if (profile.platform_role === "super_admin") return requestedFirmId || null;
  if (!profile.law_firm_id) throw new Error("NO_FIRM");
  if (requestedFirmId && requestedFirmId !== profile.law_firm_id) throw new Error("FORBIDDEN");
  return String(profile.law_firm_id);
}

function fail(error: unknown) {
  const raw = error as { message?: string; code?: string; details?: string; hint?: string };
  const message = raw?.message || "정산설정 요청 처리 중 오류가 발생했습니다.";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "정산설정 관리 권한이 없습니다." }, { status: 403 });
  if (message === "NO_FIRM") return NextResponse.json({ error: "소속 로펌 정보를 확인할 수 없습니다." }, { status: 403 });
  const detail = [raw?.code, raw?.details, raw?.hint].filter(Boolean).join(" · ");
  return NextResponse.json({ error: detail ? `${message} (${detail})` : message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requireManager(request);
    const firmId = resolveFirmId(profile, request.nextUrl.searchParams.get("firmId"));

    let query = admin.from("firm_settings").select("law_firm_id,value,updated_at").eq("key", KEY);
    if (firmId) query = query.eq("law_firm_id", firmId);
    else if (profile.platform_role !== "super_admin") throw new Error("NO_FIRM");

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ rows: data ?? [] });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, user, profile } = await requireManager(request);
    const body = await request.json().catch(() => ({}));
    const firmId = resolveFirmId(profile, body?.firmId);
    if (!firmId) throw new Error("대상 로펌을 선택해주세요.");
    if (!body?.value || typeof body.value !== "object" || Array.isArray(body.value)) {
      throw new Error("저장할 정산설정 값이 없습니다.");
    }

    const { data: firm, error: firmError } = await admin
      .from("law_firms")
      .select("id,name,status")
      .eq("id", firmId)
      .maybeSingle();
    if (firmError) throw firmError;
    if (!firm) throw new Error("대상 로펌을 찾을 수 없습니다.");
    if (firm.status !== "active" && profile.platform_role !== "super_admin") {
      throw new Error("현재 이용이 중지된 로펌입니다.");
    }

    const payload = {
      law_firm_id: firmId,
      key: KEY,
      value: body.value,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from("firm_settings")
      .upsert(payload, { onConflict: "law_firm_id,key" })
      .select("law_firm_id,value,updated_at")
      .single();
    if (error) throw error;

    await writePlatformAudit(admin, request, profile, {
      lawFirmId: firmId,
      action: "management_settings.update",
      targetType: "firm_settings",
      targetId: KEY,
      detail: { key: KEY, firmName: firm.name, updatedAt: data?.updated_at ?? payload.updated_at },
    });

    return NextResponse.json({ ok: true, value: data?.value ?? body.value, updatedAt: data?.updated_at ?? payload.updated_at });
  } catch (error) {
    return fail(error);
  }
}

export const POST = PATCH;
