"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDollarSign, FileSignature, PhoneCall, PhoneMissed, UserPlus } from "lucide-react";
import { useStore } from "@/lib/store";
import { DB_LEAD_DEFAULT_STAGE_BY_STATUS, type DbLead } from "@/lib/types";
import { checkCallWarning, checkPeriodicContactWarning, kstDateStr } from "@/lib/consultation";
import {
  DEFAULT_MANAGEMENT_SETTINGS,
  acquisitionCostForRange,
  fixedCostForRange,
  inDateRange,
  isManagerProfile,
  laborCostForRange,
  paymentFeesForRange,
  useManagementSettings,
  type ManagementSettings,
} from "@/lib/management-analytics";
import { fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KpiCard } from "@/components/ui/KpiCard";
import { MonthCalendar, type CalendarItem } from "@/components/charts/MonthCalendar";

function monthRange(){const d=new Date();const y=d.getFullYear(),m=d.getMonth()+1;return{start:`${y}-${String(m).padStart(2,"0")}-01`,end:`${y}-${String(m).padStart(2,"0")}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`}}
function stageOf(lead:DbLead){return lead.detailStage??DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status]}
function terminalLead(lead:DbLead){return !!lead.convertedClientId||["거절","부적합","종결_중단"].includes(lead.status)}
function lastActivityAt(lead:DbLead){const rows=lead.consultation?.memoLog??[];return rows.length?[...rows].sort((a,b)=>b.at.localeCompare(a.at))[0].at:lead.receivedAt}
function daysSince(value?:string){if(!value)return 0;return Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/86400000))}
function greetingCompletedToday(lead:DbLead,today:string){const received=new Date(lead.receivedAt);if(!Number.isFinite(received.getTime())||kstDateStr(received)!==today)return false;return(lead.consultation?.memoLog??[]).some(e=>{const at=new Date(e.at);return Number.isFinite(at.getTime())&&kstDateStr(at)===today&&/(문자|인사)/.test(e.text)&&/(완료|발송|안내)/.test(e.text)})}
function leadNeedsContact(lead:DbLead,today:string){if(lead.convertedClientId)return false;const s=stageOf(lead);if(s==="장기부재")return checkPeriodicContactWarning(lead.consultation?.memoLog,today,3).active;if(s==="착수금 안내")return checkCallWarning(lead.consultation?.memoLog,today,1).active;if(s==="미상담"||s==="부재")return checkCallWarning(lead.consultation?.memoLog,today,2).active;return false}
function settingsForFirm(map:Record<string,ManagementSettings>,firmId?:string,fallback?:ManagementSettings){return firmId&&map[firmId]?map[firmId]:(fallback||DEFAULT_MANAGEMENT_SETTINGS)}

