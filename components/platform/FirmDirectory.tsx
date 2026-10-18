"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Building2, Database, Eye, FileWarning, Plus, RefreshCcw, ShieldCheck, UsersRound, type LucideIcon } from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { useStoreSession as useStore } from "@/lib/store";
import DemoFirmSetup from "@/components/platform/DemoFirmSetup";

const PlatformPerformance = dynamic(() => import("@/components/analytics/PlatformPerformance"), { loading: () => <div role="status" className="rounded-2xl border bg-white p-8 text-center text-sm text-slate-400">판매 성과를 불러오는 중입니다.</div> });
type Firm = {
  id: string; firm_code: string; name: string; representative_name?: string | null;
  status: "active" | "suspended"; memberCount: number; leadCount: number; caseCount: number;
  integrationErrorCount: number;
  lastActivityAt?: string | null; lastActivityStaff?: string | null; lastActivityAction?: string | null;
};
type RecentActivity = { id: string; lawFirmId: string; firmName: string; category: string; action: string; targetName: string; detail: string; staff: string; at: string };
type PlatformAudit = { id: string; actor_name?: string | null; actor_role?: string | null; law_firm_id?: string | null; action: string; target_type: string; target_id?: string | null; created_at: string };
type Tab = "overview" | "performance" | "activity";

function fmtDateTime(value?: string | null) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function Kpi({ label, value, icon: Icon }: { label: string; value: string | number; icon: LucideIcon }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold text-slate-400">{label}</div><div className="mt-2 text-2xl font-black">{value}</div></div><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon size={18} aria-hidden="true"/></span></div></div>;
}

