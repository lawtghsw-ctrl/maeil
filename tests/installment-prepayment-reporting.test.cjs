// Actual reporting modules/components with synthetic fixtures; no database or network.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer'));
const { act } = Renderer;
const clone = value => JSON.parse(JSON.stringify(value));
class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-13T12:00:00+09:00'])); } static now() { return Date.parse('2026-11-13T12:00:00+09:00'); } }
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    const absolute = path.resolve(root, file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} }; cache.set(absolute, module);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { fileName: absolute,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const requireFile = name => {
      if (name in mocks) return mocks[name];
      if (name === 'react' || name.startsWith('react/')) return require(path.join(runtime, name));
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(absolute), name);
        const resolved = ['.ts', '.tsx'].map(ext => target + ext).find(fs.existsSync);
        if (resolved) return load(resolved);
      }
      throw new Error('Unexpected dependency: ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date: Clock, Error, Intl, URL, URLSearchParams,
      fetch: () => { throw new Error('Network forbidden'); } }, { filename: absolute })(requireFile, module, module.exports);
    return module.exports;
  }
  return load;
}
const load = loader(), core = load('lib/management-core.ts');
const start = '2026-11-01', end = '2026-11-30', firmId = 'synthetic-firm';
const record = (patch = {}) => ({ id: 'case', clientId: 'client', contractDate: '2026-11-01', contractAmount: 800000,
  paidAmount: 600000, assignedStaff: 'A', status: '진행중', stage: '서류준비', stageUpdatedAt: start, caseType: '개인회생',
  paymentMethod: '신카할부완납', caseNumber: 'SYNTHETIC', _lawFirmId: firmId, ...patch });
const payment = (id = 'prepaid', patch = {}) => ({ id, caseId: 'case', seq: 1, amount: 800000, actualPaidAmount: 600000,
  status: '선납부', dueDate: '2026-12-15', paidDate: '2026-11-05', _lawFirmId: firmId, ...patch });
const client = { id: 'client', name: 'Synthetic client', _lawFirmId: firmId };
function settings() { const result = structuredClone(core.DEFAULT_MANAGEMENT_SETTINGS);
  result.staffCompensations = [{ staff: 'A', employmentType: '정규직', baseSalary: 0, incentiveMode: '회수매출%', incentiveValue: 10, clawbackOnCancel: true }]; return result; }
function ledger(installments, cases = [record()]) { return load('lib/analytics-ledger.ts').buildAnalyticsLedger({ cases, clients: [client], installments,
  periodStart: start, periodEnd: end, cutoff: end, mode: 'monthly', firmId }); }
function receipts(installments) { return load('lib/analytics-receipts.ts').buildAnalyticsReceipts({ cases: [record()], clients: [client], installments,
  periodStart: start, cutoff: end, mode: 'monthly', firmId }); }
function report(installments, config = settings()) {
  return load('lib/analytics-report.ts').buildAnalyticsReport({
    store: { cases: [record()], clients: [client], installments, leads: [], workStaffNames: ['A'], staffDirectory: [], firmDirectory: [], caseDocuments: {}, superAdminFirmScope: null },
    settings: { globalSuperView: false, effectiveFirmId: firmId, activeSettings: config, settingsByFirm: {}, error: null },
    start, end, mode: 'monthly', supply: { data: { serviceMode: 'crm_only', purchaseCost: 0, byLead: [], monthly: [], weekly: [],
      supplyCohort: { supplied: 0, retained: 0, conversionRate: null, staff: [] }, matureCohort: { supplied: 0, retained: 0 }, periodContracts: { total: 0, fromSupply: 0, outsideSupply: 0, referrals: 0, unlinked: 0 } }, error: null, loading: false },
  });
}

