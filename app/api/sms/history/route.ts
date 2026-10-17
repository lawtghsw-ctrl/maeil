import { NextRequest, NextResponse } from "next/server";
import { fail, readJson, requireSmsActor, requireUuid, smsErrorResponse } from "@/lib/sms/delivery";

export const dynamic = "force-dynamic";
// Next 14 can otherwise reuse nested Supabase fetches even in a dynamic GET.
export const revalidate = 0;
export const fetchCache = "force-no-store";
const headers = { "Cache-Control": "private, no-store" };
function errorResponse(error: unknown) {
  const failure = smsErrorResponse(error);
  return NextResponse.json({ error: failure.error }, { status: failure.status, headers });
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireSmsActor(request, request.nextUrl.searchParams.get("lawFirmId"), "sms.view_history");
    const view = request.nextUrl.searchParams.get("view") || "active";
    if (view !== "active" && view !== "deleted") fail(400, "발송내역 보기 항목을 확인해주세요.");
    if (view === "deleted" && !actor.canManage) fail(403, "삭제한 발송내역은 관리자만 확인할 수 있습니다.");
    // Filter archives before LIMIT and join job states in one database call.
    const { data, error } = await actor.admin.rpc("sms_history_read", {
      p_actor_id: actor.actorId, p_law_firm_id: actor.firmId, p_view: view, p_limit: 300,
    });
    if (error || !data || !Array.isArray(data.items)) fail(503, "발송내역을 읽지 못했습니다. 잠시 후 다시 확인해주세요.");
    return NextResponse.json({ items: data.items, canManageHistory: actor.canManage, serverTime: new Date().toISOString() }, { headers });
  } catch (error) { return errorResponse(error); }
}

async function setArchived(request: NextRequest, archived: boolean) {
  try {
    if (!request.headers.get("authorization")?.startsWith("Bearer ")) fail(401, "로그인이 필요합니다.");
    const body = await readJson(request, ["lawFirmId", "ids"], 16 * 1024);
    const actor = await requireSmsActor(request, body.lawFirmId, "sms.view_history");
    if (!actor.canManage) fail(403, "발송내역 삭제와 복구는 관리자만 할 수 있습니다.");
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100) fail(400, "발송내역을 1건 이상 100건 이하로 선택해주세요.");
    const ids = body.ids.map(id => requireUuid(id, "발송내역").toLowerCase());
    if (new Set(ids).size !== ids.length) fail(400, "같은 발송내역이 중복 선택되었습니다.");
    const { data, error } = await actor.admin.rpc("sms_history_set_archived", {
      p_actor_id: actor.actorId, p_law_firm_id: actor.firmId, p_outbox_ids: ids, p_archived: archived,
    });
    if (error) {
      if (/FORBIDDEN|ACTOR|PERMISSION|MANAGER_REQUIRED|ROWS_UNAVAILABLE/.test(error.message || "")) fail(403, "발송내역을 변경할 권한이 없습니다.");
      if (/NOT_FOUND|OUTBOX|INVALID|DUPLICATE|BATCH/.test(error.message || "")) fail(400, "선택한 발송내역을 확인해주세요.");
      fail(503, "발송내역 변경 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.");
    }
    if (!Array.isArray(data) || data.length !== ids.length) fail(503, "발송내역 변경 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.");
    return NextResponse.json({ ok: true, changedCount: data.length, archived }, { headers });
  } catch (error) { return errorResponse(error); }
}

// Hide/restore only. Outbox, jobs and relay duplicate records stay intact.
export async function DELETE(request: NextRequest) { return setArchived(request, true); }
export async function PATCH(request: NextRequest) { return setArchived(request, false); }
