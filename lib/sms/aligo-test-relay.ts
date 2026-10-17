import { randomUUID } from "node:crypto";

type AligoTestResponse = {
  ok: boolean;
  testMode: true;
  actualDelivery: false;
  providerCode: number | null;
  providerMessage: string;
  messageId: number | string | null;
};

export class AligoTestRelayError extends Error {
  constructor(message: string, readonly status: 502 | 503) {
    super(message);
    this.name = "AligoTestRelayError";
  }
}

function relayEndpoint(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/v1/aligo/test") {
      throw new Error("Invalid test relay endpoint");
    }
    return url.href;
  } catch {
    throw new AligoTestRelayError("알리고 중계 서버 설정이 올바르지 않습니다.", 503);
  }
}

function connectionError(): AligoTestRelayError {
  return new AligoTestRelayError("알리고 중계 서버 연결에 실패했습니다.", 502);
}

/** Test-only transport. It never reads or writes the outbox and never falls back to Aligo directly. */
export async function requestAligoTest(sender: string, receiver: string): Promise<AligoTestResponse> {
  const endpoint = process.env.ALIGO_RELAY_URL;
  const token = process.env.ALIGO_RELAY_TOKEN;
  const key = process.env.ALIGO_API_KEY;
  const userId = process.env.ALIGO_USER_ID;
  if (process.env.ALIGO_TEST_MODE !== "true") {
    throw new AligoTestRelayError("알리고 테스트 모드가 설정되지 않았습니다.", 503);
  }
  if (!key || !userId) throw new AligoTestRelayError("알리고 환경변수가 없습니다.", 503);
  if (!endpoint || !token) throw new AligoTestRelayError("알리고 중계 서버 환경변수가 없습니다.", 503);
  if (!/^[\x21-\x7e]+$/.test(token)) {
    throw new AligoTestRelayError("알리고 중계 서버 설정이 올바르지 않습니다.", 503);
  }
  const url = relayEndpoint(endpoint);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ sender, receiver, provider: { key, userId } }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw connectionError();
    const result = data as Record<string, unknown>;
    // A successful HTTP response alone cannot prove this was the test-only endpoint.
    if (result.testMode !== true || result.actualDelivery !== false || typeof result.ok !== "boolean") throw connectionError();
    if (result.providerCode !== null && (typeof result.providerCode !== "number" || !Number.isFinite(result.providerCode))) throw connectionError();
    if (typeof result.providerMessage !== "string") throw connectionError();
    if (result.messageId !== null && typeof result.messageId !== "string" && (typeof result.messageId !== "number" || !Number.isFinite(result.messageId))) throw connectionError();
    if (result.ok && (!response.ok || result.providerCode === null || Number(result.providerCode) <= 0)) throw connectionError();
    return {
      ok: response.ok && result.ok,
      testMode: true,
      actualDelivery: false,
      providerCode: result.providerCode as number | null,
      providerMessage: result.providerMessage,
      messageId: result.messageId as number | string | null,
    };
  } catch {
    // Do not expose upstream bodies or errors: they may contain submitted credentials.
    throw connectionError();
  }
}
