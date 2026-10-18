// Synthetic, offline data only. No connected database or external requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  }).outputText;
  const requireFile = name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('.') || name.startsWith('@/')) {
      const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = ['.ts', '.tsx', ''].map(ext => target + ext).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!resolved) throw new Error(`Missing local module: ${name}`);
      return load(resolved, mocks, cache);
    }
    return require(name);
  };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    Date, Intl, URL, URLSearchParams, Request, Response, AbortController, setTimeout, clearTimeout,
    fetch: () => { throw new Error('Network is forbidden'); },
  }, { filename })(requireFile, module, module.exports);
  return module.exports;
}
const performance = load('lib/performance/firm.ts');
const portfolio = load('lib/performance/portfolio.ts');
const { getRetainedLeadIds } = load('lib/performance/lead-retainer-conversion.ts');
const start = '2026-10-01', end = '2026-10-31', now = new Date('2026-12-01T00:00:00Z');
const scope = { firmId: 'firm-a', firmName: 'Fixture firm' };
const lead = (id, patch = {}) => ({ id, name: `Synthetic ${id}`, assignedStaff: 'A', receivedAt: '2026-10-10T12:00:00+09:00', status: '신규접수', _lawFirmId: 'firm-a', ...patch });
const contract = (id, fromLeadId, patch = {}) => ({ id, fromLeadId, clientId: `client-${fromLeadId}`, assignedStaff: 'A', contractDate: '2026-10-10', contractAmount: 100, paidAmount: 0, status: '진행중', caseType: '개인회생', stage: '서류준비', _lawFirmId: 'firm-a', ...patch });
function fixture() {
  const leads = [
    lead('one', { receivedAt: '2026-09-30T15:00:00Z', convertedClientId: 'client-one', convertedCaseId: 'later-one' }),
    lead('two'),
    lead('three', { assignedStaff: 'B', convertedClientId: 'client-three', convertedCaseId: 'zero-three' }),
    lead('four', { assignedStaff: 'B', convertedClientId: 'client-four', convertedCaseId: 'cancelled-four' }),
    lead('five', { assignedStaff: 'B' }),
    lead('previous', { receivedAt: '2026-09-15', convertedClientId: 'client-previous' }),
    lead('older', { receivedAt: '2026-08-01' }),
    lead('future-intake', { receivedAt: '2026-10-31T15:00:00Z' }),
  ];
  const cases = [
    contract('later-one', 'one', { contractDate: '2026-11-01' }),
    contract('another-one', 'one', { contractDate: '2026-11-02' }),
    contract('current-two', 'two', { assignedStaff: 'B', contractAmount: 200 }),
    contract('zero-three', 'three', { contractAmount: 0 }),
    contract('cancelled-four', 'four', { status: '취하' }),
    contract('later-previous', 'previous', { contractDate: '2026-11-03' }),
    contract('current-older', 'older', { contractAmount: 300 }),
    contract('future-contract', 'future-intake', { contractDate: '2026-11-01' }),
  ];
  return { leads, cases, clients: leads.map(row => ({ id: `client-${row.id}`, name: row.name })),
    installments: [{ id: 'receipt', caseId: 'current-two', amount: 100, actualPaidAmount: 70, status: '완료', paidDate: '2026-10-12' }], staffNames: ['A', 'B', 'No activity'] };
}
function report(input = fixture(), staff) { return performance.buildFirmPerformanceReport(input, start, end, scope, staff, now); }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
function metric(row) { return { db: row.db, contractedDb: row.contractedDb, contractConversionRate: row.contractConversionRate }; }

