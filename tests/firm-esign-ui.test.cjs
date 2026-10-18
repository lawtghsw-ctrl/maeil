const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const runtime = path.resolve(__dirname, '../../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer')), { act } = Renderer;
const root = path.resolve(__dirname, '..');
const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n ? text(n.children) : '';
const defer = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const safe = { connectionId: null, lawFirmId: 'firm1', canManage: true, configured: true, source: 'connection', companyId: 'company1', templates: [], updatedAt: null, presence: { apiKey: true, privateKey: true, memberId: true, senderMemberId: false } };
const preflight = { configured: true, templateName: '계약', fixedYear: 2026, documentId: null, sendBlocked: false, status: '미발송' };
function harness(file, initial, auth) {
  const calls = [];
  function load(relative) {
    const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { React, Date, AbortController }, { filename: relative })(name => {
      if (name === 'react') return React;
      if (name === '@/components/ui/DateInput') return { DateInput: ({ onValueChange, onIncompleteChange, ...props }) => React.createElement('input', { ...props, type: 'date', onChange: event => onValueChange(event.target.value) }) };
      if (name === 'lucide-react') return new Proxy({}, { get: (_t, key) => p => React.createElement('svg', { 'data-icon': key, ...p }) });
      if (name === '@/lib/platform/client') return { authJson: async (url, init) => { calls.push({ url, init }); return auth(url, init); } };
      if (name === '@/components/ui/Primitives') return { Modal: p => p.open ? React.createElement('section', {}, p.children) : null, Button: p => React.createElement('button', p), Input: p => React.createElement('input', p), Label: p => React.createElement('label', {}, p.children) };
      if (name === '@/lib/eformsign-config') return load('lib/eformsign-config.ts');
      throw new Error(name);
    }, module, module.exports); return module.exports;
  }
  const Component = load(file).default; let tree, props = initial;
  return { calls, tree: () => tree, mount: async () => act(async () => { tree = Renderer.create(React.createElement(Component, props)); }), update: async patch => act(async () => { props = { ...props, ...patch }; tree.update(React.createElement(Component, props)); }), close: () => act(() => tree.unmount()) };
}
const button = (h, label) => h.tree().root.findAllByType('button').find(n => text(n.props.children) === label);
const field = (h, label) => h.tree().root.findByProps({ 'aria-label': label });
const change = async (h, label, value) => act(async () => field(h, label).props.onValueChange ? field(h, label).props.onValueChange(value) : field(h, label).props.onChange({ target: { value } }));
test('firm admin sees read-only connection status without secret editor or save', async () => {
  const h = harness('components/platform/FirmEsignSettings.tsx', { lawFirmId: 'firm1' }, async () => ({ ...safe, canManage: false })); await h.mount();
  assert.equal(h.tree().root.findAllByType('textarea').length, 0); assert.equal(button(h, '연결·템플릿 저장'), undefined); assert.equal(h.tree().root.findAllByType('input').every(n => n.props.disabled), true); assert.equal(h.calls.length, 1); h.close();
});
test('connection save error preserves input; success clears secret values and does not call provider', async () => {
  let fail = true; const h = harness('components/platform/FirmEsignSettings.tsx', { lawFirmId: 'firm1' }, async (_url, init) => { if (init?.method === 'PUT') { if (fail) throw new Error('모의 저장 오류'); return { message: '저장 완료' }; } return safe; }); await h.mount();
  await change(h, '이폼사인 apiKey', 'private-test'); assert.equal(field(h, '이폼사인 apiKey').props.type, 'password');
  await act(async () => { await button(h, '연결·템플릿 저장').props.onClick(); await new Promise(r => setImmediate(r)); }); assert.equal(field(h, '이폼사인 apiKey').props.value, 'private-test');
  fail = false; await act(async () => { await button(h, '연결·템플릿 저장').props.onClick(); await new Promise(r => setImmediate(r)); }); assert.equal(field(h, '이폼사인 apiKey').props.value, ''); assert.equal(h.calls.every(c => c.url.startsWith('/api/firm/eformsign')), true); h.close();
});
test('firm change clears credentials and aborts/ignores stale settings response', async () => {
  const pending = []; const h = harness('components/platform/FirmEsignSettings.tsx', { lawFirmId: 'firm1' }, async () => { const d = defer(); pending.push(d); return d.promise; }); await h.mount();
  await h.update({ lawFirmId: 'firm2' }); assert.equal(h.calls[0].init.signal.aborted, true);
  await act(async () => pending[1].resolve({ ...safe, lawFirmId: 'firm2', companyId: 'second' })); await act(async () => pending[0].resolve(safe)); assert.equal(field(h, '이폼사인 회사 ID').props.value, 'second'); h.close();
});
const props = () => ({ open: true, client: { id: 'client', name: '모의 고객', phone: '01000000000', consultation: { personal: { address: '모의 주소' } } }, caseRecord: { id: 'case1', caseType: '개인회생', contractDate: '2026-10-18', contractAmount: 3000000 }, onClose() {} });
test('real-send dialog requires confirmation, clears it after changes and guards double-click synchronously', async () => {
  const d = defer(); const h = harness('components/cases/FirmEsignDocumentDialog.tsx', props(), async (_url, init) => init?.method === 'POST' ? d.promise : preflight); await h.mount();
  assert.equal(button(h, '실제 서명 요청 전송').props.disabled, true);
  await change(h, '전자계약 residentNumber', '000000-0000000'); await change(h, '전자계약 creditorCount', '2');
  await act(async () => field(h, '실제 전자계약 발송 확인').props.onChange({ target: { checked: true } }));
  await change(h, '전자계약 phone', '01011111111'); assert.equal(field(h, '실제 전자계약 발송 확인').props.checked, false);
  await change(h, '전자계약 contractDate', '2026-10-19'); assert.equal(field(h, '실제 전자계약 발송 확인').props.checked, false);
  await act(async () => field(h, '실제 전자계약 발송 확인').props.onChange({ target: { checked: true } }));
  const send = button(h, '실제 서명 요청 전송').props.onClick; await act(async () => { send(); send(); }); assert.equal(h.calls.filter(c => c.init?.method === 'POST').length, 1);
  assert.equal(JSON.parse(h.calls.find(c => c.init?.method === 'POST').init.body).contractDate, '2026-10-19');
  await act(async () => d.resolve({ documentId: 'doc', status: '서명 요청' })); assert.equal(button(h, '실제 서명 요청 전송').props.disabled, true); assert.ok(text(h.tree().toJSON()).includes('서명 요청이 전송되었습니다')); h.close();
});
test('lost send response prevents another send and offers status lookup; existing binding blocks send', async () => {
  const h = harness('components/cases/FirmEsignDocumentDialog.tsx', props(), async (url, init) => { if (!init?.method) return preflight; if (url.endsWith('/send')) throw new Error('모의 네트워크 오류'); return { documentId: 'doc', status: '서명완료' }; }); await h.mount();
  await change(h, '전자계약 residentNumber', '000000-0000000'); await change(h, '전자계약 creditorCount', '2'); await act(async () => field(h, '실제 전자계약 발송 확인').props.onChange({ target: { checked: true } }));
  await act(async () => button(h, '실제 서명 요청 전송').props.onClick()); assert.equal(button(h, '실제 서명 요청 전송').props.disabled, true); assert.ok(text(h.tree().toJSON()).includes('다시 전송하지'));
  await act(async () => button(h, '서명상태 확인').props.onClick()); assert.ok(text(h.tree().toJSON()).includes('서명완료')); h.close();
  const existing = harness('components/cases/FirmEsignDocumentDialog.tsx', props(), async () => ({ ...preflight, documentId: 'existing', sendBlocked: true })); await existing.mount(); assert.equal(button(existing, '실제 서명 요청 전송').props.disabled, true); assert.equal(existing.tree().root.findAllByType('input').length, 0); existing.close();
});
test('changing case aborts stale preflight and never carries resident number to another case', async () => {
  const h = harness('components/cases/FirmEsignDocumentDialog.tsx', props(), async () => preflight); await h.mount(); await change(h, '전자계약 residentNumber', 'sensitive');
  await h.update({ caseRecord: { ...props().caseRecord, id: 'case2' } }); assert.equal(field(h, '전자계약 residentNumber').props.value, ''); assert.equal(h.calls[0].init.signal.aborted, true); h.close();
});
