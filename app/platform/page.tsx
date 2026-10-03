"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, Building2, Database, Eye, FileWarning, Plus, Radio, RefreshCcw, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { useStore } from "@/lib/store";

type Firm = {
  id:string; firm_code:string; name:string; representative_name?:string|null; business_number?:string|null; phone?:string|null;
  status:"active"|"suspended"; memberCount:number; leadCount:number; caseCount:number; duplicateCount:number; ingestError24hCount:number;
  metaPendingCount:number; metaFailedCount:number; supply24hCount:number; billable24hCount:number; activeMetaAccountCount:number;
  activity24hCount:number; lastActivityAt?:string|null; lastActivityStaff?:string|null; lastActivityAction?:string|null;
  lastSheetReceivedAt?:string|null; lastMetaSuccessAt?:string|null; lastMetaErrorAt?:string|null; created_at:string;
};
type RecentActivity = { id:string; lawFirmId:string; firmName:string; category:string; action:string; targetName:string; detail:string; staff:string; at:string };
type PlatformAudit = { id:string; actor_name?:string|null; actor_role?:string|null; law_firm_id?:string|null; action:string; target_type:string; target_id?:string|null; created_at:string };
type Tab = "overview"|"supply"|"integration"|"activity";

function fmtDateTime(value?:string|null){if(!value)return "-";const d=new Date(value);return Number.isNaN(d.getTime())?"-":d.toLocaleString("ko-KR",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}

function Kpi({label,value,sub,icon:Icon}:{label:string;value:string|number;sub?:string;icon:any}){return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold text-slate-400">{label}</div><div className="mt-2 text-2xl font-black">{value}</div>{sub&&<div className="mt-1 text-[11px] text-slate-400">{sub}</div>}</div><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon size={18}/></span></div></div>}

export default function PlatformPage() {
  const { enterSuperAdminFirmScope, exitSuperAdminFirmScope } = useStore();
  const [firms,setFirms]=useState<Firm[]>([]); const [auditLogs,setAuditLogs]=useState<PlatformAudit[]>([]); const [recentActivities,setRecentActivities]=useState<RecentActivity[]>([]);
  const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null); const [tab,setTab]=useState<Tab>("overview");
  const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({name:"",representativeName:"",businessNumber:"",phone:"",adminName:"",adminEmail:"",adminPassword:""});

  async function load(){setLoading(true);setError(null);try{const r=await authJson<{firms:Firm[];auditLogs:PlatformAudit[];recentActivities:RecentActivity[]}>('/api/platform/firms');setFirms(r.firms);setAuditLogs(r.auditLogs||[]);setRecentActivities(r.recentActivities||[])}catch(e){setError(e instanceof Error?e.message:"불러오기 실패")}finally{setLoading(false)}}
  useEffect(()=>{exitSuperAdminFirmScope();void load()},[exitSuperAdminFirmScope]);

  const totals=useMemo(()=>({
    active:firms.filter(f=>f.status==="active").length,
    members:firms.reduce((s,f)=>s+f.memberCount,0),
    leads:firms.reduce((s,f)=>s+f.leadCount,0),
    cases:firms.reduce((s,f)=>s+f.caseCount,0),
    supply24h:firms.reduce((s,f)=>s+f.supply24hCount,0),
    billable24h:firms.reduce((s,f)=>s+f.billable24hCount,0),
    duplicate:firms.reduce((s,f)=>s+f.duplicateCount,0),
    ingestErrors:firms.reduce((s,f)=>s+f.ingestError24hCount,0),
    metaFailed:firms.reduce((s,f)=>s+f.metaFailedCount,0),
    metaPending:firms.reduce((s,f)=>s+f.metaPendingCount,0),
    activity24h:firms.reduce((s,f)=>s+f.activity24hCount,0),
  }),[firms]);

  async function create(){if(!form.name.trim())return;setBusy(true);setError(null);try{await authJson('/api/platform/firms',{method:'POST',body:JSON.stringify(form)});setOpen(false);setForm({name:"",representativeName:"",businessNumber:"",phone:"",adminName:"",adminEmail:"",adminPassword:""});await load()}catch(e){setError(e instanceof Error?e.message:"생성 실패")}finally{setBusy(false)}}
  async function toggle(f:Firm){if(!confirm(`${f.name}을(를) ${f.status==="active"?"이용정지":"활성화"}할까요?`))return;try{await authJson('/api/platform/firms',{method:'PATCH',body:JSON.stringify({id:f.id,status:f.status==="active"?'suspended':'active'})});await load()}catch(e){alert(e instanceof Error?e.message:'변경 실패')}}
  async function enterFirm(f:Firm){
    try { await authJson('/api/platform/firm-view',{method:'POST',body:JSON.stringify({lawFirmId:f.id,action:'enter'})}); } catch {}
    enterSuperAdminFirmScope({id:f.id,firmCode:f.firm_code,name:f.name,status:f.status});
    window.location.href='/';
  }

  const tabs:[Tab,string][]=[["overview","통합현황"],["supply","DB 공급관리"],["integration","연동 모니터링"],["activity","전체 활동로그"]];

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex items-center gap-2 text-xs font-black text-blue-700"><ShieldCheck size={15}/> LAWPOWER SUPER ADMIN</div><h1 className="mt-1 text-2xl font-black text-slate-950">로파워 통합 관제센터</h1><p className="mt-1 text-sm text-slate-500">모든 로펌 · 직원 · DB · 계약 · 광고연동 · 활동기록을 최상위 권한으로 관리합니다.</p></div>
      <div className="flex gap-2"><button onClick={()=>void load()} className="grid size-10 place-items-center rounded-xl border bg-white"><RefreshCcw size={16}/></button><button onClick={()=>setOpen(true)} className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white"><Plus size={16}/>로펌 등록</button></div>
    </div>
    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Kpi label="전체 / 활성 로펌" value={`${firms.length} / ${totals.active}`} icon={Building2}/>
      <Kpi label="활성 직원" value={totals.members} icon={UsersRound}/>
      <Kpi label="누적 DB / 계약" value={`${totals.leads} / ${totals.cases}`} icon={Database}/>
      <Kpi label="24h 실제 공급" value={totals.supply24h} sub={`과금 ${totals.billable24h}건`} icon={WalletCards}/>
      <Kpi label="24h 업무활동" value={totals.activity24h} icon={Activity}/>
      <Kpi label="연동 이상" value={totals.ingestErrors+totals.metaFailed} sub={`수신 ${totals.ingestErrors} · Meta ${totals.metaFailed}`} icon={FileWarning}/>
    </div>

    <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab===id?'bg-blue-600 text-white':'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</div>

    {tab==='overview'&&<div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="border-b px-4 py-3"><div className="text-sm font-black">등록 로펌</div><div className="text-[11px] text-slate-400">‘어드민 보기’를 누르면 해당 로펌 화면으로 직접 들어가 DB·계약·정산·직원권한까지 수정할 수 있습니다.</div></div>
      {loading?<div className="p-8 text-center text-sm text-slate-400">불러오는 중...</div>:firms.length===0?<div className="p-8 text-center text-sm text-slate-400">등록된 로펌이 없습니다.</div>:<div className="overflow-x-auto"><table className="w-full min-w-[1500px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["로펌","10자리 ID","직원","DB/계약","24h 공급","중복","24h 활동","마지막 업무","Sheet 수신","Meta","연동오류","상태","관리"].map(x=><th key={x} className="px-4 py-3 text-left">{x}</th>)}</tr></thead><tbody>{firms.map(f=><tr key={f.id} className="border-t align-top hover:bg-slate-50/50"><td className="px-4 py-3"><div className="font-black">{f.name}</div><div className="text-xs text-slate-400">{f.representative_name||'대표자 미입력'}</div></td><td className="px-4 py-3 font-mono font-bold">{f.firm_code}</td><td className="px-4 py-3">{f.memberCount}</td><td className="px-4 py-3"><b>{f.leadCount}</b> / {f.caseCount}</td><td className="px-4 py-3"><b>{f.supply24hCount}</b><div className="text-[10px] text-slate-400">과금 {f.billable24hCount}</div></td><td className="px-4 py-3">{f.duplicateCount}</td><td className="px-4 py-3 font-bold text-blue-700">{f.activity24hCount}</td><td className="px-4 py-3 text-xs"><div className="font-semibold">{f.lastActivityStaff||'-'}</div><div className="text-[10px] text-slate-400">{f.lastActivityAction||'활동 없음'} · {fmtDateTime(f.lastActivityAt)}</div></td><td className="px-4 py-3 text-xs">{f.lastSheetReceivedAt?fmtDateTime(f.lastSheetReceivedAt):<span className="text-slate-400">수신 없음</span>}</td><td className="px-4 py-3"><div className="text-xs">계정 {f.activeMetaAccountCount} · 대기 {f.metaPendingCount}</div><div className={`text-xs font-bold ${f.metaFailedCount?'text-red-600':'text-emerald-700'}`}>실패 {f.metaFailedCount}</div></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${f.ingestError24hCount?'bg-red-50 text-red-700':'bg-emerald-50 text-emerald-700'}`}>24h {f.ingestError24hCount}건</span></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${f.status==='active'?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>{f.status==='active'?'활성':'이용정지'}</span></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button onClick={()=>enterFirm(f)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white hover:bg-blue-700"><Eye size={12} className="mr-1 inline"/>어드민 보기</button><Link href={`/platform/firms/${f.id}`} className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-slate-50">상세 관제</Link><Link href={`/firm/settings?lawFirmId=${f.id}`} className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-slate-50">로펌 관리</Link><button onClick={()=>void toggle(f)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">{f.status==='active'?'정지':'활성화'}</button></div></td></tr>)}</tbody></table></div>}
    </div>}

    {tab==='supply'&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="24h 실제 공급" value={totals.supply24h} sub="migration backfill 제외" icon={Database}/><Kpi label="24h 과금대상" value={totals.billable24h} icon={WalletCards}/><Kpi label="누적 중복판정" value={totals.duplicate} icon={FileWarning}/><Kpi label="로펌 수" value={firms.length} icon={Building2}/></div>
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3 text-sm font-black">로펌별 공급현황</div><div className="overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["로펌","24h 공급","24h 과금","누적 DB","중복","상세"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{firms.map(f=><tr key={f.id} className="border-t"><td className="px-4 py-3 font-black">{f.name}</td><td className="px-4 py-3 font-bold">{f.supply24hCount}</td><td className="px-4 py-3 font-bold text-blue-700">{f.billable24hCount}</td><td className="px-4 py-3">{f.leadCount}</td><td className="px-4 py-3">{f.duplicateCount}</td><td className="px-4 py-3"><Link href={`/platform/firms/${f.id}`} className="font-bold text-blue-700 hover:underline">공급원장 보기</Link></td></tr>)}</tbody></table></div></section>
    </div>}

    {tab==='integration'&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Meta 대기" value={totals.metaPending} icon={Radio}/><Kpi label="Meta 실패" value={totals.metaFailed} icon={FileWarning}/><Kpi label="24h Sheet 오류" value={totals.ingestErrors} icon={Database}/><Kpi label="정상 로펌" value={firms.filter(f=>f.ingestError24hCount===0&&f.metaFailedCount===0).length} icon={ShieldCheck}/></div>
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3 text-sm font-black">광고/DB 연동 모니터링</div><div className="overflow-auto"><table className="w-full min-w-[1180px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["로펌","Meta 계정","대기","실패","Sheet 마지막 수신","Meta 마지막 성공","Meta 마지막 오류","24h 수신오류","관리"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{firms.map(f=><tr key={f.id} className="border-t"><td className="px-4 py-3 font-black">{f.name}</td><td className="px-4 py-3">{f.activeMetaAccountCount}</td><td className="px-4 py-3">{f.metaPendingCount}</td><td className={`px-4 py-3 font-bold ${f.metaFailedCount?'text-red-600':'text-emerald-700'}`}>{f.metaFailedCount}</td><td className="px-4 py-3 text-xs">{fmtDateTime(f.lastSheetReceivedAt)}</td><td className="px-4 py-3 text-xs">{fmtDateTime(f.lastMetaSuccessAt)}</td><td className="px-4 py-3 text-xs">{fmtDateTime(f.lastMetaErrorAt)}</td><td className={`px-4 py-3 font-bold ${f.ingestError24hCount?'text-red-600':'text-emerald-700'}`}>{f.ingestError24hCount}</td><td className="px-4 py-3"><Link href={`/platform/firms/${f.id}`} className="font-bold text-blue-700 hover:underline">상세 확인</Link></td></tr>)}</tbody></table></div></section>
    </div>}

    {tab==='activity'&&<div className="grid gap-4 xl:grid-cols-2">
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">전체 로펌 실무활동</div><div className="text-[11px] text-slate-400">누가 어느 로펌에서 무엇을 수정했는지 최근 100건을 보여줍니다.</div></div><div className="max-h-[620px] overflow-auto">{recentActivities.length===0?<div className="p-6 text-center text-xs text-slate-400">아직 기록이 없습니다.</div>:recentActivities.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-xs text-slate-800">{x.firmName} · {x.category} · {x.action}</b><span className="text-[10px] text-slate-400">{fmtDateTime(x.at)}</span></div><div className="mt-1 text-xs text-slate-600">{x.targetName} · {x.detail||'-'}</div><div className="mt-1 text-[10px] font-bold text-blue-700">직원 {x.staff}</div></div>)}</div></section>
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">플랫폼 감사로그</div><div className="text-[11px] text-slate-400">로펌/초대/광고연동/직원권한/설정 변경의 최근 기록입니다.</div></div><div className="max-h-[620px] overflow-auto">{auditLogs.length===0?<div className="p-6 text-center text-xs text-slate-400">아직 기록이 없습니다.</div>:auditLogs.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-xs text-slate-800">{x.action}</b><span className="text-[10px] text-slate-400">{fmtDateTime(x.created_at)}</span></div><div className="mt-1 text-[11px] text-slate-500">{x.actor_name||'사용자'} · {x.actor_role||'-'} · {x.target_type}</div></div>)}</div></section>
    </div>}

    {open&&<div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black">새 로펌 등록</h2><p className="text-xs text-slate-500">로펌 ID는 10자리 숫자로 자동생성됩니다.</p></div><button onClick={()=>setOpen(false)}>✕</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{[["로펌명*","name"],["대표자명","representativeName"],["사업자번호","businessNumber"],["대표 연락처","phone"],["초기 관리자 이름","adminName"],["초기 관리자 이메일","adminEmail"],["초기 관리자 임시비밀번호","adminPassword"]].map(([label,key],i)=><label key={key} className={i===6?'sm:col-span-2':''}><span className="mb-1 block text-xs font-bold text-slate-600">{label}</span><input type={key==='adminPassword'?'password':'text'} value={(form as any)[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} className="h-10 w-full rounded-lg border px-3 text-sm" placeholder={key==='adminPassword'?'8자 이상':''}/></label>)}</div><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setOpen(false)} className="h-10 rounded-lg border px-4 text-sm font-bold">취소</button><button onClick={()=>void create()} disabled={busy||!form.name.trim()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">{busy?'생성 중...':'로펌 생성'}</button></div></div></div>}
  </div>
}
