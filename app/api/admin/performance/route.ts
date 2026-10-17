import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import { buildFirmPerformanceReport, performanceRange, resolvePerformanceFirmId } from "@/lib/performance/firm";
import type { CaseRecord, Client, DbLead, Installment } from "@/lib/types";

export const dynamic = "force-dynamic";

type EntityTable = "app_leads" | "app_cases" | "app_clients" | "app_installments";
type AdminClient = Awaited<ReturnType<typeof requirePlatformUser>>["admin"];

// Seek pagination keeps a deterministic unique-key order. Continue until an
// empty response, even if the server's row limit is smaller than our batch size.
async function allFirmRows<T>(admin: AdminClient, table: EntityTable, firmId: string): Promise<T[]> {
  const result: T[] = [];
  let after: string | undefined;
  for (;;) {
    let query = admin.from(table).select("id,data,law_firm_id").eq("law_firm_id", firmId).order("id", { ascending: true }).limit(500);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(`성과 데이터를 읽지 못했습니다. (${table})`);
    const rows = data ?? [];
    if (!rows.length) return result;
    for (const row of rows) {
      if (row.law_firm_id !== firmId) throw new Error("FORBIDDEN");
      result.push({ ...(row.data as object), id: row.id, _lawFirmId: firmId } as T);
    }
    const last = String(rows[rows.length - 1].id);
    if (!last || last === after) throw new Error("성과 데이터 페이지를 확인할 수 없습니다.");
    after = last;
  }
}

async function allFirmStaffNames(admin: AdminClient, firmId: string): Promise<string[]> {
  const names = new Set<string>();
  let after: string | undefined;
  for (;;) {
    let query = admin.from("profiles").select("id,law_firm_id,staff_name,display_name,platform_role")
      .eq("law_firm_id", firmId).eq("is_work_staff", true).order("id", { ascending: true }).limit(500);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error("직원 목록을 읽지 못했습니다.");
    const rows = data ?? [];
    if (!rows.length) return [...names];
    for (const row of rows) {
      if (row.law_firm_id !== firmId) throw new Error("FORBIDDEN");
      const role = row.platform_role || "staff";
      const staffName = String(row.staff_name || row.display_name || "").trim();
      // Inactive staff are retained for historical comparisons. The response
      // exposes names only, never private profile/account fields.
      if ((role === "staff" || role === "firm_admin") && staffName) names.add(staffName);
    }
    const last = String(rows[rows.length - 1].id);
    if (!last || last === after) throw new Error("직원 목록 페이지를 확인할 수 없습니다.");
    after = last;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Preserve legacy role=admin while rejecting ordinary staff explicitly.
    // The shared guard validates the token, active profile and active home firm.
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    const params = request.nextUrl.searchParams;
    const firmId = resolvePerformanceFirmId(profile, params.get("firmId"));
    const { start, end } = performanceRange(params.get("start") || "", params.get("end") || "");
    const { data: firm, error } = await admin.from("law_firms").select("id,name,status").eq("id", firmId).maybeSingle();
    if (error || !firm) throw new Error("NO_FIRM");
    if (profile.platform_role !== "super_admin" && firm.status !== "active") throw new Error("FIRM_SUSPENDED");
    const [leads, cases, clients, installments, staffNames] = await Promise.all([
      allFirmRows<DbLead>(admin, "app_leads", firmId),
      allFirmRows<CaseRecord>(admin, "app_cases", firmId),
      allFirmRows<Client>(admin, "app_clients", firmId),
      allFirmRows<Installment>(admin, "app_installments", firmId),
      allFirmStaffNames(admin, firmId),
    ]);
    const report = buildFirmPerformanceReport({ leads, cases, clients, installments, staffNames }, start, end, { firmId, firmName: firm.name }, params.get("staff") || undefined);
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const failure = platformError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
