// Offline feature tests: execute current helpers, UI components and AppStore.
// React test renderer only; no browser, remote database or provider requests.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const storeHarness = require('./store-performance.test.cjs');
const { React, renderer, act } = storeHarness;
const h = React.createElement;
const clone = value => JSON.parse(JSON.stringify(value));
const prohibited = () => { throw new Error('Network/provider use prohibited by writing-staff fixture'); };
test.after(() => storeHarness.restoreRuntime());

function loader(mocks = {}, globals = {}) {
  const modules = new Map();
  const context = vm.createContext({ console, Date, Intl, URL, URLSearchParams, Map, Set, fetch: prohibited, ...globals });
  function load(file) {
    const filename = path.resolve(root, file);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context, { filename })(name => {
      if (name in mocks) return mocks[name];
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(path.resolve(root, '../store-test-runtime/node_modules/react/jsx-runtime'));
      if (name === 'lucide-react') return new Proxy({}, { get: (_, icon) => props => h('i', { 'data-icon': String(icon) }) });
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => h('a', props, children) };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
        const resolved = ['.ts', '.tsx'].map(ext => target + ext).find(fs.existsSync);
        if (!resolved) throw new Error('Unmocked local module ' + name);
        return load(resolved);
      }
      return require(name);
    }, module, module.exports);
    return module.exports;
  }
  return load;
}
const load = loader();
const writer = load('lib/writing-staff.ts');
const permissions = load('lib/permissions.ts');
const types = load('lib/types.ts');
const wide = Object.fromEntries(permissions.ALL_PERMISSION_KEYS.map(key => [key, true]));
const writerProfile = { id: 'writer', role: 'staff', platformRole: 'staff', lawFirmId: 'firm-1',
  displayName: '합성 작성직원', staffName: 'Writer', isActive: true, permissions: { ...wide, 'staff.writer': true } };
const fixed = clone(permissions.WRITING_STAFF_PERMISSIONS);

test('writer identity requires an exact marker and staff role; administrator exceptions remain', () => {
  assert.equal(writer.isWritingStaff(writerProfile), true);
  assert.equal(writer.isWritingStaff({ role: 'staff', platform_role: 'staff', permissions: { 'staff.writer': true } }), true);
  for (const profile of [null, {}, { ...writerProfile, role: 'admin' }, { ...writerProfile, platformRole: 'firm_admin' },
    { ...writerProfile, platformRole: 'super_admin' }, { ...writerProfile, permissions: {} },
    { ...writerProfile, permissions: { 'staff.writer': 'true' } }, { permissions: { 'staff.writer': true } }]) {
    assert.equal(writer.isWritingStaff(profile), false);
  }
});

test('every stage in the four allowed tracks is accepted; explicit consultation/unknown stages deny despite converted status', () => {
  let allowed = 0, denied = 0;
  for (const [stage, track] of Object.entries(types.DB_DETAIL_STAGE_TRACK_OF)) {
    const expected = ['착수', '서류', '법원', '워크아웃'].includes(track);
    assert.equal(writer.isWritingLead({ detailStage: stage, status: '수임전환' }), expected, stage);
    expected ? allowed++ : denied++;
  }
  assert.ok(allowed > 15 && denied > 5, 'Exercise real complete stage catalog');
  for (const detailStage of ['', '알 수 없음', '상담', '불가']) assert.equal(writer.isWritingLead({ detailStage, status: '수임전환' }), false);
  for (const status of ['서류검토중', '계약진행중', '수임전환']) assert.equal(writer.isWritingLead({ status }), true, status);
  for (const status of ['신규접수', '상담완료', '부적합', '미지정', undefined]) assert.equal(writer.isWritingLead({ status }), false, String(status));
});

