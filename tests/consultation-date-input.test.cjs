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
// Keep age/tenure and the calendar's current month deterministic in every timezone.
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 9, 20, 12, 0, 0])); }
  static now() { return new Clock().getTime(); }
}

// Real sections, shared controls, DateInput and calculation helpers; only browser
// DOM operations and visual primitives are replaced. No store/API/provider access.
function harness(initial = {}) {
  const modules = new Map(), validity = new Map(), events = new Map(), changes = [];
  let tree, value, replace, renderAgain;
  const document = { body: {}, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const window = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} }; modules.set(relative, module);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    const requireFile = name => {
      if (name === 'react') return React;
      if (name === 'react-dom') return { createPortal: children => children };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
      if (name === '@/components/ui/Primitives') return {
        Input: props => React.createElement('input', props),
        Select: props => React.createElement('select', props),
        Card: props => React.createElement('section', props),
      };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const file = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(relative), name);
        return load(file + (fs.existsSync(path.join(root, file + '.tsx')) ? '.tsx' : '.ts'));
      }
      throw Error('Unexpected external dependency/network: ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { React, Date: Clock, document, window, console }, { filename: relative })(requireFile, module, module.exports);
    return module.exports;
  }
  const Basic = load('components/ui/consultation/BasicInfoSection.tsx').BasicInfoSection;
  const Income = load('components/ui/consultation/IncomeSection.tsx').IncomeSection;
  function ControlledConsultation() {
    const [personal, setPersonal] = React.useState(initial.personal ?? { basicIncomeNote: 'unchanged personal note' });
    const [income, setIncome] = React.useState(initial.income ?? { salaryAccountBank: 'unchanged bank', monthlyAvgIncome: 3000000 });
    const [, setRevision] = React.useState(0);
    // Same functional merge as ConsultationModal.makePatcher, including undefined.
    const patchPersonal = React.useCallback(patch => { changes.push(['personal', patch]); setPersonal(prev => ({ ...prev, ...patch })); }, []);
    const patchIncome = React.useCallback(patch => { changes.push(['income', patch]); setIncome(prev => ({ ...prev, ...patch })); }, []);
    value = { personal, income };
    replace = next => { if (next.personal) setPersonal(next.personal); if (next.income) setIncome(next.income); };
    renderAgain = () => setRevision(n => n + 1);
    const keys = { requiredKeys: new Set(), missingKeys: new Set() };
    return React.createElement(React.Fragment, {},
      React.createElement(Basic, { ...keys, personal, patchPersonal, displayName: 'Synthetic consultation', displayPhone: '', joinedAtLabel: '', caseNumberLabel: '' }),
      React.createElement(Income, { ...keys, income, patchIncome, occupationType: personal.occupationType, onOccupationTypeChange: occupationType => patchPersonal({ occupationType }) }));
  }
  const input = label => tree.root.findAllByType('input').find(node => node.props['aria-label'] === label);
  const button = label => tree.root.findAllByType('button').find(node => node.props['aria-label'] === label || text(node) === label);
  return {
    get tree() { return tree; }, get value() { return value; }, changes, validity, input, button,
    mount: () => act(() => { tree = Renderer.create(React.createElement(ControlledConsultation), { createNodeMock: element => ({
      setCustomValidity: message => validity.set(element.props['aria-label'], message),
      matches: () => false, contains: () => false, focus() {},
      getBoundingClientRect: () => ({ left: 100, top: 60, bottom: 90 }), querySelector: () => ({ focus() {} }),
    }) }); }),
    change: (label, next) => act(() => input(label).props.onChange({ target: { value: next }, currentTarget: { value: next } })),
    append: (label, character) => act(() => {
      const node = input(label), next = (node.props.value + character).slice(0, node.props.maxLength ?? Infinity);
      node.props.onChange({ target: { value: next }, currentTarget: { value: next } });
    }),
    click: label => act(() => button(label).props.onClick()),
    replace: next => act(() => replace(next)), rerender: () => act(() => renderAgain()),
    close: () => act(() => tree.unmount()),
  };
}

const fields = [
  { label: '생년월일', section: 'personal', key: 'birthDate', derived: 'age', iso: '1990-01-02', compact: '19900102', expected: 36 },
  { label: '첫 취직일', section: 'income', key: 'employmentStartDate', derived: 'tenureMonths', iso: '2020-01-02', compact: '20200102', expected: 81 },
];

