const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const defaultSupply = { data: { serviceMode: 'db_supply', purchaseCost: 12345, byLead: [], matureCohort: { supplied: 0, retained: 0 } }, loading: false, error: null };
// The requirements revision intentionally changed finance/cohort semantics.
// Memo invalidation compares a rerender with a fresh execution of current code.
// The old fixture remains only for independent relationship-scan measurements.
const source = fs.readFileSync(path.join(root, 'components/analytics/LegacyAnalytics.tsx'), 'utf8');
const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/legacy-analytics-before.tsx'), 'utf8');
// Exercise the actual component memo boundary and extracted pure report, without
// mounting JSX/export callbacks. This deliberately does not duplicate report logic.
const calculationEnd = source.indexOf('  const ledgerSummary=');
assert.ok(calculationEnd > 0, 'actual report memo boundary must be present');
const current = source.slice(0, calculationEnd)
  + '  const {buildSheets: _buildSheets, ...values}=report; return {...values,ledger};\n}\n';
let clock = Date.parse('2026-10-17T12:00:00+09:00');
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}

function harness(component) {
  let input;
  let cursor = 0;
  let stateCursor = 0;
  let memoRuns = 0;
  const memos = [];
  const calls = {};
  const modules = new Map();
  const react = {
    useRef: initial => ({ current: initial }),
    useEffect: () => {},
    useState(initial) {
      const value = [input.start, input.end, input.tab ?? '요약', input.staffFilter ?? '전체'][stateCursor++];
      return [value === undefined ? initial : value, () => {}];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      const prior = memos[index];
      if (prior && deps.length === prior.deps.length && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.value;
      memoRuns++;
      const value = factory();
      memos[index] = { deps, value };
      return value;
    },
  };
  function load(file, text) {
    if (text === undefined && modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    const code = ts.transpileModule(text ?? fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: file,
    }).outputText;
    const requireMock = (name) => {
      if (name === 'react') return react;
      if (name === '@/lib/store') return { useStore: () => ({ ...input.store, caseDocuments: input.store.caseDocuments ?? {} }) };
      if (name === '@/lib/use-analytics-source') return { useAnalyticsSource: () => ({ data: input.source ?? input.store, loading: false, error: null, retry: () => {} }) };
      if (name === '@/lib/use-firm-supply') return { useFirmSupply: () => input.supply ?? defaultSupply };
      if (name === '@/lib/supabase/client') return { createClient: () => { throw new Error('Network is forbidden in this test'); } };
      if (name === '@/lib/management-analytics' || name === '@/lib/management-core') {
        const financial = load('lib/management-core.ts');
        const tracked = Object.fromEntries(Object.entries(financial).map(([key, value]) => [key, typeof value === 'function' ? (...args) => {
          calls[key] = (calls[key] ?? 0) + 1;
          return value(...args);
        } : value]));
        return name === '@/lib/management-analytics' ? { ...tracked, useManagementSettings: () => input.settings } : tracked;
      }
      if (name === './types') return load('lib/types.ts');
      if (name.startsWith('@/lib/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('.')) {
        const owner = file === 'component.tsx' ? 'components/analytics/LegacyAnalytics.tsx' : file;
        const target = path.resolve(root, path.dirname(owner), name);
        const resolved = ['.ts', '.tsx'].map(ext => target + ext).find(candidate => fs.existsSync(candidate));
        if (resolved) return load(path.relative(root, resolved));
      }
      throw new Error(`Unexpected import: ${name}`);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: requireMock, Date: TestDate }, { filename: file });
    modules.set(file, module.exports);
    return module.exports;
  }
  const renderComponent = load('component.tsx', component).default;
  return {
    render(next) { input = next; cursor = 0; stateCursor = 0; return renderComponent(); },
    calls,
    get memoRuns() { return memoRuns; },
    financial: load('lib/management-core.ts'),
  };
}

const financial = harness(current).financial;
function settings(multiplier = 1) {
  const value = structuredClone(financial.DEFAULT_MANAGEMENT_SETTINGS);
  value.acquisitionMode = multiplier === 1 ? 'db_purchase' : 'direct_ads';
  value.dbPurchaseUnitCost = 19000 * multiplier;
  value.activeDbCap = 1;
  value.neglectedDays = 3;
  value.staffCompensations = ['가람', '나래', '', '유령'].map((staff, i) => ({
    staff, employmentType: i % 2 ? '프리랜서' : '정규직', baseSalary: i * 123456,
    incentiveMode: ['회수매출%', '수임액%', '건당고정'][i % 3], incentiveValue: 7.5 + i,
    clawbackOnCancel: i % 2 === 0,
  }));
  value.paymentFees = [
    { paymentMethod: '카드', rate: 3.23, payer: '사무소 부담' },
    { paymentMethod: '단순분납', rate: 1.2, payer: '사무소 부담' },
    { paymentMethod: '현금', rate: 2, payer: '고객 부담' },
  ];
  value.fixedCosts = [{ id: 'rent', label: '임대료', monthlyAmount: 765432 * multiplier }];
  value.adSpendEntries = [
    { id: 'ad1', date: '2026-09-20', creative: '가을 · 광고', amount: 300000 },
    { id: 'ad2', date: '2026-10-03', creative: '검색', amount: 444444 * multiplier },
  ];
  value.feeRules = [
    { id: 'fee1', caseType: '개인회생', baseFee: 2200000, minFee: 0, approvalDiscountAmount: 0, effectiveFrom: '2026-01-01' },
    { id: 'fee2', caseType: '개인회생', baseFee: 3300000, minFee: 0, approvalDiscountAmount: 0, effectiveFrom: '2026-10-15' },
  ];
  value.monthClosings = { '2026-09': {
    closedAt: '2026-10-01T00:00:00Z', snapshot: {
      ...financial.makeFinancialSnapshot(value), dbPurchaseUnitCost: 8888,
      paymentFees: [{ paymentMethod: '카드', rate: 8.45, payer: '사무소 부담' }],
    },
  } };
  return value;
}
function lead(id, staff, firmId, extra = {}) {
  return { id, assignedStaff: staff, _lawFirmId: firmId, _lawFirmName: firmId && `${firmId} 사무소`,
    receivedAt: '2026-10-03T08:00:00+09:00', status: '상담중', detailStage: '상담', source: 'meta', adName: '검색',
    consultation: { memoLog: [
      { at: '2026-10-04T09:12:00+09:00', text: '통화완료' },
      { at: '2026-10-03T08:10:00+09:00', text: '부재', tag: '부재중' },
    ] }, ...extra };
}
function record(id, staff, firmId, extra = {}) {
  return { id, clientId: 'client1', assignedStaff: staff, _lawFirmId: firmId, _lawFirmName: firmId && `${firmId} 사무소`,
    contractDate: '2026-10-05', contractAmount: 2500000, paidAmount: 1000000,
    caseType: '개인회생', stage: '서류준비', status: '진행중', paymentMethod: '카드', stageUpdatedAt: '2026-09-01', ...extra };
}
function installment(id, caseId, extra = {}) {
  return { id, caseId, amount: 330000, actualPaidAmount: extra.amount ?? 330000, dueDate: '2026-10-01', paidDate: '2026-10-03', status: '완료', seq: 1, ...extra };
}
function fixture(globalSuperView = false) {
  return {
    start: '2026-09-15', end: '2026-10-31',
    store: {
      leads: [
        lead('l1', '가람', 'f1'), lead('l2', '나래', 'f2', { convertedClientId: 'client1' }),
        lead('l1', '', undefined, { detailStage: '부재', status: '거절' }),
        lead('l3', '가람', 'f1', { receivedAt: '2026-09-17', detailStage: '설득필요' }),
        lead('l4', '유령', 'deleted', { receivedAt: '2025-01-01', status: '부적합' }),
        lead('l5', '나래', 'f2', { consultation: undefined, detailStage: '미상담' }),
      ],
      cases: [
        record('c1', '가람', 'f1', { fromLeadId: 'l1' }),
        record('c2', '나래', 'f2', { fromLeadId: 'l2', contractAmount: 0, paidAmount: 100, status: '취하', stage: '종결', paymentMethod: '단순분납' }),
        record('c1', '나래', 'f2', { fromLeadId: 'l1', clientId: 'missing', paymentMethod: '현금', contractDate: '2026-09-20' }),
        record('c3', '', undefined, { contractAmount: -100, paidAmount: -50, caseType: '미분류', stage: '법원접수' }),
        record('c4', '유령', 'deleted', { contractDate: '2025-01-01' }),
        record('c5', '가람', 'f1', { contractAmount: 12.3, paidAmount: 12.3, clientId: 'client2' }),
      ],
      clients: [{ id: 'client1', name: '최초 고객' }, { id: 'client1', name: '중복 고객' }, { id: 'client2', name: '두번째 고객' }],
      installments: [
        installment('i1', 'c1', { _lawFirmId: 'f1' }),
        installment('i1', 'c1', { _lawFirmId: 'f2', amount: 0.1, paidDate: '2026-09-20' }),
        installment('i2', 'c1', { _lawFirmId: 'deleted', amount: 0.2 }),
        installment('i3', 'c1', { status: '연체', paidDate: undefined }),
        installment('i4', 'c2', { status: '실패', paidDate: undefined }),
        installment('i5', 'deleted', { _lawFirmId: 'f1', amount: -33 }),
        installment('i6', 'c4', { amount: 500000 }),
        installment('i7', 'c3', { status: '예정', paidDate: undefined }),
        installment('i8', 'c5', { amount: 12.3, paidDate: '2025-01-01' }),
        installment('i9', 'c1', { paidDate: undefined }),
      ],
      workStaffNames: ['가람', '나래', '유령', '신규', '가람'],
      staffDirectory: [], caseDocuments: {},
      profile: { role: 'admin', platformRole: globalSuperView ? 'super_admin' : 'firm_admin' },
      superAdminFirmScope: null,
      firmDirectory: [{ id: 'f1', status: 'active' }, { id: 'f2', status: 'active' }, { id: 'deleted', status: 'suspended' }],
    },
    settings: { globalSuperView, activeSettings: settings(), settingsByFirm: { f1: settings(), f2: settings(2) }, loading: false, error: null },
  };
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(freeze);
  }
  return value;
}
function compare(input) {
  freeze(input);
  const before = harness(current).render(input);
  const memoized = harness(current);
  const first = memoized.render(input);
  const after = memoized.render(input);
  assert.strictEqual(after.allLedger, first.allLedger, 'unchanged complete-source report should reuse the actual component memo');
  assert.deepStrictEqual(structuredClone(after), structuredClone(before));
  return after;
}

