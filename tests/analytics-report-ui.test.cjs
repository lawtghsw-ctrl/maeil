// Real React event/state flows with synthetic records. Network and DB writes are mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const runtime = path.resolve(__dirname, '../../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react'));
const Renderer = require(path.join(runtime, 'react-test-renderer'));
const { act } = Renderer;
const root = path.resolve(__dirname, '..');
const firm = 'synthetic-firm';
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children ?? node.props?.children) : '';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-17T12:00:00+09:00'])); } static now() { return Date.parse('2026-10-17T12:00:00+09:00'); } }
const scopeStamp = { _lawFirmId: firm };
function fixture() {
  const contract = (id, date, amount, clientId = `client-${id}`) => ({ ...scopeStamp, id, clientId, contractDate: date, contractAmount: amount, paidAmount: 0, caseNumber: `SYNTHETIC-${id}`, assignedStaff: 'Synthetic staff', caseType: '개인회생', stage: '서류준비', stageUpdatedAt: '2026-10-05', status: '진행중', paymentMethod: '단순분납' });
  const payment = (id, caseId, date, amount) => ({ ...scopeStamp, id, caseId, paidDate: date, dueDate: date, actualPaidAmount: amount, amount: amount + 10000, status: '완료', seq: 1 });
  return {
    leads: [{ ...scopeStamp, id: 'lead-old', receivedAt: '2026-08-10', assignedStaff: 'Synthetic staff', source: '직접', status: '신규접수' }],
    cases: [contract('old', '2026-08-11', 1000, 'shared-client'), contract('current', '2026-10-02', 500, 'shared-client'), contract('dormant', '2026-09-01', 800), contract('future', '2026-11-01', 900)],
    clients: [{ ...scopeStamp, id: 'shared-client', name: 'Synthetic shared customer' }, { ...scopeStamp, id: 'client-dormant', name: 'Synthetic dormant customer' }, { ...scopeStamp, id: 'client-future', name: 'Synthetic future customer' }],
    installments: [payment('old-aug', 'old', '2026-08-12', 100), payment('old-oct', 'old', '2026-10-03', 200), payment('old-future', 'old', '2026-11-03', 300), payment('current-oct', 'current', '2026-10-02', 50), payment('dormant-sep', 'dormant', '2026-09-03', 80)],
    workStaffNames: ['Synthetic staff'], staffDirectory: [], caseDocuments: {},
    profile: { id: 'synthetic-manager', role: 'admin', platformRole: 'firm_admin', lawFirmId: firm },
    superAdminFirmScope: null, firmDirectory: [{ id: firm, name: 'Synthetic firm', status: 'active' }],
  };
}
function supply(start = '2026-10-01', end = '2026-10-31') {
  return { firmId: firm, start, end, serviceMode: 'db_supply', contracts: [], suppliedCount: 0, billableCount: 0, replacedCount: 0, purchaseCost: 0, knownPurchaseCost: 0, missingPriceCount: 0, unlinkedCount: 0, monthly: [], weekly: [], byLead: [],
    supplyCohort: { supplied: 0, retained: 0, conversionRate: null, excludedSupplyRows: 0, staff: [] },
    matureCohort: { supplied: 0, retained: 0, conversionRate: null, excludedSupplyRows: 0, staff: [] },
    periodContracts: { total: 0, fromSupply: 0, outsideSupply: 0, referrals: 0, unlinked: 0 },
  };
}
function harness(options = {}) {
  const modules = new Map(), exports = [], downloads = [], audits = [], reads = [];
  const store = fixture();
  const supplyState = { data: supply(), loading: false, error: null };
  const sourceState = { data: store, loading: false, error: null, retry: () => {} };
  let settings, tree;
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const module = { exports: {} };
    modules.set(relative, module.exports);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const requireMock = name => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(path.join(runtime, 'react/jsx-runtime'));
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/lib/store') return { useStore: () => store };
      if (name === '@/lib/management-analytics') return { ...load('lib/management-core.ts'), useManagementSettings: () => settings };
      if (name === '@/lib/use-firm-supply') return { useFirmSupply: () => supplyState };
      if (name === '@/lib/use-analytics-source') return { useAnalyticsSource: () => sourceState };
      if (name === '@/lib/analytics-excel') return { exportAnalyticsMeetingWorkbook: async payload => { exports.push(payload); await options.export?.(payload); if (!payload.canDownload || payload.canDownload()) downloads.push(payload); } };
      if (name === '@/lib/management-export-client') return { recordManagementExport: async payload => { audits.push(payload); await options.audit?.(payload); } };
      if (name === '@/lib/platform/client') return { authJson: async (url, init) => { reads.push({ url, init }); return options.auth ? options.auth(url, init) : supply('2025-02-01'); } };
      if (name === '@/components/ui/Primitives') return { Card: ({ children }) => React.createElement('section', null, children), PageHeader: ({ title, action }) => React.createElement('header', null, React.createElement('h1', null, title), action) };
      if (name === '@/components/ui/KpiCard') return { KpiCard: ({ label, value }) => React.createElement('div', null, label, value) };
      if (name === '@/components/ui/InfoHelp') return { InfoHelp: ({ summary, children }) => React.createElement('details', null, React.createElement('summary', null, summary), children) };
      if (['@/components/analytics/FirmOperationsDetails', '@/components/analytics/FirmSupplyCard', './LeadRetainerConversionCard', './StaffRetainerConversionTable', './SupplyRetainerConversion'].includes(name)) return new Proxy({}, { get: (_target, key) => key === 'supplyConversionRateLabel' ? (count, rate) => count ? `${rate}%` : '—' : () => null });
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? name.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(relative), name));
        const resolved = ['.ts', '.tsx', ''].map(ext => target + ext).find(candidate => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
        if (resolved) return load(resolved);
      }
      throw new Error(`Unexpected import: ${name}`);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date: TestDate, Error, Intl, URL, URLSearchParams, Map, Set, Number, Math, setTimeout, clearTimeout, AbortController, fetch: () => { throw new Error('Network is forbidden'); } }, { filename: relative })(requireMock, module, module.exports);
    modules.set(relative, module.exports); return module.exports;
  }
  const core = load('lib/management-core.ts');
  const activeSettings = structuredClone(core.DEFAULT_MANAGEMENT_SETTINGS);
  activeSettings.fixedCosts = [{ id: 'synthetic-cost', label: 'Synthetic fixed cost', monthlyAmount: 100 }];
  settings = { globalSuperView: false, effectiveFirmId: firm, activeSettings, settingsByFirm: {}, loading: false, error: null };
  const Component = load('components/analytics/LegacyAnalytics.tsx').default;
  return { store, settings, supplyState, sourceState, exports, downloads, audits, reads, load,
    mount: async () => { await act(async () => { tree = Renderer.create(React.createElement(Component)); }); },
    update: async () => { await act(async () => tree.update(React.createElement(Component))); },
    tree: () => tree,
    close: () => act(() => tree.unmount()),
  };
}
const button = (h, label) => h.tree().root.findAllByType('button').find(node => text(node) === label);
const click = async (h, label) => act(async () => { button(h, label).props.onClick(); });
const changeMonth = async (h, month) => act(async () => { h.tree().root.findByProps({ 'aria-label': '조회 월' }).props.onChange({ target: { value: month } }); });
const settle = async fn => act(async () => { fn?.(); await Promise.resolve(); await Promise.resolve(); });
const ledgerRows = workbook => {
  const section = workbook.sheets[0].sections[0];
  return section.rows.map(row => Object.fromEntries(section.headers.map((header, index) => [header, row[index]])));
};

