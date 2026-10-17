import http from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readConfig, validProvider, BODY_LIMIT_BYTES, DUPLICATE_TTL_MS, DUPLICATE_CAPACITY, PHONE_PATTERN, RECEIVER_PATTERN } from "./config.mjs";
import { createAligoSender } from "./aligo.mjs";
import { createLiveHandler } from "./live.mjs";

const BODY_TIMEOUT_MS = 10_000;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function json(response, status, value, headers = {}) {
  if (response.destroyed || response.writableEnded) return;
  const text = JSON.stringify({ ...value, testMode: true, actualDelivery: false });
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers,
  });
  response.end(text);
}
function rejectRequest(request, response, status, code, headers = {}) {
  // Close unconsumed bodies after replying; don't buffer untrusted request data.
  response.setHeader("Connection", "close");
  request.resume();
  json(response, status, { ok: false, mode: "test", error: code, retryable: false }, headers);
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, finished = false;
    const timer = setTimeout(() => finish(new RequestError(408, "BODY_TIMEOUT")), BODY_TIMEOUT_MS);
    timer.unref?.();
    function finish(error, value) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    request.on("data", (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) { finish(new RequestError(413, "BODY_TOO_LARGE")); return; }
      chunks.push(chunk);
    });
    request.on("aborted", () => finish(new RequestError(400, "BODY_ABORTED")));
    request.on("error", () => finish(new RequestError(400, "BODY_INVALID")));
    request.on("end", () => {
      if (finished) return;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        finish(null, JSON.parse(text));
      } catch { finish(new RequestError(400, "BODY_INVALID")); }
    });
  });
}

