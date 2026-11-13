// Actual React editors -> actual AppStoreProvider -> offline persisted rows.
// No Supabase, provider, SMS, or other network access is allowed by the fixture.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const h = require('./store-performance.test.cjs');
const { React, renderer, act } = h;
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const validRow = { id: 'I1', seq: 1, caseId: 'K1', amount: 800000, dueDate: '2026-12-10', status: '예정' };
const receipt = { ...validRow, status: '선납부', actualPaidAmount: 600000, paidDate: '2026-11-13' };
const writes = () => h.fixture.calls.filter(call => call.operation && call.operation !== 'select');
test.after(() => h.restoreRuntime());

async function setup(rows = [validRow], actor = {}) {
  await h.mount(false, '/cases', fixture => {
    Object.assign(fixture.db.profiles[0], actor);
    Object.assign(fixture.db.app_cases[0].data, { caseNumber: 'SYNTHETIC-1', caseType: '개인회생', court: '시험법원', stage: '서류준비', status: '진행중', assignedStaff: 'One', contractDate: '2026-11-01', totalDebt: 10000000, contractAmount: 800000, paidAmount: 0, installmentCount: rows.length, paymentMethod: '단순분납' });
    fixture.db.app_installments = rows.map(row => ({ id: row.id, law_firm_id: 'firm-1', data: { ...row } }));
  });
}

function editor(kind) {
  const modules = new Map(); let view;
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} }; modules.set(relative, module);
    const requireFile = name => {
      if (name === 'react') return React;
      if (name === '@/lib/store') return { useStore: () => h.store };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (['@/components/cases/CaseProgressCard', '@/components/cases/FirmEsignDocumentDialog'].includes(name)) return { __esModule: true, default: () => null };
      if (name === '@/components/cases/CustomerPhoneEditor') return { CustomerPhoneEditor: () => null };
      if (name === '@/components/cases/CaseActionModals' && relative.endsWith('CaseDetailPopup.tsx')) return { CaseActionPanel: () => null, PriorityRepaymentGuideTable: () => null };
      // DateInput's own typing/calendar behavior is tested separately. This
      // controlled host forwards its exact public callback, including bad dates,
      // so these tests verify the editors/store reject them before persistence.
      if (name === '@/components/ui/DateInput') return { DateInput: ({ onValueChange, ...props }) => React.createElement('input', { ...props, onChange: event => onValueChange(event.target.value) }) };
      if (name === '@/components/ui/Primitives') return {
        Button: ({ children, ...props }) => React.createElement('button', props, children),
        Input: props => React.createElement('input', props), Select: props => React.createElement('select', props),
        Label: ({ text, children }) => React.createElement('label', { 'data-label': text }, children),
        NumberInput: ({ onChange, ...props }) => React.createElement('input', { ...props, type: 'number', onChange: event => onChange(Number(event.target.value)) }),
        Modal: ({ open, title, children }) => open ? React.createElement('section', { 'aria-label': title }, children) : null,
      };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(relative), name);
        return load(target + (fs.existsSync(path.join(root, target + '.tsx')) ? '.tsx' : '.ts'));
      }
      throw Error('Unexpected dependency/network: ' + name);
    };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { React, console, Date, Number, Math, Set, window: { confirm: () => true } }, { filename: relative })(requireFile, module, module.exports);
    return module.exports;
  }
  const Component = kind === 'detail' ? load('components/cases/CaseDetailPopup.tsx').CaseDetailPopup : load('components/cases/CaseActionModals.tsx').CaseActionPanel;
  const render = () => kind === 'detail' ? React.createElement(Component, { caseId: 'K1', onClose() {} }) : React.createElement(Component, { client: h.store.clients.find(row => row.id === 'C1'), caseRecord: h.store.cases.find(row => row.id === 'K1') });
  const button = label => view.root.findAllByType('button').find(node => text(node).trim() === label);
  const labeled = label => view.root.findByProps({ 'data-label': label });
  const dateInput = label => view.root.findAllByType('input').find(node => node.props['aria-label'] === label);
  const row = () => view.root.findByType('tbody').findAllByType('tr')[0];
  const fields = () => kind === 'detail' ? {
    status: view.root.findByProps({ 'aria-label': '납부상태' }),
    amount: row().findAllByType('input').filter(node => node.props.inputMode === 'numeric')[0],
    actual: row().findAllByType('input').filter(node => node.props.inputMode === 'numeric')[1],
    due: dateInput('상환 예정일'), paid: dateInput('실제 입금일'),
  } : {
    status: labeled('상태').findByType('select'), amount: labeled('회차 금액').findByType('input'), actual: labeled('실납부금액').findByType('input'),
    due: dateInput('납부 예정일'), paid: dateInput('실제 입금일'),
  };
  return {
    get tree() { return view; }, fields, button,
    mount: async () => { await act(async () => { view = renderer.create(render()); }); if (kind !== 'detail' && button('분납관리')) await act(async () => button('분납관리').props.onClick()); },
    change: async (key, value) => { await act(async () => fields()[key].props.onChange({ target: { value: String(value) } })); },
    save: async () => { await act(async () => button(kind === 'detail' ? '계약·분납정보 저장' : '분납정보 저장').props.onClick()); await h.tick(); },
    close: async () => { if (view) await act(async () => view.unmount()); },
    paid: () => kind === 'detail'
      ? text(view.root.findAllByType('div').find(node => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].includes('납부금액 합계')))
      : labeled('납부금액').findByType('input').props.value,
    remaining: () => kind === 'detail'
      ? text(view.root.findAllByType('label').find(node => text(node) === '현재 미수금').parent)
      : text(view.root.findAllByType('span').find(node => text(node).startsWith('미수금 '))),
  };
}

