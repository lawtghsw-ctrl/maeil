// Synthetic fixtures only. Supabase queries are mocked; no credentials or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText;
  const requireFile = name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = ['.ts', '.tsx', ''].map(ext => target + ext).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!resolved) throw new Error(`Missing local module: ${name}`);
      return load(resolved, mocks, cache);
    }
    return require(name);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
    Date, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: () => { throw new Error('Network is forbidden'); },
  }, { filename })(requireFile, module, module.exports);
  return module.exports;
}

const firm = 'synthetic-firm-a', otherFirm = 'synthetic-firm-b';
const auth = {
  requirePlatformUser: async () => { throw new Error('UNAUTHORIZED'); },
  platformError: error => ({ status: error.message === 'UNAUTHORIZED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 400, message: error.message }),
};
const server = load('lib/firm-reporting-server.ts', { '@/lib/platform/server': auth });
const ledger = (id, date, patch = {}) => ({ id, law_firm_id: firm, lead_id: 'synthetic-lead', supplied_at: date, billable: true, unit_price_snapshot: 100, classification: 'new', origin: 'ingest', ...patch });

function database(tables = {}, ignoreScope = false) {
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.maximum = Infinity; }
    select(columns) { this.columns = columns; return this; }
    eq(key, value) { this.filters.push({ key, value, op: 'eq' }); return this; }
    gt(key, value) { this.filters.push({ key, value, op: 'gt' }); return this; }
    order(key) { this.orderKey = key; return this; }
    limit(value) { this.maximum = value; return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve, reject) {
      calls.push({ table: this.table, columns: this.columns, filters: this.filters });
      let rows = (tables[this.table] ?? []).filter(row => this.filters.every(filter =>
        ignoreScope && filter.key === 'law_firm_id' || (filter.op === 'eq' ? row[filter.key] === filter.value : row[filter.key] > filter.value)));
      rows = rows.slice().sort((a, b) => String(a[this.orderKey] ?? '').localeCompare(String(b[this.orderKey] ?? ''))).slice(0, Math.min(this.maximum, 2));
      rows = rows.map(row => Object.fromEntries(this.columns.split(',').map(column => {
        const alias = column.match(/^([^:]+):data->>(.+)$/);
        return alias ? [alias[1], row.data?.[alias[2]] ?? null] : [column, row[column]];
      })));
      return Promise.resolve({ data: this.single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
    }
  }
  return { admin: { from: table => new Query(table) }, calls };
}

test('ordinary ranges retain the 366-day limit while cumulative ranges validate actual days and normalize their first month', () => {
  assert.throws(() => server.firmSupplyRange('2024-01-15', '2026-10-31'), /366/);
  assert.deepEqual({ ...server.firmSupplyRange('2024-01-15', '2026-10-31', true) }, { start: '2024-01-01', end: '2026-10-31' });
  for (const [start, end] of [
    ['', '2026-10-31'], ['2026-02-30', '2026-10-31'], ['2026-10-01', '2026-13-01'],
    ['2026-11-01', '2026-10-31'], ['2026-10-01T00:00:00Z', '2026-10-31'], ['2026-1-01', '2026-10-31'],
  ]) assert.throws(() => server.firmSupplyRange(start, end, true), /올바른 기간/);
  assert.throws(() => server.firmSupplyRange('1800-01-01', '1899-12-31', true), /기준일/);
  assert.throws(() => server.firmSupplyRange('2024-01-01', `${new Date().getUTCFullYear() + 2}-01-01`, true), /기준일/);
});

test('cumulative supply includes the oldest real delivery month in KST, counts repeated deliveries without duplicating conversion DB', async () => {
  const tables = {
    lead_supply_ledger: [
      ledger('a', '2024-01-31T15:00:00Z'), // February 1 KST.
      ledger('b', '2025-09-20T12:00:00+09:00'),
      ledger('c', '2026-10-31T15:00:00Z'), // November 1 KST, outside cutoff.
    ],
    app_leads: [{ id: 'synthetic-lead', law_firm_id: firm, data: { assignedStaff: 'Synthetic staff' } }],
    // Current valid-retainer cohort semantics deliberately remain unchanged.
    app_cases: [{ id: 'synthetic-contract', law_firm_id: firm, data: { fromLeadId: 'synthetic-lead', status: '진행중', contractAmount: 100, contractDate: '2026-11-05' } }],
    platform_supply_adjustments: [{ id: 'replacement', law_firm_id: firm, kind: 'replacement', event_date: '2024-02-10', quantity: 2 }],
    platform_firm_commercial_profiles: [{ law_firm_id: firm, service_mode: 'db_supply' }],
  };
  const before = JSON.stringify(tables), db = database(tables);
  const result = await server.readFirmSupply(db.admin, firm, '2025-08-01', '2026-10-31', true);
  assert.equal(result.start, '2024-02-01');
  assert.equal(result.end, '2026-10-31');
  assert.equal(result.suppliedCount, 2);
  assert.equal(result.purchaseCost, 200);
  assert.equal(result.replacedCount, 2);
  assert.equal(result.supplyCohort.supplied, 1);
  assert.equal(result.supplyCohort.retained, 1, 'current valid retainer semantics must not become cutoff snapshots');
  assert.equal(result.periodContracts.total, 0, 'contract-date totals remain bounded by selected end');
  assert.equal(JSON.stringify(tables), before);
  assert.ok(db.calls.every(call => call.filters.some(filter => filter.key === 'law_firm_id' && filter.value === firm)));
  assert.ok(db.calls.every(call => !call.columns.includes('*')));
});

test('future-only deliveries and empty data use the selected month, never a caller-supplied epoch', async () => {
  const future = database({ lead_supply_ledger: [ledger('future', '2027-01-01')] });
  const result = await server.readFirmSupply(future.admin, firm, '2026-10-14', '2026-10-31', true);
  assert.equal(result.start, '2026-10-01');
  assert.equal(result.suppliedCount, 0);
  const empty = await server.readFirmSupply(database().admin, firm, '0001-01-01', '2026-10-31', true);
  assert.equal(empty.start, '2026-10-01');
  assert.equal(empty.suppliedCount, 0);
});

test('noncumulative reads keep the requested range even when older deliveries exist', async () => {
  const db = database({ lead_supply_ledger: [ledger('old', '2024-01-15'), ledger('selected', '2026-10-15')] });
  const result = await server.readFirmSupply(db.admin, firm, '2026-10-10', '2026-10-31');
  assert.equal(result.start, '2026-10-10');
  assert.equal(result.suppliedCount, 1);
  assert.equal(db.calls.some(call => call.table === 'app_installments'), false, 'ordinary requests must not add an unnecessary payments read');
});

test('cumulative start is derived from actual tenant source dates even when caller start is too early or too late', async () => {
  const sources = [
    { lead_supply_ledger: [ledger('actual', '2024-03-10')] },
    { app_cases: [{ id: 'actual', law_firm_id: firm, data: { contractDate: '2024-03-10', contractAmount: 100, status: '진행중' } }] },
    { app_leads: [{ id: 'actual', law_firm_id: firm, data: { receivedAt: '2024-03-10T15:00:00Z' } }] },
    { platform_supply_adjustments: [{ id: 'actual', law_firm_id: firm, event_date: '2024-03-10', kind: 'replacement', quantity: 1 }] },
    { app_installments: [{ id: 'actual', law_firm_id: firm, data: { paidDate: '2024-03-10', status: '완료' } }, { id: 'scheduled', law_firm_id: firm, data: { paidDate: '2000-01-01', status: '예정' } }] },
  ];
  for (const tables of sources) {
    for (const requestedStart of ['0001-01-01', '2026-10-01']) {
      const db = database(tables);
      const result = await server.readFirmSupply(db.admin, firm, requestedStart, '2026-10-31', true);
      assert.equal(result.start, '2024-03-01');
      assert.ok(db.calls.every(call => call.filters.some(filter => filter.key === 'law_firm_id' && filter.value === firm)));
    }
  }
});

test('actual history beyond 1200 months fails explicitly instead of truncating or expanding unbounded cost loops', async () => {
  const inside = database({ app_leads: [{ id: 'boundary', law_firm_id: firm, data: { receivedAt: '1926-11-01' } }] });
  assert.equal((await server.readFirmSupply(inside.admin, firm, '2026-10-01', '2026-10-31', true)).start, '1926-11-01');
  const outside = database({ app_leads: [{ id: 'outside', law_firm_id: firm, data: { receivedAt: '1926-10-31' } }] });
  await assert.rejects(() => server.readFirmSupply(outside.admin, firm, '2026-10-01', '2026-10-31', true), /100년 범위를 초과/);
});

test('cumulative reads reject leaked foreign-tenant rows before using their historical dates', async () => {
  const db = database({ lead_supply_ledger: [ledger('foreign', '2020-01-01', { law_firm_id: otherFirm })] }, true);
  await assert.rejects(() => server.readFirmSupply(db.admin, firm, '2026-10-01', '2026-10-31', true), /FORBIDDEN/);
});

test('API only relaxes the range comparison for explicit cumulative=true, preserving role and firm checks', async () => {
  let actor = { platform_role: 'firm_admin', role: 'admin', law_firm_id: firm };
  const db = database();
  const route = load('app/api/admin/firm-supply/route.ts', {
    '@/lib/platform/server': { ...auth, requirePlatformUser: async (_request, roles) => {
      assert.deepEqual(Array.from(roles), ['super_admin', 'firm_admin', 'staff']);
      if (!actor) throw new Error('UNAUTHORIZED');
      return { admin: db.admin, profile: actor };
    } },
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200, headers: options?.headers }) } },
  });
  const request = (suffix = '', id = firm) => ({ nextUrl: new URL(`https://offline.invalid/api/admin/firm-supply?firmId=${id}&start=2024-01-01&end=2026-10-31${suffix}`) });
  assert.equal((await route.GET(request())).status, 400);
  assert.equal((await route.GET(request('&cumulative=false'))).status, 400);
  assert.equal((await route.GET(request('&cumulative=1'))).status, 400);
  const valid = await route.GET(request('&cumulative=true'));
  assert.equal(valid.status, 200);
  assert.equal(valid.headers['Cache-Control'], 'private, no-store');
  assert.equal(valid.body.start, '2026-10-01');
  assert.equal((await route.GET(request('&cumulative=true', otherFirm))).status, 403);
  actor = { platform_role: 'staff', role: 'staff', law_firm_id: firm };
  assert.equal((await route.GET(request('&cumulative=true'))).status, 403);
  actor = null;
  assert.equal((await route.GET(request('&cumulative=true'))).status, 401);
});

