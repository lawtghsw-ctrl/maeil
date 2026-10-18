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
  useManagementSettings,
  type ManagementSettings,
} from "@/lib/management-analytics";
import { fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KpiCard } from "@/components/ui/KpiCard";
import { exportAnalyticsMeetingWorkbook, type AnalyticsMeetingSheet } from "@/lib/analytics-excel";
import { createStaffScopeKey, groupByKey, groupRelatedRows } from "@/lib/analytics-indexes";
import { firstByKey } from "@/lib/list-indexes";

import { actualPayment, isValidRetainer, standardFeeForCase, structuredContacts, ratioLabel, leadStageDays } from "@/lib/firm-reporting";
import { useFirmSupply } from "@/lib/use-firm-supply";
import { FirmOperationsDetails } from "@/components/analytics/FirmOperationsDetails";
import { FirmSupplyCard } from "@/components/analytics/FirmSupplyCard";
import { closedTotalsForRange } from "@/lib/management-core";
import { DOCUMENT_CHECKLIST_TEMPLATE } from "@/lib/documents";
import { recordManagementExport } from "@/lib/management-export-client";

const TABS = ["요약", "팀 · 인원", "상담 운영", "DB 구매 · 유입", "수임 · 매출", "사건 · 수납"] as const;
type Tab = typeof TABS[number];

