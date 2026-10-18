/** Server-only, read-only adapter: no decryption, Graph requests or cache writes. */
import { createHash } from "crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { normalizeAdAccountId } from "./meta-insights";
import { rehabilitationInsightSnapshot } from "./meta-insights-scope";
import { opsBounds, opsDate, opsToday } from "./operations";
export type OperationsMetaCost = { firmId: string; month: string; amount: number | null; source: "meta_actual" | "meta_incomplete" | "meta_ambiguous" };
type Connection = { id: string; law_firm_id: string; ad_account_id: string | null; access_token_ciphertext: string | null };
type Token = { meta_account_id: string; access_token_ciphertext: string };
type Cache = { account_id: string; range_start: string; range_end: string; fingerprint: string; snapshot: any; last_error: string | null };
export function operationMetaCosts(connections: Connection[], tokens: Token[], cache: Cache[], months: string[], graphVersion: string | undefined, now = new Date()): OperationsMetaCost[] {
  const tokenMap = new Map(tokens.map(t => [t.meta_account_id, t.access_token_ciphertext]));
  const accounts = new Map<string, Connection[]>(), invalidFirms = new Set<string>();
  for (const row of [...connections].sort((a, b) => a.id.localeCompare(b.id))) {
    const id = normalizeAdAccountId(row.ad_account_id);
    if (!id) { invalidFirms.add(row.law_firm_id); continue; }
    const members = accounts.get(id) ?? []; members.push(row); accounts.set(id, members);
  }
  const firms = new Set(connections.map(c => c.law_firm_id));
  const today = opsToday(now), currentMonth = today.slice(0, 7);
  return months.flatMap(month => {
    const bounds = opsBounds(month), start = bounds.start, end = month === currentMonth ? today : bounds.end;
    const results = new Map<string, { amount: number; incomplete: boolean; ambiguous: boolean }>([...firms].map(id => [id, { amount: 0, incomplete: invalidFirms.has(id), ambiguous: false }]));
    for (const [id, members] of accounts) {
      const memberFirms = [...new Set(members.map(m => m.law_firm_id))];
      if (memberFirms.length !== 1) { for (const fid of memberFirms) results.get(fid)!.ambiguous = true; continue; }
      // Must match meta-insights GET/POST configuration() exactly, including rotated ciphertext.
      const fingerprint = createHash("sha256").update(JSON.stringify([id, graphVersion, members.map(m => [m.id, tokenMap.get(m.id) || m.access_token_ciphertext])])).digest("hex");
      const row = cache.find(c => c.account_id === id && c.range_start === start && c.range_end === end && c.fingerprint === fingerprint);
      const s = row?.snapshot, result = results.get(memberFirms[0])!;
      const fetched = typeof s?.fetchedAt === "string" ? Date.parse(s.fetchedAt) : NaN;
      // Current month is month-to-date. A past month must have been refreshed after
      // that calendar month ended; a prematurely cached future range is not final.
      const validRefresh = Number.isFinite(fetched) && fetched <= now.getTime() && (month === currentMonth ? opsToday(new Date(fetched)) === today : month < currentMonth && opsToday(new Date(fetched)) > end);
      if (row?.last_error || !s || s.version !== 1 || s.accountId !== id || s.start !== start || s.end !== end || s.currency !== "KRW" || !Array.isArray(s.rows) || !validRefresh) { result.incomplete = true; continue; }
      const seen = new Set<string>(); let rawAmount = 0, valid = true;
      // Validate the complete raw response before filtering. A malformed excluded
      // ad must not turn an incomplete account response into a valid zero cost.
      for (const day of s.rows) {
        const identity = `${day?.date}\0${day?.adId}`;
        if (!day || day.accountId !== id || !opsDate(day.date) || day.date < start || day.date > end || typeof day.adId !== "string" || typeof day.adName !== "string" || !day.adName.trim() || seen.has(identity) || typeof day.spend !== "number" || !Number.isFinite(day.spend) || day.spend < 0) { valid = false; break; }
        seen.add(identity); rawAmount += day.spend;
      }
      if (!valid || !Number.isFinite(rawAmount) || rawAmount > Number.MAX_SAFE_INTEGER) { result.incomplete = true; continue; }
      const amount = rehabilitationInsightSnapshot(s).rows.reduce((total, day) => total + day.spend, 0);
      if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER || result.amount + amount > Number.MAX_SAFE_INTEGER) result.incomplete = true;
      else result.amount += amount;
    }
    return [...results].map(([firmId, value]) => ({ firmId, month, amount: value.ambiguous || value.incomplete ? null : Math.round(value.amount * 1000000) / 1000000, source: value.ambiguous ? "meta_ambiguous" as const : value.incomplete ? "meta_incomplete" as const : "meta_actual" as const }));
  });
}
type Page = <T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, id: (row: T) => string) => Promise<T[]>;
export async function readOperationsMeta(admin: ReturnType<typeof createAdminClient>, months: string[], allRows: Page, signal?: AbortSignal, now = new Date()): Promise<OperationsMetaCost[]> {
  const abort = (q: any) => signal ? q.abortSignal(signal) : q;
  const [connections, tokens, cache] = await Promise.all([
    allRows<Connection>((f, t) => abort(admin.from("firm_meta_accounts").select("id,law_firm_id,ad_account_id,access_token_ciphertext").eq("active", true).order("id").range(f, t)), r => r.id),
    allRows<Token>((f, t) => abort(admin.from("platform_meta_insights_tokens").select("meta_account_id,access_token_ciphertext").order("meta_account_id").range(f, t)), r => r.meta_account_id),
    allRows<Cache>((f, t) => abort(admin.from("platform_meta_insights_cache").select("account_id,range_start,range_end,fingerprint,snapshot,last_error").gte("range_start", months[0] + "-01").lte("range_end", opsBounds(months[months.length - 1]).end).order("account_id").order("range_start").order("range_end").order("fingerprint").range(f, t)), r => `${r.account_id}\0${r.range_start}\0${r.range_end}\0${r.fingerprint}`),
  ]);
  return operationMetaCosts(connections, tokens, cache, months, process.env.META_GRAPH_API_VERSION, now);
}