test('fixed writer preset strips stale wide permissions and remains immutable through individual selection helpers', () => {
  const input = { ...wide, 'staff.writer': true }, before = clone(input);
  const actual = permissions.normalizePermissions(input);
  assert.deepEqual(clone(actual), fixed); assert.deepEqual(input, before);
  const preset = permissions.PERMISSION_PRESETS.find(row => row.id === 'writing_staff');
  assert.equal(preset.label, '작성직원'); assert.deepEqual(clone(permissions.normalizePermissions(preset.permissions)), fixed);
  for (const key of ['sms.send', 'sms.view_history', 'cases.econtract', 'cases.send_docs', 'settlements.view', 'db.delete', 'cases.delete']) {
    assert.equal(writer.writingPermission(key), false, key);
    assert.equal(permissions.setPermissionSelection(actual, [key], true)[key], undefined, key);
  }
  assert.deepEqual(clone(permissions.setPermissionSelection(actual, ['db.view'], false)), fixed);
  assert.equal(permissions.normalizePermissions({ 'db.edit_basic': true })['staff.writer'], undefined);
});

function workspaceFixture() {
  const lead = (id, detailStage, extra = {}) => ({ id, _lawFirmId: 'firm-1', receivedAt: '2026-10-23', status: '수임전환', detailStage, name: '동명이인', phone: '01000000000', assignedStaff: 'Other', ...extra });
  const client = (id, fromLeadId, extra = {}) => ({ id, _lawFirmId: 'firm-1', name: '동명이인', phone: '01000000000', ...(fromLeadId ? { fromLeadId } : {}), ...extra });
  const record = (id, clientId, fromLeadId, extra = {}) => ({ id, _lawFirmId: 'firm-1', clientId, ...(fromLeadId ? { fromLeadId } : {}), ...extra });
  const leads = [lead('allow', '착수금착수'), lead('deny', '상담'), lead('unknown', '새로운 단계'),
    lead('foreign', '법원접수', { _lawFirmId: 'firm-2' }), lead('reverse', '워크아웃', { convertedCaseId: 'K-reverse' }),
    lead('ambiguous-a', '법원접수', { convertedCaseId: 'K-ambiguous' }), lead('ambiguous-b', '상담', { convertedCaseId: 'K-ambiguous' })];
  const clients = [client('C-allow', 'allow'), client('C-deny', 'deny'), client('C-unlinked'), client('C-missing', 'gone'),
    client('C-foreign', 'foreign', { _lawFirmId: 'firm-2' }), client('C-reverse'), client('C-ambiguous'), client('C-conflict', 'deny')];
  const cases = [record('K-allow', 'C-allow', 'allow'), record('K-deny', 'C-deny', 'deny'), record('K-unlinked', 'C-unlinked'),
    record('K-missing', 'C-missing', 'gone'), record('K-foreign', 'C-foreign', 'foreign', { _lawFirmId: 'firm-2' }),
    record('K-reverse', 'C-reverse'), record('K-ambiguous', 'C-ambiguous'), record('K-conflict', 'C-conflict', 'allow')];
  const installments = cases.map(row => ({ id: `I-${row.id}`, caseId: row.id, amount: 0, _lawFirmId: row._lawFirmId }));
  return { leads, clients, cases, installments, scheduleItems: [{ id: 'S', _lawFirmId: 'firm-1', caseId: 'K-allow' }] };
}

test('writer workspace preserves only same-tenant allowed linked cases/clients/installments; no guessing or source mutation', () => {
  const data = workspaceFixture(), before = clone(data), result = writer.writingWorkspaceData(data, 'firm-1');
  assert.deepEqual(clone(result.leads.map(row => row.id)), ['allow', 'reverse', 'ambiguous-a']);
  assert.deepEqual(clone(result.clients.map(row => row.id)), ['C-allow', 'C-reverse']);
  assert.deepEqual(clone(result.cases.map(row => row.id)), ['K-allow', 'K-reverse']);
  assert.deepEqual(clone(result.installments.map(row => row.id)), ['I-K-allow', 'I-K-reverse']);
  assert.equal(result.installments[0].amount, 0); assert.deepEqual(clone(result.scheduleItems), []);
  assert.deepEqual(data, before); assert.equal(result.leads[0], data.leads[0]);
  const empty = writer.writingWorkspaceData(data, undefined);
  for (const rows of Object.values(empty)) assert.equal(rows.length, 0);
  assert.equal(writer.writingCaseAllowed({ ...data.cases[0], fromLeadId: 'missing' }, data.clients, data.leads, 'firm-1'), false);
  assert.equal(writer.writingCaseAllowed(data.cases[0], data.clients, [...data.leads, { ...data.leads[0] }], 'firm-1'), false);
});

