// Actual server authorization, audit helper and route with synthetic in-memory data only.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function harness({ role = 'super_admin', active = true, failure = null } = {}) {
  const database = {
    profiles: [{ id: 'actor', display_name: 'Synthetic actor', staff_name: 'Synthetic staff', email: 'actor@fixture.invalid', platform_role: role, role: role === 'staff' ? 'staff' : 'admin', is_active: active, law_firm_id: 'firm-a' }],
    law_firms: [{ id: 'firm-b', name: 'Synthetic firm', firm_code: '2222222222', status: 'active' }],
  };
  const attempts = [], saved = [], queries = [], logged = [];
  const admin = { auth: { getUser: async token => ({ data: { user: token === 'synthetic-session' ? { id: 'actor' } : null }, error: null }) },
    from(table) {
      assert.ok(['profiles', 'law_firms', 'platform_audit_logs'].includes(table), `Unexpected table ${table}`);
      if (table === 'platform_audit_logs') return { insert: async payload => {
        attempts.push(structuredClone(payload));
        if (failure === 'throw') throw new Error('Synthetic audit transport failure');
        if (failure === 'returned') return { error: new Error('Synthetic audit storage failure') };
        saved.push(structuredClone(payload));return { error: null };
      } };
      const filters = [];let columns;
      const query = { select(value) { columns = value;return query; }, eq(key, value) { filters.push([key, value]);return query; },
        async maybeSingle() { queries.push({ table, columns, filters });const row = database[table].find(row => filters.every(([key, value]) => row[key] === value));return { data: row ? structuredClone(row) : null, error: null }; } };
      return query;
    } };
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const requireFile = name => {
      if (name === '@/lib/supabase/admin') return { createAdminClient: () => admin };
      if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      if (name === 'crypto') return require('node:crypto');
      throw new Error(`Unexpected import ${name}`);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
      Error, Buffer, Date, console: { error: (...args) => logged.push(args[0]) }, process: { env: {} },
    }, { filename })(requireFile, module, module.exports);
    return module.exports;
  }
  const route = load('app/api/platform/firm-view/route.ts'), server = load('lib/platform/server.ts');
  function request(body = { lawFirmId: 'firm-b', action: 'enter' }, authenticated = true) {
    return new Request('https://fixture.invalid/api/platform/firm-view', { method: 'POST', headers: {
      ...(authenticated ? { authorization: 'Bearer synthetic-session' } : {}), 'content-type': 'application/json',
      'x-forwarded-for': '192.0.2.10, 198.51.100.1', 'user-agent': 'Synthetic agent',
    }, body: JSON.stringify(body) });
  }
  return { database, attempts, saved, queries, logged, admin, server, route, request };
}

test('successful firm entry returns only ok after the actual audit record is saved', async () => {
  const h = harness(), before = JSON.stringify(h.database);
  const response = await h.route.POST(h.request());
  assert.equal(response.status, 200);assert.deepEqual(await response.json(), { ok: true });
  assert.equal(h.saved.length, 1);
  assert.deepEqual(h.saved[0], {
    actor_user_id: 'actor', actor_name: 'Synthetic actor', actor_role: 'super_admin', law_firm_id: 'firm-b',
    action: 'superadmin.firm_view.enter', target_type: 'law_firm', target_id: 'firm-b',
    detail: { firmName: 'Synthetic firm', firmCode: '2222222222', firmStatus: 'active' },
    ip_hash: createHash('sha256').update('audit-ip:192.0.2.10').digest('hex'), user_agent: 'Synthetic agent',
  });
  assert.equal(JSON.stringify(h.database), before);assert.equal(h.logged.length, 0);
});

for (const failure of ['returned', 'throw']) test(`required audit ${failure} failure denies firm entry and leaves business data untouched`, async () => {
  const h = harness({ failure }), before = JSON.stringify(h.database);
  const response = await h.route.POST(h.request()), body = await response.json();
  assert.notEqual(response.status, 200);assert.ok(response.status >= 400);assert.match(body.error, /열람 기록을 남기지 못했습니다/);
  assert.equal(body.ok, undefined);assert.equal(h.attempts.length, 1);assert.equal(h.saved.length, 0);
  assert.equal(JSON.stringify(h.database), before);assert.equal(h.logged.length, 1);
});

test('staff, firm managers, inactive profiles and missing sessions cannot read a target firm or write an audit', async () => {
  for (const config of [{ role: 'staff' }, { role: 'firm_admin' }, { active: false }, { authenticated: false }]) {
    const h = harness(config), before = JSON.stringify(h.database);
    const response = await h.route.POST(h.request(undefined, config.authenticated !== false));
    assert.equal(response.status, config.authenticated === false ? 401 : 403);
    assert.equal(h.queries.filter(query => query.table === 'law_firms').length, 0);assert.equal(h.attempts.length, 0);
    assert.equal(JSON.stringify(h.database), before);
  }
});

test('missing firm is not audited and explicit exit retains its existing action and response shape', async () => {
  const h = harness(), before = JSON.stringify(h.database);
  const missing = await h.route.POST(h.request({ lawFirmId: 'unknown', action: 'enter' }));
  assert.ok(missing.status >= 400);assert.equal(h.attempts.length, 0);
  const exit = await h.route.POST(h.request({ lawFirmId: 'firm-b', action: 'exit' }));
  assert.equal(exit.status, 200);assert.deepEqual(await exit.json(), { ok: true });assert.equal(h.saved[0].action, 'superadmin.firm_view.exit');
  assert.equal(JSON.stringify(h.database), before);
});

test('default optional audit remains best effort so unrelated existing commands do not change behavior', async () => {
  const h = harness({ failure: 'returned' });
  await assert.doesNotReject(h.server.writePlatformAudit(h.admin, h.request(), h.database.profiles[0], { action: 'synthetic.other', targetType: 'fixture' }));
  assert.equal(h.saved.length, 0);assert.equal(h.attempts.length, 1);assert.equal(h.logged.length, 1);
});
