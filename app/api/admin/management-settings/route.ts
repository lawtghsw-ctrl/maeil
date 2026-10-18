import { NextRequest, NextResponse } from "next/server";
import { writePlatformAudit, requirePlatformUser } from "@/lib/platform/server";
import { firmVisibleSettings, mergeFirmSettings, assertSettingsRevision } from "@/lib/management-access";
import { readFirmRows, readFirmSupply } from "@/lib/firm-reporting-server";
import { actualPayment, isValidRetainer } from "@/lib/firm-reporting";
import { inDateRange, laborCostForRange, paymentFeesForRange, fixedCostForRange } from "@/lib/management-core";
import type { CaseRecord, Installment } from "@/lib/types";

const KEY = "management_analytics_v1";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function requireManager(request: NextRequest) {
  const result = await requirePlatformUser(request, ["super_admin", "firm_admin", "staff"]);
  if (result.profile.platform_role !== "super_admin" && result.profile.platform_role !== "firm_admin" && result.profile.role !== "admin") throw new Error("FORBIDDEN");
  return result;
}

function resolveFirmId(
  profile: { platform_role?: string | null; law_firm_id?: string | null },
  requested?: unknown,
) {
  const requestedFirmId = String(requested || "").trim();
  if (profile.platform_role === "super_admin") return requestedFirmId || null;
  if (!profile.law_firm_id) throw new Error("NO_FIRM");
  if (requestedFirmId && requestedFirmId !== profile.law_firm_id) throw new Error("FORBIDDEN");
  return String(profile.law_firm_id);
}

function fail(error: unknown) {
  const raw = error as { message?: string; code?: string; details?: string; hint?: string };
  const message = raw?.message || "정산설정 요청 처리 중 오류가 발생했습니다.";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "정산설정 관리 권한이 없습니다." }, { status: 403 });
  if (message === "FIRM_SUSPENDED") return NextResponse.json({ error: "현재 이용이 중지된 로펌입니다." }, { status: 403 });
  if (message === "NO_FIRM") return NextResponse.json({ error: "소속 로펌 정보를 확인할 수 없습니다." }, { status: 403 });
  const detail = [raw?.code, raw?.details, raw?.hint].filter(Boolean).join(" · ");
  return NextResponse.json({ error: detail ? `${message} (${detail})` : message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requireManager(request);
    const firmId = resolveFirmId(profile, request.nextUrl.searchParams.get("firmId"));

    let query = admin.from("firm_settings").select("law_firm_id,value,updated_at").eq("key", KEY);
    if (firmId) query = query.eq("law_firm_id", firmId);
    else if (profile.platform_role !== "super_admin") throw new Error("NO_FIRM");

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ rows: (data ?? []).map(row => ({ ...row, value: firmVisibleSettings(row.value) })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, user, profile } = await requireManager(request);
    const body = await request.json().catch(() => ({}));
    const firmId = resolveFirmId(profile, body?.firmId);
    if (!firmId) throw new Error("대상 로펌을 선택해주세요.");
    if (!body?.value || typeof body.value !== "object" || Array.isArray(body.value)) {
      throw new Error("저장할 정산설정 값이 없습니다.");
    }

    const { data: firm, error: firmError } = await admin
      .from("law_firms")
      .select("id,name,status")
      .eq("id", firmId)
      .maybeSingle();
    if (firmError) throw firmError;
    if (!firm) throw new Error("대상 로펌을 찾을 수 없습니다.");
    if (firm.status !== "active" && profile.platform_role !== "super_admin") {
      throw new Error("현재 이용이 중지된 로펌입니다.");
    }

    const { data: current, error: currentError } = await admin.from("firm_settings").select("value,updated_at").eq("law_firm_id", firmId).eq("key", KEY).maybeSingle();
    if (currentError) throw currentError;
    assertSettingsRevision(current?.updated_at ?? null, body.expectedUpdatedAt);
    const next = mergeFirmSettings(current?.value, body.value);
    const previousClosings = (current?.value as { monthClosings?: Record<string, unknown> } | undefined)?.monthClosings ?? {};
    for (const [month, closing] of Object.entries(next.monthClosings)) {
      if (previousClosings[month]) continue;
      const start = `${month}-01`;
      const [year, number] = month.split("-").map(Number);
      const end = `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}`;
      const [caseRows, paymentRows, supply] = await Promise.all([
        readFirmRows(admin, "app_cases", firmId, "id,law_firm_id,data"),
        readFirmRows(admin, "app_installments", firmId, "id,law_firm_id,data"),
        readFirmSupply(admin, firmId, start, end),
      ]);
      if (supply.purchaseCost === null) throw new Error("공급 단가가 미확정인 자료가 있어 월마감할 수 없습니다.");
      const cases = caseRows.map(row => ({ ...row.data, id: row.id } as CaseRecord));
      const installments = paymentRows.map(row => ({ ...row.data, id: row.id } as Installment));
      const ids = new Set(cases.map(row => row.id));
      const rangeCases = cases.filter(row => inDateRange(row.contractDate, start, end) && isValidRetainer(row));
      closing.closedBy = user.id;
      closing.totals = { contractCount: rangeCases.length, contractSales: rangeCases.reduce((sum, row) => sum + row.contractAmount, 0), cashSales: installments.filter(row => ids.has(row.caseId) && row.status === "완료" && inDateRange(row.paidDate, start, end)).reduce((sum, row) => sum + actualPayment(row), 0), purchaseCost: supply.purchaseCost, laborCost: laborCostForRange(cases, installments, next, start, end), paymentFees: paymentFeesForRange(cases, installments, next, start, end), fixedCost: fixedCostForRange(next, start, end) };
    }
    const payload = {
      law_firm_id: firmId,
      key: KEY,
      value: next,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const write = current
      ? admin.from("firm_settings").update(payload).eq("law_firm_id", firmId).eq("key", KEY).eq("updated_at", current.updated_at)
      : admin.from("firm_settings").insert(payload);
    const { data, error } = await write.select("law_firm_id,value,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("다른 관리자가 설정을 변경했습니다. 새로고침 후 다시 저장해주세요.");

    await writePlatformAudit(admin, request, profile, {
      lawFirmId: firmId,
      action: "management_settings.update",
      targetType: "firm_settings",
      targetId: KEY,
      detail: { key: KEY, firmName: firm.name, updatedAt: data?.updated_at ?? payload.updated_at },
    });

    return NextResponse.json({ ok: true, value: firmVisibleSettings(data.value), updatedAt: data?.updated_at ?? payload.updated_at });
  } catch (error) {
    return fail(error);
  }
}

export const POST = PATCH;