test('lead access keeps assignment, tenant and view checks while writer view_all covers allowed other-staff records only', () => {
  const row = workspaceFixture().leads[0];
  assert.equal(writer.canReadLeadForProfile(writerProfile, row, writer.writingPermission), true);
  assert.equal(writer.canReadLeadForProfile(writerProfile, { ...row, detailStage: '상담' }, () => true), false);
  assert.equal(writer.canReadLeadForProfile(writerProfile, { ...row, _lawFirmId: 'firm-2' }, () => true), false);
  assert.equal(writer.canReadLeadForProfile(writerProfile, row, () => false), false);
  const ordinary = { ...writerProfile, permissions: {}, staffName: ' Same ' };
  const viewOnly = key => key === 'db.view';
  assert.equal(writer.canReadLeadForProfile(ordinary, { ...row, assignedStaff: 'Same' }, viewOnly), true);
  assert.equal(writer.canReadLeadForProfile(ordinary, row, viewOnly), false);
});

const host = tag => ({ children, size, variant, ...props }) => h(tag, props, children);
const primitives = { Button: host('button'), Input: host('input'), Select: host('select'), Card: host('div'),
  PageHeader: ({ title, description, actions }) => h('header', null, h('h1', null, title), description, actions),
  Modal: ({ open, title, children }) => open ? h('section', { 'data-modal': title }, children) : null };
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('');
const buttons = (view, label) => view.root.findAll(node => node.type === 'button' && text(node).trim() === label);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

