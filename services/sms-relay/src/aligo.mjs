import https from "node:https";
import { UPSTREAM_TIMEOUT_MS } from "./config.mjs";

export const ALIGO_SEND_URL = "https://apis.aligo.in/send/";
export const FIXED_TEST_MESSAGE = "[로파워] API 연결 테스트입니다. 실제 발송되지 않습니다.";
const RESPONSE_LIMIT_BYTES = 16 * 1024;

export class UpstreamError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Transport injection is for offline tests only; the runtime has no URL override. */
export function sendAligoTest(config, sender, receiver, { request = https.request, agent } = {}) {
  const body = new URLSearchParams({
    key: config.apiKey, user_id: config.userId, sender, receiver,
    msg: FIXED_TEST_MESSAGE, msg_type: "SMS", testmode_yn: "Y",
  }).toString();
  return new Promise((resolve, reject) => {
    let finished = false, upstream, response, timer;
    function fail(code) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      reject(new UpstreamError(code));
      response?.destroy(); upstream?.destroy();
    }
    // An absolute deadline includes DNS, TLS, headers and the response body.
    timer = setTimeout(() => fail("UPSTREAM_TIMEOUT"), UPSTREAM_TIMEOUT_MS);
    timer.unref?.();
    try {
      upstream = request(ALIGO_SEND_URL, {
        method: "POST", agent,
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8", "Content-Length": Buffer.byteLength(body), Accept: "application/json" },
      }, (incoming) => {
        response = incoming;
        // Native https does not follow redirects. Any unexpected HTTP status is
        // ambiguous; never forward a Location or provider error text to callers.
        if (incoming.statusCode !== 200) { fail("UPSTREAM_HTTP_ERROR"); return; }
        const chunks = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          if (size > RESPONSE_LIMIT_BYTES) { fail("UPSTREAM_INVALID_RESPONSE"); return; }
          chunks.push(chunk);
        });
        incoming.on("error", () => fail("UPSTREAM_NETWORK_ERROR"));
        incoming.on("aborted", () => fail("UPSTREAM_NETWORK_ERROR"));
        incoming.on("end", () => {
          if (finished) return;
          let payload;
          try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { fail("UPSTREAM_INVALID_RESPONSE"); return; }
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) { fail("UPSTREAM_INVALID_RESPONSE"); return; }
          const rawCode = payload.result_code;
          const resultCode = typeof rawCode === "number" ? rawCode : typeof rawCode === "string" && /^-?\d{1,6}$/.test(rawCode) ? Number(rawCode) : NaN;
          if (!Number.isSafeInteger(resultCode)) { fail("UPSTREAM_INVALID_RESPONSE"); return; }
          finished = true; clearTimeout(timer);
          // Only numeric status is returned. Provider text can echo secrets,
          // message content or contacts and must never leave this boundary.
          resolve({ resultCode });
        });
      });
      upstream.on("error", () => fail("UPSTREAM_NETWORK_ERROR"));
      upstream.end(body);
    } catch { fail("UPSTREAM_NETWORK_ERROR"); }
  });
}

export function createAligoSender(config) {
  const agent = new https.Agent({ keepAlive: true, maxSockets: config.maxConcurrency, maxFreeSockets: 1 });
  return {
    send: (sender, receiver, provider) => sendAligoTest(provider ? { apiKey: provider.key, userId: provider.userId } : config, sender, receiver, { agent }),
    close: () => agent.destroy(),
  };
}