test('monthly button includes earlier contracts paid this month; cumulative button recomputes full period and uses actual server start', async () => {
  const h = harness(); const before = JSON.stringify(h.store); await h.mount();
  assert.ok(button(h, '이번달 실적 XLSX')); assert.ok(button(h, '누적 실적 XLSX'));
  assert.match(text(h.tree().toJSON()), /해당 월 실입금/);
  await click(h, '이번달 실적 XLSX');
  assert.equal(h.exports.length, 1); assert.equal(h.reads.length, 0);
  const monthly = h.exports[0], rows = ledgerRows(monthly);
  assert.match(monthly.filename, /이번달실적_2026-10\.xlsx$/);
  assert.deepEqual(Array.from(rows, row => row.사건번호).sort(), ['SYNTHETIC-current', 'SYNTHETIC-old']);
  const old = rows.find(row => row.사건번호 === 'SYNTHETIC-old');
  assert.equal(old['해당 월 실입금'], 200); assert.equal(old['누적 실입금'], 300); assert.equal(old['미수 잔금'], 700);
  assert.equal(rows.find(row => row.사건번호 === 'SYNTHETIC-current')['누적 실입금'], 50, 'same client must not combine distinct contracts');
  assert.equal(monthly.sheets[0].sections[1].totalRow[6], 250, 'payment detail totals actual receipts only');
  assert.equal(monthly.sheets.find(sheet => sheet.name === '00 회의요약').kpis.find(kpi => kpi.label === '회수 매출 · 확인분').value, 250);
  assert.deepEqual({ ...h.audits[0] }, { firmId: firm, start: '2026-10-01', end: '2026-10-31', format: 'xlsx', kind: 'meeting', mode: 'monthly' });
  await click(h, '누적 실적 XLSX');
  assert.equal(h.exports.length, 2); assert.equal(h.reads.length, 1);
  const params = new URL(h.reads[0].url, 'https://offline.invalid').searchParams;
  assert.equal(params.get('start'), '2026-08-01'); assert.equal(params.get('end'), '2026-10-31'); assert.equal(params.get('cumulative'), 'true'); assert.equal(h.reads[0].init.cache, 'no-store');
  const cumulative = h.exports[1], allRows = ledgerRows(cumulative);
  assert.match(cumulative.filename, /누적실적_2025-02-01_2026-10-31\.xlsx$/);
  assert.equal(allRows.length, 3); assert.equal(allRows.some(row => row.사건번호 === 'SYNTHETIC-future'), false);
  assert.equal(cumulative.sheets[0].sections[1].totalRow[6], 430);
  const summary = cumulative.sheets.find(sheet => sheet.name === '00 회의요약');
  assert.equal(summary.kpis.find(kpi => kpi.label === '전체 수임 · 계약일').value, 3);
  assert.equal(summary.kpis.find(kpi => kpi.label === '회수 매출 · 확인분').value, 430);
  assert.equal(summary.sections.find(section => section.title === '수익 구조').rows.find(row => row[0] === '고정 운영비')[1], 2100, 'full cumulative costs must be recomputed, not relabelled monthly output');
  assert.equal(h.audits[1].start, '2025-02-01'); assert.equal(h.audits[1].end, '2026-10-31'); assert.equal(h.audits[1].mode, 'cumulative');
  assert.equal(JSON.stringify(h.store), before); h.close();
});

