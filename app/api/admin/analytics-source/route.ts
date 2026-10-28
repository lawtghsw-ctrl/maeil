import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import { resolvePerformanceFirmId } from "@/lib/performance/firm";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 30;

const TABLES = { leads: "app_leads", cases: "app_cases", clients: "app_clients", installments: "app_installments" } as const;
const PAGE_SIZE = 50;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * One bounded transport page, not a transactional/historical database snapshot.
 * Only an empty response proves the end; short pages are not a completion marker.
 */
export async function GET(request: NextRequest) {
  try {
    // The shared guard validates the token and active profile/home firm.
    // resolvePerformanceFirmId additionally rejects ordinary staff, while
    // preserving the application's legacy role=admin manager compatibility.
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    const firmId = resolvePerformanceFirmId(profile, request.nextUrl.searchParams.get("firmId"));
    const entity = request.nextUrl.searchParams.get("entity") || "";
    if (!Object.prototype.hasOwnProperty.call(TABLES, entity)) throw new Error("집계 자료 종류를 확인해주세요.");
    const cursor = request.nextUrl.searchParams.get("after") || null;
    if (cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) throw new Error("집계 자료 페이지를 확인해주세요.");
    const { data: firm, error } = await admin.from("law_firms").select("id,name,status").eq("id", firmId).maybeSingle();
    if (error || !firm || firm.id !== firmId) throw new Error("NO_FIRM");
    if (profile.platform_role !== "super_admin" && firm.status !== "active") throw new Error("FIRM_SUSPENDED");
    const firmName = firm.name;

    const table = TABLES[entity as keyof typeof TABLES];
    let query = admin.from(table).select("id,data,law_firm_id").eq("law_firm_id", firmId).order("id", { ascending: true }).limit(PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const { data: rawRows, error: readError } = await query;
    if (readError || !Array.isArray(rawRows)) throw new Error("전체 집계 자료 페이지를 읽지 못했습니다. 다시 불러와주세요.");
    if (rawRows.length > PAGE_SIZE) throw new Error("전체 집계 자료 페이지 크기를 확인할 수 없습니다.");
    // Text IDs are ordered by PostgreSQL collation, not JavaScript UTF-16 order.
    // Keep database order + gt pagination; validate identity/cycles without re-sorting.
    const pageIds = new Set<string>(cursor ? [cursor] : []);
    const rows = rawRows.map(row => {
        if (row.law_firm_id !== firmId) throw new Error("FORBIDDEN");
        if (typeof row.id !== "string" || !row.id || pageIds.has(row.id)
          || !row.data || typeof row.data !== "object" || Array.isArray(row.data)) {
          throw new Error(`전체 집계 자료를 확인할 수 없습니다. (${table})`);
        }
        pageIds.add(row.id);
        const { id: _id, _lawFirmId: _firmId, _lawFirmName: _firmName, law_firm_id: _legacyFirmId, ...data } = row.data;
        return { ...data, id: row.id, _lawFirmId: firmId, _lawFirmName: firmName };
    });
    const payload = { firmId, entity, cursor, rows, count: rows.length,
      nextCursor: rows.length ? rows[rows.length - 1].id : null, complete: rows.length === 0 };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_RESPONSE_BYTES) {
      return NextResponse.json({ error: "개별 집계 자료가 너무 커서 전체 내용을 불러오지 못했습니다. 자료 크기를 확인해주세요." },
        { status: 413, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const failure = platformError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
