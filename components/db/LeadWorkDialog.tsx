"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Primitives";
import { useStore } from "@/lib/store";
import type { DbLead } from "@/lib/types";

export default function LeadWorkDialog({leadId,onClose}:{leadId:string;onClose:()=>void}) {
  const { leads, updateLead, profile, currentStaff, can, superAdminFirmScope }=useStore();
  const lead=leads.find(row=>row.id===leadId);
  const [type,setType]=useState<"phone"|"sms">("phone"),[connected,setConnected]=useState("unknown"),[duration,setDuration]=useState(""),[note,setNote]=useState("");
  const [invalidReason,setInvalid]=useState(lead?.invalidReason??""),[nonContractReason,setNonContract]=useState(lead?.nonContractReason??"");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const writable=can("db.edit_consultation") && !(profile?.platformRole==="super_admin"&&!superAdminFirmScope);
  const input="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:opacity-50";
  async function save(contact:boolean,replacement=false) {
    if(!lead||busy||!writable)return;
    setBusy(true);setError("");
    const patch:Partial<DbLead>={invalidReason:invalidReason as DbLead['invalidReason']||undefined,nonContractReason:nonContractReason as DbLead['nonContractReason']||undefined};
    if(contact)patch.contactLog=[...(lead.contactLog??[]),{id:crypto.randomUUID(),at:new Date().toISOString(),staff:profile?.displayName||currentStaff||"사용자",type,connected:type==="phone"&&connected!=="unknown"?connected==="yes":undefined,durationSeconds:type==="phone"&&duration!==""?Math.max(0,Math.trunc(Number(duration))):undefined,note:note.trim()||undefined}];
    if(replacement)patch.replacementRequestedAt=lead.replacementRequestedAt??new Date().toISOString();
    const ok=await updateLead(lead.id,patch);setBusy(false);
    if(ok){setNote("");setError(contact?"컨택 기록을 저장했습니다.":replacement?"교체 검토 요청을 기록했습니다. 기존 공급·청구 금액은 변경되지 않습니다.":"사유를 저장했습니다.");}else setError("저장하지 못했습니다. 입력은 유지됩니다.");
  }
  if(!lead)return null;
  return <Modal open title={`${lead.name} · 컨택 · 사유 기록`} onClose={()=>{if(!busy)onClose();}} size="lg"><div className="space-y-5">
    <p className="text-xs text-slate-500">기록한 시점과 담당자를 상담 운영 통계에 반영합니다. 문자 기록을 남겨도 실제 문자는 발송되지 않습니다.</p>
    <fieldset disabled={!writable||busy} className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-semibold">연락 종류<select className={input} value={type} onChange={e=>setType(e.target.value as 'phone'|'sms')}><option value="phone">전화 시도</option><option value="sms">문자 발송 기록</option></select></label>{type==='phone'&&<><label className="text-xs font-semibold">연결 결과<select className={input} value={connected} onChange={e=>setConnected(e.target.value)}><option value="unknown">확인 미입력</option><option value="yes">연결</option><option value="no">미연결</option></select></label><label className="text-xs font-semibold">통화시간 (초)<input type="number" min={0} max={86400} className={input} value={duration} onChange={e=>setDuration(e.target.value)}/></label></>}</div><label className="block text-xs font-semibold">연락 내용<textarea className={`${input} !h-20 py-2`} value={note} onChange={e=>setNote(e.target.value)} maxLength={2000}/></label><button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={()=>void save(true)}>현재 시각으로 컨택 기록</button></fieldset>
    <fieldset disabled={!writable||busy} className="space-y-3 border-t pt-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">불가 사유<select className={input} value={invalidReason} onChange={e=>setInvalid(e.target.value as typeof invalidReason)}><option value="">미입력</option>{['대상 아님','연락처 오류','중복','본인 아님','기타'].map(value=><option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold">미수임 사유<select className={input} value={nonContractReason} onChange={e=>setNonContract(e.target.value as typeof nonContractReason)}><option value="">미입력</option>{['비용 부담','타사 계약','상담 거절','연락 두절','진행 보류','기타'].map(value=><option key={value}>{value}</option>)}</select></label></div><div className="flex flex-wrap gap-2"><button className="rounded-lg border bg-white px-3 py-2 text-xs font-bold" onClick={()=>void save(false)}>사유 저장</button><button disabled={!invalidReason||!!lead.replacementRequestedAt} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 disabled:opacity-40" onClick={()=>void save(false,true)}>{lead.replacementRequestedAt?'교체 검토 요청됨':'교체 검토 요청'}</button></div></fieldset>
    {error&&<p role="status" className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">{error}</p>}
    <section className="max-h-64 space-y-2 overflow-auto"><h3 className="text-sm font-bold">컨택 기록 {lead.contactLog?.length??0}건</h3>{[...(lead.contactLog??[])].sort((a,b)=>b.at.localeCompare(a.at)).map(row=><article key={row.id} className="rounded-lg border bg-slate-50 p-3 text-xs"><p className="font-bold">{row.type==='phone'?'전화':'문자'} · {row.connected===true?'연결':row.connected===false?'미연결':'결과 미입력'} · {row.staff}</p><p className="mt-1 text-slate-400">{new Date(row.at).toLocaleString('ko-KR')}{row.durationSeconds!=null?` · ${row.durationSeconds}초`:''}</p>{row.note&&<p className="mt-2 whitespace-pre-wrap text-slate-600">{row.note}</p>}</article>)}</section>
  </div></Modal>;
}