test('intake-cohort contract conversion is distinct from client conversion and contract-date sales', () => {
  const input = freeze(fixture()), before = JSON.stringify(input), result = report(input);
  assert.deepEqual(metric(result.summary), { db: 5, contractedDb: 2, contractConversionRate: 40 });
  assert.equal(result.summary.converted, 3); assert.equal(result.summary.conversionRate, 60);
  assert.equal(result.summary.contracts, 2); assert.equal(result.summary.contractAmount, 500); assert.equal(result.summary.cash, 70);
  assert.equal(result.trend.reduce((sum, day) => sum + day.db, 0), 5);
  assert.equal(result.trend.reduce((sum, day) => sum + day.converted, 0), 3);
  assert.equal(result.trend.reduce((sum, day) => sum + day.contracts, 0), 2);
  assert.equal(result.quality.duplicateCases, 0);
  assert.equal(JSON.stringify(input), before);
});

test('cohort staff attribution follows the DB owner and compares the previous intake cohort', () => {
  const input = fixture(), all = report(input), a = report(input, 'A'), b = report(input, 'B');
  assert.deepEqual(metric(a.summary), { db: 2, contractedDb: 2, contractConversionRate: 100 });
  assert.deepEqual(metric(b.summary), { db: 3, contractedDb: 0, contractConversionRate: 0 });
  assert.deepEqual(metric(all.previous), { db: 1, contractedDb: 1, contractConversionRate: 100 });
  // A's DB converted through B's contract, while contract-date performance keeps its existing owner.
  assert.equal(a.summary.contracts, 1); assert.equal(b.summary.contracts, 1);
  assert.equal(a.summary.cash, 0); assert.equal(b.summary.cash, 70);
  assert.deepEqual(metric(all.staff.find(row => row.name === 'A')), metric(a.summary));
  assert.deepEqual(metric(all.staff.find(row => row.name === 'B')), metric(b.summary));
  assert.deepEqual(metric(all.staff.find(row => row.name === 'No activity')), { db: 0, contractedDb: 0, contractConversionRate: 0 });
  assert.deepEqual(structuredClone(a.staff), structuredClone(all.staff));
});

test('invalid or out-of-period intake and duplicate records cannot inflate the conversion numerator', () => {
  const input = fixture();
  input.leads.push({ ...input.leads[0] }, lead('bad-date', { receivedAt: '2026-02-30' }));
  input.cases.push({ ...input.cases[0] }, contract('bad-date-case', 'bad-date', { contractDate: '2026-11-01' }));
  const result = report(freeze(input));
  assert.deepEqual(metric(result.summary), { db: 5, contractedDb: 2, contractConversionRate: 40 });
  assert.equal(result.quality.duplicateLeads, 1); assert.equal(result.quality.duplicateCases, 1); assert.equal(result.quality.invalidLeadDates, 1);
  assert.equal(result.summary.contracts, 2);
  const empty = report({ leads: [], cases: [], clients: [], installments: [] });
  assert.deepEqual(metric(empty.summary), { db: 0, contractedDb: 0, contractConversionRate: 0 });
  assert.deepEqual(metric(empty.previous), { db: 0, contractedDb: 0, contractConversionRate: 0 });
});

test('explicit case identity wins over conflicting reverse pointers and ambiguous fallback is never guessed', () => {
  const leads = [lead('direct'), lead('fallback', { convertedCaseId: 'fallback-case' }),
    lead('wrong', { convertedCaseId: 'owned-case' }), lead('owner'),
    lead('claim-a', { convertedCaseId: 'ambiguous' }), lead('claim-b', { convertedCaseId: 'ambiguous' }),
    lead('client-only', { convertedClientId: 'shared-client' }),
    lead('foreign'), lead('missing-firm', { _lawFirmId: undefined })];
  const cases = [contract('direct-case', 'direct'), contract('fallback-case', undefined), contract('owned-case', 'owner'),
    contract('ambiguous', undefined), contract('client-only-case', undefined, { clientId: 'shared-client' }),
    contract('foreign-case', 'foreign', { _lawFirmId: 'firm-b' }), contract('missing-firm-case', 'missing-firm')];
  const input = freeze({ leads, cases }), before = JSON.stringify(input);
  assert.deepEqual([...getRetainedLeadIds(input.leads, input.cases)].sort(), ['direct', 'fallback', 'missing-firm', 'owner']);
  assert.equal(JSON.stringify(input), before);
});

