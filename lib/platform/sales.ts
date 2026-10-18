export const SALES_STAGES = ["신규접수", "첫연락", "미팅예정", "제안 · 조건협의", "계약서발송", "서명완료", "보류", "실패"] as const;
export type SalesStage = typeof SALES_STAGES[number];
export const EDITABLE_SALES_STAGES = SALES_STAGES.filter(stage => stage !== "계약서발송" && stage !== "서명완료");
export const SALES_PRIORITIES = ["높음", "보통", "낮음"] as const;
export type SalesLeadData = {
  name: string; representative: string; contactName: string; position: string; phone: string; email: string;
  website: string; businessNumber: string; region: string; address: string; specialty: string; currentSupplier: string;
  source: "listup" | "ad" | "referral"; campaignId: string; adId: string; owner: string; expectedMonthly: number; lostReason: string;
  note?: string; priority?: typeof SALES_PRIORITIES[number];
};
export type SalesProposal = { product: string; category: string; quantity: number; months: number; unitPrice: number; startDate: string; endDate: string; addons: string; delivery: string; paymentMethod: string; paymentCycle: string; vat: "included" | "excluded"; version: number };
export type SalesLead = { id: string; stage: SalesStage; revision: number; data: SalesLeadData; proposal: SalesProposal | null; created_at: string; updated_at: string; last_contact_at: string | null; sources: string[]; law_firm_id: string | null; signed_at?: string | null };
export type SalesEventRevision = { id: string; event_id: string; lead_id: string; revision: number; action: string; data: Record<string, unknown>; archived: boolean; actor_name: string; created_at: string };
export type SalesEvent = { id: string; lead_id: string; kind: string; data: Record<string, unknown>; created_at: string; actor_name: string; revision?: number; archived?: boolean; originalData?: Record<string, unknown>; history?: SalesEventRevision[] };
export type SalesImportRow = SalesLeadData & { stage: SalesStage };
export const emptySalesLead = (): SalesLeadData => ({name:"",representative:"",contactName:"",position:"",phone:"",email:"",website:"",businessNumber:"",region:"",address:"",specialty:"회생 · 파산",currentSupplier:"",source:"listup",campaignId:"",adId:"",owner:"",expectedMonthly:0,lostReason:"",note:"",priority:"보통"});
export const emptyProposal = (): SalesProposal => ({product:"3Q DB",category:"개인회생",quantity:0,months:1,unitPrice:0,startDate:"",endDate:"",addons:"CRM 어드민",delivery:"CRM",paymentMethod:"계좌",paymentCycle:"월",vat:"excluded",version:0});
const text = (value: unknown, limit = 200) => String(value ?? "").trim().slice(0, limit);
export function nonnegative(value: unknown, max = 1_000_000_000) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > max) throw new Error("수량과 금액의 입력 범위를 확인해주세요."); return Math.round(number); }
export function normalizeSalesLead(input: Record<string, unknown>): SalesLeadData {
  if (String(input.note??"").trim().length>5000) throw Error("메모는 5,000자 이하로 입력해주세요.");
  const result = emptySalesLead();
  for (const key of Object.keys(result) as (keyof SalesLeadData)[]) {
    if (key === "expectedMonthly") result.expectedMonthly = nonnegative(input.expectedMonthly ?? 0);
    else if (key === "source") result.source = input.source === "ad" || input.source === "referral" ? input.source : "listup";
    else if (key === "priority") { const priority=text(input.priority)||"보통"; if (!(SALES_PRIORITIES as readonly string[]).includes(priority)) throw Error("우선순위는 높음·보통·낮음 중 선택해주세요."); result.priority=priority as SalesLeadData["priority"]; }
    else result[key] = text(input[key], key === "note" ? 5000 : key === "address" || key === "lostReason" ? 1000 : 200);
  }
  if (!result.name) throw new Error("로펌명을 입력해주세요.");
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error("이메일을 확인해주세요.");
  if (result.website) { try { const url = new URL(/^https?:\/\//.test(result.website) ? result.website : `https://${result.website}`); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw Error(); result.website = url.href; } catch { throw new Error("홈페이지 주소를 확인해주세요."); } }
  return result;
}
export function normalizeSalesImport(input: Record<string, unknown>): SalesImportRow {
  const data=normalizeSalesLead(input), stage=text(input.stage)||"신규접수";
  if (!(EDITABLE_SALES_STAGES as readonly string[]).includes(stage)) throw Error("등록 단계는 신규접수·첫연락·미팅예정·제안 · 조건협의·보류·실패 중 선택해주세요. 계약서발송·서명완료는 전자서명 전용입니다.");
  if (stage==="실패"&&!data.lostReason) throw Error("실패 사유를 입력해주세요.");
  return {...data,stage:stage as SalesStage};
}
export function mapSalesImportRow(row: Record<string, unknown>, fields: readonly (readonly [string, keyof SalesLeadData])[]): SalesImportRow {
  const mapped:Record<string,unknown>={...row};
  for(const [label,key] of fields){if(row[label]!=null)mapped[key]=row[label];if(row[label.replace(" *","")]!=null)mapped[key]=row[label.replace(" *","")];}
  mapped.stage=row["영업 단계"]??row["단계"]??row.stage;
  mapped.note=row["메모"]??row.note;mapped.priority=row["우선순위"]??row.priority;mapped.lostReason=row["보류 · 실패 사유"]??row.lostReason;
  const source=String(row["유입 경로"]??row.source??"listup");
  const labels:Record<string,string>={listup:"직접 리스트업",ad:"광고 신청",referral:"소개"};
  mapped.source=Object.keys(labels).find(key=>key===source||labels[key]===source)??"listup";
  return normalizeSalesImport(mapped);
}
export function normalizeSalesEvent(input: Record<string, unknown>, kind: "activity" | "meeting") {
  const at=String(input.at??new Date().toISOString()), nextAt=String(input.nextAt??"");
  if (!Number.isFinite(Date.parse(at)) || (nextAt&&!Number.isFinite(Date.parse(nextAt)))) throw Error("활동 일시와 다음 업무 기한을 확인해주세요.");
  if (kind==="activity"&&!['전화','문자','이메일','미팅','메모'].includes(String(input.type))) throw Error("기록 종류를 확인해주세요.");
  const note=String(input.note??"").trim(); if (!note||note.length>5000) throw Error("기록 내용은 1~5,000자로 입력해주세요.");
  if (input.status!=null&&!['예정','완료','취소'].includes(String(input.status))) throw Error("미팅 상태를 확인해주세요.");
  return {type:kind==="meeting"?"미팅":String(input.type),at,note,nextTask:text(input.nextTask,1000),nextAt,location:text(input.location,300),attendees:text(input.attendees,500),status:String(input.status??"예정")};
}
/** Immutable original events keep their creation request IDs. Only display the latest correction. */
export function projectSalesEvents(events: SalesEvent[], revisions: SalesEventRevision[]): SalesEvent[] {
  const histories=new Map<string,SalesEventRevision[]>();
  for(const row of revisions){const list=histories.get(row.event_id)??[];list.push(row);histories.set(row.event_id,list);}
  return events.map(event=>{const history=(histories.get(event.id)??[]).filter(row=>row.lead_id===event.lead_id).sort((a,b)=>a.revision-b.revision);const last=history[history.length-1];return {...event,originalData:event.data,data:last?.data??event.data,revision:last?.revision??0,archived:last?.archived??false,history};});
}
export function salesIdentity(data: SalesLeadData) {
  return { business: data.businessNumber.replace(/\D/g, ""), phone: data.phone.replace(/\D/g, ""), domain: data.website ? new URL(data.website).hostname.toLowerCase().replace(/^www\./, "") : "", name: data.name.replace(/\s/g, "").toLowerCase() };
}
export function validDate(value: string) { const date = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value; }
export function normalizeProposal(input: Record<string, unknown>): SalesProposal {
  const row = { ...emptyProposal(), product: text(input.product), category: text(input.category), quantity: nonnegative(input.quantity, 1_000_000), months: nonnegative(input.months, 120), unitPrice: nonnegative(input.unitPrice, 100_000_000), startDate: text(input.startDate,10), endDate:text(input.endDate,10), addons:text(input.addons,1000), delivery:text(input.delivery),paymentMethod:text(input.paymentMethod),paymentCycle:text(input.paymentCycle),vat:input.vat === "included" ? "included" as const : "excluded" as const };
  if (!row.product || !row.quantity || !row.months || !row.unitPrice || !validDate(row.startDate) || !validDate(row.endDate) || row.endDate < row.startDate) throw new Error("제안 상품·수량·단가·기간을 확인해주세요.");
  if (!Number.isSafeInteger(row.quantity * row.unitPrice) || row.quantity * row.unitPrice > 100_000_000_000) throw new Error("제안 금액이 입력 범위를 초과했습니다.");
  return row;
}
export function salesMetrics(leads: SalesLead[], events: SalesEvent[], today: string) {
  const now = Date.parse(`${today}T00:00:00+09:00`), month = today.slice(0,7);
  const active = leads.filter(row => !["서명완료","실패","보류"].includes(row.stage));
  const weekday = (new Date(now + 9*3600000).getUTCDay()+6)%7;
  const weekStart = now-weekday*86400000, weekEnd=weekStart+7*86400000;
  const meetings = events.filter(row => !row.archived && row.kind === "meeting" && row.data.status !== "취소" && Date.parse(String(row.data.at)) >= weekStart && Date.parse(String(row.data.at)) < weekEnd);
  return { active:active.length, meetings:meetings.length, proposals:leads.filter(row=>row.stage === "제안 · 조건협의").reduce((sum,row)=>sum+row.data.expectedMonthly,0), signed:leads.filter(row=>row.stage === "서명완료" && row.signed_at?.startsWith(month)).length, stale:active.filter(row=>now-Date.parse(row.last_contact_at??row.created_at)>=7*86400000).length };
}
