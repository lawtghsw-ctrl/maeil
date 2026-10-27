// Synthetic component tests only; no network, customer data, or provider access.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const runtime = path.resolve(__dirname, '../../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), renderer = require(path.join(runtime, 'react-test-renderer'));
const { act } = renderer, root = path.resolve(__dirname, '..');
function harness(owned = false, all = false) {
  const writes = [], captures = {}, routes = [], storage = new Map();
  const window = { innerWidth: 1200, innerHeight: 800, localStorage: { getItem: () => null }, sessionStorage: { setItem: (key, value) => storage.set(key, value) }, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  const lead = { id: 'lead', _lawFirmId: 'firm', name: 'Synthetic', phone: '00000000000', assignedStaff: owned ? 'Me' : 'Other', detailStage: '장기부재', status: '부재중', receivedAt: '2026-10-27' };
  const record = { id: 'case', _lawFirmId: 'firm', clientId: 'client', fromLeadId: 'lead', assignedStaff: 'Me', contractAmount: 0, paidAmount: 0 };
  const state = { profile: { id: 'actor', role: 'staff', platformRole: 'staff', lawFirmId: 'firm', isActive: true, staffName: 'Me' }, currentStaff: 'Me', superAdminFirmScope: null,
    leads: [lead], cases: [record], clients: [{ id: 'client', _lawFirmId: 'firm', fromLeadId: 'lead' }], can: key => key !== 'db.view_all' || all,
    updateLead: async (...args) => { writes.push(args); return true; } };
  const modules = new Map();
  function load(file) {
    const filename = path.resolve(root, file); if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, Date, Intl, window, crypto: { randomUUID: () => 'synthetic' } }, { filename })(name => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(path.join(runtime, 'react/jsx-runtime'));
      if (name === '@/lib/store') return { useStore: () => state, useStoreSession: () => state };
      if (name === 'next/navigation') return { useRouter: () => ({ push: path => routes.push(path) }) };
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/components/ui/Primitives') return { Modal: ({ children }) => React.createElement('section', {}, children) };
      if (name === '@/components/ui/consultation/ConsultationModal') return { ConsultationModal: props => { captures.consultation = props; return null; } };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
        return load(['.ts', '.tsx'].map(ext => target + ext).find(fs.existsSync));
      }
      throw new Error('Unexpected dependency/network: ' + name);
    }, module, module.exports);
    return module.exports;
  }
  return { load, state, writes, captures, routes, storage };
}
test('case consultation shared lead is read-only and direct save invocation performs no write', async () => {
  const h = harness(), Component = h.load('components/cases/CaseConsultationModal.tsx').CaseConsultationModal;
  let view; await act(async () => { view = renderer.create(React.createElement(Component, { caseId: 'case', onClose() {} })); });
  try {
    const props = h.captures.consultation; assert.ok(props); assert.equal(props.readOnly, true);
    for (const key of ['allowPhoneEdit', 'allowNameEdit', 'allowApplicationTypeEdit']) assert.equal(props[key], false);
    assert.equal(await props.onSave({}, 'changed'), false); assert.equal(h.writes.length, 0);
  } finally { await act(async () => view.unmount()); }
});
test('own and preexisting view_all case consultation rights remain writable', async () => {
  for (const [owned, all] of [[true, false], [false, true]]) {
    const h = harness(owned, all), Component = h.load('components/cases/CaseConsultationModal.tsx').CaseConsultationModal;
    let view; await act(async () => { view = renderer.create(React.createElement(Component, { caseId: 'case', onClose() {} })); });
    try { assert.equal(h.captures.consultation.readOnly, false); assert.equal(await h.captures.consultation.onSave({}), true); assert.equal(h.writes.length, 1); }
    finally { await act(async () => view.unmount()); }
  }
});
test('shared contact/reason dialog disables both fieldsets and direct save handlers', async () => {
  const h = harness(), Component = h.load('components/db/LeadWorkDialog.tsx').default;
  let view; await act(async () => { view = renderer.create(React.createElement(Component, { leadId: 'lead', onClose() {} })); });
  try {
    assert.equal(view.root.findAllByType('fieldset').length, 2);
    assert.ok(view.root.findAllByType('fieldset').every(node => node.props.disabled));
    for (const button of view.root.findAllByType('button')) await act(async () => button.props.onClick());
    assert.equal(h.writes.length, 0);
  } finally { await act(async () => view.unmount()); }
});

test('actual Header search shares only same-firm absent leads and rechecks profile changes without widening alerts', async () => {
  const h = harness();
  h.state.can = key => key === 'db.view';
  Object.assign(h.state, { cases: [], clients: [], installments: [], scheduleItems: [], isAdmin: false });
  const base = h.state.leads[0];
  h.state.leads = [
    { ...base, id: 'shared', name: 'Search shared', reservationAt: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}T12:00` },
    { ...base, id: 'own', name: 'Search own', assignedStaff: 'Me', detailStage: '상담' },
    { ...base, id: 'other', name: 'Search other', detailStage: '상담' },
    { ...base, id: 'foreign', name: 'Search foreign', _lawFirmId: 'foreign' },
  ];
  const Component = h.load('components/layout/Header.tsx').Header;
  let view; await act(async () => { view = renderer.create(React.createElement(Component)); });
  const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
  const matches = () => view.root.findAllByType('button').filter(node => text(node).includes('Search '));
  try {
    await act(async () => view.root.findByType('input').props.onChange({ target: { value: 'Search' } }));
    assert.deepEqual(matches().map(text), ['Search shared00000000000DBOther', 'Search own00000000000DBMe']);
    assert.ok(text(view.toJSON()).includes('3일 이내 예정된 예약콜이 없습니다.'), 'Shared reservation does not create an own-work alert');
    h.state.profile = { ...h.state.profile, permissions: { 'staff.writer': true } };
    await act(async () => view.update(React.createElement(Component)));
    assert.deepEqual(matches().map(text), ['Search own00000000000DBMe'], 'Writer cannot gain shared result despite raw fixture data');
    h.state.profile = { ...h.state.profile, permissions: {}, isActive: false };
    await act(async () => view.update(React.createElement(Component)));
    assert.equal(matches().length, 1);
    h.state.profile = { ...h.state.profile, isActive: true };
    await act(async () => view.update(React.createElement(Component)));
    assert.equal(matches().length, 2);
    await act(async () => matches()[0].props.onClick());
    assert.deepEqual(h.routes, ['/db']);
    assert.equal(h.storage.get('lawpower_db_search'), '00000000000');
    assert.equal(h.writes.length, 0);
  } finally { await act(async () => view.unmount()); }
});