test('menu, all workbook sheets, and selected historical month agree without phone timing or workload details', async () => {
  const h = harness(); await h.mount();
  const expected = ['수임 · 매출', '요약', '팀 · 인원', '상담 운영', '사건 · 수납', '산식 · 기준', 'DB 구매 · 유입'];
  assert.deepEqual(h.tree().root.findAllByType('button').map(text).filter(label => expected.includes(label)), expected);
  for (const tab of expected) { await click(h, tab); assert.doesNotMatch(text(h.tree().toJSON()), /첫 전화 시도|전화 시도\(분\)|업무량 상세|업무량 · 과부하/); }
  await changeMonth(h, '2026-09');
  await click(h, '이번달 실적 XLSX');
  const workbook = h.exports[0];
  assert.match(workbook.filename, /이번달실적_2026-09\.xlsx$/);
  assert.deepEqual(Array.from(workbook.sheets, sheet => sheet.name), ['04 수임매출', '00 회의요약', '01 팀인원', '02 상담운영', '05 사건수납', '07 정산입력', '06 산식기준', '03 DB구매유입']);
  assert.doesNotMatch(JSON.stringify(workbook.sheets), /첫 전화 시도|전화 시도\(분\)|업무량 상세/);
  assert.equal(ledgerRows(workbook).length, 1); assert.equal(ledgerRows(workbook)[0]['누적 실입금'], 80);
  assert.equal(h.audits[0].start, '2026-09-01'); assert.equal(h.audits[0].end, '2026-09-30'); h.close();
});

test('rapid repeated export clicks share one operation and visibly disable both buttons until completion', async () => {
  const pending = deferred(); const h = harness({ audit: () => pending.promise }); await h.mount();
  const first = button(h, '이번달 실적 XLSX').props.onClick;
  const second = button(h, '누적 실적 XLSX').props.onClick;
  await act(async () => { first(); first(); second(); });
  assert.equal(h.audits.length, 1); assert.equal(h.reads.length, 0); assert.equal(h.exports.length, 0);
  assert.equal(button(h, '이번달 실적 XLSX').props.disabled, true); assert.equal(button(h, '누적 실적 XLSX').props.disabled, true);
  assert.match(text(h.tree().toJSON()), /파일을 준비하고 있습니다/);
  await settle(() => pending.resolve());
  assert.equal(h.exports.length, 1); assert.equal(button(h, '이번달 실적 XLSX').props.disabled, false); h.close();
});

