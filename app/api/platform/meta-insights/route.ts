import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { decryptIntegrationSecret, encryptIntegrationSecret, platformError, requirePlatformUser } from "@/lib/platform/server";
import { aggregateMetaInsights, normalizeAdAccountId, validateInsightRange, type InsightAccount, type InsightConnection, type InsightSnapshot } from "@/lib/platform/meta-insights";
import { fetchMetaInsights, MetaInsightsError } from "@/lib/platform/meta-insights-graph";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
type Admin = Awaited<ReturnType<typeof requirePlatformUser>>["admin"];
type ConnectionRow = { id: string; law_firm_id: string; name: string; ad_account_id: string | null; access_token_ciphertext: string | null };
type Group = { accountId: string; connections: InsightConnection[]; ciphertext: string | null; fingerprint: string };

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= 100_000;) {
    const result = await query(offset, offset + 999);
    if (result.error) throw new Error("광고 성과 저장소를 읽지 못했습니다. 관리자에게 데이터베이스 설정 확인을 요청해주세요.");
    const batch = result.data || [];
    if (!batch.length) return rows;
    rows.push(...batch); offset += batch.length;
  }
  throw new Error("조회 데이터가 한도를 초과했습니다. 관리자에게 집계 범위 확인을 요청해주세요.");
}
async function configuration(admin: Admin, signal: AbortSignal) {
  const [rows, tokens, firms] = await Promise.all([
    allRows<ConnectionRow>((from, to) => admin.from("firm_meta_accounts").select("id,law_firm_id,name,ad_account_id,access_token_ciphertext").eq("active", true).order("id").range(from, to).abortSignal(signal)),
    allRows<{ meta_account_id: string; access_token_ciphertext: string }>((from, to) => admin.from("platform_meta_insights_tokens").select("meta_account_id,access_token_ciphertext").order("meta_account_id").range(from, to).abortSignal(signal)),
    allRows<{ id: string; name: string; billing_type: string }>((from, to) => admin.from("law_firms").select("id,name,billing_type").order("id").range(from, to).abortSignal(signal)),
  ]);
  const tokenMap = new Map(tokens.map(t => [t.meta_account_id, t.access_token_ciphertext]));
  const firmMap = new Map(firms.map(f => [f.id, f.name]));
  const grouped = new Map<string, ConnectionRow[]>(), unconfigured: InsightConnection[] = [];
  const safe = (r: ConnectionRow): InsightConnection => ({ id: r.id, lawFirmId: r.law_firm_id, firmName: firmMap.get(r.law_firm_id) || "로펌", name: r.name, accountId: normalizeAdAccountId(r.ad_account_id), hasToken: Boolean(tokenMap.get(r.id) || r.access_token_ciphertext), hasReadToken: tokenMap.has(r.id) });
  for (const row of rows) {
    const accountId = normalizeAdAccountId(row.ad_account_id);
    if (!accountId) { unconfigured.push(safe(row)); continue; }
    grouped.set(accountId, [...(grouped.get(accountId) || []), row]);
  }
  const groups: Group[] = [...grouped].map(([accountId, members]) => {
    const preferred = members.find(r => tokenMap.has(r.id)) || members.find(r => r.access_token_ciphertext);
    const ciphertext = preferred ? tokenMap.get(preferred.id) || preferred.access_token_ciphertext : null;
    const fingerprint = createHash("sha256").update(JSON.stringify([accountId, process.env.META_GRAPH_API_VERSION, members.map(r => [r.id, tokenMap.get(r.id) || r.access_token_ciphertext])])).digest("hex");
    return { accountId, connections: members.map(safe), ciphertext, fingerprint };
  });
  return { groups, unconfigured, firms };
}
function responseError(error: unknown) {
  const result = platformError(error);
  return NextResponse.json({ error: result.message }, { status: result.status, headers });
}
function rangeFrom(request: NextRequest) {
  return validateInsightRange(request.nextUrl.searchParams.get("start") || "", request.nextUrl.searchParams.get("end") || "");
}
function isSnapshot(value: any, group: Group, start: string, end: string): value is InsightSnapshot {
  return value?.version === 1 && value.accountId === group.accountId && value.start === start && value.end === end && typeof value.currency === "string" && typeof value.timezone === "string" && Array.isArray(value.rows);
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requirePlatformUser(request, ["super_admin"]);
    const { start, end } = rangeFrom(request);
    const { groups, unconfigured, firms } = await configuration(admin, request.signal);
    const startTime = new Date(Date.parse(start) - 2 * 86400000).toISOString();
    const endTime = new Date(Date.parse(end) + 2 * 86400000).toISOString();
    const [cache, leads, cases, supplies, commercialProfiles] = await Promise.all([
      allRows<any>((from, to) => admin.from("platform_meta_insights_cache").select("account_id,fingerprint,snapshot,last_error").eq("range_start", start).eq("range_end", end).order("account_id").order("fingerprint").range(from, to).abortSignal(request.signal)),
      allRows<any>((from, to) => admin.from("app_leads").select("id,law_firm_id,meta_account_id,receivedAt:data->>receivedAt,adName:data->>adName,source:data->>source,platform:data->_platform").order("id").range(from, to).abortSignal(request.signal)),
      allRows<any>((from, to) => admin.from("app_cases").select("id,law_firm_id,fromLeadId:data->>fromLeadId,status:data->>status,contractAmount:data->>contractAmount").order("id").range(from, to).abortSignal(request.signal)),
      allRows<any>((from, to) => admin.from("lead_supply_ledger").select("id,law_firm_id,lead_id,supplied_at,classification,billable,billing_type,unit_price_snapshot").neq("origin", "backfill").gte("supplied_at", startTime).lt("supplied_at", endTime).order("id").range(from, to).abortSignal(request.signal)),
      allRows<{ law_firm_id: string; service_mode: "crm_only" | "db_supply" }>((from, to) => admin.from("platform_firm_commercial_profiles").select("law_firm_id,service_mode").order("law_firm_id").range(from, to).abortSignal(request.signal)),
    ]);
    const accounts: InsightAccount[] = groups.map(group => {
      const row = cache.find(c => c.account_id === group.accountId && c.fingerprint === group.fingerprint);
      const snapshot = isSnapshot(row?.snapshot, group, start, end) ? row.snapshot : null;
      return { accountId: group.accountId, connections: group.connections, snapshot, status: row?.last_error ? "error" : snapshot ? "cached" : "not_synced", error: row?.last_error || (!group.ciphertext ? "조회 가능한 토큰이 등록되지 않았습니다." : null) };
    });
    return NextResponse.json(aggregateMetaInsights({ start, end, accounts, unconfigured, leads, cases, supplies, firms, commercialProfiles }), { headers });
  } catch (error) { return responseError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { admin } = await requirePlatformUser(request, ["super_admin"]);
    const raw = await request.text();
    if (raw.length > 4096) throw new Error("요청이 너무 큽니다.");
    let body: any; try { body = JSON.parse(raw); } catch { throw new Error("요청 형식이 올바르지 않습니다."); }
    if (body.action !== "refresh") throw new Error("지원하지 않는 작업입니다.");
    const { start, end } = validateInsightRange(String(body.start || ""), String(body.end || ""));
    const accountId = normalizeAdAccountId(body.accountId);
    const { groups } = await configuration(admin, request.signal);
    const group = groups.find(g => g.accountId === accountId);
    if (!group) throw new Error("등록된 활성 광고계정을 선택해주세요.");
    const identity = { account_id: group.accountId, range_start: start, range_end: end, fingerprint: group.fingerprint };
    try {
      let token = "";
      try { if (group.ciphertext) token = decryptIntegrationSecret(group.ciphertext); } catch { throw new MetaInsightsError("CONFIGURATION", "저장된 조회 토큰을 사용할 수 없습니다. 관리자에게 암호화 설정 확인을 요청해주세요."); }
      const snapshot = await fetchMetaInsights({ accountId: group.accountId, token, version: process.env.META_GRAPH_API_VERSION?.trim() || "", start, end, signal: request.signal });
      // A single row upsert publishes the entire account/range only after every page succeeds.
      const { error } = await admin.from("platform_meta_insights_cache").upsert({ ...identity, snapshot, last_error: null, last_attempt_at: snapshot.fetchedAt }, { onConflict: "account_id,range_start,range_end,fingerprint" });
      if (error) throw new Error("완료된 광고 조회 결과를 저장하지 못했습니다. 다시 조회해주세요.");
      return NextResponse.json({ ok: true, accountId, fetchedAt: snapshot.fetchedAt }, { headers });
    } catch (error) {
      const message = error instanceof MetaInsightsError ? error.message : "광고 조회 결과를 완료하거나 저장하지 못했습니다. 기존 완료 캐시를 유지합니다.";
      // Failure metadata does not overwrite the previous successful snapshot.
      const { error: saveError } = await admin.from("platform_meta_insights_cache").upsert({ ...identity, last_error: message, last_attempt_at: new Date().toISOString() }, { onConflict: "account_id,range_start,range_end,fingerprint", defaultToNull: false });
      return NextResponse.json({ ok: false, accountId, error: message + (saveError ? " 오류 상태 저장에도 실패했습니다." : "") }, { headers });
    }
  } catch (error) { return responseError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    const raw = await request.text();
    if (raw.length > 12_000) throw new Error("요청이 너무 큽니다.");
    let body: any; try { body = JSON.parse(raw); } catch { throw new Error("요청 형식이 올바르지 않습니다."); }
    const id = String(body.metaAccountId || "");
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new Error("연결 계정을 선택해주세요.");
    const { data, error } = await admin.from("firm_meta_accounts").select("id").eq("id", id).maybeSingle();
    if (error || !data) throw new Error("등록된 Meta 연결을 찾지 못했습니다.");
    if (body.accessToken === null) {
      const result = await admin.from("platform_meta_insights_tokens").delete().eq("meta_account_id", id);
      if (result.error) throw new Error("광고 조회 전용 토큰을 해제하지 못했습니다.");
    } else {
      if (typeof body.accessToken !== "string" || body.accessToken.length < 10 || body.accessToken.length > 8192 || /\s/.test(body.accessToken)) throw new Error("공백 없는 유효한 조회 토큰을 입력해주세요.");
      let ciphertext: string; try { ciphertext = encryptIntegrationSecret(body.accessToken); } catch { throw new Error("조회 토큰 암호화 설정을 확인해주세요."); }
      const result = await admin.from("platform_meta_insights_tokens").upsert({ meta_account_id: id, access_token_ciphertext: ciphertext, updated_at: new Date().toISOString(), updated_by: profile.id }, { onConflict: "meta_account_id" });
      if (result.error) throw new Error("광고 조회 전용 토큰을 저장하지 못했습니다.");
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) { return responseError(error); }
}
