"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildAnalyticsReport, monthRange, firstAnalyticsMonth, daysSince } from "@/lib/analytics-report";
import { LEDGER_HEADERS, createLedgerSection, ledgerValues, ledgerTotals } from "@/lib/analytics-ledger-sheet";
import { RECEIPT_HEADERS, createReceiptOnlySection, receiptValues } from "@/lib/analytics-receipts";
import type { AnalyticsLedgerMode } from "@/lib/analytics-ledger";
import { AlertTriangle, Download, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { STAGE_GENERIC_LABELS } from "@/lib/types";
import { isManagerProfile, useManagementSettings } from "@/lib/management-analytics";
import { fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { KpiCard } from "@/components/ui/KpiCard";
import { InfoHelp } from "@/components/ui/InfoHelp";
import { exportAnalyticsMeetingWorkbook } from "@/lib/analytics-excel";
import { structuredContacts, ratioLabel, type FirmSupplySummary } from "@/lib/firm-reporting";
import { useAnalyticsSource } from "@/lib/use-analytics-source";
import { useFirmSupply } from "@/lib/use-firm-supply";
import { FirmOperationsDetails } from "@/components/analytics/FirmOperationsDetails";
import { FirmSupplyCard } from "@/components/analytics/FirmSupplyCard";
import { recordManagementExport } from "@/lib/management-export-client";
import { authJson } from "@/lib/platform/client";
import { LeadRetainerConversionCard } from "./LeadRetainerConversionCard";
import { StaffRetainerConversionTable } from "./StaffRetainerConversionTable";
import { SupplyRetainerConversion, supplyConversionRateLabel } from "./SupplyRetainerConversion";

const TABS = ["수임 · 매출", "요약", "팀 · 인원", "상담 운영", "사건 · 수납", "산식 · 기준", "DB 구매 · 유입"] as const;
type Tab = typeof TABS[number];
const EMPTY_SOURCE: Pick<ReturnType<typeof useStore>,"leads"|"cases"|"clients"|"installments">={leads:[],cases:[],clients:[],installments:[]};

function pct(n:number,d:number){return d>0?(n/d)*100:0}
function moneyPer(n:number,d:number){return d>0?n/d:0}

function downloadCsv(rows: Array<Record<string,string|number>>, filename:string){
  if(!rows.length)return; const headers=Object.keys(rows[0]);
  const esc=(v:string|number)=>`"${(typeof v==="string"&&/^[=+\-@\t\r]/.test(v)?`'${v}`:String(v??"")).replace(/"/g,'""')}"`;
  const blob=new Blob(["\ufeff"+[headers.join(","),...rows.map(r=>headers.map(h=>esc(r[h])).join(","))].join("\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

export default function AnalyticsPage(){
  const liveStore=useStore();
  const { workStaffNames,staffDirectory=[],profile,superAdminFirmScope,firmDirectory,caseDocuments }=liveStore;
  const manager=isManagerProfile(profile);
  const { globalSuperView,effectiveFirmId,activeSettings,settingsByFirm,loading:settingsLoading,error:settingsError }=useManagementSettings(profile,superAdminFirmScope,workStaffNames);
  const init=monthRange(); const [start,setStart]=useState(init.start); const [end,setEnd]=useState(init.end); const [tab,setTab]=useState<Tab>("수임 · 매출"); const [staffFilter,setStaffFilter]=useState("전체");
  const [supplyRevision,setSupplyRevision]=useState(0);
  const [exporting,setExporting]=useState<string|null>(null);
  const [exportError,setExportError]=useState<string|null>(null);
  const [exportNotice,setExportNotice]=useState<string|null>(null);
  const exportBusy=useRef(false);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  const sourceVersion=useRef(0);
  const sourceToken=useMemo(()=>String(++sourceVersion.current),[liveStore.leads,liveStore.cases,liveStore.clients,liveStore.installments]);
  const source=useAnalyticsSource(effectiveFirmId,manager,supplyRevision,sourceToken);
  const contextKey=JSON.stringify([profile?.id,manager,effectiveFirmId,start,end,staffFilter,sourceToken,supplyRevision,source.data?.loadedAt]);
  const currentContext=useRef(contextKey);
  currentContext.current=contextKey;
  const {leads,cases,clients,installments}=source.data??EMPTY_SOURCE;
  const supply=useFirmSupply(effectiveFirmId,start,end,manager,supplyRevision);
  const storeSnapshot={leads,cases,clients,installments,workStaffNames,staffDirectory,superAdminFirmScope,firmDirectory,caseDocuments};
  const settingsSnapshot={globalSuperView,effectiveFirmId,activeSettings,settingsByFirm,error:settingsError};
  const currentDay=new Date().toISOString().slice(0,10);
  const report = useMemo(()=>buildAnalyticsReport({store:storeSnapshot,settings:settingsSnapshot,start,end,supply,mode:"monthly"}),[leads,cases,clients,installments,workStaffNames,staffDirectory,superAdminFirmScope,firmDirectory,caseDocuments,globalSuperView,effectiveFirmId,activeSettings,settingsByFirm,settingsError,start,end,supply.data,supply.error,supply.loading,currentDay]);
  const { converted,closed,costKnown,rangeLeads,dbRetainerConversion,periodCases,rangeCases,rangePaid,cashSales,contractSales,acquisitionCost,laborCost,paymentFees,fixedCost,contractCount,contractNet,cashProfit,averageFee,collectionRate,contractTarget,isCurrentMonthRange,expectedContractsByToday,projectedMonthContracts,requiredContractsPerDay,targetProgress,standardKnown,discountRate,activeCap,neglectDays,neglected,stageUnknown,overCap,overdueNow,missingDocuments,docDelay,allStaff,staffRows,avgContacts,connected,consult,completed,shortClosed,channelRows,clientsById,ledgerResult,receiptResult,fullMonthCash,allLedger,stageRows,selfInstallments,overdueRecovery,scopeLabel,periodLabel,buildSheets } = report;
  const ledger=useMemo(()=>allLedger.filter(r=>staffFilter==="전체"||r.case.assignedStaff===staffFilter),[allLedger,staffFilter]);

  const ledgerSummary=useMemo(()=>ledgerTotals(ledger),[ledger]);
  const ledgerSection=useMemo(()=>createLedgerSection(ledger),[ledger]);
  const receiptRows=useMemo(()=>receiptResult.rows.filter(row=>staffFilter==="전체"||row.assignedStaff===staffFilter),[receiptResult.rows,staffFilter]);
  const exportUnavailable=settingsLoading||source.loading||!!source.error||!source.data;

  async function runExport(label:string, action:(isCurrent:()=>boolean)=>Promise<void>) {
    if(exportBusy.current||!manager||exportUnavailable)return;
    exportBusy.current=true;setExporting(label);setExportError(null);setExportNotice(null);
    const key=contextKey;
    const isCurrent=()=>alive.current&&currentContext.current===key;
    try { await action(isCurrent); }
    catch(error){if(isCurrent())setExportError(error instanceof Error?error.message:"다운로드하지 못했습니다. 다시 시도해주세요.");}
    finally {exportBusy.current=false;if(alive.current)setExporting(null);}
  }
  function showReceiptNotice(label:string,result:typeof receiptResult){
    setExportNotice(`${label}: 납부일 미확인 ${result.undatedCount}회차와 조회기간 실납부액 미확인 ${result.unknownAmountCount}회차는 입금내역에서 제외했습니다. 연결정보 미확인 ${result.missingIdentityCount}건의 기록된 실입금액은 포함하고, 확인되지 않은 정보는 -로 표시했습니다.`);
  }
  async function exportXlsx(){
    await runExport("입금내역",async isCurrent=>{
      await recordManagementExport({firmId:effectiveFirmId,start,end,staff:staffFilter,format:"xlsx",kind:"ledger"});
      if(!isCurrent())return;
      await exportAnalyticsMeetingWorkbook({filename:`로파워_입금내역_${end.slice(0,7)}_${staffFilter}.xlsx`,periodLabel,scopeLabel,canDownload:isCurrent,sheets:[{name:"04 입금내역",title:"입금내역",sections:[createReceiptOnlySection(receiptRows)]}]});
      if(isCurrent())showReceiptNotice("입금내역",receiptResult);
    });
  }
  async function exportLedgerCsv(){
    await runExport("CSV",async isCurrent=>{
      await recordManagementExport({firmId:effectiveFirmId,start,end,staff:staffFilter,format:"csv",kind:"ledger"});
      if(!isCurrent())return;
      downloadCsv(receiptRows.map(row=>Object.fromEntries(receiptValues(row).map((value,index)=>[RECEIPT_HEADERS[index],typeof value==="number"?value:String(value??"")]))),`로파워_입금내역_${end.slice(0,7)}_${staffFilter}.csv`);
    });
  }
  async function exportMeetingWorkbook(mode:AnalyticsLedgerMode){
    const label=mode==="monthly"?"이번달 실적":"누적 실적";
    await runExport(label,async isCurrent=>{
      let selectedReport=report,reportStart=start;
      if(mode==="cumulative"){
        if(!effectiveFirmId)throw new Error("다운로드할 로펌을 먼저 선택해주세요.");
        reportStart=firstAnalyticsMonth(storeSnapshot,end);
        const params=new URLSearchParams({firmId:effectiveFirmId,start:reportStart,end,cumulative:"true"});
        const data=await authJson<FirmSupplySummary>(`/api/admin/firm-supply?${params}`,{cache:"no-store"});
        if(!isCurrent())return;
        if(data.firmId!==effectiveFirmId||data.end!==end)throw new Error("조회 범위가 변경되었습니다. 다시 다운로드해주세요.");
        reportStart=data.start;
        selectedReport=buildAnalyticsReport({store:storeSnapshot,settings:settingsSnapshot,start:reportStart,end,supply:{data,error:null,loading:false},mode});
      }
      await recordManagementExport({firmId:effectiveFirmId,start:reportStart,end,format:"xlsx",kind:"meeting",mode});
      if(!isCurrent())return;
      await exportAnalyticsMeetingWorkbook({filename:`로파워_${label.replace(/ /g,"")}_${mode==="monthly"?end.slice(0,7):`${reportStart}_${end}`}.xlsx`,periodLabel:selectedReport.periodLabel,scopeLabel:selectedReport.scopeLabel,canDownload:isCurrent,sheets:selectedReport.buildSheets()});
      if(isCurrent())showReceiptNotice(label,selectedReport.receiptResult);
    });
  }

  if(!manager)return <><PageHeader title="데이터집계" description="최고 관리자 전용 지표입니다."/><Card className="p-6 text-sm text-slate-600">데이터집계는 로펌 관리자 또는 슈퍼관리자만 사용할 수 있습니다.</Card></>;
  const pageHeader=<PageHeader title="데이터집계" description={globalSuperView?"전체 로펌 관리자 지표를 통합 조회합니다. DB 구매 로펌에는 공급 원장에 기록된 해당 로펌의 DB 구매비를 적용합니다.":"수익 · DB 생산성 · 상담 과정 · 수임 · 수납을 해당 로펌 기준으로 봅니다."} action={<div className="flex flex-wrap items-center justify-end gap-2"><label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">조회 월<input aria-label="조회 월" type="month" value={end.slice(0,7)} onChange={event=>{if(event.target.value){const range=monthRange(event.target.value);setStart(range.start);setEnd(range.end);setExportError(null);setExportNotice(null)}}} className="bg-transparent text-sm font-bold text-slate-900"/></label><button disabled={!!exporting||supply.loading||exportUnavailable} aria-describedby={exportUnavailable?"analytics-source-status":undefined} onClick={()=>void exportMeetingWorkbook("monthly")} className="flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-black text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"><FileSpreadsheet size={15}/>이번달 실적 XLSX</button><button disabled={!!exporting||supply.loading||exportUnavailable} aria-describedby={exportUnavailable?"analytics-source-status":undefined} onClick={()=>void exportMeetingWorkbook("cumulative")} className="flex h-10 items-center gap-2 rounded-xl border border-emerald-700 bg-white px-4 text-xs font-black text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"><FileSpreadsheet size={15}/>누적 실적 XLSX</button></div>}/>;
  if(settingsLoading||source.loading)return <>{pageHeader}<div id="analytics-source-status" role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">전체 계약·회차별 입금 자료를 확인하고 있습니다. 전체 자료 확인이 끝나면 XLSX 다운로드가 활성화됩니다.</div></>;
  if(source.error||!source.data)return <>{pageHeader}<Card className="p-6"><p id="analytics-source-status" role="alert" className="text-sm text-rose-700">{source.error??"조회할 로펌을 선택해주세요."} 일부 자료만으로 정산표를 만들지 않습니다. 전체 자료를 정상적으로 불러오면 XLSX 다운로드가 활성화됩니다.</p><button type="button" onClick={source.retry} className="mt-3 rounded-lg border px-4 py-2 text-sm font-bold">자료 다시 불러오기</button></Card></>;

  return <>
    {pageHeader}
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"><span>이번달 실적: {start} ~ {end}</span><span>누적 실적: 최초 기록 ~ {end} · 월말 기준</span>{exporting&&<span role="status" className="font-bold text-emerald-700">{exporting} 파일을 준비하고 있습니다.</span>}</div>
    <p className="mb-4 text-xs text-slate-500">엑셀 입금내역은 실제 납부일·실납부액이 기록된 완료 회차만 포함합니다. 납부일 미확인 {receiptResult.undatedCount}회차, 해당 월 실납부액 미확인 {receiptResult.unknownAmountCount}회차는 제외합니다. 누적 파일은 선택 월말까지 확인된 입금만 포함합니다.</p>
    {exportNotice&&<p role="status" className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">{exportNotice}</p>}
    {exportError&&<p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{exportError}</p>}
    {!globalSuperView && <div className="mb-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><InfoHelp summary="공급 원장 기준 성과">고객·계약 자료를 변경한 뒤에는 공급 성과를 새로고침해주세요. 공급일과 현재 유효 수임 연결을 별도 조회합니다.</InfoHelp><button type="button" disabled={supply.loading} onClick={()=>setSupplyRevision(value=>value+1)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">공급 성과 새로고침</button></div><SupplyRetainerConversion start={start} end={end} data={supply.data} loading={supply.loading} error={supply.error}/></div>}
    {settingsError&&<Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">정산설정 일부를 불러오지 못했습니다: {settingsError}</Card>}
    <Card className="mb-4 p-3"><InfoHelp summary="공급 성과 · 계약일 수임 · 납부일 입금">공급 전환율은 선택 기간에 공급된 DB 중 현재 유효 수임이 연결된 비율입니다. 60일 경과 공급 성과와 접수일 지표는 별도 참고이며 DB 30건 미만은 참고값입니다. 전체 수임은 유상·취하 제외 계약일, 실입금은 납부일 기준입니다. 컨택은 새 구조화 기록만 집계하며 과거 미기록은 확인 불가입니다.</InfoHelp></Card>
    {(supply.error||!costKnown)&&<Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{supply.loading?"공급 원장을 불러오는 중입니다.":supply.error||"공급 단가가 미확정입니다. 구매비 및 이익을 확정할 수 없습니다."}</Card>}
    {closed&&<Card className="mb-4 bg-emerald-50 p-3 text-xs text-emerald-800">완전한 월의 수임·실입금·비용은 서버에서 확정한 마감 합계입니다. 상세 원장은 현재 업무 자료이며 과거 입력을 소급 변경하지 않습니다.</Card>}
    <details className="mb-4 rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-bold text-slate-700">접수일 기준 참고 지표</summary><div className="mt-4 space-y-4"><LeadRetainerConversionCard start={start} end={end} totalDb={dbRetainerConversion.totalDb} retainedDb={dbRetainerConversion.retainedDb}/>{!globalSuperView && <StaffRetainerConversionTable start={start} end={end} rows={dbRetainerConversion.staffRows}/>}</div></details>
    <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">{TABS.map(t=><button key={t} onClick={()=>setTab(t)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab===t?"bg-blue-600 text-white":"text-slate-600 hover:bg-slate-50"}`}>{t}</button>)}</div>

    {tab==="요약"&&<div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-800">전체 수임 · 수납 <span className="text-xs font-normal text-slate-500">계약일 · 납부일 기준</span></h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><KpiCard label="계약 1건당 순이익" value={costKnown?fmtWon(contractNet):"비용 확인 필요"}/><KpiCard label={closed?"회수 매출 · 마감 스냅샷":"회수 매출 · 확인분"} value={fmtWon(cashSales)}/><KpiCard label="전체 수임 / 목표 · 계약일" value={`${contractCount} / ${contractTarget || 0}건`}/><div className={(supply.data?.supplyCohort.supplied??0)<30?"opacity-60":""}><KpiCard label="공급 DB → 수임" value={supply.data?`${supply.data.supplyCohort.retained}/${supply.data.supplyCohort.supplied} · ${supplyConversionRateLabel(supply.data.supplyCohort.supplied,supply.data.supplyCohort.conversionRate)}`:"공급 원장 확인 필요"}/></div><KpiCard label="평균 실수임료" value={fmtWon(averageFee)}/><KpiCard label="평균 할인율" value={standardKnown?`${discountRate.toFixed(1)}% · 기록 ${standardKnown}/${rangeCases.length}건`:"기준 기록 없음"}/><KpiCard label="DB 구매비" value={supply.data?.serviceMode==="crm_only"?"미적용 · 0원":costKnown?fmtWon(acquisitionCost):"단가 확인 필요"}/><KpiCard label="자체 분납 비율" value={`${pct(selfInstallments,rangeCases.length).toFixed(1)}%`}/><KpiCard label="현금 기준 영업이익" value={costKnown?fmtWon(cashProfit):"비용 확인 필요"}/></div>
      {isCurrentMonthRange&&<Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-black">월 목표 페이스</div><div className="mt-1 text-xs text-slate-500">오늘까지 목표 {expectedContractsByToday.toFixed(1)}건 · 현재 {rangeCases.length}건 · 월말 예상 {projectedMonthContracts}건</div></div><div className="text-right"><div className={`text-lg font-black ${rangeCases.length<expectedContractsByToday?"text-amber-700":"text-emerald-700"}`}>{targetProgress.toFixed(1)}%</div><div className="text-[11px] text-slate-400">남은 기간 하루 {requiredContractsPerDay.toFixed(1)}건 필요</div></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${rangeCases.length<expectedContractsByToday?"bg-amber-500":"bg-emerald-500"}`} style={{width:`${Math.min(100,targetProgress)}%`}}/></div></Card>}
      <Card className="p-5"><div className="text-sm font-black">수익 구조</div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[[closed?"회수 매출 · 마감 스냅샷":"회수 매출 · 확인분",cashSales],["− DB 구매비",-acquisitionCost],["− 인건비",-laborCost],["− 납부수수료·운영비",-(paymentFees+fixedCost)],["= 현금 영업이익",cashProfit]].map(([l,v])=><div key={String(l)} className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500">{l}</div><div className={`mt-2 text-lg font-black ${Number(v)<0?"text-red-600":"text-slate-900"}`}>{Number(v)<0?"− ":""}{!costKnown&&(String(l).includes("구매비")||String(l).includes("영업이익"))?"비용 확인 필요":fmtWon(Math.abs(Number(v)))}</div></div>)}</div><InfoHelp className="mt-3" summary="환불액 별도 확인">환불 금액 전용 필드가 없어 영업이익에서 자동 차감하지 않습니다. 취하 건수는 사건·수납 탭에서 별도로 표시합니다.</InfoHelp></Card>
      <div className="grid gap-4 xl:grid-cols-3">{[{title:`활성 DB 상한 초과 ${overCap.length}명`,body:globalSuperView?"로펌별 설정 상한 기준 · 신규 배정 조정 필요":`기준 ${activeCap}건 · 신규 배정 조정 필요`,bad:overCap.length>0},{title:`방치 DB ${neglected.length}건`,body:globalSuperView?"로펌별 방치 회수 기준 적용":`${neglectDays}일 이상 현재 단계 체류 · 기록 없음 ${stageUnknown}건 제외`,bad:neglected.length>0},{title:`연체·결제실패 ${overdueNow.length}건`,body:`현재 미수 위험 · 회수율 ${collectionRate.toFixed(1)}%`,bad:overdueNow.length>0}].map(x=><Card key={x.title} className={`p-4 ${x.bad?"border-red-200 bg-red-50/60":""}`}><div className="flex items-center gap-2 text-sm font-black"><AlertTriangle size={15} className={x.bad?"text-red-500":"text-slate-400"}/>{x.title}</div><div className="mt-1 text-xs text-slate-500">{x.body}</div></Card>)}</div>
    </div>}

    {tab==="팀 · 인원"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="상담 인원" value={`${staffRows.length}명`}/><KpiCard label="DB 생산성" value={fmtWon(moneyPer(contractSales,rangeLeads.length))}/><KpiCard label="총 인건비" value={settingsError?"설정 확인 필요":fmtWon(laborCost)}/><KpiCard label="총 기여이익" value={costKnown?fmtWon(staffRows.reduce((s,r)=>s+r.contribution,0)):"비용 확인 필요"}/></div><Card className="overflow-hidden"><div className="border-b px-5 py-4 text-sm font-black">직원 운영 지표 · 접수일 / 계약일 / 납부일</div><div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["담당자","배정 DB","활성 DB","계약","수임액","회수매출","보상","기여이익","DB 생산성","DB당 컨택","상담완료→계약","할인율","단순분납","연체"].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{staffRows.map(r=><tr key={r.label} className={`border-t ${r.db<30?"text-slate-400":""}`}><td className="px-4 py-3 font-bold">{r.label}</td><td className="px-4 py-3">{r.db}</td><td className={`px-4 py-3 font-bold ${r.active>activeCap?"text-red-600":""}`}>{r.active}</td><td className="px-4 py-3">{r.contracts}</td><td className="px-4 py-3">{fmtWon(r.contractSales)}</td><td className="px-4 py-3">{fmtWon(r.cash)}</td><td className="px-4 py-3">{fmtWon(r.comp)}</td><td className={`px-4 py-3 font-black ${r.contribution<0?"text-red-600":"text-emerald-700"}`}>{costKnown?fmtWon(r.contribution):"비용 확인 필요"}</td><td className="px-4 py-3">{fmtWon(r.productivity)}</td><td className="px-4 py-3">{r.contactKnown?`${r.contacts.toFixed(1)}회`:"확인 불가"}</td><td className="px-4 py-3">{r.completedToContractRate.toFixed(1)}%</td><td className={`px-4 py-3 ${r.discountRate>10?"font-bold text-amber-700":""}`}>{r.discountKnown?`${r.discountRate.toFixed(1)}% · ${r.discountKnown}/${r.contracts}건`:"기준 기록 없음"}</td><td className={`px-4 py-3 ${r.simpleInstallmentRate>60?"font-bold text-amber-700":""}`}>{r.simpleInstallmentRate.toFixed(1)}%</td><td className={`px-4 py-3 ${r.overdue>0?"font-bold text-red-600":""}`}>{r.overdue}건</td></tr>)}</tbody></table></div></Card><Card className="p-5"><InfoHelp summary="결과는 월별 · 과정은 주별 · 품질은 상시">결과는 수임·회수·DB 생산성·기여이익, 과정은 컨택·전환, 품질은 할인·자체분납·연체·입력을 봅니다. 신규 인원은 초반 행동지표를 먼저 확인하세요.</InfoHelp></Card></div>}

    {tab==="상담 운영"&&<FirmOperationsDetails leads={rangeLeads} cases={cases}/>}
    {tab==="상담 운영"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><KpiCard label="DB당 평균 컨택" value={rangeLeads.some(l=>structuredContacts(l)!==undefined)?`${avgContacts.toFixed(1)}회`:"확인 불가"}/><KpiCard label="2회 이하 종결" value={`${shortClosed}건`}/><KpiCard label={`${neglectDays}일 방치 DB`} value={`${neglected.length}건`}/></div><Card className="p-5"><div className="text-sm font-black">DB 퍼널 · 유입 월 기준</div><div className="mt-4 grid gap-3 sm:grid-cols-5">{[["신규 DB",rangeLeads.length],["통화 연결",connected],["상담 진행",consult],["상담 완료",completed],["계약",converted]].map(([l,v],i)=><div key={String(l)} className="rounded-xl border p-4"><div className="text-xs font-bold text-slate-500">{l}</div><div className="mt-2 text-2xl font-black">{v}건</div>{i>0&&<div className="mt-1 text-[11px] text-slate-400">이전 단계 대비 {pct(Number(v),Number([[0,rangeLeads.length],[0,rangeLeads.length],[0,connected],[0,consult],[0,completed]][i][1])).toFixed(1)}%</div>}</div>)}</div></Card><Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">컨택·연결은 구조화된 전화/문자 기록만 집계합니다. 기존 메모에서 자동 추정하지 않으며 기록이 없는 DB는 확인 불가로 남깁니다.</Card></div>}

    {tab==="산식 · 기준"&&<Card className="overflow-hidden"><div className="border-b px-5 py-4"><h3 className="text-sm font-black">지표 산식 · 기준</h3><p className="mt-1 text-xs text-slate-500">집계 기간과 계산 기준을 확인하세요. 과거월의 계약금액·사건 상태는 현재 업무 자료일 수 있습니다.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-50"><tr>{["지표","산식 / 기준","현재 값"].map(label=><th key={label} className="px-4 py-3 text-left">{label}</th>)}</tr></thead><tbody>{buildSheets().find(sheet=>sheet.name==="06 산식기준")?.sections?.[0].rows.map((row,index)=><tr key={index} className="border-t">{row.map((value,column)=><td key={column} className="px-4 py-3">{typeof value==="number"?value.toLocaleString("ko-KR",{maximumFractionDigits:1}):String(value??"")}</td>)}</tr>)}</tbody></table></div></Card>}

    {tab==="DB 구매 · 유입"&&<div className="space-y-4"><FirmSupplyCard data={supply.data} loading={supply.loading} error={supply.error}/><Card className="p-5"><h3 className="text-sm font-black">유입경로별 성과</h3><InfoHelp className="mt-1" summary="접수일 기준 · 유입경로 참고">선택 기간 유입 DB에 연결된 현재까지의 유상 수임 기준입니다. 공급일 기준 전환율과 별도 집계이며 30건 미만 경로는 회색으로 표시합니다.</InfoHelp><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["유입경로","유입 DB","수임 전환","수임매출","DB당 수임매출"].map(h=><th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{channelRows.map(row=><tr key={row.key} className={`border-t ${row.db<30?"text-slate-400":""}`}><td className="p-3">{row.label}</td><td className="p-3">{row.db}건</td><td className="p-3">{ratioLabel(row.won,row.db)}</td><td className="p-3">{fmtWon(row.revenue)}</td><td className="p-3">{fmtWon(moneyPer(row.revenue,row.db))}</td></tr>)}</tbody></table></div></Card></div>}

    {tab==="수임 · 매출"&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label={staffFilter==="전체"?"해당 월 실입금 · 전체 확인분":"해당 월 실입금 · 담당 계약"} value={fmtWon(staffFilter==="전체"?fullMonthCash:ledgerSummary.month)}/><KpiCard label="원장 계약 누적 · 월말 확인분" value={fmtWon(ledgerSummary.cumulative)}/><KpiCard label="미수 잔금 · 총 수임료 대비" value={ledgerSummary.uncertain?`확인 필요 ${ledgerSummary.uncertain}건`:fmtWon(ledgerSummary.balance)}/><KpiCard label="총 수임료 · 원장 계약" value={fmtWon(ledgerSummary.contract)}/></div>
      <Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/50 px-5 py-4"><div><h2 className="text-sm font-black text-emerald-950">계약별 수임 · 입금 원장 <span className="ml-2 text-xs font-semibold text-emerald-700">{ledger.length}계약</span></h2><InfoHelp className="mt-1" summary="해당 월 계약 + 이전 계약의 해당 월 입금">한 행은 한 계약입니다. 해당 월 실입금은 누적 실입금에 포함되므로 더하지 않습니다. 월말 이후 입금은 제외합니다. 입금일·실납부액 미확인 건의 잔금은 확정하지 않습니다. 실입금 열은 확인된 금액만 표시하며, 확인 필요 회차가 있으면 합계는 미확정입니다. 총 수임료·계약 상태는 현재 기록이며 과거 상태를 복원하지 않습니다. 전체 실적 XLSX에는 담당자 필터를 적용하지 않습니다.</InfoHelp></div><div className="flex flex-wrap items-center gap-2"><select aria-label="원장 담당자" value={staffFilter} onChange={event=>setStaffFilter(event.target.value)} className="h-9 rounded-lg border bg-white px-3 text-xs"><option>전체</option>{allStaff.map(staff=><option key={staff}>{staff}</option>)}</select><button disabled={!!exporting} onClick={()=>void exportXlsx()} className="flex h-9 items-center gap-1 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50"><FileSpreadsheet size={13}/>입금내역 XLSX</button><button disabled={!!exporting} onClick={()=>void exportLedgerCsv()} className="flex h-9 items-center gap-1 rounded-lg border bg-white px-3 text-xs font-bold disabled:opacity-50"><Download size={13}/>CSV</button></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[2100px] text-sm"><thead className="bg-slate-100 text-xs text-slate-600"><tr>{LEDGER_HEADERS.map((header,index)=><th key={header} className={`whitespace-nowrap border-b border-r border-slate-200 px-4 py-3 ${index>=7&&index<=16?"text-right":"text-left"} ${index>=8&&index<=10?"bg-emerald-100 text-emerald-950":""}`}>{header}</th>)}</tr></thead><tbody>{ledger.map(row=><tr key={row.key} className="odd:bg-white even:bg-emerald-50/40 hover:bg-emerald-50">{ledgerValues(row).map((value,index)=><td key={index} className={`whitespace-nowrap border-b border-r border-slate-200 px-4 py-3 ${typeof value==="number"?"text-right tabular-nums":"text-left"} ${index>=8&&index<=10?"font-bold":""} ${typeof value==="number"&&value<0?"text-rose-700":value==="확인 필요"?"text-amber-700":""}`}>{typeof value==="number"?fmtWon(value):String(value??"")}</td>)}</tr>)}{!ledger.length&&<tr><td colSpan={LEDGER_HEADERS.length} className="px-5 py-12 text-center text-slate-500">해당 월 계약 또는 입금 내역이 없습니다.</td></tr>}</tbody>{ledger.length>0&&<tfoot className="bg-emerald-100 font-bold text-emerald-950"><tr>{ledgerSection.totalRow?.map((value,index)=><td key={index} className={`whitespace-nowrap border-r border-emerald-200 px-4 py-3 ${typeof value==="number"?"text-right tabular-nums":""}`}>{typeof value==="number"?fmtWon(value):String(value??"")}</td>)}</tr></tfoot>}</table></div></Card>
      {(ledgerResult.totals.excludedPeriodPaid>0||ledgerResult.unallocatedCases.length>0||ledgerSummary.uncertain>0||ledgerResult.incompletePayments.length>0||ledgerResult.warnings.length>0)&&<Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><b>정산 전 확인</b><p className="mt-1">연결 확인이 필요한 해당 월 입금 {fmtWon(ledgerResult.totals.excludedPeriodPaid)} · 원장 밖 미확인 입금 기록액 {fmtWon(ledgerResult.totals.excludedUnallocatedPaid)} · 원장 내 미확인 기록액 {fmtWon(ledgerSummary.unallocated)} · 실납부액 미확인 {ledgerResult.incompletePayments.length}회차. 확인 필요 계약은 미수 잔금 합계를 확정하지 않습니다. 엑셀 입금내역에는 실제 납부일과 실납부액이 기록된 완료 회차만 표시합니다. 날짜·금액 미확인 회차는 원본 수납내역에서 확인해주세요.</p></Card>}
    </div>}

    {tab==="사건 · 수납"&&<Card className="p-5"><h3 className="text-sm font-black">미제출 서류 체크리스트</h3><InfoHelp className="mt-1" summary="서류 체크리스트 미확인 항목">기존 서류 체크리스트의 미체크 항목입니다. 고객별 필요 여부를 확인해주세요.</InfoHelp><div className="mt-3 divide-y">{missingDocuments.map(({record,missing})=><div key={record.id} className="py-3 text-sm"><b>{clientsById.get(record.clientId)?.name??"-"}</b><span className="ml-2 text-xs text-slate-500">담당 {record.assignedStaff} · {missing.length}개 미확인</span><p className="mt-1 text-xs text-slate-500">{missing.map(item=>item.label).join(" · ")}</p></div>)}{!missingDocuments.length&&<p className="text-sm text-slate-500">해당 단계의 미확인 서류가 없습니다.</p>}</div></Card>}
    {tab==="사건 · 수납"&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="진행중 사건" value={`${cases.filter(c=>c.status==="진행중").length}건`}/><KpiCard label="서류준비 14일+" value={`${docDelay.length}건`}/><KpiCard label="연체·실패" value={`${overdueNow.length}건`}/><KpiCard label="연체 회수율" value={`${overdueRecovery.toFixed(1)}%`}/></div><div className="grid gap-4 xl:grid-cols-2"><Card className="p-5"><div className="text-sm font-black">사건 진행 단계</div><div className="mt-4 space-y-3">{stageRows.map(r=>{const max=Math.max(1,...stageRows.map(x=>x.count));return <div key={r.stage}><div className="mb-1 flex justify-between text-xs"><span>{STAGE_GENERIC_LABELS[r.stage]}</span><b>{r.count}건</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-600" style={{width:`${Math.round(r.count/max*100)}%`}}/></div></div>})}</div></Card><Card className="overflow-hidden"><div className="border-b px-5 py-4 text-sm font-black">서류준비 장기체류</div><div className="divide-y">{docDelay.slice(0,12).map(c=>{const client=clients.find(x=>x.id===c.clientId);return <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div><b>{client?.name??"-"}</b><div className="text-xs text-slate-400">담당 {c.assignedStaff} · {c.caseType}</div></div><div className="font-bold text-amber-700">{daysSince(c.stageUpdatedAt)}일</div></div>})}{!docDelay.length&&<div className="p-8 text-center text-xs text-slate-400">14일 이상 체류 사건이 없습니다.</div>}</div></Card></div><Card className="p-5"><div className="flex items-center gap-2 text-sm font-black"><ShieldAlert size={16}/>해지 · 환불 추적</div><div className="mt-3 text-sm text-slate-600">선택 기간 취하 사건 <b>{periodCases.filter(c=>c.status==="취하").length}건</b> · 계약일 기준</div><InfoHelp className="mt-2" summary="환불액 별도 확인">현재 CRM에는 환불 금액 전용 필드가 없어 환불액은 자동 집계하지 않습니다.</InfoHelp></Card></div>}
  </>;
}
