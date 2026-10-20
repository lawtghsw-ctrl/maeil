// Actual staff-management page and permission model with a synthetic in-memory
// API. No Supabase project, Auth account, customer record or SMS is accessed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react'));
const Renderer = require(path.join(runtime, 'react-test-renderer'));
const { act } = Renderer;
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value ? text(value.children) : '';
const plain = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const modules = new Map(), calls = [];
  let tree, row, model, reloadCount = 0;
  const profile = { id: 'synthetic-manager', platformRole: options.actorRole ?? 'firm_admin', lawFirmId: 'synthetic-firm' };
  const session = { currentUser: { id: profile.id }, profile, isAdmin: profile.platformRole !== 'staff', superAdminFirmScope: null, firmDirectory: [], reloadData: async () => { reloadCount++; } };
  const primitive = tag => ({ children, ...props }) => React.createElement(tag, props, children);
  const mocks = {
    '@/lib/store': { useStoreSession: () => session },
    '@/lib/supabase/client': { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-session-only' } } }) } }) },
    '@/components/staff/StaffInvitePanel': { __esModule: true, default: () => null },
    '@/components/staff/LeadAssignmentModal': { LeadAssignmentModal: () => null },
    '@/components/ui/Primitives': {
      Button: primitive('button'), Card: primitive('section'), Input: primitive('input'), Select: primitive('select'),
      Modal: ({ open, title, children }) => open ? React.createElement('div', { role: 'dialog', 'aria-label': title }, children) : null,
      PageHeader: ({ title, description, action }) => React.createElement('header', {}, title, description, action),
    },
  };
  async function fetch(url, init) {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    assert.equal(url, '/api/admin/users');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-session-only');
    if (init.method === 'GET') return { ok: true, json: async () => ({ users: [plain(row)] }) };
    assert.equal(init.method, 'PATCH', 'No account creation/deletion or unrelated write is allowed in this fixture');
    const body = JSON.parse(init.body); assert.equal(body.id, row.id);
    // Mirrors the production users PATCH normalization before the next GET.
    row = { ...row, ...body, permissions: plain(model.normalizePermissions(body.permissions)) };
    return { ok: true, json: async () => ({ ok: true }) };
  }
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} }; modules.set(relative, module);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Error, fetch, window: { confirm() { throw Error('Unexpected deletion confirmation'); } } }, { filename: relative })(name => {
      if (name in mocks) return mocks[name];
      if (name === 'react' || name.startsWith('react/')) return require(path.join(runtime, name));
      if (name === 'next/link') return { __esModule: true, default: primitive('a') };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name.startsWith('@/')) { const file = name.slice(2); return load(file + (fs.existsSync(path.join(root, file + '.tsx')) ? '.tsx' : '.ts')); }
      throw Error('Unexpected dependency/network: ' + name);
    }, module, module.exports);
    return module.exports;
  }
  model = load('lib/permissions.ts');
  const initial = options.permissions ?? Object.fromEntries(model.ALL_PERMISSION_KEYS.map(key => [key, true]));
  row = { id: 'synthetic-staff', email: 'synthetic@example.invalid', displayName: '합성 직원', staffName: '합성 직원', role: options.targetRole ?? 'staff', platformRole: options.targetRole === 'admin' ? 'firm_admin' : 'staff', lawFirmId: 'synthetic-firm', isActive: true, isWorkStaff: true, autoAssignLeads: false, leadAssignmentOrder: 17, permissions: plain(model.normalizePermissions(initial)) };
  const baseline = plain(row), Page = load('app/staff-accounts/page.tsx').default;
  const dialog = () => tree.root.findByProps({ role: 'dialog' });
  const button = (label, scope = tree.root) => scope.findAllByType('button').find(node => text(node).trim() === label);
  const checkbox = key => {
    const item = model.PERMISSION_GROUPS.flatMap(group => group.items).find(item => item[0] === key);
    assert.ok(item, 'known permission ' + key);
    const label = dialog().findAllByType('label').find(node => node.findAllByType('span').some(span => text(span) === item[1]));
    assert.ok(label, 'rendered permission ' + key);
    return label.findByType('input');
  };
  const groupCheckbox = id => {
    const group = model.PERMISSION_GROUPS.find(group => group.id === id);
    const card = dialog().findAllByType('section').find(section => section.findAllByType('div').some(div => text(div) === group.label));
    return card.findAllByType('label').find(label => text(label).trim() === '이 영역 전체').findByType('input');
  };
  return {
    model, baseline, calls, checkbox, get tree() { return tree; }, get row() { return row; }, get reloadCount() { return reloadCount; },
    mount: () => act(async () => { tree = Renderer.create(React.createElement(Page)); }),
    open: () => act(async () => button('설정').props.onClick()),
    toggle: key => act(async () => { const node = checkbox(key); node.props.onChange({ target: { checked: !node.props.checked } }); }),
    group: (id, checked) => act(async () => groupCheckbox(id).props.onChange({ target: { checked } })),
    click: label => act(async () => button(label, dialog()).props.onClick()),
    save: () => act(async () => button('설정 저장', dialog()).props.onClick()),
    refresh: () => act(async () => button('새로고침').props.onClick()),
    checked: key => checkbox(key).props.checked,
    snapshot: () => Object.fromEntries(model.ALL_PERMISSION_KEYS.map(key => [key, checkbox(key).props.checked])),
    close: () => act(async () => tree.unmount()),
  };
}

