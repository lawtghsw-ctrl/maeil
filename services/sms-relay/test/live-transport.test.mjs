import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { sendAligoLive, queryAligoResult } from '../src/aligo-live.mjs';
https.request = () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); };
const body = () => ({ provider: { key: 'offline-key', userId: 'offline-user' }, sender: '0212345678', receiver: '01000000000', message: '오프라인 검사', msgType: 'SMS', title: '', images: [] });
function fake({ payload = { result_code: 1, msg_id: 123 }, raw, status = 200, hang = false, error = false } = {}) {
  const calls = [];
  return { calls, request(url, options, callback) {
    const outgoing = new EventEmitter(), response = new PassThrough(); response.statusCode = status;
    outgoing.destroy = () => { outgoing.destroyed = true; };
    outgoing.end = sent => {
      calls.push({ url, options, sent, outgoing });
      if (hang) return;
      queueMicrotask(() => { if (error) { outgoing.emit('error', new Error('raw secret')); return; } callback(response); if (!response.destroyed) response.end(raw ?? JSON.stringify(payload)); });
    };
    return outgoing;
  } };
}
test('live transport uses only the fixed send endpoint and never schedules or batches', async () => {
  const transport = fake({ payload: { result_code: '1', msg_id: '123', message: 'offline-key raw' } });
  assert.deepEqual(await sendAligoLive(body(), transport), { resultCode: 1, messageId: '123' });
  const call = transport.calls[0], fields = new URLSearchParams(call.sent);
  assert.equal(call.url, 'https://apis.aligo.in/send/'); assert.equal(fields.get('testmode_yn'), 'N');
  assert.equal(fields.get('receiver'), body().receiver); assert.equal(fields.get('msg'), body().message);
  assert.deepEqual([...fields.keys()].sort(), ['key', 'msg', 'msg_type', 'receiver', 'sender', 'testmode_yn', 'user_id']);
  assert.equal(transport.calls.length, 1);
});
test('MMS sends validated bytes in at most three named multipart parts', async () => {
  const transport = fake(); const input = body(); input.msgType = 'MMS'; input.title = '제목';
  input.images = [{ filename: 'photo.jpg', contentType: 'image/jpeg', bytes: Buffer.from([255, 216, 255, 217]) }];
  await sendAligoLive(input, transport);
  const call = transport.calls[0]; assert.match(call.options.headers['Content-Type'], /^multipart\/form-data; boundary=lawpower-/);
  assert.equal(call.options.headers['Content-Length'], call.sent.length);
  assert.match(call.sent.toString(), /name="image1"; filename="photo.jpg"/); assert.match(call.sent.toString(), /name="testmode_yn"\r\n\r\nN/);
});
test('provider acknowledgements require a precise integer code and positive message ID', async () => {
  for (const code of [1, '1']) assert.equal((await sendAligoLive(body(), fake({ payload: { result_code: code, msg_id: 123 } }))).messageId, '123');
  for (const code of [-101, '-101']) assert.deepEqual(await sendAligoLive(body(), fake({ payload: { result_code: code } })), { resultCode: -101, messageId: null });
  for (const payload of [{ result_code: null }, { result_code: true }, { result_code: '1e0' }, { result_code: 1 }, { result_code: 1, msg_id: 1.5 }, { result_code: 1, msg_id: 'bad' }, { result_code: 1, msg_id: Number.MAX_SAFE_INTEGER + 1 }]) await assert.rejects(sendAligoLive(body(), fake({ payload })));
});
test('results use stored mid and documented states only, matching the original recipient', async () => {
  for (const [providerState, state] of [['발송완료', 'delivered'], ['가입자없음', 'failed'], ['전송중', 'pending'], ['성공', 'unknown'], ['실패', 'unknown'], ['secret raw', 'unknown']]) {
    const transport = fake({ payload: { result_code: '1', list: [{ receiver: body().receiver, sms_state: providerState }] } });
    assert.deepEqual(await queryAligoResult(body().provider, '123', `hash:${body().receiver}`, phone => `hash:${phone}`, transport), { resultCode: 1, state });
    assert.equal(transport.calls[0].url, 'https://apis.aligo.in/sms_list/');
    assert.equal(new URLSearchParams(transport.calls[0].sent).get('mid'), '123');
  }
  for (const payload of [{ result_code: 1, list: [] }, { result_code: 1, list: [{ receiver: '01000000001', sms_state: '발송완료' }] }, { result_code: 1, next_yn: 'Y', list: [{ receiver: body().receiver, sms_state: '발송완료' }] }]) assert.equal((await queryAligoResult(body().provider, '123', `hash:${body().receiver}`, phone => `hash:${phone}`, fake({ payload }))).state, 'unknown');
});
test('redirect, network, oversize and malformed outcomes never retry or echo raw response', async () => {
  for (const options of [{ status: 302 }, { status: 500 }, { error: true }, { raw: 'raw secret' }, { raw: 'x'.repeat(32769) }]) {
    const transport = fake(options); await assert.rejects(sendAligoLive(body(), transport), error => !error.message.includes('secret'));
    assert.equal(transport.calls.length, 1); assert.equal(transport.calls[0].outgoing.destroyed, true);
  }
});
test('live timeout covers the whole call and never repeats a possible delivery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const transport = fake({ hang: true });
  const promise = sendAligoLive(body(), transport); t.mock.timers.tick(10000);
  await assert.rejects(promise, error => error.code === 'UPSTREAM_TIMEOUT'); assert.equal(transport.calls.length, 1);
});