test('audit failure is visible, produces no file, and retry recovers without a stuck busy state', async () => {
  let fail = true; const h = harness({ audit: async () => { if (fail) throw new Error('Synthetic audit failure'); } }); await h.mount();
  await click(h, '이번달 실적 XLSX');
  assert.equal(h.exports.length, 0); assert.match(text(h.tree().toJSON()), /Synthetic audit failure/);
  assert.equal(button(h, '이번달 실적 XLSX').props.disabled, false);
  fail = false; await click(h, '이번달 실적 XLSX');
  assert.equal(h.exports.length, 1); assert.doesNotMatch(text(h.tree().toJSON()), /Synthetic audit failure/); h.close();
});

test('switching reporting month during audit prevents stale download and permits a new-month export', async () => {
  const pending = deferred(); let delayed = true; const h = harness({ audit: () => delayed ? pending.promise : undefined }); await h.mount();
  await click(h, '이번달 실적 XLSX'); await changeMonth(h, '2026-09');
  await settle(() => pending.resolve()); assert.equal(h.exports.length, 0);
  delayed = false; await click(h, '이번달 실적 XLSX');
  assert.equal(h.exports.length, 1); assert.match(h.exports[0].filename, /2026-09/); h.close();
});

test('firm switch or unmount while cumulative lookup is pending prevents audit and download', async () => {
  for (const change of ['firm', 'unmount']) {
    const pending = deferred(); const h = harness({ auth: () => pending.promise }); await h.mount();
    await click(h, '누적 실적 XLSX'); assert.equal(h.reads.length, 1);
    if (change === 'firm') { h.settings.effectiveFirmId = 'synthetic-other-firm'; h.store.profile = { ...h.store.profile, lawFirmId: 'synthetic-other-firm' }; await h.update(); }
    else h.close();
    await settle(() => pending.resolve(supply('2025-02-01')));
    assert.equal(h.audits.length, 0); assert.equal(h.exports.length, 0);
    if (change !== 'unmount') h.close();
  }
});

test('context change or unmount during workbook serialization cancels the final download', async () => {
  for (const change of ['month', 'unmount']) {
    const pending = deferred(); const h = harness({ export: () => pending.promise }); await h.mount();
    await click(h, '이번달 실적 XLSX');
    assert.equal(h.exports.length, 1); assert.equal(h.downloads.length, 0);
    assert.equal(typeof h.exports[0].canDownload, 'function', 'writer must receive a live context guard, not a one-time preflight');
    assert.equal(h.exports[0].canDownload(), true);
    if (change === 'month') await changeMonth(h, '2026-09'); else h.close();
    assert.equal(h.exports[0].canDownload(), false);
    await settle(() => pending.resolve()); assert.equal(h.downloads.length, 0);
    if (change !== 'unmount') h.close();
  }
});

test('mismatched cumulative response is rejected rather than exported under the selected firm or period', async () => {
  for (const mismatch of [{ firmId: 'foreign-firm' }, { end: '2026-11-30' }]) {
    const h = harness({ auth: async () => ({ ...supply('2025-02-01'), ...mismatch }) }); await h.mount();
    await click(h, '누적 실적 XLSX');
    assert.equal(h.exports.length, 0); assert.equal(h.audits.length, 0); assert.match(text(h.tree().toJSON()), /조회 범위가 변경/); h.close();
  }
});

test('ordinary staff and supply-loading state do not expose an enabled export action', async () => {
  const denied = harness(); denied.store.profile = { ...denied.store.profile, role: 'staff', platformRole: 'staff' }; await denied.mount();
  assert.equal(button(denied, '이번달 실적 XLSX'), undefined); assert.equal(denied.exports.length, 0); denied.close();
  const loading = harness(); loading.supplyState.loading = true; await loading.mount();
  assert.equal(button(loading, '이번달 실적 XLSX').props.disabled, true); assert.equal(button(loading, '누적 실적 XLSX').props.disabled, true); loading.close();
});