test('600k prepayment on an 800k schedule supplies cash, receipt-based commission and payment fee once', () => {
  const rows = [payment(), payment('pending', { status: '예정' }), payment('failed', { status: '실패' }), payment('prior', { paidDate: '2026-10-31' })];
  const before = JSON.stringify(rows), config = settings();
  assert.equal(core.cashByStaff([record()], rows, start, end).get('A'), 600000);
  assert.equal(core.paymentFeesForRange([record()], rows, config, start, end), 21000);
  assert.equal(core.laborCostForRange([record()], rows, config, start, end), 60000);
  assert.equal(core.cashByStaff([record()], rows, '2026-12-01', '2026-12-31').get('A'), undefined);
  assert.equal(JSON.stringify(rows), before);
});

test('strict ledger and receipt exports keep 600k actual, 200k balance and one receipt across status changes', () => {
  for (const status of ['선납부', '완료']) {
    const row = payment('same', { status }), result = ledger([row, { ...row }]);
    assert.equal(result.rows[0].periodPaid, 600000); assert.equal(result.rows[0].cumulativePaid, 600000);
    assert.equal(result.rows[0].balance, 200000); assert.equal(result.rows[0].balanceKnown, true);
    assert.equal(result.rows[0].status, '분납 중'); assert.equal(result.rows[0].unallocatedPaid, 0);
    const receipt = receipts([row, { ...row }]); assert.equal(receipt.total, 600000); assert.equal(receipt.rows.length, 1); assert.equal(receipt.duplicateCount, 1);
    const section = load('lib/analytics-receipts.ts').createReceiptOnlySection(receipt.rows);
    assert.equal(section.rows[0][5], 600000); assert.equal(section.totalRow[5], 600000); assert.equal(section.headers.length, 6);
  }
});

test('prepayments never fall back to scheduled cash; strict exports retain unknown-date/amount warnings and explicit zero', () => {
  const invalid = [undefined, null, '600000', -1, Infinity, NaN];
  for (const [index, value] of invalid.entries()) {
    const row = payment(`invalid-${index}`, { actualPaidAmount: value });
    assert.equal(load('lib/firm-reporting.ts').actualPayment(row), 0);
    const result = ledger([row], [record({ paidAmount: 0 })]);
    assert.equal(result.rows[0].balanceKnown, false); assert.equal(result.incompletePayments.length, 1);
    assert.equal(receipts([row]).unknownAmountCount, 1); assert.equal(receipts([row]).rows.length, 0);
  }
  const unknownDate = receipts([payment('undated', { paidDate: '' }), payment('invalid-day', { paidDate: '2026-02-30' })]);
  assert.equal(unknownDate.undatedCount, 2); assert.equal(unknownDate.total, 0);
  const zero = receipts([payment('zero', { actualPaidAmount: 0 })]); assert.equal(zero.rows.length, 1); assert.equal(zero.total, 0);
});

test('receipt period uses actual KST payment dates, irrespective of future due dates and older contracts', () => {
  const rows = [payment('before', { paidDate: '2026-10-31T14:59:59Z', actualPaidAmount: 10 }),
    payment('first', { paidDate: '2026-10-31T15:00:00Z', actualPaidAmount: 20 }),
    payment('last', { paidDate: '2026-11-30T14:59:59Z', actualPaidAmount: 30 }),
    payment('after', { paidDate: '2026-11-30T15:00:00Z', actualPaidAmount: 40 })];
  assert.equal(receipts(rows).total, 50);
  const result = ledger(rows, [record({ contractDate: '2026-01-01', paidAmount: 100 })]);
  assert.equal(result.rows[0].periodPaid, 50); assert.equal(result.rows[0].cumulativePaid, 60);
});

test('performance cash and current outstanding use prepayment once, overdue uses only its unpaid remainder', () => {
  const build = load('lib/performance/firm.ts').buildFirmPerformanceReport;
  for (const [patch, cash, outstanding, overdue] of [[{}, 600000, 200000, 0], [{ dueDate: '2026-11-01' }, 600000, 200000, 200000],
    [{ dueDate: '2026-11-01', actualPaidAmount: 800000 }, 800000, 0, 0], [{ actualPaidAmount: 900000 }, 900000, 0, 0]]) {
    const result = build({ cases: [record()], clients: [client], leads: [], installments: [payment('one', patch)], staffNames: ['A'] }, start, end,
      { firmId, firmName: 'Synthetic' }, undefined, new Clock());
    assert.equal(result.summary.cash, cash); assert.equal(result.summary.outstanding, outstanding); assert.equal(result.summary.overdueAmount, overdue);
    assert.equal(result.cases[0].paidTotal, cash);
  }
});

