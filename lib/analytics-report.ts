import type { useStore } from "@/lib/store";
import type { useManagementSettings } from "@/lib/management-analytics";
import type { FirmSupplySummary } from "@/lib/firm-reporting";
import { DB_LEAD_DEFAULT_STAGE_BY_STATUS, STAGE_GENERIC_LABELS, type DbLead } from "@/lib/types";
import {
  DEFAULT_MANAGEMENT_SETTINGS, acquisitionCostForRange, cashByStaff, contactCount,
  effectiveFinancialConfig, fixedCostForRange, inDateRange,
  laborCostForRange, paymentFeeFor, paymentFeesForRange,
  staffCompensationForRange, closedTotalsForRange, type ManagementSettings,
} from "@/lib/management-core";
import type { AnalyticsMeetingSheet } from "@/lib/analytics-excel";
import { createStaffScopeKey, groupByKey, groupRelatedRows } from "@/lib/analytics-indexes";
import { firstByKey } from "@/lib/list-indexes";
import { actualPayment, isValidRetainer, standardFeeForCase, structuredContacts, leadStageDays } from "@/lib/firm-reporting";
import { DOCUMENT_CHECKLIST_TEMPLATE } from "@/lib/documents";
import { kstPerformanceDate } from "@/lib/performance/firm";
import { getRetainedLeadIds } from "@/lib/performance/lead-retainer-conversion";
import type { StaffRetainerConversionRow } from "@/components/analytics/StaffRetainerConversionTable";
import { buildAnalyticsReceipts, createReceiptOnlySection } from "@/lib/analytics-receipts";
import { buildAnalyticsLedger, analyticsLedgerDate, recordedActualPayment, type AnalyticsLedgerMode } from "@/lib/analytics-ledger";

function supplyConversionRateLabel(supplied: number, rate: number | null | undefined) { return supplied === 0 ? "—" : typeof rate === "number" && Number.isFinite(rate) ? `${rate.toFixed(1)}%` : "확인 필요"; }
// Pure report calculation: export periods are recomputed, never relabelled UI snapshots.
const compute = <T>(factory: () => T, _dependencies: unknown[]): T => factory();
type ReportStore = Pick<ReturnType<typeof useStore>, "leads" | "cases" | "clients" | "installments" | "workStaffNames" | "staffDirectory" | "superAdminFirmScope" | "firmDirectory" | "caseDocuments">;
type ReportSettings = Pick<ReturnType<typeof useManagementSettings>, "globalSuperView" | "effectiveFirmId" | "activeSettings" | "settingsByFirm" | "error">;
export interface AnalyticsReportInput {
  store: ReportStore;
  settings: ReportSettings;
  start: string;
  end: string;
  mode?: AnalyticsLedgerMode;
  supply: { data: FirmSupplySummary | null; error: string | null; loading: boolean };
}

export function monthRange(month = kstPerformanceDate(new Date().toISOString())!.slice(0,7)) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("조회 월을 확인해주세요.");
  const [year, number] = month.split("-").map(Number);
  return { start: `${month}-01`, end: `${month}-${String(new Date(Date.UTC(year,number,0)).getUTCDate()).padStart(2,"0")}` };
}
/** Start at an actual CRM record, not an invented epoch that charges empty years. */
export function firstAnalyticsMonth(store: Pick<ReportStore,"leads"|"cases"|"installments">, cutoff: string) {
  const dates = [...store.leads.map(row=>analyticsLedgerDate(row.receivedAt)), ...store.cases.map(row=>analyticsLedgerDate(row.contractDate)), ...store.installments.map(row=>analyticsLedgerDate(row.paidDate))].filter(date=>date&&date<=cutoff);
  return `${dates.sort()[0]?.slice(0,7)??cutoff.slice(0,7)}-01`;
}
export function daysSince(value?: string) { if (!value) return 0; return Math.max(0, Math.floor((Date.now() - new Date(`${value.slice(0,10)}T00:00:00`).getTime()) / 86400000)); }
function stageOf(lead: DbLead) { return lead.detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status]; }
function terminalLead(lead: DbLead) { return !!lead.convertedClientId || ["거절","부적합","종결_중단"].includes(lead.status); }
function successfulContact(lead: DbLead) { return structuredContacts(lead)?.some(row=>row.type==="phone"&&row.connected===true)??false; }
function consultStarted(lead: DbLead) { return ["상담","설득필요","착수금 안내"].includes(stageOf(lead)) || !!lead.convertedClientId; }
function consultCompleted(lead: DbLead) { return ["설득필요","착수금 안내"].includes(stageOf(lead)) || !!lead.convertedClientId; }
function pct(n:number,d:number){return d>0?(n/d)*100:0}
function moneyPer(n:number,d:number){return d>0?n/d:0}