/** sendTest/now injection is local test scaffolding, never an HTTP or env option. */
export function createRelayServer(config, { sendTest, now = Date.now, sendLive, queryResults, dispatchStore } = {}) {
  const upstream = sendTest ? null : createAligoSender(config);
  const live = createLiveHandler(config, { sendLive, queryResults, dispatchStore });
  const send = sendTest || upstream.send;
  const tokenHash = createHash("sha256").update(config.token).digest();
  const duplicates = new Map();
  let active = 0;
  function authorized(request) {
    const header = request.headers.authorization;
    const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header) : null;
    const candidate = createHash("sha256").update(match?.[1] || "invalid").digest();
    return timingSafeEqual(candidate, tokenHash) && !!match;
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/v1/aligo/send' || request.url === '/v1/aligo/results' || request.url === '/v1/aligo/ready') { await live.handle(request, response); return; }
      if (request.url === "/health") {
        if (request.method !== "GET") { rejectRequest(request, response, 405, "METHOD_NOT_ALLOWED", { Allow: "GET" }); return; }
        json(response, 200, { status: "ok", service: "lawpower-sms-test-relay", mode: "test" }); return;
      }
      if (request.url !== "/v1/aligo/test") { rejectRequest(request, response, 404, "NOT_FOUND"); return; }
      if (request.method !== "POST") { rejectRequest(request, response, 405, "METHOD_NOT_ALLOWED", { Allow: "POST" }); return; }
      if (!authorized(request)) { rejectRequest(request, response, 401, "UNAUTHORIZED", { "WWW-Authenticate": "Bearer" }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "") || request.headers["content-encoding"]) { rejectRequest(request, response, 415, "JSON_REQUIRED"); return; }
      const length = request.headers["content-length"];
      if (length && (!/^[0-9]+$/.test(length) || Number(length) > BODY_LIMIT_BYTES)) { rejectRequest(request, response, 413, "BODY_TOO_LARGE"); return; }
      const requestKey = request.headers["idempotency-key"];
      if (typeof requestKey !== "string" || !IDEMPOTENCY_PATTERN.test(requestKey)) { rejectRequest(request, response, 400, "IDEMPOTENCY_KEY_REQUIRED"); return; }
      const body = await readBody(request);
      const requestCredentials = config.credentialSource === "request";
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== (requestCredentials ? 3 : 2) || !Object.hasOwn(body, "sender") || !Object.hasOwn(body, "receiver") ||
        typeof body.sender !== "string" || typeof body.receiver !== "string" || !PHONE_PATTERN.test(body.sender) || !RECEIVER_PATTERN.test(body.receiver)) {
        rejectRequest(request, response, 400, "INVALID_CONTACT_FIELDS"); return;
      }
      if (requestCredentials && (!Object.hasOwn(body, "provider") || !validProvider(body.provider))) { rejectRequest(request, response, 400, "INVALID_PROVIDER_FIELDS"); return; }
      if (!config.allowedSenders.has(body.sender)) { rejectRequest(request, response, 403, "SENDER_NOT_ALLOWED"); return; }
      const key = createHash("sha256").update(requestKey).digest("hex");
      const providerHash = createHmac("sha256", config.token).update(requestCredentials ? body.provider.key : config.apiKey).update("\0")
        .update(requestCredentials ? body.provider.userId : config.userId).digest("hex");
      const fingerprint = createHmac("sha256", config.token).update(`${body.sender}:${body.receiver}:${providerHash}`).digest("hex");
      for (const [storedKey, value] of duplicates) if (value.expiresAt <= now()) duplicates.delete(storedKey);
      const previous = duplicates.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) { rejectRequest(request, response, 409, "IDEMPOTENCY_KEY_CONFLICT"); return; }
        if (!previous.result) { rejectRequest(request, response, 409, "REQUEST_IN_PROGRESS"); return; }
        json(response, previous.result.status, previous.result.body); return;
      }
      if (active >= config.maxConcurrency) { rejectRequest(request, response, 429, "CONCURRENCY_LIMIT"); return; }
      if (duplicates.size >= DUPLICATE_CAPACITY) { rejectRequest(request, response, 503, "DUPLICATE_GUARD_FULL"); return; }
      const entry = { fingerprint, expiresAt: now() + DUPLICATE_TTL_MS, result: null };
      duplicates.set(key, entry);
      active++;
      try {
        const upstreamResult = await send(body.sender, body.receiver, requestCredentials ? body.provider : undefined);
        if (!Number.isSafeInteger(upstreamResult?.resultCode)) throw new Error("Invalid provider response");
        entry.result = upstreamResult.resultCode > 0
          ? { status: 200, body: { ok: true, mode: "test", upstreamAccepted: true, providerCode: upstreamResult.resultCode, providerMessage: "알리고 테스트 요청이 접수되었습니다.", messageId: null } }
          : { status: 502, body: { ok: false, mode: "test", error: "UPSTREAM_REJECTED", providerCode: upstreamResult.resultCode, providerMessage: "알리고가 테스트 요청을 거절했습니다.", messageId: null, retryable: false } };
      } catch (error) {
        entry.result = {
          status: error?.code === "UPSTREAM_TIMEOUT" ? 504 : 502,
          body: { ok: false, mode: "test", error: "UPSTREAM_OUTCOME_UNKNOWN", retryable: false },
        };
      } finally { active--; }
      json(response, entry.result.status, entry.result.body);
    } catch (error) {
      rejectRequest(request, response, error instanceof RequestError ? error.status : 500, error instanceof RequestError ? error.code : "INTERNAL_ERROR");
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 100;
  server.on("clientError", (_error, socket) => { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); });
  server.on("close", () => { upstream?.close(); live.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (![22, 24].includes(Number(process.versions.node.split(".")[0]))) throw new Error("Use Node.js 22 or 24.");
    const config = readConfig();
    const server = createRelayServer(config);
    server.on("error", () => { console.error("sms-relay: listener failed"); process.exitCode = 1; });
    server.listen(config.port, config.host, () => console.info("sms-relay: listener ready"));
    const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 12_000).unref(); };
    process.on("SIGTERM", stop); process.on("SIGINT", stop);
  } catch { console.error("sms-relay: startup configuration invalid; inspect the required environment variable names in README.md"); process.exitCode = 1; }
}
