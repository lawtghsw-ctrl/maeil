import { NextRequest, NextResponse } from "next/server";
import { hashSecret, makeInviteCode, platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";

async function targetFirmId(request: NextRequest, profile: any, body?: any) {
  if (profile.platform_role === "super_admin") {
    const value = body?.lawFirmId || request.nextUrl.searchParams.get("lawFirmId");
    if (!value) throw new Error("로펌을 선택해주세요.");
    return String(value);
  }
  if (!profile.law_firm_id) throw new Error("소속 로펌 정보가 없습니다.");
  return String(profile.law_firm_id);
}

export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin"]);
    const lawFirmId = await targetFirmId(request, profile);
    const { data, error } = await admin
      .from("firm_invites")
      .select("id,law_firm_id,code_preview,role,expires_at,used_at,revoked_at,created_at")
      .eq("law_firm_id", lawFirmId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json({ invites: data ?? [] });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin"]);
    const body = await request.json();
    const lawFirmId = await targetFirmId(request, profile, body);
    const role = body.role === "firm_admin" ? "firm_admin" : "staff";
    if (profile.platform_role === "firm_admin" && role === "firm_admin") {
      throw new Error("로펌 관리자 추가는 로파워 최상위 관리자에게 요청해주세요.");
    }
    const { data: firm } = await admin.from("law_firms").select("id,status,name").eq("id", lawFirmId).maybeSingle();
    if (!firm || firm.status !== "active") throw new Error("활성 상태의 로펌만 직원을 초대할 수 있습니다.");

    const code = makeInviteCode();
    const codeHash = hashSecret(code);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin.from("firm_invites").insert({
      law_firm_id: lawFirmId,
      code_hash: codeHash,
      code_preview: `${code.slice(0, 5)}••••${code.slice(-3)}`,
      role,
      expires_at: expiresAt,
      created_by: user.id,
    }).select("id,expires_at,role").single();
    if (error) throw error;
    await writePlatformAudit(admin, request, profile, { lawFirmId, action: "invite.create", targetType: "firm_invite", targetId: data.id, detail: { role, expiresAt, firmName: firm.name } });
    return NextResponse.json({ ok: true, invite: data, code, expiresAt, firmName: firm.name });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin"]);
    const id = String(request.nextUrl.searchParams.get("id") || "");
    if (!id) throw new Error("초대 ID가 없습니다.");
    const { data: invite, error: findError } = await admin.from("firm_invites").select("id,law_firm_id,used_at").eq("id", id).maybeSingle();
    if (findError || !invite) throw new Error("초대정보를 찾지 못했습니다.");
    if (profile.platform_role !== "super_admin" && invite.law_firm_id !== profile.law_firm_id) throw new Error("FORBIDDEN");
    if (invite.used_at) throw new Error("이미 사용된 초대코드는 취소할 수 없습니다.");
    const { error } = await admin.from("firm_invites").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    await writePlatformAudit(admin, request, profile, { lawFirmId: invite.law_firm_id, action: "invite.revoke", targetType: "firm_invite", targetId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
