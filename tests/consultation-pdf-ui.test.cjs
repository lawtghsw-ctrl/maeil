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
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness(options = {}) {
  const modules = new Map(), snapshots = [], downloads = [], saved = [], storage = new Map(); let pdfLoads = 0;
  const captures = {};
  const window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {}, confirm: () => true };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} }; modules.set(relative, module);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    const requireMock = name => {
      if (name === 'react') return React;
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/lib/store') return { useStoreSession: () => ({ profile: { displayName: '가상 상담원' } }) };
      if (name === '@/components/ui/Primitives') return { Button: ({ children, variant, ...props }) => React.createElement('button', props, children), Select: props => React.createElement('select', props, props.children), Modal: props => props.open ? React.createElement('section', {}, props.children) : null };
      if (name === './shared') return { SectionCard: props => React.createElement('div', {}, props.children), compactTextareaClass: '' };
      if (name === '@/lib/consultation-pdf') { pdfLoads++; return { createConsultationPdf: async snapshot => { snapshots.push(snapshot); if (options.create) return options.create(snapshot); return new Blob(['offline'], { type: 'application/pdf' }); }, downloadConsultationPdf: (blob, snapshot) => downloads.push({ blob, snapshot }) }; }
      if (/^\.\/(BasicInfoSection|IncomeSection|AssetSection|DecisionSection|PlanSection|DebtListSection)$/.test(name)) { const key = name.slice(2); return { [key]: props => { captures[key] = props; return null; } }; }
      if (name.startsWith('@/') || name.startsWith('.')) {
        const file = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(relative), name);
        return load(file + (fs.existsSync(path.join(root, file + '.tsx')) ? '.tsx' : '.ts'));
      }
      throw new Error('Unexpected dependency/network: ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { React, window, Date, structuredClone, Blob, setTimeout, clearTimeout, console }, { filename: relative })(requireMock, module, module.exports);
    return module.exports;
  }
  const Component = load('components/ui/consultation/ConsultationModal.tsx').ConsultationModal;
  let props = { open: true, resetKey: 'synthetic-one', onClose() {}, displayName: '합성 이름', displayPhone: '000-0000-0000', joinedAtLabel: '2026-10-18', caseNumberLabel: '-', applicationType: '개인회생', onApplicationTypeChange() {}, showDetailStage: true, detailStage: '상담', onDetailStageChange() {}, initialConsultation: { personal: { basicIncomeNote: '저장본' }, memoLog: [] }, onSave: (...args) => saved.push(args), reservationChoice: true, reservationAt: '2026-10-20T12:00', ...options.props };
  let tree;
  return {
    snapshots, downloads, saved, captures, storage, get loads() { return pdfLoads; }, get tree() { return tree; },
    mount: async () => { await act(async () => { tree = Renderer.create(React.createElement(Component, props)); }); },
    update: async patch => { props = { ...props, ...patch }; await act(async () => tree.update(React.createElement(Component, props))); },
    button: () => tree.root.findAllByType('button').find(button => /PDF/.test(text(button))),
    close: () => act(() => tree.unmount()),
  };
}

test('PDF module stays unloaded until click and exports unsaved fields plus unregistered memo without saving', async () => {
  const h = harness({ props: { allowNameEdit: true } }); await h.mount();
  assert.equal(h.loads, 0);
  await act(async () => { h.captures.BasicInfoSection.patchPersonal({ basicIncomeNote: '아직 저장하지 않은 수정' }); h.captures.BasicInfoSection.onNameChange('수정 중 이름'); });
  const memo = h.tree.root.findByType('textarea');
  await act(async () => memo.props.onChange({ target: { value: '아직 추가하지 않은 메모' } }));
  await act(async () => h.button().props.onClick());
  assert.equal(h.loads, 1); assert.equal(h.downloads.length, 1); assert.equal(h.saved.length, 0);
  const output = h.snapshots[0];
  assert.equal(output.name, '수정 중 이름'); assert.equal(output.consultation.personal.basicIncomeNote, '아직 저장하지 않은 수정');
  assert.equal(output.memoDraft.text, '아직 추가하지 않은 메모'); assert.equal(output.consultation.memoLog.length, 0);
  assert.equal(output.applicationType, '개인회생'); assert.equal(output.detailStage, '상담'); assert.equal(output.reservationAt, '2026-10-20T12:00');
  assert.equal(output.hasUnsavedChanges, true); assert.equal(memo.props.value, '아직 추가하지 않은 메모');
  h.close();
});

