"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Percent } from "lucide-react";
import { useStore } from "@/lib/store";
import { PAYMENT_METHOD_NOTE, type StaffName } from "@/lib/types";
import {
  DEFAULT_MANAGEMENT_SETTINGS,
  acquisitionCostForRange,
  cashByStaff,
  effectiveFinancialConfig,
  fixedCostForRange,
  inDateRange,
  isManagerProfile,
  laborCostForRange,
  paymentFeeFor,
  paymentFeesForRange,
  staffCompensationForRange,
  useManagementSettings,
  type ManagementSettings,
} from "@/lib/management-analytics";
import { fmtDate, fmtWon } from "@/lib/format";
import { Card, PageHeader, Pagination, pageRows } from "@/components/ui/Primitives";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KpiCard } from "@/components/ui/KpiCard";

import { actualPayment, isValidRetainer } from "@/lib/firm-reporting";
import { useFirmSupply } from "@/lib/use-firm-supply";
import { closedTotalsForRange } from "@/lib/management-core";
import { recordManagementExport } from "@/lib/management-export-client";

function monthRange(){const d=new Date();const y=d.getFullYear(),m=d.getMonth()+1;return{start:`${y}-${String(m).padStart(2,"0")}-01`,end:`${y}-${String(m).padStart(2,"0")}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`}}
function downloadCsv(rows:Array<Record<string,string|number>>,filename:string){if(!rows.length)return;const h=Object.keys(rows[0]);const q=(v:string|number)=>`"${String(v??"").replace(/"/g,'""')}"`;const blob=new Blob(["\ufeff"+[h.join(","),...rows.map(r=>h.map(k=>q(r[k])).join(","))].join("\n")],{type:"text/csv;charset=utf-8"});const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=filename;a.click();URL.revokeObjectURL(u)}
function settingsForFirm(map:Record<string,ManagementSettings>,firmId?:string,fallback?:ManagementSettings){return firmId&&map[firmId]?map[firmId]:(fallback||DEFAULT_MANAGEMENT_SETTINGS)}

