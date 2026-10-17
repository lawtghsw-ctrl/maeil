import { createHash, timingSafeEqual } from 'node:crypto';
import { validProvider, PHONE_PATTERN, LIVE_RECEIVER_PATTERN } from './config.mjs';
import { LIVE_BODY_LIMIT_BYTES, UUID_PATTERN, ValidationError, validateMessage, validateImages } from './validation.mjs';
import { DispatchStore, unknownOutcome } from './dispatch-store.mjs';
import { createLiveTransport, validMessageId } from './aligo-live.mjs';

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const value = JSON.stringify({ ...body, testMode: false, retryable: false });
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(value), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(value);
}
function error(request, response, status, code) {
  response.setHeader('Connection', 'close'); request.resume();
  json(response, status, { ok: false, actualDelivery: false, error: code, state: 'rejected', providerCode: null, providerMessage: '발송 요청을 처리할 수 없습니다.', messageId: null });
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, finished = false;
    const timer = setTimeout(() => finish(new HttpError(408, 'BODY_TIMEOUT')), 10_000); timer.unref?.();
    function finish(error, value) { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(value); }
    request.on('data', chunk => {
      if (finished) return;
      size += chunk.length;
      if (size > LIVE_BODY_LIMIT_BYTES) { finish(new HttpError(413, 'BODY_TOO_LARGE')); return; }
      chunks.push(chunk);
    });
    request.on('error', () => finish(new HttpError(400, 'BODY_INVALID')));
    request.on('aborted', () => finish(new HttpError(400, 'BODY_ABORTED')));
    request.on('end', () => {
      if (finished) return;
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { finish(new HttpError(400, 'BODY_INVALID')); }
    });
  });
}
function validateBase(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key)) ||
      typeof body.dispatchId !== 'string' || !UUID_PATTERN.test(body.dispatchId) || typeof body.approvalEpoch !== 'string' || !UUID_PATTERN.test(body.approvalEpoch) || !validProvider(body.provider)) throw new ValidationError('INVALID_REQUEST');
  return { ...body, dispatchId: body.dispatchId.toLowerCase(), approvalEpoch: body.approvalEpoch.toLowerCase() };
}
function validateSend(body, config) {
  const value = validateBase(body, ['dispatchId', 'approvalEpoch', 'sender', 'receiver', 'message', 'msgType', 'title', 'images', 'provider']);
  if (typeof value.sender !== 'string' || !PHONE_PATTERN.test(value.sender) || typeof value.receiver !== 'string' || !LIVE_RECEIVER_PATTERN.test(value.receiver)) throw new ValidationError('INVALID_CONTACT_FIELDS');
  if (!config.allowedSenders.has(value.sender)) throw new HttpError(403, 'SENDER_NOT_ALLOWED');
  validateMessage(value.message, value.msgType, value.title);
  return { ...value, title: value.title || '', images: validateImages(value.images, value.msgType) };
}
function deliveryOutcome(row, result) {
  const state = ['delivered', 'failed', 'pending', 'unknown'].includes(result?.state) && Number.isSafeInteger(result?.resultCode) && result.resultCode > 0 ? result.state : 'unknown';
  const messages = { delivered: '알리고에서 수신자 전달 완료를 확인했습니다.', failed: '알리고에서 수신자 전달 실패를 확인했습니다.', pending: '알리고에서 전달 결과를 확인 중입니다.', unknown: '전달 결과를 확인할 수 없습니다. 같은 요청은 다시 발송하지 않습니다.' };
  return { status: 200, body: { ok: ['delivered', 'pending'].includes(state), actualDelivery: state === 'delivered' ? true : state === 'failed' ? false : null,
    dispatchId: row.dispatch_id, state, providerCode: Number.isSafeInteger(result?.resultCode) ? result.resultCode : null,
    providerMessage: messages[state], messageId: row.message_id, testMode: false, retryable: false } };
}