test('unchecking all-assignee DB access also disables reassignment, persists false in PATCH, and stays off after reload', async () => {
  const h = harness(); await h.mount(); await h.open();
  try {
    const before = h.snapshot(); await h.toggle('db.view_all');
    assert.equal(h.checked('db.view_all'), false); assert.equal(h.checked('db.change_assignee'), false);
    assert.deepEqual(h.snapshot(), { ...before, 'db.view_all': false, 'db.change_assignee': false });
    assert.deepEqual(h.row, h.baseline, 'the loaded account is unchanged until explicit Save');
    assert.equal(h.calls.filter(call => call.method === 'PATCH').length, 0, 'checkbox edits only change the unsaved draft');
    await h.save();
    const writes = h.calls.filter(call => call.method === 'PATCH'); assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].body.permissions, { ...h.baseline.permissions, 'db.view_all': false, 'db.change_assignee': false });
    for (const key of ['id', 'email', 'displayName', 'role', 'isActive', 'isWorkStaff', 'autoAssignLeads', 'leadAssignmentOrder']) assert.equal(writes[0].body[key], h.baseline[key]);
    assert.equal(h.reloadCount, 1); assert.equal(h.row.permissions['db.view_all'], false);
    await h.refresh(); await h.open();
    assert.equal(h.checked('db.view_all'), false); assert.equal(h.checked('db.change_assignee'), false);
    assert.equal(h.checked('db.view'), true); assert.equal(h.checked('sms.send'), true);
  } finally { await h.close(); }
});

test('turning reassignment on adds prerequisites while re-enabling view-all alone does not restore removed powers', async () => {
  const h = harness({ permissions: { 'sms.view': true, 'sms.view_history': true } }); await h.mount(); await h.open();
  try {
    await h.toggle('db.change_assignee');
    assert.equal(h.checked('db.view'), true); assert.equal(h.checked('db.view_all'), true); assert.equal(h.checked('db.change_assignee'), true);
    assert.equal(h.checked('db.edit_consultation'), false); assert.equal(h.checked('sms.view_history'), true);
    await h.toggle('db.view_all'); await h.toggle('db.view_all');
    assert.equal(h.checked('db.view_all'), true); assert.equal(h.checked('db.change_assignee'), false);
    await h.toggle('db.change_assignee'); await h.save();
    assert.equal(h.row.permissions['db.change_assignee'], true); assert.equal(h.row.permissions['db.view_all'], true); assert.equal(h.row.permissions['db.view'], true);
  } finally { await h.close(); }
});

test('turning base DB view off disables every transitive DB permission and preserves other groups', async () => {
  const h = harness(); await h.mount(); await h.open();
  try {
    const expected = h.snapshot(); for (const key of h.model.ALL_PERMISSION_KEYS.filter(key => key.startsWith('db.'))) expected[key] = false;
    await h.toggle('db.view'); assert.deepEqual(h.snapshot(), expected);
    await h.save(); await h.open(); assert.deepEqual(h.snapshot(), expected);
    await h.toggle('db.view'); assert.equal(h.checked('db.view'), true);
    for (const key of ['db.change_assignee', 'db.view_all', 'db.edit_consultation', 'db.manage_reservation']) assert.equal(h.checked(key), false);
  } finally { await h.close(); }
});

