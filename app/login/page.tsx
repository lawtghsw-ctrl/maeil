"use client";

import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = hasSupabaseEnv();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      const user = signInData.user;
      if (!user) throw new Error("로그인 사용자 정보를 확인하지 못했습니다.");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role,is_active,platform_role,law_firm_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) {
        await supabase.auth.signOut();
        throw new Error("Supabase 멀티로펌 SQL이 적용되지 않았습니다.");
      }
      if (!profile) {
        await supabase.auth.signOut();
        throw new Error("사용자 프로필이 없습니다.");
      }
      if (profile.is_active === false) {
        await supabase.auth.signOut();
        throw new Error("비활성 계정입니다. 관리자에게 문의해주세요.");
      }

      const { data: active, error: activeError } = await supabase.rpc("is_active_user");
      if (activeError || active !== true) {
        await supabase.auth.signOut();
        throw new Error("소속 로펌이 이용정지 상태이거나 사용할 수 없는 계정입니다.");
      }

      const next = searchParams.get("next");
      const defaultPath = profile.platform_role === "super_admin" ? "/platform" : "/";
      const safeNext = next && next.startsWith("/") ? next : null;
      router.replace(profile.platform_role === "super_admin" && safeNext === "/" ? "/platform" : safeNext || defaultPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f8fb] p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-600 text-white"><ShieldCheck size={22} /></div>
          <div><h1 className="text-xl font-black text-slate-900">로파워 로그인</h1><p className="text-xs text-slate-500">LawPower Multi-firm Admin</p></div>
        </div>
        {!configured ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><b>Supabase 연결정보가 없습니다.</b></div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">이메일</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 w-full rounded-lg border px-3 text-sm" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">비밀번호</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 w-full rounded-lg border px-3 text-sm" /></label>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}
            <button disabled={busy} className="h-11 w-full rounded-lg bg-blue-600 text-sm font-bold text-white disabled:opacity-50">{busy ? "로그인 중..." : "로그인"}</button>
            <div className="border-t pt-4 text-center"><Link href="/join" className="text-xs font-bold text-blue-600 hover:underline">로펌 직원 초대코드로 가입</Link></div>
          </form>
        )}
      </div>
    </main>
  );
}

function Fallback() {
  return <main className="grid min-h-screen place-items-center"><div className="text-sm text-slate-500">로그인 화면을 불러오는 중...</div></main>;
}

export default function LoginPage() {
  return <Suspense fallback={<Fallback />}><LoginForm /></Suspense>;
}