/** Dependency injection is local test scaffolding, never an HTTP/env option. */
export function createLiveHandler(config, { sendLive, queryResults, dispatchStore } = {}) {
  if (!config.live?.enabled) return { handle: async (request, response) => error(request, response, 404, 'LIVE_DISABLED'), close() {} };
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('LIVE_REQUIRES_NODE_24');
  const store = dispatchStore || new DispatchStore(config.live.dbPath);
  const transport = !sendLive || !queryResults ? createLiveTransport(config) : null;
  const send = sendLive || transport.send, results = queryResults || transport.results;
  const tokenHash = createHash('sha256').update(config.live.token).digest();
  let active = 0;
  return {
    async handle(request, response) {
      try {
        const isReady = request.url === '/v1/aligo/ready';
        if (request.method !== (isReady ? 'GET' : 'POST')) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const authorization = typeof request.headers.authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.authorization) : null;
        const candidate = createHash('sha256').update(authorization?.[1] || 'invalid').digest();
        if (!timingSafeEqual(candidate, tokenHash) || !authorization) throw new HttpError(401, 'UNAUTHORIZED');
        if (isReady) {
          if (!config.allowedSenders.size || !store.checkReady()) throw new Error('STATE_UNAVAILABLE');
          json(response, 200, { ready: true, approvalEpoch: config.live.approvalEpoch }); return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '') || request.headers['content-encoding']) throw new HttpError(415, 'JSON_REQUIRED');
        const length = request.headers['content-length'];
        if (length && (!/^\d+$/.test(length) || Number(length) > LIVE_BODY_LIMIT_BYTES)) throw new HttpError(413, 'BODY_TOO_LARGE');
        const raw = await readBody(request);
        if (request.url === '/v1/aligo/results') {
          const body = validateBase(raw, ['dispatchId', 'approvalEpoch', 'provider']);
          const row = store.get(body.dispatchId);
          if (!row) throw new HttpError(404, 'DISPATCH_NOT_FOUND');
          if (row.approval_epoch !== body.approvalEpoch || row.provider_hash !== store.providerHash(body.provider)) throw new HttpError(409, 'DISPATCH_CONFLICT');
          if (!row.message_id || ['delivered', 'failed', 'rejected'].includes(row.state)) { const saved = store.outcome(row); json(response, saved.status, saved.body); return; }
          if (active >= config.maxConcurrency) throw new HttpError(429, 'CONCURRENCY_LIMIT');
          active++;
          let result;
          try { result = await results(body.provider, row.message_id, row.receiver_hash, receiver => store.receiverHash(receiver)); }
          catch { result = { resultCode: null, state: 'unknown' }; }
          finally { active--; }
          const saved = store.recordDelivery(row, deliveryOutcome(row, result));
          json(response, saved.status, saved.body); return;
        }
        const body = validateSend(raw, config);
        const fingerprint = store.fingerprint(body);
        const previous = store.get(body.dispatchId);
        if (previous) {
          if (previous.payload_hash !== fingerprint) throw new HttpError(409, 'DISPATCH_CONFLICT');
          const saved = store.outcome(previous); json(response, saved.status, saved.body); return;
        }
        if (body.approvalEpoch !== config.live.approvalEpoch) throw new HttpError(403, 'APPROVAL_EPOCH_MISMATCH');
        if (!config.live.allowAllReceivers && !config.live.allowedReceivers.has(body.receiver)) throw new HttpError(403, 'RECEIVER_NOT_ALLOWED');
        if (active >= config.maxConcurrency) throw new HttpError(429, 'CONCURRENCY_LIMIT');
        const claim = store.claim(body, fingerprint);
        if (!claim.created) {
          if (claim.row.payload_hash !== fingerprint) throw new HttpError(409, 'DISPATCH_CONFLICT');
          const saved = store.outcome(claim.row); json(response, saved.status, saved.body); return;
        }
        active++;
        let outcome = unknownOutcome(body.dispatchId);
        try {
          const result = await send(body);
          if (!Number.isSafeInteger(result?.resultCode) || (result.resultCode > 0 && !validMessageId(result.messageId))) throw new Error('INVALID_PROVIDER_RESPONSE');
          const accepted = result.resultCode > 0;
          outcome = { status: 200, body: { ok: accepted, actualDelivery: accepted ? null : false, dispatchId: body.dispatchId,
            state: accepted ? 'accepted' : 'rejected', providerCode: result.resultCode,
            providerMessage: accepted ? '알리고에서 요청을 접수했습니다. 전달 완료는 아직 확인되지 않았습니다.' : '알리고에서 발송 요청을 거절했습니다.',
            messageId: accepted ? String(result.messageId) : null, testMode: false, retryable: false } };
        } catch { /* Ambiguous transport outcomes are permanently non-retryable. */ }
        finally { active--; }
        try { store.finish(body.dispatchId, fingerprint, outcome); }
        catch { outcome = unknownOutcome(body.dispatchId); }
        json(response, outcome.status, outcome.body);
      } catch (caught) {
        if (caught instanceof ValidationError) error(request, response, 400, caught.code);
        else if (caught instanceof HttpError) error(request, response, caught.status, caught.code);
        else {
          // A store failure cannot establish whether a previous attempt existed.
          json(response, 503, { ok: false, actualDelivery: null, error: 'STATE_UNAVAILABLE', state: 'unknown', providerCode: null, providerMessage: '발송 기록을 확인할 수 없습니다.', messageId: null });
        }
      }
    },
    close() { transport?.close(); if (!dispatchStore) store.close(); },
  };
}