test('complete source response, not the truncated live store, supplies every receipt beyond 1000', async () => {
  const h = harness();
  const complete = { ...h.store, cases: [...h.store.cases], installments: [...h.store.installments,
    ...Array.from({ length: 1001 }, (_, index) => ({ ...scopeStamp, id: `synthetic-page-${String(index).padStart(4, '0')}`, caseId: 'old', paidDate: '2026-10-20', dueDate: '2026-10-20', actualPaidAmount: 1, amount: 9999, status: '완료', seq: index + 3 }))] };
  h.sourceState.data = complete;
  h.store.cases = h.store.cases.slice(0, 1); h.store.installments = h.store.installments.slice(0, 1);
  const before = JSON.stringify(complete); await h.mount(); await click(h, '이번달 실적 XLSX');
  const monthly = h.exports[0], receiptSection = monthly.sheets[0].sections[1];
  assert.equal(receiptSection.rows.length, 1003);
  assert.equal(receiptSection.totalRow[6], 1251);
  assert.equal(ledgerRows(monthly).find(row => row.사건번호 === 'SYNTHETIC-old')['해당 월 실입금'], 1201);
  assert.equal(JSON.stringify(complete), before); h.close();
});

test('source loading/error keeps both export actions visible but disabled without partial-store fallback; retry restores exports', async () => {
  const h = harness(); h.sourceState.data = null; h.sourceState.loading = true; await h.mount();
  const assertBlocked = async () => {
    assert.equal(h.tree().root.findAllByType('header').length, 1);
    assert.ok(h.tree().root.findByProps({ 'aria-label': '조회 월' }));
    for (const label of ['이번달 실적 XLSX', '누적 실적 XLSX']) {
      assert.equal(button(h, label).props.disabled, true);
      assert.equal(button(h, label).props['aria-describedby'], 'analytics-source-status');
      // Disabled UI is not the only guard: even direct invocation cannot audit/read/export.
      await click(h, label);
    }
    assert.equal(h.audits.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.exports.length, 0);
    assert.equal(h.tree().root.findAllByType('table').length, 0, 'partial live-store totals remain hidden');
  };
  await assertBlocked(); assert.match(text(h.tree().toJSON()), /전체 계약·회차별 입금 자료/);
  h.sourceState.loading = false; h.sourceState.error = 'Synthetic source page failure';
  let retries = 0; h.sourceState.retry = () => { retries++; }; await h.update();
  await assertBlocked(); assert.match(text(h.tree().toJSON()), /일부 자료만으로 정산표를 만들지 않습니다/);
  assert.match(text(h.tree().toJSON()), /XLSX 다운로드가 활성화됩니다/);
  // An error must also block a stale non-null source object, not just null source data.
  h.sourceState.data = h.store; await h.update(); await assertBlocked();
  await click(h, '자료 다시 불러오기'); assert.equal(retries, 1);
  h.sourceState.error = null; await h.update();
  for (const label of ['이번달 실적 XLSX', '누적 실적 XLSX']) assert.equal(button(h, label).props.disabled, false);
  await click(h, '이번달 실적 XLSX'); assert.equal(h.exports.length, 1); h.close();
});

test('settings loading and missing source retain disabled export controls without rendering totals', async () => {
  for (const state of ['settings-loading', 'missing-source']) {
    const h = harness();
    if (state === 'settings-loading') h.settings.loading = true;
    else h.sourceState.data = null;
    await h.mount();
    for (const label of ['이번달 실적 XLSX', '누적 실적 XLSX']) {
      assert.equal(button(h, label).props.disabled, true); await click(h, label);
    }
    assert.equal(h.tree().root.findAllByType('table').length, 0);
    assert.equal(h.audits.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.exports.length, 0); h.close();
  }
});

test('scheduled amount is never treated as actual cash when a completed payment lacks actualPaidAmount', async () => {
  const h = harness();
  h.store.installments.push({ ...scopeStamp, id: 'synthetic-unknown-actual', caseId: 'current', status: '완료', amount: 999999, dueDate: '2026-10-10', paidDate: '2026-10-10', seq: 2 });
  h.store.installments.push({ ...scopeStamp, id: 'synthetic-explicit-zero', caseId: 'old', status: '완료', amount: 999999, actualPaidAmount: 0, dueDate: '2026-10-10', paidDate: '2026-10-10', seq: 2 });
  await h.mount(); await click(h, '이번달 실적 XLSX');
  const workbook = h.exports[0], rows = ledgerRows(workbook);
  assert.equal(workbook.sheets[0].sections[1].totalRow[6], 250);
  assert.equal(workbook.sheets.find(sheet => sheet.name === '00 회의요약').kpis.find(kpi => kpi.label === '회수 매출 · 확인분').value, 250);
  assert.equal(rows.find(row => row.사건번호 === 'SYNTHETIC-current')['미수 잔금'], '확인 필요');
  assert.equal(rows.find(row => row.사건번호 === 'SYNTHETIC-old')['미수 잔금'], 700);
  assert.match(rows.find(row => row.사건번호 === 'SYNTHETIC-current')['확인사항'], /실납부액|금액 미확인/); h.close();
});

