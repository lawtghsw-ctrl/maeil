import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";
import { DemoProvisionError, provisionSalesDemo } from "@/lib/demo/provision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_BODY_BYTES = 2048;

async function readPassword(request: NextRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new DemoProvisionError("JSON 형식으로 요청해주세요.");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new DemoProvisionError("요청 크기가 너무 큽니다.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DemoProvisionError("생성 정보를 입력해주세요.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new DemoProvisionError("요청 크기가 너무 큽니다.", 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof DemoProvisionError) throw error;
    throw new DemoProvisionError("요청 문자 형식을 확인해주세요.");
  }
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new DemoProvisionError("JSON 형식을 확인해주세요."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DemoProvisionError("생성 정보를 확인해주세요.");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || Object.keys(value).some((key) => !["password", "confirmation"].includes(key)) || value.confirmation !== "CREATE_TEST_DEMO") throw new DemoProvisionError("TEST 시연 로펌 생성 확인이 필요합니다.");
  if (typeof value.password !== "string" || value.password.length < 8 || value.password.length > 128) throw new DemoProvisionError("비밀번호는 8~128자로 입력해주세요.");
  return value.password;
}
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: NextRequest) {
  try {
    const { admin, user, profile } = await requirePlatformUser(request, ["super_admin"]);
    const password = await readPassword(request);
    const result = await provisionSalesDemo(admin, user.id, password);
    if (!result.alreadyExists) await writePlatformAudit(admin, request, profile, {
      lawFirmId: result.firmId, action: "firm.demo.create", targetType: "law_firm", targetId: result.firmId,
      detail: { counts: result.counts, loginIds: result.accounts.map((account) => account.loginId) },
    });
    return json(result);
  } catch (error) {
    if (error instanceof DemoProvisionError) return json({ error: error.message }, error.status);
    const normalized = platformError(error);
    return json({ error: normalized.status === 400 ? "시연 로펌 생성 요청을 처리하지 못했습니다." : normalized.message }, normalized.status);
  }
}