function monthRange() {
  const d = new Date(); const y = d.getFullYear(); const m = d.getMonth() + 1;
  return { start: `${y}-${String(m).padStart(2,"0")}-01`, end: `${y}-${String(m).padStart(2,"0")}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}` };
}
function daysSince(value?: string) { if (!value) return 0; return Math.max(0, Math.floor((Date.now() - new Date(`${value.slice(0,10)}T00:00:00`).getTime()) / 86400000)); }
function stageOf(lead: DbLead) { return lead.detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status]; }
function terminalLead(lead: DbLead) { return !!lead.convertedClientId || ["거절","부적합","종결_중단"].includes(lead.status); }
function successfulContact(lead: DbLead) { return structuredContacts(lead)?.some(row=>row.type==="phone"&&row.connected===true)??false; }
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
  const { leads,cases,clients,installments,workStaffNames,profile,superAdminFirmScope,firmDirectory,caseDocuments }=useStore();
  const manager=isManagerProfile(profile);
  const { globalSuperView,effectiveFirmId,activeSettings,settingsByFirm,loading:settingsLoading,error:settingsError }=useManagementSettings(profile,superAdminFirmScope,workStaffNames);
  const init=monthRange(); const [start,setStart]=useState(init.start); const [end,setEnd]=useState(init.end); const [tab,setTab]=useState<Tab>("요약"); const [staffFilter,setStaffFilter]=useState("전체");
  const supply=useFirmSupply(effectiveFirmId,start,end,manager);
  const closed=closedTotalsForRange(activeSettings,start,end);
  const costKnown=(!!closed&&closed.purchaseCost!==null)||!!supply.data&&supply.data.purchaseCost!==null&&!supply.error&&!settingsError;
  const rangeLeads=useMemo(()=>leads.filter(l=>inDateRange(l.receivedAt,start,end)),[leads,start,end]);
  const periodCases=useMemo(()=>cases.filter(c=>inDateRange(c.contractDate,start,end)),[cases,start,end]);
  const rangeCases=useMemo(()=>periodCases.filter(isValidRetainer),[periodCases]);
  const retainedLeadIds=useMemo(()=>new Set(cases.filter(isValidRetainer).map(c=>c.fromLeadId).filter(Boolean)),[cases]);
  const rangePaid=useMemo(()=>installments.filter(i=>i.status==="완료"&&inDateRange(i.paidDate,start,end)),[installments,start,end]);
  const {cashSales:liveCashSales,contractSales:liveContractSales,converted}=useMemo(()=>({
    cashSales:rangePaid.reduce((s,i)=>s+actualPayment(i),0),
    contractSales:rangeCases.reduce((s,c)=>s+c.contractAmount,0),
    converted:rangeLeads.filter(l=>retainedLeadIds.has(l.id)).length,
  }),[rangePaid,rangeCases,rangeLeads,retainedLeadIds]);

  const cashSales=closed?.cashSales??liveCashSales,contractSales=closed?.contractSales??liveContractSales;
  const firmIds=useMemo(()=>{
    const activeIds=firmDirectory.filter(f=>f.status==="active").map(f=>f.id);
    if(activeIds.length)return activeIds;
    return Array.from(new Set([...leads.map(x=>x._lawFirmId),...cases.map(x=>x._lawFirmId)].filter(Boolean) as string[]));
  },[firmDirectory,leads,cases]);
  const {laborCost:liveLaborCost,paymentFees:livePaymentFees,fixedCost:liveFixedCost}=useMemo(()=>{
    if(!globalSuperView) return {
      acquisitionCost:acquisitionCostForRange(leads,activeSettings,start,end),
      laborCost:laborCostForRange(cases,installments,activeSettings,start,end),
      paymentFees:paymentFeesForRange(cases,installments,activeSettings,start,end),
      fixedCost:fixedCostForRange(activeSettings,start,end),
    };
    const firmLeads=groupByKey(leads,l=>l._lawFirmId);
    const firmCases=groupByKey(cases,c=>c._lawFirmId);
    const firmInstallments=groupRelatedRows(cases,installments,c=>c._lawFirmId,c=>c.id,i=>i.caseId,i=>i._lawFirmId);
    return firmIds.reduce((total,firmId)=>{
      const setting=settingsForFirm(settingsByFirm,firmId);
      const fl=firmLeads.get(firmId)??[];
      const fc=firmCases.get(firmId)??[];
      const fi=firmInstallments.get(firmId)??[];
      total.acquisitionCost+=acquisitionCostForRange(fl,setting,start,end);
      total.laborCost+=laborCostForRange(fc,fi,setting,start,end);
      total.paymentFees+=paymentFeesForRange(fc,fi,setting,start,end);
      total.fixedCost+=fixedCostForRange(setting,start,end);
      return total;
    },{acquisitionCost:0,laborCost:0,paymentFees:0,fixedCost:0});
  },[globalSuperView,leads,cases,installments,activeSettings,settingsByFirm,firmIds,start,end]);
  const acquisitionCost=closed?.purchaseCost??supply.data?.purchaseCost??0;
  const laborCost=closed?.laborCost??liveLaborCost,paymentFees=closed?.paymentFees??livePaymentFees,fixedCost=closed?.fixedCost??liveFixedCost;
  const contractCount=closed?.contractCount??rangeCases.length;
  const contractNet=contractCount? (contractSales-acquisitionCost-laborCost)/contractCount:0;
  const cashProfit=cashSales-acquisitionCost-laborCost-paymentFees-fixedCost;
  const averageFee=moneyPer(contractSales,contractCount);
  const collectionRate=pct(cashSales,contractSales);
  const contractTarget=globalSuperView
    ? firmIds.reduce((sum,id)=>sum+settingsForFirm(settingsByFirm,id).monthlyContractTarget,0)
    : activeSettings.monthlyContractTarget;
  const currentMonth=monthRange(); const today=new Date(); const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const isCurrentMonthRange=start===currentMonth.start&&end===currentMonth.end;
  const currentDay=Math.max(1,Number(todayKey.slice(8,10))||1); const daysInCurrentMonth=Math.max(1,Number(currentMonth.end.slice(8,10))||30);
  const expectedContractsByToday=contractTarget*(currentDay/daysInCurrentMonth); const projectedMonthContracts=Math.round((rangeCases.length/currentDay)*daysInCurrentMonth);
  const remainingDays=Math.max(1,daysInCurrentMonth-currentDay+1); const requiredContractsPerDay=Math.max(0,(contractTarget-rangeCases.length)/remainingDays); const targetProgress=contractTarget>0?pct(rangeCases.length,contractTarget):0;
  const {totalStandardFee,totalDiscount,standardKnown}=useMemo(()=>rangeCases.reduce((total,c)=>{
    const standard=standardFeeForCase(c);
    if(standard===undefined)return total;
    total.standardKnown++;
    total.totalStandardFee+=standard;
    total.totalDiscount+=Math.max(0,standard-c.contractAmount);
    return total;
  },{totalStandardFee:0,totalDiscount:0,standardKnown:0}),[rangeCases,settingsByFirm,activeSettings]);
  const discountRate=pct(totalDiscount,totalStandardFee);

  const activeCap=activeSettings.activeDbCap; const neglectDays=activeSettings.neglectedDays;
  const activeLeads=useMemo(()=>leads.filter(l=>!terminalLead(l)),[leads]);
  const neglected=activeLeads.filter(l=>(leadStageDays(l)??-1)>=(globalSuperView?settingsForFirm(settingsByFirm,l._lawFirmId).neglectedDays:neglectDays));
  const stageUnknown=activeLeads.filter(l=>leadStageDays(l)===undefined).length;
  const overCap=useMemo(()=>{const m=new Map<string,{count:number,cap:number}>();for(const l of activeLeads){const key=`${l._lawFirmId??"firm"}::${l.assignedStaff}`;const cap=globalSuperView?settingsForFirm(settingsByFirm,l._lawFirmId).activeDbCap:activeCap;const row=m.get(key)??{count:0,cap};row.count+=1;row.cap=cap;m.set(key,row)}return Array.from(m.entries()).filter(([,row])=>row.count>row.cap);},[activeLeads,activeCap,globalSuperView,settingsByFirm]);
  const overdueNow=useMemo(()=>installments.filter(i=>i.status==="연체"||i.status==="실패"),[installments]);
  const missingDocuments=cases.filter(c=>c.status==="진행중"&&["서류준비","신청서작성"].includes(c.stage)).map(c=>({record:c,missing:DOCUMENT_CHECKLIST_TEMPLATE.filter(item=>!caseDocuments[c.id]?.[item.id])})).filter(row=>row.missing.length);
  const docDelay=cases.filter(c=>c.status==="진행중"&&c.stage==="서류준비"&&daysSince(c.stageUpdatedAt)>=14);

  const allStaff=useMemo(()=>Array.from(new Set([...workStaffNames,...leads.map(l=>l.assignedStaff),...cases.map(c=>c.assignedStaff)].filter(Boolean))).sort((a,b)=>a.localeCompare(b,"ko")),[workStaffNames,leads,cases]);
  const staffRows=useMemo(()=>{
    const staffKey=createStaffScopeKey(globalSuperView);
    const staffLeads=groupByKey(rangeLeads,staffKey);
    const staffCases=groupByKey(rangeCases,staffKey);
    const allStaffCases=groupByKey(cases,staffKey);
    const staffInstallments=groupRelatedRows(cases,installments,staffKey,c=>c.id,i=>i.caseId);
    const staffActiveLeads=groupByKey(activeLeads,staffKey);
    const firmLeadGroups=groupByKey(rangeLeads,l=>l._lawFirmId);
    const firmAcquisitionCosts=new Map<string|undefined,number>();
    const keys=new Map<string,{label:string,firmId?:string,staff:string}>();
    for(const staff of allStaff) if(!globalSuperView)keys.set(staff,{label:staff,staff});
    if(globalSuperView){for(const l of leads){const key=`${l._lawFirmId??"none"}::${l.assignedStaff}`;keys.set(key,{label:`${l._lawFirmName??"로펌"} · ${l.assignedStaff}`,firmId:l._lawFirmId,staff:l.assignedStaff})}for(const c of cases){const key=`${c._lawFirmId??"none"}::${c.assignedStaff}`;keys.set(key,{label:`${c._lawFirmName??"로펌"} · ${c.assignedStaff}`,firmId:c._lawFirmId,staff:c.assignedStaff})}}
    return Array.from(keys.values()).map(k=>{
      const key=staffKey({assignedStaff:k.staff,_lawFirmId:k.firmId});
      const fl=staffLeads.get(key)??[];
      const fc=staffCases.get(key)??[];
      const allFc=allStaffCases.get(key)??[];
      const fi=staffInstallments.get(key)??[];
      const setting=settingsForFirm(settingsByFirm,k.firmId,activeSettings);
      const cash=cashByStaff(allFc,fi,start,end).get(k.staff)??0;
      const comp=staffCompensationForRange(k.staff,allFc,fi,setting,start,end);
      const firmLeadRows=globalSuperView?(firmLeadGroups.get(k.firmId)??[]):rangeLeads;
      if(!firmAcquisitionCosts.has(k.firmId))firmAcquisitionCosts.set(k.firmId,acquisitionCostForRange(firmLeadRows,setting,start,end));
      const firmAcq=supply.data?.purchaseCost??0;
      const allocatedAcq=firmLeadRows.length?firmAcq*(fl.length/firmLeadRows.length):0;
      const prod=moneyPer(fc.reduce((x,c)=>x+c.contractAmount,0),fl.length);
      const speeds=fl.map(firstActivityMinutes).filter((x):x is number=>x!==undefined);
      const knownContacts=fl.filter(l=>structuredContacts(l)!==undefined);
      const contacts=knownContacts.reduce((x,l)=>x+contactCount(l),0);
      const active=staffActiveLeads.get(key)?.length??0;
      const standardTotal=fc.reduce((sum,c)=>sum+(standardFeeForCase(c)??0),0);
      const discountTotal=fc.reduce((sum,c)=>sum+Math.max(0,(standardFeeForCase(c)??c.contractAmount)-c.contractAmount),0);
      const simpleInstallments=fc.filter(c=>c.paymentMethod==="단순분납").length;
      const overdue=fi.filter(i=>i.status==="연체"||i.status==="실패").length;
      const completedLeads=fl.filter(consultCompleted).length; const convertedLeads=fl.filter(l=>retainedLeadIds.has(l.id)).length;
      return{
        ...k,db:fl.length,contracts:fc.length,contractSales:fc.reduce((x,c)=>x+c.contractAmount,0),cash,comp,
        contribution:fc.reduce((x,c)=>x+c.contractAmount,0)-allocatedAcq-comp,productivity:prod,firstSpeed:median(speeds),
        contacts:knownContacts.length?contacts/knownContacts.length:0,contactKnown:knownContacts.length,active,cap:setting.activeDbCap,minimumContacts:setting.minimumContactAttempts,
        completedToContractRate:pct(convertedLeads,completedLeads),discountRate:pct(discountTotal,standardTotal),discountKnown:fc.filter(c=>standardFeeForCase(c)!==undefined).length,simpleInstallmentRate:pct(simpleInstallments,fc.length),overdue
      };
    }).sort((a,b)=>b.contribution-a.contribution);
  },[allStaff,globalSuperView,leads,cases,rangeLeads,rangeCases,installments,settingsByFirm,activeSettings,start,end,activeLeads,supply.data,retainedLeadIds]);

  const {contactSpeeds,avgContacts,connected,consult,completed,shortClosed}=useMemo(()=>({
    contactSpeeds:rangeLeads.map(firstActivityMinutes).filter((x):x is number=>x!==undefined),
    avgContacts:rangeLeads.filter(l=>structuredContacts(l)!==undefined).length?rangeLeads.reduce((s,l)=>s+contactCount(l),0)/rangeLeads.filter(l=>structuredContacts(l)!==undefined).length:0,
    connected:rangeLeads.filter(successfulContact).length,
    consult:rangeLeads.filter(consultStarted).length,
    completed:rangeLeads.filter(consultCompleted).length,
    shortClosed:rangeLeads.filter(l=>terminalLead(l)&&structuredContacts(l)!==undefined&&contactCount(l)<=2&&!l.convertedClientId).length,
  }),[rangeLeads]);

  const channelRows=useMemo(()=>{
    type R={key:string,label:string,firmId?:string,leads:DbLead[],spend:number};const map=new Map<string,R>();
    const sourceLeads=rangeLeads;
    for(const l of sourceLeads){const s=settingsForFirm(settingsByFirm,l._lawFirmId,activeSettings);const label=String(l.source||"미분류");const key=`${l._lawFirmId??"firm"}::${label}`;const row=map.get(key)??{key,label:globalSuperView?`${l._lawFirmName??"로펌"} · ${label}`:label,firmId:l._lawFirmId,leads:[],spend:0};row.leads.push(l);map.set(key,row)}
    const costs=new Map((supply.data?.byLead??[]).map(row=>[row.leadId,row.purchaseCost]));
    for(const row of map.values())row.spend=row.leads.reduce((sum,lead)=>sum+(costs.get(lead.id)??0),0);
    return Array.from(map.values()).map(r=>{const ids=new Set(r.leads.map(l=>l.id));const cc=cases.filter(c=>isValidRetainer(c)&&c.fromLeadId&&ids.has(c.fromLeadId));const won=new Set(cc.map(c=>c.fromLeadId)).size;const conn=r.leads.filter(successfulContact).length;return{...r,db:r.leads.length,won,revenue:cc.reduce((x,c)=>x+c.contractAmount,0),cpl:moneyPer(r.spend,r.leads.length),cpa:moneyPer(r.spend,won),connRate:pct(conn,r.leads.length)}}).sort((a,b)=>b.revenue-a.revenue);
  },[rangeLeads,rangeCases,cases,settingsByFirm,activeSettings,globalSuperView,start,end,supply.data]);

  const clientsById=useMemo(()=>firstByKey(clients,c=>c.id),[clients]);
  const installmentsByCase=useMemo(()=>groupByKey(installments,i=>i.caseId),[installments]);
  const allLedger=useMemo(()=>periodCases.map(c=>{
    const client=clientsById.get(c.clientId);
    const s=settingsForFirm(settingsByFirm,c._lawFirmId,activeSettings);
    const std=standardFeeForCase(c);
    const caseInstallments=installmentsByCase.get(c.id)??[];
    const fees=caseInstallments.filter(i=>i.status==="완료").reduce((sum,i)=>sum+paymentFeeFor(c.paymentMethod,actualPayment(i),effectiveFinancialConfig(s,(i.paidDate||c.contractDate).slice(0,7))),0);
    const overdue=caseInstallments.some(i=>i.status==="연체"||i.status==="실패");
    const paid=caseInstallments.length?caseInstallments.filter(i=>i.status==="완료").reduce((sum,i)=>sum+actualPayment(i),0):c.paidAmount;
    const status=c.status==="취하"?"취하":paid>=c.contractAmount&&c.contractAmount>0?"완납":overdue?"연체":"분납 중";
    return{case:c,client,paid,standard:std??0,standardKnown:std!==undefined,discount:Math.max(0,(std??c.contractAmount)-c.contractAmount),fee:fees,net:Math.max(0,paid-fees),status};
  }),[periodCases,clientsById,settingsByFirm,activeSettings,installmentsByCase]);
  const ledger=useMemo(()=>allLedger.filter(r=>staffFilter==="전체"||r.case.assignedStaff===staffFilter),[allLedger,staffFilter]);

  async function exportXlsx(){await recordManagementExport({firmId:effectiveFirmId,start,end,staff:staffFilter,format:"xlsx",kind:"ledger"});const XLSX=await import("xlsx");const rows=ledger.map(r=>({수임일:r.case.contractDate,의뢰인이름:r.client?.name??"-",담당상담사:r.case.assignedStaff,사건유형:r.case.caseType,납부방식:r.case.paymentMethod,기준수임료:r.standardKnown?r.standard:"확인 불가",계약금액:r.case.contractAmount,할인액:r.standardKnown?r.discount:"확인 불가",실입금액:r.paid,수수료:r.fee,실수령액:r.net,상태:r.status}));const staff=Array.from(new Set(ledger.map(x=>x.case.assignedStaff))).map(name=>{const rr=ledger.filter(x=>x.case.assignedStaff===name);return{상담사:name,계약건수:rr.length,계약총액:rr.reduce((s,x)=>s+x.case.contractAmount,0),총실입금매출:rr.reduce((s,x)=>s+x.paid,0),수수료비용:rr.reduce((s,x)=>s+x.fee,0),실수령매출:rr.reduce((s,x)=>s+x.net,0),미입금잔액:rr.reduce((s,x)=>s+Math.max(0,x.case.contractAmount-x.paid),0)}});const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"계약별 원장");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(staff),"상담사별 합계");XLSX.writeFile(wb,`계약원장_${start}_${end}.xlsx`);}
  async function exportLedgerCsv(){await recordManagementExport({firmId:effectiveFirmId,start,end,staff:staffFilter,format:"csv",kind:"ledger"});downloadCsv(ledger.map(r=>({수임일:r.case.contractDate,의뢰인이름:r.client?.name??"-",담당상담사:r.case.assignedStaff,사건유형:r.case.caseType,납부방식:r.case.paymentMethod,기준수임료:r.standardKnown?r.standard:"확인 불가",계약금액:r.case.contractAmount,할인액:r.standardKnown?r.discount:"확인 불가",실입금액:r.paid,수수료:r.fee,실수령액:r.net,상태:r.status})),`계약원장_${start}_${end}.csv`)}

  const stageRows=useMemo(()=>{
    const counts=new Map<(typeof cases)[number]["stage"],number>();
    for(const c of cases)counts.set(c.stage,(counts.get(c.stage)??0)+(c.status!=="취하"?1:0));
    return Array.from(counts,([stage,count])=>({stage,count})).sort((a,b)=>b.count-a.count);
  },[cases]);
  const selfInstallments=rangeCases.filter(c=>c.paymentMethod==="단순분납").length;
  const latePaid=rangePaid.filter(i=>i.paidDate&&i.paidDate>i.dueDate).length; const overdueDue=overdueNow.filter(i=>inDateRange(i.dueDate,start,end)).length; const overdueRecovery=pct(latePaid,latePaid+overdueDue);

  async function exportMeetingWorkbook(){
    await recordManagementExport({firmId:effectiveFirmId,start,end,format:"xlsx",kind:"meeting"});
    const scopeLabel=globalSuperView?"전체 로펌 통합":(superAdminFirmScope?.name??"현재 로펌");
    const periodLabel=`${start} ~ ${end}`;
    const overdueDetail=overdueNow.map(i=>{const c=cases.find(x=>x.id===i.caseId);const client=c?clients.find(x=>x.id===c.clientId):undefined;return [i.dueDate,client?.name??"-",c?.caseNumber??"-",c?.assignedStaff??"-",i.seq,i.amount,i.status,i.paidDate??""]});
    const cancelled=periodCases.filter(c=>c.status==="취하").map(c=>{const client=clients.find(x=>x.id===c.clientId);return [c.contractDate,client?.name??"-",c.caseNumber,c.assignedStaff,c.caseType,c.contractAmount,c.paidAmount]});
    const settingsContexts=globalSuperView
      ? firmIds.map(id=>({id,name:firmDirectory.find(f=>f.id===id)?.name??id,settings:settingsForFirm(settingsByFirm,id)}))
      : [{id:superAdminFirmScope?.id??"current",name:superAdminFirmScope?.name??"현재 로펌",settings:activeSettings}];
    const settingsOverview=settingsContexts.map(x=>[x.name,supply.data?.serviceMode==="crm_only"?"어드민 이용":"공급계약 원장",x.settings.dbPurchaseUnitCost,x.settings.monthlyContractTarget,x.settings.activeDbCap,x.settings.neglectedDays,x.settings.minimumContactAttempts]);
    const staffCompRows=settingsContexts.flatMap(x=>x.settings.staffCompensations.map(r=>[x.name,r.staff,r.employmentType,r.baseSalary,r.incentiveMode,r.incentiveValue,r.clawbackOnCancel?"적용":"미적용"]));
    const paymentFeeRows=settingsContexts.flatMap(x=>x.settings.paymentFees.map(r=>[x.name,r.paymentMethod,r.rate,r.payer]));
    const fixedCostRows=settingsContexts.flatMap(x=>x.settings.fixedCosts.map(r=>[x.name,r.label,r.monthlyAmount]));
    const adInputRows: never[]=[];
    const feeRuleRows=settingsContexts.flatMap(x=>x.settings.feeRules.map(r=>[x.name,r.caseType,r.baseFee,r.minFee,r.approvalDiscountAmount,r.effectiveFrom]));

    const sheets:AnalyticsMeetingSheet[]=[
      {
        name:"00 회의요약",title:"로파워 데이터집계 · 회의요약",subtitle:"선택 기간의 핵심 매출·수익·영업 지표를 한 장에 정리한 회의용 요약입니다.",
        kpis:[
          {label:"계약 1건당 순이익",value:costKnown?contractNet:"비용 확인 필요",format:"won"},{label:"회수 매출",value:cashSales,format:"won"},{label:"계약 건수",value:contractCount,format:"integer"},{label:"월 목표",value:contractTarget,format:"integer"},
          {label:"DB → 계약 전환율",value:pct(converted,rangeLeads.length),format:"percent1"},{label:"평균 실수임료",value:averageFee,format:"won"},{label:"평균 할인율",value:standardKnown?discountRate:"확인 불가",format:"percent1"},{label:"현금 영업이익",value:costKnown?cashProfit:"비용 확인 필요",format:"won"},
        ],
        sections:[
          {title:"수익 구조",headers:["구분","금액"],rows:[["회수 매출",cashSales],["DB 구매비",costKnown?acquisitionCost:"비용 확인 필요"],["인건비",laborCost],["납부 수수료",paymentFees],["고정 운영비",fixedCost],["현금 기준 영업이익",costKnown?cashProfit:"비용 확인 필요"]],formats:["text","won"],widths:[28,20]},
          ...(isCurrentMonthRange?[{title:"월 목표 페이스",headers:["현재 계약","목표","오늘까지 목표","목표 달성률","월말 예상","남은 기간 일평균 필요"],rows:[[rangeCases.length,contractTarget,expectedContractsByToday,targetProgress,projectedMonthContracts,requiredContractsPerDay]],formats:["integer","integer","number1","percent1","integer","number1"],widths:[14,14,18,16,14,22]}] as any:[]),
          {title:"영업·수납 리스크",headers:["항목","현재 값","기준/설명"],rows:[["활성 DB 상한 초과 인원",overCap.length,globalSuperView?"로펌별 설정 상한 적용":`${activeCap}건 상한`],["방치 DB",neglected.length,globalSuperView?"로펌별 방치 기준 적용":`${neglectDays}일 이상 현재 단계 체류 · 단계 기록 없음 ${stageUnknown}건 제외`],["연체·결제실패",overdueNow.length,`회수율 ${collectionRate.toFixed(1)}%`],["서류준비 14일 이상",docDelay.length,"현재 진행중 사건 기준"]],formats:["text","integer","text"],widths:[28,16,34]},
        ],
      },
      {
        name:"01 팀인원",title:"팀 · 인원 성과",subtitle:"상담사별 결과·과정·품질 지표를 모두 표시합니다.",
        kpis:[{label:"상담 인원",value:staffRows.length,format:"integer"},{label:"전체 DB 생산성",value:moneyPer(contractSales,rangeLeads.length),format:"won"},{label:"총 인건비",value:laborCost,format:"won"},{label:"총 기여이익",value:costKnown?staffRows.reduce((sum,r)=>sum+r.contribution,0):"비용 확인 필요",format:"won"}],
        sections:[{title:"상담사별 성과 상세",headers:["담당자","배정 DB","활성 DB","계약","수임액","회수매출","보상","기여이익","DB 생산성","첫 전화 시도(분)","DB당 컨택","상담완료→계약","할인율","단순분납","연체"],rows:staffRows.map(r=>[r.label,r.db,r.active,r.contracts,r.contractSales,r.cash,r.comp,costKnown?r.contribution:"비용 확인 필요",r.productivity,r.firstSpeed??"확인 불가",r.contacts,r.completedToContractRate,r.discountKnown?r.discountRate:"확인 불가",r.simpleInstallmentRate,r.overdue]),formats:["text","integer","integer","integer","won","won","won","won","won","integer","number1","percent1","percent1","percent1","integer"],widths:[28,12,12,10,18,18,16,18,18,15,14,18,12,14,10]}],
      },
      {
        name:"02 상담운영",title:"상담 운영",subtitle:"유입 월 기준 퍼널과 담당자별 업무량을 회의용으로 정리합니다.",
        kpis:[{label:"첫 전화 시도 중앙값(분)",value:median(contactSpeeds)??"확인 불가",format:"integer"},{label:"DB당 평균 컨택",value:avgContacts,format:"number1"},{label:"2회 이하 종결",value:shortClosed,format:"integer"},{label:"방치 DB",value:neglected.length,format:"integer"}],
        sections:[
          {title:"DB 퍼널",headers:["단계","건수","직전 단계 대비 전환율"],rows:[["신규 DB",rangeLeads.length,100],["통화 연결",connected,pct(connected,rangeLeads.length)],["상담 진행",consult,pct(consult,connected)],["상담 완료",completed,pct(completed,consult)],["계약",converted,pct(converted,completed)]],formats:["text","integer","percent1"],widths:[20,12,24]},
          {title:"업무량 상세",headers:["담당자","활성 DB","배정 상한","첫 전화 시도(분)","DB당 컨택","최소 컨택","운영상태"],rows:staffRows.map(r=>[r.label,r.active,r.cap,r.firstSpeed??"확인 불가",r.contacts,r.minimumContacts,r.active>r.cap?"활성 DB 상한 초과":r.contactKnown&&r.contacts<r.minimumContacts?"최소 컨택 미달":"정상"]),formats:["text","integer","integer","integer","number1","integer","text"],widths:[28,12,12,15,14,12,22]},
        ],
      },
      {
        name:"03 DB구매유입",title:"DB 구매 · 유입",subtitle:"표본 제한 없이 집계 가능한 DB당 구매비·수임당 구매비·연결률·계약·매출을 그대로 표시합니다.",
        kpis:[{label:activeSettings.acquisitionMode==="db_purchase"&&!globalSuperView?"DB 구매비":"DB 구매비",value:costKnown?acquisitionCost:"비용 확인 필요",format:"won"},{label:"DB당 구매비 · DB당 비용",value:costKnown?moneyPer(acquisitionCost,rangeLeads.length):"비용 확인 필요",format:"won"},{label:"수임당 구매비 · 계약당 비용",value:costKnown?moneyPer(acquisitionCost,converted):"비용 확인 필요",format:"won"},{label:"비용 대비 수임액",value:acquisitionCost>0?contractSales/acquisitionCost:0,format:"number1"}],
        sections:[{title:"채널 · 소재 효율",headers:["소재/구분","비용","DB","DB당 구매비","연결률","계약","수임매출","수임당 구매비"],rows:channelRows.map(r=>[r.label,costKnown?r.spend:"확인 필요",r.db,costKnown?r.cpl:"확인 필요",r.connRate,r.won,r.revenue,costKnown?r.cpa:"확인 필요"]),formats:["text","won","integer","won","percent1","integer","won","won"],widths:[34,18,12,18,14,12,20,18]}],
      },
      {
        name:"04 수임매출",title:"수임 · 매출",subtitle:"선택 기간 전체 계약 원장입니다. 화면의 개별 상담사 필터와 무관하게 회의자료에는 전체 계약을 포함합니다.",
        kpis:[{label:"수임 건수",value:contractCount,format:"integer"},{label:"수임액",value:contractSales,format:"won"},{label:"평균 수임료",value:averageFee,format:"won"},{label:"실제 입금",value:cashSales,format:"won"}],
        sections:[{title:"계약별 원장",headers:["수임일","의뢰인","담당","사건유형","납부방식","기준 수임료","계약금액","할인액","실입금","수수료","실수령","상태","사건번호"],rows:allLedger.map(r=>[r.case.contractDate,r.client?.name??"-",r.case.assignedStaff,r.case.caseType,r.case.paymentMethod,r.standardKnown?r.standard:"확인 불가",r.case.contractAmount,r.standardKnown?r.discount:"확인 불가",r.paid,r.fee,r.net,r.status,r.case.caseNumber]),formats:["date","text","text","text","text","won","won","won","won","won","won","text","text"],widths:[14,16,15,14,16,18,18,16,18,16,18,14,22]}],
      },
      {
        name:"05 사건수납",title:"사건 · 수납",subtitle:"현재 사건 진행 단계와 장기체류·연체·취하 데이터를 상세 목록으로 제공합니다.",
        kpis:[{label:"진행중 사건",value:cases.filter(c=>c.status==="진행중").length,format:"integer"},{label:"서류준비 14일+",value:docDelay.length,format:"integer"},{label:"연체·실패",value:overdueNow.length,format:"integer"},{label:"연체 회수율",value:overdueRecovery,format:"percent1"}],
        sections:[
          {title:"사건 진행 단계",headers:["단계","건수"],rows:stageRows.map(r=>[STAGE_GENERIC_LABELS[r.stage],r.count]),formats:["text","integer"],widths:[24,12]},
          {title:"서류준비 장기체류",headers:["의뢰인","사건번호","담당","사건유형","단계 변경일","체류일"],rows:docDelay.map(c=>{const client=clients.find(x=>x.id===c.clientId);return[client?.name??"-",c.caseNumber,c.assignedStaff,c.caseType,c.stageUpdatedAt,daysSince(c.stageUpdatedAt)]}),formats:["text","text","text","text","date","integer"],widths:[16,22,15,14,15,12]},
          {title:"연체 · 결제실패 상세",headers:["납부예정일","의뢰인","사건번호","담당","회차","금액","상태","실납부일"],rows:overdueDetail,formats:["date","text","text","text","integer","won","text","date"],widths:[15,16,22,15,10,18,12,15]},
          {title:"선택 기간 취하 사건",headers:["계약일","의뢰인","사건번호","담당","사건유형","계약금액","납부금액"],rows:cancelled,formats:["date","text","text","text","text","won","won"],widths:[15,16,22,15,14,18,18]},
        ],
      },
      {
        name:"06 산식기준",title:"지표 산식 · 기준",subtitle:"회의에서 숫자의 의미를 바로 확인할 수 있도록 현재 데이터집계 산식을 함께 제공합니다.",
        sections:[{title:"주요 지표 산식",headers:["지표","산식/기준","현재 값"],rows:[["계약 1건당 순이익","(수임액 - DB 구매비 - 인건비) ÷ 계약건수",costKnown?contractNet:"비용 확인 필요"],["현금 영업이익","회수매출 - DB 구매비 - 인건비 - 납부수수료 - 고정운영비",costKnown?cashProfit:"비용 확인 필요"],["DB → 계약 전환율","취하·0원 제외 수임에 연결된 DB ÷ 선택 기간 유입 DB × 100",pct(converted,rangeLeads.length)],["DB당 구매비","DB 구매비 ÷ 유입 DB",costKnown?moneyPer(acquisitionCost,rangeLeads.length):"비용 확인 필요"],["수임당 구매비","DB 구매비 ÷ 계약 전환 DB",costKnown?moneyPer(acquisitionCost,converted):"비용 확인 필요"],["DB 생산성","수임매출 ÷ 배정 DB",moneyPer(contractSales,rangeLeads.length)],["회수율","실제 입금 ÷ 수임액 × 100",collectionRate],["평균 할인율","계약 당시 기준 기록이 있는 사건의 기준 수임료 대비 할인액 비율",standardKnown?discountRate:"확인 불가"]],formats:["text","text","number1"],widths:[26,56,20]}],
      },
      {
        name:"07 정산입력",title:"정산 입력값 · 원가 기준",subtitle:"데이터집계 계산에 사용된 관리자 설정을 함께 내려받아 회의 숫자의 근거를 확인할 수 있습니다.",
        sections:[
          {title:"로펌별 운영 기준",headers:["로펌","유입 비용 방식","DB 구매 단가","월 계약 목표","활성 DB 상한","방치 기준(일)","최소 컨택"],rows:settingsOverview,formats:["text","text","won","integer","integer","integer","integer"],widths:[24,18,18,16,16,16,14]},
          {title:"상담사 보상 조건",headers:["로펌","상담사","계약형태","기본급","성과급 기준","성과급 값","해지 환수"],rows:staffCompRows,formats:["text","text","text","won","text","number1","text"],widths:[24,16,14,18,18,16,14]},
          {title:"납부 방식 수수료",headers:["로펌","납부방식","수수료율","부담 주체"],rows:paymentFeeRows,formats:["text","text","percent1","text"],widths:[24,18,14,16]},
          {title:"월 고정 운영비",headers:["로펌","항목","월 금액"],rows:fixedCostRows,formats:["text","text","won"],widths:[24,28,18]},
          {title:"기준 수임료",headers:["로펌","사건유형","기준 수임료","최저 수임료","승인 필요 할인액","적용 시작일"],rows:feeRuleRows,formats:["text","text","won","won","won","date"],widths:[24,16,18,18,20,15]},
        ],
      },
    ];
    await exportAnalyticsMeetingWorkbook({filename:`로파워_데이터집계_회의자료_${start}_${end}.xlsx`,periodLabel,scopeLabel,sheets});
  }

  if(!manager)return <><PageHeader title="데이터집계" description="최고 관리자 전용 지표입니다."/><Card className="p-6 text-sm text-slate-600">데이터집계는 로펌 관리자 또는 슈퍼관리자만 사용할 수 있습니다.</Card></>;
  if(settingsLoading)return <div className="p-8 text-sm text-slate-500">관리자 지표를 불러오는 중...</div>;

  return <>
    <PageHeader title="데이터집계" description={globalSuperView?"전체 로펌 관리자 지표를 통합 조회합니다. DB 구매 로펌에는 공급 원장에 기록된 해당 로펌의 DB 구매비를 적용합니다.":"수익 · DB 생산성 · 상담 과정 · 수임 · 수납을 최고 관리자 기준으로 봅니다."} action={<div className="flex flex-wrap items-center justify-end gap-2"><button onClick={()=>void exportMeetingWorkbook().catch(e=>alert(e.message))} className="flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white shadow-sm hover:bg-emerald-700"><FileSpreadsheet size={15}/>전체 회의자료 XLSX</button><DateRangePicker start={start} end={end} onChange={(s,e)=>{setStart(s);setEnd(e)}}/></div>}/>
    {settingsError&&<Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">정산설정 일부를 불러오지 못했습니다: {settingsError}</Card>}
    <Card className="mb-4 p-3 text-xs text-slate-500">유입은 접수일, 수임은 유상·취하 제외 계약일, 실입금은 납부일 기준입니다. 공급 전환율은 오늘 기준 공급 후 60일 이상 경과한 DB 코호트이며 분모 30건 미만은 판단을 유예합니다. 전화 시도·컨택은 새 구조화 기록만 집계하며 과거 미기록은 확인 불가입니다.</Card>
    {(supply.error||!costKnown)&&<Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{supply.loading?"공급 원장을 불러오는 중입니다.":supply.error||"공급 단가가 미확정입니다. 구매비 및 이익을 확정할 수 없습니다."}</Card>}
    {closed&&<Card className="mb-4 bg-emerald-50 p-3 text-xs text-emerald-800">완전한 월의 수임·실입금·비용은 서버에서 확정한 마감 합계입니다. 상세 원장은 현재 업무 자료이며 과거 입력을 소급 변경하지 않습니다.</Card>}
    <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">{TABS.map(t=><button key={t} onClick={()=>setTab(t)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab===t?"bg-blue-600 text-white":"text-slate-600 hover:bg-slate-50"}`}>{t}</button>)}</div>

    {tab==="요약"&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><KpiCard label="계약 1건당 순이익" value={costKnown?fmtWon(contractNet):"비용 확인 필요"}/><KpiCard label="회수 매출" value={fmtWon(cashSales)}/><KpiCard label="계약 / 목표" value={`${contractCount} / ${contractTarget || 0}건`}/><div className={(supply.data?.matureCohort.supplied??0)<30?"opacity-60":""}><KpiCard label="60일 경과 공급 → 수임" value={supply.data?.serviceMode==="crm_only"?"공급계약 대상 아님":supply.data?ratioLabel(supply.data.matureCohort.retained,supply.data.matureCohort.supplied):"공급 원장 확인 필요"}/></div><KpiCard label="평균 실수임료" value={fmtWon(averageFee)}/><KpiCard label="평균 할인율" value={standardKnown?`${discountRate.toFixed(1)}% · 기록 ${standardKnown}/${rangeCases.length}건`:"기준 기록 없음"}/><KpiCard label="DB 구매비" value={supply.data?.serviceMode==="crm_only"?"공급계약 없음":costKnown?fmtWon(acquisitionCost):"단가 확인 필요"}/><KpiCard label="첫 전화 시도 중앙값" value={minuteText(median(contactSpeeds))}/><KpiCard label="자체 분납 비율" value={`${pct(selfInstallments,rangeCases.length).toFixed(1)}%`}/><KpiCard label="현금 기준 영업이익" value={costKnown?fmtWon(cashProfit):"비용 확인 필요"}/></div>
      {isCurrentMonthRange&&<Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-black">월 목표 페이스</div><div className="mt-1 text-xs text-slate-500">오늘까지 목표 {expectedContractsByToday.toFixed(1)}건 · 현재 {rangeCases.length}건 · 월말 예상 {projectedMonthContracts}건</div></div><div className="text-right"><div className={`text-lg font-black ${rangeCases.length<expectedContractsByToday?"text-amber-700":"text-emerald-700"}`}>{targetProgress.toFixed(1)}%</div><div className="text-[11px] text-slate-400">남은 기간 하루 {requiredContractsPerDay.toFixed(1)}건 필요</div></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${rangeCases.length<expectedContractsByToday?"bg-amber-500":"bg-emerald-500"}`} style={{width:`${Math.min(100,targetProgress)}%`}}/></div></Card>}
      <Card className="p-5"><div className="text-sm font-black">수익 구조</div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[["회수 매출",cashSales],["− DB 구매비",-acquisitionCost],["− 인건비",-laborCost],["− 납부수수료·운영비",-(paymentFees+fixedCost)],["= 현금 영업이익",cashProfit]].map(([l,v])=><div key={String(l)} className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500">{l}</div><div className={`mt-2 text-lg font-black ${Number(v)<0?"text-red-600":"text-slate-900"}`}>{Number(v)<0?"− ":""}{!costKnown&&(String(l).includes("구매비")||String(l).includes("영업이익"))?"비용 확인 필요":fmtWon(Math.abs(Number(v)))}</div></div>)}</div><div className="mt-3 text-[11px] text-slate-400">해지·환불 금액은 현재 계약 스키마에 별도 금액 필드가 없어 영업이익에서 자동 차감하지 않습니다. 취하 건수는 사건·수납 탭에서 별도 표시합니다.</div></Card>
      <div className="grid gap-4 xl:grid-cols-3">{[{title:`활성 DB 상한 초과 ${overCap.length}명`,body:globalSuperView?"로펌별 설정 상한 기준 · 신규 배정 조정 필요":`기준 ${activeCap}건 · 신규 배정 조정 필요`,bad:overCap.length>0},{title:`방치 DB ${neglected.length}건`,body:globalSuperView?"로펌별 방치 회수 기준 적용":`${neglectDays}일 이상 현재 단계 체류 · 기록 없음 ${stageUnknown}건 제외`,bad:neglected.length>0},{title:`연체·결제실패 ${overdueNow.length}건`,body:`현재 미수 위험 · 회수율 ${collectionRate.toFixed(1)}%`,bad:overdueNow.length>0}].map(x=><Card key={x.title} className={`p-4 ${x.bad?"border-red-200 bg-red-50/60":""}`}><div className="flex items-center gap-2 text-sm font-black"><AlertTriangle size={15} className={x.bad?"text-red-500":"text-slate-400"}/>{x.title}</div><div className="mt-1 text-xs text-slate-500">{x.body}</div></Card>)}</div>
    </div>}

    {tab==="팀 · 인원"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="상담 인원" value={`${staffRows.length}명`}/><KpiCard label="DB 생산성" value={fmtWon(moneyPer(contractSales,rangeLeads.length))}/><KpiCard label="총 인건비" value={settingsError?"설정 확인 필요":fmtWon(laborCost)}/><KpiCard label="총 기여이익" value={costKnown?fmtWon(staffRows.reduce((s,r)=>s+r.contribution,0)):"비용 확인 필요"}/></div><Card className="overflow-hidden"><div className="border-b px-5 py-4 text-sm font-black">상담사 결과 · 과정 · 품질</div><div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["담당자","배정 DB","활성 DB","계약","수임액","회수매출","보상","기여이익","DB 생산성","첫 전화 시도","DB당 컨택","상담완료→계약","할인율","단순분납","연체"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{staffRows.map(r=><tr key={r.label} className={`border-t ${r.db<30?"text-slate-400":""}`}><td className="px-4 py-3 font-bold">{r.label}</td><td className="px-4 py-3">{r.db}</td><td className={`px-4 py-3 font-bold ${r.active>activeCap?"text-red-600":""}`}>{r.active}</td><td className="px-4 py-3">{r.contracts}</td><td className="px-4 py-3">{fmtWon(r.contractSales)}</td><td className="px-4 py-3">{fmtWon(r.cash)}</td><td className="px-4 py-3">{fmtWon(r.comp)}</td><td className={`px-4 py-3 font-black ${r.contribution<0?"text-red-600":"text-emerald-700"}`}>{costKnown?fmtWon(r.contribution):"비용 확인 필요"}</td><td className="px-4 py-3">{fmtWon(r.productivity)}</td><td className="px-4 py-3">{minuteText(r.firstSpeed)}</td><td className="px-4 py-3">{r.contactKnown?`${r.contacts.toFixed(1)}회`:"확인 불가"}</td><td className="px-4 py-3">{r.completedToContractRate.toFixed(1)}%</td><td className={`px-4 py-3 ${r.discountRate>10?"font-bold text-amber-700":""}`}>{r.discountKnown?`${r.discountRate.toFixed(1)}% · ${r.discountKnown}/${r.contracts}건`:"기준 기록 없음"}</td><td className={`px-4 py-3 ${r.simpleInstallmentRate>60?"font-bold text-amber-700":""}`}>{r.simpleInstallmentRate.toFixed(1)}%</td><td className={`px-4 py-3 ${r.overdue>0?"font-bold text-red-600":""}`}>{r.overdue}건</td></tr>)}</tbody></table></div></Card><Card className="p-5 text-xs leading-6 text-slate-600"><b className="text-slate-900">운영 기준:</b> 결과는 월 단위(수임·회수·DB 생산성·기여이익), 과정은 주 단위(첫 전화 시도·컨택·전환), 품질은 상시(할인·자체분납·연체·입력)로 봅니다. 신규 인원은 초반 행동지표를 먼저 확인하세요.</Card></div>}

    {tab==="상담 운영"&&<FirmOperationsDetails leads={rangeLeads} cases={cases}/>}
    {tab==="상담 운영"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="첫 전화 시도 중앙값" value={minuteText(median(contactSpeeds))}/><KpiCard label="DB당 평균 컨택" value={rangeLeads.some(l=>structuredContacts(l)!==undefined)?`${avgContacts.toFixed(1)}회`:"확인 불가"}/><KpiCard label="2회 이하 종결" value={`${shortClosed}건`}/><KpiCard label={`${neglectDays}일 방치 DB`} value={`${neglected.length}건`}/></div><Card className="p-5"><div className="text-sm font-black">DB 퍼널 · 유입 월 기준</div><div className="mt-4 grid gap-3 sm:grid-cols-5">{[["신규 DB",rangeLeads.length],["통화 연결",connected],["상담 진행",consult],["상담 완료",completed],["계약",converted]].map(([l,v],i)=><div key={String(l)} className="rounded-xl border p-4"><div className="text-xs font-bold text-slate-500">{l}</div><div className="mt-2 text-2xl font-black">{v}건</div>{i>0&&<div className="mt-1 text-[11px] text-slate-400">이전 단계 대비 {pct(Number(v),Number([[0,rangeLeads.length],[0,rangeLeads.length],[0,connected],[0,consult],[0,completed]][i][1])).toFixed(1)}%</div>}</div>)}</div></Card><Card className="overflow-hidden"><div className="border-b px-5 py-4 text-sm font-black">업무량 · 과부하 점검</div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["담당자","활성 DB","배정 상한","첫 전화 시도","DB당 컨택","최소 컨택","판단"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{staffRows.map(r=><tr key={r.label} className={`border-t ${r.db<30?"text-slate-400":""}`}><td className="px-4 py-3 font-bold">{r.label}</td><td className="px-4 py-3">{r.active}</td><td className="px-4 py-3">{r.cap}</td><td className="px-4 py-3">{minuteText(r.firstSpeed)}</td><td className="px-4 py-3">{r.contactKnown?r.contacts.toFixed(1):"확인 불가"}</td><td className="px-4 py-3">{r.minimumContacts}회</td><td className="px-4 py-3"><span className={`rounded-md px-2 py-1 text-xs font-bold ${r.active>r.cap?"bg-red-50 text-red-700":r.contactKnown&&r.contacts<r.minimumContacts?"bg-amber-50 text-amber-700":"bg-emerald-50 text-emerald-700"}`}>{r.active>r.cap?"배정 중단 검토":!r.contactKnown?"기록 확인 필요":r.contacts<r.minimumContacts?"컨택 코칭":"정상"}</span></td></tr>)}</tbody></table></div></Card><Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">전화 시도·컨택·연결은 구조화된 전화/문자 기록만 집계합니다. 기존 메모에서 자동 추정하지 않으며 기록이 없는 DB는 확인 불가로 남깁니다.</Card></div>}

    {tab==="DB 구매 · 유입"&&<div className="space-y-4"><FirmSupplyCard data={supply.data} loading={supply.loading} error={supply.error}/><Card className="p-5"><h3 className="text-sm font-black">유입경로별 성과</h3><p className="mt-1 text-xs text-slate-500">선택 기간 유입 DB에 연결된 현재까지의 유상 수임 기준입니다. 30건 미만 경로는 회색으로 표시합니다.</p><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["유입경로","유입 DB","수임 전환","수임매출","DB당 수임매출"].map(h=><th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{channelRows.map(row=><tr key={row.key} className={`border-t ${row.db<30?"text-slate-400":""}`}><td className="p-3">{row.label}</td><td className="p-3">{row.db}건</td><td className="p-3">{ratioLabel(row.won,row.db)}</td><td className="p-3">{fmtWon(row.revenue)}</td><td className="p-3">{fmtWon(moneyPer(row.revenue,row.db))}</td></tr>)}</tbody></table></div></Card></div>}

    {tab==="수임 · 매출"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="수임 건수" value={`${contractCount}건`}/><KpiCard label="수임액" value={fmtWon(contractSales)}/><KpiCard label="평균 수임료" value={fmtWon(averageFee)}/><KpiCard label="실제 입금" value={fmtWon(cashSales)}/></div><Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4"><div><div className="text-sm font-black">계약 원장 RAW 데이터</div><div className="mt-1 text-xs text-slate-500">현재 기간·상담사 필터가 다운로드 파일에 그대로 적용됩니다. 계약 당시 기준 기록이 없는 과거 건은 확인 불가로 표시합니다.</div></div><div className="flex items-center gap-2"><select value={staffFilter} onChange={(e)=>setStaffFilter(e.target.value)} className="h-9 rounded-lg border px-3 text-xs"><option>전체</option>{allStaff.map(s=><option key={s}>{s}</option>)}</select><button onClick={()=>void exportXlsx().catch(e=>alert(e.message))} className="flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white"><FileSpreadsheet size={13}/>XLSX</button><button onClick={()=>void exportLedgerCsv().catch(e=>alert(e.message))} className="flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-bold"><Download size={13}/>CSV</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["수임일","의뢰인","담당","사건유형","납부방식","기준 수임료","계약금액","할인액","실입금","수수료","실수령","상태"].map(h=><th key={h} className="px-3 py-3 text-left">{h}</th>)}</tr></thead><tbody>{ledger.map(r=><tr key={r.case.id} className="border-t"><td className="px-3 py-3">{r.case.contractDate}</td><td className="px-3 py-3 font-bold">{r.client?.name??"-"}</td><td className="px-3 py-3">{r.case.assignedStaff}</td><td className="px-3 py-3">{r.case.caseType}</td><td className="px-3 py-3">{r.case.paymentMethod}</td><td className="px-3 py-3">{r.standardKnown?fmtWon(r.standard):"확인 불가"}</td><td className="px-3 py-3">{fmtWon(r.case.contractAmount)}</td><td className="px-3 py-3 text-amber-700">{!r.standardKnown?"확인 불가":r.discount?fmtWon(r.discount):"-"}</td><td className="px-3 py-3">{fmtWon(r.paid)}</td><td className="px-3 py-3">{fmtWon(r.fee)}</td><td className="px-3 py-3 font-bold">{fmtWon(r.net)}</td><td className="px-3 py-3">{r.status}</td></tr>)}</tbody></table></div></Card></div>}

    {tab==="사건 · 수납"&&<Card className="p-5"><h3 className="text-sm font-black">미제출 서류 체크리스트</h3><p className="mt-1 text-xs text-slate-500">기존 서류 체크리스트의 미체크 항목입니다. 고객별 필요 여부를 확인해주세요.</p><div className="mt-3 divide-y">{missingDocuments.map(({record,missing})=><div key={record.id} className="py-3 text-sm"><b>{clientsById.get(record.clientId)?.name??"-"}</b><span className="ml-2 text-xs text-slate-500">담당 {record.assignedStaff} · {missing.length}개 미확인</span><p className="mt-1 text-xs text-slate-500">{missing.map(item=>item.label).join(" · ")}</p></div>)}{!missingDocuments.length&&<p className="text-sm text-slate-500">해당 단계의 미확인 서류가 없습니다.</p>}</div></Card>}
    {tab==="사건 · 수납"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="진행중 사건" value={`${cases.filter(c=>c.status==="진행중").length}건`}/><KpiCard label="서류준비 14일+" value={`${docDelay.length}건`}/><KpiCard label="연체·실패" value={`${overdueNow.length}건`}/><KpiCard label="연체 회수율" value={`${overdueRecovery.toFixed(1)}%`}/></div><div className="grid gap-4 xl:grid-cols-2"><Card className="p-5"><div className="text-sm font-black">사건 진행 단계</div><div className="mt-4 space-y-3">{stageRows.map(r=>{const max=Math.max(1,...stageRows.map(x=>x.count));return <div key={r.stage}><div className="mb-1 flex justify-between text-xs"><span>{STAGE_GENERIC_LABELS[r.stage]}</span><b>{r.count}건</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-600" style={{width:`${Math.round(r.count/max*100)}%`}}/></div></div>})}</div></Card><Card className="overflow-hidden"><div className="border-b px-5 py-4 text-sm font-black">서류준비 장기체류</div><div className="divide-y">{docDelay.slice(0,12).map(c=>{const client=clients.find(x=>x.id===c.clientId);return <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div><b>{client?.name??"-"}</b><div className="text-xs text-slate-400">담당 {c.assignedStaff} · {c.caseType}</div></div><div className="font-bold text-amber-700">{daysSince(c.stageUpdatedAt)}일</div></div>})}{!docDelay.length&&<div className="p-8 text-center text-xs text-slate-400">14일 이상 체류 사건이 없습니다.</div>}</div></Card></div><Card className="p-5"><div className="flex items-center gap-2 text-sm font-black"><ShieldAlert size={16}/>해지 · 환불 추적</div><div className="mt-3 text-sm text-slate-600">선택 기간 취하 사건 <b>{periodCases.filter(c=>c.status==="취하").length}건</b>. 현재 CRM에는 환불 금액 전용 필드가 없어 환불액은 자동 집계하지 않습니다. 환불 금액 필드를 추가하면 영업이익에서 즉시 차감하도록 연결할 수 있습니다.</div></Card></div>}
  </>;
}