test('existing memo add semantics remain unchanged and PDF export does not add a second entry', async () => {
  const h = harness(); await h.mount();
  await act(async () => h.tree.root.findByType('textarea').props.onChange({ target: { value: '추가한 메모' } }));
  const add = h.tree.root.findAllByType('button').find(button => text(button) === ' 추가');
  await act(async () => add.props.onClick());
  await act(async () => h.button().props.onClick());
  assert.equal(h.snapshots[0].consultation.memoLog.length, 1);
  assert.equal(h.snapshots[0].consultation.memoLog[0].tag, '부재중');
  assert.equal(h.snapshots[0].memoDraft.text, ''); assert.equal(h.saved.length, 0);
  h.close();
});

test('export captures the click snapshot, disables repeated clicks and discards a late result after customer change', async () => {
  const pending = deferred(); const h = harness({ create: () => pending.promise }); await h.mount();
  let request; await act(async () => { request = h.button().props.onClick(); await Promise.resolve(); });
  assert.equal(h.button().props.disabled, true);
  await act(async () => h.button().props.onClick()); assert.equal(h.snapshots.length, 1);
  await h.update({ resetKey: 'synthetic-two', displayName: '다른 합성 이름', initialConsultation: { personal: { basicIncomeNote: '다른 상담' } } });
  await act(async () => { pending.resolve(new Blob(['offline'])); await request; });
  assert.equal(h.downloads.length, 0); assert.equal(h.saved.length, 0);
  assert.equal(h.snapshots[0].name, '합성 이름'); assert.equal(h.snapshots[0].consultation.personal.basicIncomeNote, '저장본');
  h.close();
});

test('PDF failure preserves editable draft and enables a retry; readonly export remains available without hidden finance', async () => {
  const h = harness({ create: async () => { throw new Error('Offline failure'); } }); await h.mount();
  await act(async () => h.captures.BasicInfoSection.patchPersonal({ basicIncomeNote: '유지할 작성본' }));
  await act(async () => h.button().props.onClick());
  assert.equal(h.button().props.disabled, false); assert.equal(h.captures.BasicInfoSection.personal.basicIncomeNote, '유지할 작성본');
  assert.equal(h.saved.length, 0); assert.match(text(h.tree.toJSON()), /작성 내용은 그대로 유지/); h.close();
  const readonly = harness({ props: { readOnly: true, showFinanceSummary: false, showDetailStage: false } }); await readonly.mount();
  assert.equal(readonly.tree.root.findByType('fieldset').props.disabled, true);
  await act(async () => readonly.button().props.onClick());
  assert.equal(readonly.downloads.length, 1); assert.equal(readonly.saved.length, 0);
  assert.equal(readonly.snapshots[0].memoDraft, undefined); assert.equal(readonly.snapshots[0].finance, undefined); assert.equal(readonly.snapshots[0].detailStage, undefined); readonly.close();
});

test('changing customers clears the prior unregistered memo and cannot export it under the next customer', async () => {
  const h = harness(); await h.mount();
  await act(async () => h.tree.root.findByType('textarea').props.onChange({ target: { value: '첫 고객의 미등록 메모' } }));
  await h.update({ resetKey: 'synthetic-two', displayName: '둘째 합성 고객', initialConsultation: { personal: {}, memoLog: [] } });
  assert.equal(h.tree.root.findByType('textarea').props.value, '');
  const tag = h.tree.root.findAllByType('button').find(button => text(button) === '통화완료');
  await act(async () => tag.props.onClick());
  await act(async () => h.button().props.onClick());
  assert.equal(h.snapshots[0].name, '둘째 합성 고객');
  assert.equal(h.snapshots[0].memoDraft.text, ''); assert.equal(h.saved.length, 0);
  assert.doesNotMatch(JSON.stringify(h.snapshots[0]), /첫 고객의 미등록 메모/);
  h.close();
});
