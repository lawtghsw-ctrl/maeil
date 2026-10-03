import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret, writePlatformAudit } from "@/lib/platform/server";

function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  let createdUserId: string | null = null;
  try {
    const body = await request.json();
    const code = String(body.code || "").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();

    const ipHash = hashSecret(`join-ip:${clientIp(request)}`);
    const codeHash = hashSecret(code || "missing");
    const [{ data: ipAllowed, error: ipRateError }, { data: codeAllowed, error: codeRateError }] = await Promise.all([
      admin.rpc("consume_public_rate_limit", { p_scope: "join_ip", p_key_hash: ipHash, p_limit: 12, p_window_seconds: 900 }),
      admin.rpc("consume_public_rate_limit", { p_scope: "join_code", p_key_hash: codeHash, p_limit: 6, p_window_seconds: 900 }),
    ]);
    if (ipRateError || codeRateError) throw ipRateError || codeRateError;
    if (ipAllowed !== true || codeAllowed !== true) {
      return NextResponse.json({ error: "가입 시도가 너무 많습니다. 15분 후 다시 시도해주세요." }, { status: 429 });
    }

    if (!code || !email.includes("@") || password.length < 8 || !name) {
      throw new Error("초대코드, 이름, 이메일, 8자 이상 비밀번호를 모두 입력해주세요.");
    }

    const { data: invite, error: inviteError } = await admin
      .from("firm_invites")
      .select("id,law_firm_id,expires_at,used_at,revoked_at,law_firms(name,status)")
      .eq("code_hash", codeHash)
      .maybeSingle();
    if (inviteError || !invite) throw new Error("초대코드가 올바르지 않습니다.");
    if (invite.revoked_at) throw new Error("취소된 초대코드입니다.");
    if (invite.used_at) throw new Error("이미 사용된 초대코드입니다.");
    if (new Date(invite.expires_at).getTime() <= Date.now()) throw new Error("초대코드 유효기간이 만료되었습니다.");
    const firm: any = Array.isArray(invite.law_firms) ? invite.law_firms[0] : invite.law_firms;
    if (!firm || firm.status !== "active") throw new Error("현재 이용이 중지된 로펌입니다.");

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name, staff_name: name },
    });
    if (createError || !created.user) throw createError || new Error("계정 생성에 실패했습니다.");
    createdUserId = created.user.id;

    const { data: accepted, error: acceptError } = await admin.rpc("accept_firm_invite", {
      p_code_hash: codeHash,
      p_user_id: created.user.id,
      p_display_name: name,
      p_email: email,
    });
    if (acceptError) throw acceptError;

    await writePlatformAudit(admin, request, { id: created.user.id, display_name: name, email, platform_role: accepted?.role || "staff" }, {
      lawFirmId: accepted?.lawFirmId || invite.law_firm_id,
      action: "invite.accept",
      targetType: "profile",
      targetId: created.user.id,
      detail: { inviteId: invite.id, role: accepted?.role || "staff" },
    });

    return NextResponse.json({ ok: true, firmName: accepted?.firmName ?? firm.name });
  } catch (err) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
    return NextResponse.json({ error: err instanceof Error ? err.message : "회원가입에 실패했습니다." }, { status: 400 });
  }
}
