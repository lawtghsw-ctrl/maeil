import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requirePlatformUser, platformError, writePlatformAudit } from "@/lib/platform/server";

export async function POST(request: NextRequest) {
  try {
    const { admin, user, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    const body = await request.json();
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (!currentPassword) throw new Error("현재 비밀번호를 입력해주세요.");
    if (newPassword.length < 8) throw new Error("새 비밀번호는 8자 이상이어야 합니다.");
    if (newPassword !== confirmPassword) throw new Error("새 비밀번호 확인이 일치하지 않습니다.");
    if (currentPassword === newPassword) throw new Error("현재 비밀번호와 다른 비밀번호를 사용해주세요.");
    if (!user.email) throw new Error("계정 이메일을 확인할 수 없습니다.");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error("Supabase 공개 연결정보가 설정되지 않았습니다.");

    const verifier = createSupabaseClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: verifyError } = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyError) throw new Error("현재 비밀번호가 올바르지 않습니다.");

    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
    if (updateError) throw updateError;

    await writePlatformAudit(admin, request, profile, {
      lawFirmId: profile.law_firm_id || null,
      action: "account.password.change",
      targetType: "profile",
      targetId: user.id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
