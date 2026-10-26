import { createHash } from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { parseLoginIdentifier } from "@/lib/auth/login-identifier";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const headers = { "Cache-Control": "private, no-store" };
const invalidCredentials = "아이디 또는 이메일과 비밀번호를 확인해주세요. 아이디가 중복되는 경우 전체 이메일로 로그인해주세요.";
const unavailable = "로그인을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
const tooManyAttempts = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.";

class RequestError extends Error {
  constructor(readonly status: number) { super("INVALID_LOGIN_REQUEST"); }
}

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers });
}

async function readCredentials(request: NextRequest) {
  const origin = request.headers.get("origin");
  if ((origin !== null && origin !== request.nextUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RequestError(403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError(415);
  }
  if (Number(request.headers.get("content-length") ?? 0) > 8192) throw new RequestError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new RequestError(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RequestError(400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "identifier" && key !== "password") ||
      typeof input.identifier !== "string" || input.identifier.length > 320 ||
      typeof input.password !== "string" || input.password.length === 0 || input.password.length > 4096) {
    throw new RequestError(400);
  }
  try { return { identifier: parseLoginIdentifier(input.identifier), password: input.password }; }
  catch { throw new RequestError(400); }
}

function hash(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }

/** Resolves an ID privately, then uses ordinary password authentication for that account. */
export async function POST(request: NextRequest) {
  try {
    const { identifier, password } = await readCredentials(request);
    const admin = createAdminClient();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
    const normalizedIdentifier = identifier.value.toLowerCase();
    const limits = await Promise.all([
      admin.rpc("consume_public_rate_limit", { p_scope: "login_ip", p_key_hash: hash(`login-ip:${ip}`), p_limit: 60, p_window_seconds: 900 }),
      admin.rpc("consume_public_rate_limit", { p_scope: "login_identifier", p_key_hash: hash(JSON.stringify(["login-identifier", ip, normalizedIdentifier])), p_limit: 12, p_window_seconds: 900 }),
    ]);
    if (limits.some(result => result.error || typeof result.data !== "boolean")) return reply({ error: unavailable }, 503);
    if (limits.some(result => result.data !== true)) return reply({ error: tooManyAttempts }, 429);

    let email = identifier.value;
    let expectedId: string | undefined;
    if (identifier.kind === "id") {
      const { data, error } = await admin.rpc("resolve_login_identifier", { p_identifier: identifier.value });
      if (error) return reply({ error: unavailable }, 503);
      if (!Array.isArray(data)) return reply({ error: unavailable }, 503);
      if (data.length !== 1) return reply({ error: invalidCredentials }, 401);
      const candidate = data[0];
      if (typeof candidate?.id !== "string" || !candidate.id || typeof candidate.email !== "string" ||
          candidate.email.split("@").length !== 2 || candidate.email.split("@")[0].toLowerCase() !== normalizedIdentifier) {
        return reply({ error: unavailable }, 503);
      }
      expectedId = candidate.id;
      email = candidate.email;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !publicKey) return reply({ error: unavailable }, 503);
    // A new client per request prevents another login's session from replacing this one.
    const client = createSupabaseClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return reply({ error: error.status === 429 ? tooManyAttempts : invalidCredentials }, error.status === 429 ? 429 : 401);
    let accepted = false;
    try {
      const user = data.user;
      const session = data.session;
      if (!user || (expectedId && user.id !== expectedId) || !session?.access_token || !session.refresh_token) {
        return reply({ error: invalidCredentials }, 401);
      }
      const { data: profile, error: profileError } = await client.from("profiles").select("id,is_active").eq("id", user.id).maybeSingle();
      if (profileError || !profile || profile.id !== user.id || profile.is_active !== true) return reply({ error: invalidCredentials }, 401);
      const { data: active, error: activeError } = await client.rpc("is_active_user");
      if (activeError || active !== true) return reply({ error: invalidCredentials }, 401);
      const response = reply({ session: { access_token: session.access_token, refresh_token: session.refresh_token } });
      accepted = true;
      return response;
    } finally {
      if (!accepted) {
        // Revoke only the session created by this failed attempt, never other devices.
        try { await client.auth.signOut({ scope: "local" }); } catch { /* No credentials or provider errors are logged. */ }
      }
    }
  } catch (error) {
    if (error instanceof RequestError) return reply({ error: "로그인 요청을 확인해주세요." }, error.status);
    return reply({ error: unavailable }, 503);
  }
}
