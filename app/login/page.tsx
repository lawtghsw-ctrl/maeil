"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";

export default function LoginPage() {
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

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("role,is_active")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) {
        await supabase.auth.signOut();
        throw new Error("Supabase 초기 SQL이 적용되지 않았습니다. 설치 가이드를 확인해주세요.");
      }
      if (!profileData) {
        await supabase.auth.signOut();
        throw new Error("사용자 프로필이 없습니다. Supabase 초기 SQL을 먼저 적용해주세요.");
      }
      if (profileData.is_active === false) {
        await supabase.auth.signOut();
        throw new Error("아직 활성화되지 않은 계정입니다. 최종관리자에게 계정 활성화를 요청해주세요.");
      }

      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
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
          <div className="grid size-11 place-items-center rounded-xl bg-blue-600 text-white">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">로파워 관리자 로그인</h1>
            <p className="text-xs text-slate-500">LawPower Admin</p>
          </div>
        </div>

        {!configured ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <b>Supabase 연결정보가 없습니다.</b>
            <p className="mt-1 text-xs leading-5">프로젝트 루트의 .env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 설정한 뒤 서버를 다시 시작해주세요.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">이메일</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder="admin@example.com"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">비밀번호</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder="비밀번호"
              />
            </label>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}
            <button
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-lg bg-blue-600 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "로그인 중..." : "로그인"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
