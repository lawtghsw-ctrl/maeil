// Actual NewLeadModal + AppStoreProvider with an in-memory Supabase fixture.
// No live Auth, database, SMS or external provider is accessed.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer')), { act } = Renderer;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value ? text(value.children) : '';
const delay = () => new Promise(resolve => setTimeout(resolve, 1));
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

// Reuse the existing thenable/RLS fixture definition without executing that
// test suite or its Module._load/global hooks.
const fixtureSource = ts.createSourceFile('fixture.js', fs.readFileSync(path.join(__dirname, 'store-performance.test.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fixtureFunction = fixtureSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'makeFixture');
assert.ok(fixtureFunction, 'shared in-memory store fixture exists');
const makeFixture = vm.runInNewContext(`(${fixtureFunction.getText(fixtureSource)})`, { clone, deferred });

function harness(options = {}) {
  const fixture = makeFixture(false), cache = new Map(), submitted = [], alerts = [];
  let tree, store, open = true, closed = 0;
  const actor = fixture.db.profiles[0];
  Object.assign(actor, { role: options.admin ? 'admin' : 'staff', platform_role: options.admin ? 'firm_admin' : 'staff', display_name: options.own === undefined ? '강이삭' : options.own, staff_name: options.own === undefined ? '강이삭' : options.own,
    is_work_staff: options.workStaff !== false, permissions: { 'db.view': true, 'db.create': options.create !== false, 'db.change_assignee': options.reassign === true } });
  const otherNames = options.others ?? ['박형원', '다른담당'];
  fixture.db.profiles.push(...otherNames.map((name, index) => ({ ...clone(actor), id: 'other-' + index, display_name: name, staff_name: name, role: 'staff', platform_role: 'staff', is_work_staff: true })));
  const baseline = clone(fixture.db);
  const events = () => ({ addEventListener() {}, removeEventListener() {} });
  const window = { ...events(), sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { replace() {} }, alert: message => alerts.push(message) };
  const globals = { React, console, Date, Error, Map, Set, Math, crypto: require('node:crypto').webcrypto, window, document: { ...events(), visibilityState: 'visible' }, alert: message => alerts.push(message),
    setTimeout: (fn, ms, ...args) => setTimeout(fn, ms === 180 ? 0 : ms, ...args), clearTimeout,
    fetch() { throw Error('Network/provider access prohibited'); } };
  const host = tag => ({ children, ...props }) => React.createElement(tag, props, children);
  const primitives = { Button: host('button'), Card: host('section'), Input: host('input'), Select: host('select'),
    Modal: ({ open, title, onClose, children }) => open ? React.createElement('section', { role: 'dialog', 'aria-label': title }, children) : null };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const module = { exports: {} }; cache.set(relative, module);
    let source = fs.readFileSync(path.join(root, relative), 'utf8');
    // Export the real private component in this VM only; its body is unmodified.
    if (relative === 'app/db/page.tsx') source += '\nexport { NewLeadModal };';
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const requireFile = name => {
      if (name === 'react' || name.startsWith('react/')) return require(path.join(runtime, name));
      if (name === 'next/navigation') return { usePathname: () => '/db' };
      if (name === 'next/link') return { __esModule: true, default: host('a') };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (relative === 'lib/store.tsx' && name === './supabase/client') return { createClient: () => fixture.client, hasSupabaseEnv: () => true };
      if (name === '@/components/ui/Primitives') return primitives;
      if (name === '@/lib/store') return { ...load('lib/store.tsx'), useStore: () => {
        const actual = load('lib/store.tsx').useStore();
        return { ...actual, addLead: draft => { submitted.push(clone(draft)); return options.failSave ? '' : actual.addLead(draft); } };
      } };
      if (name === '@/components/sms/LeadSmsDialog' || name === '@/components/db/LeadWorkDialog') return { __esModule: true, default: () => null };
      if (name === '@/components/ui/consultation/ConsultationModal') return { ConsultationModal: () => null };
      if (name === '@/components/ui/ReservationDateTimeEditor') return { ReservationDateTimeEditor: () => null };
      if (name === '@/components/ui/ConfirmDelete') return { ConfirmDelete: () => null };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const file = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(relative), name);
        return load(file + (fs.existsSync(path.join(root, file + '.tsx')) ? '.tsx' : '.ts'));
      }
      throw Error('Unexpected dependency: ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, globals, { filename: relative })(requireFile, module, module.exports);
    return module.exports;
  }
  const api = load('lib/store.tsx'), Modal = load('app/db/page.tsx').NewLeadModal;
  function Probe() { store = api.useStore(); return null; }
  function View() { return React.createElement(api.AppStoreProvider, {}, React.createElement(Probe), React.createElement(Modal, { open, onClose: () => { closed++; open = false; render(); } })); }
  function render() { tree.update(React.createElement(View)); }
  const control = label => tree.root.findAllByType('label').find(node => text(node).trim().startsWith(label)).findByType('select');
  const input = placeholder => tree.root.findByProps({ placeholder });
  const button = label => tree.root.findAllByType('button').find(node => text(node).trim() === label);
  async function tick() { for (let i = 0; i < 6; i++) await act(async () => { await delay(); }); }
  return {
    fixture, baseline, submitted, alerts, get store() { return store; }, get tree() { return tree; }, get closed() { return closed; }, control, input, button,
    get inserted() { return fixture.db.app_leads.filter(row => !baseline.app_leads.some(old => old.id === row.id)); },
    mount: async () => { await act(async () => { tree = Renderer.create(React.createElement(View)); }); await tick(); },
    fill: async () => { await act(async () => { input('고객명').props.onChange({ target: { value: ' 합성 신규 DB ' } }); input('010-0000-0000').props.onChange({ target: { value: ' 010-0000-0099 ' } }); input('초기 상담 메모').props.onChange({ target: { value: ' untouched manual memo ' } }); }); },
    submit: async () => { await act(async () => button('추가').props.onClick()); await tick(); },
    cancel: async () => { await act(async () => button('취소').props.onClick()); },
    reopen: async () => { open = true; await act(async () => render()); await tick(); },
    refreshActor: async patch => { Object.assign(actor, patch); await act(async () => { await store.reloadData(); }); await tick(); },
    directAdd: async draft => { let id; await act(async () => { id = store.addLead(draft); }); await tick(); return id; },
    close: async () => { await act(async () => tree.unmount()); await tick(); },
  };
}

for (const reassign of [false, true]) test(`ordinary staff defaults to self and persists self even with reassignment permission ${reassign}`, async () => {
  const h = harness({ reassign }); await h.mount();
  try {
    assert.equal(h.control('담당자').props.value, '강이삭'); assert.equal(h.control('담당자').props.disabled, true);
    await h.fill(); await h.submit();
    assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].assignedStaff, '강이삭');
    assert.equal(h.inserted.length, 1); const saved = h.inserted[0];
    assert.equal(saved.law_firm_id, 'firm-1'); assert.equal(saved.data.assignedStaff, '강이삭');
    assert.equal(saved.data.name, '합성 신규 DB'); assert.equal(saved.data.phone, '010-0000-0099');
    assert.equal(saved.data.memo, 'untouched manual memo'); assert.equal(saved.data.status, '신규접수'); assert.equal(saved.data.detailStage, '신규디비');
    assert.equal(h.store.leads.find(row => row.id === saved.id).assignedStaff, '강이삭');
    assert.equal(h.closed, 1);
    for (const table of ['app_clients', 'app_cases', 'app_installments', 'firm_settings', 'profiles']) assert.deepEqual(clone(h.fixture.db[table]), h.baseline[table]);
    assert.ok(h.fixture.calls.filter(call => call.operation && call.operation !== 'select').every(call => ['app_leads', 'app_change_logs'].includes(call.table)));
  } finally { await h.close(); }
});