test('analytics report includes prepayments in totals, ledger and receipt-only workbook without admitting schedules or legacy unknown amounts', () => {
  const rows = [payment(), payment('complete', { status: '완료', actualPaidAmount: 100000 }),
    payment('legacy', { status: '완료', actualPaidAmount: undefined }), payment('plan', { status: '예정', actualPaidAmount: 999000 })];
  const result = report(rows);
  assert.equal(result.cashSales, 700000); assert.equal(result.fullMonthCash, 700000); assert.equal(result.fullCumulativeCash, 700000);
  assert.equal(result.laborCost, 70000); assert.equal(result.paymentFees, 24500);
  assert.equal(result.receiptResult.rows.length, 2); assert.equal(result.receiptResult.unknownAmountCount, 1);
  assert.equal(result.ledgerResult.rows[0].periodPaid, 700000); assert.equal(result.ledgerResult.rows[0].balanceKnown, false);
  const sheet = result.buildSheets().find(row => row.name === '04 입금내역');
  assert.equal(sheet.sections[0].rows.length, 2); assert.equal(sheet.sections[0].totalRow[5], 700000);
});

test('closed monthly snapshot amounts remain unchanged when current prepayment records are added', () => {
  const config = settings(); config.monthClosings['2026-11'] = { closedAt: '2026-12-01', snapshot: core.makeFinancialSnapshot(config),
    totals: { contractCount: 1, contractSales: 800000, cashSales: 12345, purchaseCost: 0, laborCost: 99, paymentFees: 88, fixedCost: 0 } };
  const before = JSON.stringify(config), result = report([payment()], config);
  assert.equal(result.cashSales, 12345); assert.equal(result.laborCost, 99); assert.equal(result.paymentFees, 88);
  assert.equal(result.receiptResult.total, 600000); assert.equal(JSON.stringify(config), before);
});

test('period engine adds explicit prepayment cash and preserves its existing completed-row amount basis', () => {
  const result = load('lib/period-engine.ts').buildDayMap([record()], [payment(),
    payment('old', { status: '완료', amount: 100000, actualPaidAmount: 30000 }),
    payment('unknown', { actualPaidAmount: undefined }), payment('pending', { status: '예정' })], []);
  assert.equal(result.get('2026-11-05').paymentAmount, 700000);
  assert.equal(result.get('2026-11-05').caseTypeSplit['개인회생'], 1);
});

test('actual month-close API computes prepayment cash and costs from source rows, ignoring caller totals', async () => {
  const current = settings(), next = structuredClone(current); let saved, audits = 0;
  next.monthClosings['2026-11'] = { closedAt: '2026-12-01', totals: { cashSales: 999999999 } };
  const admin = { from(table) {
    let payload;
    return { select() { return this; }, eq() { return this; }, update(value) { payload = value; return this; }, insert(value) { payload = value; return this; },
      async maybeSingle() {
        if (table === 'law_firms') return { data: { id: firmId, name: 'Synthetic', status: 'active' }, error: null };
        assert.equal(table, 'firm_settings');
        if (payload) { saved = payload; return { data: payload, error: null }; }
        return { data: { value: current, updated_at: 'fixture-revision' }, error: null };
      } };
  } };
  const local = loader({
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/platform/server': { requirePlatformUser: async () => ({ admin, user: { id: 'synthetic-manager' }, profile: { platform_role: 'firm_admin', law_firm_id: firmId } }),
      writePlatformAudit: async () => { audits++; } },
    '@/lib/firm-reporting-server': { readFirmSupply: async () => ({ purchaseCost: 0 }), readFirmRows: async (_admin, table, requestedFirm) => {
      assert.equal(requestedFirm, firmId);
      return (table === 'app_cases' ? [record()] : [payment(), payment('plan', { status: '예정' })]).map(row => ({ id: row.id, law_firm_id: firmId, data: row }));
    } },
  });
  const result = await local('app/api/admin/management-settings/route.ts').PATCH({ json: async () => ({ firmId, value: next, expectedUpdatedAt: 'fixture-revision' }) });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(audits, 1);
  const totals = saved.value.monthClosings['2026-11'].totals;
  assert.equal(totals.cashSales, 600000); assert.equal(totals.paymentFees, 21000); assert.equal(totals.laborCost, 60000);
  assert.deepEqual(current.monthClosings, {});
});

