// Fully synthetic/offline. These tests never connect to Supabase or mutate data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const TABLES = { leads: 'app_leads', cases: 'app_cases', clients: 'app_clients', installments: 'app_installments' };

function load(file, mocks = {}, globals = {}, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText;
  const requireFile = name => {
    if (name in mocks) return mocks[name];
    if (!name.startsWith('.') && !name.startsWith('@/')) throw new Error(`Unexpected external module: ${name}`);
    const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
    const resolved = ['.ts', '.tsx', ''].map(ext => target + ext).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Missing local module: ${name}`);
    return load(resolved, mocks, globals, cache);
  };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    Date, Intl, URL, URLSearchParams, AbortController, Error, Buffer, setTimeout, clearTimeout,
    fetch: () => { throw new Error('Network forbidden'); }, ...globals,
  }, { filename })(requireFile, module, module.exports);
  return module.exports;
}

function fixtureDatabase({ size = 0, cap = 500, brokenTable, brokenAfter = -1, foreignTable, malformedTable, duplicateTable, firmStatus = 'active', noFirm = false } = {}) {
  const calls = [];
  const entities = Object.fromEntries(Object.values(TABLES).map(table => [table, Array.from({ length: size }, (_, index) => ({
    id: `${String(index).padStart(6, '0')}`, law_firm_id: 'firm-a',
    data: { id: `spoof-${index}`, name: `Synthetic ${index}`, _lawFirmId: 'untrusted-firm', _lawFirmName: 'untrusted-name', law_firm_id: 'untrusted-firm', actualPaidAmount: index },
  }))]));
  const admin = { from(table) {
    const state = { table, equals: [], after: undefined, maximum: undefined, columns: undefined, order: undefined };
    const query = {
      select(columns) { state.columns = columns; return this; },
      eq(column, value) { state.equals.push([column, value]); return this; },
      order(column, options) { state.order = [column, options]; return this; },
      limit(value) { state.maximum = value; return this; },
      gt(column, value) { assert.equal(column, 'id'); state.after = value; return this; },
      async maybeSingle() {
        calls.push({ ...state, single: true });
        assert.equal(table, 'law_firms');
        return { data: noFirm ? null : { id: 'firm-a', name: 'Synthetic firm', status: firmStatus }, error: null };
      },
      then(resolve, reject) {
        try {
          assert.ok(table in entities, `Only intended read tables allowed: ${table}`);
          assert.equal(state.columns, 'id,data,law_firm_id');
          assert.deepEqual(Array.from(state.equals, item => Array.from(item)), [['law_firm_id', 'firm-a']]);
          assert.equal(state.order[0], 'id'); assert.equal(state.order[1].ascending, true);
          assert.equal(state.maximum, 50);
          const after = state.after === undefined ? -1 : Number(state.after);
          if (table === brokenTable && after >= brokenAfter) {
            calls.push({ ...state, error: true }); return Promise.resolve({ data: null, error: { message: 'Synthetic read failure' } }).then(resolve, reject);
          }
          let rows = entities[table].filter(row => state.after === undefined || row.id > state.after).slice(0, Math.min(state.maximum, cap));
          if (rows.length && table === foreignTable) rows = [{ ...rows[0], law_firm_id: 'firm-b' }, ...rows.slice(1)];
          if (rows.length && table === malformedTable) rows = [{ ...rows[0], data: null }, ...rows.slice(1)];
          if (rows.length > 1 && table === duplicateTable && state.after === undefined) rows = [rows[0], { ...rows[0] }, ...rows.slice(2)];
          calls.push({ ...state, returned: rows.length });
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return query;
  } };
  return { admin, calls, entities };
}

function routeHarness(options = {}, profile = { platform_role: 'firm_admin', role: 'admin', law_firm_id: 'firm-a' }, authError) {
  const db = fixtureDatabase(options); let authCalls = 0;
  const route = load('app/api/admin/analytics-source/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers }) } },
    '@/lib/platform/server': {
      requirePlatformUser: async (_request, allowed) => {
        authCalls++; assert.deepEqual(Array.from(allowed), ['super_admin', 'firm_admin', 'staff']);
        if (authError) throw new Error(authError);
        return { admin: db.admin, profile };
      },
      platformError: error => ({ status: error.message === 'UNAUTHORIZED' ? 401 : ['FORBIDDEN', 'NO_FIRM', 'FIRM_SUSPENDED'].includes(error.message) ? 403 : 400, message: error.message }),
    },
  });
  return { ...db, route, get authCalls() { return authCalls; },
    get: (query = 'firmId=firm-a&entity=leads') => route.GET({ nextUrl: new URL(`https://synthetic.invalid/api/admin/analytics-source?${query}`) }) };
}

function clientModule(authJson) {
  return load('lib/use-analytics-source.ts', { react: {}, '@/lib/platform/client': { authJson } });
}
function routeClient(harness) {
  return clientModule(async (url, init) => {
    assert.equal(init.cache, 'no-store');
    const response = await harness.get(new URL(url, 'https://synthetic.invalid').search.slice(1));
    if (response.status !== 200) throw new Error(response.body.error);
    return response.body;
  });
}

test('HTTP transport reads 1,107 rows in all four entities without giant responses or short-page truncation', async () => {
  const harness = routeHarness({ size: 1107, cap: 37 });
  const client = routeClient(harness);
  const data = await client.fetchAnalyticsSource('firm-a', new AbortController().signal);
  assert.equal(data.complete, true); assert.equal(data.firmId, 'firm-a');
  assert.equal(client.isCompleteAnalyticsSource(data, 'firm-a'), true);
  for (const [key, table] of Object.entries(TABLES)) {
    assert.equal(data[key].length, 1107); assert.equal(data.counts[key], 1107);
    assert.equal(new Set(data[key].map(row => row.id)).size, 1107);
    assert.equal(data[key][1106].id, '001106');
    const queries = harness.calls.filter(call => call.table === table);
    assert.equal(queries.length, 31); assert.equal(queries.at(-1).returned, 0);
    assert.equal(queries[1].after, '000036');
    assert.ok(queries.every(query => query.returned <= 37));
    assert.equal(data[key][0]._lawFirmId, 'firm-a'); assert.equal(data[key][0]._lawFirmName, 'Synthetic firm');
    assert.equal(data[key][0].law_firm_id, undefined);
  }
  assert.equal(harness.authCalls, 124, 'authentication is checked on every transport page');
  assert.equal(harness.entities.app_leads[0].data.id, 'spoof-0', 'source JSON remains unchanged');
  const response = await harness.get();
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(response.body.count, 37); assert.equal(response.body.complete, false);
  assert.equal(response.body.cursor, null); assert.equal(response.body.nextCursor, '000036');
  assert.equal(response.body.leads, undefined, 'never return all four full arrays in a transport page');
  assert.equal(harness.route.dynamic, 'force-dynamic'); assert.equal(harness.route.revalidate, 0); assert.equal(harness.route.fetchCache, 'force-no-store');
});

test('each manager role is scoped on every page; staff, foreign firm, bad entity and malformed cursor fail before source reads', async () => {
  for (const profile of [
    { platform_role: 'firm_admin', role: 'staff', law_firm_id: 'firm-a' },
    { platform_role: 'staff', role: 'admin', law_firm_id: 'firm-a' },
    { platform_role: 'super_admin', role: 'staff', law_firm_id: null },
  ]) assert.equal((await routeHarness({}, profile).get()).status, 200);
  const staff = routeHarness({}, { platform_role: 'staff', role: 'staff', law_firm_id: 'firm-a' });
  assert.equal((await staff.get()).status, 403); assert.equal(staff.calls.length, 0);
  for (const query of ['firmId=firm-b&entity=leads', 'firmId=firm-a&entity=profiles', 'firmId=firm-a&entity=__proto__',
    'firmId=firm-a', 'firmId=firm-a&entity=leads&after=bad%20cursor']) {
    const harness = routeHarness(); assert.notEqual((await harness.get(query)).status, 200); assert.equal(harness.calls.length, 0);
  }
  const superAdmin = routeHarness({}, { platform_role: 'super_admin' });
  assert.equal((await superAdmin.get('entity=leads')).status, 400);
  assert.equal((await routeHarness({}, undefined, 'UNAUTHORIZED').get()).status, 401);
  assert.equal((await routeHarness({ firmStatus: 'suspended' }).get()).status, 403);
  assert.equal((await routeHarness({ noFirm: true }).get()).status, 403);
  assert.equal((await routeHarness({ firmStatus: 'suspended' }, { platform_role: 'super_admin' }).get()).status, 200);
});

test('foreign, malformed, duplicate, and later-page failures never resolve a partial completed source', async () => {
  for (const options of [{ foreignTable: 'app_installments' }, { malformedTable: 'app_clients' },
    { duplicateTable: 'app_cases' }, { brokenTable: 'app_leads', brokenAfter: 500 }]) {
    const harness = routeHarness({ size: 1107, cap: 37, ...options });
    await assert.rejects(routeClient(harness).fetchAnalyticsSource('firm-a', new AbortController().signal));
  }
});

test('empty end marker and oversized individual records fail safely under a bounded payload', async () => {
  const empty = await routeHarness().get();
  assert.equal(empty.body.complete, true); assert.equal(empty.body.count, 0);
  assert.equal(empty.body.nextCursor, null); assert.equal(empty.body.cursor, null);
  const huge = routeHarness({ size: 1 });
  huge.entities.app_leads[0].data.memo = '가'.repeat(750000);
  const response = await huge.get();
  assert.equal(response.status, 413); assert.equal(response.body.rows, undefined);
  assert.match(response.body.error, /너무 커서/);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  const source = fs.readFileSync(path.join(root, 'app/api/admin/analytics-source/route.ts'), 'utf8');
  assert.doesNotMatch(source, /\.\s*(insert|update|upsert|delete|rpc)\s*\(/);
  assert.doesNotMatch(source, /export\s+(?:async\s+)?function\s+(POST|PATCH|DELETE|PUT)/);
});

function pageFor(url, rows = [], overrides = {}) {
  const params = new URL(url, 'https://synthetic.invalid').searchParams;
  return { firmId: params.get('firmId'), entity: params.get('entity'), cursor: params.get('after'),
    rows, count: rows.length, complete: rows.length === 0, nextCursor: rows.length ? rows.at(-1).id : null, ...overrides };
}

test('client refuses forged count, early-complete, scope, cursor skips, backwards rows, and missing end marker', async () => {
  for (const corrupt of [
    page => { page.count++; }, page => { page.complete = true; }, page => { page.firmId = 'foreign'; },
    page => { page.entity = 'profiles'; }, page => { page.cursor = 'skip'; }, page => { page.nextCursor = 'skip'; },
    page => { page.rows[0]._lawFirmId = 'foreign'; }, page => { page.rows = [page.rows[0], page.rows[0]]; page.count = 2; },
  ]) {
    const client = clientModule(async url => {
      const page = pageFor(url, [{ id: '000001', _lawFirmId: 'firm-a' }]); corrupt(page); return page;
    });
    await assert.rejects(client.fetchAnalyticsSource('firm-a', new AbortController().signal));
  }
  const noEnd = clientModule(async url => pageFor(url, [], { complete: false }));
  await assert.rejects(noEnd.fetchAnalyticsSource('firm-a', new AbortController().signal), /마지막 페이지/);
  const backwards = clientModule(async url => pageFor(url, [{ id: '000001', _lawFirmId: 'firm-a' }]));
  await assert.rejects(backwards.fetchAnalyticsSource('firm-a', new AbortController().signal), /페이지 순서/);
});

function hookHarness() {
  const state = [], requests = [], timers = new Map();
  let cursor = 0, deps, pendingEffect, cleanup, timerId = 0;
  const module = load('lib/use-analytics-source.ts', {
    react: {
      useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
      useEffect: (effect, nextDeps) => { if (!deps || nextDeps.some((item, index) => item !== deps[index])) { deps = nextDeps; pendingEffect = effect; } },
    },
    '@/lib/platform/client': { authJson: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })) },
  }, {
    setTimeout: (fn, delay) => { assert.equal(delay, 30000); const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return { requests, module, timers,
    render(firmId = 'firm-a', enabled = true, revision = 0, token = '') {
      cursor = 0; const output = module.useAnalyticsSource(firmId, enabled, revision, token);
      if (pendingEffect) { cleanup?.(); const effect = pendingEffect; pendingEffect = undefined; cleanup = effect(); }
      return output;
    },
    timeout() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    unmount() { cleanup?.(); },
  };
}
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
function endRequests(requests) { for (const request of requests) request.resolve(pageFor(request.url)); }

test('hook exposes no partial data until all entity end pages, including short-page continuation', async () => {
  const harness = hookHarness(); assert.equal(harness.render().loading, true); assert.equal(harness.requests.length, 4);
  const first = harness.requests.slice();
  first[0].resolve(pageFor(first[0].url, [{ id: '000001', _lawFirmId: 'firm-a' }]));
  endRequests(first.slice(1)); await settle();
  assert.equal(harness.requests.length, 5); assert.match(harness.requests[4].url, /after=000001/);
  assert.equal(harness.render().data, null); assert.equal(harness.render().loading, true);
  endRequests(harness.requests.slice(4)); await settle();
  const result = harness.render(); assert.equal(result.loading, false); assert.equal(result.data.complete, true);
  assert.equal(result.data.counts.leads, 1); assert.equal(result.data.counts.cases, 0);
  assert.equal(harness.requests.length, 5); assert.equal(harness.timers.size, 0);
});

test('scope switching and disable cancel all pages, hide old source, and reject late previous-scope responses', async () => {
  const harness = hookHarness(); harness.render(); endRequests(harness.requests.slice()); await settle();
  assert.ok(harness.render().data);
  let result = harness.render('firm-b'); assert.equal(result.data, null); assert.equal(result.loading, true);
  assert.equal(harness.requests.length, 8); assert.ok(harness.requests.slice(0, 4).every(request => request.init.signal.aborted));
  harness.render('firm-a'); assert.equal(harness.requests.length, 12);
  endRequests(harness.requests.slice(4, 8)); await settle(); assert.equal(harness.render().data, null);
  endRequests(harness.requests.slice(8, 12)); await settle(); assert.equal(harness.render().data.firmId, 'firm-a');
  result = harness.render('firm-a', false); assert.equal(result.data, null); assert.equal(result.loading, false);
  assert.ok(harness.requests.slice(8, 12).every(request => request.init.signal.aborted));
});

test('revision/token/manual retry restart all pages; a single error aborts peers and never publishes partial arrays', async () => {
  const harness = hookHarness(); harness.render(); endRequests(harness.requests.slice()); await settle();
  assert.equal(harness.render('firm-a', true, 1).data, null); assert.equal(harness.requests.length, 8);
  endRequests(harness.requests.slice(4, 7)); harness.requests[7].reject(new Error('Synthetic page failure')); await settle();
  let result = harness.render('firm-a', true, 1); assert.equal(result.data, null); assert.match(result.error, /Synthetic page failure/);
  assert.ok(harness.requests.slice(4, 8).every(request => request.init.signal.aborted));
  harness.render('firm-a', true, 1); assert.equal(harness.requests.length, 8);
  result.retry(); result = harness.render('firm-a', true, 1); assert.equal(result.error, null); assert.equal(result.loading, true);
  endRequests(harness.requests.slice(8, 12)); await settle(); assert.equal(harness.render('firm-a', true, 1).data.complete, true);
  assert.equal(harness.render('firm-a', true, 1, 'after-edit').data, null); assert.equal(harness.requests.length, 16);
  harness.unmount(); assert.ok(harness.requests.slice(12).every(request => request.init.signal.aborted)); assert.equal(harness.timers.size, 0);
});

test('overall 30-second timeout aborts all pages and ignores late data; retry starts from first cursor', async () => {
  const harness = hookHarness(); harness.render(); harness.timeout();
  let result = harness.render(); assert.equal(result.loading, false); assert.equal(result.data, null); assert.match(result.error, /시간이 초과/);
  assert.ok(harness.requests.every(request => request.init.signal.aborted));
  endRequests(harness.requests.slice()); await settle(); assert.equal(harness.render().data, null);
  result.retry(); result = harness.render(); assert.equal(result.loading, true); assert.equal(result.error, null);
  assert.ok(harness.requests.slice(4).every(request => !request.url.includes('after=')));
  endRequests(harness.requests.slice(4)); await settle(); assert.equal(harness.render().data.complete, true);
});

test('final count and stamp validation remain strict; disabled hooks never request data', () => {
  const harness = hookHarness(); assert.equal(harness.render('firm-a', false).loading, false);
  assert.equal(harness.render('', true).loading, false); assert.equal(harness.requests.length, 0);
  const source = { firmId: 'firm-a', complete: true, loadedAt: '2026-10-28T00:00:00Z',
    counts: { leads: 0, cases: 0, clients: 0, installments: 0 }, leads: [], cases: [], clients: [], installments: [] };
  assert.equal(harness.module.isCompleteAnalyticsSource(source, 'firm-a'), true);
  source.counts.leads = 1; assert.equal(harness.module.isCompleteAnalyticsSource(source, 'firm-a'), false);
  source.leads.push({ id: 'x', _lawFirmId: 'foreign' }); assert.equal(harness.module.isCompleteAnalyticsSource(source, 'firm-a'), false);
});

