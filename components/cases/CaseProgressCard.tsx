"use client";
import { useStore } from "@/lib/store";
import { CASE_STAGES, type CaseRecord, type CaseStage } from "@/lib/types";
import { fmtWon } from "@/lib/format";

export default function CaseProgressCard({record}:{record:CaseRecord}) {
  const {isAdmin,profile,superAdminFirmScope,updateCase,can}=useStore();
  const manager=isAdmin&&!(profile?.platformRole==='super_admin'&&!superAdminFirmScope);
  const canEditStage=!(profile?.platformRole==='super_admin'&&!superAdminFirmScope)&&(manager||can("cases.edit_basic"));
  const canApprove=manager&&(profile?.platformRole==='super_admin'||profile?.platformRole==='firm_admin');
  const snapshot=record.feeStandardSnapshot;
  const discount=snapshot&&snapshot.baseFee>0?Math.max(0,(snapshot.baseFee-record.contractAmount)/snapshot.baseFee*100):null;
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">사건 진행 단계<select aria-label="사건 진행 단계" disabled={!canEditStage} value={record.stage} onChange={e=>{if(canEditStage)updateCase(record.id,{stage:e.target.value as CaseStage});}} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-slate-50">{CASE_STAGES.map(stage=><option key={stage}>{stage}</option>)}</select></label><div className="text-xs text-slate-500"><b className="block text-slate-600">단계 변경일</b><p className="mt-3">{record.stageUpdatedAt||"기록 없음"}</p></div></div><div className="mt-3 border-t pt-3 text-xs text-slate-500">{snapshot?<><p>계약 당시 기준 수임료 {fmtWon(snapshot.baseFee)} · 할인율 {discount?.toFixed(1)??'—'}%</p><p className="mt-1">할인 승인: {record.discountApprovedBy||"미등록"}</p>{canApprove&&discount!=null&&discount>0&&!record.discountApprovedBy&&<button className="mt-2 rounded-lg border bg-slate-50 px-3 py-2 font-semibold text-slate-700" onClick={()=>{if(confirm("현재 계약금액의 할인을 관리자 승인으로 기록할까요?"))updateCase(record.id,{discountApprovedBy:profile?.displayName||"관리자"});}}>현재 할인 승인 기록</button>}</>:<p>계약 당시 기준 수임료 기록 없음 · 과거 계약에 현재 기준을 소급하지 않습니다.</p>}</div></section>;
}
