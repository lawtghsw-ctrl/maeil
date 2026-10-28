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
  assert.match(html, /월 접수 DB.*수임 전환율/); assert.match(html, /40(?:\.0)?%/);
  assert.match(html, /수임 2건 \/ 접수 DB 5건/); assert.match(html, /로펌 전체 DB/);
  assert.ok(html.includes(start)); assert.ok(html.includes(end));
  const empty = renderToStaticMarkup(React.createElement(Card, { start, end, totalDb: 0, retainedDb: 0 }));
  assert.match(empty, /기간 DB 없음/); assert.match(empty, /—/); assert.doesNotMatch(empty, /NaN|Infinity/);
});

test('firm overview renders contract conversion alongside the existing client conversion and period contract metrics', () => {
  const { FirmPerformanceView } = load('components/analytics/FirmPerformance.tsx', {
    'next/dynamic': { __esModule: true, default: () => () => null },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/platform/client': { authJson: () => { throw new Error('Network is forbidden'); } },
    '@/lib/use-firm-supply': { useFirmSupply: () => ({ data: null, loading: false, error: null }) },
    '@/components/ui/DateRangePicker': { DateRangePicker: () => null },
  });
  const input = report(), before = JSON.stringify(input);
  const html = renderToStaticMarkup(React.createElement(FirmPerformanceView, { report: input, canManageLawyers: false }));
  assert.match(html, /수임 전환율/); assert.match(html, /40(?:\.0)?%/);
  assert.match(html, /DB 고객전환율/); assert.match(html, /60\.0%/); assert.match(html, /유효 수임/);
  assert.equal(JSON.stringify(input), before);
  const filtered = renderToStaticMarkup(React.createElement(FirmPerformanceView, { report: report(fixture(), 'A'), selectedStaff: 'A', canManageLawyers: false }));
  assert.match(filtered, /A 담당 DB/); assert.match(filtered, /수임 2건 \/ 접수 DB 2건/); assert.match(filtered, /100\.0%/);
});

function supplyFixture(rangeStart = start, rangeEnd = end) {
  const quality = { unlinkedRows: 0, missingLeads: 0, duplicateSupplyRows: 0, unknownSupplyRows: 0, invalidSupplyDates: 0, unresolvedContracts: 0 };
  const current = rangeStart.startsWith('2026-10') ? { supplied: 4, retained: 1, conversionRate: 25, staff: [
    { key: 'A', name: 'A', kind: 'staff', db: 3, contractedDb: 1, conversionRate: 100 / 3 },
    { key: 'B', name: 'B', kind: 'staff', db: 1, contractedDb: 0, conversionRate: 0 },
    { key: 'No activity', name: 'No activity', kind: 'staff', db: 0, contractedDb: 0, conversionRate: null },
  ], excludedSupplyRows: 0, quality: { ...quality } } : { supplied: 0, retained: 0, conversionRate: null, staff: [], excludedSupplyRows: 0, quality: { ...quality } };
  return { firmId: 'firm-a', start: rangeStart, end: rangeEnd, serviceMode: 'crm_only', contracts: [], suppliedCount: 4, billableCount: 0,
    replacedCount: 0, purchaseCost: 0, knownPurchaseCost: 0, missingPriceCount: 0, unlinkedCount: 0, monthly: [], weekly: [], byLead: [],
    periodContracts: {total:7,fromSupply:5,fromSupplyCohort:1,outsideSupply:2,outsideSupplyCohort:6,referrals:1,unlinked:0,undated:0},
    supplyCohort: current, matureCohort: { excludedSupplyRows: 0, supplied: 1, retained: 1, conversionRate: 100, staff: [{ key: 'A', name: 'A', kind: 'staff', db: 1, contractedDb: 1, conversionRate: 100 }], cutoff: '2026-08-19', quality: { ...quality } } };
}

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
      '@/lib/use-firm-supply': { useFirmSupply: () => ({ data: supplyFixture(rangeStart, rangeEnd), loading: false, error: null }) },
      '@/lib/use-analytics-source': { useAnalyticsSource: () => ({ data: input, loading: false, error: null, retry: () => {} }) },

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
  assert.match(current, /수익 · DB 생산성 · 상담 과정 · 수임 · 수납을 해당 로펌 기준으로 봅니다/);
  assert.doesNotMatch(current, /최고 관리자 기준/);
  assert.match(current, /월 접수 DB.*수임 전환율/); assert.match(current, /수임 2건 \/ 접수 DB 5건/); assert.match(current, /40\.0%/);
  const later = renderLegacy(input, '2026-11-01', '2026-11-30');
  assert.match(later, /2026-11-01 ~ 2026-11-30/); assert.match(later, /수임 1건 \/ 접수 DB 1건/); assert.match(later, /100\.0%/);
  const staff = renderLegacy(input, start, end, false);
  assert.doesNotMatch(staff, /공급 원장 기준 수임 전환 성과|월 접수 DB/); assert.match(staff, /관리자만 사용할 수 있습니다/);
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
  assert.match(html, /수임 3건 \/ 접수 DB 6건/); assert.match(html, /50\.0%/);
  let later;
  const laterHtml = renderLegacy(input, '2026-11-01', '2026-11-30', true, value => { later = value; });
  assert.equal(later.rows.reduce((sum, row) => sum + row.db, 0), 1); assert.equal(later.rows.reduce((sum, row) => sum + row.contractedDb, 0), 1);
  assert.equal(staffCounts(later.rows).A.db, 1); assert.equal(staffCounts(later.rows).A.contractedDb, 1);
  assert.match(laterHtml, /수임 1건 \/ 접수 DB 1건/);
  let empty;
  const emptyHtml = renderLegacy(input, '2027-01-01', '2027-01-31', true, value => { empty = value; });
  for (const name of ['A', 'B', 'No activity', 'Former staff']) assert.deepEqual(staffCounts(empty.rows)[name], { db: 0, contractedDb: 0 });
  assert.ok(empty.rows.every(row => row.db === 0 && row.contractedDb === 0)); assert.match(emptyHtml, /기간 DB 없음/);
  let staffRenderCount = 0;
  renderLegacy(input, start, end, false, () => { staffRenderCount++; });
  assert.equal(staffRenderCount, 0); assert.equal(JSON.stringify(input), before);
});

