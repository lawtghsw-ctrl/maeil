import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { createRelayServer } from "../src/server.mjs";
import { readConfig, DUPLICATE_TTL_MS, DUPLICATE_CAPACITY } from "../src/config.mjs";
import { UpstreamError } from "../src/aligo.mjs";

https.request = () => { throw new Error("LIVE_NETWORK_FORBIDDEN"); };
const env = () => ({ RELAY_BEARER_TOKEN: "offline_test_token_" + "x".repeat(40), ALIGO_API_KEY: "offline-key", ALIGO_USER_ID: "offline-user", ALIGO_SENDER_ALLOWLIST: "0212345678" });
const contact = () => ({ sender: "0212345678", receiver: "01000000000" });
const provider = () => ({ key: "request-secret", userId: "request-user" });
let number = 0;
async function setup(t, options = {}) {
  const config = readConfig({ ...env(), ...options.env });
  const calls = [];
  const server = createRelayServer(config, { sendTest: async (...args) => { calls.push(args); return options.send ? options.send(...args) : { resultCode: 1 }; }, ...(options.now ? { now: options.now } : {}) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  async function request(body = contact(), extra = {}) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const headers = {
      Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", "Idempotency-Key": `offline-request-${String(++number).padStart(6, "0")}`,
      ...(extra.chunked ? {} : { "Content-Length": Buffer.byteLength(raw) }), ...extra.headers,
    };
    for (const name of Object.keys(headers)) if (headers[name] === undefined) delete headers[name];
    return new Promise((resolve, reject) => {
      const outgoing = http.request({ host: "127.0.0.1", port: server.address().port, path: extra.path || "/v1/aligo/test", method: extra.method || "POST", headers }, (response) => {
        const parts = [];
        response.on("data", (part) => parts.push(part));
        response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(parts).toString()), headers: response.headers }));
      });
      outgoing.on("error", reject);
      if (extra.chunked) { outgoing.write(raw.slice(0, 100)); outgoing.end(raw.slice(100)); }
      else outgoing.end(raw);
    });
  }
  return { config, calls, server, request };
}
test("config defaults and mandatory credentials/allowlist fail closed", () => {
  const config = readConfig(env());
  assert.equal(config.host, "127.0.0.1"); assert.equal(config.port, 8787); assert.equal(config.maxConcurrency, 2); assert.equal(config.credentialSource, "server-env");
  for (const name of ["RELAY_BEARER_TOKEN", "ALIGO_API_KEY", "ALIGO_USER_ID", "ALIGO_SENDER_ALLOWLIST"]) assert.throws(() => readConfig({ ...env(), [name]: "" }));
  for (const change of [{ RELAY_BEARER_TOKEN: "short" }, { RELAY_HOST: "0.0.0.0" }, { RELAY_MAX_CONCURRENCY: "5" }, { RELAY_PORT: "0" }, { ALIGO_SENDER_ALLOWLIST: "" }, { ALIGO_SENDER_ALLOWLIST: "0212345678,bad" }, { ALIGO_CREDENTIAL_SOURCE: "other" }]) assert.throws(() => readConfig({ ...env(), ...change }));
  const requestConfig = readConfig({ ...env(), ALIGO_CREDENTIAL_SOURCE: "request", ALIGO_API_KEY: "", ALIGO_USER_ID: "" });
  assert.equal(requestConfig.apiKey, undefined); assert.equal(requestConfig.userId, undefined);
});
test("public health and route/method restrictions expose no credentials", async (t) => {
  const app = await setup(t);
  const health = await app.request("", { method: "GET", path: "/health", headers: { Authorization: undefined } });
  assert.equal(health.status, 200); assert.equal(health.body.mode, "test"); assert.equal(health.body.testMode, true); assert.equal(health.body.actualDelivery, false);
  assert.equal(JSON.stringify(health.body).includes(app.config.token), false);
  assert.equal((await app.request("", { method: "GET" })).status, 405);
  assert.equal((await app.request("", { path: "/v1/aligo/send" })).status, 404);
  assert.equal((await app.request("", { method: "GET", path: "/health?secret=x" })).status, 404);
  assert.equal(app.calls.length, 0);
});
test("authentication precedes JSON parsing and provider use", async (t) => {
  const app = await setup(t);
  for (const token of [undefined, "Bearer wrong", "Basic x", `Bearer ${"x".repeat(64)}`, `Bearer ${app.config.token} extra`]) {
    const result = await app.request("{", { headers: { Authorization: token } });
    assert.equal(result.status, 401); assert.equal(result.body.testMode, true); assert.equal(result.body.actualDelivery, false);
  }
  assert.equal(app.calls.length, 0);
});
test("server-env accepts exactly two contacts and rejects overrides/SSRF/real mode", async (t) => {
  const app = await setup(t);
  const result = await app.request(); assert.equal(result.status, 200); assert.equal(result.body.providerCode, 1); assert.equal(result.body.actualDelivery, false); assert.equal(app.calls[0][2], undefined);
  for (const bad of [null, [], {}, { ...contact(), msg: "custom" }, { ...contact(), testmode_yn: "N" }, { ...contact(), url: "http://169.254.169.254/" }, { ...contact(), provider: provider() }, { ...contact(), receiver: "01000000000,01000000001" }, { ...contact(), receiver: "0212345678" }, { ...contact(), receiver: "01234567890" }, { ...contact(), sender: 212345678 }]) assert.equal((await app.request(bad)).status, 400);
  assert.equal(app.calls.length, 1);
});
test("allowlist, JSON encoding and 4KiB limits", async (t) => {
  const app = await setup(t);
  assert.equal((await app.request({ ...contact(), sender: "0299999999" })).status, 403);
  assert.equal((await app.request(contact(), { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await app.request(contact(), { headers: { "Content-Encoding": "gzip" } })).status, 415);
  assert.equal((await app.request("{")).status, 400);
  assert.equal((await app.request(" ".repeat(4097))).status, 413);
  assert.equal((await app.request(" ".repeat(4097), { chunked: true })).status, 413);
  const raw = JSON.stringify(contact()); assert.equal((await app.request(raw + " ".repeat(4096 - Buffer.byteLength(raw)))).status, 200);
  assert.equal(app.calls.length, 1);
});
test("request mode validates, passes credentials once and never returns them", async (t) => {
  const app = await setup(t, { env: { ALIGO_CREDENTIAL_SOURCE: "request", ALIGO_API_KEY: "", ALIGO_USER_ID: "" } });
  const input = { ...contact(), provider: provider() }, result = await app.request(input);
  assert.equal(result.status, 200); assert.deepEqual(app.calls[0][2], provider());
  assert.equal(JSON.stringify(result).includes(provider().key), false); assert.equal(JSON.stringify(result).includes(provider().userId), false);
  for (const invalid of [undefined, {}, { ...provider(), extra: true }, { key: "", userId: "x" }, { key: "x".repeat(257), userId: "x" }, { key: "bad key", userId: "x" }, { key: "a\nb", userId: "x" }, { key: "a", userId: "bad user" }, { key: "a", userId: "a".repeat(129) }]) assert.equal((await app.request({ ...contact(), ...(invalid === undefined ? {} : { provider: invalid }) })).status, 400);
  assert.equal(app.calls.length, 1);
});
test("idempotency prevents repeats and credentials/recipient changes conflict", async (t) => {
  const app = await setup(t, { env: { ALIGO_CREDENTIAL_SOURCE: "request" } });
  const input = { ...contact(), provider: provider() }, extra = { headers: { "Idempotency-Key": "same-idempotency-key" } };
  assert.equal((await app.request(input, extra)).status, 200);
  assert.equal((await app.request(input, extra)).status, 200);
  assert.equal((await app.request({ ...input, provider: { ...provider(), key: "changed-secret" } }, extra)).status, 409);
  assert.equal((await app.request({ ...input, receiver: "01000000001" }, extra)).status, 409);
  assert.equal(app.calls.length, 1);
  assert.equal((await app.request(input, { headers: { "Idempotency-Key": undefined } })).status, 400);
});
test("concurrency and in-progress duplicate guards never queue extra requests", async (t) => {
  let release, started;
  const wait = new Promise((resolve) => { release = resolve; }), notified = new Promise((resolve) => { started = resolve; });
  const app = await setup(t, { env: { RELAY_MAX_CONCURRENCY: "1" }, send: async () => { started(); await wait; return { resultCode: 1 }; } });
  const extra = { headers: { "Idempotency-Key": "in-progress-request" } };
  const pending = app.request(contact(), extra); await notified;
  assert.equal((await app.request(contact(), extra)).status, 409);
  assert.equal((await app.request()).status, 429); assert.equal(app.calls.length, 1);
  release(); assert.equal((await pending).status, 200);
});
for (const timeout of [false, true]) test(`${timeout ? "timeout" : "ambiguous failure"} is cached without automatic retry or raw messages`, async (t) => {
  const app = await setup(t, { send: async () => { throw timeout ? new UpstreamError("UPSTREAM_TIMEOUT") : new Error("secret phone message must never escape"); } });
  const extra = { headers: { "Idempotency-Key": "unknown-response-key" } };
  const result = await app.request(contact(), extra); assert.equal(result.status, timeout ? 504 : 502); assert.equal(result.body.retryable, false); assert.equal(result.body.error, "UPSTREAM_OUTCOME_UNKNOWN");
  assert.equal(JSON.stringify(result).includes("secret phone"), false); assert.deepEqual((await app.request(contact(), extra)).body, result.body); assert.equal(app.calls.length, 1);
});
test("provider rejection is sanitized and cached", async (t) => {
  const app = await setup(t, { send: async () => ({ resultCode: -101, message: "raw secret" }) });
  const extra = { headers: { "Idempotency-Key": "provider-reject-key" } };
  const result = await app.request(contact(), extra); assert.equal(result.status, 502); assert.equal(result.body.providerCode, -101); assert.equal(result.body.messageId, null);
  assert.equal(JSON.stringify(result).includes("raw secret"), false); await app.request(contact(), extra); assert.equal(app.calls.length, 1);
});
test("duplicate cache TTL is explicit and bounded", async (t) => {
  let time = 1000;
  const app = await setup(t, { now: () => time });
  const extra = { headers: { "Idempotency-Key": "cache-retention-key" } };
  await app.request(contact(), extra); await app.request(contact(), extra); assert.equal(app.calls.length, 1);
  time += DUPLICATE_TTL_MS + 1; await app.request(contact(), extra); assert.equal(app.calls.length, 2);
  for (let index = 1; index < DUPLICATE_CAPACITY; index++) assert.equal((await app.request()).status, 200);
  assert.equal((await app.request()).status, 503);
  assert.equal((await app.request(contact(), extra)).status, 200);
  assert.equal(app.calls.length, DUPLICATE_CAPACITY + 1);
});