test('actual store ignores a forged other-assignee draft for ordinary staff', async () => {
  const h = harness(); await h.mount();
  try {
    const id = await h.directAdd({ name: 'Direct synthetic', phone: '', assignedStaff: '박형원', status: '신규접수', source: '기타' });
    assert.ok(id); assert.equal(h.inserted[0].data.assignedStaff, '강이삭'); assert.equal(h.store.leads[0].assignedStaff, '강이삭');
  } finally { await h.close(); }
});

test('staff missing a resolved own name cannot submit to another employee and later profile load selects self', async () => {
  const h = harness({ own: '' }); await h.mount();
  try {
    assert.equal(h.store.currentStaff, undefined); assert.equal(h.control('담당자').props.value, '');
    await h.fill(); assert.equal(h.button('추가').props.disabled, true);
    await h.submit(); assert.equal(h.submitted.length, 0); assert.equal(h.inserted.length, 0); assert.equal(h.closed, 0);
    const id = await h.directAdd({ name: 'Rejected synthetic', phone: '', assignedStaff: '박형원', status: '신규접수' });
    assert.equal(id, ''); assert.equal(h.inserted.length, 0);
    await h.refreshActor({ display_name: '강이삭', staff_name: '강이삭' });
    assert.equal(h.control('담당자').props.value, '강이삭'); assert.equal(h.button('추가').props.disabled, false);
    assert.equal(h.input('고객명').props.value, ' 합성 신규 DB ');
    await h.submit(); assert.equal(h.inserted[0].data.assignedStaff, '강이삭');
  } finally { await h.close(); }
});

