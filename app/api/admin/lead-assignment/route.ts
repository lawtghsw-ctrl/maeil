import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writePlatformAudit } from "@/lib/platform/server";

type PlatformRole = "super_admin" | "firm_admin" | "staff";
type DayType = "all" | "weekday" | "weekend" | "custom";

const CONSULT_TIME_SLOTS = [
  "평일 오전(9시~12시)",
  "평일 점심(12시~1시)",
  "평일 오후(1시~6시)",
  "퇴근 후(6시~9시)",
  "주말 오전(8시~12시)",
  "주말 오후(12시~19시)",
] as const;

interface AssignmentMember {
  profileId: string;
  enabled: boolean;
  order: number;
  weight: number;
}

interface AssignmentRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  dayType: DayType;
  weekdays: number[];
  startTime: string;
  endTime: string;
  consultTimeSlots: string[];
  members: AssignmentMember[];
}

interface AssignmentConfig {
  version: 2;
  enabled: boolean;
  timezone: "Asia/Seoul";
  members: AssignmentMember[];
  rules: AssignmentRule[];
}

async function requireAdmin(request: NextRequest) {
  const admin = createAdminClient();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("UNAUTHORIZED");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new Error("UNAUTHORIZED");
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id,is_active,display_name,staff_name,email,law_firm_id,platform_role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error || !profile || profile.is_active !== true || !["super_admin", "firm_admin"].includes(profile.platform_role || "")) {
    throw new Error("FORBIDDEN");
  }
  return {
    admin,
    actorId: userData.user.id,
    actorName: profile.display_name || profile.staff_name || profile.email || "관리자",
    profile: { ...profile, platform_role: profile.platform_role as PlatformRole },
  };
}

async function resolveFirmId(request: NextRequest, profile: any, bodyFirmId?: unknown) {
  if (profile.platform_role === "firm_admin") {
    if (!profile.law_firm_id) throw new Error("FORBIDDEN");
    return String(profile.law_firm_id);
  }
  const queryFirm = String(request.nextUrl.searchParams.get("lawFirmId") || "").trim();
  const bodyFirm = String(bodyFirmId || "").trim();
  const firmId = bodyFirm || queryFirm;
  if (!firmId) throw new Error("로펌을 먼저 선택해주세요.");
  return firmId;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function validTime(value: unknown, fallback: string) {
  const s = String(value || "");
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : fallback;
}

function sanitizeMembers(raw: unknown, allowedIds: Set<string>): AssignmentMember[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item: any, idx) => {
    const profileId = String(item?.profileId || "");
    if (!allowedIds.has(profileId) || seen.has(profileId)) return [];
    seen.add(profileId);
    return [{
      profileId,
      enabled: item?.enabled === true,
      order: clampInt(item?.order, 1, 9999, idx + 1),
      weight: clampInt(item?.weight, 1, 100, 1),
    }];
  });
}