test('cumulative source range includes an old prepayment date without any earlier contract or completed payment', async () => {
  const tables = { app_installments: [{ id: 'old-prepayment', law_firm_id: firmId, paidDate: '2024-01-31T15:00:00Z', status: '선납부' }] };
  const admin = { from(table) {
    let after;
    return { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, gt(_key, value) { after = value; return this; },
      async maybeSingle() { return { data: { law_firm_id: firmId, service_mode: 'crm_only' }, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: after ? [] : tables[table] || [], error: null }).then(resolve, reject); } };
  } };
  const result = await load('lib/firm-reporting-server.ts').readFirmSupply(admin, firmId, start, end, true);
  assert.equal(result.start, '2024-02-01'); assert.equal(result.end, end);
});

test('actual dashboard calendar shows partial prepayment open with 200k remainder and fully prepaid rows complete', async () => {
  const calendars = [], config = settings();
  const rows = [payment('partial', { dueDate: '2026-11-20' }), payment('full', { dueDate: '2026-11-21', actualPaidAmount: 800000 }),
    payment('unconfirmed-zero', { dueDate: '2026-11-22', amount: 0, actualPaidAmount: undefined }),
    payment('future', { dueDate: '2026-12-20' })];
  const mockStore = { cases: [record()], clients: [client], installments: rows, leads: [], scheduleItems: [], isAdmin: true,
    currentStaff: 'A', workStaffNames: ['A'], profile: { role: 'admin', platformRole: 'firm_admin' }, superAdminFirmScope: null, firmDirectory: [], can: () => true };
  const local = loader({
    'next/link': { __esModule: true, default: ({ children }) => React.createElement('a', null, children) },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '@/lib/store': { useStore: () => mockStore },
    '@/lib/management-analytics': { ...core, useManagementSettings: () => ({ globalSuperView: false, effectiveFirmId: firmId, activeSettings: config, settingsByFirm: {}, loading: false, error: null }) },
    '@/lib/use-firm-supply': { useFirmSupply: () => ({ data: null, loading: false, error: null }) },
    '@/components/ui/Primitives': { Card: ({ children }) => React.createElement('div', null, children), PageHeader: () => null },
    '@/components/ui/DateRangePicker': { DateRangePicker: () => null }, '@/components/ui/KpiCard': { KpiCard: () => null },
    '@/components/charts/MonthCalendar': { MonthCalendar: props => { calendars.push(props); return null; } },
    '@/components/dashboard/LeadRetainerConversionCard': { LeadRetainerConversionCard: () => null },
    '@/components/analytics/LeadRetainerConversionCard': { LeadRetainerConversionCard: () => null },
  });
  let tree;
  try {
    const Component = local('components/dashboard/FirmDashboard.tsx').default;
    await act(async () => { tree = Renderer.create(React.createElement(Component)); });
    const calendar = calendars.find(row => row.title === '분납 캘린더');
    assert.deepEqual(clone(calendar.summary), { paid: 1400000, expected: 200000, total: 1600000 });
    const partial = calendar.items.find(row => row.id === 'partial'), full = calendar.items.find(row => row.id === 'full');
    assert.equal(partial.done, false); assert.equal(partial.amount, 200000); assert.match(partial.sub, /600,000/); assert.match(partial.sub, /200,000/);
    assert.equal(full.done, true); assert.equal(full.amount, 0); assert.equal(calendar.items.length, 3);
    assert.equal(calendar.items.find(row => row.id === 'unconfirmed-zero').done, false);
  } finally { if (tree) await act(async () => tree.unmount()); }
});
