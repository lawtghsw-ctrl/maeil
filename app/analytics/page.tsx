"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  DB_LEAD_DEFAULT_STAGE_BY_STATUS,
  STAGE_GENERIC_LABELS,
  type DbLead,
} from "@/lib/types";
import {
  DEFAULT_MANAGEMENT_SETTINGS,
  acquisitionCostForRange,
  adSpendForCreativeForRange,
  cashByStaff,
  contactCount,
  effectiveFinancialConfig,
  firstActivityMinutes,
  fixedCostForRange,
  inDateRange,
  isManagerProfile,
  laborCostForRange,
  median,
  paymentFeeFor,
  paymentFeesForRange,
  staffCompensationForRange,
  standardFeeAt,
  useManagementSettings,
  type ManagementSettings,
} from "@/lib/management-analytics";
import { fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KpiCard } from "@/components/ui/KpiCard";

const TABS = ["요약", "팀 · 인원", "상담 운영", "광고 · 소재", "수임 · 매출", "사건 · 수납"] as const;
type Tab = typeof TABS[number];

function monthRange() {
  const d = new Date(); const y = d.getFullYear(); const m = d.getMonth() + 1;
  return { start: `${y}-${String(m).padStart(2,"0")}-01`, end: `${y}-${String(m).padStart(2,"0")}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}` };
}
function daysSince(value?: string) { if (!value) return 0; return Math.max(0, Math.floor((Date.now() - new Date(`${value.slice(0,10)}T00:00:00`).getTime()) / 86400000)); }
function stageOf(lead: DbLead) { return lead.detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status]; }
function terminalLead(lead: DbLead) { return !!lead.convertedClientId || ["거절","부적합","종결_중단"].includes(lead.status); }
function lastActivityAt(lead: DbLead) { const rows = lead.consultation?.memoLog ?? []; return rows.length ? [...rows].sort((a,b)=>b.at.localeCompare(a.at))[0].at : lead.receivedAt; }
function successfulContact(lead: DbLead) {
  const stage = stageOf(lead);
  if (!["미상담","부재","장기부재"].includes(stage)) return true;
  return (lead.consultation?.memoLog ?? []).some((e)=>/(연결|통화완료|상담|본인통화)/.test(e.text) && !/부재/.test(e.text));
}
function consultStarted(lead: DbLead) { return ["상담","설득필요","착수금 안내"].includes(stageOf(lead)) || !!lead.convertedClientId; }
function consultCompleted(lead: DbLead) { return ["설득필요","착수금 안내"].includes(stageOf(lead)) || !!lead.convertedClientId; }
function pct(n:number,d:number){return d>0?(n/d)*100:0}
function moneyPer(n:number,d:number){return d>0?n/d:0}
function minuteText(v?:number){if(v===undefined)return "데이터 없음"; if(v<60)return `${v}분`; return `${Math.floor(v/60)}시간 ${v%60}분`;}

function settingsForFirm(map: Record<string, ManagementSettings>, firmId?: string, fallback?: ManagementSettings) {
  return (firmId && map[firmId]) || fallback || DEFAULT_MANAGEMENT_SETTINGS;
}

