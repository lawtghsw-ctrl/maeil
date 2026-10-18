import { META_LEAD_ACTION, normalizeAdAccountId, validateInsightRange, type InsightDay, type InsightSnapshot } from "./meta-insights";

export class MetaInsightsError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function failure(code: string, message: string): never { throw new MetaInsightsError(code, message); }
function numeric(value: unknown, integer = false) {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "" || !/^\d+(?:\.\d{1,6})?$/.test(String(value))) return failure("INVALID_RESPONSE", "Meta 응답의 숫자 형식을 확인할 수 없습니다.");
  const n = Number(value);
  if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER / 1e6 || (integer && !Number.isInteger(n))) return failure("INVALID_RESPONSE", "Meta 응답의 숫자 범위를 확인할 수 없습니다.");
  return n;
}
export async function fetchMetaInsights(args: { accountId: string; token: string; version: string; start: string; end: string; signal?: AbortSignal; fetcher?: typeof fetch }): Promise<InsightSnapshot> {
  const accountId = normalizeAdAccountId(args.accountId);
  validateInsightRange(args.start, args.end);
  if (!accountId || !/^v\d{1,3}\.\d{1,2}$/.test(args.version) || !args.token) return failure("CONFIGURATION", "광고계정 ID·조회 토큰·Graph API 버전을 확인해주세요.");
  const fetcher = args.fetcher || fetch, controller = new AbortController();
  const abort = () => controller.abort();
  args.signal?.addEventListener("abort", abort, { once: true });
  if (args.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 22_000);
  const base = `https://graph.facebook.com/${args.version}/act_${accountId}`;
  async function get(url: URL): Promise<any> {
    if (url.origin !== "https://graph.facebook.com" || !url.pathname.startsWith(`/${args.version}/act_${accountId}`)) return failure("INVALID_RESPONSE", "Meta 페이지 경로가 올바르지 않습니다.");
    let response: Response;
    try { response = await fetcher(url.toString(), { method: "GET", headers: { Authorization: `Bearer ${args.token}` }, redirect: "error", cache: "no-store", signal: controller.signal }); }
    catch { return failure(controller.signal.aborted ? "TIMEOUT" : "NETWORK", controller.signal.aborted ? "Meta 조회 시간이 초과되었거나 중단되었습니다. 완료된 이전 캐시를 유지합니다." : "Meta에 연결하지 못했습니다. 완료된 이전 캐시를 유지합니다."); }
    const reader = response.body?.getReader();
    if (!reader) return failure("INVALID_RESPONSE", "Meta 응답 본문이 없습니다.");
    const decoder = new TextDecoder(); let text = "", bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 4_000_000) { await reader.cancel(); return failure("TOO_LARGE", "Meta 응답이 너무 큽니다. 조회 기간을 줄여주세요."); }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) { if (error instanceof MetaInsightsError) throw error; return failure("NETWORK", "Meta 응답 수신이 중단되었습니다. 기존 완료 캐시를 유지합니다."); }
    let body: any; try { body = JSON.parse(text); } catch { return failure("INVALID_RESPONSE", "Meta 응답을 해석하지 못했습니다."); }
    if (!response.ok || body?.error) {
      const code = Number(body?.error?.code);
      if ([10, 190, 200, 294].includes(code) || [401, 403].includes(response.status)) return failure("PERMISSION", "광고 조회 권한 또는 토큰 만료를 확인해주세요. ads_read 및 해당 광고계정 접근 권한이 필요합니다.");
      if ([4, 17, 32, 613].includes(code) || response.status === 429) return failure("RATE_LIMIT", "Meta 조회 한도에 도달했습니다. 잠시 후 다시 조회해주세요.");
      return failure("PROVIDER", "Meta에서 조회를 완료하지 못했습니다. 계정 설정과 조회 기간을 확인해주세요.");
    }
    if (!body || typeof body !== "object") return failure("INVALID_RESPONSE", "Meta 응답 형식이 올바르지 않습니다.");
    return body;
  }
  try {
    const infoUrl = new URL(base); infoUrl.searchParams.set("fields", "account_id,name,currency,timezone_name");
    const info = await get(infoUrl);
    if (String(info.account_id) !== accountId || !/^[A-Z]{3}$/.test(info.currency || "") || typeof info.timezone_name !== "string") return failure("INVALID_RESPONSE", "Meta 계정·통화·시간대를 확인할 수 없습니다.");
    try { new Intl.DateTimeFormat("en", { timeZone: info.timezone_name }).format(); } catch { return failure("INVALID_RESPONSE", "Meta 광고계정 시간대가 올바르지 않습니다."); }
    const rows: InsightDay[] = [], seen = new Set<string>(), cursors = new Set<string>();
    const url = new URL(`${base}/insights`);
    url.searchParams.set("fields", "account_id,ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,date_start,date_stop,spend,impressions,clicks,actions,account_currency");
    url.searchParams.set("level", "ad"); url.searchParams.set("time_increment", "1"); url.searchParams.set("limit", "500");
    url.searchParams.set("time_range", JSON.stringify({ since: args.start, until: args.end }));
    url.searchParams.set("action_report_time", "impression"); url.searchParams.set("use_unified_attribution_setting", "true");
    for (let page = 0; page < 50; page++) {
      const body = await get(url);
      if (!Array.isArray(body.data)) return failure("INVALID_RESPONSE", "Meta 광고 목록 형식이 올바르지 않습니다.");
      for (const raw of body.data) {
        if (String(raw.account_id) !== accountId || raw.account_currency !== info.currency || !/^\d+$/.test(String(raw.ad_id || "")) || raw.date_start !== raw.date_stop || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date_start || "") || raw.date_start < args.start || raw.date_start > args.end) return failure("INVALID_RESPONSE", "Meta 광고 계정·날짜·통화가 조회 범위와 일치하지 않습니다.");
        try { validateInsightRange(raw.date_start, raw.date_stop); } catch { return failure("INVALID_RESPONSE", "Meta 광고 날짜가 올바르지 않습니다."); }
        const identity = `${raw.date_start}:${raw.ad_id}`;
        if (seen.has(identity)) return failure("INVALID_RESPONSE", "Meta 광고 페이지에 중복 행이 있어 합산하지 않았습니다."); seen.add(identity);
        if (raw.actions !== undefined && !Array.isArray(raw.actions)) return failure("INVALID_RESPONSE", "Meta 전환 수 형식이 올바르지 않습니다.");
        const actions = (raw.actions || []).filter((a: any) => a.action_type === META_LEAD_ACTION);
        if (actions.length > 1) return failure("INVALID_RESPONSE", "Meta 리드 action이 중복되어 합산하지 않았습니다.");
        rows.push({ date: raw.date_start, accountId, adId: String(raw.ad_id), adName: String(raw.ad_name || "").slice(0, 300), campaignId: String(raw.campaign_id || ""), campaignName: String(raw.campaign_name || "").slice(0, 300), adsetId: String(raw.adset_id || ""), adsetName: String(raw.adset_name || "").slice(0, 300), spend: numeric(raw.spend), impressions: numeric(raw.impressions, true), clicks: numeric(raw.clicks, true), metaLeads: actions.length ? numeric(actions[0].value) : 0 });
        if (rows.length > 20_000) return failure("TOO_LARGE", "광고 행이 너무 많습니다. 조회 기간을 줄여주세요.");
      }
      if (!body.paging?.next) return { version: 1, accountId, accountName: String(info.name || accountId).slice(0, 300), currency: info.currency, timezone: info.timezone_name, start: args.start, end: args.end, fetchedAt: new Date().toISOString(), rows };
      let next: URL; try { next = new URL(body.paging.next); } catch { return failure("INVALID_RESPONSE", "Meta 다음 페이지 주소가 올바르지 않습니다."); }
      if (next.origin !== "https://graph.facebook.com" || next.pathname !== url.pathname) return failure("INVALID_RESPONSE", "Meta 다음 페이지 주소가 허용되지 않습니다.");
      const cursor = body.paging?.cursors?.after;
      if (typeof cursor !== "string" || !cursor || cursor.length > 4096 || cursors.has(cursor) || body.data.length === 0) return failure("INVALID_RESPONSE", "Meta 페이지가 반복되거나 불완전합니다.");
      cursors.add(cursor); url.searchParams.set("after", cursor);
      // Reconstruct the URL; never follow provider-supplied tokens, fields or hosts.
    }
    return failure("TOO_LARGE", "Meta 페이지 한도를 초과했습니다. 조회 기간을 줄여주세요.");
  } finally { clearTimeout(timer); args.signal?.removeEventListener("abort", abort); }
}