test('actual staff management selects writer, locks permission controls, PATCHes fixed permissions and reloads the saved role', async () => {
  let row = { id: 'staff-fixture', email: 'synthetic@example.invalid', displayName: '합성 직원', role: 'staff', platformRole: 'staff',
    lawFirmId: 'firm-1', staffName: 'Fixture', isActive: true, isWorkStaff: true, autoAssignLeads: true, leadAssignmentOrder: 7, permissions: { ...wide } };
  const requests = []; let reloads = 0;
  const mockedFetch = async (url, options) => {
    assert.equal(url, '/api/admin/users'); assert.equal(options.headers.Authorization, 'Bearer memory-session');
    requests.push({ method: options.method, body: options.body && JSON.parse(options.body) });
    if (options.method === 'PATCH') row = { ...row, ...JSON.parse(options.body) };
    else assert.equal(options.method, 'GET', 'No account creation, deletion, provider or other endpoint');
    return { ok: true, json: async () => ({ users: [clone(row)] }) };
  };
  const session = { currentUser: { id: 'manager' }, isAdmin: true, profile: { role: 'admin', platformRole: 'firm_admin', lawFirmId: 'firm-1' },
    superAdminFirmScope: null, firmDirectory: [], reloadData: async () => { reloads++; } };
  // Keep module loading distinct from mounting; the actual effect performs GET.
  const Component = loader({ '@/lib/store': { useStoreSession: () => session }, '@/lib/supabase/client': { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'memory-session' } } }) } }) },
    '@/components/ui/Primitives': primitives, '@/components/staff/LeadAssignmentModal': { LeadAssignmentModal: () => null },
    '@/components/staff/StaffInvitePanel': { __esModule: true, default: () => null } }, { fetch: mockedFetch })('app/staff-accounts/page.tsx').default;
  let view; await act(async () => { view = renderer.create(h(Component)); }); await flush();
  try {
    assert.deepEqual(requests.map(row => row.method), ['GET']);
    await act(async () => buttons(view, '설정')[0].props.onClick());
    await act(async () => buttons(view, '작성직원')[0].props.onClick());
    let editor = view.root.findAll(node => typeof node.type === 'function' && node.type.name === 'PermissionEditor')[0];
    assert.deepEqual(clone(editor.props.value), fixed); assert.equal(editor.props.readOnly, true);
    assert.ok(editor.findAllByType('input').length > 20);
    assert.ok(editor.findAllByType('input').every(node => node.props.disabled));
    assert.equal(buttons(view, '전체 선택').length, 0);
    // Invoking a disabled control's handler directly must also remain inert.
    await act(async () => editor.findAllByType('input')[0].props.onChange());
    await act(async () => buttons(view, '설정 저장')[0].props.onClick()); await flush();
    assert.deepEqual(requests.map(row => row.method), ['GET', 'PATCH', 'GET']); assert.equal(reloads, 1);
    const payload = requests[1].body;
    assert.equal(payload.id, 'staff-fixture'); assert.equal(payload.role, 'staff'); assert.equal(payload.autoAssignLeads, false);
    assert.deepEqual(payload.permissions, fixed); assert.equal(payload.leadAssignmentOrder, 7);
    assert.equal(payload.email, 'synthetic@example.invalid'); assert.equal(payload.isActive, true); assert.equal(payload.isWorkStaff, true);
    assert.equal(view.root.findAllByType('section').length, 0);
    assert.match(text(view.root), /작성직원/);
    await act(async () => buttons(view, '설정')[0].props.onClick());
    editor = view.root.findAll(node => typeof node.type === 'function' && node.type.name === 'PermissionEditor')[0];
    assert.equal(editor.props.readOnly, true); assert.deepEqual(clone(editor.props.value), fixed);
    // An explicit switch back to another preset removes the marker and restores editing.
    const otherPreset = permissions.PERMISSION_PRESETS.find(preset => preset.id !== 'writing_staff');
    await act(async () => buttons(view, otherPreset.label)[0].props.onClick());
    editor = view.root.findAll(node => typeof node.type === 'function' && node.type.name === 'PermissionEditor')[0];
    assert.equal(editor.props.readOnly, false); assert.equal(editor.props.value['staff.writer'], undefined);
    assert.ok(editor.findAllByType('input').some(node => !node.props.disabled));
  } finally { await act(async () => view.unmount()); }
});

test('actual Sidebar shows exactly DB and cases on desktop and mobile even with stale wide raw permissions', async () => {
  const session = { profile: writerProfile, isAdmin: false, can: () => true, firmDirectory: [], superAdminFirmScope: null, currentUser: { id: 'writer' }, signOut: async () => {} };
  const Sidebar = loader({ 'next/navigation': { usePathname: () => '/db', useRouter: () => ({ push: prohibited }) },
    '@/lib/store': { useStoreSession: () => session }, '@/components/brand/BrandLogo': { BrandLogo: () => null },
    '@/lib/platform/client': { authJson: prohibited } })('components/layout/Sidebar.tsx').Sidebar;
  let view; await act(async () => { view = renderer.create(h(Sidebar)); });
  try {
    assert.deepEqual(view.root.findAllByType('a').map(node => node.props.href), ['/db', '/cases']);
    await act(async () => view.root.findByProps({ 'aria-label': '메뉴 열기' }).props.onClick());
    const menus = view.root.findAllByProps({ 'aria-label': '주 메뉴' }); assert.equal(menus.length, 2);
    for (const menu of menus) assert.deepEqual(menu.findAllByType('a').map(node => node.props.href), ['/db', '/cases']);
    await act(async () => menus[1].findAllByType('a')[0].props.onClick());
    assert.equal(view.root.findAllByProps({ 'aria-label': '주 메뉴' }).length, 1);
  } finally { await act(async () => view.unmount()); }
});