for (const global of [false, true]) {
  test(`fresh and memoized calculations match: ${global ? 'super global' : 'firm'} with duplicate IDs, missing joins, zero/negative and every payment state`, () => {
    const output = compare(fixture(global));
    assert.equal(output.allLedger.find(row => row.case.id === 'c1' && row.case._lawFirmId === 'f1').client.name, '최초 고객');
    assert.equal(output.allLedger.find(row => row.case.id === 'c2').status, '취하');
    assert.equal(output.allLedger.find((row) => row.case.id === 'c5').status, '완납');
  });
  test(`empty arrays and active-firm fallback match: ${global}`, () => {
    const input = fixture(global);
    input.store = { ...input.store, leads: [], cases: [], clients: [], installments: [], workStaffNames: [], firmDirectory: [] };
    compare(input);
  });
  test(`missing firms, empty staff, legacy compound-key collisions and duplicate active firms match: ${global}`, () => {
    const input = fixture(global);
    input.store.firmDirectory = [{ id: 'f1', status: 'active' }, { id: 'f1', status: 'active' }];
    input.store.leads.push(lead('collision1', '가람', 'none'), lead('collision2', '가람', undefined), lead('collision3', 'staff::가람', 'f1'), lead('collision4', '가람', 'f1::staff'));
    input.store.cases.push(record('c1', '가람', ''), record('empty-firm', '', ''));
    compare(input);
  });
  test(`date bounds, closed month snapshots and staff filter match: ${global}`, () => {
    for (const [start, end, staffFilter] of [['2026-10-01', '2026-10-31', '가람'], ['2026-09-20', '2026-09-20', ''], ['2026-08-01', '2026-08-31', '없음'], ['2027-01-01', '2027-01-31', '전체']]) {
      compare({ ...fixture(global), start, end, staffFilter });
    }
  });
}

