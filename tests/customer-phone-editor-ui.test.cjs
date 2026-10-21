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
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness(options = {}) {
  const modules = new Map(), calls = [];
  let tree, client = { id: 'client-a', phone: '010-1111-2222' };
  const store = {
    isAdmin: true,
    profile: { id: 'admin-a', role: 'admin', platformRole: 'firm_admin', lawFirmId: 'firm-a', isActive: true },
    superAdminFirmScope: null,
    can: () => Boolean(store.profile?.isActive),
    updateClientPhone: async (id, phone) => { calls.push({ id, phone }); return options.save ? options.save(id, phone) : true; },
    ...options.store,
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      fileName: relative,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText;
    const requireMock = name => {
      if (name === 'react') return React;
      if (name === '@/lib/store') return { useStore: () => store };
      if (name === '@/lib/customer-phone') return load('lib/customer-phone.ts');
      throw new Error('External dependency/network forbidden: ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { React, Error }, { filename: relative })(requireMock, module, module.exports);
    modules.set(relative, module.exports);
    return module.exports;
  }
  const Component = load('components/cases/CustomerPhoneEditor.tsx').CustomerPhoneEditor;
  const render = () => React.createElement(Component, { client });
  const button = label => tree.root.findAllByType('button').find(node => text(node) === label);
  return {
    calls, store, get tree() { return tree; }, button,
    get input() { return tree.root.findAllByType('input')[0]; },
    mount: () => act(() => { tree = Renderer.create(render()); }),
    updateClient: patch => { client = { ...client, ...patch }; act(() => tree.update(render())); },
    refresh: () => act(() => tree.update(render())),
    edit: () => act(() => button('수정').props.onClick()),
    type: value => act(() => tree.root.findByType('input').props.onChange({ target: { value } })),
    submit: async () => act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} })),
    close: () => act(() => tree.unmount()),
  };
}

test('contact starts read-only and unchanged saves make no request or success claim', async () => {
  const h = harness(); h.mount();
  assert.match(text(h.tree.toJSON()), /010-1111-2222/);
  assert.equal(h.input, undefined); assert.equal(h.calls.length, 0);
  h.edit();
  assert.equal(h.input.props.type, 'tel'); assert.equal(h.input.props.maxLength, 40);
  assert.equal(h.input.props['aria-label'], '고객 연락처');
  assert.equal(h.tree.root.findByType('label').props.htmlFor, h.input.props.id);
  await h.submit();
  assert.equal(h.calls.length, 0); assert.equal(h.input, undefined);
  assert.ok(!text(h.tree.toJSON()).includes('저장했습니다')); h.close();
});

test('only active administrators with a selected firm can edit', () => {
  for (const store of [
    { isAdmin: false },
    { profile: { id: 'admin', platformRole: 'firm_admin', isActive: false } },
    { profile: { id: 'admin', platformRole: 'super_admin', isActive: true } },
    { can: () => false },
  ]) {
    const h = harness({ store }); h.mount();
    assert.equal(h.button('수정'), undefined); assert.equal(h.input, undefined);
    assert.match(text(h.tree.toJSON()), /010-1111-2222/); assert.equal(h.calls.length, 0); h.close();
  }
  const scoped = harness({ store: { profile: { id: 'admin', platformRole: 'super_admin', isActive: true }, superAdminFirmScope: { id: 'firm-a' } } });
  scoped.mount(); assert.ok(scoped.button('수정')); scoped.close();
});

test('pending saves block repeats, retain failed drafts, and acknowledge only a true result', async () => {
  const waiting = deferred(); let attempts = 0;
  const h = harness({ save: () => ++attempts === 1 ? waiting.promise : true }); h.mount(); h.edit(); h.type('  +82 10-9876-5432  ');
  const submit = h.tree.root.findByType('form').props.onSubmit;
  act(() => { submit({ preventDefault() {} }); submit({ preventDefault() {} }); });
  assert.deepEqual(h.calls, [{ id: 'client-a', phone: '+82 10-9876-5432' }]);
  assert.equal(h.input.props.disabled, true);
  assert.equal(h.button('저장 중...').props.disabled, true); assert.equal(h.button('취소').props.disabled, true);
  assert.ok(!text(h.tree.toJSON()).includes('저장했습니다'));
  await act(async () => { waiting.resolve(false); await waiting.promise; });
  assert.equal(h.input.props.value, '  +82 10-9876-5432  '); assert.equal(h.input.props.disabled, false);
  assert.match(text(h.tree.root.findByProps({ role: 'alert' })), /저장 실패/);
  await h.submit();
  assert.equal(h.calls.length, 2); assert.equal(h.input, undefined);
  assert.match(text(h.tree.root.findByProps({ role: 'status' })), /저장했습니다/);
  h.updateClient({ phone: '+82 10-9876-5432' }); assert.match(text(h.tree.toJSON()), /\+82 10-9876-5432/); h.close();
});