test('actual AppShell blocks forbidden direct URLs before children mount, redirects home, and never starts writer Meta timers', async () => {
  let pathname = '/', mounted = 0; const redirects = [], timers = new Map();
  const router = { replace: path => redirects.push(path), push: prohibited, refresh: prohibited };
  const session = { profile: writerProfile, isAdmin: false, can: () => true, superAdminFirmScope: null };
  const win = { setTimeout: fn => { timers.set('first', fn); return 'first'; }, setInterval: fn => { timers.set('interval', fn); return 'interval'; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id) };
  const AppShell = loader({ 'next/navigation': { usePathname: () => pathname, useRouter: () => router },
    '@/lib/store': { AppStoreProvider: ({ children }) => children, useStoreSession: () => session },
    '@/components/layout/Sidebar': { Sidebar: () => null }, '@/components/layout/Header': { Header: () => null },
    '@/lib/platform/client': { authJson: prohibited } }, { window: win, document: { visibilityState: 'visible' } })('components/layout/AppShell.tsx').AppShell;
  function PrivateWork() { React.useEffect(() => { mounted++; return () => { mounted--; }; }, []); return h('p', null, 'PRIVATE_WORK'); }
  let view; const render = () => h(AppShell, null, h(PrivateWork));
  await act(async () => { view = renderer.create(render()); });
  try {
    assert.deepEqual(redirects, ['/db']); assert.equal(mounted, 0);
    for (const route of ['/db', '/db/one', '/cases', '/cases/one']) {
      pathname = route; await act(async () => view.update(render())); assert.equal(mounted, 1, route);
    }
    for (const route of ['/sms', '/analytics', '/settlements', '/changes', '/min-living-cost', '/account', '/platform', '/staff-accounts', '/firm/settings', '/not-registered', '/db-other', '/cases-other']) {
      pathname = route; await act(async () => view.update(render()));
      assert.equal(mounted, 0, route); assert.match(text(view.root), /접근 권한/); assert.equal(timers.size, 0);
    }
  } finally { await act(async () => view.unmount()); }
  assert.equal(timers.size, 0);
});

function prepareStore(fixture) {
  Object.assign(fixture.db.profiles[0], { role: 'staff', platform_role: 'staff', permissions: { ...wide, 'staff.writer': true } });
  const data = workspaceFixture();
  const tables = { leads: 'app_leads', clients: 'app_clients', cases: 'app_cases', installments: 'app_installments', scheduleItems: 'app_schedule_items' };
  for (const [key, table] of Object.entries(tables)) fixture.db[table] = data[key].map(({ id, _lawFirmId, ...data }) => ({ id, law_firm_id: _lawFirmId, data }));
}

test('actual AppStore reads writer profile and filters entities even when mock RLS returns all same-firm stages', async () => {
  await storeHarness.mount(false, '/db', prepareStore);
  try {
    const store = storeHarness.store;
    assert.equal(store.profile.permissions['staff.writer'], true); assert.equal(store.isAdmin, false);
    for (const key of permissions.ALL_PERMISSION_KEYS) assert.equal(store.can(key), fixed[key] === true, key);
    assert.deepEqual(store.leads.map(row => row.id).sort(), ['allow', 'ambiguous-a', 'reverse']);
    assert.deepEqual(store.clients.map(row => row.id).sort(), ['C-allow', 'C-reverse']);
    assert.deepEqual(store.cases.map(row => row.id).sort(), ['K-allow', 'K-reverse']);
    assert.deepEqual(store.installments.map(row => row.id).sort(), ['I-K-allow', 'I-K-reverse']);
    for (const key of ['scheduleItems', 'posts', 'changeLog']) assert.deepEqual(store[key], []);
    assert.deepEqual(store.caseDocuments, {});
  } finally { await storeHarness.unmount(); }
});

