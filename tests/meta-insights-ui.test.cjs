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
function report(patch = {}) { return { start: '2026-10-01', end: '2026-10-18', generatedAt: '2026-10-18T00:00:00Z', accounts: [{ accountId: '123', connections: [{ id: 'connection', lawFirmId: 'f', firmName: '로펌', name: '계정', hasReadToken: false }], status: 'not_synced', snapshot: null, error: null }], unconfigured: [], ads: [], totals: { currency: 'KRW', spend: null, metaLeads: 0, crmLeads: 0, contracts: 0, metaCpl: null, crmCpl: null, conversionRate: null, supplyRevenue: null, contribution: null, marginRate: null }, quality: { incompleteAccounts: 1, unattributedLeads: 0, unattributedSupply: 0, pendingBillingFirms: 0, notes: ['집계 기준'] }, ...patch }; }
function harness({ role = 'super_admin', active = true, auth } = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/platform/MetaInsights.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const calls = [], downloads = [], session = { currentUser: { id: 'user' }, profile: { platformRole: role, isActive: active } };
  const module = { exports: {} };
  const authJson = async (url, init) => { calls.push({ url, init }); return auth ? auth(url, init) : report(); };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { React, Date, Intl, AbortController, setTimeout, clearTimeout }, { filename: 'MetaInsights.tsx' })(name => {
    if (name === 'react') return React;
      if (name === '@/components/ui/DateInput') return { DateInput: ({ onValueChange, onIncompleteChange, ...props }) => React.createElement('input', { ...props, type: 'date', onChange: event => onValueChange(event.target.value) }) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_t, key) => props => React.createElement('svg', { ...props, 'data-icon': key }) });
    if (name === '@/lib/platform/client') return { authJson };
    if (name === '@/lib/store') return { useStoreSession: () => session };
    if (name === 'xlsx') return {
      utils: { book_new: () => ({ sheets: {} }), aoa_to_sheet: rows => rows, book_append_sheet: (book, sheet, name) => { book.sheets[name] = sheet; } },
      writeFile: (book, filename) => downloads.push({ book, filename }),
    };
    throw new Error(name);
  }, module, module.exports);
  let tree;
  return { calls, downloads, session, mount: async () => { await act(async () => { tree = Renderer.create(React.createElement(module.exports.default)); }); }, tree: () => tree,
    update: async () => { await act(async () => tree.update(React.createElement(module.exports.default))); }, close: () => act(() => tree.unmount()) };
}
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
test('firm admin and inactive super see no costs, tokens, or API calls', async () => {
  for (const options of [{ role: 'firm_admin' }, { active: false }]) {
    const h = harness(options); await h.mount(); assert.equal(h.calls.length, 0); assert.ok(text(h.tree().toJSON()).includes('슈퍼관리자 전용')); assert.equal(h.tree().root.findAllByType('input').length, 0); h.close();
  }
});
test('range changes abort old reads and ignore out-of-order old responses', async () => {
  const pending = [];
  const h = harness({ auth: () => { const d = deferred(); pending.push(d); return d.promise; } }); await h.mount();
  await act(async () => { h.tree().root.findByProps({ 'aria-label': '광고 조회 시작일' }).props.onValueChange('2026-09-01'); });
  assert.equal(h.calls[0].init.signal.aborted, true);
  await act(async () => pending[1].resolve(report({ totals: { ...report().totals, spend: 22000 } })));
  await act(async () => pending[0].resolve(report({ totals: { ...report().totals, spend: 99999 } })));
  const rendered = text(h.tree().toJSON()); assert.ok(rendered.includes('22,000')); assert.ok(!rendered.includes('99,999')); h.close();
});
test('refresh sends registered account, then reloads completed cache without saying delivery', async () => {
  const h = harness({ auth: (_url, init) => init?.method === 'POST' ? { ok: true } : report() }); await h.mount();
  const button = h.tree().root.findAllByType('button').find(n => text(n.props.children).includes('광고비 새로고침'));
  await act(async () => { await button.props.onClick(); await new Promise(r => setImmediate(r)); });
  const post = h.calls.find(c => c.init?.method === 'POST'); assert.equal(JSON.parse(post.init.body).accountId, '123'); assert.equal(JSON.parse(post.init.body).action, 'refresh'); assert.equal(h.calls.filter(c => !c.init?.method).length, 2); h.close();
});
test('read token uses password input, separate PATCH and clears on success', async () => {
  const h = harness({ auth: (_url, init) => init?.method === 'PATCH' ? { ok: true } : report() }); await h.mount();
  await act(async () => h.tree().root.findByProps({ 'aria-label': '조회 토큰 연결 계정' }).props.onChange({ target: { value: 'connection' } }));
  await act(async () => h.tree().root.findByProps({ 'aria-label': '광고 조회 전용 토큰' }).props.onChange({ target: { value: 'token-very-private' } }));
  assert.equal(h.tree().root.findByProps({ 'aria-label': '광고 조회 전용 토큰' }).props.type, 'password');
  const button = h.tree().root.findAllByType('button').find(n => text(n.props.children) === '암호화 저장');
  await act(async () => { await button.props.onClick(); await new Promise(r => setImmediate(r)); });
  assert.equal(h.calls.find(c => c.init?.method === 'PATCH').url, '/api/platform/meta-insights');
  assert.equal(h.tree().root.findByProps({ 'aria-label': '광고 조회 전용 토큰' }).props.value, ''); h.close();
});
test('role loss clears sensitive form and aborts pending fetch', async () => {
  const d = deferred(); const h = harness({ auth: () => d.promise }); await h.mount();
  h.session.profile.platformRole = 'firm_admin'; await h.update(); assert.equal(h.calls[0].init.signal.aborted, true);
  await act(async () => d.resolve(report({ totals: { ...report().totals, spend: 99999 } })));
  assert.ok(!text(h.tree().toJSON()).includes('99,999')); h.close();
});

