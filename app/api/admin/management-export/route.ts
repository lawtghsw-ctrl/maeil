import { NextRequest, NextResponse } from "next/server";
import { requirePlatformUser, platformError } from "@/lib/platform/server";
import { kstPerformanceDate, performanceRange, resolvePerformanceFirmId } from "@/lib/performance/firm";
import { isWritingStaff } from "@/lib/writing-staff";

export async function POST(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
    const body = await request.json();
    const manager = profile.platform_role === "super_admin" || profile.platform_role === "firm_admin" || profile.role === "admin";
    let firmId: string;
    let effectiveStaff = String(body.staff || "전체").trim();
    if (manager) firmId = resolvePerformanceFirmId(profile, body.firmId);
    else {
      if (body.kind !== "settlements" || !profile.law_firm_id || body.firmId !== profile.law_firm_id) throw new Error("FORBIDDEN");
      const { data: account, error } = await admin.from("profiles").select("permissions").eq("id", profile.id).single();
      if (isWritingStaff({ ...profile, permissions: account?.permissions })) throw new Error("FORBIDDEN");
      if (error || account?.permissions?.["settlements.export"] !== true || account?.permissions?.["settlements.view"] !== true) throw new Error("FORBIDDEN");
      firmId = profile.law_firm_id;
      effectiveStaff = account.permissions["settlements.view_all"] === true ? effectiveStaff : String(profile.staff_name || profile.display_name || "");
      if (!effectiveStaff) throw new Error("FORBIDDEN");
    }
    if (body.mode !== undefined && !["monthly", "cumulative"].includes(body.mode)) throw new Error("다운로드 기간 구분을 확인해주세요.");
    const start = String(body.start || ""), end = String(body.end || "");
    if (body.mode === "cumulative") {
      if (!manager || body.kind !== "meeting") throw new Error("FORBIDDEN");
      const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && kstPerformanceDate(value) === value;
      if (!validDay(start) || !validDay(end) || start > end) throw new Error("누적 실적 조회기간을 확인해주세요.");
      const months = (Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7))+1;
      if (months > 1200 || end < "1900-01-01" || end > `${new Date().getUTCFullYear()+1}-12-31`) throw new Error("누적 실적 조회기간을 확인해주세요.");
    } else performanceRange(start, end);
    if (!["xlsx", "csv"].includes(body.format) || !["ledger", "meeting", "settlements"].includes(body.kind)) throw new Error("다운로드 종류를 확인해주세요.");
    const staff = effectiveStaff;
    if (staff.length > 100) throw new Error("담당자 이름을 확인해주세요.");
    const { error } = await admin.from("platform_audit_logs").insert({ actor_user_id: profile.id, actor_name: profile.display_name || profile.staff_name || "관리자", actor_role: profile.platform_role, law_firm_id: firmId, action: "management.export_requested", target_type: "management_ledger", target_id: null, detail: { start, end, staff, format: body.format, kind: body.kind, ...(body.mode ? { mode: body.mode } : {}), requestedAt: new Date().toISOString() } });
    if (error) throw new Error("다운로드 기록을 남기지 못했습니다. 다시 시도해주세요.");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { const failure = platformError(error); return NextResponse.json({ error: failure.message }, { status: failure.status }); }
}