function sanitizeConfig(raw: any, staff: any[]): AssignmentConfig {
  const allowedIds = new Set(staff.map((row) => String(row.id)));
  const eligibleIds = new Set(staff.filter((row) => row.is_active === true && row.is_work_staff !== false).map((row) => String(row.id)));
  const baseRaw = sanitizeMembers(raw?.members, allowedIds);
  const byId = new Map(baseRaw.map((item) => [item.profileId, item]));
  const members = staff.map((row, idx) => {
    const saved = byId.get(String(row.id));
    return {
      profileId: String(row.id),
      enabled: eligibleIds.has(String(row.id)) && (saved?.enabled ?? row.auto_assign_leads === true),
      order: saved?.order ?? clampInt(row.lead_assignment_order, 1, 9999, idx + 1),
      weight: saved?.weight ?? 1,
    };
  });

  const rules: AssignmentRule[] = Array.isArray(raw?.rules)
    ? raw.rules.slice(0, 40).map((rule: any, idx: number) => {
        const dayType: DayType = ["all", "weekday", "weekend", "custom"].includes(rule?.dayType) ? rule.dayType : "all";
        const weekdays = Array.isArray(rule?.weekdays)
          ? Array.from(new Set<number>(rule.weekdays.map((v: unknown) => clampInt(v, 1, 7, 1)))).sort((a, b) => a - b)
          : [];
        const consultTimeSlots = Array.isArray(rule?.consultTimeSlots)
          ? rule.consultTimeSlots.map(String).filter((v: string) => (CONSULT_TIME_SLOTS as readonly string[]).includes(v))
          : [];
        return {
          id: String(rule?.id || crypto.randomUUID()),
          name: String(rule?.name || `상세 규칙 ${idx + 1}`).trim().slice(0, 80) || `상세 규칙 ${idx + 1}`,
          enabled: rule?.enabled !== false,
          priority: clampInt(rule?.priority, 1, 9999, idx + 1),
          dayType,
          weekdays,
          startTime: validTime(rule?.startTime, "00:00"),
          endTime: validTime(rule?.endTime, "23:59"),
          consultTimeSlots,
          members: sanitizeMembers(rule?.members, eligibleIds),
        };
      })
    : [];

  return {
    version: 2,
    enabled: raw?.enabled !== false,
    timezone: "Asia/Seoul",
    members,
    rules: rules.sort((a, b) => a.priority - b.priority),
  };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : "요청 처리 중 오류가 발생했습니다.";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "DB 자동배정 설정 권한이 없습니다." }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requireAdmin(request);
    const lawFirmId = await resolveFirmId(request, profile);
    const [{ data: firm, error: firmError }, { data: staff, error: staffError }, { data: state, error: stateError }] = await Promise.all([
      admin.from("law_firms").select("id,name,status").eq("id", lawFirmId).maybeSingle(),
      admin.from("profiles")
        .select("id,email,display_name,staff_name,is_active,is_work_staff,auto_assign_leads,lead_assignment_order,platform_role,created_at")
        .eq("law_firm_id", lawFirmId)
        .in("platform_role", ["firm_admin", "staff"])
        .order("created_at"),
      admin.from("firm_runtime_state").select("value").eq("law_firm_id", lawFirmId).eq("key", "lead_auto_assignment_config").maybeSingle(),
    ]);
    if (firmError || !firm) throw new Error("로펌 정보를 찾지 못했습니다.");
    if (firm.status !== "active") throw new Error("이용중지 상태의 로펌입니다.");
    if (staffError) throw staffError;
    if (stateError) throw stateError;
    const config = sanitizeConfig(state?.value ?? {}, staff ?? []);
    return NextResponse.json({
      lawFirm: firm,
      staff: (staff ?? []).map((row: any) => ({
        id: row.id,
        name: row.staff_name || row.display_name || row.email || "사용자",
        email: row.email || "",
        isActive: row.is_active === true,
        isWorkStaff: row.is_work_staff !== false,
        platformRole: row.platform_role || "staff",
      })),
      config,
    });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, profile, actorName } = await requireAdmin(request);
    const body = await request.json();
    const lawFirmId = await resolveFirmId(request, profile, body?.lawFirmId);
    const { data: staff, error: staffError } = await admin.from("profiles")
      .select("id,email,display_name,staff_name,is_active,is_work_staff,auto_assign_leads,lead_assignment_order,platform_role,created_at")
      .eq("law_firm_id", lawFirmId)
      .in("platform_role", ["firm_admin", "staff"])
      .order("created_at");
    if (staffError) throw staffError;
    const config = sanitizeConfig(body?.config ?? {}, staff ?? []);

    const enabledBaseIds = new Set(config.enabled ? config.members.filter((m) => m.enabled).map((m) => m.profileId) : []);
    const orderById = new Map(config.members.map((m) => [m.profileId, m.order]));
    const updates = (staff ?? []).map((row: any) => admin.from("profiles").update({
      auto_assign_leads: enabledBaseIds.has(String(row.id)),
      lead_assignment_order: orderById.get(String(row.id)) ?? 1000,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("law_firm_id", lawFirmId));
    const results = await Promise.all(updates);
    const failed = results.find((result: any) => result.error);
    if (failed?.error) throw failed.error;

    const { error: saveError } = await admin.from("firm_runtime_state").upsert({
      law_firm_id: lawFirmId,
      key: "lead_auto_assignment_config",
      value: config,
      updated_at: new Date().toISOString(),
    }, { onConflict: "law_firm_id,key" });
    if (saveError) throw saveError;

    const { error: cursorError } = await admin.from("firm_runtime_state").upsert({
      law_firm_id: lawFirmId,
      key: "lead_round_robin_v2",
      value: { cursors: {}, updatedAt: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: "law_firm_id,key" });
    if (cursorError) throw cursorError;

    const changeId = `CHG-${crypto.randomUUID()}`;
    const activeCount = config.members.filter((m) => m.enabled).length;
    await admin.from("app_change_logs").insert({
      id: changeId,
      law_firm_id: lawFirmId,
      data: {
        id: changeId,
        category: "설정",
        action: "수정",
        targetName: "DB 자동배정",
        detail: `기본 자동배정 ${activeCount}명 · 상세규칙 ${config.rules.filter((r) => r.enabled).length}개`,
        staff: actorName,
        at: new Date().toISOString(),
      },
    });
    await writePlatformAudit(admin, request, profile, {
      lawFirmId,
      action: "lead_assignment.update",
      targetType: "firm_runtime_state",
      targetId: "lead_auto_assignment_config",
      detail: { activeCount, rules: config.rules.length },
    });
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return fail(err);
  }
}