export default function SettlementsPage(){
  const {cases,clients,installments,leads,workStaffNames,can,currentStaff,profile,superAdminFirmScope,firmDirectory}=useStore();
  const manager=isManagerProfile(profile); const {globalSuperView,effectiveFirmId,activeSettings,settingsByFirm,loading:settingsLoading,error:settingsError}=useManagementSettings(profile,superAdminFirmScope,workStaffNames);
  const init=monthRange();const[start,setStart]=useState(init.start);const[end,setEnd]=useState(init.end);const[page,setPage]=useState(1);
  const supply=useFirmSupply(effectiveFirmId,start,end,manager);
  const costKnown=!!supply.data&&supply.data.purchaseCost!==null&&!supply.error&&!settingsError;
  const closed=closedTotalsForRange(activeSettings,start,end);
  const scopedCases=useMemo(()=>can("settlements.view_all")?cases:cases.filter(c=>!!currentStaff&&c.assignedStaff===currentStaff),[can,cases,currentStaff]);
  const scopedIds=useMemo(()=>new Set(scopedCases.map(c=>c.id)),[scopedCases]);
  const periodCases=useMemo(()=>scopedCases.filter(c=>inDateRange(c.contractDate,start,end)&&isValidRetainer(c)),[scopedCases,start,end]);
  const paidRows=useMemo(()=>installments.filter(i=>scopedIds.has(i.caseId)&&i.status==="완료"&&inDateRange(i.paidDate,start,end)).map(i=>{const c=cases.find(x=>x.id===i.caseId);const client=c?clients.find(x=>x.id===c.clientId):undefined;return{installment:i,case:c,client}}).sort((a,b)=>(b.installment.paidDate||"").localeCompare(a.installment.paidDate||"")),[installments,scopedIds,cases,clients,start,end]);
  const contractSales=closed?.contractSales??periodCases.filter(isValidRetainer).reduce((s,c)=>s+c.contractAmount,0),cashSales=closed?.cashSales??paidRows.reduce((s,r)=>s+actualPayment(r.installment),0),receivable=scopedCases.reduce((s,c)=>s+Math.max(0,c.contractAmount-c.paidAmount),0);

  function sumGlobal(kind:"acq"|"labor"|"fee"|"fixed"){
    if(!manager)return 0;
    if(!globalSuperView){if(kind==="acq")return acquisitionCostForRange(leads,activeSettings,start,end);if(kind==="labor")return laborCostForRange(cases,installments,activeSettings,start,end);if(kind==="fee")return paymentFeesForRange(cases,installments,activeSettings,start,end);return fixedCostForRange(activeSettings,start,end)}
    const fallbackIds=Array.from(new Set(cases.map(c=>c._lawFirmId).concat(leads.map(l=>l._lawFirmId)).filter(Boolean) as string[]));
    const ids=firmDirectory.filter(f=>f.status==="active").map(f=>f.id).length?firmDirectory.filter(f=>f.status==="active").map(f=>f.id):fallbackIds;
    return ids.reduce((sum,id)=>{const s=settingsForFirm(settingsByFirm,id);const fc=cases.filter(c=>c._lawFirmId===id);const fl=leads.filter(l=>l._lawFirmId===id);const fi=installments.filter(i=>i._lawFirmId===id||fc.some(c=>c.id===i.caseId));if(kind==="acq")return sum+acquisitionCostForRange(fl,s,start,end);if(kind==="labor")return sum+laborCostForRange(fc,fi,s,start,end);if(kind==="fee")return sum+paymentFeesForRange(fc,fi,s,start,end);return sum+fixedCostForRange(s,start,end)},0)
  }
  const acquisition=closed?.purchaseCost??supply.data?.purchaseCost??0,labor=closed?.laborCost??(manager?sumGlobal("labor"):0),paymentFees=closed?.paymentFees??(manager?sumGlobal("fee"):0),fixed=closed?.fixedCost??(manager?sumGlobal("fixed"):0);
  const netCashSales=cashSales-paymentFees;
  const operatingProfit=cashSales-acquisition-labor-paymentFees-fixed;
  const cashProfitPerContract=periodCases.length?operatingProfit/periodCases.length:0;

  const staffRows=useMemo(()=>{
    const keys=new Map<string,{key:string,label:string,staff:string,firmId?:string}>();
    for(const c of periodCases){
      const key=globalSuperView?`${c._lawFirmId??"none"}::${c.assignedStaff}`:String(c.assignedStaff);
      keys.set(key,{key,label:globalSuperView?`${c._lawFirmName??"로펌"} · ${c.assignedStaff}`:String(c.assignedStaff),staff:String(c.assignedStaff),firmId:c._lawFirmId});
    }
    return Array.from(keys.values()).map(k=>{
      const pc=periodCases.filter(c=>c.assignedStaff===k.staff&&(!globalSuperView||c._lawFirmId===k.firmId));
      const allc=scopedCases.filter(c=>c.assignedStaff===k.staff&&(!globalSuperView||c._lawFirmId===k.firmId));
      const fi=installments.filter(i=>allc.some(c=>c.id===i.caseId));
      const setting=settingsForFirm(settingsByFirm,k.firmId,activeSettings);
      const cash=cashByStaff(allc,fi,start,end).get(k.staff)??0;
      const comp=manager?staffCompensationForRange(k.staff,allc,fi,setting,start,end):0;
      const firmLeads=leads.filter(l=>(!globalSuperView||l._lawFirmId===k.firmId)&&inDateRange(l.receivedAt,start,end));
      const staffLeads=firmLeads.filter(l=>l.assignedStaff===k.staff);
      const firmAcq=manager?(supply.data?.purchaseCost??0):0;
      const allocated=firmLeads.length?firmAcq*(staffLeads.length/firmLeads.length):0;
      const contract=pc.reduce((x,c)=>x+c.contractAmount,0);
      const paid=pc.reduce((x,c)=>x+c.paidAmount,0);
      return{key:k.key,staff:k.label,count:pc.length,contract,cash,comp,contribution:contract-allocated-comp,paymentRate:contract>0?paid/contract*100:0};
    }).sort((a,b)=>b.contribution-a.contribution);
  },[periodCases,scopedCases,installments,start,end,settingsByFirm,activeSettings,manager,leads,globalSuperView,supply.data]);

  const paymentRows=useMemo(()=>paidRows.map(r=>{const s=settingsForFirm(settingsByFirm,r.case?._lawFirmId,activeSettings);const config=effectiveFinancialConfig(s,(r.installment.paidDate||"").slice(0,7));const fee=r.case?paymentFeeFor(r.case.paymentMethod,actualPayment(r.installment),config):0;return{...r,fee,net:actualPayment(r.installment)-fee}}),[paidRows,settingsByFirm,activeSettings]);
  async function exportCsv(){await recordManagementExport({firmId:effectiveFirmId,start,end,staff:can("settlements.view_all")?"전체":currentStaff||"",format:"csv",kind:"settlements"});downloadCsv(paymentRows.map(r=>({...(globalSuperView?{로펌:r.case?._lawFirmName??"-"}:{}),입금일:r.installment.paidDate??"",의뢰인:r.client?.name??"-",연락처:r.client?.phone??"-",담당:r.case?.assignedStaff??"-",사건유형:r.case?.caseType??"-",결제금액:actualPayment(r.installment),결제방법:r.case?.paymentMethod??"-",수수료:r.fee,실수령액:r.net,비고:r.installment.seq===1?"계약금":`${r.installment.seq-1}회차`})),`정산_${start}_${end}.csv`)}

  return <>
    <PageHeader title="정산" description={manager?(globalSuperView?"전체 로펌의 계약·입금·미수 현황을 통합 조회합니다. 손익은 로펌별 정산설정을 합산합니다.":"계약총액이 아니라 실제 입금과 비용을 기준으로 현금 손익을 확인합니다."):"본인 담당 계약의 계약·입금·미수 현황을 확인합니다."} action={<DateRangePicker start={start} end={end} onChange={(s,e)=>{setStart(s);setEnd(e);setPage(1)}}/>}/>
    {manager&&(settingsError||supply.error)&&<Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">설정/공급 자료 확인 필요: {settingsError||supply.error}</Card>}
    {closed&&<Card className="mb-4 bg-emerald-50 p-3 text-xs text-emerald-800">완전한 월의 합계는 마감 확정값이며 상세 원장은 현재 업무 자료입니다.</Card>}
    <div className={`grid gap-3 sm:grid-cols-2 ${manager?"xl:grid-cols-4 2xl:grid-cols-8":"xl:grid-cols-3"}`}><KpiCard label="계약매출" value={fmtWon(contractSales)}/><KpiCard label="회수 매출 · 실제 입금" value={fmtWon(cashSales)}/><KpiCard label="현재 전체 미수금" value={fmtWon(receivable)}/>{manager&&<><KpiCard label="실수령 매출" value={settingsLoading?"계산 중":settingsError?"설정 확인 필요":fmtWon(netCashSales)}/><KpiCard label="DB 구매비" value={settingsLoading||supply.loading?"계산 중":supply.data?.serviceMode==="crm_only"?"공급계약 없음":costKnown?fmtWon(acquisition):"확인 필요"}/><KpiCard label="인건비" value={settingsLoading?"계산 중":settingsError?"설정 확인 필요":fmtWon(labor)}/><KpiCard label="고정 운영비" value={settingsLoading?"계산 중":settingsError?"설정 확인 필요":fmtWon(fixed)}/><KpiCard label="현금 영업이익" value={settingsLoading||supply.loading?"계산 중":costKnown?fmtWon(operatingProfit):"비용 확인 필요"}/></>}</div>

    {manager&&<Card className="mt-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-black">현금 손익 브리지</div><div className="mt-1 text-xs text-slate-500">회수 매출에서 실제 비용을 차감합니다. 현금 기준 계약 1건당 이익은 {costKnown?fmtWon(cashProfitPerContract):"비용 확인 필요"}입니다. 해지·환불 금액은 전용 필드 추가 전까지 자동 차감하지 않습니다.</div></div><Link href="/settlement-settings" className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><Percent size={13}/>정산설정</Link></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[["회수 매출",cashSales],["− DB 구매비",-acquisition],["− 인건비",-labor],["− 납부 수수료",-paymentFees],["− 고정 운영비",-fixed],["= 영업이익",operatingProfit]].map(([l,v])=><div key={String(l)} className="rounded-xl bg-slate-50 p-3"><div className="text-[11px] font-bold text-slate-500">{l}</div><div className={`mt-1 text-sm font-black ${Number(v)<0?"text-red-600":String(l).startsWith("=")?"text-emerald-700":""}`}>{Number(v)<0?"− ":""}{!costKnown&&(String(l).includes("구매비")||String(l).includes("영업이익"))?"비용 확인 필요":fmtWon(Math.abs(Number(v)))}</div></div>)}</div></Card>}

    <Card className="mt-4 overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><div><div className="text-sm font-black">담당자별 정산 · 기여이익</div><div className="mt-1 text-xs text-slate-500">기여이익은 수임액에서 DB 구매비 배분액과 보상을 차감합니다. 실제 입금은 납부일 기준으로 함께 봅니다.</div></div></div><div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["담당자","계약건수","계약금액","회수매출","결제율",...(manager?["보상","기여이익"]:[])].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{staffRows.map(r=><tr key={r.key} className="border-t"><td className="px-4 py-3 font-bold">{r.staff}</td><td className="px-4 py-3">{r.count}건</td><td className="px-4 py-3">{fmtWon(r.contract)}</td><td className="px-4 py-3">{fmtWon(r.cash)}</td><td className="px-4 py-3">{r.paymentRate.toFixed(1)}%</td>{manager&&<><td className="px-4 py-3">{fmtWon(r.comp)}</td><td className={`px-4 py-3 font-black ${r.contribution<0?"text-red-600":"text-emerald-700"}`}>{costKnown?fmtWon(r.contribution):"확인 필요"}</td></>}</tr>)}{!staffRows.length&&<tr><td colSpan={manager?7:5} className="px-4 py-10 text-center text-slate-400">선택 기간 계약이 없습니다.</td></tr>}</tbody></table></div></Card>

    <Card className="mt-4 overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><div className="text-sm font-black">결제완료 내역 ({paymentRows.length}건)</div><button onClick={()=>void exportCsv().catch(e=>alert(e.message))} disabled={!can("settlements.export")||!paymentRows.length} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40"><Download size={13}/>CSV 다운로드</button></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{[...(globalSuperView?["로펌"]:[]),"입금일","의뢰인","담당","사건유형","결제금액","결제방법",...(manager?["수수료","실수령액"]:[]),"비고"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{pageRows(paymentRows,page,10).map(r=><tr key={r.installment.id} className="border-t">{globalSuperView&&<td className="px-4 py-3 text-xs font-bold text-violet-700">{r.case?._lawFirmName??"-"}</td>}<td className="px-4 py-3">{r.installment.paidDate?fmtDate(r.installment.paidDate):"-"}</td><td className="px-4 py-3 font-bold">{r.client?.name??"-"}</td><td className="px-4 py-3">{r.case?.assignedStaff??"-"}</td><td className="px-4 py-3">{r.case?.caseType??"-"}</td><td className="px-4 py-3 font-semibold">{fmtWon(actualPayment(r.installment))}</td><td className="px-4 py-3">{r.case?PAYMENT_METHOD_NOTE[r.case.paymentMethod]:"-"}</td>{manager&&<><td className="px-4 py-3 text-red-600">{r.fee?`− ${fmtWon(r.fee)}`:"-"}</td><td className="px-4 py-3 font-bold">{fmtWon(r.net)}</td></>}<td className="px-4 py-3">{r.installment.seq===1?"계약금":`${r.installment.seq-1}회차`}</td></tr>)}{!paymentRows.length&&<tr><td colSpan={(globalSuperView?1:0)+(manager?9:7)} className="px-4 py-10 text-center text-slate-400">선택 기간 결제완료 내역이 없습니다.</td></tr>}</tbody></table></div><Pagination page={page} total={paymentRows.length} onChange={setPage} pageSize={10}/></Card>
  </>
}
