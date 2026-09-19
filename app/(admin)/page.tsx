"use client";
import Link from "next/link";
import {CalendarDays,FileText,Users,WalletCards,ChevronRight} from "lucide-react";
import {Badge,Card,PageHeader} from "@/components/ui";
import {today,useAdminStore} from "@/components/store";
import {won} from "@/lib/utils";

function tone(status:string){if(status.includes("종결")||status==="수임"||status==="진행중")return "green" as const;if(status.includes("거절")||status==="부적합")return "red" as const;if(status.includes("재통화")||status==="부재중")return "amber" as const;return "blue" as const}
export default function Dashboard(){
 const {db}=useAdminStore();const t=today();
 const registered=db.matters.filter(m=>m.clientRegistered);
 const todayActions=registered.filter(m=>m.nextActionDate===t);
 const overdue=registered.filter(m=>m.nextActionDate&&m.nextActionDate<t&&!m.status.includes("종결")&&!(["거절","부적합"] as string[]).includes(m.status));
 const unsigned=db.matters.filter(m=>m.clientRegistered&&!db.contracts.some(c=>c.matterId===m.id&&c.status==="계약완료")&&["계약진행중","수임","진행중"].includes(m.status));
 const duePayments=db.payments.filter(p=>p.status!=="완료"&&p.status!=="취소"&&p.dueDate<=t);
 const paidMonth=db.payments.filter(p=>p.status==="완료"&&p.paidDate.slice(0,7)===t.slice(0,7)).reduce((a,b)=>a+b.paidAmount,0);
 const docsPending=db.documents.filter(d=>d.status==="요청"||d.status==="보완필요").length;
 return <>
  <PageHeader title="대시보드" description="사채 Admin과 같은 업무형 레이아웃을 기반으로 회생·파산 상담, 계약, 입금, 서류, 사건 진행을 한 화면에서 확인합니다."/>
  <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
   <Card className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">등록 의뢰인</span><Users size={17} className="text-blue-600"/></div><div className="mt-2 text-2xl font-bold">{new Set(registered.map(m=>m.clientId)).size}명</div><div className="mt-1 text-[11px] text-slate-400">신규 DB 미등록 {db.matters.filter(m=>!m.clientRegistered).length}건</div></Card>
   <Card className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">오늘 업무</span><CalendarDays size={17} className="text-blue-600"/></div><div className="mt-2 text-2xl font-bold">{todayActions.length}건</div><div className="mt-1 text-[11px] text-red-500">기한 경과 {overdue.length}건</div></Card>
   <Card className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">이번달 실입금</span><WalletCards size={17} className="text-emerald-600"/></div><div className="mt-2 text-xl font-bold">{won(paidMonth)}</div><div className="mt-1 text-[11px] text-slate-400">미납/확인 {duePayments.length}건</div></Card>
   <Card className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">서류 확인</span><FileText size={17} className="text-amber-600"/></div><div className="mt-2 text-2xl font-bold">{docsPending}건</div><div className="mt-1 text-[11px] text-slate-400">계약 확인 필요 {unsigned.length}건</div></Card>
  </div>

  <div className="grid gap-4 xl:grid-cols-2">
   <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><b>오늘 업무 일정</b><div className="mt-1 text-xs text-slate-400">상담·서류·사건 기한을 한 번에 확인</div></div><Link href="/customers" className="text-xs font-semibold text-blue-600">전체보기</Link></div><div className="divide-y divide-slate-100">{todayActions.length===0?<div className="px-5 py-10 text-center text-sm text-slate-400">오늘 예정된 업무가 없습니다.</div>:todayActions.slice(0,8).map(m=>{const c=db.clients.find(x=>x.id===m.clientId);return <Link key={m.id} href={`/customers?client=${m.clientId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b className="text-sm">{c?.name}</b><Badge tone={tone(m.status)}>{m.status}</Badge></div><div className="mt-1 text-xs text-slate-500">{m.nextActionType||"업무 확인"} · {m.caseType} · {m.manager}</div></div><ChevronRight size={17} className="text-slate-300"/></Link>})}</div></Card>
   <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><b>진행 현황</b><div className="mt-1 text-xs text-slate-400">상담 상태별 현재 건수</div></div><Link href="/analytics" className="text-xs font-semibold text-blue-600">집계보기</Link></div><div className="divide-y divide-slate-100">{[
    ["신규/상담예정",["신규접수","상담예정"]],["상담/재통화",["상담완료","재통화필요","고려중","부재중"]],["서류/계약",["서류검토중","계약진행중"]],["수임/진행",["수임","진행중"]],["종결",["종결(성공)","종결(중단)","거절","부적합"]]
   ].map(([label,statuses])=>{const n=db.matters.filter(m=>(statuses as string[]).includes(m.status)).length;return <div key={label as string} className="flex items-center justify-between px-5 py-3"><span className="text-sm font-semibold text-slate-700">{label as string}</span><b className="text-sm text-slate-900">{n}건</b></div>})}</div></Card>
  </div>
 </>
}
