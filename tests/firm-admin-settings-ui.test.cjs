// Real React components with in-memory API responses; no network, database, mail or SMS.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer')), { act } = Renderer;
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value ? text(value.children) : '';
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const button = (tree, label) => tree.root.findAllByType('button').find(node => text(node.props.children) === label);
function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(root, file); if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Error, AbortController, setTimeout, clearTimeout, ...globals })(name => {
      if (name in mocks) return mocks[name];
      if (name === 'react' || name.startsWith('react/')) return require(path.join(runtime, name));
      if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', props, props.children) };
      if (name === 'lucide-react') return new Proxy({}, { get: (_, name) => props => React.createElement('svg', { 'data-icon': name, ...props }) });
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
        return load(['.ts', '.tsx'].map(ext => target + ext).find(p => fs.existsSync(p)));
      }
      throw new Error(`Unexpected dependency ${name}`);
    }, module, module.exports);
    cache.set(filename, module.exports); return module.exports;
  }
  return load;
}
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const invite = (id = 'invite1', overrides = {}) => ({ id, code_preview: `${id}••••`, role: 'staff', expires_at: future(), used_at: null, revoked_at: null, ...overrides });
function panel(auth, initial = {}) {
  const calls = [], copied = [], confirmations = [];
  const load = loader({ '@/lib/platform/client': { authJson: async (url, init) => { calls.push({ url, init }); return auth(url, init); } } }, { navigator: { clipboard: { writeText: async value => copied.push(value) } }, window: { confirm: message => { confirmations.push(message); return true; } } });
  const Component = load('components/staff/StaffInvitePanel.tsx').default;
  let tree, props = initial;
  return { calls, copied, confirmations, tree: () => tree, mount: () => act(async () => { tree = Renderer.create(React.createElement(Component, props)); }), update: patch => act(async () => { props = { ...props, ...patch }; tree.update(React.createElement(Component, props)); }), close: () => act(() => tree.unmount()) };
}

test('staff invites show active masked codes only, issue/copy/revoke in place and never use integrations or messaging APIs', async () => {
  let rows = [invite('active'), invite('used', { used_at: '2026-01-01' }), invite('revoked', { revoked_at: '2026-01-01' }), invite('expired', { expires_at: '2020-01-01' })];
  const h = panel(async (url, init) => {
    if (init?.method === 'POST') { rows.push(invite('new')); return { code: 'SYNTHETIC-ONE-TIME', expiresAt: future(), invite: { id: 'new' }, firmName: 'Synthetic firm' }; }
    if (init?.method === 'DELETE') { rows = rows.filter(row => row.id !== 'new'); return { ok: true }; }
    return { invites: rows };
  });
  await h.mount(); assert.match(text(h.tree().toJSON()), /사용 가능한 초대 1개/); assert.match(text(h.tree().toJSON()), /active••••/); assert.doesNotMatch(text(h.tree().toJSON()), /used••••|revoked••••|expired••••/);
  await act(async () => button(h.tree(), '직원 초대코드 발급').props.onClick());
  assert.deepEqual(JSON.parse(h.calls.find(c => c.init?.method === 'POST').init.body), { role: 'staff' });
  assert.match(text(h.tree().toJSON()), /SYNTHETIC-ONE-TIME/); assert.match(text(h.tree().toJSON()), /24시간 · 1회용/);
  await act(async () => button(h.tree(), '코드 복사').props.onClick()); assert.deepEqual(h.copied, ['SYNTHETIC-ONE-TIME']);
  await act(async () => h.tree().root.findByProps({ 'aria-label': 'new•••• 초대 취소' }).props.onClick());
  assert.doesNotMatch(text(h.tree().toJSON()), /SYNTHETIC-ONE-TIME/); assert.equal(h.confirmations.length, 1);
  assert.equal(h.calls.filter(c => c.init?.method === 'DELETE')[0].url, '/api/firm/invites?id=new');
  assert.ok(h.calls.every(c => c.url.startsWith('/api/firm/invites'))); h.close();
});

test('synchronous double click creates one invitation and scoped super uses selected firm', async () => {
  const pending = defer(); const h = panel(async (_url, init) => init?.method === 'POST' ? pending.promise : { invites: [] }, { lawFirmId: 'firm-b' });
  await h.mount(); assert.equal(h.calls[0].url, '/api/firm/invites?lawFirmId=firm-b');
  const create = button(h.tree(), '직원 초대코드 발급').props.onClick; await act(async () => { create(); create(); });
  const calls = h.calls.filter(c => c.init?.method === 'POST'); assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(calls[0].init.body), { role: 'staff', lawFirmId: 'firm-b' });
  await act(async () => pending.resolve({ code: 'NEW', expiresAt: future(), invite: { id: 'new' }, firmName: 'Firm B' })); h.close();
});

test('scope change aborts stale invite lists and never displays another firm issued code', async () => {
  const first = defer(), issue = defer(); let gets = 0;
  const h = panel(async (_url, init) => { if (init?.method === 'POST') return issue.promise; if (++gets === 1) return first.promise; return { invites: [invite('current')] }; }, { lawFirmId: 'firm-a' });
  await h.mount(); await h.update({ lawFirmId: 'firm-b' }); assert.equal(h.calls[0].init.signal.aborted, true);
  await act(async () => first.resolve({ invites: [invite('old')] })); assert.doesNotMatch(text(h.tree().toJSON()), /old••••/);
  await act(async () => button(h.tree(), '직원 초대코드 발급').props.onClick()); await h.update({ lawFirmId: 'firm-c' });
  await act(async () => issue.resolve({ code: 'OTHER_FIRM_CODE', expiresAt: future(), invite: { id: 'old' }, firmName: 'Old firm' }));
  assert.doesNotMatch(text(h.tree().toJSON()), /OTHER_FIRM_CODE|Old firm/); h.close();
});

