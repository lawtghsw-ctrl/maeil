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
const jpeg = Buffer.from([255, 216, 255, 255, 217]);
const file = (name = 'picture.jpg') => new File([jpeg], name, { type: 'image/jpeg' });

function harness(options = {}) {
  const modules = new Map(), calls = [], savedCalls = [], created = [], revoked = [], resolved = [];
  let tree, chooserClicks = 0, key = 'firm-a:staff-a:new-lead';
  let props = {
    label: '신규 DB 자동발송 이미지', files: [], savedPaths: [], disabled: false,
    onFilesChange: files => { calls.push(Array.from(files)); props = { ...props, files }; refresh(); },
    onSavedPathsChange: savedPaths => { savedCalls.push(Array.from(savedPaths)); props = { ...props, savedPaths }; refresh(); },
    resolveSavedUrl: async path => { resolved.push(path); return `https://example.invalid/${path}`; },
    ...options,
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const module = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      fileName: relative,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText;
    const requireMock = name => {
      if (name === 'react') return React;
      if (name === '@/lib/sms/automation-images') return load('lib/sms/automation-images.ts');
      throw new Error('External dependency/network forbidden: ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {
      React, Error, Uint8Array,
      URL: {
        createObjectURL: file => { const url = `blob:test-${created.length}`; created.push({ file, url }); return url; },
        revokeObjectURL: url => revoked.push(url),
      },
      fetch: () => { throw new Error('Network forbidden'); },
    }, { filename: relative })(requireMock, module, module.exports);
    modules.set(relative, module.exports);
    return module.exports;
  }
  const Component = load('components/sms/AutomationImagePicker.tsx').default;
  const render = () => React.createElement(Component, { ...props, key });
  const refresh = () => tree.update(render());
  const input = () => tree.root.findByType('input');
  const dropzone = () => tree.root.findAllByType('div').find(node => node.props.onDrop);
  const event = files => ({ dataTransfer: { files, types: ['Files'] }, preventDefault() {}, stopPropagation() {} });
  return {
    calls, savedCalls, created, revoked, resolved,
    get tree() { return tree; }, get props() { return props; }, get chooserClicks() { return chooserClicks; },
    get input() { return input(); }, get dropzone() { return dropzone(); },
    mount: () => act(async () => { tree = Renderer.create(render(), { createNodeMock: node => node.type === 'input' ? { click: () => chooserClicks++ } : null }); }),
    update: patch => act(async () => { props = { ...props, ...patch }; refresh(); }),
    switchStaff: patch => act(async () => { key = 'firm-a:staff-b:new-lead'; props = { ...props, files: [], savedPaths: [], ...patch }; refresh(); }),
    choose: async files => {
      const target = { files, value: 'fake-path' };
      await act(async () => input().props.onChange({ target }));
      return target;
    },
    drop: files => act(async () => dropzone().props.onDrop(event(files))),
    click: label => act(async () => tree.root.findAllByType('button').find(node => node.props['aria-label'] === label || text(node).includes(label)).props.onClick()),
    close: () => act(async () => tree.unmount()),
  };
}

test('native keyboard-accessible chooser and dropzone both accept valid complete replacements', async () => {
  const h = harness(); await h.mount();
  const chooser = h.tree.root.findAllByType('button')[0];
  assert.equal(chooser.props.type, 'button'); assert.equal(chooser.props['aria-controls'], h.input.props.id);
  assert.equal(h.input.props.accept, 'image/jpeg,image/png,image/gif'); assert.equal(h.input.props.multiple, true);
  await h.click('클릭하여 선택'); assert.equal(h.chooserClicks, 1);
  const first = file(); const target = await h.choose([first]);
  assert.equal(target.value, ''); assert.equal(h.calls[0][0], first);
  assert.equal(h.tree.root.findByType('img').props.src, h.created[0].url);
  const second = file('dropped.jpg'); await h.drop([second]);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].length, 1); assert.equal(h.calls[1][0], second);
  assert.match(text(h.tree.toJSON()), /대체하며/); assert.match(text(h.tree.toJSON()), /저장 시 적용/);
  assert.deepEqual(h.revoked, [h.created[0].url]);
  await h.close(); assert.deepEqual(h.revoked, h.created.map(item => item.url));
});

test('rejects invalid drops atomically, shows an accessible error, and preserves existing attachments', async () => {
  const original = file('existing.jpg'); const h = harness({ files: [original] }); await h.mount();
  await h.drop([file(), file(), file(), file()]);
  assert.equal(h.calls.length, 0); assert.match(text(h.tree.root.findByProps({ role: 'alert' })), /최대 3개/);
  await h.drop([new File(['not an image'], 'forged.jpg', { type: 'image/jpeg' })]);
  assert.equal(h.calls.length, 0); assert.equal(h.props.files[0], original);
  assert.match(text(h.tree.root.findByProps({ role: 'alert' })), /실제 형식/);
  await h.choose([]); assert.equal(h.calls.length, 0);
  await h.drop([file('valid.jpg')]); assert.equal(h.calls.length, 1);
  assert.equal(h.tree.root.findAllByProps({ role: 'alert' }).length, 0); await h.close();
});