test('deterministic mixed fixtures preserve every result and sort tie across 12 datasets', () => {
  for (let seed = 1; seed <= 12; seed++) {
    let state = seed;
    const random = (max) => ((state = (state * 1664525 + 1013904223) >>> 0) % max);
    const input = fixture(seed % 2 === 0);
    const staff = ['가람', '나래', '', '새 직원'];
    const firms = ['f1', 'f2', undefined, 'deleted'];
    for (let i = 0; i < 60; i++) input.store.leads.push(lead(`l${random(15)}`, staff[random(4)], firms[random(4)], {
      receivedAt: ['2026-09-01', '2026-09-25', '2026-10-03', '2026-11-03'][random(4)],
      status: ['상담중', '거절', '부적합', '종결_중단'][random(4)],
      convertedClientId: random(3) === 0 ? 'client1' : undefined,
    }));
    for (let i = 0; i < 35; i++) input.store.cases.push(record(`c${random(18)}`, staff[random(4)], firms[random(4)], {
      contractAmount: [0, 1000000, 2300000, 0.1][random(4)], status: random(3) === 0 ? '취하' : '진행중',
      contractDate: ['2026-09-01', '2026-09-20', '2026-10-20', '2026-11-01'][random(4)],
      fromLeadId: `l${random(15)}`, paymentMethod: ['카드', '현금', '단순분납'][random(3)],
    }));
    for (let i = 0; i < 90; i++) input.store.installments.push(installment(`i${random(25)}`, `c${random(20)}`, {
      _lawFirmId: firms[random(4)], status: ['완료', '실패', '연체', '예정'][random(4)],
      amount: [0, 300000, -15000, 0.3][random(4)], paidDate: ['2026-09-20', '2026-10-01', '2026-11-01', undefined][random(4)],
    }));
    if (seed % 3 === 0) input.store.firmDirectory = [];
    compare(input);
  }
});

