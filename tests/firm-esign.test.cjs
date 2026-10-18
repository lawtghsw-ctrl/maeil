const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const MAEIL = '0a5900a4-48b3-4503-8c9b-3979c7d2d95c', OTHER = '00000000-0000-4000-8000-000000000002';
const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = { EFORMSIGN_API_KEY: 'test-api-only', EFORMSIGN_PRIVATE_KEY: key, EFORMSIGN_MEMBER_ID: 'legacy-member', EFORMSIGN_TEMPLATE_ID: 'legacy-template' };
function load(file, mocks = {}, globals = {}, cache = new Map(), override) {
  const name = path.resolve(root, file); if (cache.has(name)) return cache.get(name).exports;
  const module = { exports: {} }; cache.set(name, module);
  const source = ts.transpileModule(override || fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { URL, Request, Response, Buffer, AbortController, Date, setTimeout, clearTimeout, process: { env }, fetch: () => { throw new Error('Live fetch forbidden'); }, ...globals }, { filename: name })(request => request in mocks ? mocks[request] : request.startsWith('@/') ? load(request.slice(2) + '.ts', mocks, globals, cache) : require(request), module, module.exports);
  return module.exports;
}
const types = load('lib/eformsign-config.ts');
const template = types.defaultEsignTemplate('legacy-template');
const config = { lawFirmId: OTHER, connectionId: 'conn1', source: 'connection', apiKey: 'test-api-only', privateKey: key, memberId: 'new-member', senderMemberId: '', companyId: 'company-new', templates: [template] };
const input = { name: '모의 고객', address: '테스트 주소', residentNumber: '000000-0000000', phone: '010-0000-0000', creditorCount: '3', fee: '3,000,000원', contractDate: '2026-10-18', signerName: '모의 고객', message: '' };
const clone = value => JSON.parse(JSON.stringify(value));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const provider = calls => async (url, init) => { calls.push({ url, init }); if (url.includes('access_token')) return response({ oauth_token: { access_token: 'access-secret' }, api_key: { company: { api_url: 'https://kr-api.eformsign.com', company_id: 'company-new' } } }); if (init.method === 'POST') return response({ document: { id: 'document-new' } }); return response({ current_status: { status_type: '003' } }); };

