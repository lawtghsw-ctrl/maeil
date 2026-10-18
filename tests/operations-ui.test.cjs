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
const fid = '11111111-1111-4111-8111-111111111111';
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function harness(file, name, options = {}) {
  const calls = [], routed = [], entered = [], modules = new Map();
  const session = { profile: { id: 'user', platformRole: options.role ?? 'super_admin', isActive: options.active ?? true }, enterSuperAdminFirmScope: firm => entered.push(firm) };
  const router = { push: url => routed.push(url) };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    const requireMock = name => {
      if (name === 'react') return React;
      if (name === 'xlsx') return require('xlsx');
      if (name === 'lucide-react') return new Proxy({}, { get: (_, name) => props => React.createElement('svg', { ...props, 'data-icon': name }) });
      if (name === 'next/navigation') return { useRouter: () => router };
      if (name === '@/lib/store') return { useStoreSession: () => session };
      if (name === '@/lib/platform/client') return { authJson: async (url, init) => { calls.push({ url, init }); return options.auth ? options.auth(url, init, response) : init?.method === 'POST' ? { ok: true } : response; } };
      if (name.startsWith('@/')) { const target = name.slice(2); return load(target + (fs.existsSync(path.join(root, target + '.tsx')) ? '.tsx' : '.ts')); }
      if (name.startsWith('.')) { const target = path.posix.join(path.posix.dirname(relative), name); return load(target + (fs.existsSync(path.join(root, target + '.tsx')) ? '.tsx' : '.ts')); }
      throw new Error(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { React, Date, Map, Set, Math, Number, Error, Intl, AbortController, structuredClone, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout }, { filename: relative })(requireMock, module, module.exports);
    modules.set(relative, module.exports); return module.exports;
  }
  const ops = load('lib/platform/operations.ts'), month = ops.opsToday().slice(0, 7), config = ops.emptyOperationsConfig();
  const firms = [{ id: fid, name: '실자료 로펌', status: 'active', firm_code: '1234567890', billing_type: 'per_lead' }];
  const monthRow = { month, config, revision: 2, closed_at: null, snapshot: null, updated_at: new Date().toISOString() };
  const report = ops.buildOperationsReport({ firms, contracts: [], adjustments: [], ledger: [], leads: [], cases: [], monthRows: [monthRow], adSpend: [], sales: [] }, month);
  const response = { firms, contracts: [], adjustments: [], ledger: [], month: monthRow, closings: [], report, ledgerTruncated: false, ledgerOffset: 0, ledgerCount: 0, commercialProfiles: [] };
  const Component = load(file)[name]; let tree;
  return { calls, session, routed, entered, response, mount: async () => { await act(async () => { tree = Renderer.create(React.createElement(Component)); }); }, tree: () => tree,
    update: async () => { await act(async () => tree.update(React.createElement(Component))); }, close: () => act(() => tree.unmount()) };
}
test('unauthorized and inactive users see no operating data or API requests', async () => {
  for (const options of [{ role: 'firm_admin' }, { active: false }]) { const h = harness('components/platform/OperationsOverview.tsx', 'OpsHome', options); await h.mount(); assert.equal(h.calls.length, 0); assert.match(text(h.tree().toJSON()), /슈퍼관리자 전용/); assert.equal(h.tree().root.findAllByType('input').length, 0); h.close(); }
});
test('home renders empty facts without sample amounts, and direct firm entry audits before navigation', async () => {
  const h = harness('components/platform/OperationsOverview.tsx', 'OpsHome'); await h.mount(); const rendered = text(h.tree().toJSON()); assert.match(rendered, /확인 필요/); assert.match(rendered, /기록 미등록/); assert.ok(!rendered.includes('3,554'));
  const button = h.tree().root.findAllByType('button').find(n => text(n.props.children) === '로펌 관리자 화면');
  await act(async () => { await button.props.onClick(); await new Promise(r => setImmediate(r)); });
  const post = h.calls.find(c => c.init?.method === 'POST'); assert.equal(post.url, '/api/platform/firm-view'); assert.equal(JSON.parse(post.init.body).lawFirmId, fid); assert.equal(h.entered[0].id, fid); assert.deepEqual(h.routed, ['/']); h.close();
});
test('bottleneck UI names recorded metrics, grays small DB denominators, and preserves old snapshot unknowns', async () => {
  const h = harness('components/platform/OperationsOverview.tsx', 'OpsHome');
  Object.assign(h.response.report.firms[0], { suppliedDb: 4, phoneAttemptedDb: 2, unconnectedDb: 1, absenceRate: 50, connectedDb: 1, contactRate: 25, consultedDb: 2, consultationRate: 50, neglectedDb: 1, stageRecordedDb: 2, stageUnrecordedDb: 3 });
  await h.mount(); const rendered = text(h.tree().toJSON());
  assert.match(rendered, /컨택 기록 기준/); assert.match(rendered, /상담진행률/); assert.match(rendered, /확인 불가 3건/); assert.ok(!rendered.includes('contactLog'));
  const cells = h.tree().root.findAllByType('td');
  for (const prefix of ['1/2', '1/4', '2/4']) assert.match(cells.find(c => text(c).startsWith(prefix)).props.className, /text-slate-400/);
  h.close();
  const old = harness('components/platform/OperationsOverview.tsx', 'OpsHome'); delete old.response.report.firms[0].suppliedDb; delete old.response.report.firms[0].phoneAttemptedDb; delete old.response.report.firms[0].stageRecordedDb;
  await old.mount(); assert.match(text(old.tree().toJSON()), /마감 당시 미집계/); assert.ok(!text(old.tree().toJSON()).includes('undefined')); old.close();
});
test('month changes cancel reads and ignore older out-of-order responses', async () => {
  const pending = []; const h = harness('components/platform/OperationsOverview.tsx', 'OperationsCosts', { auth: () => { const d = deferred(); pending.push(d); return d.promise; } }); await h.mount();
  await act(async () => h.tree().root.findByProps({ 'aria-label': '운영 조회월' }).props.onChange({ target: { value: '2026-08' } })); assert.equal(h.calls[0].init.signal.aborted, true);
  await act(async () => pending[1].resolve({ ...h.response, report: { ...h.response.report, month: '2026-08', totals: { ...h.response.report.totals, revenue: 22000 } } }));
  await act(async () => pending[0].resolve({ ...h.response, report: { ...h.response.report, totals: { ...h.response.report.totals, revenue: 99000 } } }));
  assert.ok(text(h.tree().toJSON()).includes('22,000')); assert.ok(!text(h.tree().toJSON()).includes('99,000')); h.close();
});
test('settings inputs never autosave and failed explicit save preserves draft and revision', async () => {
  const h = harness('components/platform/OperationsSettings.tsx', 'OperationsSettings', { auth: (_url, init, data) => { if (init?.method === 'POST') throw new Error('다른 관리자가 수정했습니다'); return data; } }); await h.mount();
  const goalInput = () => h.tree().root.findAllByType('label').find(n => text(n.props.children).includes('월 신규 계약 로펌 목표')).findByType('input');
  await act(async () => goalInput().props.onChange({ target: { value: '7' } })); assert.equal(h.calls.filter(c => c.init?.method === 'POST').length, 0);
  await act(async () => { h.tree().root.findByType('form').props.onSubmit({ preventDefault() {} }); await new Promise(r => setImmediate(r)); });
  assert.equal(goalInput().props.value, 7); assert.match(text(h.tree().toJSON()), /다른 관리자가 수정했습니다/); assert.equal(h.tree().root.findByProps({ 'aria-label': '운영 조회월' }).props.disabled, true);
  const body = JSON.parse(h.calls.find(c => c.init?.method === 'POST').init.body); assert.equal(body.expectedRevision, 2); assert.equal(body.config.goals.newFirms, 7); h.close();
});
test('role loss removes existing operating figures and aborts active data read', async () => {
  const h = harness('components/platform/OperationsOverview.tsx', 'OpsHome'); await h.mount(); assert.match(text(h.tree().toJSON()), /실자료 로펌/);
  h.session.profile.isActive = false; await h.update(); assert.ok(!text(h.tree().toJSON()).includes('실자료 로펌')); assert.equal(h.calls[0].init.signal.aborted, true); h.close();
});
test('actual XLSX upload validates preview, requires explicit apply and explicit save, rejects formula cells', async () => {
  const XLSX = require('xlsx'); const h = harness('components/platform/OperationsSettings.tsx', 'OperationsSettings'); await h.mount();
  const file = formula => {
    const sheet = XLSX.utils.aoa_to_sheet([['로펌ID','로펌명','광고비(원)','메모'], [fid,'실자료 로펌',12345,'실제 입력']]);
    if (formula) sheet.C2.f = '10000+2345';
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '광고비'); const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    return { name: '광고비.xlsx', size: buffer.length, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  };
  await act(async () => { h.tree().root.findByProps({ 'aria-label': '광고비 엑셀 파일' }).props.onChange({ target: { files: [file(false)], value: 'file' } }); await new Promise(r => setImmediate(r)); });
  assert.match(text(h.tree().toJSON()), /정상 1행/); assert.equal(h.calls.filter(c => c.init?.method === 'POST').length, 0);
  await act(async () => h.tree().root.findAllByType('button').find(n => text(n.props.children) === '미리보기 적용 · 저장 전').props.onClick());
  assert.equal(h.calls.filter(c => c.init?.method === 'POST').length, 0);
  await act(async () => { h.tree().root.findByType('form').props.onSubmit({ preventDefault() {} }); await new Promise(r => setImmediate(r)); });
  assert.equal(JSON.parse(h.calls.find(c => c.init?.method === 'POST').init.body).config.adSpend[0].amount, 12345);
  const before = h.calls.filter(c => c.init?.method === 'POST').length;
  await act(async () => { h.tree().root.findByProps({ 'aria-label': '광고비 엑셀 파일' }).props.onChange({ target: { files: [file(true)], value: 'file' } }); await new Promise(r => setImmediate(r)); });
  assert.match(text(h.tree().toJSON()), /수식 셀/); assert.equal(h.calls.filter(c => c.init?.method === 'POST').length, before); h.close();
});
