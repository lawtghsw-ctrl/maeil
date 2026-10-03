"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { useStore } from "@/lib/store";

export default function AccountPage() {
  const { profile, currentUser } = useStore();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changePassword() {
    setBusy(true); setError(null); setMessage(null);
    try {
      await authJson("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setMessage("비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용해주세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "비밀번호 변경에 실패했습니다.");
    } finally { setBusy(false); }
  }

  const roleLabel = profile?.platformRole === "super_admin" ? "로파워 최상위 관리자" : profile?.platformRole === "firm_admin" ? "로펌 관리자" : "직원";
  return <div className="mx-auto max-w-2xl space-y-5">
    <div><div className="flex items-center gap-2 text-xs font-black text-blue-700"><ShieldCheck size={15}/> ACCOUNT</div><h1 className="mt-1 text-2xl font-black text-slate-950">내 계정</h1><p className="mt-1 text-sm text-slate-500">현재 로그인 계정과 비밀번호를 관리합니다.</p></div>
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-400">이름</div><div className="mt-1 font-black">{profile?.displayName || profile?.staffName || "사용자"}</div></div>
        <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-400">이메일</div><div className="mt-1 break-all font-semibold">{profile?.email || currentUser?.email || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-4 sm:col-span-2"><div className="text-xs font-bold text-slate-400">권한</div><div className="mt-1 font-black">{roleLabel}</div></div>
      </div>
    </section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 font-black"><KeyRound size={17}/>비밀번호 변경</div>
      <p className="mt-1 text-xs text-slate-500">현재 비밀번호 확인 후 새 비밀번호로 변경합니다. 새 비밀번호는 8자 이상이어야 합니다.</p>
      <div className="mt-4 space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">현재 비밀번호</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} className="h-11 w-full rounded-lg border px-3 text-sm"/></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">새 비밀번호</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} className="h-11 w-full rounded-lg border px-3 text-sm"/></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">새 비밀번호 확인</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} className="h-11 w-full rounded-lg border px-3 text-sm"/></label>
        {error&&<div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}
        {message&&<div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{message}</div>}
        <button disabled={busy||!currentPassword||newPassword.length<8||newPassword!==confirmPassword} onClick={()=>void changePassword()} className="h-11 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white disabled:opacity-50">{busy?"변경 중...":"비밀번호 변경"}</button>
      </div>
    </section>
  </div>;
}