test('tab/filter rerenders reuse costly memoized results and no longer repeat financial cost functions', () => {
  const input = freeze(fixture(true));
  const old = harness(baseline);
  const optimized = harness(current);
  old.render(input);
  const first = optimized.render(input);
  const counts = { ...optimized.calls };
  const second = optimized.render({ ...input, tab: '사건 · 수납', staffFilter: '가람' });
  old.render({ ...input, tab: '사건 · 수납', staffFilter: '가람' });
  for (const field of ['activeLeads', 'overCap', 'overdueNow', 'staffRows', 'allLedger', 'receiptResult', 'receiptSection', 'channelRows', 'stageRows']) assert.strictEqual(second[field], first[field], field);
  for (const name of ['acquisitionCostForRange', 'laborCostForRange', 'paymentFeesForRange', 'fixedCostForRange', 'cashByStaff', 'staffCompensationForRange', 'contactCount']) assert.equal(optimized.calls[name], counts[name], name);
  assert.ok(old.calls.acquisitionCostForRange > optimized.calls.acquisitionCostForRange);
  assert.ok(old.calls.staffCompensationForRange > optimized.calls.staffCompensationForRange);
  assert.deepStrictEqual(structuredClone(second), structuredClone(harness(current).render({ ...input, tab: '사건 · 수납', staffFilter: '가람' })));
});

