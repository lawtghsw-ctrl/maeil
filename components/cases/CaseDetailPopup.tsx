"use client";

// 계약관리 [상세]: DB 상담일지처럼 한 화면에서 계약 재무/회차를 편집합니다.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useStore, type InstallmentDraft } from "@/lib/store";
import type { CaseRecord, Client, InstallmentStatus, PaymentMethod } from "@/lib/types";
import { PAYMENT_METHOD_NOTE } from "@/lib/types";
import { fmtWon } from "@/lib/format";
import { CaseActionPanel, PriorityRepaymentGuideTable } from "@/components/cases/CaseActionModals";
import { Button, Modal } from "@/components/ui/Primitives";

const statuses: InstallmentStatus[] = ["예정", "완료", "연체", "실패"];
const paymentMethods = Object.keys(PAYMENT_METHOD_NOTE) as PaymentMethod[];
const input = "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-500 disabled:bg-slate-100";

function MoneyInput({value,onChange,disabled=false}: {value:number;onChange:(v:number)=>void;disabled?:boolean}) {
  return <div className="flex items-center gap-1"><input className={input} type="text" inputMode="numeric" disabled={disabled} value={value.toLocaleString("ko-KR")} onChange={e=>onChange(Number(e.target.value.replace(/[^0-9]/g,""))||0)}/><span className="shrink-0 text-xs text-slate-500">원</span></div>;
}