test('new images replace saved images only on save and removing the final draft restores saved attachments', async () => {
  const saved = ['firm-a/auto/a/saved.jpg']; const h = harness({ savedPaths: saved }); await h.mount();
  assert.deepEqual(h.resolved, saved); assert.match(h.tree.root.findByType('img').props.src, /saved.jpg$/);
  await h.drop([file('first.jpg'), file('second.jpg')]);
  assert.equal(h.savedCalls.length, 0); assert.equal(h.props.savedPaths, saved);
  assert.equal(h.tree.root.findAllByType('img').length, 2);
  assert.match(text(h.tree.toJSON()), /저장된 이미지 1개를 새 이미지 2개로 교체/);
  await h.click('신규 DB 자동발송 이미지: first.jpg 제거');
  assert.deepEqual(Array.from(h.props.files, item => item.name), ['second.jpg']);
  await h.click('신규 DB 자동발송 이미지: second.jpg 제거');
  assert.equal(h.props.files.length, 0); assert.match(text(h.tree.toJSON()), /저장됨/);
  await h.click('신규 DB 자동발송 이미지: saved.jpg 저장된 이미지 제거');
  assert.deepEqual(h.savedCalls, [[]]); assert.equal(h.tree.root.findAllByType('img').length, 0);
  await h.close(); assert.equal(h.revoked.length, h.created.length);
});

test('pending validation never adds files after a newer valid or invalid selection', async () => {
  for (const newerValid of [true, false]) {
    const pending = deferred(), old = file('old.jpg'); old.arrayBuffer = () => pending.promise;
    const h = harness(); await h.mount(); await h.drop([old]);
    assert.match(text(h.tree.root.findByProps({ role: 'status' })), /확인하고/);
    const next = newerValid ? file('new.jpg') : new File(['bad'], 'bad.jpg', { type: 'image/jpeg' });
    await h.drop([next]);
    await act(async () => { pending.resolve(jpeg); await pending.promise; });
    assert.equal(h.calls.length, newerValid ? 1 : 0);
    if (newerValid) assert.equal(h.props.files[0], next);
    else assert.match(text(h.tree.root.findByProps({ role: 'alert' })), /실제 형식/);
    await h.close();
  }
});

test('disabled, unmounted and staff-switched pickers ignore pending validations', async () => {
  for (const action of ['disable', 'unmount', 'switch']) {
    const pending = deferred(), image = file(); image.arrayBuffer = () => pending.promise;
    const h = harness(); await h.mount(); await h.choose([image]);
    if (action === 'disable') { await h.update({ disabled: true }); await h.update({ disabled: false }); }
    if (action === 'unmount') await h.close();
    if (action === 'switch') await h.switchStaff();
    await act(async () => { pending.resolve(jpeg); await pending.promise; });
    assert.equal(h.calls.length, 0, action);
    if (action !== 'unmount') await h.close();
  }
});

