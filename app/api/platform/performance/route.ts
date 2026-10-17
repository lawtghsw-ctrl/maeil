import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import {
  aggregatePlatformPerformance,
  isPerformanceMonth,
  performanceMonthBounds,
  performanceMonthNow,
  performanceMonths,
  type PerformanceFirmRecord,
  type PerformanceLeadRecord,
  type PerformanceLedgerRecord,
  type PerformanceSettingsRecord,
} from "@/lib/performance/platform";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 1000;
// Real DB-GS-UUID IDs are 42 characters; keep PostgREST IN URLs comfortably small.
const LEAD_ID_BATCH_SIZE = 100;
type QueryResult = { data: unknown[] | null; error: { message: string } | null };

async function allRows<T>(page: (from: number, to: number) => PromiseLike<QueryResult>, identity: (row: T) => string): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ;) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    if (batch.length === 0) return rows;
    for (const row of batch) {
      const id = identity(row);
      if (!id || seen.has(id)) throw new Error("조회 중 원장이 변경되었거나 페이지가 반복되었습니다. 다시 조회해주세요.");
      seen.add(id);
    }
    rows.push(...batch);
    // Supabase's configured row limit may be smaller than our requested page.
    offset += batch.length;
    if (!Number.isSafeInteger(offset)) throw new Error("조회 가능한 데이터 범위를 초과했습니다.");
  }
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requirePlatformUser(request, ["super_admin"]);
    const month = request.nextUrl.searchParams.get("month") ?? performanceMonthNow();
    if (!isPerformanceMonth(month)) throw new Error("조회월은 YYYY-MM 형식으로 입력해주세요.");
    const months = performanceMonths(month);
    const start = performanceMonthBounds(months[0]).start;
    const end = performanceMonthBounds(month).end;
    const [firms, settings, ledger] = await Promise.all([
      allRows<PerformanceFirmRecord>((from, to) => admin.from("law_firms")
        .select("id,name,status,billing_type,lead_unit_price,created_at").order("id").range(from, to).abortSignal(request.signal), row => row.id),
      allRows<PerformanceSettingsRecord>((from, to) => admin.from("firm_settings")
        .select("law_firm_id,value").eq("key", "management_analytics_v1").order("law_firm_id").range(from, to).abortSignal(request.signal), row => row.law_firm_id),
      allRows<PerformanceLedgerRecord>((from, to) => admin.from("lead_supply_ledger")
        .select("id,law_firm_id,lead_id,classification,billable,billing_type,unit_price_snapshot,origin,supplied_at")
        .neq("origin", "backfill").gte("supplied_at", start).lt("supplied_at", end)
        .order("supplied_at").order("id").range(from, to).abortSignal(request.signal), row => row.id),
    ]);
    const leadIds = [...new Set(ledger.filter(row => row.classification === "new" || row.classification === "reentry").map(row => row.lead_id).filter((id): id is string => Boolean(id)))];
    const leads: PerformanceLeadRecord[] = [];
    for (let index = 0; index < leadIds.length; index += LEAD_ID_BATCH_SIZE) {
      const ids = leadIds.slice(index, index + LEAD_ID_BATCH_SIZE);
      const batch = await allRows<PerformanceLeadRecord>((from, to) => admin.from("app_leads")
        .select("id,law_firm_id,convertedClientId:data->>convertedClientId,convertedCaseId:data->>convertedCaseId")
        .in("id", ids).order("id").range(from, to).abortSignal(request.signal), row => row.id);
      leads.push(...batch);
    }
    const result = aggregatePlatformPerformance({ month, firms, settings, ledger, leads });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const result = platformError(error);
    return NextResponse.json({ error: result.message }, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
