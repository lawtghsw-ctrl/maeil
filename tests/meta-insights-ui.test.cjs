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
  const calls = [], session = { currentUser: { id: 'user' }, profile: { platformRole: role, isActive: active } };
  const module = { exports: {} };
  const authJson = async (url, init) => { calls.push({ url, init }); return auth ? auth(url, init) : report(); };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { React, Date, Intl, AbortController, setTimeout, clearTimeout }, { filename: 'MetaInsights.tsx' })(name => {
    if (name === 'react') return React;
    if (name === 'lucide-react') return new Proxy({}, { get: (_t, key) => props => React.createElement('svg', { ...props, 'data-icon': key }) });
    if (name === '@/lib/platform/client') return { authJson };
    if (name === '@/lib/store') return { useStoreSession: () => session };
    throw new Error(name);
  }, module, module.exports);
  let tree;
  return { calls, session, mount: async () => { await act(async () => { tree = Renderer.create(React.createElement(module.exports.default)); }); }, tree: () => tree,
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
  await act(async () => { h.tree().root.findByProps({ 'aria-label': '광고 조회 시작일' }).props.onChange({ target: { value: '2026-09-01' } }); });
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
