// Actual stage catalog, board/row/modal controls and writer scope; synthetic data only.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer')), { act } = Renderer;
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const clone = value => JSON.parse(JSON.stringify(value));

function harness() {
  const modules = new Map(), writes = [], selected = [], storage = new Map();
  const host = tag => ({ children, ...props }) => React.createElement(tag, props, children);
  const window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {} };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} }; modules.set(relative, module);
    let source = fs.readFileSync(path.join(root, relative), 'utf8');
    if (relative === 'app/db/page.tsx') source += '\nexport { StageBoard, MobileLeadRow, DesktopLeadRow };';
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const req = name => {
      if (name === 'react' || name.startsWith('react/')) return require(path.join(runtime, name));
      if (name === 'next/link') return { __esModule: true, default: host('a') };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/lib/store') return { useStore: () => { throw Error('Unexpected store read'); }, useStoreSession: () => ({ profile: { displayName: '합성 담당' } }) };
      if (name === '@/components/ui/Primitives') return { Card: host('section'), Button: host('button'), Select: host('select'), Input: host('input'),
        Modal: ({ open, children }) => open ? React.createElement('section', {}, children) : null, useClickOutside: () => React.useRef(null) };
      if (name === '@/components/ui/ReservationDateTimeEditor') return { ReservationDateTimeEditor: () => null };
      if (name === '@/components/ui/BottomHorizontalScrollbar') return { BottomHorizontalScrollbar: () => null };
      if (name === '@/components/ui/ConfirmDelete') return { ConfirmDelete: () => null };
      if (name === '@/components/db/LeadWorkDialog' || name === '@/components/sms/LeadSmsDialog') return { __esModule: true, default: () => null };
      if (/^\.\/(BasicInfoSection|IncomeSection|AssetSection|DecisionSection|PlanSection|DebtListSection)$/.test(name)) return { [name.slice(2)]: () => null };
      if (name === './shared') return { SectionCard: host('section'), compactTextareaClass: '' };
      if (name === '@/lib/consultation-pdf') throw Error('Unexpected PDF operation');
      if (name.startsWith('@/') || name.startsWith('.')) {
        const file = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(relative), name);
        return load(file + (fs.existsSync(path.join(root, file + '.tsx')) ? '.tsx' : '.ts'));
      }
      throw Error('Unexpected dependency: ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { React, Date, Map, Set, Math, window, structuredClone, setTimeout, clearTimeout, console,
      fetch() { throw Error('Network forbidden'); } }, { filename: relative })(req, module, module.exports);
    return module.exports;
  }
  const lead = { id: 'lead', _lawFirmId: 'firm', name: '합성 고객', phone: '', receivedAt: '2026-11-13', assignedStaff: '합성 담당', status: '계약진행중', detailStage: '착수금착수' };
  const profile = { id: 'actor', role: 'staff', platformRole: 'staff', lawFirmId: 'firm', isActive: true, staffName: '합성 담당', permissions: {} };
  const can = key => ['db.view', 'db.view_all', 'db.change_stage'].includes(key);
  const rowProps = { lead, profile, can, currentStaff: '합성 담당', writingOnly: false, globalSuperView: false, todayIso: '2026-11-13', workStaffNames: ['합성 담당'],
    updateLead: (id, patch, original) => { writes.push({ id, patch: clone(patch), original }); return Promise.resolve(true); },
    onOpenConsultation() {}, onOpenMemo() {}, onConvert() { throw Error('Unexpected conversion'); }, onDelete() { throw Error('Unexpected deletion'); }, onSms() { throw Error('Unexpected SMS'); }, onWork() {} };
  return { load, lead, profile, can, rowProps, writes, selected };
}

test('new stage is uniquely part of 착수 and writer scope retains tenant and view boundaries', () => {
  const h = harness(), types = h.load('lib/types.ts'), writer = h.load('lib/writing-staff.ts');
  assert.equal(types.DB_DETAIL_STAGE_OPTIONS.filter(stage => stage === '사채연결').length, 1);
  assert.equal(types.DB_DETAIL_STAGE_TRACK_OF['사채연결'], '착수');
  assert.deepEqual(clone(types.DB_DETAIL_STAGE_GROUPS.착수), ['착수금착수', '착수 1차안내', '착수 추후진행', '사채연결', '취소예정']);
  const profile = { ...h.profile, permissions: { 'staff.writer': true } }, lead = { ...h.lead, assignedStaff: '다른 담당', detailStage: '사채연결' };
  assert.equal(writer.isWritingLead(lead), true);
  assert.equal(writer.canReadLeadForProfile(profile, lead, writer.writingPermission), true);
  assert.equal(writer.canReadLeadForProfile(profile, { ...lead, _lawFirmId: 'other' }, writer.writingPermission), false);
  assert.equal(writer.canReadLeadForProfile(profile, lead, () => false), false);
  assert.equal(writer.isWritingLead({ ...lead, detailStage: '상담' }), false);
  assert.equal(writer.isWritingLead({ ...lead, detailStage: '없는 단계' }), false);
  const client = { id: 'client', _lawFirmId: 'firm', fromLeadId: lead.id };
  const record = { id: 'case', _lawFirmId: 'firm', clientId: client.id, fromLeadId: lead.id };
  assert.equal(writer.writingCaseAllowed(record, [client], [lead], 'firm'), true);
  assert.equal(writer.writingCaseAllowed(record, [{ ...client, fromLeadId: 'different' }], [lead], 'firm'), false);
});