test('zero, negative, nonfinite and withdrawn contracts never qualify; duplicate IDs keep the first stored record', () => {
  const invalid = [0, -1, null, '', 'invalid', NaN, Infinity];
  const leads = invalid.map((_, index) => lead(`invalid-${index}`));
  const cases = invalid.map((contractAmount, index) => contract(`invalid-case-${index}`, `invalid-${index}`, { contractAmount }));
  leads.push(lead('cancelled'), lead('valid'), lead('duplicate-invalid'), lead('duplicate-valid'));
  cases.push(contract('cancelled-case', 'cancelled', { status: '취하' }), contract('valid-case', 'valid', { contractAmount: '0.5', status: '종결' }),
    contract('duplicate-case-a', 'duplicate-invalid', { contractAmount: 0 }), contract('duplicate-case-a', 'duplicate-invalid'),
    contract('duplicate-case-b', 'duplicate-valid'), contract('duplicate-case-b', 'duplicate-valid', { contractAmount: 0 }));
  assert.deepEqual([...getRetainedLeadIds(leads, cases)].sort(), ['duplicate-valid', 'valid']);
  const fallbackLeads = [lead('same-lead', { convertedCaseId: 'first' }), lead('same-lead', { convertedCaseId: 'second' })];
  assert.equal(getRetainedLeadIds(fallbackLeads, [contract('first', undefined, { contractAmount: 0 }), contract('second', undefined)]).size, 0);
});

test('portfolio contract conversion uses the combined numerator and denominator, not a sum of percentages', () => {
  const first = portfolio.buildPortfolioFirmSnapshot(fixture(), start, end, { ...scope, status: 'active' }, now);
  const otherInput = { leads: Array.from({ length: 15 }, (_, index) => lead(`other-${index}`, { _lawFirmId: 'firm-b' })),
    cases: [contract('other-case', 'other-0', { _lawFirmId: 'firm-b' })], clients: [], installments: [] };
  const second = portfolio.buildPortfolioFirmSnapshot(otherInput, start, end, { firmId: 'firm-b', firmName: 'Other fixture', status: 'active' }, now);
  const result = portfolio.summarizePortfolioPerformance([first, second], start, end, 'active', now);
  assert.deepEqual(metric(result.summary), { db: 20, contractedDb: 3, contractConversionRate: 15 });
  assert.deepEqual(metric(result.previous), { db: 1, contractedDb: 1, contractConversionRate: 100 });
  assert.equal(result.summary.converted, 3); assert.equal(result.summary.conversionRate, 15);
  assert.equal(result.summary.contracts, 3); assert.equal(result.summary.contractAmount, 600);
});