function settingsForFirm(map: Record<string, ManagementSettings>, firmId?: string, fallback?: ManagementSettings) {
  return (firmId && map[firmId]) || fallback || DEFAULT_MANAGEMENT_SETTINGS;
}


export function buildAnalyticsReport(input: AnalyticsReportInput) {
  const { store, settings, start, end, supply } = input;
  const { leads,cases,clients,installments:sourceInstallments,workStaffNames,staffDirectory=[],superAdminFirmScope,firmDirectory,caseDocuments }=store;
  const { globalSuperView,effectiveFirmId,activeSettings,settingsByFirm,error:settingsError }=settings;
  // Statistics use explicitly recorded receipts only. Scheduled amounts are never actual cash.
  // Keep the raw source for the ledger so missing amounts/dates remain visible for review.
  const installments=Array.from(firstByKey(sourceInstallments,row=>JSON.stringify([row._lawFirmId??effectiveFirmId??"",row.id])).values())
    .filter(row=>row.status!=="완료"||recordedActualPayment(row)!==undefined)
    .map(row=>row.status==="완료"?{...row,paidDate:analyticsLedgerDate(row.paidDate)||undefined}:row);
  const closed=closedTotalsForRange(activeSettings,start,end);
  const costKnown=(!!closed&&closed.purchaseCost!==null)||!!supply.data&&supply.data.purchaseCost!==null&&!supply.error&&!settingsError;
  const rangeLeads=compute(()=>leads.filter(l=>inDateRange(l.receivedAt,start,end)),[leads,start,end]);
  const dbRetainerConversion=compute(()=>{
    const uniqueLeads=Array.from(firstByKey(leads,l=>l.id).values());
    const retainedIds=getRetainedLeadIds(uniqueLeads,cases);
    const byStaff=new Map<string,StaffRetainerConversionRow>();
    const staffRow=(value?:string)=>{
      const name=typeof value==="string"&&value.trim()?value.trim():"미지정";
      let row=byStaff.get(name);
      if(!row){row={key:name,name,db:0,contractedDb:0};byStaff.set(name,row);}
      return row;
    };
    for(const person of staffDirectory){
      if(person.lawFirmId===effectiveFirmId&&person.isWorkStaff&&["staff","firm_admin"].includes(person.platformRole||"staff")){
        const name=(person.staffName||person.displayName)?.trim();
        if(name)staffRow(name);
      }
    }
    for(const record of cases)staffRow(record.assignedStaff);
    let totalDb=0,retainedDb=0;
    for(const lead of uniqueLeads){
      const row=staffRow(lead.assignedStaff);
      const received=kstPerformanceDate(lead.receivedAt);
      if(!received||received<start||received>end)continue;
      totalDb++;row.db++;
      if(retainedIds.has(lead.id)){retainedDb++;row.contractedDb++;}
    }
    return {totalDb,retainedDb,staffRows:Array.from(byStaff.values())};
  },[leads,cases,start,end,staffDirectory,effectiveFirmId]);
  const periodCases=compute(()=>cases.filter(c=>inDateRange(c.contractDate,start,end)),[cases,start,end]);
  const rangeCases=compute(()=>periodCases.filter(isValidRetainer),[periodCases]);
  const retainedLeadIds=compute(()=>new Set(cases.filter(isValidRetainer).map(c=>c.fromLeadId).filter(Boolean)),[cases]);
  const rangePaid=compute(()=>installments.filter(i=>i.status==="완료"&&inDateRange(i.paidDate,start,end)),[installments,start,end]);
  const {cashSales:liveCashSales,contractSales:liveContractSales,converted}=compute(()=>({
    cashSales:rangePaid.reduce((s,i)=>s+actualPayment(i),0),
    contractSales:rangeCases.reduce((s,c)=>s+c.contractAmount,0),
    converted:rangeLeads.filter(l=>retainedLeadIds.has(l.id)).length,
  }),[rangePaid,rangeCases,rangeLeads,retainedLeadIds]);

  const cashSales=closed?.cashSales??liveCashSales,contractSales=closed?.contractSales??liveContractSales;
  const firmIds=compute(()=>{
    const activeIds=firmDirectory.filter(f=>f.status==="active").map(f=>f.id);
    if(activeIds.length)return activeIds;
    return Array.from(new Set([...leads.map(x=>x._lawFirmId),...cases.map(x=>x._lawFirmId)].filter(Boolean) as string[]));
  },[firmDirectory,leads,cases]);
  const {laborCost:liveLaborCost,paymentFees:livePaymentFees,fixedCost:liveFixedCost}=compute(()=>{
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
  const {totalStandardFee,totalDiscount,standardKnown}=compute(()=>rangeCases.reduce((total,c)=>{
    const standard=standardFeeForCase(c);
    if(standard===undefined)return total;
    total.standardKnown++;
    total.totalStandardFee+=standard;
    total.totalDiscount+=Math.max(0,standard-c.contractAmount);
    return total;
  },{totalStandardFee:0,totalDiscount:0,standardKnown:0}),[rangeCases,settingsByFirm,activeSettings]);
  const discountRate=pct(totalDiscount,totalStandardFee);

  const activeCap=activeSettings.activeDbCap; const neglectDays=activeSettings.neglectedDays;
  const activeLeads=compute(()=>leads.filter(l=>!terminalLead(l)),[leads]);
  const neglected=activeLeads.filter(l=>(leadStageDays(l)??-1)>=(globalSuperView?settingsForFirm(settingsByFirm,l._lawFirmId).neglectedDays:neglectDays));
  const stageUnknown=activeLeads.filter(l=>leadStageDays(l)===undefined).length;
  const overCap=compute(()=>{const m=new Map<string,{count:number,cap:number}>();for(const l of activeLeads){const key=`${l._lawFirmId??"firm"}::${l.assignedStaff}`;const cap=globalSuperView?settingsForFirm(settingsByFirm,l._lawFirmId).activeDbCap:activeCap;const row=m.get(key)??{count:0,cap};row.count+=1;row.cap=cap;m.set(key,row)}return Array.from(m.entries()).filter(([,row])=>row.count>row.cap);},[activeLeads,activeCap,globalSuperView,settingsByFirm]);
  const overdueNow=compute(()=>installments.filter(i=>i.status==="연체"||i.status==="실패"),[installments]);
  const missingDocuments=cases.filter(c=>c.status==="진행중"&&["서류준비","신청서작성"].includes(c.stage)).map(c=>({record:c,missing:DOCUMENT_CHECKLIST_TEMPLATE.filter(item=>!caseDocuments[c.id]?.[item.id])})).filter(row=>row.missing.length);
  const docDelay=cases.filter(c=>c.status==="진행중"&&c.stage==="서류준비"&&daysSince(c.stageUpdatedAt)>=14);

  const allStaff=compute(()=>Array.from(new Set([...workStaffNames,...leads.map(l=>l.assignedStaff),...cases.map(c=>c.assignedStaff)].filter(Boolean))).sort((a,b)=>a.localeCompare(b,"ko")),[workStaffNames,leads,cases]);
  const staffRows=compute(()=>{
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
        contribution:fc.reduce((x,c)=>x+c.contractAmount,0)-allocatedAcq-comp,productivity:prod,
        contacts:knownContacts.length?contacts/knownContacts.length:0,contactKnown:knownContacts.length,active,cap:setting.activeDbCap,minimumContacts:setting.minimumContactAttempts,
        completedToContractRate:pct(convertedLeads,completedLeads),discountRate:pct(discountTotal,standardTotal),discountKnown:fc.filter(c=>standardFeeForCase(c)!==undefined).length,simpleInstallmentRate:pct(simpleInstallments,fc.length),overdue
      };
    }).sort((a,b)=>b.contribution-a.contribution);
  },[allStaff,globalSuperView,leads,cases,rangeLeads,rangeCases,installments,settingsByFirm,activeSettings,start,end,activeLeads,supply.data,retainedLeadIds]);

  const {avgContacts,connected,consult,completed,shortClosed}=compute(()=>({
    avgContacts:rangeLeads.filter(l=>structuredContacts(l)!==undefined).length?rangeLeads.reduce((s,l)=>s+contactCount(l),0)/rangeLeads.filter(l=>structuredContacts(l)!==undefined).length:0,
    connected:rangeLeads.filter(successfulContact).length,
    consult:rangeLeads.filter(consultStarted).length,
    completed:rangeLeads.filter(consultCompleted).length,
    shortClosed:rangeLeads.filter(l=>terminalLead(l)&&structuredContacts(l)!==undefined&&contactCount(l)<=2&&!l.convertedClientId).length,
  }),[rangeLeads]);

  const channelRows=compute(()=>{
    type R={key:string,label:string,firmId?:string,leads:DbLead[],spend:number};const map=new Map<string,R>();
    const sourceLeads=rangeLeads;
    for(const l of sourceLeads){const s=settingsForFirm(settingsByFirm,l._lawFirmId,activeSettings);const label=String(l.source||"미분류");const key=`${l._lawFirmId??"firm"}::${label}`;const row=map.get(key)??{key,label:globalSuperView?`${l._lawFirmName??"로펌"} · ${label}`:label,firmId:l._lawFirmId,leads:[],spend:0};row.leads.push(l);map.set(key,row)}
    const costs=new Map((supply.data?.byLead??[]).map(row=>[row.leadId,row.purchaseCost]));
    for(const row of map.values())row.spend=row.leads.reduce((sum,lead)=>sum+(costs.get(lead.id)??0),0);
    return Array.from(map.values()).map(r=>{const ids=new Set(r.leads.map(l=>l.id));const cc=cases.filter(c=>isValidRetainer(c)&&c.fromLeadId&&ids.has(c.fromLeadId));const won=new Set(cc.map(c=>c.fromLeadId)).size;const conn=r.leads.filter(successfulContact).length;return{...r,db:r.leads.length,won,revenue:cc.reduce((x,c)=>x+c.contractAmount,0),cpl:moneyPer(r.spend,r.leads.length),cpa:moneyPer(r.spend,won),connRate:pct(conn,r.leads.length)}}).sort((a,b)=>b.revenue-a.revenue);
  },[rangeLeads,rangeCases,cases,settingsByFirm,activeSettings,globalSuperView,start,end,supply.data]);

  const clientsById=compute(()=>firstByKey(clients,c=>c.id),[clients]);
  const monthStart = `${end.slice(0,7)}-01`;
  const ledgerResult = buildAnalyticsLedger({cases,clients,installments:sourceInstallments,periodStart:monthStart,periodEnd:end,cutoff:end,mode:input.mode??"monthly",firmId:effectiveFirmId});
  const receiptResult=buildAnalyticsReceipts({cases,clients,installments:sourceInstallments,periodStart:monthStart,cutoff:end,mode:input.mode??"monthly",firmId:effectiveFirmId});
  const receiptSection=createReceiptOnlySection(receiptResult.rows);
  const fullMonthCash=ledgerResult.totals.periodPaid+ledgerResult.totals.excludedPeriodPaid;
  const fullCumulativeCash=installments.reduce((sum,row)=>sum+(row.status==="완료"&&row.paidDate&&row.paidDate<=end?(recordedActualPayment(row)??0):0),0);
  const allLedger = ledgerResult.rows.map(row=>{
    const c=row.case;
    const config=settingsForFirm(settingsByFirm,c._lawFirmId,activeSettings);
    const std=standardFeeForCase(c);
    const feeFor=(payments:typeof row.cumulativePayments)=>payments.reduce((sum,payment)=>sum+paymentFeeFor(c.paymentMethod,recordedActualPayment(payment)??0,effectiveFinancialConfig(config,analyticsLedgerDate(payment.paidDate).slice(0,7))),0);
    const fee=feeFor(row.cumulativePayments),monthFee=feeFor(row.periodPayments);
    return {...row,paid:row.cumulativePaid,standard:std??0,standardKnown:std!==undefined,discount:Math.max(0,(std??c.contractAmount)-c.contractAmount),fee,monthFee,net:row.cumulativePaid-fee,monthNet:row.periodPaid-monthFee};
  });
  const stageRows=compute(()=>{
    const counts=new Map<(typeof cases)[number]["stage"],number>();
    for(const c of cases)counts.set(c.stage,(counts.get(c.stage)??0)+(c.status!=="취하"?1:0));
    return Array.from(counts,([stage,count])=>({stage,count})).sort((a,b)=>b.count-a.count);
  },[cases]);
  const selfInstallments=rangeCases.filter(c=>c.paymentMethod==="단순분납").length;
  const latePaid=rangePaid.filter(i=>i.paidDate&&i.paidDate>i.dueDate).length; const overdueDue=overdueNow.filter(i=>inDateRange(i.dueDate,start,end)).length; const overdueRecovery=pct(latePaid,latePaid+overdueDue);

  const scopeLabel=globalSuperView?"전체 로펌 통합":(superAdminFirmScope?.name??"현재 로펌");
  const periodLabel=`${start} ~ ${end}`;
  function buildSheets(): AnalyticsMeetingSheet[] {
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

  const cashLabel=closed?"회수 매출 · 마감 스냅샷":"회수 매출 · 확인분";
  const snapshotNote=closed?"수임·실입금·비용은 저장된 마감 스냅샷입니다. 04 입금내역의 현재 실납부액 확인분과 다를 수 있으며 마감 원본은 변경하지 않습니다.":"실입금·비용 중 입금 기준 계산은 실제 금액과 납부일이 기록된 완료 회차 확인분입니다. 날짜·실납부액 미확인 회차는 입금내역에서 제외하며 앱의 안내에서 확인합니다.";
  const sheets:AnalyticsMeetingSheet[]=[
    {
      name:"00 회의요약",title:"로파워 데이터집계 · 회의요약",subtitle:"선택 기간의 핵심 매출·수익·영업 지표를 한 장에 정리한 회의용 요약입니다.",
      kpis:[
        {label:"공급 DB",value:supply.data?.supplyCohort.supplied??"확인 필요",format:"integer"},{label:"공급 DB 수임",value:supply.data?.supplyCohort.retained??"확인 필요",format:"integer"},{label:"공급 수임전환율",value:supply.data?supplyConversionRateLabel(supply.data.supplyCohort.supplied,supply.data.supplyCohort.conversionRate):"확인 필요"},{label:"연결 누락 공급 제외",value:supply.data?.supplyCohort.excludedSupplyRows??"확인 필요",format:"integer"},
        {label:"계약 1건당 순이익",value:costKnown?contractNet:"비용 확인 필요",format:"won"},{label:cashLabel,value:cashSales,format:"won"},{label:"전체 수임 · 계약일",value:contractCount,format:"integer"},{label:"월 목표",value:contractTarget,format:"integer"},
        {label:"접수 DB 수임전환율 · 참고",value:pct(converted,rangeLeads.length),format:"percent1"},{label:"평균 실수임료",value:averageFee,format:"won"},{label:"평균 할인율",value:standardKnown?discountRate:"확인 불가",format:"percent1"},{label:"현금 영업이익",value:costKnown?cashProfit:"비용 확인 필요",format:"won"},
      ],
      sections:[
        {title:"공급일 기준 수임 전환",note:"원본 DB 연결이 확인된 공급만 집계 · 기간 이후 수임 포함 · 취하·0원 제외 · 같은 DB는 한 번 집계",headers:["수임 전환 DB","고유 공급 DB","수임전환율","연결 누락 제외"],rows:[[supply.data?.supplyCohort.retained??"확인 필요",supply.data?.supplyCohort.supplied??"확인 필요",supply.data?supplyConversionRateLabel(supply.data.supplyCohort.supplied,supply.data.supplyCohort.conversionRate):"확인 필요",supply.data?.supplyCohort.excludedSupplyRows??"확인 필요"]]},
        {title:"계약일 기준 전체 수임",note:"공급일 기준 고유 DB 전환과 별도 집계 · 같은 DB의 여러 계약은 각각 집계",headers:["전체 수임","공급 연결 수임","공급 외 수임","공급 외 중 소개","연결 확인"],rows:supply.data?.periodContracts?[[supply.data.periodContracts.total,supply.data.periodContracts.fromSupply,supply.data.periodContracts.outsideSupply,supply.data.periodContracts.referrals,supply.data.periodContracts.unlinked]]:[["확인 필요","확인 필요","확인 필요","확인 필요","확인 필요"]]},
        {title:"수익 구조",note:snapshotNote,headers:["구분","금액"],rows:[[cashLabel,cashSales],["DB 구매비",costKnown?acquisitionCost:"비용 확인 필요"],["인건비",laborCost],["납부 수수료",paymentFees],["고정 운영비",fixedCost],["현금 기준 영업이익",costKnown?cashProfit:"비용 확인 필요"]],formats:["text","won"],widths:[28,20]},
        ...(isCurrentMonthRange?[{title:"월 목표 페이스",headers:["현재 계약","목표","오늘까지 목표","목표 달성률","월말 예상","남은 기간 일평균 필요"],rows:[[rangeCases.length,contractTarget,expectedContractsByToday,targetProgress,projectedMonthContracts,requiredContractsPerDay]],formats:["integer","integer","number1","percent1","integer","number1"],widths:[14,14,18,16,14,22]}] as any:[]),
        {title:"영업·수납 리스크",headers:["항목","현재 값","기준/설명"],rows:[["활성 DB 상한 초과 인원",overCap.length,globalSuperView?"로펌별 설정 상한 적용":`${activeCap}건 상한`],["방치 DB",neglected.length,globalSuperView?"로펌별 방치 기준 적용":`${neglectDays}일 이상 현재 단계 체류 · 단계 기록 없음 ${stageUnknown}건 제외`],["연체·결제실패",overdueNow.length,`회수율 ${collectionRate.toFixed(1)}%`],["서류준비 14일 이상",docDelay.length,"현재 진행중 사건 기준"]],formats:["text","integer","text"],widths:[28,16,34]},
      ],
    },
    {
      name:"01 팀인원",title:"팀 · 인원 성과",subtitle:"상담사별 결과·과정·품질 지표를 모두 표시합니다.",
      kpis:[{label:"상담 인원",value:staffRows.length,format:"integer"},{label:"전체 DB 생산성",value:moneyPer(contractSales,rangeLeads.length),format:"won"},{label:"총 인건비",value:laborCost,format:"won"},{label:"총 기여이익",value:costKnown?staffRows.reduce((sum,r)=>sum+r.contribution,0):"비용 확인 필요",format:"won"}],
      sections:[{title:"직원별 공급 DB 수임 전환",note:"공급일 기준 · 현재 DB 담당자 · 연결 누락 공급 제외",headers:["직원","공급 DB","수임 전환 DB","수임전환율"],rows:supply.data?.supplyCohort.staff.map(row=>[row.name,row.db,row.contractedDb,supplyConversionRateLabel(row.db,row.conversionRate)])??[["공급 원장 확인 필요","","",""]]}, {title:"상담사별 전체 성과 · 접수일/계약일/납부일",headers:["담당자","배정 DB","활성 DB","계약","수임액","회수매출","보상","기여이익","DB 생산성","DB당 컨택","상담완료→계약","할인율","단순분납","연체"],rows:staffRows.map(r=>[r.label,r.db,r.active,r.contracts,r.contractSales,r.cash,r.comp,costKnown?r.contribution:"비용 확인 필요",r.productivity,r.contacts,r.completedToContractRate,r.discountKnown?r.discountRate:"확인 불가",r.simpleInstallmentRate,r.overdue]),formats:["text","integer","integer","integer","won","won","won","won","won","number1","percent1","percent1","percent1","integer"],widths:[28,12,12,10,18,18,16,18,18,14,18,12,14,10]}],
    },
    {
      name:"02 상담운영",title:"상담 운영",subtitle:"유입 월 기준 퍼널과 컨택 지표를 회의용으로 정리합니다.",
      kpis:[{label:"DB당 평균 컨택",value:avgContacts,format:"number1"},{label:"2회 이하 종결",value:shortClosed,format:"integer"},{label:"방치 DB",value:neglected.length,format:"integer"}],
      sections:[
        {title:"DB 퍼널",headers:["단계","건수","직전 단계 대비 전환율"],rows:[["신규 DB",rangeLeads.length,100],["통화 연결",connected,pct(connected,rangeLeads.length)],["상담 진행",consult,pct(consult,connected)],["상담 완료",completed,pct(completed,consult)],["계약",converted,pct(converted,completed)]],formats:["text","integer","percent1"],widths:[20,12,24]},
      ],
    },
    {
      name:"03 DB구매유입",title:"DB 구매 · 유입",subtitle:"표본 제한 없이 집계 가능한 DB당 구매비·수임당 구매비·연결률·계약·매출을 그대로 표시합니다.",
      kpis:[{label:activeSettings.acquisitionMode==="db_purchase"&&!globalSuperView?"DB 구매비":"DB 구매비",value:costKnown?acquisitionCost:"비용 확인 필요",format:"won"},{label:"DB당 구매비 · DB당 비용",value:costKnown?moneyPer(acquisitionCost,rangeLeads.length):"비용 확인 필요",format:"won"},{label:"수임당 구매비 · 계약당 비용",value:costKnown?moneyPer(acquisitionCost,converted):"비용 확인 필요",format:"won"},{label:"비용 대비 수임액",value:acquisitionCost>0?contractSales/acquisitionCost:0,format:"number1"}],
      sections:[{title:"채널 · 소재 효율",headers:["소재/구분","비용","DB","DB당 구매비","연결률","계약","수임매출","수임당 구매비"],rows:channelRows.map(r=>[r.label,costKnown?r.spend:"확인 필요",r.db,costKnown?r.cpl:"확인 필요",r.connRate,r.won,r.revenue,costKnown?r.cpa:"확인 필요"]),formats:["text","won","integer","won","percent1","integer","won","won"],widths:[34,18,12,18,14,12,20,18]}],
    },
    {
      name:"04 입금내역",title:"입금내역",sections:[receiptSection],
    },
    {
      name:"05 사건수납",title:"사건 · 수납",subtitle:"현재 사건 진행 단계와 장기체류·연체·취하 데이터를 상세 목록으로 제공합니다.",
      kpis:[{label:"진행중 사건",value:cases.filter(c=>c.status==="진행중").length,format:"integer"},{label:"서류준비 14일+",value:docDelay.length,format:"integer"},{label:"연체·실패",value:overdueNow.length,format:"integer"},{label:"연체 회수율",value:overdueRecovery,format:"percent1"}],
      sections:[
        {title:"사건 진행 단계",headers:["단계","건수"],rows:stageRows.map(r=>[STAGE_GENERIC_LABELS[r.stage],r.count]),formats:["text","integer"],widths:[24,12]},
        {title:"서류준비 장기체류",headers:["의뢰인","사건번호","담당","사건유형","단계 변경일","체류일"],rows:docDelay.map(c=>{const client=clients.find(x=>x.id===c.clientId);return[client?.name??"-",c.caseNumber,c.assignedStaff,c.caseType,c.stageUpdatedAt,daysSince(c.stageUpdatedAt)]}),formats:["text","text","text","text","date","integer"],widths:[16,22,15,14,15,12]},
        {title:"연체 · 결제실패 상세",headers:["납부예정일","의뢰인","사건번호","담당","회차","금액","상태","실납부일"],rows:overdueDetail,formats:["date","text","text","text","integer","won","text","date"],widths:[15,16,22,15,10,18,12,15]},
        {title:"선택 기간 취하 사건",note:"취하 사건의 원본 요약금액입니다. 실입금·환불 여부가 확인된 금액으로 간주하지 않으며, 확인된 회차별 입금은 04 입금내역에서 별도로 표시합니다.",headers:["계약일","의뢰인","사건번호","담당","사건유형","계약금액","원본 입금 집계액 · 미확인"],rows:cancelled,formats:["date","text","text","text","text","won","won"],widths:[15,16,22,15,14,18,18]},
      ],
    },
    {
      name:"06 산식기준",title:"지표 산식 · 기준",subtitle:"회의에서 숫자의 의미를 바로 확인할 수 있도록 현재 데이터집계 산식을 함께 제공합니다.",
      sections:[{title:"주요 지표 산식",headers:["지표","산식/기준","현재 값"],rows:[["해당 월 실입금","해당 월 납부일 · 완료 상태 · 실제 납부액이 기록된 회차 합계 (예정금액 제외 · 계약 연결 미확인 입금 포함)",fullMonthCash],["누적 실입금 · 원장 계약","원장에 표시한 각 계약의 최초 기록부터 선택 월말까지 일자가 확인된 실제 납부액 합계",ledgerResult.totals.cumulativePaid],["월말 누적 실입금 · 전체","전체 완료 회차의 최초 기록부터 선택 월말까지 실제 납부액 확인분 · 계약 연결 미확인 포함",fullCumulativeCash],["미수 잔금","총 수임료 − 누적 실입금 · 입금일/실납부액 미확인 계약은 잔금 미확정",ledgerResult.totals.uncertainBalanceCases?"확인 필요":ledgerResult.rows.reduce((sum,row)=>sum+(row.balanceKnown?Math.max(0,row.balance):0),0)],["월말 이후 입금","누적 실입금·잔금에서 제외 (계약금액·사건 상태는 현재 기록)","제외"],["계약 1건당 순이익","(수임액 - DB 구매비 - 인건비) ÷ 계약건수",costKnown?contractNet:"비용 확인 필요"],["현금 영업이익","회수매출 - DB 구매비 - 인건비 - 납부수수료 - 고정운영비",costKnown?cashProfit:"비용 확인 필요"],["접수 DB 수임전환율 · 참고","취하·0원 제외 수임에 연결된 DB ÷ 선택 기간 유입 DB × 100",pct(converted,rangeLeads.length)],["DB당 구매비","DB 구매비 ÷ 유입 DB",costKnown?moneyPer(acquisitionCost,rangeLeads.length):"비용 확인 필요"],["수임당 구매비","DB 구매비 ÷ 계약 전환 DB",costKnown?moneyPer(acquisitionCost,converted):"비용 확인 필요"],["DB 생산성","수임매출 ÷ 배정 DB",moneyPer(contractSales,rangeLeads.length)],["회수율","실제 입금 ÷ 수임액 × 100",collectionRate],["평균 할인율","계약 당시 기준 기록이 있는 사건의 기준 수임료 대비 할인액 비율",standardKnown?discountRate:"확인 불가"]],formats:["text","text","number1"],widths:[26,56,20]}],
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
  const order = ["04 입금내역", "00 회의요약", "01 팀인원", "02 상담운영", "05 사건수납", "07 정산입력", "06 산식기준", "03 DB구매유입"];
  return order.map(name=>sheets.find(sheet=>sheet.name===name)!);
  }
  return { firmIds,totalStandardFee,totalDiscount,activeLeads,latePaid,overdueDue,converted,closed,costKnown,rangeLeads,dbRetainerConversion,periodCases,rangeCases,rangePaid,cashSales,contractSales,acquisitionCost,laborCost,paymentFees,fixedCost,contractCount,contractNet,cashProfit,averageFee,collectionRate,contractTarget,isCurrentMonthRange,expectedContractsByToday,projectedMonthContracts,requiredContractsPerDay,targetProgress,standardKnown,discountRate,activeCap,neglectDays,neglected,stageUnknown,overCap,overdueNow,missingDocuments,docDelay,allStaff,staffRows,avgContacts,connected,consult,completed,shortClosed,channelRows,clientsById,ledgerResult,receiptResult,receiptSection,fullMonthCash,fullCumulativeCash,allLedger,stageRows,selfInstallments,overdueRecovery,scopeLabel,periodLabel,buildSheets };
}