test('Maeil original source payload and new default template payload are exactly equal', async () => {
  const baselineSource = execFileSync('git', ['show', '36669781a7db604736e8c928b394563b3e111c0e:lib/eformsign.ts'], { cwd: root, encoding: 'utf8' });
  const oldCalls = [], newCalls = [];
  const old = load('lib/eformsign.ts', {}, { fetch: provider(oldCalls) }, new Map(), baselineSource);
  const current = load('lib/eformsign.ts', {}, { fetch: provider(newCalls) });
  await old.createEformsignDocument(input); await current.createEformsignDocument(input, config, template);
  const oldCreate = oldCalls.find(c => c.url.includes('?template_id=')); const nextCreate = newCalls.find(c => c.url.includes('?template_id='));
  assert.equal(nextCreate.url, oldCreate.url); assert.deepEqual(JSON.parse(nextCreate.init.body), JSON.parse(oldCreate.init.body));
  assert.equal(newCalls.every(c => c.init.redirect === 'error' && c.init.cache === 'no-store'), true);
});
test('per-firm fields/year/template and sender fallback are resolved from supplied config', async () => {
  const calls = []; const current = load('lib/eformsign.ts', {}, { fetch: async (url, init) => { const member = url.includes('access_token') ? JSON.parse(init.body).member_id : ''; if (member === 'sender') { calls.push({ url, init }); return response({ error: 'private-value' }, 403); } return provider(calls)(url, init); } });
  const custom = { ...template, templateId: 'firm-template', fixedYear: null, yearField: 'year', fields: { ...template.fields, name: 'client_name' } };
  await current.createEformsignDocument({ ...input, contractDate: '2027-01-02' }, { ...config, senderMemberId: 'sender' }, custom);
  assert.deepEqual(calls.filter(c => c.url.includes('access_token')).map(c => JSON.parse(c.init.body).member_id), ['sender', 'new-member']);
  const request = calls.find(c => c.url.includes('template_id=')); assert.ok(request.url.endsWith('firm-template'));
  const fields = JSON.parse(request.init.body).document.fields; assert.equal(fields.find(f => f.id === 'client_name').value, input.name); assert.equal(fields.find(f => f.id === 'year').value, '2027');
  assert.throws(() => current.buildEformsignPayload({ ...input, contractDate: '2027-01-01' }, template), /2026/);
  assert.throws(() => current.buildEformsignPayload({ ...input, contractDate: '2026-02-30' }, template), /계약일/);
});
test('wrong provider company and unsafe API origin fail before document creation, without secrets', async () => {
  for (const patch of [{ company_id: 'other-company' }, { api_url: 'https://evil.example' }, { api_url: 'http://kr-api.eformsign.com' }]) {
    let calls = 0; const current = load('lib/eformsign.ts', {}, { fetch: async () => { calls++; return response({ oauth_token: { access_token: 'secret-token' }, api_key: { company: { api_url: 'https://kr-api.eformsign.com', company_id: 'company-new', ...patch } } }); } });
    await assert.rejects(current.createEformsignDocument(input, config, template), e => !e.message.includes('secret-token')); assert.equal(calls, 1);
  }
});
test('provider request timeout is bounded and large/malformed body never exposes secrets', async () => {
  let aborted = false;
  const timed = load('lib/eformsign.ts', {}, { setTimeout: callback => setTimeout(callback, 1), fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('private-provider-secret')); })) });
  await assert.rejects(timed.getEformsignAccess(config), e => !e.message.includes('private-provider-secret')); assert.equal(aborted, true);
  const large = load('lib/eformsign.ts', {}, { fetch: async () => new Response('secret'.repeat(200000)) });
  await assert.rejects(large.getEformsignAccess(config), e => !e.message.includes('secret'));
});
test('invalid template mapping rejects duplicate fields, missing year and duplicate case type', () => {
  for (const invalid of [[{ ...template, fields: { ...template.fields, address: template.fields.name } }], [{ ...template, fixedYear: null, yearField: '' }], [template, template]]) assert.throws(() => types.validateEsignTemplates(invalid));
  assert.equal(types.validateEsignTemplates([template])[0].templateId, 'legacy-template');
});