function routeHarness(actor = { id: 'manager', platform_role: 'firm_admin', role: 'admin', law_firm_id: 'firm-a' }) {
  const input = fixture(), queries = [];
  const database = { law_firms: [{ id: 'firm-a', name: 'Fixture firm', status: 'active' }, { id: 'firm-b', name: 'Other firm', status: 'active' }],
    profiles: [{ id: 'staff-a', law_firm_id: 'firm-a', is_work_staff: true, staff_name: 'A', platform_role: 'staff' }] };
  for (const [table, key] of [['app_leads', 'leads'], ['app_cases', 'cases'], ['app_clients', 'clients'], ['app_installments', 'installments']]) {
    database[table] = input[key].map(data => ({ id: data.id, law_firm_id: 'firm-a', data }));
  }
  database.app_cases.push({ id: 'foreign-linked', law_firm_id: 'firm-b', data: contract('foreign-linked', 'five', { contractAmount: 999999, _lawFirmId: 'firm-b' }) });
  function from(table) {
    const filters = []; let after, maximum = Infinity, order = 'id', single = false;
    const query = { select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; },
      gt(key, value) { after = { key, value }; return query; }, order(key) { order = key; return query; }, limit(value) { maximum = value; return query; },
      maybeSingle() { single = true; return query; }, then(resolve) {
        queries.push(table);
        const result = database[table].filter(row => filters.every(filter => filter(row)) && (!after || row[after.key] > after.value))
          .sort((a, b) => String(a[order]).localeCompare(String(b[order]))).slice(0, Math.min(maximum, 3));
        return Promise.resolve(resolve({ data: single ? result[0] ?? null : result, error: null }));
      } };
    return query;
  }
  const route = load('app/api/admin/performance/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/platform/server': { requirePlatformUser: async () => { if (!actor) throw new Error('UNAUTHORIZED'); return { admin: { from }, profile: actor }; },
      platformError: error => ({ status: error.message === 'UNAUTHORIZED' ? 401 : ['FORBIDDEN', 'NO_FIRM'].includes(error.message) ? 403 : 400, message: error.message }) },
  });
  const request = (firmId = 'firm-a') => ({ nextUrl: new URL(`https://fixture.invalid/performance?firmId=${firmId}&start=${start}&end=${end}`) });
  return { route, request, database, queries };
}