export default function FirmDirectory({ initialTab = "overview" }: { initialTab?: "overview" | "activity" }) {
  const { enterSuperAdminFirmScope, exitSuperAdminFirmScope } = useStore();
  const [firms, setFirms] = useState<Firm[]>([]), [auditLogs, setAuditLogs] = useState<PlatformAudit[]>([]), [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [tab, setTab] = useState<Tab>(initialTab);
  const [performanceOpened, setPerformanceOpened] = useState(false), [performanceRevision, setPerformanceRevision] = useState(0);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", representativeName: "", businessNumber: "", phone: "", adminName: "", adminEmail: "", adminPassword: "" });
  const loadSequence = useRef(0);

  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true); setError(null);
    try {
      const result = await authJson<{ firms: Firm[]; auditLogs: PlatformAudit[]; recentActivities: RecentActivity[] }>("/api/platform/firms?view=directory");
      if (sequence !== loadSequence.current) return;
      setFirms(result.firms); setAuditLogs(result.auditLogs || []); setRecentActivities(result.recentActivities || []);
      setPerformanceRevision(value => value + 1);
    } catch (reason) { if (sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : "불러오기 실패"); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }
  useEffect(() => { exitSuperAdminFirmScope(); void load(); return () => { loadSequence.current++; }; }, [exitSuperAdminFirmScope]);
  const totals = useMemo(() => ({
    active: firms.filter(firm => firm.status === "active").length,
    members: firms.reduce((sum, firm) => sum + firm.memberCount, 0),
    leads: firms.reduce((sum, firm) => sum + firm.leadCount, 0),
    cases: firms.reduce((sum, firm) => sum + firm.caseCount, 0),
    integrationErrors: firms.reduce((sum, firm) => sum + firm.integrationErrorCount, 0),
  }), [firms]);

  async function create(){if(!form.name.trim())return;setBusy(true);setError(null);try{await authJson('/api/platform/firms',{method:'POST',body:JSON.stringify(form)});setOpen(false);setForm({name:"",representativeName:"",businessNumber:"",phone:"",adminName:"",adminEmail:"",adminPassword:""});await load()}catch(e){setError(e instanceof Error?e.message:"생성 실패")}finally{setBusy(false)}}
  async function toggle(f:Firm){if(!confirm(`${f.name}을(를) ${f.status==="active"?"이용정지":"활성화"}할까요?`))return;try{await authJson('/api/platform/firms',{method:'PATCH',body:JSON.stringify({id:f.id,status:f.status==="active"?'suspended':'active'})});await load()}catch(e){alert(e instanceof Error?e.message:'변경 실패')}}
  async function enterFirm(f:Firm){try{await authJson('/api/platform/firm-view',{method:'POST',body:JSON.stringify({lawFirmId:f.id,action:'enter'})});enterSuperAdminFirmScope({id:f.id,firmCode:f.firm_code,name:f.name,status:f.status});window.location.href='/'}catch(e){setError(e instanceof Error?e.message:'로펌 열람 기록을 남기지 못했습니다. 다시 시도해주세요.')}}


  const tabs: [Tab, string][] = [["overview", "등록 로펌"], ["performance", "로펌별 판매 성과"], ["activity", "전체 활동로그"]];
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-xs font-black text-blue-700"><ShieldCheck size={15}/> LAWPOWER SUPER ADMIN</div><h1 className="mt-1 text-2xl font-black text-slate-950">{initialTab === "activity" ? "연동 모니터링 · 로그" : "로펌 등록 · 관리"}</h1><p className="mt-1 text-sm text-slate-500">로펌 등록과 관리, 로펌별 DB 판매 성과와 활동기록을 확인합니다.</p></div><div className="flex flex-wrap gap-2"><Link href="/analytics" className="flex h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-bold text-indigo-700"><BarChart3 size={16}/>전체 로펌 통합 분석</Link><button type="button" aria-label="플랫폼 새로고침" disabled={loading} onClick={() => void load()} className="grid size-10 place-items-center rounded-xl border bg-white disabled:opacity-40"><RefreshCcw size={16}/></button><DemoFirmSetup onCreated={() => void load()}/><button type="button" onClick={() => setOpen(true)} className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white"><Plus size={16}/>로펌 등록</button></div></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="전체 / 활성 로펌" value={loading ? "—" : firms.length + " / " + totals.active} icon={Building2}/><Kpi label="활성 직원" value={loading ? "—" : totals.members} icon={UsersRound}/><Kpi label="누적 DB / 계약" value={loading ? "—" : totals.leads + " / " + totals.cases} icon={Database}/><Kpi label="연동 이상" value={loading ? "—" : totals.integrationErrors} icon={FileWarning}/></div>
    <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm" role="tablist" aria-label="플랫폼 관리 구분">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); if (id === "performance") setPerformanceOpened(true); }} className={"rounded-xl px-4 py-2 text-sm font-bold " + (tab === id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50")}>{label}</button>)}</div>
    {tab === "overview" && <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><h2 className="text-sm font-black">등록 로펌</h2><p className="text-[11px] text-slate-400">‘어드민 보기’를 누르면 해당 로펌 화면으로 직접 들어가 DB·계약·정산·직원권한을 관리할 수 있습니다.</p></div>
      {loading ? <div role="status" className="p-8 text-center text-sm text-slate-400">불러오는 중...</div> : firms.length === 0 ? <div className="p-8 text-center text-sm text-slate-400">등록된 로펌이 없습니다.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["로펌", "10자리 ID", "직원", "DB/계약", "마지막 업무", "연동오류", "상태", "관리"].map(label => <th key={label} scope="col" className="px-4 py-3 text-left">{label}</th>)}</tr></thead><tbody>{firms.map(firm => <tr key={firm.id} className="border-t align-top hover:bg-slate-50/50">
        <td className="px-4 py-3"><div className="font-black">{firm.name}</div><div className="text-xs text-slate-400">{firm.representative_name || "대표자 미입력"}</div></td><td className="px-4 py-3 font-mono font-bold">{firm.name.trim().toUpperCase() === "TEST" ? "-" : firm.firm_code}</td><td className="px-4 py-3">{firm.memberCount}</td><td className="px-4 py-3"><b>{firm.leadCount}</b> / {firm.caseCount}</td><td className="px-4 py-3 text-xs"><div className="font-semibold">{firm.lastActivityStaff || "-"}</div><div className="text-[10px] text-slate-400">{firm.lastActivityAction || "활동 없음"} · {fmtDateTime(firm.lastActivityAt)}</div></td><td className="px-4 py-3"><span className={"rounded-full px-2 py-1 text-xs font-bold " + (firm.integrationErrorCount ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")} title="최근 24시간 수신 오류와 실패한 연동의 합계">{firm.integrationErrorCount}건</span></td><td className="px-4 py-3"><span className={"rounded-full px-2 py-1 text-xs font-bold " + (firm.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{firm.status === "active" ? "활성" : "이용정지"}</span></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void enterFirm(firm)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white hover:bg-blue-700"><Eye size={12} className="mr-1 inline"/>어드민 보기</button><Link href={"/platform/firms/" + firm.id} className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-slate-50">상세 관제</Link><Link href={"/firm/settings?lawFirmId=" + firm.id} className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-slate-50">로펌 관리</Link><button type="button" onClick={() => void toggle(firm)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">{firm.status === "active" ? "정지" : "활성화"}</button></div></td>
      </tr>)}</tbody></table></div>}
    </section>}
    {(performanceOpened || tab === "performance") && <div hidden={tab !== "performance"}><PlatformPerformance embedded refreshKey={performanceRevision}/></div>}
    {tab==='activity'&&<div className="grid gap-4 xl:grid-cols-2"><section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">전체 로펌 실무활동</div><div className="text-[11px] text-slate-400">누가 어느 로펌에서 무엇을 수정했는지 최근 100건을 보여줍니다.</div></div><div className="max-h-[620px] overflow-auto">{recentActivities.length===0?<div className="p-6 text-center text-xs text-slate-400">아직 기록이 없습니다.</div>:recentActivities.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-xs text-slate-800">{x.firmName} · {x.category} · {x.action}</b><span className="text-[10px] text-slate-400">{fmtDateTime(x.at)}</span></div><div className="mt-1 text-xs text-slate-600">{x.targetName} · {x.detail||'-'}</div><div className="mt-1 text-[10px] font-bold text-blue-700">직원 {x.staff}</div></div>)}</div></section><section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="border-b px-4 py-3"><div className="text-sm font-black">플랫폼 감사로그</div><div className="text-[11px] text-slate-400">로펌/초대/광고연동/직원권한/설정 변경의 최근 기록입니다.</div></div><div className="max-h-[620px] overflow-auto">{auditLogs.length===0?<div className="p-6 text-center text-xs text-slate-400">아직 기록이 없습니다.</div>:auditLogs.map(x=><div key={x.id} className="border-b px-4 py-3 last:border-0"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-xs text-slate-800">{x.action}</b><span className="text-[10px] text-slate-400">{fmtDateTime(x.created_at)}</span></div><div className="mt-1 text-[11px] text-slate-500">{x.actor_name||'사용자'} · {x.actor_role||'-'} · {x.target_type}</div></div>)}</div></section></div>}

    {open&&<div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black">새 로펌 등록</h2><p className="text-xs text-slate-500">로펌 ID는 10자리 숫자로 자동생성됩니다.</p></div><button onClick={()=>setOpen(false)}>✕</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{[["로펌명*","name"],["대표자명","representativeName"],["사업자번호","businessNumber"],["대표 연락처","phone"],["초기 관리자 이름","adminName"],["초기 관리자 이메일","adminEmail"],["초기 관리자 임시비밀번호","adminPassword"]].map(([label,key],i)=><label key={key} className={i===6?'sm:col-span-2':''}><span className="mb-1 block text-xs font-bold text-slate-600">{label}</span><input type={key==='adminPassword'?'password':'text'} value={(form as any)[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} className="h-10 w-full rounded-lg border px-3 text-sm" placeholder={key==='adminPassword'?'8자 이상':''}/></label>)}</div><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setOpen(false)} className="h-10 rounded-lg border px-4 text-sm font-bold">취소</button><button onClick={()=>void create()} disabled={busy||!form.name.trim()} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">{busy?'생성 중...':'로펌 생성'}</button></div></div></div>}
  </div>;
}