test('disabled pickers prevent drag navigation but reject chooser, drop and remove mutations', async () => {
  const image = file(); const h = harness({ disabled: true, files: [image] }); await h.mount();
  assert.equal(h.tree.root.findByType('fieldset').props.disabled, true);
  assert.equal(h.input.props.disabled, true);
  assert.ok(h.tree.root.findAllByType('button').every(node => node.props.disabled));
  await h.click('클릭하여 선택'); assert.equal(h.chooserClicks, 0);
  await h.choose([file('second.jpg')]); await h.drop([file('third.jpg')]);
  await h.click('신규 DB 자동발송 이미지: picture.jpg 제거');
  assert.equal(h.calls.length, 0); assert.equal(h.savedCalls.length, 0);
  let prevented = 0, stopped = 0;
  const event = { dataTransfer: { files: [image], types: ['Files'] }, preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
  await act(async () => { h.dropzone.props.onDragOver(event); h.dropzone.props.onDrop(event); });
  assert.equal(prevented, 2); assert.equal(stopped, 2); assert.equal(event.dataTransfer.dropEffect, 'none');
  await h.close();
});

test('removing a displayed attachment cancels an older pending drop', async () => {
  const pending = deferred(), delayed = file('delayed.jpg'); delayed.arrayBuffer = () => pending.promise;
  const h = harness({ files: [file('existing.jpg')] }); await h.mount(); await h.drop([delayed]);
  await h.click('신규 DB 자동발송 이미지: existing.jpg 제거');
  await act(async () => { pending.resolve(jpeg); await pending.promise; });
  assert.equal(h.calls.length, 1); assert.equal(h.props.files.length, 0); await h.close();
});

test('saved signed URLs ignore late resolver results and cannot leak across staff keys', async () => {
  const old = deferred(), current = deferred();
  const h = harness({ savedPaths: ['firm-a/saved.jpg'], resolveSavedUrl: () => old.promise }); await h.mount();
  assert.match(text(h.tree.toJSON()), /불러오는 중/);
  await h.update({ resolveSavedUrl: () => current.promise });
  await act(async () => { current.resolve('https://example.invalid/current.jpg'); await current.promise; });
  assert.equal(h.tree.root.findByType('img').props.src, 'https://example.invalid/current.jpg');
  await act(async () => { old.resolve('https://example.invalid/stale.jpg'); await old.promise; });
  assert.equal(h.tree.root.findByType('img').props.src, 'https://example.invalid/current.jpg');
  const another = deferred(); await h.update({ resolveSavedUrl: () => another.promise });
  assert.equal(h.tree.root.findAllByType('img').length, 0);
  await h.switchStaff({ savedPaths: ['firm-a/staff-b.jpg'], resolveSavedUrl: async () => 'https://example.invalid/staff-b.jpg' });
  await act(async () => { another.resolve('https://example.invalid/staff-a.jpg'); await another.promise; });
  assert.equal(h.tree.root.findByType('img').props.src, 'https://example.invalid/staff-b.jpg'); await h.close();
});

test('saved preview failures stay removable and local preview failures clean up their object URLs', async () => {
  const h = harness({ savedPaths: ['firm-a/missing.jpg'], resolveSavedUrl: async () => { throw new Error('offline'); } }); await h.mount();
  assert.match(text(h.tree.toJSON()), /미리보기 없음/);
  await h.click('신규 DB 자동발송 이미지: missing.jpg 저장된 이미지 제거'); assert.deepEqual(h.savedCalls, [[]]);
  await h.drop([file()]); await act(async () => h.tree.root.findByType('img').props.onError());
  assert.match(text(h.tree.toJSON()), /미리보기 없음/); await h.close();
  assert.deepEqual(h.revoked, h.created.map(item => item.url));
});

test('nested drag events keep the highlight until the last leave and reset it on drop', async () => {
  const h = harness(); await h.mount();
  const event = { dataTransfer: { files: [], types: ['Files'] }, preventDefault() {}, stopPropagation() {} };
  await act(async () => { h.dropzone.props.onDragEnter(event); h.dropzone.props.onDragEnter(event); });
  assert.match(text(h.tree.toJSON()), /여기에 이미지를/);
  await act(async () => h.dropzone.props.onDragLeave(event)); assert.match(text(h.tree.toJSON()), /여기에 이미지를/);
  await act(async () => h.dropzone.props.onDragLeave(event)); assert.match(text(h.tree.toJSON()), /클릭하여 선택/);
  await act(async () => h.dropzone.props.onDragEnter(event)); await h.drop([]);
  assert.match(text(h.tree.toJSON()), /클릭하여 선택/); await h.close();
});

test('validation callback locks save synchronously before reads and only the latest selection unlocks it', async () => {
  const states = [], older = deferred(), newer = deferred();
  const oldFile = file('old.jpg'), newFile = file('new.jpg');
  oldFile.arrayBuffer = () => { assert.deepEqual(states, [true]); return older.promise; };
  newFile.arrayBuffer = () => { assert.deepEqual(states, [true]); return newer.promise; };
  const h = harness({ onValidationChange: value => states.push(value) }); await h.mount();
  await h.drop([oldFile]); await h.choose([newFile]);
  assert.deepEqual(states, [true]);
  await act(async () => { older.resolve(jpeg); await older.promise; });
  assert.deepEqual(states, [true]); assert.equal(h.calls.length, 0);
  await act(async () => { newer.resolve(jpeg); await newer.promise; });
  assert.deepEqual(states, [true, false]); assert.equal(h.calls[0][0], newFile);
  await h.drop([new File(['invalid'], 'bad.jpg', { type: 'image/jpeg' })]);
  assert.deepEqual(states, [true, false, true, false]);
  await h.close(); assert.deepEqual(states, [true, false, true, false]);
});

test('validation callback unlocks on remove, disable, staff switch and unmount without late duplicate signals', async () => {
  for (const action of ['remove', 'disable', 'switch', 'unmount']) {
    const states = [], pending = deferred(), delayed = file('delayed.jpg'); delayed.arrayBuffer = () => pending.promise;
    const h = harness({ files: [file('existing.jpg')], onValidationChange: value => states.push(value) });
    await h.mount(); await h.drop([delayed]); assert.deepEqual(states, [true]);
    if (action === 'remove') await h.click('신규 DB 자동발송 이미지: existing.jpg 제거');
    if (action === 'disable') await h.update({ disabled: true });
    if (action === 'switch') await h.switchStaff();
    if (action === 'unmount') await h.close();
    assert.deepEqual(states, [true, false], action);
    await act(async () => { pending.resolve(jpeg); await pending.promise; });
    assert.deepEqual(states, [true, false], action);
    if (action !== 'unmount') await h.close();
    assert.deepEqual(states, [true, false], action);
  }
});
