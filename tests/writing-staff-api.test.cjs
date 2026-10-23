// Offline fixtures only. Every module executes current TypeScript source;
// outbound providers, credentials, and Supabase are isolated mocks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const firmId = '10000000-0000-4000-8000-000000000001';
const oldPermissions = { 'staff.writer': true, 'cases.econtract': true, 'cases.view_all': true, 'sms.view': true, 'sms.send': true, 'sms.view_history': true, 'sms.manage_settings': true, 'settlements.view': true, 'settlements.view_all': true, 'settlements.export': true };
function harness({ profile = {}, permissions = oldPermissions, profileError = false } = {}) {
  const actor = { id: 'actor', law_firm_id: firmId, role: 'staff', platform_role: 'staff', staff_name: '실무 담당', is_active: true, ...profile };
  const reads = [], writes = [], rpcs = [], external = [];
  const rows = { profiles: [{ ...actor, permissions }], law_firms: [{ id: firmId, name: '합성 로펌', status: 'active', firm_code: '1234567890' }], app_cases: [{ id: 'case-one', law_firm_id: firmId, data: { assignedStaff: '실무 담당' } }], sms_sender_numbers: [{ id: 'sender', staff_name: '박형원' }] };
  const admin = { auth: { getUser: async () => ({ data: { user: { id: actor.id } }, error: null }) }, from(table) {
    let filters = [], mutation = null; const query = {
      select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, insert(value) { mutation = value; return query; },
      maybeSingle() { return finish(true); }, single() { return finish(true); }, then(a, b) { return finish(false).then(a, b); },
    };
    async function finish(single) {
      if (mutation) { writes.push({ table, mutation }); return { data: null, error: null }; }
      reads.push(table);
      if (profileError && table === 'profiles') return { data: null, error: { message: 'offline profile error' } };
      const found = (rows[table] || []).filter(row => filters.every(([key, value]) => !(key in row) || row[key] === value));
      return { data: single ? found[0] || null : found, error: null };
    }
    return query;
  }, rpc: async (name, args) => { rpcs.push({ name, args }); return { data: [], error: null }; } };
  const mockServer = { requirePlatformUser: async (_request, allowed) => { if (!allowed.includes(actor.platform_role)) throw new Error('FORBIDDEN'); return { admin, profile: actor }; }, platformError: error => ({ status: error.message === 'FORBIDDEN' ? 403 : 400, message: error.message }), writePlatformAudit: async () => writes.push({ audit: true }) };
  const mocks = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/platform/server': mockServer,
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/supabase/server': { createClient: async () => admin },
    '@/lib/platform/meta': { sendMetaLeadEvent: async () => { external.push('meta'); throw new Error('Unexpected provider'); } },
    '@/lib/eformsign': { buildEformsignPayload: () => { throw new Error('Unexpected document access'); }, getEformsignAccess: async () => { external.push('esign-token'); throw new Error('Unexpected provider'); } },
    '@/lib/eformsign-connections': { readFirmEsignConfig: async () => { external.push('esign-config'); throw new Error('Unexpected credential read'); } },
    '@/lib/sms/aligo-test-relay': { AligoTestRelayError: class extends Error {}, requestAligoTest: async () => { external.push('aligo-mocked'); return { ok: true, actualDelivery: false, testMode: true }; } },
  };
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(root, file); if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Request, Response, URL, Buffer, Date, TextDecoder, AbortController, AbortSignal, process: { env: { ALIGO_TEST_MODE: 'true', META_QUEUE_SECRET: 'offline-service-secret' } }, fetch: async () => { throw new Error('Live fetch forbidden'); } }, { filename })(name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name)) + '.ts');
      return require(name);
    }, module, module.exports);
    return module.exports;
  }
  function request(method = 'GET', body, query = '', service = false) {
    const req = new Request('http://offline.test/api' + query, { method, headers: { authorization: 'Bearer fixture-session', 'content-type': 'application/json', ...(service ? { 'x-lawpower-meta-queue-secret': 'offline-service-secret' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); req.nextUrl = new URL(req.url); return req;
  }
  const noBusinessAccess = () => { assert.deepEqual([...new Set(reads)], ['profiles']); assert.equal(writes.length, 0); assert.equal(rpcs.length, 0); assert.equal(external.length, 0); };
  return { actor, admin, rows, reads, writes, rpcs, external, load, request, noBusinessAccess };
}

test('writer marker overrides old e-contract permissions in preflight, send and status before case/secret access', async () => {
  for (const [file, method] of [['send', 'GET'], ['send', 'POST'], ['status', 'POST']]) {
    const h = harness(); const route = h.load(`app/api/integrations/eformsign/${file}/route.ts`);
    const response = await route[method](h.request(method, method === 'POST' ? { caseId: 'case-one' } : undefined, '?caseId=case-one'));
    assert.equal(response.status, 403); h.noBusinessAccess();
  }
});
test('writer denies SMS view/send/history/settings despite every old raw SMS permission', async () => {
  for (const permission of ['sms.view', 'sms.send', 'sms.view_history', 'sms.manage_settings']) {
    const h = harness(); const sms = h.load('lib/sms/delivery.ts');
    await assert.rejects(sms.requireSmsActor(h.request(), firmId, permission), error => error.status === 403);
    h.noBusinessAccess();
  }
});
test('writer cannot claim Meta queue through either authenticated HTTP method', async () => {
  for (const method of ['GET', 'POST']) {
    const h = harness(); const route = h.load('app/api/integrations/meta/flush/route.ts');
    assert.equal((await route[method](h.request(method, method === 'POST' ? { lawFirmId: firmId } : undefined))).status, 403); h.noBusinessAccess();
  }
});
test('writer cannot request settlement export even with preserved export and view_all flags', async () => {
  const h = harness(); const route = h.load('app/api/admin/management-export/route.ts');
  assert.equal((await route.POST(h.request('POST', { kind: 'settlements', firmId, start: '2026-10-01', end: '2026-10-31', format: 'xlsx', staff: '전체' }))).status, 403); h.noBusinessAccess();
});
test('writer Aligo test request stops before sender lookup or mocked relay invocation', async () => {
  const h = harness(); const route = h.load('app/api/aligo/test/route.ts');
  assert.equal((await route.POST(h.request('POST', { sender: '01026492494', receiver: '01000000000', lawFirmId: firmId }))).status, 403); h.noBusinessAccess();
});
test('ordinary staff and administrators retain existing permitted e-contract and SMS paths', async () => {
  for (const options of [{ permissions: { ...oldPermissions, 'staff.writer': false } }, { profile: { role: 'admin' } }, { profile: { platform_role: 'firm_admin' } }, { profile: { platform_role: 'super_admin' } }]) {
    const h = harness(options);
    assert.equal((await h.load('lib/eformsign-access.ts').getFirmEsignCase(h.admin, h.actor, 'case-one')).id, 'case-one');
    assert.equal((await h.load('lib/sms/delivery.ts').requireSmsActor(h.request(), firmId, 'sms.send')).firmId, firmId);
    assert.equal(h.external.length, 0);
  }
});
test('Meta service secret and manager execution are preserved; ordinary staff still uses its own firm', async () => {
  for (const options of [{ service: true }, { profile: { role: 'admin' } }, { permissions: { ...oldPermissions, 'staff.writer': false } }]) {
    const h = harness(options); const route = h.load('app/api/integrations/meta/flush/route.ts');
    const response = await route.POST(h.request('POST', { lawFirmId: options.service ? firmId : 'untrusted-other-firm' }, '', options.service));
    assert.equal(response.status, 200); assert.equal(h.rpcs.length, 1); assert.equal(h.rpcs[0].args.p_law_firm_id, firmId); assert.equal(h.external.length, 0);
    if (options.service || options.profile) assert.equal(h.reads.length, 0);
  }
});
test('ordinary staff settlement export and Aligo test retain pre-existing permissions', async () => {
  const h = harness({ permissions: { ...oldPermissions, 'staff.writer': false } });
  assert.equal((await h.load('app/api/admin/management-export/route.ts').POST(h.request('POST', { kind: 'settlements', firmId, start: '2026-10-01', end: '2026-10-31', format: 'xlsx', staff: '전체' }))).status, 200);
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].table, 'platform_audit_logs');
  assert.equal((await h.load('app/api/aligo/test/route.ts').POST(h.request('POST', { sender: '01026492494', receiver: '01000000000', lawFirmId: firmId }))).status, 200);
  assert.deepEqual(h.external, ['aligo-mocked']);
});
test('unreadable staff marker fails closed before Meta queue action', async () => {
  const h = harness({ profileError: true });
  assert.equal((await h.load('app/api/integrations/meta/flush/route.ts').GET(h.request())).status, 403); h.noBusinessAccess();
});