test('rehabilitation scope is explicit and server-scoped data stays consistent across KPI, chart, table and export', async () => {
  const ad = (accountId, adId, adName, spend) => ({ accountId, adId, adName, campaignName: '캠페인', currency: 'KRW', spend, impressions: 100, clicks: 10, metaLeads: 1, metaCpl: spend, crmLeads: 0, contracts: 0, conversionRate: null, crmCpl: null, supplyRevenue: null, contribution: null, marginRate: null, firmNames: [], attributionNote: null });
  const ads = [ad('123', '456', '회생 상담 A', 1000), ad('222', '789', '개인회생 B', 2000)];
  const data = report({
    accounts: ads.map(row => ({ accountId: row.accountId, connections: [{ id: `connection-${row.accountId}`, lawFirmId: 'f', firmName: '로펌', name: `계정 ${row.accountId}`, hasReadToken: false }], status: 'cached', error: null, snapshot: { accountId: row.accountId, accountName: `계정 ${row.accountId}`, currency: 'KRW', timezone: 'Asia/Seoul', fetchedAt: '2026-10-18T00:00:00Z', rows: [{ ...row, date: '2026-10-01' }] } })),
    ads,
    totals: { ...report().totals, spend: 3000, metaLeads: 2, metaCpl: 1500 },
    quality: { ...report().quality, incompleteAccounts: 0 },
  });
  const original = JSON.stringify(data), h = harness({ auth: () => data }); await h.mount();
  const rendered = text(h.tree().toJSON());
  assert.match(rendered, /광고명에 ‘회생’이 포함된 광고의 Meta 지출/);
  assert.match(rendered, /상단 KPI는 전체 연결 계정의 회생 광고입니다/);
  const tableText = () => text(h.tree().root.findByType('tbody'));
  assert.match(tableText(), /회생 상담 A/); assert.match(tableText(), /개인회생 B/);
  const chartTitles = () => h.tree().root.findByProps({ 'aria-label': '선택한 계정의 회생 광고 일별 지출' }).findAll(n => typeof n.props.title === 'string').map(n => n.props.title);
  assert.deepEqual(chartTitles(), ['2026-10-01: 3,000']);
  const exportButton = () => h.tree().root.findAllByType('button').find(n => text(n.props.children) === '엑셀');
  const download = async () => { await act(async () => { exportButton().props.onClick(); await new Promise(r => setImmediate(r)); }); return h.downloads.at(-1).book.sheets; };
  let sheets = await download();
  assert.equal(sheets['광고성과'][0][1], '광고명에 ‘회생’이 포함된 광고');
  assert.deepEqual(Array.from(sheets['광고성과'].slice(3), row => row[2]), ads.map(row => row.adName));
  assert.match(JSON.stringify(sheets['집계기준']), /광고명에 ‘회생’이 포함된 광고만 집계합니다/);
  // Only account selection narrows the chart; search narrows the table/export, as stated in the UI.
  await act(async () => h.tree().root.findByProps({ 'aria-label': '광고계정 필터' }).props.onChange({ target: { value: '222' } }));
  assert.deepEqual(chartTitles(), ['2026-10-01: 2,000']);
  assert.doesNotMatch(tableText(), /회생 상담 A/); assert.match(tableText(), /개인회생 B/);
  sheets = await download(); assert.deepEqual(Array.from(sheets['광고성과'].slice(3), row => row[1]), ['789']);
  const spendLabel = h.tree().root.findAllByType('span').find(n => text(n) === 'Meta 실제 광고비');
  assert.match(text(spendLabel.parent.parent), /3,000/);
  await act(async () => h.tree().root.findByProps({ 'aria-label': '광고 검색' }).props.onChange({ target: { value: '일치하지 않는 검색' } }));
  assert.match(tableText(), /표시할 광고가 없습니다/); assert.deepEqual(chartTitles(), ['2026-10-01: 2,000']);
  sheets = await download(); assert.equal(sheets['광고성과'].length, 3);
  // This request changes the ad scope only; the existing null display and API behavior stay intact.
  const conversionLabel = h.tree().root.findAllByType('span').find(n => text(n) === 'CRM 계약 전환율');
  assert.match(text(conversionLabel.parent.parent), /확인 필요/);
  assert.equal(h.calls.length, 1); assert.equal(JSON.stringify(data), original); h.close();
});