test('performance GET computes the tenant cohort with read-only pagination and unchanged customer records', async () => {
  const h = routeHarness(), before = JSON.stringify(h.database), response = await h.route.GET(h.request()), body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(metric(body.summary), { db: 5, contractedDb: 2, contractConversionRate: 40 });
  assert.equal(body.summary.contracts, 2); assert.equal(body.summary.contractAmount, 500);
  assert.ok(h.queries.filter(table => table === 'app_leads').length > 2);
  assert.ok(!JSON.stringify(body).includes('foreign-linked'));
  assert.equal(JSON.stringify(h.database), before); assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('new performance metric preserves ordinary-staff, foreign-firm and unauthenticated access denial', async () => {
  for (const [actor, firmId, status] of [
    [{ id: 'ordinary', platform_role: 'staff', role: 'staff', law_firm_id: 'firm-a' }, 'firm-a', 403],
    [{ id: 'manager', platform_role: 'firm_admin', role: 'admin', law_firm_id: 'firm-a' }, 'firm-b', 403],
    [null, 'firm-a', 401],
  ]) {
    const h = routeHarness(actor), response = await h.route.GET(h.request(firmId));
    assert.equal(response.status, status); assert.equal(h.queries.length, 0);
  }
});

test('shared conversion card renders the exact period, numerator and denominator and defers an empty denominator', () => {
  const module = load('components/analytics/LeadRetainerConversionCard.tsx');
  const Card = module.LeadRetainerConversionCard ?? module.default;
  assert.equal(typeof Card, 'function');
  const html = renderToStaticMarkup(React.createElement(Card, { start, end, totalDb: 5, retainedDb: 2 }));
  assert.match(html, /설정 기간 총 DB.*수임 전환율/); assert.match(html, /40(?:\.0)?%/);
  assert.match(html, /수임 전환 2건 \/ 총 DB 5건/); assert.match(html, /로펌 전체 DB/);
  assert.ok(html.includes(start)); assert.ok(html.includes(end));
  const empty = renderToStaticMarkup(React.createElement(Card, { start, end, totalDb: 0, retainedDb: 0 }));
  assert.match(empty, /기간 DB 없음/); assert.match(empty, /—/); assert.doesNotMatch(empty, /NaN|Infinity/);
});

test('firm overview renders contract conversion alongside the existing client conversion and period contract metrics', () => {
  const { FirmPerformanceView } = load('components/analytics/FirmPerformance.tsx', {
    'next/dynamic': { __esModule: true, default: () => () => null },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/platform/client': { authJson: () => { throw new Error('Network is forbidden'); } },
    '@/components/ui/DateRangePicker': { DateRangePicker: () => null },
  });
  const input = report(), before = JSON.stringify(input);
  const html = renderToStaticMarkup(React.createElement(FirmPerformanceView, { report: input, canManageLawyers: false }));
  assert.match(html, /수임 전환율/); assert.match(html, /40(?:\.0)?%/);
  assert.match(html, /DB 고객전환율/); assert.match(html, /60\.0%/); assert.match(html, /유효 수임/);
  assert.equal(JSON.stringify(input), before);
  const filtered = renderToStaticMarkup(React.createElement(FirmPerformanceView, { report: report(fixture(), 'A'), selectedStaff: 'A', canManageLawyers: false }));
  assert.match(filtered, /A 담당 DB/); assert.match(filtered, /수임 전환 2건 \/ 총 DB 2건/); assert.match(filtered, /100\.0%/);
});

function renderLegacy(input, rangeStart, rangeEnd, manager = true, tableObserver) {
  const management = load('lib/management-core.ts');
  const forbidden = () => { throw new Error('External action is forbidden'); };
  let stateIndex = 0;
  const initialState = [rangeStart, rangeEnd, '요약', '전체'];
  const tableMock = tableObserver ? {
    './StaffRetainerConversionTable': { StaffRetainerConversionTable: props => {
      tableObserver(props);
      return React.createElement(load('components/analytics/StaffRetainerConversionTable.tsx').StaffRetainerConversionTable, props);
    } },
  } : {};
  const { default: LegacyAnalytics } = load('components/analytics/LegacyAnalytics.tsx', {
      ...tableMock,
      react: { ...React, useState: initial => React.useState(stateIndex < initialState.length ? initialState[stateIndex++] : initial) },
      '@/lib/store': { useStore: () => ({ ...input, workStaffNames: input.staffNames,
        staffDirectory: input.staffDirectory ?? input.staffNames.map((name, index) => ({ id: `staff-${index}`, lawFirmId: 'firm-a', isWorkStaff: true, platformRole: 'staff', staffName: name })),
        caseDocuments: {}, superAdminFirmScope: null,
        firmDirectory: [{ id: 'firm-a', status: 'active' }], profile: { role: manager ? 'admin' : 'staff', platformRole: manager ? 'firm_admin' : 'staff', lawFirmId: 'firm-a' } }) },
      '@/lib/management-analytics': { ...management, useManagementSettings: () => ({ globalSuperView: false, effectiveFirmId: 'firm-a',
        activeSettings: management.DEFAULT_MANAGEMENT_SETTINGS, settingsByFirm: {}, loading: false, error: null }) },
      '@/lib/use-firm-supply': { useFirmSupply: () => ({ data: { serviceMode: 'crm_only', purchaseCost: 0, byLead: [], matureCohort: { supplied: 0, retained: 0 } }, loading: false, error: null }) },
      '@/components/ui/DateRangePicker': { DateRangePicker: () => null },
      '@/components/analytics/FirmOperationsDetails': { FirmOperationsDetails: () => null },
      '@/components/analytics/FirmSupplyCard': { FirmSupplyCard: () => null },
      '@/lib/analytics-excel': { exportAnalyticsMeetingWorkbook: forbidden },
      '@/lib/management-export-client': { recordManagementExport: forbidden },
    });
  return renderToStaticMarkup(React.createElement(LegacyAnalytics));
}

test('default firm analytics renders the new cohort card for the selected dates and keeps it hidden from ordinary staff', () => {
  const input = freeze(fixture()), before = JSON.stringify(input);
  const current = renderLegacy(input, start, end);
  assert.match(current, /설정 기간 총 DB.*수임 전환율/); assert.match(current, /수임 전환 2건 \/ 총 DB 5건/); assert.match(current, /40\.0%/);
  const later = renderLegacy(input, '2026-11-01', '2026-11-30');
  assert.match(later, /2026-11-01 ~ 2026-11-30/); assert.match(later, /수임 전환 1건 \/ 총 DB 1건/); assert.match(later, /100\.0%/);
  const staff = renderLegacy(input, start, end, false);
  assert.doesNotMatch(staff, /설정 기간 총 DB/); assert.match(staff, /관리자만 사용할 수 있습니다/);
  assert.equal(JSON.stringify(input), before);
});

function renderedRows(html) {
  const text = value => value.replace(/<!--[^]*?-->/g, '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return [...html.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([^]*?)<\/t[dh]>/g)].map(cell => text(cell[1])));
}
function staffCounts(rows) {
  return Object.fromEntries(rows.map(row => [row.name, { db: row.db, contractedDb: row.contractedDb }]));
}

test('staff conversion table renders per-person counts, a weighted total and deferred zero-DB rates without mutating rows', () => {
  const { StaffRetainerConversionTable } = load('components/analytics/StaffRetainerConversionTable.tsx');
  const rows = freeze([
    { key: 'a', name: 'A', db: 2, contractedDb: 2 }, { key: 'b', name: 'B', db: 3, contractedDb: 0 },
    { key: 'none', name: 'No activity', db: 0, contractedDb: 0 }, { key: 'unassigned', name: '미지정', db: 1, contractedDb: 1 },
  ]), before = JSON.stringify(rows);
  const html = renderToStaticMarkup(React.createElement(StaffRetainerConversionTable, { start, end, rows }));
  const cells = renderedRows(html);
  for (const [name, db, contracted, rate] of [['A', 2, 2, '100.0%'], ['B', 3, 0, '0.0%'], ['No activity', 0, 0, '—'], ['미지정', 1, 1, '100.0%']]) {
    const row = cells.find(cells => cells[0] === name);
    assert.ok(row, `Missing staff row: ${name}`);
    assert.equal(Number(row[1].replace(/[^\d.]/g, '')), db); assert.equal(Number(row[2].replace(/[^\d.]/g, '')), contracted); assert.ok(row[3].includes(rate));
  }
  const total = cells.find(row => row[0].includes('합계'));
  assert.ok(total); assert.equal(Number(total[1].replace(/[^\d.]/g, '')), 6); assert.equal(Number(total[2].replace(/[^\d.]/g, '')), 3); assert.match(total[3], /50\.0%/);
  assert.ok(html.includes(start)); assert.ok(html.includes(end)); assert.equal(JSON.stringify(rows), before);
  const empty = renderToStaticMarkup(React.createElement(StaffRetainerConversionTable, { start, end, rows: [] }));
  assert.doesNotMatch(empty, /NaN|Infinity/);
});

test('default analytics staff rows reconcile to the same cohort card and retain unassigned and registered zero-activity staff', () => {
  const input = fixture();
  input.leads.push(lead('unassigned', { assignedStaff: '   ' }), { ...input.leads[0] });
  input.cases.push(contract('unassigned-contract', 'unassigned', { assignedStaff: 'B', contractDate: '2026-11-05' }));
  input.cases.push(contract('historical-case', undefined, { assignedStaff: 'Former staff', contractDate: '2020-01-01', contractAmount: 0 }));
  input.staffDirectory = [
    { lawFirmId: 'firm-a', isWorkStaff: true, platformRole: 'staff', staffName: 'A' },
    { lawFirmId: 'firm-a', isWorkStaff: true, platformRole: 'firm_admin', staffName: 'B' },
    { lawFirmId: 'firm-a', isWorkStaff: true, platformRole: 'staff', staffName: '', displayName: 'No activity' },
    { lawFirmId: 'firm-b', isWorkStaff: true, platformRole: 'staff', staffName: 'Other firm only' },
    { lawFirmId: 'firm-a', isWorkStaff: true, platformRole: 'super_admin', staffName: 'Platform admin only' },
    { lawFirmId: 'firm-a', isWorkStaff: false, platformRole: 'staff', staffName: 'Not work staff' },
  ];
  input.staffNames.push('Fallback name only');
  freeze(input); const before = JSON.stringify(input);
  let props;
  const html = renderLegacy(input, start, end, true, value => { props = value; });
  assert.ok(props, 'The default analytics view must render the shared staff comparison');
  assert.equal(props.start, start); assert.equal(props.end, end);
  assert.deepEqual(staffCounts(props.rows), {
    A: { db: 2, contractedDb: 2 }, B: { db: 3, contractedDb: 0 }, 'No activity': { db: 0, contractedDb: 0 }, '미지정': { db: 1, contractedDb: 1 }, 'Former staff': { db: 0, contractedDb: 0 },
  });
  assert.equal(props.rows.reduce((sum, row) => sum + row.db, 0), 6); assert.equal(props.rows.reduce((sum, row) => sum + row.contractedDb, 0), 3);
  assert.match(html, /수임 전환 3건 \/ 총 DB 6건/); assert.match(html, /50\.0%/);
  let later;
  const laterHtml = renderLegacy(input, '2026-11-01', '2026-11-30', true, value => { later = value; });
  assert.equal(later.rows.reduce((sum, row) => sum + row.db, 0), 1); assert.equal(later.rows.reduce((sum, row) => sum + row.contractedDb, 0), 1);
  assert.equal(staffCounts(later.rows).A.db, 1); assert.equal(staffCounts(later.rows).A.contractedDb, 1);
  assert.match(laterHtml, /수임 전환 1건 \/ 총 DB 1건/);
  let empty;
  const emptyHtml = renderLegacy(input, '2027-01-01', '2027-01-31', true, value => { empty = value; });
  for (const name of ['A', 'B', 'No activity', 'Former staff']) assert.deepEqual(staffCounts(empty.rows)[name], { db: 0, contractedDb: 0 });
  assert.ok(empty.rows.every(row => row.db === 0 && row.contractedDb === 0)); assert.match(emptyHtml, /기간 DB 없음/);
  let staffRenderCount = 0;
  renderLegacy(input, start, end, false, () => { staffRenderCount++; });
  assert.equal(staffRenderCount, 0); assert.equal(JSON.stringify(input), before);
});

test('selecting a staff member keeps the full firm comparison while the summary card follows that staff', () => {
  let props;
  const { StaffRetainerConversionTable } = load('components/analytics/StaffRetainerConversionTable.tsx');
  const { FirmPerformanceView } = load('components/analytics/FirmPerformance.tsx', {
    'next/dynamic': { __esModule: true, default: () => () => null },
    'next/link': { __esModule: true, default: ({ children, ...rest }) => React.createElement('a', rest, children) },
    '@/lib/platform/client': { authJson: () => { throw new Error('Network is forbidden'); } },
    '@/components/ui/DateRangePicker': { DateRangePicker: () => null },
    './StaffRetainerConversionTable': { StaffRetainerConversionTable: value => { props = value; return React.createElement(StaffRetainerConversionTable, value); } },
  });
  const input = report(fixture(), 'A'), before = JSON.stringify(input);
  const html = renderToStaticMarkup(React.createElement(FirmPerformanceView, { report: input, selectedStaff: 'A', canManageLawyers: false }));
  assert.ok(props); assert.deepEqual(staffCounts(props.rows), staffCounts(input.staff));
  assert.deepEqual(staffCounts(props.rows), { A: { db: 2, contractedDb: 2 }, B: { db: 3, contractedDb: 0 }, 'No activity': { db: 0, contractedDb: 0 } });
  assert.equal(props.rows.reduce((sum, row) => sum + row.db, 0), 5);
  assert.match(html, /A 담당 DB/); assert.match(html, /수임 전환 2건 \/ 총 DB 2건/);
  const total = renderedRows(html).find(row => row[0].includes('합계'));
  assert.ok(total); assert.equal(Number(total[1].replace(/[^\d.]/g, '')), 5); assert.equal(Number(total[2].replace(/[^\d.]/g, '')), 2); assert.match(total[3], /40\.0%/);
  assert.equal(JSON.stringify(input), before);
});