test('selecting a staff member preserves the whole supply cohort and keeps intake conversion separate', () => {
  let props;
  const { StaffRetainerConversionTable } = load('components/analytics/StaffRetainerConversionTable.tsx');
  const { FirmPerformanceView } = load('components/analytics/FirmPerformance.tsx', {
    'next/dynamic': { __esModule: true, default: () => () => null },
    'next/link': { __esModule: true, default: ({ children, ...rest }) => React.createElement('a', rest, children) },
    '@/lib/platform/client': { authJson: () => { throw new Error('Network is forbidden'); } },
    '@/lib/use-firm-supply': { useFirmSupply: () => ({ data: null, loading: false, error: null }) },
    '@/components/ui/DateRangePicker': { DateRangePicker: () => null },
    './StaffRetainerConversionTable': { StaffRetainerConversionTable: value => { if (value.rows.length === 3) props = value; return React.createElement(StaffRetainerConversionTable, value); } },
  });
  const input = report(fixture(), 'A'), before = JSON.stringify(input);
  const supply = freeze({ data: supplyFixture(), loading: false, error: null });
  const html = renderToStaticMarkup(React.createElement(FirmPerformanceView, { report: input, supply, selectedStaff: 'A', canManageLawyers: false }));
  assert.ok(props); assert.deepEqual(staffCounts(props.rows), staffCounts(supply.data.supplyCohort.staff));
  assert.equal(props.basis, 'supply'); assert.equal(props.totalConversionRate, 25);
  assert.equal(props.rows.reduce((sum, row) => sum + row.db, 0), 4);
  assert.match(html, /A 담당 DB/); assert.match(html, /수임 2건 \/ 접수 DB 2건/);
  const total = renderedRows(html).find(row => row[0].includes('합계'));
  assert.ok(total); assert.equal(Number(total[1].replace(/[^\d.]/g, '')), 4); assert.equal(Number(total[2].replace(/[^\d.]/g, '')), 1); assert.match(total[3], /25\.0%/);
  assert.match(html, /수임 1건 \/ 공급 DB 4건/); assert.match(html, /접수일 기준 참고 지표/);
  assert.equal(JSON.stringify(input), before);
});

