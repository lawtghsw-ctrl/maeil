"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Plus, RefreshCcw, ShieldCheck, UsersRound } from "lucide-react";
import { authJson } from "@/lib/platform/client";

type Firm = {
  id:string; firm_code:string; name:string; representative_name?:string|null; business_number?:string|null; phone?:string|null;
  status:"active"|"suspended"; memberCount:number; leadCount:number; caseCount:number; duplicateCount:number; ingestError24hCount:number; metaPendingCount:number; metaFailedCount:number; supply24hCount:number; billable24hCount:number; activeMetaAccountCount:number; lastSheetReceivedAt?:string|null; lastMetaSuccessAt?:string|null; lastMetaErrorAt?:string|null; created_at:string;
};

export default function PlatformPage() {
  const [firms,setFirms]=useState<Firm[]>([]); const [auditLogs,setAuditLogs]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null);
  const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({name:"",representativeName:"",businessNumber:"",phone:"",adminName:"",adminEmail:"",adminPassword:""});
  async function load(){setLoading(true);setError(null);try{const r=await authJson<{firms:Firm[];auditLogs:any[]}>("/api/platform/firms");setFirms(r.firms);setAuditLogs(r.auditLogs||[])}catch(e){setError(e instanceof Error?e.message:"불러오기 실패")}finally{setLoading(false)}}
  useEffect(()=>{void load()},[]);
  const totals=useMemo(()=>({active:firms.filter(f=>f.status==="active").length,members:firms.reduce((s,f)=>s+f.memberCount,0),leads:firms.reduce((s,f)=>s+f.leadCount,0),cases:firms.reduce((s,f)=>s+f.caseCount,0)}),[firms]);
  async function create(){if(!form.name.trim())return;setBusy(true);setError(null);try{await authJson("/api/platform/firms",{method:"POST",body:JSON.stringify(form)});setOpen(false);setForm({name:"",representativeName:"",businessNumber:"",phone:"",adminName:"",adminEmail:"",adminPassword:""});await load()}catch(e){setError(e instanceof Error?e.message:"생성 실패")}finally{setBusy(false)}}
  async function toggle(f:Firm){if(!confirm(`${f.name}을(를) ${f.status==="active"?"이용정지":"활성화"}할까요?`))return;try{await authJson("/api/platform/firms",{method:"PATCH",body:JSON.stringify({id:f.id,status:f.status==="active"?"suspended":"active"})});await load()}catch(e){alert(e instanceof Error?e.message:"변경 실패")}}

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex items-center gap-2 text-xs font-black text-blue-700"><ShieldCheck size={15}/> LAWPOWER PLATFORM</div><h1 className="mt-1 text-2xl font-black text-slate-950">로펌 통합 관리</h1><p className="mt-1 text-sm text-slate-500">로펌 생성 · 상태관리 · DB/계약 현황 · 광고연동 진입점</p></div>
      <div className="flex gap-2"><button onClick={()=>void load()} className="grid size-10 place-items-center rounded-xl border bg-white"><RefreshCcw size={16}/></button><button onClick={()=>setOpen(true)} className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white"><Plus size={16}/>로펌 등록</button></div>
    </div>
    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[["전체 로펌",firms.length],["활성 로펌",totals.active],["활성 직원",totals.members],["누적 DB / 계약",`${totals.leads.toLocaleString()} / ${totals.cases.toLocaleString()}`]].map(([k,v])=><div key={String(k)} className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs font-bold text-slate-400">{k}</div><div className="mt-2 text-2xl font-black">{v}</div></div>)}
    </div>
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="border-b px-4 py-3 text-sm font-black">등록 로펌</div>
      {loading?<div className="p-8 text-center text-sm text-slate-400">불러오는 중...</div>:firms.length===0?<div className="p-8 text-center text-sm text-slate-400">등록된 로펌이 없습니다.</div>:<div className="overflow-x-auto"><table className="w-full min-w-[1220px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["로펌","10자리 ID","직원","DB/계약","24h 공급","중복","Sheet 수신","Meta","연동오류","상태","관리"].map(x=><th key={x} className="px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody>{firms.map(f=><tr key={f.id} className="border-t align-top"><td className="px-4 py-3"><div className="font-black">{f.name}</div><div className="text-xs text-slate-400">{f.representative_name||"대표자 미입력"}</div></td><td className="px-4 py-3 font-mono font-bold">{f.firm_code}</td><td className="px-4 py-3">{f.memberCount}</td><td className="px-4 py-3"><b>{f.leadCount}</b> / {f.caseCount}</td><td className="px-4 py-3"><b>{f.supply24hCount}</b><div className="text-[10px] text-slate-400">과금 {f.billable24hCount}</div></td><td className="px-4 py-3">{f.duplicateCount}</td><td className="px-4 py-3 text-xs">{f.lastSheetReceivedAt?new Date(f.lastSheetReceivedAt).toLocaleString("ko-KR"):<span className="text-slate-400">수신 없음</span>}</td><td className="px-4 py-3"><div className="text-xs">계정 {f.activeMetaAccountCount} · 대기 {f.metaPendingCount}</div><div className={`text-xs font-bold ${f.metaFailedCount?"text-red-600":"text-emerald-700"}`}>실패 {f.metaFailedCount}</div></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${f.ingestError24hCount?"bg-red-50 text-red-700":"bg-emerald-50 text-emerald-700"}`}>24h {f.ingestError24hCount}건</span></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${f.status==="active"?"bg-emerald-50 text-emerald-700":"bg-red-50 text-red-700"}`}>{f.status==="active"?"활성":"이용정지"}</span></td><td className="px-4 py-3"><div className="flex gap-2"><Link href={`/firm/settings?lawFirmId=${f.id}`} className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-slate-50">연동/초대 관리</Link><button onClick={()=>void toggle(f)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">{f.status==="active"?"정지":"활성화"}</button></div></td></tr>)}</tbody></table></div>}
    </div>
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="border-b px-4 py-3"><div className="text-sm font-black">플랫폼 감사로그</div><div className="text-[11px] text-slate-400">로펌/초대/광고연동/설정 변경의 최근 기록입니다.</div></div>
      <div className="max-h-[360px] overflow-auto">{auditLogs.length===0?<div className="p-6 text-center text-xs text-slate-400">아직 기록이 없습니다.</div>:auditLogs.slice(0,30).map((x)=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-xs text-slate-800">{x.action}</b><span className="text-[10px] text-slate-400">{new Date(x.created_at).toLocaleString("ko-KR")}</span></div><div className="mt-1 text-[11px] text-slate-500">{x.actor_name||"사용자"} · {x.target_type}{x.target_id?` · ${String(x.target_id).slice(0,16)}`:""}</div></div>)}</div>
    </div>
    {open&&<div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black">새 로펌 등록</h2><p className="text-xs text-slate-500">로펌 ID는 10자리 숫자로 자동생성됩니다.</p></div><button onClick={()=>setOpen(false)}>✕</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{[
      ["로펌명*","name"],["대표자명","representativeName"],["사업자번호","businessNumber"],["대표 연락처","phone"],["초기 관리자 이름","adminName"],["초기 관리자 이메일","adminEmail"],["초기 관리자 임시비밀번호","adminPassword"]
    ].map(([label,key],i)=><label key={key} className={i===6?"sm:col-span-2":""}><span className="mb-1 block text-xs font-bold text-slate-600">{label}</span><input type={key==="adminPassword"?"password":"text"} value={(form as any)[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} className="h-10 w-full rounded-lg border px-3 text-sm" placeholder={key==="adminPassword"?"8자 이상":""}/></label>)}</div><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setOpen(false)} className="h-10 rounded-lg border px-4 text-sm font-bold">취소</button><button onClick={()=>void create()} disabled={busy||!form.name.trim()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">{busy?"생성 중...":"로펌 생성"}</button></div></div></div>}
  </div>
}