function downloadCsv(rows: Array<Record<string,string|number>>, filename:string){
  if(!rows.length)return; const headers=Object.keys(rows[0]);
  const esc=(v:string|number)=>`"${String(v??"").replace(/"/g,'""')}"`;
  const blob=new Blob(["\ufeff"+[headers.join(","),...rows.map(r=>headers.map(h=>esc(r[h])).join(","))].join("\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

export default function AnalyticsPage(){
  const { leads,cases,clients,installments,workStaffNames,profile,superAdminFirmScope,firmDirectory }=useStore();
  const manager=isManagerProfile(profile);
  const { globalSuperView,activeSettings,settingsByFirm,loading:settingsLoading,error:settingsError }=useManagementSettings(profile,superAdminFirmScope,workStaffNames);
  const init=monthRange(); const [start,setStart]=useState(init.start); const [end,setEnd]=useState(init.end); const [tab,setTab]=useState<Tab>("요약"); const [staffFilter,setStaffFilter]=useState("전체");
  const rangeLeads=useMemo(()=>leads.filter(l=>inDateRange(l.receivedAt,start,end)),[leads,start,end]);
  const rangeCases=useMemo(()=>cases.filter(c=>inDateRange(c.contractDate,start,end)),[cases,start,end]);
  const rangePaid=useMemo(()=>installments.filter(i=>i.status==="완료"&&inDateRange(i.paidDate,start,end)),[installments,start,end]);
  const cashSales=rangePaid.reduce((s,i)=>s+i.amount,0); const contractSales=rangeCases.reduce((s,c)=>s+c.contractAmount,0); const converted=rangeLeads.filter(l=>!!l.convertedClientId).length;

  const firmIds=useMemo(()=>{
    const activeIds=firmDirectory.filter(f=>f.status==="active").map(f=>f.id);
    if(activeIds.length)return activeIds;
    return Array.from(new Set([...leads.map(x=>x._lawFirmId),...cases.map(x=>x._lawFirmId)].filter(Boolean) as string[]));
  },[firmDirectory,leads,cases]);
  function aggregateCost(kind:"acquisition"|"labor"|"payment"|"fixed"){
    if(!globalSuperView){ if(kind==="acquisition")return acquisitionCostForRange(leads,activeSettings,start,end); if(kind==="labor")return laborCostForRange(cases,installments,activeSettings,start,end); if(kind==="payment")return paymentFeesForRange(cases,installments,activeSettings,start,end); return fixedCostForRange(activeSettings,start,end); }
    return firmIds.reduce((sum,firmId)=>{const s=settingsForFirm(settingsByFirm,firmId); const fl=leads.filter(x=>x._lawFirmId===firmId); const fc=cases.filter(x=>x._lawFirmId===firmId); const fi=installments.filter(x=>x._lawFirmId===firmId || fc.some(c=>c.id===x.caseId)); if(kind==="acquisition")return sum+acquisitionCostForRange(fl,s,start,end); if(kind==="labor")return sum+laborCostForRange(fc,fi,s,start,end); if(kind==="payment")return sum+paymentFeesForRange(fc,fi,s,start,end); return sum+fixedCostForRange(s,start,end);},0);
  }
  const acquisitionCost=aggregateCost("acquisition"), laborCost=aggregateCost("labor"), paymentFees=aggregateCost("payment"), fixedCost=aggregateCost("fixed");
  const contractNet=rangeCases.length? (contractSales-acquisitionCost-laborCost)/rangeCases.length:0;
  const cashProfit=cashSales-acquisitionCost-laborCost-paymentFees-fixedCost;
  const averageFee=moneyPer(contractSales,rangeCases.length);
  const collectionRate=pct(cashSales,contractSales);
  const contractTarget=globalSuperView
    ? firmIds.reduce((sum,id)=>sum+settingsForFirm(settingsByFirm,id).monthlyContractTarget,0)
    : activeSettings.monthlyContractTarget;
  const currentMonth=monthRange(); const today=new Date(); const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const isCurrentMonthRange=start===currentMonth.start&&end===currentMonth.end;
  const currentDay=Math.max(1,Number(todayKey.slice(8,10))||1); const daysInCurrentMonth=Math.max(1,Number(currentMonth.end.slice(8,10))||30);
  const expectedContractsByToday=contractTarget*(currentDay/daysInCurrentMonth); const projectedMonthContracts=Math.round((rangeCases.length/currentDay)*daysInCurrentMonth);
  const remainingDays=Math.max(1,daysInCurrentMonth-currentDay+1); const requiredContractsPerDay=Math.max(0,(contractTarget-rangeCases.length)/remainingDays); const targetProgress=contractTarget>0?pct(rangeCases.length,contractTarget):0;
  const sampleTooSmall=rangeLeads.length<30;
  const totalStandardFee=rangeCases.reduce((sum,c)=>{const setting=settingsForFirm(settingsByFirm,c._lawFirmId,activeSettings);return sum+(standardFeeAt(setting,c.caseType,c.contractDate)?.baseFee??c.contractAmount)},0);
  const totalDiscount=rangeCases.reduce((sum,c)=>{const setting=settingsForFirm(settingsByFirm,c._lawFirmId,activeSettings);const standard=standardFeeAt(setting,c.caseType,c.contractDate)?.baseFee??c.contractAmount;return sum+Math.max(0,standard-c.contractAmount)},0);
  const discountRate=pct(totalDiscount,totalStandardFee);

  const activeCap=activeSettings.activeDbCap; const neglectDays=activeSettings.neglectedDays;
  const activeLeads=leads.filter(l=>!terminalLead(l));
  const neglected=activeLeads.filter(l=>daysSince(lastActivityAt(l))>=(globalSuperView?settingsForFirm(settingsByFirm,l._lawFirmId).neglectedDays:neglectDays));
  const overCap=useMemo(()=>{const m=new Map<string,{count:number,cap:number}>();for(const l of activeLeads){const key=`${l._lawFirmId??"firm"}::${l.assignedStaff}`;const cap=globalSuperView?settingsForFirm(settingsByFirm,l._lawFirmId).activeDbCap:activeCap;const row=m.get(key)??{count:0,cap};row.count+=1;row.cap=cap;m.set(key,row)}return Array.from(m.entries()).filter(([,row])=>row.count>row.cap);},[activeLeads,activeCap,globalSuperView,settingsByFirm]);
  const overdueNow=installments.filter(i=>i.status==="연체"||i.status==="실패");
  const docDelay=cases.filter(c=>c.status==="진행중"&&c.stage==="서류준비"&&daysSince(c.stageUpdatedAt)>=14);

  const allStaff=useMemo(()=>Array.from(new Set([...workStaffNames,...leads.map(l=>l.assignedStaff),...cases.map(c=>c.assignedStaff)].filter(Boolean))).sort((a,b)=>a.localeCompare(b,"ko")),[workStaffNames,leads,cases]);
  const staffRows=useMemo(()=>{
    const keys=new Map<string,{label:string,firmId?:string,staff:string}>();
    for(const staff of allStaff) if(!globalSuperView)keys.set(staff,{label:staff,staff});
    if(globalSuperView){for(const l of leads){const key=`${l._lawFirmId??"none"}::${l.assignedStaff}`;keys.set(key,{label:`${l._lawFirmName??"로펌"} · ${l.assignedStaff}`,firmId:l._lawFirmId,staff:l.assignedStaff})}for(const c of cases){const key=`${c._lawFirmId??"none"}::${c.assignedStaff}`;keys.set(key,{label:`${c._lawFirmName??"로펌"} · ${c.assignedStaff}`,firmId:c._lawFirmId,staff:c.assignedStaff})}}
    return Array.from(keys.values()).map(k=>{
      const fl=rangeLeads.filter(l=>l.assignedStaff===k.staff&&(!globalSuperView||l._lawFirmId===k.firmId));
      const fc=rangeCases.filter(c=>c.assignedStaff===k.staff&&(!globalSuperView||c._lawFirmId===k.firmId));
      const allFc=cases.filter(c=>c.assignedStaff===k.staff&&(!globalSuperView||c._lawFirmId===k.firmId));
      const fi=installments.filter(i=>allFc.some(c=>c.id===i.caseId));
      const setting=settingsForFirm(settingsByFirm,k.firmId,activeSettings);
      const cash=cashByStaff(allFc,fi,start,end).get(k.staff)??0;
      const comp=staffCompensationForRange(k.staff,allFc,fi,setting,start,end);
      const firmLeadRows=rangeLeads.filter(l=>!globalSuperView||l._lawFirmId===k.firmId);
      const firmAcq=acquisitionCostForRange(firmLeadRows,setting,start,end);
      const allocatedAcq=firmLeadRows.length?firmAcq*(fl.length/firmLeadRows.length):0;
      const prod=moneyPer(fc.reduce((x,c)=>x+c.contractAmount,0),fl.length);
      const speeds=fl.map(firstActivityMinutes).filter((x):x is number=>x!==undefined);
      const contacts=fl.reduce((x,l)=>x+contactCount(l),0);
      const active=activeLeads.filter(l=>l.assignedStaff===k.staff&&(!globalSuperView||l._lawFirmId===k.firmId)).length;
      const standardTotal=fc.reduce((sum,c)=>sum+(standardFeeAt(setting,c.caseType,c.contractDate)?.baseFee??c.contractAmount),0);
      const discountTotal=fc.reduce((sum,c)=>sum+Math.max(0,(standardFeeAt(setting,c.caseType,c.contractDate)?.baseFee??c.contractAmount)-c.contractAmount),0);
      const simpleInstallments=fc.filter(c=>c.paymentMethod==="단순분납").length;
      const overdue=fi.filter(i=>i.status==="연체"||i.status==="실패").length;
      const completedLeads=fl.filter(consultCompleted).length; const convertedLeads=fl.filter(l=>!!l.convertedClientId).length;
      return{
        ...k,db:fl.length,contracts:fc.length,contractSales:fc.reduce((x,c)=>x+c.contractAmount,0),cash,comp,
        contribution:cash-allocatedAcq-comp,productivity:prod,firstSpeed:median(speeds),
        contacts:fl.length?contacts/fl.length:0,active,cap:setting.activeDbCap,minimumContacts:setting.minimumContactAttempts,
        completedToContractRate:pct(convertedLeads,completedLeads),discountRate:pct(discountTotal,standardTotal),simpleInstallmentRate:pct(simpleInstallments,fc.length),overdue
      };
    }).sort((a,b)=>b.contribution-a.contribution);
  },[allStaff,globalSuperView,leads,cases,rangeLeads,rangeCases,installments,settingsByFirm,activeSettings,start,end,activeLeads]);

  const contactSpeeds=rangeLeads.map(firstActivityMinutes).filter((x):x is number=>x!==undefined); const avgContacts=rangeLeads.length?rangeLeads.reduce((s,l)=>s+contactCount(l),0)/rangeLeads.length:0;
  const connected=rangeLeads.filter(successfulContact).length, consult=rangeLeads.filter(consultStarted).length, completed=rangeLeads.filter(consultCompleted).length;
  const shortClosed=rangeLeads.filter(l=>terminalLead(l)&&contactCount(l)<=2&&!l.convertedClientId).length;

  const channelRows=useMemo(()=>{
    type R={key:string,label:string,firmId?:string,leads:DbLead[],spend:number};const map=new Map<string,R>();
    const sourceLeads=rangeLeads;
    for(const l of sourceLeads){const s=settingsForFirm(settingsByFirm,l._lawFirmId,activeSettings);const label=s.acquisitionMode==="db_purchase"?"DB 구매":(l.adName||String(l.source||"미분류"));const key=`${l._lawFirmId??"firm"}::${label}`;const row=map.get(key)??{key,label:globalSuperView?`${l._lawFirmName??"로펌"} · ${label}`:label,firmId:l._lawFirmId,leads:[],spend:0};row.leads.push(l);map.set(key,row)}
    for(const row of map.values()){const s=settingsForFirm(settingsByFirm,row.firmId,activeSettings);if(s.acquisitionMode==="db_purchase")row.spend=row.leads.length*s.dbPurchaseUnitCost;else{const rawLabel=globalSuperView?row.label.split(" · ").slice(1).join(" · "):row.label;row.spend=adSpendForCreativeForRange(s,rawLabel,start,end)}}
    return Array.from(map.values()).map(r=>{const ids=new Set(r.leads.map(l=>l.id));const cc=rangeCases.filter(c=>c.fromLeadId&&ids.has(c.fromLeadId));const won=r.leads.filter(l=>!!l.convertedClientId).length;const conn=r.leads.filter(successfulContact).length;return{...r,db:r.leads.length,won,revenue:cc.reduce((x,c)=>x+c.contractAmount,0),cpl:moneyPer(r.spend,r.leads.length),cpa:moneyPer(r.spend,won),connRate:pct(conn,r.leads.length)}}).sort((a,b)=>b.revenue-a.revenue);
  },[rangeLeads,rangeCases,settingsByFirm,activeSettings,globalSuperView,start,end]);

  const ledger=useMemo(()=>rangeCases.filter(c=>staffFilter==="전체"||c.assignedStaff===staffFilter).map(c=>{const client=clients.find(x=>x.id===c.clientId);const s=settingsForFirm(settingsByFirm,c._lawFirmId,activeSettings);const std=standardFeeAt(s,c.caseType,c.contractDate);const fees=installments.filter(i=>i.caseId===c.id&&i.status==="완료").reduce((sum,i)=>sum+paymentFeeFor(c.paymentMethod,i.amount,effectiveFinancialConfig(s,(i.paidDate||c.contractDate).slice(0,7))),0);const overdue=installments.some(i=>i.caseId===c.id&&(i.status==="연체"||i.status==="실패"));const status=c.paidAmount>=c.contractAmount&&c.contractAmount>0?"완납":overdue?"연체":"분납 중";return{case:c,client,standard:std?.baseFee??0,discount:Math.max(0,(std?.baseFee??c.contractAmount)-c.contractAmount),fee:fees,net:Math.max(0,c.paidAmount-fees),status};}),[rangeCases,staffFilter,clients,settingsByFirm,activeSettings,installments]);

  async function exportXlsx(){const XLSX=await import("xlsx");const rows=ledger.map(r=>({수임일:r.case.contractDate,의뢰인이름:r.client?.name??"-",담당상담사:r.case.assignedStaff,사건유형:r.case.caseType,납부방식:r.case.paymentMethod,기준수임료:r.standard,계약금액:r.case.contractAmount,할인액:r.discount,실입금액:r.case.paidAmount,수수료:r.fee,실수령액:r.net,상태:r.status}));const staff=Array.from(new Set(ledger.map(x=>x.case.assignedStaff))).map(name=>{const rr=ledger.filter(x=>x.case.assignedStaff===name);return{상담사:name,계약건수:rr.length,계약총액:rr.reduce((s,x)=>s+x.case.contractAmount,0),총실입금매출:rr.reduce((s,x)=>s+x.case.paidAmount,0),수수료비용:rr.reduce((s,x)=>s+x.fee,0),실수령매출:rr.reduce((s,x)=>s+x.net,0),미입금잔액:rr.reduce((s,x)=>s+Math.max(0,x.case.contractAmount-x.case.paidAmount),0)}});const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"계약별 원장");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(staff),"상담사별 합계");XLSX.writeFile(wb,`계약원장_${start}_${end}.xlsx`);}
  function exportLedgerCsv(){downloadCsv(ledger.map(r=>({수임일:r.case.contractDate,의뢰인이름:r.client?.name??"-",담당상담사:r.case.assignedStaff,사건유형:r.case.caseType,납부방식:r.case.paymentMethod,기준수임료:r.standard,계약금액:r.case.contractAmount,할인액:r.discount,실입금액:r.case.paidAmount,수수료:r.fee,실수령액:r.net,상태:r.status})),`계약원장_${start}_${end}.csv`)}

  const stageRows=useMemo(()=>Array.from(new Set(cases.map(c=>c.stage))).map(stage=>({stage,count:cases.filter(c=>c.stage===stage&&c.status!=="취하").length})).sort((a,b)=>b.count-a.count),[cases]);
  const selfInstallments=rangeCases.filter(c=>c.paymentMethod==="단순분납").length;
  const latePaid=rangePaid.filter(i=>i.paidDate&&i.paidDate>i.dueDate).length; const overdueDue=overdueNow.filter(i=>inDateRange(i.dueDate,start,end)).length; const overdueRecovery=pct(latePaid,latePaid+overdueDue);

  if(!manager)return <><PageHeader title="데이터집계" description="최고 관리자 전용 지표입니다."/><Card className="p-6 text-sm text-slate-600">데이터집계는 로펌 관리자 또는 슈퍼관리자만 사용할 수 있습니다.</Card></>;
  if(settingsLoading)return <div className="p-8 text-sm text-slate-500">관리자 지표를 불러오는 중...</div>;

  return <>
    <PageHeader title="데이터집계" description={globalSuperView?"전체 로펌 관리자 지표를 통합 조회합니다. DB 구매 로펌에는 로파워 실제 광고원가 대신 해당 로펌 DB 구매비를 적용합니다.":"수익 · DB 생산성 · 상담 과정 · 수임 · 수납을 최고 관리자 기준으로 봅니다."} action={<DateRangePicker start={start} end={end} onChange={(s,e)=>{setStart(s);setEnd(e)}}/>}/>
    {settingsError&&<Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">정산설정 일부를 불러오지 못했습니다: {settingsError}</Card>}
    <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">{TABS.map(t=><button key={t} onClick={()=>setTab(t)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab===t?"bg-blue-600 text-white":"text-slate-600 hover:bg-slate-50"}`}>{t}</button>)}</div>

    {tab==="요약"&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><KpiCard label="계약 1건당 순이익" value={fmtWon(contractNet)}/><KpiCard label="회수 매출" value={fmtWon(cashSales)}/><KpiCard label="계약 / 목표" value={`${rangeCases.length} / ${contractTarget || 0}건`}/><KpiCard label="DB → 계약 전환" value={`${converted}/${rangeLeads.length} · ${pct(converted,rangeLeads.length).toFixed(1)}%`}/><KpiCard label="평균 실수임료" value={fmtWon(averageFee)}/><KpiCard label="평균 할인율" value={`${discountRate.toFixed(1)}%`}/><KpiCard label="DB/광고 비용" value={fmtWon(acquisitionCost)}/><KpiCard label="첫 활동 속도 중앙값" value={minuteText(median(contactSpeeds))}/><KpiCard label="자체 분납 비율" value={`${pct(selfInstallments,rangeCases.length).toFixed(1)}%`}/><KpiCard label="현금 기준 영업이익" value={fmtWon(cashProfit)}/></div>
      {isCurrentMonthRange&&<Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-black">월 목표 페이스</div><div className="mt-1 text-xs text-slate-500">오늘까지 목표 {expectedContractsByToday.toFixed(1)}건 · 현재 {rangeCases.length}건 · 월말 예상 {projectedMonthContracts}건</div></div><div className="text-right"><div className={`text-lg font-black ${rangeCases.length<expectedContractsByToday?"text-amber-700":"text-emerald-700"}`}>{targetProgress.toFixed(1)}%</div><div className="text-[11px] text-slate-400">남은 기간 하루 {requiredContractsPerDay.toFixed(1)}건 필요</div></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${rangeCases.length<expectedContractsByToday?"bg-amber-500":"bg-emerald-500"}`} style={{width:`${Math.min(100,targetProgress)}%`}}/></div></Card>}
      {sampleTooSmall&&<Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><b>표본 주의:</b> 선택 기간 DB가 {rangeLeads.length}건이라 전환율·직원 비교는 참고용으로만 보세요. 30건 이상부터 판단 신뢰도를 높이는 기준으로 사용합니다.</Card>}
      <Card className="p-5"><div className="text-sm font-black">수익 구조</div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[["회수 매출",cashSales],["− DB/광고비",-acquisitionCost],["− 인건비",-laborCost],["− 납부수수료·운영비",-(paymentFees+fixedCost)],["= 현금 영업이익",cashProfit]].map(([l,v])=><div key={String(l)} className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500">{l}</div><div className={`mt-2 text-lg font-black ${Number(v)<0?"text-red-600":"text-slate-900"}`}>{Number(v)<0?"− ":""}{fmtWon(Math.abs(Number(v)))}</div></div>)}</div><div className="mt-3 text-[11px] text-slate-400">해지·환불 금액은 현재 계약 스키마에 별도 금액 필드가 없어 영업이익에서 자동 차감하지 않습니다. 취하 건수는 사건·수납 탭에서 별도 표시합니다.</div></Card>
      <div className="grid gap-4 xl:grid-cols-3">{[{title:`활성 DB 상한 초과 ${overCap.length}명`,body:globalSuperView?"로펌별 설정 상한 기준 · 신규 배정 조정 필요":`기준 ${activeCap}건 · 신규 배정 조정 필요`,bad:overCap.length>0},{title:`방치 DB ${neglected.length}건`,body:globalSuperView?"로펌별 방치 회수 기준 적용":`${neglectDays}일 이상 최근 상담메모/컨택 없음`,bad:neglected.length>0},{title:`연체·결제실패 ${overdueNow.length}건`,body:`현재 미수 위험 · 회수율 ${collectionRate.toFixed(1)}%`,bad:overdueNow.length>0}].map(x=><Card key={x.title} className={`p-4 ${x.bad?"border-red-200 bg-red-50/60":""}`}><div className="flex items-center gap-2 text-sm font-black"><AlertTriangle size={15} className={x.bad?"text-red-500":"text-slate-400"}/>{x.title}</div><div className="mt-1 text-xs text-slate-500">{x.body}</div></Card>)}</div>
    </div>}

    {tab==="팀 · 인원"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="상담 인원" value={`${staffRows.length}명`}/><KpiCard label="DB 생산성" value={fmtWon(moneyPer(contractSales,rangeLeads.length))}/><KpiCard label="총 인건비" value={fmtWon(laborCost)}/><KpiCard label="총 기여이익" value={fmtWon(staffRows.reduce((s,r)=>s+r.contribution,0))}/></div><Card className="overflow-hidden"><div className="border-b px-5 py-4 text-sm font-black">상담사 결과 · 과정 · 품질</div><div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["담당자","배정 DB","활성 DB","계약","수임액","회수매출","보상","기여이익","DB 생산성","첫 활동","DB당 컨택","상담완료→계약","할인율","단순분납","연체"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{staffRows.map(r=><tr key={r.label} className="border-t"><td className="px-4 py-3 font-bold">{r.label}</td><td className="px-4 py-3">{r.db}</td><td className={`px-4 py-3 font-bold ${r.active>activeCap?"text-red-600":""}`}>{r.active}</td><td className="px-4 py-3">{r.contracts}</td><td className="px-4 py-3">{fmtWon(r.contractSales)}</td><td className="px-4 py-3">{fmtWon(r.cash)}</td><td className="px-4 py-3">{fmtWon(r.comp)}</td><td className={`px-4 py-3 font-black ${r.contribution<0?"text-red-600":"text-emerald-700"}`}>{fmtWon(r.contribution)}</td><td className="px-4 py-3">{fmtWon(r.productivity)}</td><td className="px-4 py-3">{minuteText(r.firstSpeed)}</td><td className="px-4 py-3">{r.contacts.toFixed(1)}회</td><td className="px-4 py-3">{r.completedToContractRate.toFixed(1)}%</td><td className={`px-4 py-3 ${r.discountRate>10?"font-bold text-amber-700":""}`}>{r.discountRate.toFixed(1)}%</td><td className={`px-4 py-3 ${r.simpleInstallmentRate>60?"font-bold text-amber-700":""}`}>{r.simpleInstallmentRate.toFixed(1)}%</td><td className={`px-4 py-3 ${r.overdue>0?"font-bold text-red-600":""}`}>{r.overdue}건</td></tr>)}</tbody></table></div></Card><Card className="p-5 text-xs leading-6 text-slate-600"><b className="text-slate-900">운영 기준:</b> 결과는 월 단위(수임·회수·DB 생산성·기여이익), 과정은 주 단위(첫 활동·컨택·전환), 품질은 상시(할인·자체분납·연체·입력)로 봅니다. 신규 인원은 초반 행동지표를 먼저 확인하세요.</Card></div>}

    {tab==="상담 운영"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="첫 활동 중앙값" value={minuteText(median(contactSpeeds))}/><KpiCard label="DB당 평균 컨택" value={`${avgContacts.toFixed(1)}회`}/><KpiCard label="2회 이하 종결" value={`${shortClosed}건`}/><KpiCard label={`${neglectDays}일 방치 DB`} value={`${neglected.length}건`}/></div><Card className="p-5"><div className="text-sm font-black">DB 퍼널 · 유입 월 기준</div><div className="mt-4 grid gap-3 sm:grid-cols-5">{[["신규 DB",rangeLeads.length],["통화 연결",connected],["상담 진행",consult],["상담 완료",completed],["계약",converted]].map(([l,v],i)=><div key={String(l)} className="rounded-xl border p-4"><div className="text-xs font-bold text-slate-500">{l}</div><div className="mt-2 text-2xl font-black">{v}건</div>{i>0&&<div className="mt-1 text-[11px] text-slate-400">이전 단계 대비 {pct(Number(v),Number([[0,rangeLeads.length],[0,rangeLeads.length],[0,connected],[0,consult],[0,completed]][i][1])).toFixed(1)}%</div>}</div>)}</div></Card><Card className="overflow-hidden"><div className="border-b px-5 py-4 text-sm font-black">업무량 · 과부하 점검</div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["담당자","활성 DB","배정 상한","첫 활동","DB당 컨택","최소 컨택","판단"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{staffRows.map(r=><tr key={r.label} className="border-t"><td className="px-4 py-3 font-bold">{r.label}</td><td className="px-4 py-3">{r.active}</td><td className="px-4 py-3">{r.cap}</td><td className="px-4 py-3">{minuteText(r.firstSpeed)}</td><td className="px-4 py-3">{r.contacts.toFixed(1)}</td><td className="px-4 py-3">{r.minimumContacts}회</td><td className="px-4 py-3"><span className={`rounded-md px-2 py-1 text-xs font-bold ${r.active>r.cap?"bg-red-50 text-red-700":r.contacts<r.minimumContacts?"bg-amber-50 text-amber-700":"bg-emerald-50 text-emerald-700"}`}>{r.active>r.cap?"배정 중단 검토":r.contacts<r.minimumContacts?"컨택 코칭":"정상"}</span></td></tr>)}</tbody></table></div></Card><Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">첫 통화 속도·컨택 수는 현재 CRM의 상담메모에서 통화/전화/연결/부재/문자 기록을 찾아 계산합니다. 향후 통화 이벤트가 구조화되면 정확도가 더 높아집니다.</Card></div>}

    {tab==="광고 · 소재"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label={activeSettings.acquisitionMode==="db_purchase"&&!globalSuperView?"DB 구매비":"광고/DB 비용"} value={fmtWon(acquisitionCost)}/><KpiCard label="CPL · DB당 비용" value={fmtWon(moneyPer(acquisitionCost,rangeLeads.length))}/><KpiCard label="CPA · 계약당 비용" value={converted>=10?fmtWon(moneyPer(acquisitionCost,converted)):"판단 보류"}/><KpiCard label="비용 대비 수임액" value={`${acquisitionCost>0?(contractSales/acquisitionCost).toFixed(1):"0.0"}배`}/></div><Card className="overflow-hidden"><div className="border-b px-5 py-4"><div className="text-sm font-black">채널 · 소재 효율</div><div className="mt-1 text-xs text-slate-500">DB 구매형 로펌은 실제 로파워 광고원가를 노출하지 않고 해당 로펌의 DB 구매비만 계산합니다. 소재별 계약이 10건 미만이면 CPA는 판단 보류로 표시합니다.</div></div><div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["소재/구분","비용","DB","CPL","연결률","계약","수임매출","CPA"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{channelRows.map(r=><tr key={r.key} className="border-t"><td className="px-4 py-3 font-bold">{r.label}</td><td className="px-4 py-3">{fmtWon(r.spend)}</td><td className="px-4 py-3">{r.db}</td><td className="px-4 py-3">{fmtWon(r.cpl)}</td><td className="px-4 py-3">{r.connRate.toFixed(1)}%</td><td className="px-4 py-3">{r.won}</td><td className="px-4 py-3">{fmtWon(r.revenue)}</td><td className="px-4 py-3 font-bold">{r.won>=10?fmtWon(r.cpa):"판단 보류"}</td></tr>)}{channelRows.length===0&&<tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">선택 기간 데이터가 없습니다.</td></tr>}</tbody></table></div></Card></div>}

    {tab==="수임 · 매출"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="수임 건수" value={`${rangeCases.length}건`}/><KpiCard label="수임액" value={fmtWon(contractSales)}/><KpiCard label="평균 수임료" value={fmtWon(averageFee)}/><KpiCard label="실제 입금" value={fmtWon(cashSales)}/></div><Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4"><div><div className="text-sm font-black">계약 원장 RAW 데이터</div><div className="mt-1 text-xs text-slate-500">현재 기간·상담사 필터가 다운로드 파일에 그대로 적용됩니다.</div></div><div className="flex items-center gap-2"><select value={staffFilter} onChange={(e)=>setStaffFilter(e.target.value)} className="h-9 rounded-lg border px-3 text-xs"><option>전체</option>{allStaff.map(s=><option key={s}>{s}</option>)}</select><button onClick={()=>void exportXlsx()} className="flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white"><FileSpreadsheet size={13}/>XLSX</button><button onClick={exportLedgerCsv} className="flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-bold"><Download size={13}/>CSV</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["수임일","의뢰인","담당","사건유형","납부방식","기준 수임료","계약금액","할인액","실입금","수수료","실수령","상태"].map(h=><th key={h} className="px-3 py-3 text-left">{h}</th>)}</tr></thead><tbody>{ledger.map(r=><tr key={r.case.id} className="border-t"><td className="px-3 py-3">{r.case.contractDate}</td><td className="px-3 py-3 font-bold">{r.client?.name??"-"}</td><td className="px-3 py-3">{r.case.assignedStaff}</td><td className="px-3 py-3">{r.case.caseType}</td><td className="px-3 py-3">{r.case.paymentMethod}</td><td className="px-3 py-3">{fmtWon(r.standard)}</td><td className="px-3 py-3">{fmtWon(r.case.contractAmount)}</td><td className="px-3 py-3 text-amber-700">{r.discount?fmtWon(r.discount):"-"}</td><td className="px-3 py-3">{fmtWon(r.case.paidAmount)}</td><td className="px-3 py-3">{fmtWon(r.fee)}</td><td className="px-3 py-3 font-bold">{fmtWon(r.net)}</td><td className="px-3 py-3">{r.status}</td></tr>)}</tbody></table></div></Card></div>}

    {tab==="사건 · 수납"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="진행중 사건" value={`${cases.filter(c=>c.status==="진행중").length}건`}/><KpiCard label="서류준비 14일+" value={`${docDelay.length}건`}/><KpiCard label="연체·실패" value={`${overdueNow.length}건`}/><KpiCard label="연체 회수율" value={`${overdueRecovery.toFixed(1)}%`}/></div><div className="grid gap-4 xl:grid-cols-2"><Card className="p-5"><div className="text-sm font-black">사건 진행 단계</div><div className="mt-4 space-y-3">{stageRows.map(r=>{const max=Math.max(1,...stageRows.map(x=>x.count));return <div key={r.stage}><div className="mb-1 flex justify-between text-xs"><span>{STAGE_GENERIC_LABELS[r.stage]}</span><b>{r.count}건</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-600" style={{width:`${Math.round(r.count/max*100)}%`}}/></div></div>})}</div></Card><Card className="overflow-hidden"><div className="border-b px-5 py-4 text-sm font-black">서류준비 장기체류</div><div className="divide-y">{docDelay.slice(0,12).map(c=>{const client=clients.find(x=>x.id===c.clientId);return <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div><b>{client?.name??"-"}</b><div className="text-xs text-slate-400">담당 {c.assignedStaff} · {c.caseType}</div></div><div className="font-bold text-amber-700">{daysSince(c.stageUpdatedAt)}일</div></div>})}{!docDelay.length&&<div className="p-8 text-center text-xs text-slate-400">14일 이상 체류 사건이 없습니다.</div>}</div></Card></div><Card className="p-5"><div className="flex items-center gap-2 text-sm font-black"><ShieldAlert size={16}/>해지 · 환불 추적</div><div className="mt-3 text-sm text-slate-600">선택 기간 취하 사건 <b>{rangeCases.filter(c=>c.status==="취하").length}건</b>. 현재 CRM에는 환불 금액 전용 필드가 없어 환불액은 자동 집계하지 않습니다. 환불 금액 필드를 추가하면 영업이익에서 즉시 차감하도록 연결할 수 있습니다.</div></Card></div>}
  </>;
}