test('hook request and cache identity include cumulative mode and stale mode response cannot overwrite the new view', async () => {
  let state, dependencies, pendingEffect, cleanup;
  const requests = [];
  const { useFirmSupply } = load('lib/use-firm-supply.ts', {
    react: {
      useState: initial => { if (!state) state = initial; return [state, value => { state = value; }]; },
      useEffect: (effect, next) => { if (!dependencies || next.some((value, index) => value !== dependencies[index])) { dependencies = next; pendingEffect = effect; } },
    },
    '@/lib/platform/client': { authJson: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) },
  });
  const render = cumulative => {
    const result = useFirmSupply(firm, '2024-01-01', '2026-10-31', true, 0, cumulative);
    if (pendingEffect) { cleanup?.(); const effect = pendingEffect; pendingEffect = null; cleanup = effect(); }
    return result;
  };
  render(false);
  assert.equal(new URL(requests[0].url, 'https://offline.invalid').searchParams.has('cumulative'), false);
  const cumulative = render(true);
  assert.equal(cumulative.loading, true);
  assert.equal(cumulative.data, null);
  assert.equal(new URL(requests[1].url, 'https://offline.invalid').searchParams.get('cumulative'), 'true');
  assert.equal(requests[0].init.signal.aborted, true);
  requests[1].resolve({ mode: 'cumulative' });
  await Promise.resolve(); await Promise.resolve();
  requests[0].resolve({ mode: 'old period' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(render(true).data.mode, 'cumulative');
  cleanup?.();
});