for (const field of fields) {
  test(`${field.label}: digits typed one at a time survive real controlled parent renders and commit an ISO date`, () => {
    const h = harness(); h.mount();
    try {
      for (const character of field.compact) h.append(field.label, character);
      assert.equal(h.input(field.label).props.value, field.iso);
      assert.equal(h.value[field.section][field.key], field.iso);
      assert.equal(h.value[field.section][field.derived], field.expected);
      assert.equal(h.validity.get(field.label), '');
      if (field.section === 'income') assert.equal(h.value.income.tenureInfo, '81개월');
      assert.equal(h.value.personal.basicIncomeNote, 'unchanged personal note');
      assert.equal(h.value.income.salaryAccountBank, 'unchanged bank');
      assert.equal(h.value.income.monthlyAvgIncome, 3000000);
    } finally { h.close(); }
  });

  test(`${field.label}: both compact numeric paste and existing ISO paste update derived values`, () => {
    const h = harness(); h.mount();
    try {
      h.change(field.label, field.iso);
      assert.equal(h.value[field.section][field.key], field.iso);
      h.change(field.label, '');
      h.change(field.label, field.compact);
      assert.equal(h.input(field.label).props.value, field.iso);
      assert.equal(h.value[field.section][field.key], field.iso);
      assert.equal(h.value[field.section][field.derived], field.expected);
    } finally { h.close(); }
  });

  test(`${field.label}: editing an existing date preserves partial text across parent rerenders and can finish by typing`, () => {
    const h = harness({ [field.section]: { [field.key]: field.iso, [field.derived]: field.expected } }); h.mount();
    try {
      h.change(field.label, field.iso.slice(0, -1));
      h.rerender();
      assert.equal(h.input(field.label).props.value, field.iso.slice(0, -1));
      assert.equal(h.value[field.section][field.key], undefined);
      assert.ok(h.validity.get(field.label));
      h.append(field.label, '3');
      assert.equal(h.value[field.section][field.key], field.iso.slice(0, -1) + '3');
      assert.equal(h.validity.get(field.label), '');
      h.change(field.label, '');
      for (const character of field.compact) h.append(field.label, character);
      assert.equal(h.value[field.section][field.key], field.iso);
    } finally { h.close(); }
  });

  test(`${field.label}: existing ISO keyboard entry, calendar selection and explicit clearing retain their original behavior`, () => {
    const h = harness(); h.mount();
    try {
      for (const character of field.iso) h.append(field.label, character);
      assert.equal(h.value[field.section][field.key], field.iso);
      h.click(`${field.label} 달력 열기`);
      h.click(field.iso.slice(0, -2) + '03');
      assert.equal(h.value[field.section][field.key], field.iso.slice(0, -2) + '03');
      assert.equal(h.tree.root.findAllByProps({ role: 'dialog' }).length, 0);
      h.click(`${field.label} 달력 열기`); h.click('지우기');
      assert.equal(h.input(field.label).props.value, '');
      assert.equal(h.value[field.section][field.key], undefined);
      assert.equal(h.value[field.section][field.derived], undefined);
      if (field.section === 'income') assert.equal(h.value.income.tenureInfo, undefined);
      assert.match(text(h.tree.toJSON()), field.section === 'personal' ? /만 - 세/ : /- 개월/);
      assert.equal(h.validity.get(field.label), '');
    } finally { h.close(); }
  });

  test(`${field.label}: invalid dates stay visibly invalid, never become stored values, and external record updates still apply`, () => {
    const h = harness(); h.mount();
    try {
      for (const invalid of ['2023-02-29', '2023-02-', '2023-13-01']) {
        h.change(field.label, invalid); h.rerender();
        assert.equal(h.input(field.label).props.value, invalid);
        assert.equal(h.value[field.section][field.key], undefined);
        assert.ok(h.validity.get(field.label));
      }
      h.replace({ [field.section]: { [field.key]: field.iso, [field.derived]: field.expected } });
      assert.equal(h.input(field.label).props.value, field.iso);
      assert.equal(h.validity.get(field.label), '');
      h.change(field.label, '20240229');
      assert.equal(h.value[field.section][field.key], '2024-02-29');
      assert.equal(h.validity.get(field.label), '');
    } finally { h.close(); }
  });
}

test('blank consultation fields and retained legacy derived values are not replaced merely by mounting or opening a calendar', () => {
  const initial = { personal: { age: 44, basicIncomeNote: 'legacy' }, income: { tenureMonths: 17, tenureInfo: 'legacy tenure' } };
  const before = JSON.stringify(initial), h = harness(initial); h.mount();
  try {
    assert.equal(h.input('생년월일').props.value, ''); assert.equal(h.input('첫 취직일').props.value, '');
    h.click('생년월일 달력 열기'); h.click('닫기');
    h.click('첫 취직일 달력 열기'); h.click('닫기');
    assert.equal(JSON.stringify(h.value), before); assert.equal(JSON.stringify(initial), before);
    assert.equal(h.changes.length, 0);
    h.change('생년월일', ''); h.change('첫 취직일', '');
    assert.equal(h.value.personal.age, undefined);
    assert.equal(h.value.income.tenureMonths, undefined); assert.equal(h.value.income.tenureInfo, undefined);
    assert.equal(h.value.personal.basicIncomeNote, 'legacy');
    assert.match(text(h.tree.toJSON()), /만 - 세/); assert.match(text(h.tree.toJSON()), /- 개월/);
  } finally { h.close(); }
});
