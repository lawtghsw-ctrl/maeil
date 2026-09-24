import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePermissions, type PermissionMap } from "@/lib/permissions";

async function requireAdmin(request: NextRequest) {
  const admin = createAdminClient();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("UNAUTHORIZED");

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new Error("UNAUTHORIZED");
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,is_active,display_name,staff_name,email")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.role !== "admin" || profile.is_active !== true) throw new Error("FORBIDDEN");
  return { admin, actorId: userData.user.id, actorName: profile.display_name || profile.staff_name || profile.email || userData.user.email || "최종관리자" };
}

async function logAccountChange(admin: ReturnType<typeof createAdminClient>, actorName: string, targetName: string, action: "등록" | "수정" | "삭제", detail: string) {
  const id = `CHG-${crypto.randomUUID()}`;
  const { error } = await admin.from("app_change_logs").insert({
    id,
    data: { id, category: "설정", action, targetName, detail, staff: actorName, at: new Date().toISOString() },
  });
  if (error) console.error("직원계정 변경이력 저장 실패", error);
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : "요청 처리 중 오류가 발생했습니다.";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "최종관리자만 사용할 수 있습니다." }, { status: 403 });
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const [{ data: listed, error: listError }, { data: profiles, error: profileError }] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("profiles").select("id,email,display_name,role,staff_name,is_active,is_work_staff,auto_assign_leads,lead_assignment_order,permissions,created_at,updated_at").order("created_at"),
    ]);
    if (listError) throw listError;
    if (profileError) throw profileError;
    const authMap = new Map((listed?.users ?? []).map((user) => [user.id, user]));
    const users = (profiles ?? []).map((profile) => {
      const authUser = authMap.get(profile.id);
      return {
        id: profile.id,
        email: authUser?.email ?? profile.email ?? "",
        displayName: profile.display_name || profile.staff_name || authUser?.email?.split("@")[0] || "사용자",
        role: profile.role === "admin" ? "admin" : "staff",
        staffName: profile.staff_name || profile.display_name || "",
        isActive: profile.is_active === true,
        isWorkStaff: profile.is_work_staff !== false,
        autoAssignLeads: profile.auto_assign_leads === true,
        leadAssignmentOrder: Number(profile.lead_assignment_order ?? 1000),
        permissions: (profile.permissions ?? {}) as PermissionMap,
        createdAt: authUser?.created_at ?? profile.created_at,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
      };
    });
    return NextResponse.json({ users });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, actorName } = await requireAdmin(request);
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim();
    const role = body.role === "admin" ? "admin" : "staff";
    const isActive = body.isActive === true;
    const isWorkStaff = body.isWorkStaff !== false;
    const autoAssignLeads = isWorkStaff && body.autoAssignLeads !== false;
    const leadAssignmentOrder = Math.max(1, Math.min(9999, Number(body.leadAssignmentOrder) || 1000));
    const permissions = normalizePermissions((body.permissions ?? {}) as PermissionMap);
    if (!email || !email.includes("@")) throw new Error("올바른 이메일을 입력해주세요.");
    if (password.length < 8) throw new Error("임시 비밀번호는 8자 이상 입력해주세요.");
    if (!displayName) throw new Error("직원 이름을 입력해주세요.");
    const { data: nameRows, error: nameError } = await admin.from("profiles").select("id,display_name,staff_name");
    if (nameError) throw nameError;
    const normalizedName = displayName.toLocaleLowerCase("ko-KR");
    if ((nameRows ?? []).some((row) => String(row.staff_name || row.display_name || "").trim().toLocaleLowerCase("ko-KR") === normalizedName)) {
      throw new Error("같은 직원명이 이미 존재합니다. 담당자 구분을 위해 직원명은 중복 사용할 수 없습니다.");
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, staff_name: displayName },
    });
    if (error) throw error;
    if (!data.user) throw new Error("계정 생성 결과를 확인하지 못했습니다.");

    const { error: updateError } = await admin.from("profiles").upsert({
      id: data.user.id,
      email,
      display_name: displayName,
      staff_name: displayName,
      role,
      is_active: isActive,
      is_work_staff: isWorkStaff,
      auto_assign_leads: autoAssignLeads,
      lead_assignment_order: leadAssignmentOrder,
      permissions,
      updated_at: new Date().toISOString(),
    });
    if (updateError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw updateError;
    }
    await logAccountChange(admin, actorName, displayName, "등록", `직원계정 생성 · ${role === "admin" ? "최종관리자" : "직원"} · ${isActive ? "활성" : "비활성"} · 실무담당 ${isWorkStaff ? "사용" : "제외"} · DB자동배정 ${autoAssignLeads ? `참여(${leadAssignmentOrder})` : "제외"}`);
    return NextResponse.json({ ok: true, id: data.user.id });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, actorId, actorName } = await requireAdmin(request);
    const body = await request.json();
    const id = String(body.id || "");
    if (!id) throw new Error("사용자 ID가 없습니다.");

    const { data: currentProfile, error: currentError } = await admin
      .from("profiles")
      .select("id,role,is_active,staff_name,display_name")
      .eq("id", id)
      .maybeSingle();
    if (currentError || !currentProfile) throw new Error("사용자 프로필을 찾지 못했습니다.");

    const nextRole = body.role === "admin" ? "admin" : "staff";
    const nextActive = body.isActive === true;
    if (id === actorId && (!nextActive || nextRole !== "admin")) {
      throw new Error("현재 로그인한 최종관리자 본인의 계정을 비활성화하거나 직원으로 변경할 수 없습니다.");
    }
    if (currentProfile.role === "admin" && (nextRole !== "admin" || !nextActive)) {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true)
        .neq("id", id);
      if (countError) throw countError;
      if (!count) throw new Error("활성 최종관리자는 최소 1명 이상 남아 있어야 합니다.");
    }

    const displayName = String(body.displayName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!displayName) throw new Error("직원 이름을 입력해주세요.");
    if (!email || !email.includes("@")) throw new Error("올바른 이메일을 입력해주세요.");
    if (password && password.length < 8) throw new Error("새 비밀번호는 8자 이상 입력해주세요.");
    const { data: nameRows, error: nameError } = await admin.from("profiles").select("id,display_name,staff_name");
    if (nameError) throw nameError;
    const normalizedName = displayName.toLocaleLowerCase("ko-KR");
    if ((nameRows ?? []).some((row) => row.id !== id && String(row.staff_name || row.display_name || "").trim().toLocaleLowerCase("ko-KR") === normalizedName)) {
      throw new Error("같은 직원명이 이미 존재합니다. 담당자 구분을 위해 직원명은 중복 사용할 수 없습니다.");
    }

    const authPatch: { email?: string; password?: string; user_metadata?: Record<string, string> } = {
      email,
      user_metadata: { display_name: displayName, staff_name: displayName },
    };
    if (password) authPatch.password = password;
    const { error: authError } = await admin.auth.admin.updateUserById(id, authPatch);
    if (authError) throw authError;

    const { error: profileError } = await admin.from("profiles").update({
      email,
      display_name: displayName,
      staff_name: displayName,
      role: nextRole,
      is_active: nextActive,
      is_work_staff: body.isWorkStaff !== false,
      auto_assign_leads: body.isWorkStaff !== false && body.autoAssignLeads === true,
      lead_assignment_order: Math.max(1, Math.min(9999, Number(body.leadAssignmentOrder) || 1000)),
      permissions: normalizePermissions((body.permissions ?? {}) as PermissionMap),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (profileError) throw profileError;

    const oldStaffName = String(currentProfile.staff_name || currentProfile.display_name || "").trim();
    if (oldStaffName && oldStaffName !== displayName) {
      const { error: renameError } = await admin.rpc("rename_staff_assignments", { old_name: oldStaffName, new_name: displayName });
      if (renameError) throw renameError;
    }

    await logAccountChange(admin, actorName, displayName, "수정", `직원계정 설정 변경 · ${nextRole === "admin" ? "최종관리자" : "직원"} · ${nextActive ? "활성" : "비활성"} · 실무담당 ${body.isWorkStaff !== false ? "사용" : "제외"} · DB자동배정 ${body.isWorkStaff !== false && body.autoAssignLeads === true ? `참여(${Math.max(1, Math.min(9999, Number(body.leadAssignmentOrder) || 1000))})` : "제외"}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}


export async function DELETE(request: NextRequest) {
  try {
    const { admin, actorId, actorName } = await requireAdmin(request);
    const id = String(request.nextUrl.searchParams.get("id") || "");
    if (!id) throw new Error("사용자 ID가 없습니다.");
    if (id === actorId) throw new Error("현재 로그인한 본인 계정은 삭제할 수 없습니다.");

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,role,is_active,display_name")
      .eq("id", id)
      .maybeSingle();
    if (profileError || !profile) throw new Error("사용자 프로필을 찾지 못했습니다.");

    if (profile.role === "admin" && profile.is_active === true) {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true)
        .neq("id", id);
      if (countError) throw countError;
      if (!count) throw new Error("활성 최종관리자는 최소 1명 이상 남아 있어야 합니다.");
    }

    const targetName = profile.display_name || "사용자";
    const [{ count: leadCount, error: leadCountError }, { count: clientCount, error: clientCountError }, { count: caseCount, error: caseCountError }] = await Promise.all([
      admin.from("app_leads").select("id", { count: "exact", head: true }).contains("data", { assignedStaff: targetName }),
      admin.from("app_clients").select("id", { count: "exact", head: true }).contains("data", { assignedStaff: targetName }),
      admin.from("app_cases").select("id", { count: "exact", head: true }).contains("data", { assignedStaff: targetName }),
    ]);
    if (leadCountError || clientCountError || caseCountError) throw leadCountError || clientCountError || caseCountError;
    const assignedCount = (leadCount ?? 0) + (clientCount ?? 0) + (caseCount ?? 0);
    if (assignedCount > 0) {
      throw new Error(`현재 ${targetName} 담당으로 남아 있는 DB/고객/계약이 ${assignedCount}건 있습니다. 담당자를 먼저 변경한 뒤 계정을 삭제해주세요. 단순 퇴사/중지는 계정 비활성화를 권장합니다.`);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) throw deleteError;
    await logAccountChange(admin, actorName, targetName, "삭제", "직원계정 영구삭제");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