test('staff own-name assignment does not depend on being present in the work-staff directory', async () => {
  const h = harness({ own: '별도직원', workStaff: false }); await h.mount();
  try {
    assert.equal(h.store.workStaffNames.includes('별도직원'), false);
    assert.equal(h.control('담당자').props.value, '별도직원');
    assert.ok(h.control('담당자').findAllByType('option').some(option => option.props.value === '별도직원'));
    await h.fill(); await h.submit(); assert.equal(h.inserted[0].data.assignedStaff, '별도직원');
  } finally { await h.close(); }
});

test('reopening a mounted modal and late profile changes cannot retain the previous employee default', async () => {
  const h = harness(); await h.mount();
  try {
    assert.equal(h.control('담당자').props.value, '강이삭'); await h.cancel();
    await h.refreshActor({ display_name: '새직원', staff_name: '새직원' }); await h.reopen();
    assert.equal(h.control('담당자').props.value, '새직원');
    await h.refreshActor({ display_name: '마지막직원', staff_name: '마지막직원' });
    assert.equal(h.control('담당자').props.value, '마지막직원');
    await h.fill(); await h.submit(); assert.equal(h.submitted[0].assignedStaff, '마지막직원'); assert.equal(h.inserted[0].data.assignedStaff, '마지막직원');
  } finally { await h.close(); }
});

test('administrators use their own listed staff identity, otherwise retain intake-owner and first-staff fallback', async () => {
  for (const [options, expected] of [[{ admin: true }, '강이삭'], [{ admin: true, own: '', workStaff: false }, '박형원'], [{ admin: true, own: '운영관리', workStaff: false, others: ['담당B', '담당A'] }, '담당A']]) {
    const h = harness(options); await h.mount();
    try {
      assert.equal(h.control('담당자').props.value, expected); assert.equal(h.control('담당자').props.disabled, true);
      await h.fill(); await h.submit(); assert.equal(h.inserted[0].data.assignedStaff, expected);
    } finally { await h.close(); }
  }
});

test('a rejected store registration keeps the entered draft and modal open instead of pretending success', async () => {
  const h = harness({ failSave: true }); await h.mount();
  try {
    await h.fill(); await h.submit();
    assert.equal(h.closed, 0); assert.equal(h.inserted.length, 0);
    assert.equal(h.input('고객명').props.value, ' 합성 신규 DB '); assert.equal(h.input('초기 상담 메모').props.value, ' untouched manual memo ');
  } finally { await h.close(); }
});

test('existing db.create permission denial still prevents all store writes', async () => {
  const h = harness({ create: false }); await h.mount();
  try {
    const id = await h.directAdd({ name: 'Forbidden synthetic', phone: '', assignedStaff: '강이삭', status: '신규접수' });
    assert.equal(id, ''); assert.equal(h.inserted.length, 0);
    assert.ok(h.fixture.calls.every(call => !call.operation || call.operation === 'select'));
  } finally { await h.close(); }
});