test('full-month cash includes dated actual receipts for future, undated, and unmatched contracts once with separate reconciliation details', async () => {
  const h = harness();
  h.store.cases.push({ ...h.store.cases[1], id: 'undated-contract', contractDate: '', caseNumber: 'SYNTHETIC-undated' });
  const receipt = (id, caseId, amount, patch = {}) => ({ ...scopeStamp, id, caseId, seq: 1, amount: amount + 10000, actualPaidAmount: amount, paidDate: '2026-10-12', dueDate: '2026-10-12', status: '완료', ...patch });
  h.store.installments.push(receipt('future-contract-cash', 'future', 17), receipt('undated-contract-cash', 'undated-contract', 23), receipt('unmatched-cash', 'missing-contract', 31),
    receipt('after-cutoff-cash', 'missing-contract', 900, { paidDate: '2026-11-01' }),
    receipt('undated-cash', 'missing-contract', 800, { paidDate: undefined }),
    receipt('unconfirmed-amount', 'missing-contract', 700, { actualPaidAmount: undefined }));
  const { buildAnalyticsReport } = h.load('lib/analytics-report.ts');
  const report = buildAnalyticsReport({ store: h.store, settings: h.settings, start: '2026-10-01', end: '2026-10-31', mode: 'monthly', supply: h.supplyState });
  assert.equal(report.ledgerResult.totals.periodPaid, 250);
  assert.equal(report.ledgerResult.totals.excludedPeriodPaid, 71);
  assert.equal(report.fullMonthCash, 321);
  assert.equal(report.cashSales, 321);
  assert.equal(report.fullCumulativeCash, 501, 'whole-firm cumulative cash also includes old contracts outside the monthly ledger');
  await h.mount();
  assert.match(text(h.tree().toJSON()), /해당 월 실입금 · 전체 확인분321원/);
  await click(h, '이번달 실적 XLSX');
  const first = h.exports[0].sheets[0];
  assert.equal(first.kpis.find(kpi => kpi.label === '해당 월 확인 실입금 · 전체').value, 321);
  assert.equal(first.kpis.find(kpi => kpi.label === '누적 실입금 · 원장 계약').value, 350, 'monthly-ledger cumulative cash is not mislabeled as whole-firm cumulative cash');
  const excluded = first.sections.find(section => section.title === '계약 연결 확인 필요 입금');
  assert.equal(excluded.rows.length, 3); assert.equal(excluded.totalRow[4], 71);
  assert.deepEqual(Array.from(excluded.rows, row => row[2]).sort(), ['future-contract-cash', 'undated-contract-cash', 'unmatched-cash']);
  const reconciliation = first.sections.find(section => section.title === '입금 확인 · 대사');
  assert.equal(reconciliation.rows.find(row => row[0] === '해당 월 확인 실입금 전체 (원)')[1], 321);
  assert.equal(reconciliation.rows.find(row => row[0] === '월말 누적 확인 실입금 전체 (원)')[1], 501);
  assert.equal(first.sections[1].totalRow[6] + excluded.totalRow[4], 321);
  const unknownDateDetail = first.sections.flatMap(section => section.rows).find(row => row.includes('undated-cash'));
  assert.ok(unknownDateDetail, 'known actual money with no date or matching contract must stay identifiable outside period cash totals');
  assert.ok(unknownDateDetail.includes(800));
  h.close();
});