test('supply UI keeps ledger counts distinct from intake and separates the 60-day cohort for CRM-only firms', () => {
  const data = freeze(supplyFixture()), before = JSON.stringify(data);
  const { SupplyRetainerConversion } = load('components/analytics/SupplyRetainerConversion.tsx');
  const html = renderToStaticMarkup(React.createElement(SupplyRetainerConversion, { start, end, data, loading: false, error: null }));
  assert.match(html, /수임 1건 \/ 공급 DB 4건 · 수임전환율 25\.0%/); assert.match(html, /25\.0%/);
  assert.match(html, /공급 원장 공급일 기준/); assert.match(html, /어드민 이용 계약/); assert.match(html, /DB 구매비는 적용하지 않습니다/);
  assert.doesNotMatch(html, /공급계약 대상 아님|접수일 기준/);
  assert.match(html, /60일 경과 공급 성과 · 별도 참고/); assert.match(html, /2026-08-19까지 공급되어 60일이 지난/);
  assert.match(html, /직원별 60일 경과 공급 DB/); assert.match(html, /참고 · DB 30건 미만/);
  assert.match(html, /text-slate-400/); assert.equal(JSON.stringify(data), before);
  const legacy = renderLegacy(freeze(fixture()), start, end);
  assert.ok(legacy.indexOf('월 공급 DB') < legacy.indexOf('접수일 기준 참고 지표'));
  assert.match(legacy, /수임 1건 \/ 공급 DB 4건/);
  assert.match(legacy, /수임 2건 \/ 접수 DB 5건/);
  assert.match(legacy, /공급 성과 새로고침/); assert.match(legacy, /공급 원장 기준 성과/);
  assert.match(legacy, /DB 고객|전환/);
});

test('missing supply links are excluded while known staff percentages and reconciled totals remain visible', () => {
  const { SupplyRetainerConversion } = load('components/analytics/SupplyRetainerConversion.tsx');
  const data = supplyFixture();
  data.supplyCohort.excludedSupplyRows = 1;
  data.supplyCohort.quality.unlinkedRows = 1;
  data.supplyCohort.quality.duplicateSupplyRows = 2;
  freeze(data); const before = JSON.stringify(data);
  const html = renderToStaticMarkup(React.createElement(SupplyRetainerConversion, { start, end, data, loading: false, error: null }));
  const top = html.slice(0, html.indexOf('<table'));
  assert.match(top, /수임 1건 \/ 공급 DB 4건 · 수임전환율 25\.0%/);
  assert.match(top, /연결 누락 1건 제외/); assert.match(html, /중복 공급 2건 제외/);
  const rows = renderedRows(html), a = rows.find(row => row[0] === 'A'), b = rows.find(row => row[0] === 'B');
  assert.match(a[3], /1\/3 · 33\.3%/); assert.match(b[3], /0\/1 · 0\.0%/);
  assert.equal(rows.some(row => row[0].startsWith('담당 확인 필요')),false);
  const total = rows.find(row => row[0] === '전체 합계');
  assert.equal(total[1], '4건'); assert.equal(total[2], '1건'); assert.match(total[3], /1\/4 · 25\.0%/);
  assert.equal(JSON.stringify(data), before);
});

test('ambiguous contract linkage remains unknown without suppressing an unrelated staff rate', () => {
  const { SupplyRetainerConversion } = load('components/analytics/SupplyRetainerConversion.tsx');
  const data = supplyFixture(); data.supplyCohort.conversionRate = null;
  data.supplyCohort.quality.unresolvedContracts = 1;
  data.supplyCohort.staff[0].conversionRate = null;
  const html = renderToStaticMarkup(React.createElement(SupplyRetainerConversion, {start,end,data,loading:false,error:null}));
  assert.match(html, /수임 1건 \/ 공급 DB 4건 · 수임전환율 확인 필요/);
  const rows = renderedRows(html);
  assert.match(rows.find(row=>row[0]==='A')[3], /확인 필요/);
  assert.match(rows.find(row=>row[0]==='B')[3], /0\/1 · 0\.0%/);
});

test('supply display handles empty, partial-period, stale, loading and error results without false zero measurements', () => {
  const { SupplyRetainerConversion } = load('components/analytics/SupplyRetainerConversion.tsx');
  const render = props => renderToStaticMarkup(React.createElement(SupplyRetainerConversion, { start, end, data: supplyFixture(), loading: false, error: null, ...props }));
  const partial = supplyFixture('2026-10-05', '2026-10-18');
  assert.match(render({ start: partial.start, end: partial.end, data: partial }), /기간 공급 DB/);
  const empty = supplyFixture('2027-01-01', '2027-01-31');
  const emptyHtml = render({ start: empty.start, end: empty.end, data: empty });
  assert.match(emptyHtml, /기간 DB 없음 · 0\/0/); assert.doesNotMatch(emptyHtml, /NaN|Infinity/);
  for (const [props, expected] of [[{ loading: true }, /불러오는 중/], [{ error: 'synthetic unavailable' }, /공급 성과 확인 필요/], [{ start: '2026-11-01', end: '2026-11-30' }, /선택 기간의 공급 성과/], [{ data: null }, /확인할 수 없습니다/]]) {
    const html = render(props); assert.match(html, expected); assert.doesNotMatch(html, /수임 전환 0건|0\.0%|25\.0%/);
  }
});

