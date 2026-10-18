export const SALES_STAGES = ["신규접수", "첫연락", "미팅예정", "제안 · 조건협의", "계약서발송", "서명완료", "보류", "실패"] as const;
export type SalesStage = typeof SALES_STAGES[number];
export const EDITABLE_SALES_STAGES = SALES_STAGES.filter(stage => stage !== "계약서발송" && stage !== "서명완료");
export type SalesLeadData = {
  name: string; representative: string; contactName: string; position: string; phone: string; email: string;
  website: string; businessNumber: string; region: string; address: string; specialty: string; currentSupplier: string;
  source: "listup" | "ad" | "referral"; campaignId: string; adId: string; owner: string; expectedMonthly: number; lostReason: string;
};
export type SalesProposal = { product: string; category: string; quantity: number; months: number; unitPrice: number; startDate: string; endDate: string; addons: string; delivery: string; paymentMethod: string; paymentCycle: string; vat: "included" | "excluded"; version: number };
export type SalesLead = { id: string; stage: SalesStage; revision: number; data: SalesLeadData; proposal: SalesProposal | null; created_at: string; updated_at: string; last_contact_at: string | null; sources: string[]; law_firm_id: string | null; signed_at?: string | null };
export type SalesEvent = { id: string; lead_id: string; kind: string; data: Record<string, unknown>; created_at: string; actor_name: string };
export const emptySalesLead = (): SalesLeadData => ({name:"",representative:"",contactName:"",position:"",phone:"",email:"",website:"",businessNumber:"",region:"",address:"",specialty:"회생 · 파산",currentSupplier:"",source:"listup",campaignId:"",adId:"",owner:"",expectedMonthly:0,lostReason:""});
export const emptyProposal = (): SalesProposal => ({product:"3Q DB",category:"개인회생",quantity:0,months:1,unitPrice:0,startDate:"",endDate:"",addons:"CRM 어드민",delivery:"CRM",paymentMethod:"계좌",paymentCycle:"월",vat:"excluded",version:0});
const text = (value: unknown, limit = 200) => String(value ?? "").trim().slice(0, limit);
export function nonnegative(value: unknown, max = 1_000_000_000) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > max) throw new Error("수량과 금액의 입력 범위를 확인해주세요."); return Math.round(number); }
export function normalizeSalesLead(input: Record<string, unknown>): SalesLeadData {
  const result = emptySalesLead();
  for (const key of Object.keys(result) as (keyof SalesLeadData)[]) {
    if (key === "expectedMonthly") result.expectedMonthly = nonnegative(input.expectedMonthly ?? 0);
    else if (key === "source") result.source = input.source === "ad" || input.source === "referral" ? input.source : "listup";
    else result[key] = text(input[key], key === "address" || key === "lostReason" ? 1000 : 200);
  }
  if (!result.name) throw new Error("로펌명을 입력해주세요.");
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error("이메일을 확인해주세요.");
  if (result.website) { try { const url = new URL(/^https?:\/\//.test(result.website) ? result.website : `https://${result.website}`); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw Error(); result.website = url.href; } catch { throw new Error("홈페이지 주소를 확인해주세요."); } }
  return result;
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
  const meetings = events.filter(row => row.kind === "meeting" && row.data.status !== "취소" && Date.parse(String(row.data.at)) >= weekStart && Date.parse(String(row.data.at)) < weekEnd);
  return { active:active.length, meetings:meetings.length, proposals:leads.filter(row=>row.stage === "제안 · 조건협의").reduce((sum,row)=>sum+row.data.expectedMonthly,0), signed:leads.filter(row=>row.stage === "서명완료" && row.signed_at?.startsWith(month)).length, stale:active.filter(row=>now-Date.parse(row.last_contact_at??row.created_at)>=7*86400000).length };
}