test('failed invitation generation keeps explicit error and never displays a code or retries automatically', async () => {
  const h = panel(async (_url, init) => { if (init?.method === 'POST') throw new Error('Synthetic create failure'); return { invites: [] }; }); await h.mount();
  await act(async () => button(h.tree(), '직원 초대코드 발급').props.onClick()); assert.match(text(h.tree().toJSON()), /Synthetic create failure/); assert.equal(button(h.tree(), '코드 복사'), undefined); assert.equal(h.calls.filter(c => c.init?.method === 'POST').length, 1); h.close();
});

test('direct old settings URL redirects firm admins without fetching or mounting integration panels; super still loads it', async () => {
  for (const role of ['firm_admin', 'staff', 'super_admin']) {
    const calls = [], redirects = []; const router = { replace: value => redirects.push(value) };
    const load = loader({ '@/lib/store': { useStoreSession: () => ({ profile: { platformRole: role } }) }, 'next/navigation': { useRouter: () => router, useSearchParams: () => new URLSearchParams('lawFirmId=firm-a') }, '@/lib/platform/client': { authJson: async url => { calls.push(url); throw new Error('Synthetic stop'); } }, '@/components/platform/FirmEsignSettings': { __esModule: true, default: () => { throw new Error('Integration mounted'); } } });
    const Page = load('app/firm/settings/page.tsx').default; let tree; await act(async () => { tree = Renderer.create(React.createElement(Page)); });
    if (role === 'super_admin') assert.ok(calls.includes('/api/firm/integrations?lawFirmId=firm-a'));
    else { assert.equal(calls.length, 0); assert.doesNotMatch(text(tree.toJSON()), /Meta 광고|공급원장|Google Sheet|Secret/); }
    if (role === 'firm_admin') assert.deepEqual(redirects, ['/staff-accounts']);
    await act(async () => tree.unmount());
  }
});

test('dedicated contract page uses own firm for managers and selected firm for super, never mounts for staff or missing scope', async () => {
  for (const [role, selected, expected] of [['firm_admin', 'other', 'own'], ['super_admin', 'selected', 'selected'], ['super_admin', null, null], ['staff', 'other', null]]) {
    const loaded = []; const load = loader({ '@/lib/store': { useStoreSession: () => ({ profile: { platformRole: role, lawFirmId: 'own' }, superAdminFirmScope: selected ? { id: selected } : null }) }, '@/components/platform/FirmEsignSettings': { __esModule: true, default: props => { loaded.push(props.lawFirmId); return React.createElement('div', null, 'Esign settings'); } } });
    const Page = load('app/firm/contract-settings/page.tsx').default; let tree; await act(async () => { tree = Renderer.create(React.createElement(Page)); });
    assert.deepEqual(loaded, expected ? [expected] : []); assert.doesNotMatch(text(tree.toJSON()), /Meta|Sheet|공급원장/); await act(async () => tree.unmount());
  }
});

test('staff management mounts invitations for manager or selected super only, with no old settings navigation', async () => {
  for (const [role, selected] of [['firm_admin', null], ['super_admin', 'selected'], ['super_admin', null], ['staff', null]]) {
    const invites = [], apiCalls = []; const scope = selected ? { id: selected, name: 'Synthetic firm' } : null;
    const primitive = tag => ({ children, ...props }) => React.createElement(tag, props, children);
    const load = loader({ '@/lib/store': { useStoreSession: () => ({ isAdmin: role !== 'staff', profile: { platformRole: role, lawFirmId: 'own' }, superAdminFirmScope: scope, firmDirectory: [], reloadData() {} }) }, '@/lib/supabase/client': { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) } }) }, '@/components/staff/StaffInvitePanel': { __esModule: true, default: props => { invites.push(props); return React.createElement('div', { id: 'staff-invites' }); } }, '@/components/staff/LeadAssignmentModal': { LeadAssignmentModal: () => null }, '@/components/ui/Primitives': { Button: primitive('button'), Card: primitive('section'), Input: primitive('input'), Select: primitive('select'), Modal: () => null, PageHeader: props => React.createElement('header', null, props.title, props.description, props.action) } }, { fetch: async (url, init) => { apiCalls.push({ url, init }); return { ok: true, json: async () => ({ users: [] }) }; } });
    const Page = load('app/staff-accounts/page.tsx').default; let tree; await act(async () => { tree = Renderer.create(React.createElement(Page)); });
    const allowed = role === 'firm_admin' || role === 'super_admin' && selected;
    assert.equal(invites.length > 0, !!allowed);
    if (allowed) assert.equal(invites[0].lawFirmId, role === 'super_admin' ? selected : undefined);
    const links = tree.root.findAllByType('a').map(node => node.props.href); assert.ok(!links.includes('/firm/settings')); assert.doesNotMatch(text(tree.toJSON()), /직원계정관리/);
    if (role !== 'staff') assert.match(text(tree.toJSON()), /직원관리/);
    assert.ok(apiCalls.every(call => call.init.method === 'GET')); await act(async () => tree.unmount());
  }
});
