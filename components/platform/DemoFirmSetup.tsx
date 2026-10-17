"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FlaskConical, X } from "lucide-react";
import { authJson } from "@/lib/platform/client";

type DemoResult = {
  firmId: string;
  alreadyExists: boolean;
  accounts: { loginId: string; displayName: string; role: string }[];
  counts: { leads: number; clients: number; cases: number; installments: number; schedules: number; posts: number };
};

export default function DemoFirmSetup({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<DemoResult | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null), opener = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) passwordInput.current?.focus(); }, [open]);
  function close() { if (busy) return; setOpen(false); setPassword(""); setError(""); setResult(null); opener.current?.focus(); }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length < 8 || password.length > 128) return;
    setBusy(true); setError("");
    try {
      const response = await authJson<DemoResult>("/api/platform/demo-firm", { method: "POST", body: JSON.stringify({ password, confirmation: "CREATE_TEST_DEMO" }) });
      if (!response || typeof response.firmId !== "string" || !Array.isArray(response.accounts) || !response.counts) throw new Error("생성 결과를 확인하지 못했습니다. 로그인 상태를 확인한 뒤 다시 시도해주세요.");
      setResult(response); setPassword(""); onCreated?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "시연 로펌 생성에 실패했습니다."); }
    finally { setBusy(false); }
  }
  return <>
    <button ref={opener} type="button" onClick={() => setOpen(true)} className="flex h-10 items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 text-sm font-bold text-violet-700"><FlaskConical size={16}/>TEST 시연 로펌</button>
    {open && <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-slate-950/45 p-4" onKeyDown={event => { if (event.key === "Escape") close(); if (event.key === "Tab") { const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')); const first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}>
      <section role="dialog" aria-modal="true" aria-labelledby="demo-firm-title" aria-busy={busy} className="my-auto w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h2 id="demo-firm-title" className="text-lg font-black text-slate-900">TEST 영업 시연 로펌</h2><p className="mt-1 text-xs leading-5 text-slate-500">실제 고객 정보 없이 DB·계약·수납·직원 성과를 보여주는 가상 로펌을 만듭니다.</p></div><button type="button" disabled={busy} aria-label="시연 로펌 설정 닫기" onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-40"><X size={18}/></button></div>
        {result ? <div className="mt-5 space-y-4"><p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{result.alreadyExists ? "이미 준비된 TEST 시연 로펌을 확인했습니다. 기존 내용과 비밀번호는 유지됩니다." : "TEST 로펌과 시연용 계정·데이터를 생성했습니다."}</p><div className="rounded-xl border border-slate-200 p-4 text-sm"><b>로그인 아이디</b><div className="mt-2 grid grid-cols-2 gap-2">{result.accounts.map(account => <div key={account.loginId} className="rounded-lg bg-slate-50 p-2"><b className="font-mono">{account.loginId}</b><div className="mt-1 text-xs text-slate-500">{account.displayName} · {account.role === "firm_admin" ? "로펌관리자" : "직원"}</div></div>)}</div></div><p className="text-xs leading-6 text-slate-500">시연 DB {result.counts.leads}건 · 고객 {result.counts.clients}명 · 계약 {result.counts.cases}건 · 수납 {result.counts.installments}건 · 일정 {result.counts.schedules}건<br/>관리자는 직원 집계에서 제외되며 직원은 TEST1·TEST2·TEST3입니다.</p><button type="button" onClick={close} className="h-10 w-full rounded-lg bg-blue-600 text-sm font-bold text-white">확인</button></div> : <form onSubmit={event => void create(event)} className="mt-5 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600"><b className="text-slate-900">TEST 관리자: test · 직원: test1 / test2 / test3</b><br/>DB 12건 · 고객/계약 각 4건 · 수납 8건 · 일정 3건을 준비합니다.<br/>TEST에만 가상 데이터를 넣으며, 기존 로펌의 데이터는 수정하지 않습니다.<br/>이미 생성이 완료된 경우 비밀번호와 데이터는 덮어쓰지 않습니다.</div>
          <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">시연 계정 공통 비밀번호</span><input ref={passwordInput} aria-label="시연 계정 공통 비밀번호" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} placeholder="8자 이상 입력" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-400"/></label>
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs leading-5 text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="h-10 rounded-lg border px-4 text-sm font-bold disabled:opacity-40">취소</button><button type="submit" disabled={busy || password.length < 8} className="h-10 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40">{busy ? "시연 로펌 준비 중…" : "TEST 로펌·계정·시연 데이터 생성"}</button></div>
        </form>}
      </section>
    </div>}
  </>;
}
