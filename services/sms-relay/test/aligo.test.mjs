import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { sendAligoTest, ALIGO_SEND_URL, FIXED_TEST_MESSAGE } from "../src/aligo.mjs";
import { UPSTREAM_TIMEOUT_MS } from "../src/config.mjs";

// No test is allowed to use the real HTTPS transport.
https.request = () => { throw new Error("LIVE_NETWORK_FORBIDDEN"); };
const config = { apiKey: "offline-key", userId: "offline-user" };
function transport({ status = 200, body = '{"result_code":1}', hang = false, error = false } = {}) {
  const calls = [];
  const request = (url, options, callback) => {
    const outgoing = new EventEmitter();
    const response = new PassThrough();
    response.statusCode = status;
    outgoing.destroy = () => { outgoing.destroyed = true; };
    outgoing.end = (sent) => {
      calls.push({ url, options, body: sent, outgoing });
      if (hang) return;
      queueMicrotask(() => {
        if (error) { outgoing.emit("error", new Error("raw provider secret and phone")); return; }
        callback(response);
        if (!response.destroyed) response.end(body);
      });
    };
    return outgoing;
  };
  return { calls, request };
}
test("fixed HTTPS endpoint, forced test flag and fixed SMS text", async () => {
  const fake = transport({ body: '{"result_code":1,"message":"offline-key 01000000000 secret","msg_id":123}' });
  const result = await sendAligoTest(config, "0212345678", "01000000000", fake);
  assert.deepEqual(result, { resultCode: 1 });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0], form = new URLSearchParams(call.body);
  assert.equal(call.url, "https://apis.aligo.in/send/"); assert.equal(call.url, ALIGO_SEND_URL);
  assert.equal(call.options.method, "POST"); assert.equal(form.get("testmode_yn"), "Y");
  assert.equal(form.get("msg"), FIXED_TEST_MESSAGE); assert.equal(form.get("msg_type"), "SMS");
  assert.equal(form.get("key"), config.apiKey); assert.equal(form.get("user_id"), config.userId);
  assert.deepEqual([...form.keys()].sort(), ["key", "msg", "msg_type", "receiver", "sender", "testmode_yn", "user_id"]);
  assert.equal(JSON.stringify(result).includes("offline-key"), false);
});
test("provider rejection exposes numeric code only", async () => {
  const fake = transport({ body: '{"result_code":-101,"message":"echoing a secret"}' });
  assert.deepEqual(await sendAligoTest(config, "0212345678", "01000000000", fake), { resultCode: -101 });
});
test("integer status strings remain compatible without permissive coercion", async () => {
  for (const code of [1, -101, "1", "-101"]) {
    const fake = transport({ body: JSON.stringify({ result_code: code }) });
    assert.deepEqual(await sendAligoTest(config, "0212345678", "01000000000", fake), { resultCode: Number(code) });
  }
  for (const code of ["", " 1", "1 ", null, true, false, 1.5, "1.0", "1e0", "1234567"]) {
    const fake = transport({ body: JSON.stringify({ result_code: code }) });
    await assert.rejects(sendAligoTest(config, "0212345678", "01000000000", fake), (error) => error.code === "UPSTREAM_INVALID_RESPONSE");
  }
});
for (const [name, options, expected] of [
  ["redirect", { status: 302 }, "UPSTREAM_HTTP_ERROR"],
  ["HTTP failure", { status: 500 }, "UPSTREAM_HTTP_ERROR"],
  ["HTML", { body: "<html>secret</html>" }, "UPSTREAM_INVALID_RESPONSE"],
  ["missing status", { body: '{"message":"secret"}' }, "UPSTREAM_INVALID_RESPONSE"],
  ["oversize response", { body: "x".repeat(16 * 1024 + 1) }, "UPSTREAM_INVALID_RESPONSE"],
  ["network failure", { error: true }, "UPSTREAM_NETWORK_ERROR"],
]) test(`${name}: no redirect, raw error or retry`, async () => {
  const fake = transport(options);
  await assert.rejects(sendAligoTest(config, "0212345678", "01000000000", fake), (error) => error.code === expected && !error.message.includes("secret"));
  assert.equal(fake.calls.length, 1); assert.equal(fake.calls[0].outgoing.destroyed, true);
});
test("absolute 10-second deadline aborts once and does not retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = transport({ hang: true });
  const pending = sendAligoTest(config, "0212345678", "01000000000", fake);
  assert.equal(UPSTREAM_TIMEOUT_MS, 10000);
  t.mock.timers.tick(10000);
  await assert.rejects(pending, (error) => error.code === "UPSTREAM_TIMEOUT");
  assert.equal(fake.calls.length, 1); assert.equal(fake.calls[0].outgoing.destroyed, true);
});
