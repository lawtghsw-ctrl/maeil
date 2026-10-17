// Frozen calculation-only source from commit 6acb7b9473fec6d36e5a20eda0ae1695bec7a131.
// UI/export callbacks omitted; all calculation expressions and their order are unchanged.
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
import { exportAnalyticsMeetingWorkbook, type AnalyticsMeetingSheet } from "@/lib/analytics-excel";

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

  const allLedger=useMemo(()=>rangeCases.map(c=>{const client=clients.find(x=>x.id===c.clientId);const s=settingsForFirm(settingsByFirm,c._lawFirmId,activeSettings);const std=standardFeeAt(s,c.caseType,c.contractDate);const fees=installments.filter(i=>i.caseId===c.id&&i.status==="완료").reduce((sum,i)=>sum+paymentFeeFor(c.paymentMethod,i.amount,effectiveFinancialConfig(s,(i.paidDate||c.contractDate).slice(0,7))),0);const overdue=installments.some(i=>i.caseId===c.id&&(i.status==="연체"||i.status==="실패"));const status=c.paidAmount>=c.contractAmount&&c.contractAmount>0?"완납":overdue?"연체":"분납 중";return{case:c,client,standard:std?.baseFee??0,discount:Math.max(0,(std?.baseFee??c.contractAmount)-c.contractAmount),fee:fees,net:Math.max(0,c.paidAmount-fees),status};}),[rangeCases,clients,settingsByFirm,activeSettings,installments]);
  const ledger=useMemo(()=>allLedger.filter(r=>staffFilter==="전체"||r.case.assignedStaff===staffFilter),[allLedger,staffFilter]);

  const stageRows=useMemo(()=>Array.from(new Set(cases.map(c=>c.stage))).map(stage=>({stage,count:cases.filter(c=>c.stage===stage&&c.status!=="취하").length})).sort((a,b)=>b.count-a.count),[cases]);
  const selfInstallments=rangeCases.filter(c=>c.paymentMethod==="단순분납").length;
  const latePaid=rangePaid.filter(i=>i.paidDate&&i.paidDate>i.dueDate).length; const overdueDue=overdueNow.filter(i=>inDateRange(i.dueDate,start,end)).length; const overdueRecovery=pct(latePaid,latePaid+overdueDue);

  return {manager,rangeLeads,rangeCases,rangePaid,cashSales,contractSales,converted,firmIds,acquisitionCost,laborCost,paymentFees,fixedCost,contractNet,cashProfit,averageFee,collectionRate,contractTarget,isCurrentMonthRange,expectedContractsByToday,projectedMonthContracts,requiredContractsPerDay,targetProgress,totalStandardFee,totalDiscount,discountRate,activeLeads,neglected,overCap,overdueNow,docDelay,allStaff,staffRows,contactSpeeds,avgContacts,connected,consult,completed,shortClosed,channelRows,allLedger,ledger,stageRows,selfInstallments,latePaid,overdueDue,overdueRecovery};
}
