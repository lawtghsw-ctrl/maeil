"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Building2,
  Database,
  Eye,
  FileSignature,
  Link2,
  RefreshCcw,
  ShieldCheck,
  UsersRound,
  WalletCards,
  TriangleAlert,
  Radio,
} from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { useStore } from "@/lib/store";

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtWon(value: number) { return `${Math.max(0, Number(value || 0)).toLocaleString("ko-KR")}원`; }

const tabItems = [
  ["overview", "운영현황"],
  ["members", "직원/권한"],
  ["activity", "업무활동"],
  ["supply", "DB 공급"],
  ["integration", "광고연동"],
] as const;

type TabId = typeof tabItems[number][0];

type Detail = {
  firm: any;
  metrics: any;
  members: any[];
  recentLeads: any[];
  recentCases: any[];
  recentChanges: any[];
  platformAudits: any[];
  sheets: any[];
  metaAccounts: any[];
  sources: any[];
  metaRules: any[];
  ingestErrors: any[];
  supplyLedger: any[];
};

function Kpi({ label, value, sub, icon: Icon }: { label:string; value:string|number; sub?:string; icon:any }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold text-slate-400">{label}</div><div className="mt-2 text-2xl font-black text-slate-950">{value}</div>{sub&&<div className="mt-1 text-[11px] text-slate-400">{sub}</div>}</div><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon size={18}/></span></div></div>
}