test('consultation and stage prerequisites disable only their actual dependent permissions', async () => {
  const h = harness(); await h.mount(); await h.open();
  try {
    const before = h.snapshot();
    await h.toggle('db.view_consultation');
    assert.deepEqual(h.snapshot(), { ...before, 'db.view_consultation': false, 'db.edit_consultation': false, 'db.convert': false });
    await h.toggle('db.change_stage');
    assert.equal(h.checked('db.change_stage'), false); assert.equal(h.checked('db.manage_reservation'), false);
    assert.equal(h.checked('db.create'), true); assert.equal(h.checked('db.change_assignee'), true);
    await h.toggle('db.manage_reservation');
    assert.equal(h.checked('db.change_stage'), true); assert.equal(h.checked('db.view'), true);
    assert.equal(h.checked('db.view_consultation'), false);
  } finally { await h.close(); }
});

test('DB group clear and group enable apply coherently without changing other groups', async () => {
  const h = harness(); await h.mount(); await h.open();
  try {
    const before = h.snapshot(), cleared = { ...before };
    for (const [key] of h.model.PERMISSION_GROUPS.find(group => group.id === 'db').items) cleared[key] = false;
    await h.group('db', false); assert.deepEqual(h.snapshot(), cleared);
    await h.save(); await h.open(); assert.deepEqual(h.snapshot(), cleared);
    await h.group('db', true); assert.deepEqual(h.snapshot(), before);
  } finally { await h.close(); }
});

test('contract finance and view-all dependencies follow the same removal rules without changing DB powers', async () => {
  const h = harness(); await h.mount(); await h.open();
  try {
    const before = h.snapshot(); await h.toggle('cases.view_finance');
    assert.deepEqual(h.snapshot(), { ...before, 'cases.view_finance': false, 'cases.manage_installments': false, 'cases.econtract': false });
    await h.toggle('cases.view_all'); assert.equal(h.checked('cases.change_assignee'), false); assert.equal(h.checked('cases.view_all'), false);
    assert.equal(h.checked('cases.view'), true); assert.equal(h.checked('cases.send_docs'), true);
    assert.equal(h.checked('db.change_assignee'), true);
    await h.toggle('cases.econtract'); assert.equal(h.checked('cases.view_finance'), true); assert.equal(h.checked('cases.econtract'), true);
    assert.equal(h.checked('cases.manage_installments'), false);
  } finally { await h.close(); }
});

test('clear-all and presets keep their existing behavior and cancellation never sends an account write', async () => {
  const h = harness(); await h.mount(); await h.open();
  try {
    await h.click('전체 해제'); assert.ok(Object.values(h.snapshot()).every(value => value === false));
    await h.click('본인 조회 전용');
    const preset = h.model.PERMISSION_PRESETS.find(item => item.id === 'readonly');
    for (const key of h.model.ALL_PERMISSION_KEYS) assert.equal(h.checked(key), preset.permissions[key] === true);
    await h.click('취소'); assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
    await h.open(); assert.deepEqual(h.snapshot(), h.baseline.permissions);
  } finally { await h.close(); }
});

test('ordinary staff cannot load or render the account editor and administrator permission controls remain disabled', async () => {
  const staff = harness({ actorRole: 'staff' }); await staff.mount();
  try { assert.equal(staff.tree.toJSON(), null); assert.equal(staff.calls.length, 0); } finally { await staff.close(); }
  const manager = harness({ targetRole: 'admin' }); await manager.mount(); await manager.open();
  try {
    assert.equal(manager.checkbox('db.view_all').props.disabled, true);
    await manager.toggle('db.view_all'); assert.equal(manager.checked('db.view_all'), true);
    assert.equal(manager.calls.filter(call => call.method !== 'GET').length, 0);
  } finally { await manager.close(); }
});

test('sparse permission maps retain unrelated false flags and unknown stored keys without rewriting account fields', async () => {
  const permissions = { 'db.view': true, 'db.view_all': true, 'db.change_assignee': true, 'db.delete': false, 'cases.view': true, 'cases.view_all': false, 'sms.view': true, 'sms.send': false, 'sms.view_history': true, 'future.permission': true };
  const before = plain(permissions), h = harness({ permissions }); await h.mount(); await h.open();
  try {
    await h.toggle('db.view_all'); await h.save();
    const expected = { ...before, 'db.view_all': false, 'db.change_assignee': false };
    assert.deepEqual(h.calls.find(call => call.method === 'PATCH').body.permissions, expected);
    assert.deepEqual(h.row.permissions, expected); assert.deepEqual(permissions, before);
    await h.open(); assert.equal(h.checked('cases.view_all'), false); assert.equal(h.checked('sms.send'), false);
    assert.equal(h.checked('sms.view_history'), true); assert.equal(h.checked('db.delete'), false);
  } finally { await h.close(); }
});