test('actual AppStore permits allowed other-staff DB edits and denies consultation, unknown-stage, identity and downgrade changes before persistence', async () => {
  await storeHarness.mount(false, '/db', prepareStore);
  try {
    let result;
    await act(async () => { result = await storeHarness.store.updateLead('allow', { name: '수정 이름', detailStage: '1차 서류미비' }); }); await storeHarness.tick();
    assert.equal(result, true);
    assert.equal(storeHarness.fixture.db.app_leads.find(row => row.id === 'allow').data.name, '수정 이름');
    const before = clone(storeHarness.fixture.db), callsBefore = storeHarness.fixture.calls.length;
    for (const [id, patch] of [['deny', { name: '금지' }], ['unknown', { detailStage: '법원접수' }], ['allow', { detailStage: '상담' }],
      ['allow', { detailStage: '새 단계' }], ['allow', { id: 'replacement' }], ['allow', { _lawFirmId: 'firm-2' }]]) {
      await act(async () => { result = await storeHarness.store.updateLead(id, patch); }); assert.equal(result, false, id + JSON.stringify(patch));
    }
    await act(async () => storeHarness.store.deleteLead('allow')); await storeHarness.tick();
    assert.deepEqual(storeHarness.fixture.db, before);
    assert.equal(storeHarness.fixture.calls.slice(callsBefore).filter(call => call.operation && call.operation !== 'select').length, 0);
  } finally { await storeHarness.unmount(); }
});

test('actual AppStore permits linked allowed case edits but denies consultation/unlinked cases, document sends and deletes', async () => {
  await storeHarness.mount(false, '/cases', prepareStore);
  try {
    await act(async () => storeHarness.store.updateCase('K-allow', { memo: '허용 수정', assignedStaff: 'New staff' })); await storeHarness.tick();
    assert.equal(storeHarness.fixture.db.app_cases.find(row => row.id === 'K-allow').data.memo, '허용 수정');
    const before = clone(storeHarness.fixture.db), callsBefore = storeHarness.fixture.calls.length;
    for (const [id, patch] of [['K-deny', { memo: '금지' }], ['K-unlinked', { memo: '금지' }], ['K-conflict', { memo: '금지' }],
      ['K-allow', { docsSentAt: '2026-10-23' }], ['K-allow', { fromLeadId: 'deny' }]]) {
      await act(async () => storeHarness.store.updateCase(id, patch));
    }
    await act(async () => storeHarness.store.deleteCase('K-allow')); await storeHarness.tick();
    let installmentResult; await act(async () => { installmentResult = await storeHarness.store.setCaseInstallments('K-deny', []); });
    assert.equal(installmentResult, false); assert.deepEqual(storeHarness.fixture.db, before);
    assert.equal(storeHarness.fixture.calls.slice(callsBefore).filter(call => call.operation && call.operation !== 'select').length, 0);
  } finally { await storeHarness.unmount(); }
});

test('actual Store invalidates stale broad access on a profile refresh and removes records when stages become consultation', async () => {
  await storeHarness.mount(false, '/db', fixture => { prepareStore(fixture); fixture.db.profiles[0].permissions = { ...wide }; });
  try {
    assert.ok(storeHarness.store.leads.some(row => row.id === 'deny')); assert.equal(storeHarness.store.can('sms.send'), true);
    storeHarness.fixture.db.profiles[0].permissions = { ...wide, 'staff.writer': true };
    await storeHarness.emit('profiles', 'UPDATE', { id: 'user-1', law_firm_id: 'firm-1' });
    assert.equal(storeHarness.store.can('sms.send'), false); assert.ok(!storeHarness.store.leads.some(row => row.id === 'deny'));
    storeHarness.fixture.db.app_leads.find(row => row.id === 'allow').data.detailStage = '상담';
    await storeHarness.emit('app_leads');
    assert.ok(!storeHarness.store.leads.some(row => row.id === 'allow'));
    assert.ok(!storeHarness.store.cases.some(row => row.id === 'K-allow'));
    assert.ok(!storeHarness.store.clients.some(row => row.id === 'C-allow'));
    assert.ok(!storeHarness.store.installments.some(row => row.caseId === 'K-allow'));
  } finally { await storeHarness.unmount(); }
});