test('invalid edits and thrown failures keep the draft available for correction or retry', async () => {
  const h = harness({ save: async () => { throw new Error('offline'); } }); h.mount(); h.edit();
  for (const phone of ['', 'abc', '0101234', '1'.repeat(16)]) {
    h.type(phone); await h.submit(); assert.equal(h.calls.length, 0);
    assert.equal(h.input.props.value, phone); assert.equal(h.input.props['aria-invalid'], true);
    assert.ok(h.tree.root.findByProps({ role: 'alert' }));
  }
  h.type('010-9999-8888'); await h.submit();
  assert.equal(h.calls.length, 1); assert.equal(h.input.props.value, '010-9999-8888');
  assert.equal(h.input.props.disabled, false); assert.match(text(h.tree.toJSON()), /저장 실패/); h.close();
});

test('same-customer realtime updates preserve typing and cancel or Escape restores the latest phone', () => {
  const h = harness(); h.mount(); h.edit(); h.type('010-9999-8888');
  h.updateClient({ phone: '010-3333-4444' }); assert.equal(h.input.props.value, '010-9999-8888');
  act(() => h.button('취소').props.onClick()); assert.equal(h.input, undefined);
  assert.match(text(h.tree.toJSON()), /010-3333-4444/); h.edit(); assert.equal(h.input.props.value, '010-3333-4444');
  h.type('010-5555-6666'); let stopped = 0;
  act(() => h.input.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped++; } }));
  assert.equal(stopped, 1); assert.equal(h.input, undefined); assert.equal(h.calls.length, 0); h.close();
});

test('untouched or reverted edit sessions never overwrite a newer realtime phone', async () => {
  for (const reverted of [false, true]) {
    const h = harness(); h.mount(); h.edit();
    if (reverted) h.type('010-9999-8888');
    h.updateClient({ phone: '010-3333-4444' });
    if (reverted) h.type(' 010-1111-2222 ');
    await h.submit();
    assert.equal(h.calls.length, 0); assert.equal(h.input, undefined);
    assert.match(text(h.tree.toJSON()), /010-3333-4444/);
    assert.ok(!text(h.tree.toJSON()).includes('저장했습니다'));
    // The next editing session starts from the current phone, not the old one.
    h.edit(); assert.equal(h.input.props.value, '010-3333-4444');
    h.type('010-1111-2222'); await h.submit();
    assert.deepEqual(h.calls, [{ id: 'client-a', phone: '010-1111-2222' }]); h.close();
  }
});

test('switching customers resets the editor and ignores a late successful result', async () => {
  const waiting = deferred(); const h = harness({ save: () => waiting.promise }); h.mount(); h.edit(); h.type('010-9999-8888'); await h.submit();
  h.updateClient({ id: 'client-b', phone: '010-3333-4444' });
  assert.equal(h.input, undefined); assert.match(text(h.tree.toJSON()), /010-3333-4444/);
  h.edit(); h.type('010-5555-6666');
  await act(async () => { waiting.resolve(true); await waiting.promise; });
  assert.equal(h.input.props.value, '010-5555-6666'); assert.equal(h.input.props.disabled, false);
  assert.ok(!text(h.tree.toJSON()).includes('저장했습니다')); assert.equal(h.calls.length, 1); h.close();
});

test('revoked access or changed firm scope discards drafts and late save feedback', async () => {
  const waiting = deferred(); const h = harness({ save: () => waiting.promise }); h.mount(); h.edit(); h.type('010-9999-8888'); await h.submit();
  h.store.isAdmin = false; h.refresh();
  await act(async () => { waiting.resolve(false); await waiting.promise; });
  assert.equal(h.input, undefined); assert.equal(h.button('수정'), undefined); assert.ok(!text(h.tree.toJSON()).includes('저장 실패'));
  h.store.isAdmin = true; h.refresh(); h.edit(); assert.equal(h.input.props.value, '010-1111-2222');
  h.type('010-5555-6666'); h.store.profile = { ...h.store.profile, lawFirmId: 'firm-b' }; h.refresh();
  assert.equal(h.input, undefined); h.edit(); assert.equal(h.input.props.value, '010-1111-2222'); h.close();
});

test('both contract detail surfaces reuse the customer phone editor', () => {
  for (const file of ['components/cases/CaseDetailPopup.tsx', 'app/cases/[id]/page.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /import \{ CustomerPhoneEditor \} from "@\/components\/cases\/CustomerPhoneEditor"/);
    assert.match(source, /<CustomerPhoneEditor client=\{client\}/);
  }
});