test('every changed data/settings/date dependency invalidates cached calculations', () => {
  const initial = freeze(fixture(true));
  const optimized = harness(current);
  optimized.render(initial);
  const edits = [
    (x) => { x.store.leads = [...x.store.leads, lead('new', '신규', 'f1')]; },
    (x) => { x.store.cases = [...x.store.cases, record('new-case', '신규', 'f2')]; },
    (x) => { x.store.clients = x.store.clients.map((row, i) => i === 0 ? { ...row, name: '변경 고객' } : row); },
    (x) => { x.store.installments = [...x.store.installments, installment('new-paid', 'c2', { amount: 99000 })]; },
    (x) => { x.store.installments = x.store.installments.map((row, i) => i === 0 ? { ...row, actualPaidAmount: 12345 } : row); },
    (x) => { x.store.installments = x.store.installments.map((row, i) => i === 0 ? { ...row, paidDate: '2026-11-01' } : row); },
    (x) => { x.store.workStaffNames = [...x.store.workStaffNames, '추가 직원']; },
    (x) => { x.store.staffDirectory = [{ id: 'new-staff', staffName: 'Synthetic new staff', isWorkStaff: true, platformRole: 'staff', lawFirmId: 'f1' }]; },
    (x) => { x.store.caseDocuments = { ...x.store.caseDocuments, c1: { id_copy: true } }; },
    (x) => { x.store.firmDirectory = x.store.firmDirectory.map((row, i) => i === 1 ? { ...row, status: 'suspended' } : row); },
    (x) => { x.settings.activeSettings = { ...x.settings.activeSettings, dbPurchaseUnitCost: 99999 }; },
    (x) => { x.settings.settingsByFirm = { ...x.settings.settingsByFirm, f2: { ...x.settings.settingsByFirm.f2, paymentFees: [{ paymentMethod: '카드', rate: 99, payer: '사무소 부담' }] } }; },
    (x) => { x.settings.globalSuperView = false; },
    (x) => { x.settings.error = 'Synthetic settings unavailable'; },
    (x) => { x.supply = { ...defaultSupply, data: { ...defaultSupply.data, purchaseCost: 99999 } }; },
    (x) => { x.source = { ...x.store, cases: [...x.store.cases, record('complete-source-only', '신규', 'f1')] }; },
    (x) => { x.start = '2026-10-01'; },
    (x) => { x.end = '2026-09-30'; },
  ];
  for (const edit of edits) {
    // Keep every unaffected reference stable, so a missing dependency is visible.
    optimized.render(initial);
    const next = { ...initial, store: { ...initial.store }, settings: { ...initial.settings } };
    edit(next); freeze(next);
    assert.deepStrictEqual(structuredClone(optimized.render(next)), structuredClone(harness(current).render(next)));
  }
});

test('initial calculation reduces relationship scans without changing results on a larger synthetic dataset', (t) => {
  const input = fixture(false);
  input.store.workStaffNames = Array.from({ length: 50 }, (_, i) => `직원${i}`);
  input.store.leads = input.store.workStaffNames.map((staff, i) => lead(`lead${i}`, staff, 'f1'));
  input.store.cases = Array.from({ length: 200 }, (_, i) => record(`case${i}`, `직원${i % 50}`, 'f1'));
  input.store.installments = Array.from({ length: 600 }, (_, i) => installment(`paid${i}`, `case${i % 200}`));
  input.settings.activeSettings.staffCompensations = [];
  input.settings.activeSettings.monthClosings = {};
  input.settings.settingsByFirm = {};
  function measure(component) {
    let reads = 0;
    const data = structuredClone(input);
    for (const row of data.store.installments) {
      const caseId = row.caseId;
      Object.defineProperty(row, 'caseId', { enumerable: true, get() { reads++; return caseId; } });
    }
    const output = harness(component).render(freeze(data));
    return { output, reads };
  }
  const old = measure(baseline);
  const optimized = measure(current);
  assert.deepStrictEqual(structuredClone(optimized.output), structuredClone(harness(current).render(freeze(input))));
  assert.ok(optimized.reads < old.reads * 0.1, `${optimized.reads} versus ${old.reads}`);
  t.diagnostic(`Synthetic 50 staff / 200 cases / 600 installments: caseId reads ${old.reads} -> ${optimized.reads} (${(100 * (1 - optimized.reads / old.reads)).toFixed(1)}% fewer). This measures lookup work, not production latency.`);
});

test('elapsed-day alerts remain live on rerender while static data stays memoized', () => {
  const input = fixture(false);
  input.store.cases[0].stageUpdatedAt = '2026-10-05';
  input.store.leads[0].consultation = { memoLog: [{ at: '2026-10-16T09:00:00+09:00', text: '상담' }] };
  freeze(input);
  const optimized = harness(current);
  optimized.render(input);
  const originalClock = clock;
  try {
    clock += 4 * 86400000;
    assert.deepStrictEqual(structuredClone(optimized.render(input)), structuredClone(harness(current).render(input)));
  } finally { clock = originalClock; }
});

test('styled XLSX engine stays lazily loaded behind the shared export writer', () => {
  const writer = fs.readFileSync(path.join(root, 'lib/analytics-excel.ts'), 'utf8');
  assert.match(source, /exportAnalyticsMeetingWorkbook\(/);
  assert.match(writer, /await import\(["']exceljs["']\)/);
  assert.doesNotMatch(source, /import\s+(?:\*|\{).*from\s+["'](?:xlsx|exceljs)["']/);
});