function harness(options = {}) {
  const profile = { id: 'actor', staff_name: '담당자', law_firm_id: OTHER, platform_role: 'firm_admin', role: 'staff', ...options.profile };
  const db = { app_cases: [{ id: 'case1', law_firm_id: OTHER, data: { caseType: '개인회생', assignedStaff: '담당자', memo: 'keep-me', contractAmount: 1000 } }], profiles: [{ id: 'actor', permissions: options.permissions || {} }], law_firms: [{ id: OTHER }, { id: MAEIL }], platform_firm_esign_connections: [{ id: 'conn1', law_firm_id: OTHER, active: true, company_id: 'company-new', credentials_ciphertext: JSON.stringify(config), templates: [template] }], platform_firm_esign_documents: [], ...options.db };
  const calls = [], audits = [], writes = [];
  const admin = { from(table) { let filters = [], kind = 'read', payload; const q = { select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; }, insert(v) { kind = 'insert'; payload = v; return q; }, update(v) { kind = 'update'; payload = v; return q; }, maybeSingle() { return result(true); }, then(a, b) { return result(false).then(a, b); } };
    async function result(single) { let rows = (db[table] || []).filter(r => filters.every(f => f(r))); if (kind === 'insert') { if (table === 'platform_firm_esign_documents' && db[table].some(r => r.case_id === payload.case_id)) return { error: { code: '23505' } }; db[table].push(clone(payload)); writes.push({ table, kind }); return { error: null }; } if (kind === 'update') { rows.forEach(r => Object.assign(r, clone(payload))); writes.push({ table, kind }); return { error: null }; } return { data: single ? rows[0] || null : rows, error: null }; }
    return q;
  }, async rpc(name, args) { writes.push({ rpc: name, args: clone(args) }); if (name === 'replace_firm_esign_connection' && options.casConflict) return { error: { message: 'ESIGN_CONNECTION_CONFLICT' } }; if (name === 'merge_firm_esign_case_metadata') { if (options.mergeFailure) return { error: {} }; const row = db.app_cases.find(r => r.id === args.p_case_id && r.law_firm_id === args.p_law_firm_id); if (!row) return { error: {} }; Object.assign(row.data, clone(args.p_metadata)); } return { error: null }; } };
  const server = { requirePlatformUser: async (_r, roles) => { if (!roles.includes(profile.platform_role)) throw new Error('FORBIDDEN'); return { admin, profile }; }, platformError: e => ({ status: e.message === 'FORBIDDEN' ? 403 : 400, message: e.message }), decryptIntegrationSecret: v => v, encryptIntegrationSecret: v => 'encrypted:' + Buffer.from(v).toString('base64'), writePlatformAudit: async (...args) => audits.push(args[4] || args[3]) };
  const fake = { buildEformsignPayload: load('lib/eformsign.ts').buildEformsignPayload, getEformsignAccess: async c => { calls.push({ kind: 'access', config: clone(c) }); return { accessToken: 'mock-token', apiUrl: 'https://kr-api.eformsign.com', companyId: options.companyId || c.companyId || 'legacy-company', memberId: c.memberId }; }, createEformsignDocument: async (i, c) => { calls.push({ kind: 'create', config: clone(c), input: clone(i) }); if (options.createHook) await options.createHook(db); if (options.createFailure) throw new Error('요청 결과 미확인'); return { documentId: 'document-new', status: '서명 요청', statusCode: '060' }; }, getEformsignDocumentStatus: async (_access, documentId) => { calls.push({ kind: 'status', documentId }); return { status: '서명완료', statusCode: '003' }; } };
  const mocks = { 'next/server': { NextResponse: { json: (v, init) => Response.json(v, init) } }, '@/lib/platform/server': server, '@/lib/eformsign': fake };
  const request = (method = 'POST', body = { caseId: 'case1', ...input }, search = '') => { const r = new Request('http://mock.test/path' + search, { method, ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}) }); r.nextUrl = new URL(r.url); return r; };
  return { profile, db, calls, audits, writes, admin, request, send: load('app/api/integrations/eformsign/send/route.ts', mocks), status: load('app/api/integrations/eformsign/status/route.ts', mocks), settings: load('app/api/firm/eformsign/route.ts', mocks), connections: load('lib/eformsign-connections.ts', mocks) };
}
test('global legacy credentials resolve only for the explicit Maeil UUID; secrets never in settings GET', async () => {
  const h = harness(); assert.throws(() => h.connections.legacyMaeilEsignConfig(OTHER), /등록되지/);
  assert.equal(h.connections.legacyMaeilEsignConfig(MAEIL).memberId, 'legacy-member');
  const body = await (await h.settings.GET(h.request('GET'))).json(); assert.equal(body.canManage, true); assert.equal(body.presence.apiKey, true); assert.ok(!JSON.stringify(body).includes('test-api-only')); assert.ok(!JSON.stringify(body).includes('PRIVATE KEY'));
  h.db.platform_firm_esign_connections = []; assert.equal(await h.connections.readFirmEsignConfig(h.admin, OTHER), null);
});
test('staff require e-contract permission; other-tenant cases and settings writes are blocked', async () => {
  for (const options of [{ profile: { platform_role: 'staff' } }, { profile: { law_firm_id: MAEIL } }]) { const h = harness(options); assert.notEqual((await h.send.POST(h.request())).status, 200); assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0); }
  const h = harness(); assert.equal((await h.settings.PUT(h.request('PUT', {lawFirmId:MAEIL}))).status, 403); assert.equal((await h.settings.GET(h.request('GET', null, '?lawFirmId=' + MAEIL))).status, 403);
});