test('CRM-only supply purchase panel retains real supply records while applying no DB purchase fee', () => {
  const { FirmSupplyCard } = load('components/analytics/FirmSupplyCard.tsx');
  const data = supplyFixture(), html = renderToStaticMarkup(React.createElement(FirmSupplyCard, { data, loading: false, error: null }));
  assert.match(html, /공급 원장 건수/); assert.match(html, /4건/); assert.match(html, /0원/);
  assert.doesNotMatch(html, /등록된 공급계약이 없습니다|공급 계약 대상 아님/);
});

test('headline keeps supply conversions separate from contract-period totals and only labels proven referrals', () => {
  const { SupplyRetainerConversion } = load('components/analytics/SupplyRetainerConversion.tsx');
  const data = supplyFixture();
  data.supplyCohort = {...data.supplyCohort, supplied:238,retained:5,conversionRate:5/238*100,excludedSupplyRows:1,
    staff:[{key:'A',name:'A',db:106,contractedDb:2,conversionRate:2/106*100},{key:'B',name:'B',db:82,contractedDb:3,conversionRate:3/82*100},{key:'C',name:'C',db:50,contractedDb:0,conversionRate:0}]};
  const html = renderToStaticMarkup(React.createElement(SupplyRetainerConversion,{start,end,data,loading:false,error:null}));
  assert.match(html,/수임 5건 \/ 공급 DB 238건 · 수임전환율 2\.1%/);
  assert.match(html,/연결 누락 1건 제외/);
  assert.match(html,/계약일 기준 전체 수임 <b>7건/);
  assert.match(html,/공급 외 수임 <b>2건/);
  assert.match(html,/소개 1건 포함/);assert.doesNotMatch(html,/소개 2건/);
  const rows=renderedRows(html);
  assert.match(rows.find(row=>row[0]==='A')[3],/2\/106 · 1\.9%/);
  assert.match(rows.find(row=>row[0]==='B')[3],/3\/82 · 3\.7%/);
  assert.match(rows.find(row=>row[0]==='C')[3],/0\/50 · 0\.0%/);
  assert.match(rows.find(row=>row[0]==='전체 합계')[3],/5\/238 · 2\.1%/);
});

test('help uses native keyboard disclosure, stays closed initially and Escape restores summary focus', () => {
  const {InfoHelp}=load('components/ui/InfoHelp.tsx');
  const node=InfoHelp({summary:'공급 DB 기준',children:'Long explanatory text'});
  assert.equal(node.type,'details');assert.equal(node.props.open,undefined);
  const summary=node.props.children[0];assert.equal(summary.type,'summary');
  assert.equal(summary.props['aria-label'],'공급 DB 기준 · 자세한 설명');
  assert.equal(summary.props.tabIndex,undefined); // Native summary is keyboard-focusable.
  let prevented=0,focused=0;const target={open:true,querySelector:name=>{assert.equal(name,'summary');return{focus:()=>focused++};}};
  node.props.onKeyDown({key:'Enter',currentTarget:target,preventDefault:()=>prevented++});
  assert.equal(prevented,0);assert.equal(target.open,true); // Enter/Space keep native behavior.
  node.props.onKeyDown({key:'Escape',currentTarget:target,preventDefault:()=>prevented++});
  assert.equal(target.open,false);assert.equal(prevented,1);assert.equal(focused,1);
});