test('overpaid contract keeps its credit separately and never offsets another contract receivable, even for the same customer', async () => {
  const h = harness();
  h.store.installments.push({ ...scopeStamp, id: 'synthetic-overpayment', caseId: 'old', seq: 3, amount: 9999, actualPaidAmount: 1000, paidDate: '2026-10-12', dueDate: '2026-10-12', status: '완료' });
  const { buildAnalyticsReport } = h.load('lib/analytics-report.ts');
  const { ledgerTotals } = h.load('lib/analytics-ledger-sheet.ts');
  const report = buildAnalyticsReport({ store: h.store, settings: h.settings, start: '2026-10-01', end: '2026-10-31', mode: 'monthly', supply: h.supplyState });
  assert.equal(report.allLedger.find(row => row.case.id === 'old').balance, -300, 'raw difference remains signed and traceable');
  assert.equal(ledgerTotals(report.allLedger).balance, 450);
  assert.equal(ledgerTotals(report.allLedger).overpayment, 300);
  await h.mount(); await click(h, '이번달 실적 XLSX');
  const workbook = h.exports[0], rows = ledgerRows(workbook), section = workbook.sheets[0].sections[0];
  assert.equal(rows.find(row => row.사건번호 === 'SYNTHETIC-old')['미수 잔금'], 0);
  assert.equal(rows.find(row => row.사건번호 === 'SYNTHETIC-old')['초과입금'], 300);
  assert.equal(rows.find(row => row.사건번호 === 'SYNTHETIC-current')['미수 잔금'], 450);
  assert.equal(section.totalRow[10], 450); assert.equal(section.totalRow[11], 300);
  assert.match(section.note, /다른 계약 미수금과 상계하지 않습니다/); h.close();
});

test('immutable month closing stays labeled separately from current confirmed receipt detail and never rewrites source totals', async () => {
  const h = harness(), core = h.load('lib/management-core.ts');
  h.settings.activeSettings.monthClosings = { '2026-10': {
    closedAt: '2026-11-01T00:00:00Z', snapshot: core.makeFinancialSnapshot(h.settings.activeSettings),
    totals: { contractCount: 9, contractSales: 2500, cashSales: 999, purchaseCost: 44, laborCost: 12, paymentFees: 3, fixedCost: 100 },
  } };
  const before = JSON.stringify(h.settings.activeSettings.monthClosings);
  await h.mount(); await click(h, '이번달 실적 XLSX');
  const workbook = h.exports[0], summary = workbook.sheets.find(sheet => sheet.name === '00 회의요약'), ledger = workbook.sheets[0];
  assert.equal(summary.kpis.find(kpi => kpi.label === '회수 매출 · 마감 스냅샷').value, 999);
  const cashSection = summary.sections.find(section => section.title === '수익 구조');
  assert.equal(cashSection.rows.find(row => row[0] === '회수 매출 · 마감 스냅샷')[1], 999);
  assert.equal(cashSection.rows.find(row => row[0] === '현금 기준 영업이익')[1], 840);
  assert.match(cashSection.note, /마감 스냅샷/);
  assert.equal(ledger.kpis.find(kpi => kpi.label === '해당 월 확인 실입금 · 전체').value, 250);
  assert.equal(ledger.sections[1].totalRow[6], 250);
  assert.equal(ledger.sections.find(section => section.title === '입금 확인 · 대사').rows.find(row => row[0] === '마감 스냅샷 회수 매출')[1], 999);
  await click(h, '요약');
  const rendered = text(h.tree().toJSON());
  assert.match(rendered, /마감 스냅샷/);
  assert.equal(JSON.stringify(h.settings.activeSettings.monthClosings), before); h.close();
});

test('cancelled case legacy summary remains explicitly unverified and never becomes cash or an invented refund', async () => {
  const h = harness();
  h.store.cases.push({ ...h.store.cases[1], id: 'synthetic-cancelled', status: '취하', paidAmount: 555, caseNumber: 'SYNTHETIC-cancelled' });
  await h.mount(); await click(h, '이번달 실적 XLSX');
  const workbook = h.exports[0];
  assert.equal(workbook.sheets[0].kpis.find(kpi => kpi.label === '해당 월 확인 실입금 · 전체').value, 250);
  const cancelled = workbook.sheets.find(sheet => sheet.name === '05 사건수납').sections.find(section => section.title === '선택 기간 취하 사건');
  assert.equal(cancelled.rows[0][6], 555);
  assert.equal(cancelled.headers[6], '원본 입금 집계액 · 미확인');
  assert.match(cancelled.note, /실입금·환불 여부가 확인된 금액으로 간주하지 않/);
  const row = ledgerRows(workbook).find(row => row.사건번호 === 'SYNTHETIC-cancelled');
  assert.equal(row['누적 실입금'], 0); assert.equal(row['미수 잔금'], '확인 필요'); assert.equal(row.상태, '취하'); h.close();
});
