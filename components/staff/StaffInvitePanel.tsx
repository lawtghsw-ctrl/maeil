"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Copy, Plus, RefreshCw } from "lucide-react";
import { authJson } from "@/lib/platform/client";

type Invite = { id: string; code_preview: string; role: string; expires_at: string; used_at: string | null; revoked_at: string | null };
type IssuedInvite = { code: string; expiresAt: string; invite: { id: string }; firmName: string };
const active = (row: Invite, now: number) => !row.used_at && !row.revoked_at && Date.parse(row.expires_at) > now;
const date = (value: string) => new Date(value).toLocaleString("ko-KR");

export default function StaffInvitePanel({ lawFirmId }: { lawFirmId?: string }) {
  const [rows, setRows] = useState<Invite[]>([]), [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0), locked = useRef(false), readRequest = useRef(0);
  const endpoint = `/api/firm/invites${lawFirmId ? `?lawFirmId=${encodeURIComponent(lawFirmId)}` : ""}`;
  async function refresh(signal?: AbortSignal) {
    const scope = generation.current, request = ++readRequest.current;
    setLoading(true);
    try {
      const result = await authJson<{ invites: Invite[] }>(endpoint, { cache: "no-store", signal });
      if (scope === generation.current && request === readRequest.current) {
        const current = Date.now(); setRows(result.invites); setNow(current);
        setIssued(value => { const row = value && result.invites.find(item => item.id === value.invite.id); return row && !active(row, current) ? null : value; });
      }
    } finally { if (scope === generation.current && request === readRequest.current) setLoading(false); }
  }
  useEffect(() => {
    const scope = ++generation.current, controller = new AbortController();
    locked.current = false; setBusy(false); setRows([]); setIssued(null); setError(""); setMessage("");
    void refresh(controller.signal).catch(e => { if (scope === generation.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "초대를 불러오지 못했습니다."); });
    return () => { generation.current++; controller.abort(); };
  }, [endpoint]);
  useEffect(() => {
    const expiries = rows.filter(row => active(row, now)).map(row => Date.parse(row.expires_at));
    if (issued && Date.parse(issued.expiresAt) > now) expiries.push(Date.parse(issued.expiresAt));
    if (!expiries.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(1, Math.min(...expiries) - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [rows, issued, now]);
  async function mutate(id?: string) {
    if (locked.current) return;
    if (id && !window.confirm("이 초대코드를 취소할까요?")) return;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    const scope = generation.current;
    try {
      if (id) {
        await authJson(`/api/firm/invites?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (scope !== generation.current) return;
        setIssued(value => value?.invite.id === id ? null : value); setMessage("초대코드를 취소했습니다.");
      } else {
        const result = await authJson<IssuedInvite>("/api/firm/invites", { method: "POST", body: JSON.stringify({ role: "staff", ...(lawFirmId ? { lawFirmId } : {}) }) });
        if (scope !== generation.current) return;
        setIssued(result); setNow(Date.now()); setMessage("직원 초대코드를 발급했습니다. 아래 코드를 직원에게 전달해주세요.");
      }
      await refresh();
    } catch (e) { if (scope === generation.current) setError(e instanceof Error ? e.message : "초대 처리에 실패했습니다."); }
    finally { if (scope === generation.current) { locked.current = false; setBusy(false); } }
  }
  async function copy() {
    if (!issued || Date.parse(issued.expiresAt) <= Date.now()) return;
    const scope = generation.current;
    try { await navigator.clipboard.writeText(issued.code); if (scope === generation.current) setMessage("초대코드를 복사했습니다."); }
    catch { if (scope === generation.current) setError("복사하지 못했습니다. 표시된 코드를 직접 선택해 복사해주세요."); }
  }
  const available = rows.filter(row => active(row, now));
  return <section id="staff-invites" aria-labelledby="staff-invites-title" className="mb-5 scroll-mt-20 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="staff-invites-title" className="font-black">직원 초대</h2><p className="mt-1 text-xs leading-6 text-slate-500">24시간 · 1회용 코드입니다. 직원은 <Link href="/join" className="font-semibold text-blue-700 underline">직원 가입 페이지</Link>에서 가입하고, 가입 후 이 화면에서 계정·권한을 관리합니다.</p></div><div className="flex gap-2"><button type="button" disabled={busy || loading} onClick={() => { setError(""); void refresh().catch(e => setError(e instanceof Error ? e.message : "초대 목록 조회 실패")); }} className="flex h-9 items-center gap-1 rounded-lg border px-3 text-xs disabled:opacity-50"><RefreshCw size={14}/>초대 목록 새로고침</button><button type="button" disabled={busy || loading} onClick={() => void mutate()} className="flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-50"><Plus size={14}/>{busy ? "처리 중..." : "직원 초대코드 발급"}</button></div></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-xs text-blue-700">{message}</p>}
    {issued && Date.parse(issued.expiresAt) > now && <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><p className="text-xs text-blue-800">{issued.firmName} · 새 직원 초대코드 · 전체 코드는 발급 직후에만 표시됩니다.</p><div className="mt-2 flex flex-wrap items-center gap-3"><code className="select-all break-all font-bold text-blue-950">{issued.code}</code><button type="button" disabled={busy} onClick={() => void copy()} className="flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 text-xs"><Copy size={13}/>코드 복사</button></div><p className="mt-2 text-xs text-blue-700">만료: {date(issued.expiresAt)}</p></div>}
    <h3 className="mb-2 mt-4 text-xs font-bold text-slate-700">사용 가능한 초대 {available.length}개</h3>
    {loading ? <p className="text-xs text-slate-400">초대 목록을 불러오는 중...</p> : available.length === 0 ? <p className="text-xs text-slate-400">사용 가능한 초대코드가 없습니다.</p> : <ul className="divide-y rounded-lg border px-3">{available.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"><div><b className="font-mono">{row.code_preview}</b><span className="ml-2 text-slate-500">{row.role === "firm_admin" ? "로펌 관리자" : "직원"} · 만료 {date(row.expires_at)}</span></div><button type="button" disabled={busy} onClick={() => void mutate(row.id)} className="rounded-md border px-3 py-1.5 text-rose-700 disabled:opacity-50" aria-label={`${row.code_preview} 초대 취소`}>취소</button></li>)}</ul>}
  </section>;
}