test('monthly meeting export reorders all sheets and preserves supply/staff denominator without removed phone/workload fields', async () => {
  const input=fixture(),data=supplyFixture(),before=JSON.stringify({input,data});
  data.supplyCohort.excludedSupplyRows=1;
  const management=load('lib/management-core.ts');let stateIndex=0,exported,records=[];
  const state=[start,end,'요약','전체',0];
  const {default:Legacy}=load('components/analytics/LegacyAnalytics.tsx',{
    react:{...React,useState:initial=>[stateIndex<state.length?state[stateIndex++]:initial,()=>{}],useMemo:factory=>factory(),useRef:initial=>({current:initial}),useEffect:()=>{}},
    '@/lib/store':{useStore:()=>({...input,workStaffNames:input.staffNames,staffDirectory:[],caseDocuments:{},superAdminFirmScope:null,firmDirectory:[{id:'firm-a',status:'active'}],profile:{role:'admin',platformRole:'firm_admin',lawFirmId:'firm-a'}})},
    '@/lib/management-analytics':{...management,useManagementSettings:()=>({globalSuperView:false,effectiveFirmId:'firm-a',activeSettings:management.DEFAULT_MANAGEMENT_SETTINGS,settingsByFirm:{},loading:false,error:null})},
    '@/lib/use-firm-supply':{useFirmSupply:()=>({data,loading:false,error:null})},
    '@/lib/use-analytics-source':{useAnalyticsSource:()=>({data:input,loading:false,error:null,retry:()=>{}})},
    '@/components/ui/DateRangePicker':{DateRangePicker:()=>null},
    '@/lib/management-export-client':{recordManagementExport:async payload=>records.push(payload)},
    '@/lib/analytics-excel':{exportAnalyticsMeetingWorkbook:async payload=>{exported=payload}},
  });
  const walk=node=>node&&typeof node==='object'?[node,...Object.values(node.props??{}).flatMap(value=>Array.isArray(value)?value.flatMap(walk):walk(value))]:[];
  const tree=Legacy(),button=walk(tree).find(node=>node.type==='button'&&node.props.children?.includes('이번달 실적 XLSX'));
  assert.ok(button);button.props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(records.length,1);assert.equal(records[0].firmId,'firm-a');assert.equal(records[0].kind,'meeting');
  assert.deepEqual(Array.from(exported.sheets,sheet=>sheet.name),['04 수임매출','00 회의요약','01 팀인원','02 상담운영','05 사건수납','07 정산입력','06 산식기준','03 DB구매유입']);
  assert.match(exported.filename,/이번달실적_2026-10\.xlsx$/);
  assert.doesNotMatch(JSON.stringify(exported.sheets),/전화 시도|업무량 상세/);
  const summary=exported.sheets.find(sheet=>sheet.name==='00 회의요약'),staff=exported.sheets.find(sheet=>sheet.name==='01 팀인원');
  assert.deepEqual(Array.from(summary.sections.find(row=>row.title==='공급일 기준 수임 전환').rows[0]),[1,4,'25.0%',1]);
  assert.deepEqual(Array.from(summary.sections.find(row=>row.title==='계약일 기준 전체 수임').rows[0]),[7,5,2,1,0]);
  const supplied=staff.sections.find(row=>row.title==='직원별 공급 DB 수임 전환');
  assert.equal(supplied.rows.reduce((sum,row)=>sum+row[1],0),4);assert.equal(supplied.rows.reduce((sum,row)=>sum+row[2],0),1);
  assert.equal(JSON.stringify(input),JSON.stringify(JSON.parse(before).input));
});

test('supply refresh invalidates old output immediately and aborted requests cannot overwrite current results', async () => {
  let state, previousDependencies, cleanup, pendingEffect;
  const requests = [];
  const { useFirmSupply } = load('lib/use-firm-supply.ts', {
    react: { useState: initial => { if (!state) state = initial; return [state, value => { state = value; }]; },
      useEffect: (effect, dependencies) => { if (!previousDependencies || dependencies.some((value, index) => value !== previousDependencies[index])) { previousDependencies = dependencies; pendingEffect = effect; } } },
    '@/lib/platform/client': { authJson: (url, init) => new Promise((resolve, reject) => { requests.push({ url, init, resolve, reject }); }) },
  });
  const render = (revision = 0, enabled = true) => {
    const output = useFirmSupply('firm-a', start, end, enabled, revision);
    if (pendingEffect) { cleanup?.(); const effect = pendingEffect; pendingEffect = null; cleanup = effect(); }
    return output;
  };
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  assert.equal(render().loading, true); assert.equal(requests.length, 1);
  const first = supplyFixture(); requests[0].resolve(first); await settle();
  assert.equal(render().data, first); assert.equal(requests.length, 1);
  const refreshing = render(1); assert.equal(refreshing.data, null); assert.equal(refreshing.loading, true);
  assert.equal(requests[0].init.signal.aborted, true); assert.equal(requests.length, 2);
  render(2); assert.equal(requests[1].init.signal.aborted, true); assert.equal(requests.length, 3);
  const latest = supplyFixture(); latest.supplyCohort.retained = 2;
  requests[2].resolve(latest); await settle(); requests[1].resolve(first); await settle();
  assert.equal(render(2).data, latest); assert.equal(requests.length, 3);
  assert.equal(requests[2].init.cache, 'no-store'); assert.match(requests[2].url, /firm-supply\?firmId=firm-a&start=2026-10-01&end=2026-10-31/);
  const disabled = render(2, false); assert.equal(disabled.data, null); assert.equal(disabled.loading, false); assert.equal(requests[2].init.signal.aborted, true);
});
