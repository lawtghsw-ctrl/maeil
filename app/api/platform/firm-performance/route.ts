import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import { performanceRange } from "@/lib/performance/firm";
import { buildPortfolioFirmSnapshot, isDemoPortfolioFirm, portfolioScope, summarizePortfolioPerformance, type PortfolioFirmIdentity, type PortfolioFirmSnapshot, type PortfolioScope } from "@/lib/performance/portfolio";
import type { CaseRecord, Client, DbLead, Installment } from "@/lib/types";

export const dynamic = "force-dynamic";
type Admin = Awaited<ReturnType<typeof requirePlatformUser>>["admin"];
type EntityTable = "app_leads" | "app_cases" | "app_clients" | "app_installments";

async function readFirms(admin: Admin, scope: PortfolioScope): Promise<PortfolioFirmIdentity[]> {
  const result: PortfolioFirmIdentity[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  for (;;) {
    let query = admin.from("law_firms").select("id,name,status,firm_code").order("id", { ascending: true }).limit(500);
    if (scope === "active") query = query.eq("status", "active");
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error("로펌 목록을 읽지 못했습니다.");
    if (!data?.length) return result;
    for (const row of data) {
      if (typeof row.id !== "string" || !row.id || seen.has(row.id)) throw new Error("로펌 목록 페이지를 확인할 수 없습니다.");
      seen.add(row.id);
      if (scope === "active" && row.status !== "active") throw new Error("로펌 범위가 일치하지 않습니다.");
      result.push({ firmId: row.id, firmName: row.name || "이름 미등록 로펌", status: row.status, isDemo: isDemoPortfolioFirm(row) });
      after = row.id;
    }
  }
}

/** Tenant-scoped keyset pagination also works when IDs repeat across tenants.
 * Read to an empty page; never assume the server row cap equals our limit. */
async function readEntities<T>(admin: Admin, table: EntityTable, firmId: string): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  for (;;) {
    let query = admin.from(table).select("id,data,law_firm_id").eq("law_firm_id", firmId).order("id", { ascending: true }).limit(500);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(`로펌 성과 데이터를 읽지 못했습니다. (${table})`);
    if (!data?.length) return rows;
    for (const row of data) {
      if (row.law_firm_id !== firmId) throw new Error("로펌 데이터 범위가 일치하지 않습니다.");
      if (typeof row.id !== "string" || !row.id || seen.has(row.id)) throw new Error("로펌 성과 데이터 페이지를 확인할 수 없습니다.");
      seen.add(row.id);
      rows.push({ ...(row.data as object), id: row.id, _lawFirmId: firmId } as T);
      after = row.id;
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requirePlatformUser(request, ["super_admin"]);
    const params = request.nextUrl.searchParams;
    const { start, end } = performanceRange(params.get("start") || "", params.get("end") || "");
    const scope = portfolioScope(params.get("scope"));
    const demoParam = params.get("includeDemo");
    if (demoParam !== null && demoParam !== "0" && demoParam !== "1") throw new Error("시연 로펌 포함 여부를 올바르게 선택해주세요.");
    const includeDemo = demoParam === "1";
    const availableFirms = await readFirms(admin, scope);
    const firms = includeDemo ? availableFirms : availableFirms.filter(firm => !firm.isDemo);
    const excludedDemoCount = availableFirms.length - firms.length;
    const now = new Date(), snapshots: PortfolioFirmSnapshot[] = new Array(firms.length);
    let next = 0, stopped = false;
    // Limit parallel tenant reads; only compact aggregate snapshots survive.
    async function worker() {
      try {
        while (!stopped && next < firms.length) {
          const index = next++, firm = firms[index];
          const [leads, cases, clients, installments] = await Promise.all([
            readEntities<DbLead>(admin, "app_leads", firm.firmId), readEntities<CaseRecord>(admin, "app_cases", firm.firmId),
            readEntities<Client>(admin, "app_clients", firm.firmId), readEntities<Installment>(admin, "app_installments", firm.firmId),
          ]);
          snapshots[index] = buildPortfolioFirmSnapshot({ leads, cases, clients, installments }, start, end, firm, now);
        }
      } catch (error) { stopped = true; throw error; }
    }
    await Promise.all(Array.from({ length: Math.min(3, firms.length) }, () => worker()));
    const report = summarizePortfolioPerformance(snapshots, start, end, scope, now, { includeDemo, excludedDemoCount });
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const result = platformError(error);
    return NextResponse.json({ error: result.message }, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