test('actual writer conversion waits for client then case before updating the lead; a repeated conversion creates no duplicate', async () => {
  await storeHarness.mount(false, '/db', prepareStore);
  let hold;
  try {
    const f = storeHarness.fixture, before = f.calls.length; hold = f.hold('app_clients');
    let clientId; await act(async () => { clientId = storeHarness.store.convertLeadToClient('allow'); }); await storeHarness.tick();
    assert.ok(clientId);
    const domainCalls = () => f.calls.slice(before).filter(call => ['app_clients', 'app_cases', 'app_leads'].includes(call.table));
    assert.deepEqual(domainCalls().map(call => [call.table, call.operation]), [['app_clients', 'select']], 'Case/lead must wait for the held client operation');
    hold.resolve(); await storeHarness.tick();
    assert.deepEqual(domainCalls().filter(call => call.operation !== 'select').map(call => [call.table, call.operation]),
      [['app_clients', 'insert'], ['app_cases', 'insert'], ['app_leads', 'update']]);
    const lead = f.db.app_leads.find(row => row.id === 'allow');
    assert.equal(lead.data.convertedClientId, clientId);
    const convertedCase = f.db.app_cases.find(row => row.id === lead.data.convertedCaseId);
    assert.equal(convertedCase.data.clientId, clientId); assert.equal(convertedCase.data.fromLeadId, 'allow');
    assert.equal(f.db.app_clients.find(row => row.id === clientId).data.fromLeadId, 'allow');
    const persisted = clone(f.db), count = f.calls.length;
    await act(async () => { assert.equal(storeHarness.store.convertLeadToClient('allow'), clientId); }); await storeHarness.tick();
    assert.deepEqual(f.db, persisted); assert.equal(f.calls.length, count);
  } finally { hold?.resolve(); await storeHarness.unmount(); }
});

test('actual writer conversion recovery waits for its missing case; a client failure never starts later case/lead writes', async () => {
  await storeHarness.mount(false, '/db', fixture => {
    prepareStore(fixture); fixture.db.app_leads.find(row => row.id === 'allow').data.convertedClientId = 'C-allow';
    fixture.db.app_cases = fixture.db.app_cases.filter(row => row.id !== 'K-allow');
  });
  let hold;
  try {
    const f = storeHarness.fixture, before = f.calls.length; hold = f.hold('app_cases');
    await act(async () => { assert.equal(storeHarness.store.convertLeadToClient('allow'), 'C-allow'); }); await storeHarness.tick();
    const domainCalls = () => f.calls.slice(before).filter(call => ['app_clients', 'app_cases', 'app_leads'].includes(call.table));
    assert.deepEqual(domainCalls().map(call => [call.table, call.operation]), [['app_cases', 'select']]);
    hold.resolve(); await storeHarness.tick();
    assert.deepEqual(domainCalls().filter(call => call.operation !== 'select').map(call => [call.table, call.operation]), [['app_cases', 'insert'], ['app_leads', 'update']]);
  } finally { hold?.resolve(); await storeHarness.unmount(); }
  await storeHarness.mount(false, '/db', prepareStore);
  try {
    const f = storeHarness.fixture, before = clone(f.db), count = f.calls.length; f.errors.push('app_clients');
    await act(async () => { storeHarness.store.convertLeadToClient('allow'); }); await storeHarness.tick();
    assert.match(storeHarness.store.syncError, /fixture read failed app_clients/);
    assert.deepEqual(f.db.app_clients, before.app_clients); assert.deepEqual(f.db.app_cases, before.app_cases); assert.deepEqual(f.db.app_leads, before.app_leads);
    assert.ok(!f.calls.slice(count).some(call => ['app_cases', 'app_leads'].includes(call.table)), 'No downstream lookups or writes after first step fails');
  } finally { await storeHarness.unmount(); }
});