for (const kind of ['detail', 'alternate']) {
  test(`${kind}: 800,000 planned / 600,000 prepaid persists actual receipt once and reopens in both editors`, async () => {
    await setup(); let ui = editor(kind);
    try {
      const protectedTables = clone(Object.fromEntries(Object.entries(h.fixture.db).filter(([table]) => !['app_cases', 'app_installments', 'app_change_logs'].includes(table))));
      await ui.mount(); await ui.change('status', '선납부'); await ui.change('actual', 600000); await ui.change('paid', '2026-11-13');
      assert.match(ui.paid(), /600,000/); assert.match(ui.remaining(), /200,000/);
      await ui.save();
      assert.equal(h.store.cases[0].paidAmount, 600000); assert.equal(h.fixture.db.app_cases[0].data.paidAmount, 600000);
      assert.equal(h.fixture.db.app_installments.length, 1);
      assert.deepEqual(Object.fromEntries(['amount', 'actualPaidAmount', 'status', 'dueDate', 'paidDate'].map(key => [key, h.fixture.db.app_installments[0].data[key]])), { amount: 800000, actualPaidAmount: 600000, status: '선납부', dueDate: '2026-12-10', paidDate: '2026-11-13' });
      assert.ok(writes().every(call => ['app_cases', 'app_installments', 'app_change_logs'].includes(call.table)));
      assert.deepEqual(clone(Object.fromEntries(Object.entries(h.fixture.db).filter(([table]) => Object.hasOwn(protectedTables, table)))), protectedTables);
      await ui.close(); ui = editor(kind === 'detail' ? 'alternate' : 'detail'); await ui.mount();
      assert.equal(Number(String(ui.fields().actual.props.value).replaceAll(',', '')), 600000);
      assert.equal(ui.fields().paid.props.value, '2026-11-13'); assert.match(ui.paid(), /600,000/); assert.match(ui.remaining(), /200,000/);
      await ui.change('status', '선납부'); await ui.save();
      assert.equal(h.fixture.db.app_installments.length, 1); assert.equal(h.fixture.db.app_cases[0].data.paidAmount, 600000);
    } finally { await ui.close(); await h.unmount(); }
  });

  test(`${kind}: missing/nonpositive actual receipt and invalid dates are rejected before any UI-triggered write`, async () => {
    await setup([receipt]); const ui = editor(kind);
    try {
      await ui.mount(); const before = clone(h.fixture.db), count = writes().length;
      for (const [key, bad, good, error] of [
        ['actual', 0, 600000, /실납부금액을 입력/], ['due', '', '2026-12-10', /상환 예정일을 입력/],
        ['due', '2026-02-30', '2026-12-10', /상환 예정일을 입력/], ['paid', '', '2026-11-13', /실제 입금일을 입력/],
        ['paid', '2026-13-01', '2026-11-13', /실제 입금일을 입력/],
      ]) {
        await ui.change(key, bad); await ui.save();
        assert.match(text(ui.tree.toJSON()), error); assert.equal(writes().length, count); assert.deepEqual(clone(h.fixture.db), before);
        assert.equal(String(ui.fields()[key].props.value).replaceAll(',', ''), String(bad));
        await ui.change(key, good);
      }
    } finally { await ui.close(); await h.unmount(); }
  });

  test(`${kind}: a failed actual store write keeps the input and error visible`, async () => {
    await setup(); const ui = editor(kind);
    try {
      await ui.mount(); await ui.change('status', '선납부'); await ui.change('actual', 600000); await ui.change('paid', '2026-11-13');
      h.fixture.errors.push('app_installments'); await ui.save();
      assert.match(text(ui.tree.toJSON()), /실패/); assert.equal(Number(String(ui.fields().actual.props.value).replaceAll(',', '')), 600000);
      assert.equal(ui.fields().paid.props.value, '2026-11-13'); assert.equal(h.fixture.db.app_installments[0].data.status, '예정');
    } finally { await ui.close(); await h.unmount(); }
  });
}

