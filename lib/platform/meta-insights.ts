// Shared, secret-free contracts and aggregation for the super-admin advertising view.
export interface InsightDay {
  date: string; accountId: string; adId: string; adName: string;
  campaignId: string; campaignName: string; adsetId: string; adsetName: string;
  spend: number; impressions: number; clicks: number; metaLeads: number;
}
export interface InsightSnapshot {
  version: 1; accountId: string; accountName: string; currency: string; timezone: string;
  start: string; end: string; fetchedAt: string; rows: InsightDay[];
}
export interface InsightConnection {
  id: string; lawFirmId: string; firmName: string; name: string; accountId: string | null;
  hasToken: boolean; hasReadToken: boolean;
}
export interface InsightAccount {
  accountId: string; connections: InsightConnection[];
  status: "cached" | "not_synced" | "error"; error: string | null;
  snapshot: InsightSnapshot | null;
}
export interface InsightLead {
  id: string; law_firm_id: string; meta_account_id: string | null;
  receivedAt: string | null; platform: Record<string, unknown> | null;
}
export interface InsightCase {
  id: string; law_firm_id: string; fromLeadId: string | null;
  status: string | null; contractAmount: string | number | null;
}
export interface InsightSupply {
  id: string; law_firm_id: string; lead_id: string | null; supplied_at: string;
  classification: string; billable: boolean; billing_type: string; unit_price_snapshot: string | number | null;
}
export interface InsightAd {
  accountId: string; adId: string; adName: string; campaignName: string; currency: string;
  spend: number; impressions: number; clicks: number; metaLeads: number; metaCpl: number | null;
  crmLeads: number; contracts: number; conversionRate: number | null; crmCpl: number | null;
  supplyRevenue: number | null; contribution: number | null; marginRate: number | null;
  firmNames: string[]; attributionNote: string | null;
  supplyScope?: "included" | "not_applicable" | "unknown";
}
export interface MetaInsightsResponse {
  start: string; end: string; generatedAt: string; accounts: InsightAccount[];
  unconfigured: InsightConnection[]; ads: InsightAd[];
  totals: { currency: string | null; spend: number | null; metaLeads: number; crmLeads: number; contracts: number; metaCpl: number | null; crmCpl: number | null; conversionRate: number | null; supplyRevenue: number | null; supplyAdSpend: number | null; contribution: number | null; marginRate: number | null };
  quality: { incompleteAccounts: number; unattributedLeads: number; unattributedSupply: number; pendingBillingFirms: number; notes: string[] };
}

export const META_LEAD_ACTION = "lead";
export function normalizeAdAccountId(value: unknown): string | null {
  const id = String(value ?? "").trim().replace(/^act_/, "");
  return /^\d{3,30}$/.test(id) ? id : null;
}
export function validateInsightRange(start: string, end: string) {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(start) || !valid(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 92) throw new Error("조회 기간은 올바른 날짜로 최대 93일을 선택해주세요.");
  return { start, end };
}
export function insightDate(value: unknown, timezone: string): string | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // Existing local CRM datetimes are Korean local time. Explicit offsets are preserved.
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? `${value}+09:00` : value);
  if (!Number.isFinite(timestamp)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
    return ["year", "month", "day"].map(k => parts.find(p => p.type === k)?.value).join("-");
  } catch { return null; }
}
const ratio = (n: number, d: number, scale = 1) => d > 0 ? n / d * scale : null;
const key = (firm: string, id: string) => `${firm}\u0000${id}`;
const plus = (a: number, b: number) => Math.round((a + b) * 1e6) / 1e6;

