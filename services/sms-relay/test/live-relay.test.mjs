import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createRelayServer } from '../src/server.mjs';
import { readConfig } from '../src/config.mjs';
import { DispatchStore } from '../src/dispatch-store.mjs';
import { validateImages } from '../src/validation.mjs';

https.request = () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); };
const EPOCH = 'e1700fe9-2aa5-452d-a2cd-50ed99391398';
const OTHER_EPOCH = '11a882fc-3287-46b0-ab4b-e06cd0d91d46';
const provider = () => ({ key: 'private-provider-key', userId: 'private-provider-user' });
const input = () => ({ dispatchId: randomUUID(), approvalEpoch: EPOCH, provider: provider(), sender: '0212345678', receiver: '01000000000', message: 'private-message-unique', msgType: 'SMS' });
function environment(dbPath) {
  return { RELAY_BEARER_TOKEN: 'test_' + 'x'.repeat(40), ALIGO_CREDENTIAL_SOURCE: 'request', ALIGO_SENDER_ALLOWLIST: '0212345678',
    RELAY_LIVE_ENABLED: 'true', RELAY_LIVE_BEARER_TOKEN: 'live_' + 'y'.repeat(40), RELAY_LIVE_APPROVAL_EPOCH: EPOCH,
    RELAY_STATE_DB_PATH: dbPath, RELAY_LIVE_RECEIVER_ALLOWLIST: '01000000000' };
}
function statePath(t) {
  const directory = mkdtempSync(join(tmpdir(), 'lawpower-relay-test-'));
  const path = join(directory, 'dispatch.sqlite');
  t.after(() => { for (const suffix of ['', '-wal', '-shm', '.hmac-key']) rmSync(path + suffix, { force: true }); rmdirSync(directory); });
  return path;
}
async function setup(t, options = {}) {
  const path = options.path || statePath(t);
  const config = readConfig({ ...environment(path), ...options.env });
  const calls = [], queries = [];
  const server = createRelayServer(config, { sendTest: async () => ({ resultCode: 1 }),
    sendLive: async body => { calls.push(body); return options.send ? options.send(body) : { resultCode: 1, messageId: '123' }; },
    queryResults: async (...args) => { queries.push(args); return options.results ? options.results(...args) : { resultCode: 1, state: 'delivered' }; },
    ...(options.store ? { dispatchStore: options.store } : {}),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let stopped = false;
  const stop = () => { if (stopped) return Promise.resolve(); stopped = true; return new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); };
  // Cleanup callbacks run in registration order; stop before unlinking SQLite.
  t.after(stop);
  async function request(body = input(), options = {}) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const headers = { Authorization: `Bearer ${config.live.token}`, 'Content-Type': 'application/json', ...(options.chunked ? {} : { 'Content-Length': Buffer.byteLength(raw) }), ...options.headers };
    for (const key of Object.keys(headers)) if (headers[key] === undefined) delete headers[key];
    return new Promise((resolve, reject) => {
      const outgoing = http.request({ host: '127.0.0.1', port: server.address().port, method: options.method || 'POST', path: options.path || '/v1/aligo/send', headers }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      outgoing.on('error', reject); if (options.chunked) { outgoing.write(raw.slice(0, 100)); outgoing.end(raw.slice(100)); } else outgoing.end(raw);
    });
  }
  return { config, path, calls, queries, request, stop };
}
function poll(body) { return { dispatchId: body.dispatchId, approvalEpoch: body.approvalEpoch, provider: body.provider }; }

test('live defaults off; explicit separate token, epoch and recipient consent are required', t => {
  const path = statePath(t), env = environment(path);
  assert.equal(readConfig({ ...env, RELAY_LIVE_ENABLED: undefined }).live.enabled, false);
  for (const changes of [{ RELAY_LIVE_ENABLED: 'yes' }, { RELAY_LIVE_BEARER_TOKEN: env.RELAY_BEARER_TOKEN }, { RELAY_LIVE_BEARER_TOKEN: 'short' }, { RELAY_LIVE_APPROVAL_EPOCH: '2026-10-17' }, { RELAY_STATE_DB_PATH: 'relative.sqlite' }, { RELAY_LIVE_RECEIVER_ALLOWLIST: '' }, { RELAY_LIVE_ALLOW_ALL_RECEIVERS: '1' }, { RELAY_LIVE_RECEIVER_ALLOWLIST: '123456789012' }]) assert.throws(() => readConfig({ ...env, ...changes }));
  assert.equal(readConfig({ ...env, RELAY_LIVE_ALLOW_ALL_RECEIVERS: 'true', RELAY_LIVE_RECEIVER_ALLOWLIST: '' }).live.allowAllReceivers, true);
  assert.equal(existsSync(path), false);
});
test('live single 9–11 digit recipients preserve the existing app contract', async t => {
  const app = await setup(t, { env: { RELAY_LIVE_RECEIVER_ALLOWLIST: '021234567,0212345678,01000000000' } });
  for (const receiver of ['021234567', '0212345678', '01000000000']) assert.equal((await app.request({ ...input(), receiver })).body.state, 'accepted');
  for (const receiver of ['12345678', '123456789012', '02-1234-5678']) assert.equal((await app.request({ ...input(), receiver })).status, 400);
  assert.equal(app.calls.length, 3); await app.stop();
});
test('live authentication precedes parsing; test token cannot authorize live sends', async t => {
  const app = await setup(t);
  for (const authorization of [undefined, 'Bearer invalid', `Bearer ${app.config.token}`]) assert.equal((await app.request('{', { headers: { Authorization: authorization } })).status, 401);
  assert.equal((await app.request(input(), { method: 'GET' })).status, 405);
  assert.equal((await app.request(input(), { path: '/v1/aligo/send?url=https://evil.example' })).status, 404);
  assert.equal(app.calls.length, 0); await app.stop();
});
test('authenticated readiness checks open ledger and configured epoch without provider calls', async t => {
  const app = await setup(t);
  assert.equal((await app.request('', { method: 'GET', path: '/v1/aligo/ready', headers: { Authorization: undefined } })).status, 401);
  const ready = await app.request('', { method: 'GET', path: '/v1/aligo/ready' });
  assert.equal(ready.status, 200); assert.equal(ready.body.ready, true); assert.equal(ready.body.approvalEpoch, EPOCH);
  assert.equal(app.calls.length, 0); assert.equal(app.queries.length, 0); await app.stop();
});
test('strict live input rejects wrong epochs, recipients, senders, provider fields, scheduling and oversized JSON', async t => {
  const app = await setup(t);
  for (const body of [null, [], {}, { ...input(), provider: { ...provider(), url: 'https://evil.example' } }, { ...input(), receiver: '01000000000,01000000001' }, { ...input(), url: 'https://evil.example' }, { ...input(), rdate: '20261017' }, { ...input(), testmode_yn: 'Y' }, { ...input(), dispatchId: 'invalid' }, { ...input(), message: '한'.repeat(46) }]) assert.equal((await app.request(body)).status, 400);
  for (const body of [{ ...input(), approvalEpoch: OTHER_EPOCH }, { ...input(), receiver: '01000000001' }, { ...input(), sender: '0299999999' }]) assert.equal((await app.request(body)).status, 403);
  assert.equal((await app.request('{')).status, 400);
  assert.equal((await app.request(input(), { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  assert.equal((await app.request(' '.repeat(4 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await app.request(' '.repeat(4 * 1024 * 1024 + 1), { chunked: true })).status, 413);
  assert.equal(app.calls.length, 0); await app.stop();
});
test('attempt is committed before provider call; acknowledgement remains unconfirmed and private data is absent from SQLite', async t => {
  const path = statePath(t); let committed = false;
  const app = await setup(t, { path, send: async body => {
    const db = new DatabaseSync(path, { readOnly: true }); const row = db.prepare('SELECT * FROM dispatches WHERE dispatch_id=?').get(body.dispatchId); db.close();
    committed = row.state === 'started';
    for (const secret of [body.message, body.receiver, body.sender, body.provider.key, body.provider.userId]) assert.equal(JSON.stringify(row).includes(secret), false);
    return { resultCode: 1, messageId: '123', message: 'private-provider-key' };
  } });
  const result = await app.request(); assert.equal(committed, true); assert.equal(result.body.state, 'accepted'); assert.equal(result.body.actualDelivery, null); assert.equal(result.body.testMode, false); assert.equal(result.body.retryable, false);
  for (const secret of Object.values(provider())) assert.equal(JSON.stringify(result).includes(secret), false);
  await app.stop();
});
test('same dispatch survives restart, token rotation and epoch rotation without sending twice', async t => {
  const path = statePath(t), body = input();
  const app = await setup(t, { path }); const first = await app.request(body); assert.deepEqual(await app.request(body), first); assert.equal(app.calls.length, 1); await app.stop();
  const restarted = await setup(t, { path, env: { RELAY_LIVE_BEARER_TOKEN: 'rotated_' + 'z'.repeat(40), RELAY_LIVE_APPROVAL_EPOCH: OTHER_EPOCH } });
  assert.deepEqual(await restarted.request(body), first); assert.equal(restarted.calls.length, 0);
  assert.equal((await restarted.request({ ...input(), approvalEpoch: EPOCH })).status, 403); await restarted.stop();
});
test('persistent dispatch conflicts include credentials, epoch, message, receiver, type and images', async t => {
  const app = await setup(t), body = input(); await app.request(body);
  for (const change of [{ message: 'changed' }, { receiver: '01000000001' }, { approvalEpoch: OTHER_EPOCH }, { provider: { ...provider(), key: 'different-key' } }, { provider: { ...provider(), userId: 'different-user' } }, { msgType: 'LMS' }, { msgType: 'LMS', title: 'title' }]) assert.equal((await app.request({ ...body, ...change })).status, 409);
  const imageBody = { ...input(), msgType: 'MMS', images: [{ filename: 'photo.jpg', contentType: 'image/jpeg', base64: Buffer.from([255, 216, 255, 0, 255, 217]).toString('base64') }] };
  await app.request(imageBody);
  for (const image of [{ ...imageBody.images[0], filename: 'other.jpg' }, { ...imageBody.images[0], base64: Buffer.from([255, 216, 255, 1, 255, 217]).toString('base64') }]) assert.equal((await app.request({ ...imageBody, images: [image] })).status, 409);
  assert.equal(app.calls.length, 2); await app.stop();
});
test('crash after committed attempt is recovered as unknown and never resent', async t => {
  const path = statePath(t), body = input();
  const moduleUrl = new URL('../src/dispatch-store.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {DispatchStore} from ${JSON.stringify(moduleUrl)}; const store=new DispatchStore(process.env.TEST_DB); const body=JSON.parse(process.env.TEST_BODY); body.images=[]; body.title=''; store.claim(body,store.fingerprint(body)); process.exit(0);`], { env: { ...process.env, TEST_DB: path, TEST_BODY: JSON.stringify(body) }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const app = await setup(t, { path }); const result = await app.request(body); assert.equal(result.body.state, 'unknown'); assert.equal(result.body.retryable, false); assert.equal(app.calls.length, 0); await app.stop();
});
test('ambiguous provider errors and rejected sends persist without retry, even after restart', async t => {
  for (const result of ['throw', { resultCode: 1 }, { resultCode: -101, messageId: null }]) {
    const path = statePath(t), body = input(); const app = await setup(t, { path, send: async () => { if (result === 'throw') throw new Error('raw private-provider-key 01000000000'); return result; } });
    const first = await app.request(body); assert.equal(first.body.state, result?.resultCode === -101 ? 'rejected' : 'unknown'); assert.equal(JSON.stringify(first).includes('private-provider-key'), false);
    assert.deepEqual(await app.request(body), first); assert.equal(app.calls.length, 1); await app.stop();
    const second = await setup(t, { path }); assert.deepEqual(await second.request(body), first); assert.equal(second.calls.length, 0); await second.stop();
  }
});
test('in-flight duplicates return unknown and concurrency never queues extra live calls', async t => {
  let finish, entered; const started = new Promise(resolve => { entered = resolve; });
  const app = await setup(t, { env: { RELAY_MAX_CONCURRENCY: '1' }, send: async () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
  const body = input(), first = app.request(body); await started;
  assert.equal((await app.request(body)).body.state, 'unknown'); assert.equal((await app.request()).status, 429); assert.equal(app.calls.length, 1);
  finish({ resultCode: 1, messageId: '123' }); assert.equal((await first).body.state, 'accepted'); await app.stop();
});
test('results bind stored dispatch, epoch, credentials and mid; terminal delivered is reused without a query', async t => {
  const app = await setup(t), body = input(); await app.request(body);
  assert.equal((await app.request({ ...poll(body), messageId: '999' }, { path: '/v1/aligo/results' })).status, 400);
  for (const change of [{ approvalEpoch: OTHER_EPOCH }, { provider: { ...provider(), key: 'other' } }]) assert.equal((await app.request({ ...poll(body), ...change }, { path: '/v1/aligo/results' })).status, 409);
  assert.equal((await app.request(poll(input()), { path: '/v1/aligo/results' })).status, 404);
  const delivered = await app.request(poll(body), { path: '/v1/aligo/results' }); assert.equal(delivered.body.state, 'delivered'); assert.equal(delivered.body.actualDelivery, true);
  assert.equal(app.queries[0][1], '123'); assert.equal(app.queries[0][2], app.queries[0][3](body.receiver));
  assert.deepEqual(await app.request(poll(body), { path: '/v1/aligo/results' }), delivered); assert.equal(app.queries.length, 1); assert.equal(app.calls.length, 1); await app.stop();
});
test('unknown result queries retain stored mid for later confirmation and never resend', async t => {
  let success = false; const app = await setup(t, { results: async () => { if (!success) throw new Error('raw secret'); return { resultCode: 1, state: 'delivered' }; } });
  const body = input(); await app.request(body); const unknown = await app.request(poll(body), { path: '/v1/aligo/results' });
  assert.equal(unknown.body.state, 'unknown'); assert.equal(unknown.body.messageId, '123'); assert.equal(unknown.body.actualDelivery, null);
  success = true; assert.equal((await app.request(poll(body), { path: '/v1/aligo/results' })).body.state, 'delivered'); assert.equal(app.calls.length, 1); await app.stop();
});
test('missing or mismatched persistent key fails closed instead of losing duplicate history', t => {
  const path = statePath(t); const store = new DispatchStore(path); store.close(); const key = readFileSync(path + '.hmac-key');
  rmSync(path + '.hmac-key'); assert.throws(() => new DispatchStore(path), /STATE_PAIR_INCOMPLETE/);
  writeFileSync(path + '.hmac-key', Buffer.alloc(32, 1)); assert.throws(() => new DispatchStore(path), /STATE_INITIALIZATION_FAILED/);
  writeFileSync(path + '.hmac-key', key); const restored = new DispatchStore(path); restored.close();
});
test('storage failure before claim sends nothing, and failure after send remains unknown without resending', async t => {
  const path = statePath(t), store = new DispatchStore(path), originalClaim = store.claim.bind(store), originalFinish = store.finish.bind(store);
  const app = await setup(t, { path, store });
  store.claim = () => { throw new Error('disk failure'); }; assert.equal((await app.request()).status, 503); assert.equal(app.calls.length, 0);
  store.claim = originalClaim; store.finish = () => { throw new Error('disk failure'); };
  const body = input(); assert.equal((await app.request(body)).body.state, 'unknown'); assert.equal((await app.request(body)).body.state, 'unknown'); assert.equal(app.calls.length, 1);
  store.finish = originalFinish; await app.stop(); store.close();
});