test('direct store calls validate the whole batch before optimistic state or persistence, including nonfinite receipts', async () => {
  await setup();
  try {
    const installments = h.store.installments, cases = h.store.cases, before = clone(h.fixture.db), count = writes().length;
    for (const patch of [{ actualPaidAmount: undefined }, { actualPaidAmount: 0 }, { actualPaidAmount: -1 }, { actualPaidAmount: NaN }, { actualPaidAmount: Infinity }, { dueDate: '' }, { dueDate: '2026-02-29' }, { paidDate: '' }, { paidDate: '2026-02-30' }]) {
      let ok; await act(async () => { ok = await h.store.setCaseInstallments('K1', [receipt, { ...receipt, id: 'I2', ...patch }]); });
      assert.equal(ok, false); assert.equal(writes().length, count); assert.equal(h.store.installments, installments); assert.equal(h.store.cases, cases); assert.deepEqual(clone(h.fixture.db), before);
    }
  } finally { await h.unmount(); }
});

test('completed legacy fallback and explicit zero are preserved; caller paidAmount cannot double count prepayment', async () => {
  const rows = [{ ...validRow, status: '완료' }, { ...validRow, id: 'I2', seq: 2, status: '완료', amount: 500000, actualPaidAmount: 0 }, { ...receipt, id: 'I3', seq: 3 }, { ...validRow, id: 'I4', seq: 4, status: '예정', actualPaidAmount: 900000 }];
  await setup(rows);
  try {
    let ok; await act(async () => { ok = await h.store.setCaseInstallments('K1', rows, { paidAmount: 99999999, contractAmount: 2000000 }); });
    assert.equal(ok, true); assert.equal(h.store.cases[0].paidAmount, 1400000); assert.equal(h.fixture.db.app_cases[0].data.paidAmount, 1400000);
    assert.equal(h.fixture.db.app_installments.find(row => row.id === 'I2').data.actualPaidAmount, 0);
    assert.equal(h.fixture.db.app_installments.find(row => row.id === 'I1').data.actualPaidAmount, undefined);
    const ui = editor('alternate'); try { await ui.mount(); assert.match(ui.paid(), /1,400,000/); assert.match(ui.remaining(), /600,000/); } finally { await ui.close(); }
  } finally { await h.unmount(); }
});

test('read-only staff cannot edit either UI or call the actual installment write path', async () => {
  await setup([receipt], { role: 'staff', platform_role: 'staff', permissions: { 'cases.view': true, 'cases.view_finance': true, 'cases.manage_installments': false } });
  let ui = editor('detail');
  try {
    await ui.mount(); assert.equal(ui.button('계약·분납정보 저장'), undefined);
    for (const field of Object.values(ui.fields())) assert.equal(field.props.disabled, true);
    await ui.close(); ui = editor('alternate'); await ui.mount(); assert.equal(ui.button('분납관리'), undefined);
    const count = writes().length, before = clone(h.fixture.db); let ok;
    await act(async () => { ok = await h.store.setCaseInstallments('K1', [receipt]); });
    assert.equal(ok, false); assert.equal(writes().length, count); assert.deepEqual(clone(h.fixture.db), before); assert.match(h.store.syncError, /분납관리 수정 권한/);
  } finally { await ui.close(); await h.unmount(); }
});
