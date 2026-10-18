import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";
import { opsMonth, opsToday, validateOperationCommand } from "@/lib/platform/operations";
import { loadOperations } from "@/lib/platform/operations-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
  if (message === "CONFLICT") return NextResponse.json({ error: "다른 관리자가 수정했습니다. 입력 내용을 보관한 뒤 최신 자료를 확인해주세요." }, { status: 409, headers });
  const result = platformError(error); return NextResponse.json({ error: result.message }, { status: result.status, headers });
}
export async function GET(request: NextRequest) {
  try {
    const { admin } = await requirePlatformUser(request, ["super_admin"]);
    const month = request.nextUrl.searchParams.get("month") ?? opsToday().slice(0, 7);
    const include = request.nextUrl.searchParams.get("includeDemo") ?? "0";
    const offset = request.nextUrl.searchParams.get("ledgerOffset") ?? "0";
    if (!opsMonth(month) || !["0", "1"].includes(include) || !/^(0|[1-9]\d{0,8})$/.test(offset)) throw new Error("조회 조건을 확인해주세요.");
    return NextResponse.json(await loadOperations(admin, month, include === "1", request.signal, new Date(), Number(offset)), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new Error("JSON 입력이 필요합니다.");
    const reader = request.body?.getReader(); if (!reader) throw new Error("입력값이 없습니다.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 131072) { await reader.cancel(); throw new Error("입력 내용이 너무 큽니다."); } chunks.push(value); }
    let input: unknown; try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("JSON 입력을 확인해주세요."); }
    const command = validateOperationCommand(input);
    let snapshot = null;
    if (command.action === "close") {
      const current = await loadOperations(admin, String(command.month), false, request.signal);
      if ((current.month?.revision ?? 0) !== command.expectedRevision) throw new Error("CONFLICT");
      snapshot = current.report;
    }
    const { data, error } = await admin.rpc("platform_operations_command", { p_actor: profile.id, p_command: command, p_snapshot: snapshot });
    if (error) throw new Error(error.code === "40001" ? "CONFLICT" : error.message);
    await writePlatformAudit(admin, request, profile, { action: `operations.${command.action}`, targetType: "platform_operations", targetId: String(command.id ?? command.month ?? ""), lawFirmId: typeof command.law_firm_id === "string" ? command.law_firm_id : null, detail: { action: command.action, month: command.month ?? null } });
    return NextResponse.json({ ok: true, value: data }, { headers });
  } catch (error) { return failure(error); }
}
