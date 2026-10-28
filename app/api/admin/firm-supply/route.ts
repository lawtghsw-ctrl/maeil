import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import { resolvePerformanceFirmId } from "@/lib/performance/firm";
import { firmSupplyRange, readFirmSupply } from "@/lib/firm-reporting-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    const firmId = resolvePerformanceFirmId(profile, request.nextUrl.searchParams.get("firmId"));
    const cumulative = request.nextUrl.searchParams.get("cumulative") === "true";
    const { start, end } = firmSupplyRange(request.nextUrl.searchParams.get("start") || "", request.nextUrl.searchParams.get("end") || "", cumulative);
    return NextResponse.json(await readFirmSupply(admin, firmId, start, end, cumulative), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { const failure = platformError(error); return NextResponse.json({ error: failure.message }, { status: failure.status, headers: { "Cache-Control": "private, no-store" } }); }
}