export function CaseDetailPopup({caseId,onClose}: {caseId:string|null;onClose:()=>void}) {
  const {cases,clients,installments,setCaseInstallments,can} = useStore();
  const record = cases.find(c=>c.id===caseId);
  const client = clients.find(c=>c.id===record?.clientId);
  const permitted = can("cases.manage_installments");
  const [rows,setRows] = useState<InstallmentDraft[]>([]);
  const [totalDebt,setTotalDebt] = useState(0);
  const [contractAmount,setContractAmount] = useState(0);
  const [paidAmount,setPaidAmount] = useState(0);
  const [paymentMethod,setPaymentMethod] = useState<PaymentMethod>("단순분납");
  const [saving,setSaving] = useState(false);
  const [changed,setChanged] = useState(false);
  const [notice,setNotice] = useState("");

  useEffect(()=>{
    if(!record || !caseId) return;
    const items: InstallmentDraft[] = installments.filter(i=>i.caseId===caseId).sort((a,b)=>a.seq-b.seq)
      .map(i=>({id:i.id,dueDate:i.dueDate,amount:i.amount,status:i.status,paidDate:i.paidDate}));
    const full: InstallmentDraft[] = [...items];
    const count=Math.min(60,Math.max(0,record.installmentCount??items.length));
    while(full.length<count)full.push({dueDate:"",amount:0,status:"예정",paidDate:undefined});
    setRows(full);
    setTotalDebt(record.totalDebt);
    setContractAmount(record.contractAmount);
    setPaidAmount(record.paidAmount);
    setPaymentMethod(record.paymentMethod);
    setChanged(false);setNotice("");
  },[caseId]); // 다른 계약으로 전환할 때 초기화; 저장 성공 후에는 별도 최신값 사용

  function editRow(i:number,p:Partial<InstallmentDraft>){setRows(v=>v.map((r,j)=>i===j?{...r,...p}:r));setChanged(true);}
  function changeCount(n:number){const count=Math.max(0,Math.min(60,Math.trunc(n||0)));setRows(prev=>{const a=[...prev];while(a.length<count)a.push({dueDate:"",amount:0,status:"예정",paidDate:undefined});return a.slice(0,count)});setChanged(true);}
  function safeClose(){if(saving)return;if(changed&&!window.confirm("저장하지 않은 계약/분납 변경사항이 있습니다. 닫으시겠습니까?"))return;onClose();}
  async function save(){
    if(!record || saving || !permitted)return;
    if(rows.some(r=>r.amount>0&&!r.dueDate)){setNotice("납부금액이 있는 회차에는 납부예정일을 입력해주세요.");return;}
    setSaving(true);setNotice("");
    const success=await setCaseInstallments(record.id,rows.filter(r=>r.dueDate),{
      totalDebt,contractAmount,paidAmount,installmentCount:rows.length,paymentMethod
    });
    setSaving(false);
    if(success){setChanged(false);setNotice("저장되었습니다. 계약목록과 정산에도 변경 금액이 반영됩니다.");}
    else setNotice("저장 실패: 계정 권한 또는 서버 연결을 확인해주세요. 입력값은 유지됩니다.");
  }
  if(!record||!client||!caseId)return null;
  const outstanding=Math.max(0,contractAmount-paidAmount);
  return <Modal open={true} title={`${client.name} · 계약 상세`} size="full" onClose={safeClose}
    headerExtra={<span className="text-xs font-semibold text-slate-500">{record.caseNumber}</span>}>
    <div className="space-y-3 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        <span><b>{record.caseType}</b> · {record.court} · 담당 {record.assignedStaff} · {client.phone}</span>
        <span className="text-slate-500">계약일 {record.contractDate} · 진행상태 {record.status}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-300">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-slate-200 lg:border-r">
            <label className="flex items-center justify-center bg-slate-100 px-2 text-xs font-bold text-slate-600">총 채무액</label>
            <div className="p-2"><MoneyInput value={totalDebt} disabled={!permitted} onChange={v=>{setTotalDebt(v);setChanged(true)}}/></div>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-slate-200">
            <label className="flex items-center justify-center bg-slate-100 px-2 text-xs font-bold text-slate-600">총 수임료</label>
            <div className="p-2"><MoneyInput value={contractAmount} disabled={!permitted} onChange={v=>{setContractAmount(v);setChanged(true)}}/></div>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-slate-200 lg:border-r">
            <label className="flex items-center justify-center bg-slate-100 px-2 text-xs font-bold text-slate-600">납부금액</label>
            <div className="p-2"><MoneyInput value={paidAmount} disabled={!permitted} onChange={v=>{setPaidAmount(v);setChanged(true)}}/></div>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-slate-200">
            <label className="flex items-center justify-center bg-slate-100 px-2 text-xs font-bold text-slate-600">결제방법</label>
            <div className="p-2"><select className={input} disabled={!permitted} value={paymentMethod} onChange={e=>{setPaymentMethod(e.target.value as PaymentMethod);setChanged(true)}}>{paymentMethods.map(m=><option key={m}>{m}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] lg:border-r">
            <label className="flex items-center justify-center bg-slate-100 px-2 text-xs font-bold text-slate-600">납부회차</label>
            <div className="flex items-center gap-2 p-2"><input className={input} type="number" min={0} max={60} disabled={!permitted} value={rows.length} onChange={e=>changeCount(Number(e.target.value))}/><span className="text-xs text-slate-500">회</span></div>
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)]">
            <label className="flex items-center justify-center bg-slate-100 px-2 text-xs font-bold text-slate-600">현재 미수금</label>
            <div className="flex items-center px-3 text-sm font-bold text-red-600">{fmtWon(outstanding)}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-bold text-slate-800">분납 일정 / 실입금 내역</h3><div className="flex flex-wrap gap-2">{permitted&&<Button variant="secondary" onClick={()=>{setRows(v=>[...v,{dueDate:"",amount:0,status:"예정"}]);setChanged(true)}}><Plus size={13}/> 회차 추가</Button>}{<CaseActionPanel client={client} caseRecord={record} showInstallment={false}/>}</div></div>
      <div className="overflow-x-auto rounded-lg border border-slate-300">
        <table className="w-full min-w-[790px] border-collapse text-xs">
          <thead className="bg-slate-100 text-slate-700"><tr>{["회차","상환일","납부예정금액","납부상태","실납부금액","실제 입금일","관리"].map(t=><th key={t} className="border-b border-r border-slate-200 px-2 py-3">{t}</th>)}</tr></thead>
          <tbody>{rows.map((row,i)=><tr key={row.id??`new-${i}`} className="border-b border-slate-200">
            <td className="w-[80px] px-2 text-center">{i===0?"계약금":`${i}회차`}</td>
            <td className="px-2 py-1"><input className={input} type="date" disabled={!permitted} value={row.dueDate} onChange={e=>editRow(i,{dueDate:e.target.value})}/></td>
            <td className="px-2 py-1"><MoneyInput value={row.amount} disabled={!permitted} onChange={v=>editRow(i,{amount:v})}/></td>
            <td className="px-2 py-1"><select className={input} disabled={!permitted} value={row.status} onChange={e=>editRow(i,{status:e.target.value as InstallmentStatus})}>{statuses.map(s=><option key={s}>{s}</option>)}</select></td>
            <td className="px-2 py-1 text-right text-slate-500">{row.status==="완료"?fmtWon(row.amount):"0원"}</td>
            <td className="px-2 py-1"><input className={input} type="date" disabled={!permitted} value={row.paidDate??""} onChange={e=>editRow(i,{paidDate:e.target.value})}/></td>
            <td className="px-2 py-1 text-center"><button type="button" className="rounded border border-red-200 px-2 py-1.5 text-red-600 disabled:opacity-30" disabled={!permitted} onClick={()=>{setRows(v=>v.filter((_,j)=>i!==j));setChanged(true)}}><Trash2 size={14}/></button></td>
          </tr>)}{!rows.length&&<tr><td colSpan={7} className="p-5 text-center text-slate-400">등록된 분납 일정이 없습니다.</td></tr>}</tbody>
        </table>
      </div>
      <div className="rounded-lg border border-slate-200 p-3"><h3 className="mb-2 text-sm font-bold">최우선변제금액 안내표</h3><PriorityRepaymentGuideTable/></div>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t bg-white py-3">
        <span className={`text-xs ${notice.includes("실패")||notice.includes("입력")?"text-red-600":"text-blue-700"}`}>{notice|| (changed?"저장하지 않은 변경사항이 있습니다.":"금액 및 회차를 확인해주세요.")}</span>
        <div className="flex gap-2"><Button variant="secondary" onClick={safeClose}>닫기</Button>{permitted&&<Button disabled={saving||!changed} onClick={()=>void save()}>{saving?"저장 중...":"계약·분납정보 저장"}</Button>}</div>
      </div>
    </div>
  </Modal>;
}