export function aggregateMetaInsights(input: {
  start: string; end: string; accounts: InsightAccount[]; unconfigured: InsightConnection[];
  leads: InsightLead[]; cases: InsightCase[]; supplies: InsightSupply[];
  firms: { id: string; name: string; billing_type: string }[];
  commercialProfiles: { law_firm_id: string; service_mode: "crm_only" | "db_supply" }[];
}): MetaInsightsResponse {
  const connections = new Map(input.accounts.flatMap(a => a.connections.map(c => [c.id, a] as const)));
  const eligibleFirms = new Set([...input.accounts.flatMap(a => a.connections.map(c => c.lawFirmId)), ...input.unconfigured.map(c => c.lawFirmId)]);
  const firms = new Map(input.firms.map(f => [f.id, f]));
  const modes = new Map(input.commercialProfiles.map(p => [p.law_firm_id, p.service_mode]));
  const scope = (account: InsightAccount): "included" | "not_applicable" | "unknown" => {
    const values = account.connections.map(c => modes.get(c.lawFirmId));
    if (values.length && values.every(v => v === "crm_only")) return "not_applicable";
    // A shared account with CRM-only clients has no defensible spend allocation.
    return values.length && values.every(v => v === "db_supply") ? "included" : "unknown";
  };
  const ads = new Map<string, InsightAd>();
  const activeAds = new Set<string>();
  const snapshots = input.accounts.flatMap(a => a.snapshot ? [a.snapshot] : []);
  for (const snap of snapshots) for (const row of snap.rows) {
    const id = key(snap.accountId, row.adId);
    activeAds.add(id);
    const item = ads.get(id) ?? { accountId: snap.accountId, adId: row.adId, adName: row.adName, campaignName: row.campaignName, currency: snap.currency, spend: 0, impressions: 0, clicks: 0, metaLeads: 0, metaCpl: null, crmLeads: 0, contracts: 0, conversionRate: null, crmCpl: null, supplyRevenue: 0, contribution: null, marginRate: null, firmNames: [], attributionNote: null };
    item.spend = plus(item.spend, row.spend); item.impressions += row.impressions; item.clicks += row.clicks; item.metaLeads += row.metaLeads;
    ads.set(id, item);
  }
  const leadAds = new Map<string, InsightAd>();
  const leadCohort = new Set<string>();
  let unattributedLeads = 0, unattributedSupply = 0;
  const inRange = (date: string | null) => date !== null && date >= input.start && date <= input.end;
  for (const lead of input.leads) {
    if (!eligibleFirms.has(lead.law_firm_id)) continue;
    const platform = lead.platform ?? {};
    const connectionId = lead.meta_account_id || (typeof platform.metaAccountId === "string" ? platform.metaAccountId : "");
    const account = connections.get(connectionId);
    const adId = typeof platform.adId === "string" && /^\d+$/.test(platform.adId) ? platform.adId : "";
    const contradictory = Boolean(lead.meta_account_id && platform.metaAccountId && lead.meta_account_id !== platform.metaAccountId);
    const sameFirm = account?.connections.some(c => c.id === connectionId && c.lawFirmId === lead.law_firm_id);
    const valid = account && sameFirm && !contradictory && adId;
    const date = insightDate(lead.receivedAt, account?.snapshot?.timezone || "Asia/Seoul");
    const id = key(lead.law_firm_id, lead.id);
    if (!valid || !account.snapshot) { if (inRange(date)) unattributedLeads++; continue; }
    const adKey = key(account.accountId, adId);
    // Successful Insights may omit an ad with zero spend; retain CRM-only rows explicitly.
    let item = ads.get(adKey);
    if (!item) { item = { accountId: account.accountId, adId, adName: `광고 ${adId}`, campaignName: "", currency: account.snapshot.currency, spend: 0, impressions: 0, clicks: 0, metaLeads: 0, metaCpl: null, crmLeads: 0, contracts: 0, conversionRate: null, crmCpl: null, supplyRevenue: 0, contribution: null, marginRate: null, firmNames: [], attributionNote: null }; ads.set(adKey, item); }
    leadAds.set(id, item);
    if (!item.firmNames.includes(firms.get(lead.law_firm_id)?.name || lead.law_firm_id)) item.firmNames.push(firms.get(lead.law_firm_id)?.name || lead.law_firm_id);
    if (inRange(date) && !leadCohort.has(id)) { leadCohort.add(id); item.crmLeads++; activeAds.add(adKey); }
  }
  const contracted = new Set<string>();
  for (const contract of input.cases) {
    if (!contract.fromLeadId || contract.status === "취하" || !Number.isFinite(Number(contract.contractAmount)) || Number(contract.contractAmount) <= 0) continue;
    const id = key(contract.law_firm_id, contract.fromLeadId);
    if (!leadCohort.has(id) || contracted.has(id)) continue;
    contracted.add(id); const item = leadAds.get(id); if (item) item.contracts++;
  }
  const pendingFirms = new Set<string>();
  for (const firmId of eligibleFirms) if (modes.get(firmId) !== "crm_only" && (modes.get(firmId) !== "db_supply" || firms.get(firmId)?.billing_type !== "per_lead")) pendingFirms.add(firmId);
  for (const supply of input.supplies) {
    if (!eligibleFirms.has(supply.law_firm_id) || modes.get(supply.law_firm_id) === "crm_only") continue;
    const item = supply.lead_id ? leadAds.get(key(supply.law_firm_id, supply.lead_id)) : undefined;
    const snap = item ? input.accounts.find(a => a.accountId === item.accountId)?.snapshot : null;
    if (!inRange(insightDate(supply.supplied_at, snap?.timezone || "Asia/Seoul"))) continue;
    if (supply.billing_type !== "per_lead") pendingFirms.add(supply.law_firm_id);
    if (!supply.billable) continue;
    if (!item) { unattributedSupply++; continue; }
    activeAds.add(key(item.accountId, item.adId));
    const amount = Number(supply.unit_price_snapshot);
    if (supply.billing_type !== "per_lead" || supply.unit_price_snapshot === null || !Number.isSafeInteger(amount) || amount <= 0) { item.supplyRevenue = null; pendingFirms.add(supply.law_firm_id); }
    else if (item.supplyRevenue !== null) { const sum = item.supplyRevenue + amount; item.supplyRevenue = Number.isSafeInteger(sum) ? sum : null; }
  }
  for (const item of ads.values()) {
    const account = input.accounts.find(a => a.accountId === item.accountId)!;
    item.supplyScope = scope(account);
    const needsBilling = account.connections.some(c => pendingFirms.has(c.lawFirmId));
    if (item.supplyScope !== "included" || needsBilling || unattributedSupply > 0) item.supplyRevenue = null;
    item.metaCpl = ratio(item.spend, item.metaLeads); item.crmCpl = ratio(item.spend, item.crmLeads);
    item.conversionRate = ratio(item.contracts, item.crmLeads, 100);
    if (item.supplyRevenue !== null && item.currency === "KRW") { item.contribution = plus(item.supplyRevenue, -item.spend); item.marginRate = ratio(item.contribution, item.supplyRevenue, 100); }
    item.attributionNote = item.supplyScope === "not_applicable" ? "CRM 전용 · DB 공급매출·마진 비대상" : item.supplyScope === "unknown" ? "서비스 미등록 또는 CRM 전용·공급 로펌 공유 계정 · 공급 손익 확인 필요" : needsBilling ? "청구 방식·양수 공급단가 확인 필요" : unattributedSupply > 0 ? "광고 미귀속 공급매출 있음" : item.currency !== "KRW" ? "원화 매출과 통화가 달라 마진 계산 제외" : null;
  }
  const rows = [...ads.values()].filter(a => activeAds.has(key(a.accountId, a.adId))).sort((a, b) => b.spend - a.spend || a.adId.localeCompare(b.adId));
  const currencies = new Set(snapshots.map(s => s.currency));
  const incompleteAccounts = input.accounts.filter(a => a.status !== "cached").length + input.unconfigured.length;
  const complete = incompleteAccounts === 0 && snapshots.length > 0;
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const spend = complete && currency ? rows.reduce((s, r) => plus(s, r.spend), 0) : null;
  const crmLeads = rows.reduce((s, r) => s + r.crmLeads, 0), contracts = rows.reduce((s, r) => s + r.contracts, 0), metaLeads = rows.reduce((s, r) => s + r.metaLeads, 0);
  const salesRows = rows.filter(r => r.supplyScope === "included"), salesAccounts = input.accounts.filter(a => scope(a) === "included");
  const salesComplete = salesAccounts.length > 0 && input.accounts.every(a => scope(a) !== "unknown") && salesAccounts.every(a => a.status === "cached") && !input.unconfigured.some(c => modes.get(c.lawFirmId) !== "crm_only");
  const supplyRevenue = salesComplete && pendingFirms.size === 0 && unattributedSupply === 0 && salesRows.every(r => r.supplyRevenue !== null) ? salesRows.reduce((s, r) => s + r.supplyRevenue!, 0) : null;
  const supplyAdSpend = salesComplete && salesAccounts.every(a => a.snapshot?.currency === "KRW") ? salesRows.reduce((s, r) => plus(s, r.spend), 0) : null;
  const contribution = supplyAdSpend !== null && supplyRevenue !== null ? plus(supplyRevenue, -supplyAdSpend) : null;
  return { start: input.start, end: input.end, generatedAt: new Date().toISOString(), accounts: input.accounts, unconfigured: input.unconfigured, ads: rows,
    totals: { currency, spend, metaLeads, crmLeads, contracts, metaCpl: spend === null ? null : ratio(spend, metaLeads), crmCpl: spend === null ? null : ratio(spend, crmLeads), conversionRate: ratio(contracts, crmLeads, 100), supplyRevenue, supplyAdSpend, contribution, marginRate: contribution === null || supplyRevenue === null ? null : ratio(contribution, supplyRevenue, 100) },
    quality: { incompleteAccounts, unattributedLeads, unattributedSupply, pendingBillingFirms: pendingFirms.size, notes: ["Meta 리드는 actions의 lead 항목만 사용합니다. 다른 lead action을 중복 합산하지 않습니다.", "CRM DB는 광고 ID가 확인된 조회기간 접수 고유 리드입니다. 계약전환은 해당 코호트의 현재 유효 계약(금액 > 0, 취하 제외)입니다.", "CRM 전용 로펌은 공급매출·마진 비대상입니다. 서비스 미등록·0원 단가는 확인 필요이며, CRM 전용과 공급 로펌이 공유한 광고계정은 비용 배분을 추정하지 않습니다.", "공급매출은 조회기간 공급 원장의 양수 건별 단가 스냅샷입니다. 공급 마진에는 공급 대상 계정의 광고비만 차감합니다. 광고비 차감마진은 인건비·세금 등을 제외한 회계 순이익이 아닙니다.", "일별 광고비와 CRM 날짜는 각 광고계정 시간대 기준입니다. 서로 다른 통화는 합산하지 않습니다.", "기존 수동 광고비·정산 설정과 월마감 값은 이 화면에 합산하거나 변경하지 않습니다."] } };
}