export default function DashboardPage(){
  const {clients,cases,installments,scheduleItems,leads,isAdmin,currentStaff,can,profile,superAdminFirmScope,workStaffNames,firmDirectory}=useStore();
  const manager=isManagerProfile(profile);const {globalSuperView,activeSettings,settingsByFirm}=useManagementSettings(profile,superAdminFirmScope,workStaffNames);
  const init=monthRange();const[start,setStart]=useState(init.start);const[end,setEnd]=useState(init.end);const[paymentMonth,setPaymentMonth]=useState(init.start.slice(0,7));const[hearingMonth,setHearingMonth]=useState(init.start.slice(0,7));const today=kstDateStr();
  const topLeads=useMemo(()=>isAdmin||can("dashboard.company_metrics")?leads:leads.filter(l=>!!currentStaff&&l.assignedStaff===currentStaff),[isAdmin,can,leads,currentStaff]);
  const topCases=useMemo(()=>isAdmin||can("dashboard.company_metrics")?cases:cases.filter(c=>!!currentStaff&&c.assignedStaff===currentStaff),[isAdmin,can,cases,currentStaff]);
  const top=useMemo(()=>({newToday:topLeads.filter(l=>greetingCompletedToday(l,today)).length,contact:topLeads.filter(l=>leadNeedsContact(l,today)).length,recall:topLeads.filter(l=>stageOf(l)==="예약"&&!l.convertedClientId).length,consulting:topLeads.filter(l=>stageOf(l)==="상담"&&!l.convertedClientId).length,completed:topLeads.filter(l=>!!l.convertedClientId||["착수금 안내","설득필요"].includes(stageOf(l))).length}),[topLeads,today]);
  const periodCases=topCases.filter(c=>inDateRange(c.contractDate,start,end));const contractSales=periodCases.reduce((s,c)=>s+c.contractAmount,0);const topCaseIds=new Set(topCases.map(c=>c.id));const paid=installments.filter(i=>topCaseIds.has(i.caseId)&&i.status==="완료"&&inDateRange(i.paidDate,start,end)).reduce((s,i)=>s+i.amount,0);const receivable=topCases.reduce((s,c)=>s+Math.max(0,c.contractAmount-c.paidAmount),0);

  function aggregateCost(kind:"acq"|"labor"|"fee"|"fixed"){
    if(!manager)return 0;if(!globalSuperView){if(kind==="acq")return acquisitionCostForRange(leads,activeSettings,start,end);if(kind==="labor")return laborCostForRange(cases,installments,activeSettings,start,end);if(kind==="fee")return paymentFeesForRange(cases,installments,activeSettings,start,end);return fixedCostForRange(activeSettings,start,end)}
    const fallbackIds=Array.from(new Set([...leads.map(x=>x._lawFirmId),...cases.map(x=>x._lawFirmId)].filter(Boolean) as string[]));
    const ids=firmDirectory.filter(f=>f.status==="active").map(f=>f.id).length?firmDirectory.filter(f=>f.status==="active").map(f=>f.id):fallbackIds;
    return ids.reduce((sum,id)=>{const s=settingsForFirm(settingsByFirm,id);const fl=leads.filter(x=>x._lawFirmId===id),fc=cases.filter(x=>x._lawFirmId===id),fi=installments.filter(x=>x._lawFirmId===id||fc.some(c=>c.id===x.caseId));if(kind==="acq")return sum+acquisitionCostForRange(fl,s,start,end);if(kind==="labor")return sum+laborCostForRange(fc,fi,s,start,end);if(kind==="fee")return sum+paymentFeesForRange(fc,fi,s,start,end);return sum+fixedCostForRange(s,start,end)},0)
  }
  const acq=aggregateCost("acq"),labor=aggregateCost("labor"),fees=aggregateCost("fee"),fixed=aggregateCost("fixed"),cashProfit=paid-acq-labor-fees-fixed,netPer=periodCases.length?(contractSales-acq-labor)/periodCases.length:0;
  const collectionRate=contractSales>0?(paid/contractSales)*100:0;
  const targetContracts=globalSuperView
    ? firmDirectory.filter(f=>f.status==="active").reduce((sum,f)=>sum+settingsForFirm(settingsByFirm,f.id).monthlyContractTarget,0)
    : activeSettings.monthlyContractTarget;
  const currentMonth=monthRange();
  const isCurrentMonthRange=start===currentMonth.start&&end===currentMonth.end;
  const currentDay=Math.max(1,Number(today.slice(8,10))||1);
  const daysInCurrentMonth=Math.max(1,Number(currentMonth.end.slice(8,10))||30);
  const expectedContractsByToday=targetContracts*(currentDay/daysInCurrentMonth);
  const projectedMonthContracts=Math.round((periodCases.length/currentDay)*daysInCurrentMonth);
  const remainingDays=Math.max(1,daysInCurrentMonth-currentDay+1);
  const requiredContractsPerDay=Math.max(0,(targetContracts-periodCases.length)/remainingDays);
  const targetProgress=targetContracts>0?(periodCases.length/targetContracts)*100:0;
  const activeLeads=leads.filter(l=>!terminalLead(l));
  const neglected=activeLeads.filter(l=>daysSince(lastActivityAt(l))>=(globalSuperView?settingsForFirm(settingsByFirm,l._lawFirmId).neglectedDays:activeSettings.neglectedDays));
  const loadMap=new Map<string,{count:number,cap:number}>();
  activeLeads.forEach(l=>{const k=`${l._lawFirmId??"firm"}::${l.assignedStaff}`;const cap=globalSuperView?settingsForFirm(settingsByFirm,l._lawFirmId).activeDbCap:activeSettings.activeDbCap;const row=loadMap.get(k)??{count:0,cap};row.count+=1;row.cap=cap;loadMap.set(k,row)});
  const overCap=Array.from(loadMap.values()).filter(v=>v.count>v.cap).length;

  const todoLeads=isAdmin||can("dashboard.company_todo")?leads:leads.filter(l=>!!currentStaff&&l.assignedStaff===currentStaff);
  const todos=todoLeads.flatMap(lead=>{
    if(lead.convertedClientId)return [];
    const stage=stageOf(lead);
    let kind="";
    if(stage==="예약")kind="예약콜";
    else if(stage==="착수금 안내"&&leadNeedsContact(lead,today))kind="착수금 안내";
    else if(["미상담","부재"].includes(stage)&&leadNeedsContact(lead,today))kind="부재콜";
    else if(stage==="장기부재"&&leadNeedsContact(lead,today))kind="장기부재 점검";
    else if(stage==="상담")kind="상담 중";
    else if(lead.status==="고려중"||stage==="설득필요")kind="설득 필요";
    return kind?[{kind,lead}]:[];
  }).slice(0,20);
  const overdue=installments.filter(i=>i.status==="연체"||i.status==="실패");
  const paymentItems:CalendarItem[]=installments.filter(i=>i.dueDate.startsWith(paymentMonth)).map(i=>{const c=cases.find(x=>x.id===i.caseId);const client=c?clients.find(x=>x.id===c.clientId):undefined;return{id:i.id,date:i.dueDate,label:client?.name??"-",sub:can("dashboard.finance")?`${i.seq===1?"계약금":`${i.seq-1}회차`} · ${fmtWon(i.amount)}`:(i.seq===1?"계약금":`${i.seq-1}회차`),done:i.status==="완료",status:i.status,amount:can("dashboard.finance")?i.amount:0}});
  const paymentSummary=useMemo(()=>{const rows=installments.filter(i=>i.dueDate.startsWith(paymentMonth));const done=rows.filter(i=>i.status==="완료").reduce((s,i)=>s+i.amount,0);const expected=rows.filter(i=>i.status!=="완료").reduce((s,i)=>s+i.amount,0);return{paid:done,expected,total:done+expected}},[installments,paymentMonth]);
  const hearingItems:CalendarItem[]=scheduleItems.filter(s=>s.date.startsWith(hearingMonth)).map(s=>{const c=s.caseId?cases.find(x=>x.id===s.caseId):undefined;const client=c?clients.find(x=>x.id===c.clientId):undefined;return{id:s.id,date:s.date,label:client?.name??"-",sub:`${s.type} · ${s.title}`,done:s.done,amount:0}});

  const topCards=[[UserPlus,"당일신규 DB",top.newToday,"문자인사 완료"],[PhoneMissed,"컨택 필요 DB",top.contact,"단계별 컨택 대상"],[CalendarClock,"재통화약속 DB",top.recall,"예약 일정"],[PhoneCall,"상담중 DB",top.consulting,"현재 상담 단계"],[CheckCircle2,"상담완료 DB",top.completed,"후속 단계 포함"],[FileSignature,"계약건",periodCases.length,can("dashboard.finance")?fmtWon(contractSales):"선택 기간"]] as const;

  return <>
    <PageHeader title="대시보드" description={manager?(globalSuperView?"전체 로펌 운영 현황과 관리자 핵심지표를 확인합니다.":"영업 현황과 함께 계약 1건당 순이익·회수매출·DB 방치 위험을 바로 확인합니다."):"허용된 담당범위의 영업 현황과 일정을 확인합니다."} action={<DateRangePicker start={start} end={end} onChange={(s,e)=>{setStart(s);setEnd(e)}}/>}/>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{topCards.map(([Icon,label,value,sub])=><Card key={label} className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><Icon size={16} className="text-blue-500"/></div><div className="mt-3 text-2xl font-black">{value}건</div><div className="mt-1 text-[11px] text-slate-400">{sub}</div></Card>)}</div>

    {manager&&<>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"><KpiCard label="계약 1건당 순이익" value={fmtWon(netPer)}/><KpiCard label="회수 매출" value={fmtWon(paid)}/><KpiCard label="계약 / 월 목표" value={`${periodCases.length} / ${targetContracts || 0}건`}/><KpiCard label="회수율" value={`${collectionRate.toFixed(1)}%`}/><KpiCard label="DB/광고 비용" value={fmtWon(acq)}/><KpiCard label="인건비" value={fmtWon(labor)}/><KpiCard label="현재 미수금" value={fmtWon(receivable)}/><KpiCard label="현금 영업이익" value={fmtWon(cashProfit)}/></div>
      {isCurrentMonthRange&&<Card className="mt-3 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-black">월 목표 페이스</div><div className="mt-1 text-xs text-slate-500">오늘까지 목표 {expectedContractsByToday.toFixed(1)}건 · 현재 {periodCases.length}건 · 월말 예상 {projectedMonthContracts}건</div></div><div className="text-right"><div className={`text-lg font-black ${periodCases.length<expectedContractsByToday?"text-amber-700":"text-emerald-700"}`}>{targetProgress.toFixed(1)}%</div><div className="text-[11px] text-slate-400">목표 달성률 · 남은 기간 하루 {requiredContractsPerDay.toFixed(1)}건 필요</div></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${periodCases.length<expectedContractsByToday?"bg-amber-500":"bg-emerald-500"}`} style={{width:`${Math.min(100,targetProgress)}%`}}/></div></Card>}
      <div className="mt-3 grid gap-3 xl:grid-cols-3"><Card className={`p-4 ${overCap?"border-red-200 bg-red-50":""}`}><div className="flex items-center gap-2 text-sm font-black"><AlertTriangle size={15}/>활성 DB 상한 초과 {overCap}명</div><div className="mt-1 text-xs text-slate-500">{globalSuperView?"각 로펌별 활성 DB 상한 기준":"1인 "+activeSettings.activeDbCap+"건 기준"} · 초과 인원 신규 배정 조정 권장</div></Card><Card className={`p-4 ${neglected.length?"border-amber-200 bg-amber-50":""}`}><div className="flex items-center gap-2 text-sm font-black"><AlertTriangle size={15}/>방치 DB {neglected.length}건</div><div className="mt-1 text-xs text-slate-500">{globalSuperView?"각 로펌별 방치 회수 기준 적용":activeSettings.neglectedDays+"일 이상 무진척 기준"} · 재배정 검토</div></Card><Card className={`p-4 ${overdue.length?"border-red-200 bg-red-50":""}`}><div className="flex items-center gap-2 text-sm font-black"><CircleDollarSign size={15}/>연체·결제실패 {overdue.length}건</div><div className="mt-1 text-xs text-slate-500">미수 회수 우선 확인</div></Card></div>
    </>}

    <Card className="mt-4 overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><div className="text-sm font-black">오늘의 투두</div><Link href="/db" className="text-xs font-bold text-blue-700">DB관리 열기</Link></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["구분",...(globalSuperView?["로펌"]:[]),"고객명","연락처","담당자","예약/상태","메모"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{todos.map(({kind,lead})=><tr key={`${kind}-${lead.id}`} className="border-t"><td className="px-4 py-3"><span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">{kind}</span></td>{globalSuperView&&<td className="px-4 py-3 text-xs text-violet-700">{lead._lawFirmName??"-"}</td>}<td className="px-4 py-3 font-bold">{lead.name}</td><td className="px-4 py-3">{lead.phone}</td><td className="px-4 py-3">{lead.assignedStaff}</td><td className="px-4 py-3">{lead.reservationAt?.replace("T"," ")??stageOf(lead)}</td><td className="max-w-[320px] truncate px-4 py-3 text-slate-500">{lead.memo||"-"}</td></tr>)}{!todos.length&&<tr><td colSpan={globalSuperView?7:6} className="px-4 py-10 text-center text-slate-400">현재 투두가 없습니다.</td></tr>}</tbody></table></div></Card>

    {(can("dashboard.installment_calendar")||can("dashboard.schedule_calendar"))&&<div className="mt-4 grid gap-4 xl:grid-cols-2">{can("dashboard.installment_calendar")&&<MonthCalendar title="분납 캘린더" month={paymentMonth} onMonthChange={setPaymentMonth} items={paymentItems} tone="blue" summary={can("dashboard.finance")?paymentSummary:undefined}/>} {can("dashboard.schedule_calendar")&&<MonthCalendar title="기일·제출기한 캘린더" month={hearingMonth} onMonthChange={setHearingMonth} items={hearingItems} tone="amber"/>}</div>}
  </>
}