export default function PlatformFirmDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const lawFirmId = String(params?.id || "");
  const { enterSuperAdminFirmScope } = useStore();
  const [data,setData]=useState<Detail|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [tab,setTab]=useState<TabId>("overview");
  const [editOpen,setEditOpen]=useState(false);
  const [editBusy,setEditBusy]=useState(false);
  const [editForm,setEditForm]=useState({name:"",representativeName:"",businessNumber:"",phone:""});

  async function load(){
    setLoading(true); setError(null);
    try { setData(await authJson<Detail>(`/api/platform/firms/${encodeURIComponent(lawFirmId)}`)); }
    catch(e){ setError(e instanceof Error?e.message:"로펌 정보를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ if(lawFirmId) void load(); },[lawFirmId]);

  function openEdit(){
    if(!data?.firm) return;
    setEditForm({
      name:String(data.firm.name||""),
      representativeName:String(data.firm.representative_name||""),
      businessNumber:String(data.firm.business_number||""),
      phone:String(data.firm.phone||""),
    });
    setEditOpen(true);
  }
  async function saveFirm(){
    if(!data?.firm||!editForm.name.trim()) return;
    setEditBusy(true); setError(null);
    try{
      await authJson("/api/platform/firms",{method:"PATCH",body:JSON.stringify({id:data.firm.id,...editForm})});
      setEditOpen(false); await load();
    }catch(e){setError(e instanceof Error?e.message:"로펌 정보 수정 실패");}
    finally{setEditBusy(false);}
  }
  async function toggleFirmStatus(){
    if(!data?.firm) return;
    const next=data.firm.status==="active"?"suspended":"active";
    if(!window.confirm(`${data.firm.name}을(를) ${next==="suspended"?"이용정지":"활성화"}할까요?`)) return;
    try{await authJson("/api/platform/firms",{method:"PATCH",body:JSON.stringify({id:data.firm.id,status:next})});await load();}
    catch(e){setError(e instanceof Error?e.message:"상태 변경 실패");}
  }

  async function enterAdmin(path = "/"){
    if(!data?.firm) return;
    try { await authJson("/api/platform/firm-view", { method: "POST", body: JSON.stringify({ lawFirmId: data.firm.id, action: "enter" }) }); } catch {}
    enterSuperAdminFirmScope({
      id:data.firm.id,
      firmCode:String(data.firm.firm_code),
      name:String(data.firm.name),
      status:data.firm.status==="suspended"?"suspended":"active",
    });
    router.push(path);
    router.refresh();
  }

  const contractSum=useMemo(()=>data?.recentCases?.reduce((s,x)=>s+Number(x.contractAmount||0),0)??0,[data]);
  const paidSum=useMemo(()=>data?.recentCases?.reduce((s,x)=>s+Number(x.paidAmount||0),0)??0,[data]);

  if(loading) return <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-400">로펌 운영정보를 불러오는 중...</div>;
  if(error || !data) return <div className="space-y-4"><Link href="/platform" className="inline-flex items-center gap-1 text-sm font-bold text-blue-700"><ArrowLeft size={14}/> 플랫폼</Link><div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700">{error||"로펌 정보를 찾지 못했습니다."}</div></div>;

  const {firm,metrics}=data;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href="/platform" className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"><ArrowLeft size={13}/> 로파워 플랫폼</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-black text-slate-950">{firm.name}</h1><span className={`rounded-full px-2 py-1 text-xs font-black ${firm.status==="active"?"bg-emerald-50 text-emerald-700":"bg-red-50 text-red-700"}`}>{firm.status==="active"?"활성":"이용정지"}</span><span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-600">{firm.firm_code}</span></div>
        <p className="mt-1 text-sm text-slate-500">대표 {firm.representative_name||"미입력"} · 연락처 {firm.phone||"미입력"} · 과금 {firm.billing_type||"per_lead"} / DB {fmtWon(firm.lead_unit_price||0)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={()=>void load()} className="grid size-10 place-items-center rounded-xl border bg-white"><RefreshCcw size={16}/></button>
        <button onClick={openEdit} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">기본정보 수정</button>
        <button onClick={()=>void toggleFirmStatus()} className={`inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-bold ${firm.status==="active"?"border-red-200 bg-red-50 text-red-700":"border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{firm.status==="active"?"이용정지":"활성화"}</button>
        <Link href={`/firm/settings?lawFirmId=${encodeURIComponent(firm.id)}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"><Link2 size={15}/> 로펌 설정/광고연동</Link>
        <button onClick={()=>enterAdmin("/")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700"><Eye size={16}/> 로펌 어드민 보기</button>
      </div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi label="전체 DB" value={metrics.leadCount.toLocaleString()} sub={`오늘 ${metrics.leadsToday}건`} icon={Database}/>
      <Kpi label="고객 / 계약" value={`${metrics.clientCount} / ${metrics.caseCount}`} icon={FileSignature}/>
      <Kpi label="활성 직원" value={metrics.activeMembers} icon={UsersRound}/>
      <Kpi label="24h 공급" value={metrics.supply24hCount} sub={`과금 ${metrics.billable24hCount}건`} icon={WalletCards}/>
      <Kpi label="연동 이상" value={metrics.ingestError24hCount + metrics.queueFailedCount} sub={`수신오류 ${metrics.ingestError24hCount} · Meta실패 ${metrics.queueFailedCount}`} icon={TriangleAlert}/>
    </div>

    <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">
      {tabItems.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab===id?"bg-blue-600 text-white":"text-slate-600 hover:bg-slate-50"}`}>{label}</button>)}
    </div>

    {tab==="overview"&&<div className="grid gap-4 xl:grid-cols-2">
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">최근 DB</div><div className="text-[11px] text-slate-400">실제 로펌 DB관리에서 최근 접수된 고객입니다.</div></div><div className="max-h-[430px] overflow-auto"><table className="w-full min-w-[680px] text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr>{["고객","연락처","진행","담당자","유입","접수일"].map(h=><th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead><tbody>{data.recentLeads.map(x=><tr key={x.id} className="border-t"><td className="px-3 py-2 font-bold">{x.name}</td><td className="px-3 py-2 text-xs">{x.phone}</td><td className="px-3 py-2"><div className="font-semibold">{x.detailStage}</div><div className="text-[10px] text-slate-400">{x.status}</div></td><td className="px-3 py-2">{x.assignedStaff}</td><td className="px-3 py-2 text-xs">{x.adName||x.source}</td><td className="px-3 py-2 text-xs text-slate-500">{fmtDateTime(x.createdAt)}</td></tr>)}{data.recentLeads.length===0&&<tr><td colSpan={6} className="p-8 text-center text-slate-400">DB가 없습니다.</td></tr>}</tbody></table></div></section>
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">최근 계약</div><div className="text-[11px] text-slate-400">최근 계약 {data.recentCases.length}건 · 표시분 수임료 {fmtWon(contractSum)} / 납부 {fmtWon(paidSum)}</div></div><div className="max-h-[430px] overflow-auto"><table className="w-full min-w-[640px] text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr>{["사건번호","유형","단계","담당","수임료","납부"].map(h=><th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead><tbody>{data.recentCases.map(x=><tr key={x.id} className="border-t"><td className="px-3 py-2 font-bold">{x.caseNumber}</td><td className="px-3 py-2">{x.caseType}</td><td className="px-3 py-2">{x.stage}</td><td className="px-3 py-2">{x.assignedStaff}</td><td className="px-3 py-2 font-semibold">{fmtWon(x.contractAmount)}</td><td className="px-3 py-2 font-semibold text-blue-700">{fmtWon(x.paidAmount)}</td></tr>)}{data.recentCases.length===0&&<tr><td colSpan={6} className="p-8 text-center text-slate-400">계약이 없습니다.</td></tr>}</tbody></table></div></section>
    </div>}

    {tab==="members"&&<section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b px-4 py-3"><div><div className="text-sm font-black">직원 / 관리자</div><div className="text-[11px] text-slate-400">SUPER ADMIN은 로펌 어드민 보기 상태에서 직원계정관리 메뉴로 모든 권한을 수정할 수 있습니다.</div></div><button onClick={()=>enterAdmin("/staff-accounts")} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white">직원권한 직접 관리</button></div><div className="overflow-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["이름","이메일","역할","상태","실무","DB자동배정","최근 로그인"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{data.members.map(m=><tr key={m.id} className="border-t"><td className="px-4 py-3 font-black">{m.display_name||m.staff_name||"-"}</td><td className="px-4 py-3 text-xs">{m.email||"-"}</td><td className="px-4 py-3">{m.platform_role==="firm_admin"?"로펌 관리자":"직원"}</td><td className="px-4 py-3"><span className={m.is_active?"font-bold text-emerald-700":"font-bold text-red-600"}>{m.is_active?"활성":"비활성"}</span></td><td className="px-4 py-3">{m.is_work_staff?"사용":"제외"}</td><td className="px-4 py-3">{m.auto_assign_leads?`참여 · ${m.lead_assignment_order}`:"제외"}</td><td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(m.last_sign_in_at)}</td></tr>)}</tbody></table></div></section>}

    {tab==="activity"&&<div className="grid gap-4 xl:grid-cols-2">
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">로펌 실무 활동</div><div className="text-[11px] text-slate-400">직원이 DB/계약/설정에서 실제로 변경한 최근 기록입니다.</div></div><div className="max-h-[560px] overflow-auto">{data.recentChanges.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex items-center justify-between gap-2"><div className="text-xs font-black text-slate-800">{x.category} · {x.action} · {x.targetName}</div><div className="text-[10px] text-slate-400">{fmtDateTime(x.at)}</div></div><div className="mt-1 text-xs text-slate-500">{x.detail||"-"}</div><div className="mt-1 text-[10px] font-bold text-blue-700">담당 {x.staff}</div></div>)}{data.recentChanges.length===0&&<div className="p-8 text-center text-sm text-slate-400">기록이 없습니다.</div>}</div></section>
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">플랫폼/관리 변경</div><div className="text-[11px] text-slate-400">로펌·직원·광고연동·초대코드 등 관리자 변경 이력입니다.</div></div><div className="max-h-[560px] overflow-auto">{data.platformAudits.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex items-center justify-between gap-2"><div className="text-xs font-black">{x.action}</div><div className="text-[10px] text-slate-400">{fmtDateTime(x.created_at)}</div></div><div className="mt-1 text-xs text-slate-500">{x.actor_name||"사용자"} · {x.target_type}{x.target_id?` · ${String(x.target_id).slice(0,18)}`:""}</div></div>)}{data.platformAudits.length===0&&<div className="p-8 text-center text-sm text-slate-400">기록이 없습니다.</div>}</div></section>
    </div>}

    {tab==="supply"&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="24h 실제 공급" value={metrics.supply24hCount} sub="backfill 제외" icon={Database}/><Kpi label="24h 과금대상" value={metrics.billable24hCount} icon={WalletCards}/><Kpi label="누적 중복" value={metrics.duplicateCount} icon={TriangleAlert}/><Kpi label="재유입" value={metrics.reentryCount} icon={Activity}/></div>
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3 text-sm font-black">최근 DB 공급원장</div><div className="overflow-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["공급시간","판정","과금","단가","Origin","Lead ID","External Key"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{data.supplyLedger.map(x=><tr key={x.id} className="border-t"><td className="px-4 py-3 text-xs">{fmtDateTime(x.supplied_at)}</td><td className="px-4 py-3 font-bold">{x.classification}</td><td className="px-4 py-3"><span className={x.billable?"font-bold text-blue-700":"text-slate-400"}>{x.billable?"과금":"제외"}</span></td><td className="px-4 py-3">{fmtWon(x.unit_price_snapshot)}</td><td className="px-4 py-3">{x.origin}</td><td className="px-4 py-3 font-mono text-xs">{x.lead_id||"-"}</td><td className="px-4 py-3 font-mono text-xs">{x.external_key}</td></tr>)}{data.supplyLedger.length===0&&<tr><td colSpan={7} className="p-8 text-center text-slate-400">신규 공급원장이 없습니다.</td></tr>}</tbody></table></div></section>
    </div>}

    {tab==="integration"&&<div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="flex items-center gap-2 text-sm font-black"><Database size={15}/> Google Sheet</div></div><div>{data.sheets.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex justify-between gap-2"><b className="text-sm">{x.name}</b><span className={x.active?"text-xs font-bold text-emerald-700":"text-xs font-bold text-red-600"}>{x.active?"활성":"비활성"}</span></div><div className="mt-1 text-[11px] text-slate-500">{x.sheet_name} · 마지막 수신 {fmtDateTime(x.last_received_at)}</div></div>)}{data.sheets.length===0&&<div className="p-6 text-center text-xs text-slate-400">등록 없음</div>}</div></section>
        <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="flex items-center gap-2 text-sm font-black"><Radio size={15}/> Meta 광고계정</div></div><div>{data.metaAccounts.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex justify-between gap-2"><b className="text-sm">{x.name}</b><span className={x.active?"text-xs font-bold text-emerald-700":"text-xs font-bold text-red-600"}>{x.active?"활성":"비활성"}</span></div><div className="mt-1 text-[11px] text-slate-500">{x.ad_account_id||"광고계정 ID 미입력"}</div><div className="mt-1 text-[10px] text-slate-400">성공 {fmtDateTime(x.last_success_at)} · 오류 {fmtDateTime(x.last_error_at)}</div></div>)}{data.metaAccounts.length===0&&<div className="p-6 text-center text-xs text-slate-400">등록 없음</div>}</div></section>
        <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="flex items-center gap-2 text-sm font-black"><Link2 size={15}/> 광고소스</div></div><div className="max-h-72 overflow-auto">{data.sources.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex justify-between gap-2"><b className="text-sm">{x.name}</b><span className={x.active?"text-xs font-bold text-emerald-700":"text-xs font-bold text-red-600"}>{x.active?"활성":"비활성"}</span></div><div className="mt-1 font-mono text-[10px] text-slate-500">{x.source_key}</div><div className="mt-1 text-[10px] text-slate-400">Form {x.meta_form_id||"-"} · Ad {x.ad_id||"-"}</div></div>)}{data.sources.length===0&&<div className="p-6 text-center text-xs text-slate-400">등록 없음</div>}</div></section>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">Meta Queue / 자동규칙</div><div className="text-[11px] text-slate-400">대기 {metrics.queuePendingCount} · 실패 {metrics.queueFailedCount}</div></div><div>{data.metaRules.map(x=><div key={x.id} className="flex items-center justify-between border-b px-4 py-3 last:border-0"><div><div className="text-xs font-black">{x.trigger_type} · {x.trigger_value}</div><div className="mt-1 text-[11px] text-slate-500">→ {x.event_name}</div></div><span className={x.enabled?"rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700":"rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500"}>{x.enabled?"ON":"OFF"}</span></div>)}{data.metaRules.length===0&&<div className="p-6 text-center text-xs text-slate-400">규칙 없음</div>}</div></section>
        <section className="rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black text-red-700">최근 24h 수신 오류</div><div className="text-[11px] text-slate-400">{metrics.ingestError24hCount}건</div></div><div className="max-h-80 overflow-auto">{data.ingestErrors.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex justify-between gap-2"><b className="text-xs text-red-700">{x.reason}</b><span className="text-[10px] text-slate-400">{fmtDateTime(x.created_at)}</span></div><div className="mt-1 text-[10px] text-slate-500">{x.source_key||"-"} · {x.sheet_name||"-"} · row {x.row_number||"-"}</div></div>)}{data.ingestErrors.length===0&&<div className="p-6 text-center text-xs text-emerald-600">최근 오류 없음</div>}</div></section>
      </div>
    </div>}

    {editOpen&&<div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black">로펌 기본정보 수정</h2><p className="text-xs text-slate-500">SUPER ADMIN 전용</p></div><button onClick={()=>!editBusy&&setEditOpen(false)}>✕</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">로펌명<input className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={editForm.name} onChange={e=>setEditForm(v=>({...v,name:e.target.value}))}/></label><label className="text-xs font-bold text-slate-600">대표자명<input className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={editForm.representativeName} onChange={e=>setEditForm(v=>({...v,representativeName:e.target.value}))}/></label><label className="text-xs font-bold text-slate-600">사업자번호<input className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={editForm.businessNumber} onChange={e=>setEditForm(v=>({...v,businessNumber:e.target.value}))}/></label><label className="text-xs font-bold text-slate-600">대표 연락처<input className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={editForm.phone} onChange={e=>setEditForm(v=>({...v,phone:e.target.value}))}/></label></div><div className="mt-5 flex justify-end gap-2"><button disabled={editBusy} onClick={()=>setEditOpen(false)} className="h-10 rounded-lg border px-4 text-sm font-bold">취소</button><button disabled={editBusy||!editForm.name.trim()} onClick={()=>void saveFirm()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">{editBusy?"저장 중...":"저장"}</button></div></div></div>}
  </div>;
}
