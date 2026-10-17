import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { ALIGO_SEND_URL, UpstreamError } from './aligo.mjs';
import { UPSTREAM_TIMEOUT_MS, LIVE_RECEIVER_PATTERN } from './config.mjs';

export const ALIGO_RESULTS_URL = 'https://apis.aligo.in/sms_list/';
const RESPONSE_LIMIT_BYTES = 32 * 1024;
export function parseResultCode(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d{1,6}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number)) throw new UpstreamError('UPSTREAM_INVALID_RESPONSE');
  return number;
}
export function validMessageId(value) {
  return (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value));
}
function post(url, body, contentType, { request = https.request, agent } = {}) {
  return new Promise((resolve, reject) => {
    let done = false, outgoing, incoming;
    const timer = setTimeout(() => fail('UPSTREAM_TIMEOUT'), UPSTREAM_TIMEOUT_MS);
    timer.unref?.();
    function fail(code) {
      if (done) return;
      done = true; clearTimeout(timer); reject(new UpstreamError(code)); incoming?.destroy(); outgoing?.destroy();
    }
    try {
      outgoing = request(url, { method: 'POST', agent, headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' } }, response => {
        incoming = response;
        if (response.statusCode !== 200) { fail('UPSTREAM_HTTP_ERROR'); return; }
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > RESPONSE_LIMIT_BYTES) { fail('UPSTREAM_INVALID_RESPONSE'); return; }
          if (!done) chunks.push(chunk);
        });
        response.on('error', () => fail('UPSTREAM_NETWORK_ERROR'));
        response.on('aborted', () => fail('UPSTREAM_NETWORK_ERROR'));
        response.on('end', () => {
          if (done) return;
          try {
            const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
            const resultCode = parseResultCode(payload.result_code);
            done = true; clearTimeout(timer); resolve({ payload, resultCode });
          } catch { fail('UPSTREAM_INVALID_RESPONSE'); }
        });
      });
      outgoing.on('error', () => fail('UPSTREAM_NETWORK_ERROR'));
      outgoing.end(body);
    } catch { fail('UPSTREAM_NETWORK_ERROR'); }
  });
}
function sendBody(body) {
  const fields = { key: body.provider.key, user_id: body.provider.userId, sender: body.sender, receiver: body.receiver,
    msg: body.message, msg_type: body.msgType, testmode_yn: 'N' };
  if (body.title) fields.title = body.title;
  if (!body.images.length) return { body: new URLSearchParams(fields).toString(), contentType: 'application/x-www-form-urlencoded; charset=utf-8' };
  const boundary = `lawpower-${randomBytes(24).toString('hex')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  body.images.forEach((image, index) => {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image${index + 1}"; filename="${image.filename}"\r\nContent-Type: ${image.contentType}\r\n\r\n`));
    chunks.push(image.bytes, Buffer.from('\r\n'));
  });
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
/** These functions only receive already-validated requests; no runtime URL option. */
export async function sendAligoLive(body, transport) {
  const encoded = sendBody(body);
  const { resultCode, payload } = await post(ALIGO_SEND_URL, encoded.body, encoded.contentType, transport);
  if (resultCode <= 0) return { resultCode, messageId: null };
  if (!validMessageId(payload.msg_id)) throw new UpstreamError('UPSTREAM_INVALID_RESPONSE');
  return { resultCode, messageId: String(payload.msg_id) };
}
export async function queryAligoResult(provider, messageId, receiverHash, hashReceiver, transport) {
  if (!validMessageId(messageId)) throw new UpstreamError('UPSTREAM_INVALID_RESPONSE');
  const body = new URLSearchParams({ key: provider.key, user_id: provider.userId, mid: String(messageId), page: '1', page_size: '10' }).toString();
  const { payload, resultCode } = await post(ALIGO_RESULTS_URL, body, 'application/x-www-form-urlencoded; charset=utf-8', transport);
  // Only documented states are terminal. Unknown strings, conflicting records,
  // pagination or a recipient mismatch must not become a delivery confirmation.
  if (resultCode <= 0 || !Array.isArray(payload.list) || payload.list.length !== 1 || payload.next_yn === 'Y') return { resultCode, state: 'unknown' };
  const entry = payload.list[0];
  if (!entry || typeof entry.receiver !== 'string' || !LIVE_RECEIVER_PATTERN.test(entry.receiver) || hashReceiver(entry.receiver) !== receiverHash) return { resultCode, state: 'unknown' };
  const states = new Map([['발송완료', 'delivered'], ['가입자없음', 'failed'], ['전송중', 'pending']]);
  const state = states.get(entry.sms_state) || 'unknown';
  return { resultCode, state };
}
export function createLiveTransport(config) {
  const agent = new https.Agent({ keepAlive: true, maxSockets: config.maxConcurrency, maxFreeSockets: 1 });
  return {
    send: body => sendAligoLive(body, { agent }),
    results: (provider, messageId, receiverHash, hashReceiver) => queryAligoResult(provider, messageId, receiverHash, hashReceiver, { agent }),
    close: () => agent.destroy(),
  };
}