test('firm manager saves only its own versioned connection, preserving blank secrets and never sending a document', async () => {
  const h = harness();
  const response = await h.settings.PUT(h.request('PUT', { lawFirmId: OTHER, expectedConnectionId: null, companyId: 'company-new', templates: [template] }));
  assert.equal(response.status,200);
  const saved = h.writes.find(write => write.rpc === 'replace_firm_esign_connection');
  assert.equal(saved.args.p_law_firm_id, OTHER); assert.equal(saved.args.p_updated_by,'actor');
  assert.ok(saved.args.p_credentials_ciphertext.startsWith('encrypted:')); assert.equal(h.calls.length,0);
  assert.ok(!JSON.stringify(await response.json()).includes('test-api-only')); assert.ok(!JSON.stringify(h.audits).includes('test-api-only'));
  const staff = harness({profile:{platform_role:'staff'}});
  assert.equal((await staff.settings.GET(staff.request('GET'))).status,403);
  assert.equal((await staff.settings.PUT(staff.request('PUT', {lawFirmId:OTHER}))).status,403); assert.equal(staff.writes.length,0);
});

test('connection check authenticates saved credentials only, with no document creation, writes or secret response', async () => {
  const h=harness();
  const response=await h.settings.POST(h.request('POST',{action:'check_connection',lawFirmId:OTHER,apiKey:'ignored-unsaved-key'}));
  assert.equal(response.status,200); assert.deepEqual(h.calls.map(call=>call.kind),['access']);
  assert.equal(h.calls[0].config.apiKey,'test-api-only'); assert.equal(h.writes.length,0); assert.equal(h.audits.length,0);
  const body=await response.json(); assert.equal(body.ok,true); assert.ok(!JSON.stringify(body).includes('test-api-only')); assert.ok(!JSON.stringify(body).includes('mock-token'));
  for(const options of [{profile:{platform_role:'staff'}},{}]) {
    const denied=harness(options);
    assert.equal((await denied.settings.POST(denied.request('POST',{action:'check_connection',lawFirmId:MAEIL}))).status,403);
    assert.equal(denied.calls.length,0); assert.equal(denied.writes.length,0);
  }
  const missing=harness({db:{platform_firm_esign_connections:[]}});
  assert.equal((await missing.settings.POST(missing.request('POST',{action:'check_connection'}))).status,400); assert.equal(missing.calls.length,0);
  const invalid=harness(); assert.equal((await invalid.settings.POST(invalid.request('POST',{action:'send'}))).status,400); assert.equal(invalid.calls.length,0);
});
test('read-only preflight allows permitted staff but does not authenticate/send or mutate', async () => {
  const h = harness({ profile: { platform_role: 'staff' }, permissions: { 'cases.econtract': true } });
  const result = await (await h.send.GET(h.request('GET', null, '?caseId=case1'))).json(); assert.equal(result.configured, true); assert.equal(result.sendBlocked, false); assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
});
test('staff assignment scope covers preflight, send and status; explicit view_all and managers retain scope', async () => {
  const denied = harness({ profile: { platform_role: 'staff', staff_name: '다른 직원' }, permissions: { 'cases.econtract': true } });
  for (const [route, method, request] of [[denied.send, 'GET', denied.request('GET', null, '?caseId=case1')], [denied.send, 'POST', denied.request()], [denied.status, 'POST', denied.request()]]) assert.equal((await route[method](request)).status, 403);
  assert.equal(denied.calls.length, 0); assert.equal(denied.writes.length, 0);
  for (const options of [{ profile: { platform_role: 'staff', staff_name: '다른 직원' }, permissions: { 'cases.econtract': true, 'cases.view_all': true } }, { profile: { platform_role: 'staff', staff_name: '', display_name: '담당자' }, permissions: { 'cases.econtract': true } }, { profile: { platform_role: 'staff', role: 'admin', staff_name: '관리자' } }]) {
    const h = harness(options); assert.equal((await h.send.GET(h.request('GET', null, '?caseId=case1'))).status, 200);
  }
});
test('send uses only case firm credentials, claims once, preserves concurrently edited case fields', async () => {
  const h = harness({ createHook: async db => { db.app_cases[0].data.memo = 'edited-while-sending'; } });
  const response = await h.send.POST(h.request()); assert.equal(response.status, 200); assert.equal(h.calls.find(c => c.kind === 'create').config.memberId, 'new-member');
  assert.equal(h.db.app_cases[0].data.memo, 'edited-while-sending'); assert.equal(h.db.platform_firm_esign_documents[0].connection_id, 'conn1');
  assert.notEqual((await h.send.POST(h.request())).status, 200); assert.equal(h.calls.filter(c => c.kind === 'create').length, 1);
});
test('unknown create outcome blocks retries even after client case metadata clears', async () => {
  const h = harness({ createFailure: true }); await h.send.POST(h.request()); await h.send.POST(h.request()); assert.equal(h.calls.filter(c => c.kind === 'create').length, 1); assert.equal(h.db.platform_firm_esign_documents[0].status, 'unknown');
  assert.match((await (await h.status.POST(h.request())).json()).error, /재발송/);
});
test('concurrent duplicate send requests create exactly one external document', async () => {
  let release; const blocker = new Promise(resolve => { release = resolve; });
  const h = harness({ createHook: async () => blocker });
  const first = h.send.POST(h.request()); await new Promise(resolve => setImmediate(resolve));
  const second = await h.send.POST(h.request()); assert.notEqual(second.status, 200); release(); assert.equal((await first).status, 200); assert.equal(h.calls.filter(c => c.kind === 'create').length, 1);
});
test('created binding recovers status if case update fails; stored forged document ID is rejected', async () => {
  const h = harness({ mergeFailure: true }); assert.equal((await h.send.POST(h.request())).status, 400); assert.equal(h.db.platform_firm_esign_documents[0].document_id, 'document-new');
  await h.status.POST(h.request()); assert.equal(h.calls.find(c => c.kind === 'status').documentId, 'document-new');
  h.db.app_cases[0].data.eformsignDocumentId = 'other-document'; const before = h.calls.length;
  assert.match((await (await h.status.POST(h.request())).json()).error, /일치하지/); assert.equal(h.calls.length, before);
});
test('status uses version pinned to document, even when firm active connection changes', async () => {
  const h = harness(); await h.send.POST(h.request()); h.db.platform_firm_esign_connections[0].active = false;
  h.db.platform_firm_esign_connections.push({ ...h.db.platform_firm_esign_connections[0], id: 'conn2', active: true, company_id: 'company-other', credentials_ciphertext: JSON.stringify({ ...config, memberId: 'wrong-new-member', companyId: 'company-other' }) });
  assert.equal((await h.status.POST(h.request())).status, 200); assert.equal(h.calls.filter(c => c.kind === 'access').at(-1).config.memberId, 'new-member');
  h.db.platform_firm_esign_documents[0].law_firm_id = MAEIL; assert.notEqual((await h.status.POST(h.request())).status, 200);
});
test('unbound forged document ID cannot use legacy credentials even for Maeil', async () => {
  const h = harness({ profile: { law_firm_id: MAEIL }, db: { app_cases: [{ id: 'case1', law_firm_id: MAEIL, data: { eformsignDocumentId: 'arbitrary-id' } }] } });
  assert.notEqual((await h.status.POST(h.request())).status, 200); assert.equal(h.calls.length, 0);
});
test('super settings save encrypts credentials, preserves blanks, emits metadata-only audit', async () => {
  const h = harness({ profile: { platform_role: 'super_admin' } });
  const result = await h.settings.PUT(h.request('PUT', { lawFirmId: OTHER, expectedConnectionId: null, companyId: 'company-new', templates: [template], apiKey: '', privateKey: '', memberId: '' }));
  assert.equal(result.status, 200); const write = h.writes.find(w => w.rpc === 'replace_firm_esign_connection'); assert.ok(write.args.p_credentials_ciphertext.startsWith('encrypted:')); assert.equal(h.calls.length, 0); assert.ok(!JSON.stringify(h.audits).includes('test-api-only'));
});
test('stale settings editor receives conflict without claiming a successful save', async () => {
  const h = harness({ profile: { platform_role: 'super_admin' }, casConflict: true });
  const response = await h.settings.PUT(h.request('PUT', { lawFirmId: OTHER, expectedConnectionId: null, companyId: 'company-new', templates: [template] }));
  assert.equal(response.status, 409); assert.match((await response.json()).error, /다른 관리자/); assert.equal(h.audits.length, 0); assert.equal(h.calls.length, 0);
});
test('actual migration preserves source data, gates both private tables/RPCs, retains versioned credentials and merges only e-sign fields', async () => {
  const { PGlite } = require(path.resolve(root, '../sms-sql-check/node_modules/@electric-sql/pglite')); const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create table public.law_firms(id uuid primary key); create table public.app_cases(id text primary key,law_firm_id uuid,data jsonb); grant select,update on public.app_cases to service_role;`);
    await db.query('insert into law_firms values ($1),($2)', [MAEIL, OTHER]); await db.query('insert into app_cases values ($1,$2,$3),($4,$5,$6)', ['legacy', MAEIL, { eformsignDocumentId: 'legacy-doc', memo: 'keep-original' }, 'other', OTHER, { eformsignDocumentId: 'untrusted-other', memo: 'keep-original' }]);
    const before = await db.query('select * from app_cases order by id');
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261018003510_firm_esign_connections.sql'), 'utf8'));
    assert.deepEqual((await db.query('select * from app_cases order by id')).rows, before.rows);
    assert.deepEqual((await db.query('select case_id,document_id from platform_firm_esign_documents')).rows, [{ case_id: 'legacy', document_id: 'legacy-doc' }]);
    for (const role of ['anon', 'authenticated']) { await db.exec('set role ' + role); for (const table of ['platform_firm_esign_connections', 'platform_firm_esign_documents']) { await assert.rejects(db.query('select * from ' + table), /permission denied/); await assert.rejects(db.query('delete from ' + table), /permission denied/); } await assert.rejects(db.query("select replace_firm_esign_connection($1,'co','cipher',$2,null,null)", [OTHER, [template]]), /permission denied/); await assert.rejects(db.query('select merge_firm_esign_case_metadata($1,$2,$3)', ['other', OTHER, {}]), /permission denied/); await db.exec('reset role'); }
    await db.exec('set role service_role');
    const first = (await db.query("select replace_firm_esign_connection($1,'co','cipher1',$2,null,null) as id", [OTHER, [template]])).rows[0].id;
    await db.query("select replace_firm_esign_connection($1,'co','cipher2',$2,null,$3)", [OTHER, [template], first]);
    const versions = await db.query('select id,active,credentials_ciphertext from platform_firm_esign_connections order by updated_at'); assert.equal(versions.rows.length, 2); assert.equal(versions.rows.find(r => r.id === first).active, false); assert.equal(versions.rows.filter(r => r.active).length, 1);
    const active = versions.rows.find(r => r.active).id; await assert.rejects(db.query("select replace_firm_esign_connection($1,'co','bad','[]',null,$2)", [OTHER, active]), /check constraint/); await assert.rejects(db.query("select replace_firm_esign_connection($1,'co','stale',$2,null,$3)", [OTHER, [template], first]), /ESIGN_CONNECTION_CONFLICT/); assert.equal((await db.query('select count(*)::int as n from platform_firm_esign_connections where active')).rows[0].n, 1);
    await db.query('select merge_firm_esign_case_metadata($1,$2,$3)', ['other', OTHER, { eformsignStatus: '서명완료' }]);
    assert.equal((await db.query("select data->>'memo' as memo from app_cases where id='other'")).rows[0].memo, 'keep-original');
    await assert.rejects(db.query('select merge_firm_esign_case_metadata($1,$2,$3)', ['other', OTHER, { memo: 'overwrite' }]), /Invalid e-sign/);
  } finally { await db.close(); }
});