test('actual stage board exposes the counted stage under 착수 for normal and writing staff, with filter selection/toggle', () => {
  const h = harness(), { StageBoard } = h.load('app/db/page.tsx');
  for (const writingOnly of [false, true]) {
    let tree; const props = { counts: { 사채연결: 2 }, warningCounts: {}, total: 4, active: '전체', onSelect: value => h.selected.push(value), writingOnly };
    act(() => { tree = Renderer.create(React.createElement(StageBoard, props)); });
    try {
      const button = tree.root.findAllByType('button').find(node => text(node).startsWith('사채연결'));
      assert.ok(button); assert.match(text(button), /2/); assert.match(text(button), /50/);
      assert.ok(text(button.parent.parent).startsWith('착수'));
      act(() => button.props.onClick()); assert.equal(h.selected.at(-1), '사채연결');
      act(() => tree.update(React.createElement(StageBoard, { ...props, active: '사채연결' })));
      act(() => tree.root.findAllByType('button').find(node => text(node).startsWith('사채연결')).props.onClick());
      assert.equal(h.selected.at(-1), '전체');
      assert.equal(tree.root.findAllByType('button').some(node => text(node).startsWith('미상담')), !writingOnly);
      assert.equal(h.writes.length, 0);
    } finally { act(() => tree.unmount()); }
  }
});

test('desktop/mobile stage pickers use existing save behavior, preserve converted status, and retain stage permission', async () => {
  const h = harness(), page = h.load('app/db/page.tsx');
  for (const Component of [page.MobileLeadRow, page.DesktopLeadRow]) for (const converted of [false, true]) {
    const lead = { ...h.lead, ...(converted ? { status: '수임전환', convertedClientId: 'client' } : {}) }, before = clone(lead);
    const props = { ...h.rowProps, lead }; let tree;
    act(() => { tree = Renderer.create(React.createElement(Component, props)); });
    try {
      const picker = () => tree.root.findAllByType('select').find(node => node.props.value === '착수금착수');
      assert.equal(picker().props.disabled, false);
      const group = picker().findAllByType('optgroup').find(node => node.props.label === '착수');
      assert.ok(group.findAllByType('option').some(node => node.props.value === '사채연결'));
      await act(async () => picker().props.onChange({ target: { value: '사채연결' } }));
      assert.deepEqual(h.writes.at(-1).patch, converted ? { detailStage: '사채연결' } : { detailStage: '사채연결', status: '계약진행중' });
      assert.equal(h.writes.at(-1).original, lead); assert.deepEqual(lead, before);
      act(() => tree.update(React.createElement(Component, { ...props, writingOnly: true, can: key => key !== 'db.change_stage' && h.can(key) })));
      assert.equal(picker().props.disabled, true);
      assert.ok(picker().findAllByType('option').some(node => node.props.value === '사채연결'));
      assert.ok(!picker().findAllByType('option').some(node => node.props.value === '상담'));
    } finally { act(() => tree.unmount()); }
  }
});

test('shared consultation status picker propagates the stage without creating a save or conversion', async () => {
  const h = harness(), { ConsultationModal } = h.load('components/ui/consultation/ConsultationModal.tsx'); let tree;
  await act(async () => { tree = Renderer.create(React.createElement(ConsultationModal, {
    open: true, resetKey: 'synthetic-stage', onClose() {}, displayName: '합성 고객', displayPhone: '', joinedAtLabel: '2026-11-13', caseNumberLabel: '-',
    applicationType: '개인회생', onApplicationTypeChange() {}, showDetailStage: true, detailStage: '착수금착수', onDetailStageChange: value => h.selected.push(value),
    initialConsultation: { memoLog: [] }, onSave() { throw Error('Selecting a stage must not submit the consultation'); }, reservationChoice: false,
  })); });
  try {
    const picker = tree.root.findAllByType('select').find(node => node.props.value === '착수금착수');
    assert.ok(picker.findAllByType('optgroup').find(node => node.props.label === '착수').findAllByType('option').some(node => node.props.value === '사채연결'));
    act(() => picker.props.onChange({ target: { value: '사채연결' } }));
    assert.equal(h.selected.at(-1), '사채연결'); assert.equal(h.writes.length, 0);
  } finally { act(() => tree.unmount()); }
});
