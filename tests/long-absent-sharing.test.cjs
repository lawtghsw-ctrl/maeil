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

const profile = { role: 'staff', platformRole: 'staff', lawFirmId: 'firm-1', isActive: true, staffName: 'One', permissions: {} };
const can = key => ['db.view', 'db.edit_basic', 'db.edit_consultation', 'db.convert', 'db.delete', 'sms.send'].includes(key);
const shared = { id: 'shared', receivedAt: '2026-10-27', phone: '01000000000', _lawFirmId: 'firm-1', name: 'Shared', assignedStaff: 'Other', status: '부재중', detailStage: '장기부재' };
test('same-firm long absence is shared read only, with exact writer/tenant/stage gates', () => {
  assert.equal(writer.canReadLeadForProfile(profile, shared, can), true);
  assert.equal(writer.isSharedLeadReadOnly(profile, shared, can), true);
  assert.equal(writer.isSharedLeadReadOnly(profile, { ...shared, assignedStaff: 'One' }, can), false);
  assert.equal(writer.isSharedLeadReadOnly(profile, shared, () => true), false);
  for (const row of [{ ...shared, _lawFirmId: 'firm-2' }, { ...shared, _lawFirmId: undefined }, { ...shared, detailStage: '상담' }, { ...shared, detailStage: '' }, { ...shared, detailStage: 'unknown' }]) assert.equal(writer.canReadLeadForProfile(profile, row, can), false);
  for (const actor of [{ ...profile, isActive: false }, { ...profile, lawFirmId: undefined }, { ...profile, permissions: { 'staff.writer': true } }]) assert.equal(writer.canReadLeadForProfile(actor, shared, can), false);
  assert.equal(writer.canReadLeadForProfile(profile, shared, () => false), false);
  assert.equal(writer.canReadLeadForProfile(profile, { ...shared, detailStage: undefined, status: '종결_중단' }, can), true);
  assert.equal(writer.canReadLeadForProfile(profile, { ...shared, detailStage: '상담', status: '종결_중단' }, can), false);
});

test('actual store rejects shared-row update/delete/convert before optimistic mutation or persistence, but keeps owner writes', async () => {
  await storeHarness.mount(false, '/db', fixture => {
    Object.assign(fixture.db.profiles[0], { role: 'staff', platform_role: 'staff', permissions: Object.fromEntries(['db.view','db.edit_basic','db.edit_consultation','db.convert','db.delete'].map(key => [key,true])) });
    fixture.db.app_leads = [{ id: shared.id, law_firm_id: 'firm-1', data: { ...shared } }, { id: 'own', law_firm_id: 'firm-1', data: { ...shared, id:'own', assignedStaff:'One' } }];
  });
  try {
    const before = clone(storeHarness.fixture.db), start = storeHarness.fixture.calls.length;
    await act(async () => {
      assert.equal(await storeHarness.store.updateLead('shared', { name: 'Denied' }), false);
      storeHarness.store.deleteLead('shared');
      assert.equal(storeHarness.store.convertLeadToClient('shared'), undefined);
    });
    await storeHarness.tick();
    assert.deepEqual(storeHarness.fixture.db, before);
    assert.equal(storeHarness.fixture.calls.slice(start).filter(call => call.operation && call.operation !== 'select').length, 0);
    await act(async () => assert.equal(await storeHarness.store.updateLead('own', { name: 'Allowed' }), true));
    assert.equal(storeHarness.fixture.db.app_leads.find(row => row.id === 'own').data.name, 'Allowed');
  } finally { await storeHarness.unmount(); }
});
