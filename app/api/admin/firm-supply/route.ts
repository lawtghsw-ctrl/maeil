import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import { performanceRange, resolvePerformanceFirmId } from "@/lib/performance/firm";
import { readFirmSupply } from "@/lib/firm-reporting-server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    const firmId = resolvePerformanceFirmId(profile, request.nextUrl.searchParams.get("firmId"));
    const { start, end } = performanceRange(request.nextUrl.searchParams.get("start") || "", request.nextUrl.searchParams.get("end") || "");
    return NextResponse.json(await readFirmSupply(admin, firmId, start, end), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { const failure = platformError(error); return NextResponse.json({ error: failure.message }, { status: failure.status, headers: { "Cache-Control": "private, no-store" } }); }
}
