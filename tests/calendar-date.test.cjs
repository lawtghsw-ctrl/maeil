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
function harness() {
  const cache = new Map(), events = new Map(), focused = [], validity = [];
  let inheritedDisabled = false;
  const inputNode = { setCustomValidity: value => validity.push(value), matches: () => inheritedDisabled, getBoundingClientRect: () => ({ left: 100, top: 60, bottom: 90 }), contains: () => false };
  const trigger = { focus: () => focused.push('trigger'), contains: () => false };
  const popup = { querySelector: selector => ({ focus: () => focused.push(selector) }), contains: () => false };
  const document = { body: {}, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const window = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const requireFile = name => {
      if (name === 'react') return React;
      if (name === 'react-dom') return { createPortal: children => children };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
      if (name === '@/lib/consultation') return { kstDateStr: () => '2026-10-18' };
      if (name === '@/lib/format') return { fmtWon: value => String(value) };
      if (name === '@/components/ui/Primitives') return { Card: ({ children }) => React.createElement('div', {}, children) };
      if (name.startsWith('@/')) { const rel = name.slice(2); return load(rel + (fs.existsSync(path.join(root, rel + '.tsx')) ? '.tsx' : '.ts')); }
      throw Error('Unexpected import/network ' + name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { React, Date, document, window, console }, { filename: file })(requireFile, module, module.exports);
    return module.exports;
  }
  const api = load('components/ui/DateInput.tsx');
  return { load, api, focused, validity, events, disableFieldset: value => inheritedDisabled = value,
    async render(Component, props) { let tree; await act(async () => { tree = Renderer.create(React.createElement(Component, props), { createNodeMock: element => element.type === 'input' ? inputNode : element.type === 'button' ? trigger : popup }); }); return tree; },
  };
}
const calendar = harness().load('lib/calendar-date.ts');
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const button = (tree, label) => tree.root.findAllByType('button').find(node => node.props['aria-label'] === label || text(node) === label);
const event = (key, extra = {}) => ({ key, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });

test('every month starts on Monday, with correct Sunday offset and leap/year boundaries', () => {
  assert.deepEqual(Array.from(calendar.MONDAY_WEEKDAYS), ['월', '화', '수', '목', '금', '토', '일']);
  for (let year = 2023; year <= 2028; year++) for (let month = 1; month <= 12; month++) {
    const label = `${year}-${String(month).padStart(2, '0')}`, days = Array.from(calendar.calendarMonthDays(label));
    assert.equal(days.indexOf(`${label}-01`), (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7);
    assert.equal(days.filter(Boolean).length, new Date(Date.UTC(year, month, 0)).getUTCDate());
    assert.equal(days.length % 7, 0); assert.equal(new Set(days.filter(Boolean)).size, days.filter(Boolean).length);
  }
  assert.equal(calendar.calendarMonthDays('2025-06').indexOf('2025-06-01'), 6);
  assert.ok(calendar.calendarDateParts('2024-02-29')); assert.equal(calendar.calendarDateParts('2025-02-29'), null);
  for (const value of ['2026-13-01', '2026-04-31', '0000-01-01', '2026-1-1', '2026-10-18T00:00Z']) assert.equal(calendar.calendarDateParts(value), null);
  assert.equal(calendar.shiftCalendarDate('0099-12-31', 1), '0100-01-01');
});

test('keyboard arithmetic uses Monday Home/Sunday End and clamps month lengths without timezone shifts', () => {
  assert.equal(calendar.calendarKeyDate('2026-10-18', 'Home'), '2026-10-12');
  assert.equal(calendar.calendarKeyDate('2026-10-12', 'End'), '2026-10-18');
  assert.equal(calendar.calendarKeyDate('2026-01-31', 'PageDown'), '2026-02-28');
  assert.equal(calendar.calendarKeyDate('2024-02-29', 'PageDown', true), '2025-02-28');
  assert.equal(calendar.calendarKeyDate('2026-01-01', 'ArrowLeft'), '2025-12-31');
  assert.equal(calendar.shiftCalendarDate('2026-03-08', 1), '2026-03-09');
  assert.equal(calendar.shiftCalendarDate('0001-01-01', -1), '0001-01-01');
  assert.equal(calendar.shiftCalendarMonth('9999-12-01', 1), '9999-12-01');
  assert.equal(calendar.isCalendarDateAllowed('2026-10-18', '2026-10-19'), false);
  assert.equal(calendar.clampCalendarDate('2026-10-18', '2026-10-19'), '2026-10-19');
});

test('DateInput opens an accessible Monday grid and selects the unchanged ISO date', async () => {
  const h = harness(), changes = [], tree = await h.render(h.api.DateInput, { value: '2026-10-18', onValueChange: value => changes.push(value), 'aria-label': '계약 시작일' });
  await act(async () => button(tree, '계약 시작일 달력 열기').props.onClick());
  assert.equal(tree.root.findByProps({ role: 'dialog' }).props['aria-label'], '계약 시작일 선택');
  assert.deepEqual(tree.root.findAllByProps({ role: 'columnheader' }).map(text), ['월', '화', '수', '목', '금', '토', '일']);
  assert.equal(button(tree, '2026-10-18').props.tabIndex, 0);
  await act(async () => button(tree, '2026-10-19').props.onClick());
  assert.deepEqual(changes, ['2026-10-19']); assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 0); assert.equal(h.focused.at(-1), 'trigger');
  act(() => tree.unmount());
});

test('direct typing preserves incomplete text while emitting only empty or valid dates and follows external updates', async () => {
  const h = harness(), changes = [];
  function Controlled() { const [value, setValue] = React.useState('2026-10-18'); return React.createElement(h.api.DateInput, { value, onValueChange: next => { changes.push(next); setValue(next); } }); }
  const tree = await h.render(Controlled, {});
  await act(async () => tree.root.findByType('input').props.onChange({ target: { value: '2024-02-' } }));
  assert.equal(tree.root.findByType('input').props.value, '2024-02-'); assert.equal(changes.at(-1), ''); assert.ok(h.validity.at(-1));
  await act(async () => tree.root.findByType('input').props.onChange({ target: { value: '2024-02-30' } }));
  assert.equal(changes.at(-1), '');
  await act(async () => tree.root.findByType('input').props.onChange({ target: { value: '2024-02-29' } }));
  assert.equal(changes.at(-1), '2024-02-29'); assert.equal(h.validity.at(-1), '');
  act(() => tree.unmount());
  const direct = await h.render(h.api.DateInput, { value: '2026-10-18', onValueChange() {} });
  await act(async () => direct.update(React.createElement(h.api.DateInput, { value: '2027-01-01', onValueChange() {} })));
  assert.equal(direct.root.findByType('input').props.value, '2027-01-01'); act(() => direct.unmount());
});

test('keyboard movement crosses months, respects bounds, and Escape closes without changing the value', async () => {
  const h = harness(), changes = [], tree = await h.render(h.api.DateInput, { value: '2026-10-31', min: '2026-10-01', max: '2026-11-02', onValueChange: value => changes.push(value) });
  await act(async () => tree.root.findByType('input').props.onKeyDown(event('ArrowDown', { altKey: true })));
  await act(async () => button(tree, '2026-10-31').props.onKeyDown(event('ArrowRight')));
  assert.equal(button(tree, '2026-11-01').props.tabIndex, 0);
  await act(async () => button(tree, '2026-11-01').props.onKeyDown(event('ArrowDown')));
  assert.equal(button(tree, '2026-11-02').props.tabIndex, 0);
  assert.equal(button(tree, '2026-11-03').props.disabled, true);
  await act(async () => button(tree, '2026-11-03').props.onClick()); assert.equal(changes.length, 0);
  await act(async () => tree.root.findByProps({ role: 'dialog' }).props.onKeyDown(event('Escape')));
  assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 0); assert.equal(changes.length, 0); act(() => tree.unmount());
});

test('read-only, disabled and inherited disabled fieldsets cannot commit portal selections', async () => {
  for (const props of [{ readOnly: true }, { disabled: true }]) {
    const h = harness(), tree = await h.render(h.api.DateInput, { value: '', onValueChange() { throw Error('Unexpected edit'); }, ...props });
    await act(async () => tree.root.findByType('button').props.onClick()); assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 0); act(() => tree.unmount());
  }
  const h = harness(), changes = [], tree = await h.render(h.api.DateInput, { value: '2026-10-18', onValueChange: value => changes.push(value) });
  await act(async () => tree.root.findByType('button').props.onClick()); h.disableFieldset(true);
  await act(async () => button(tree, '2026-10-19').props.onClick()); assert.equal(changes.length, 0); act(() => tree.unmount());
});

test('DateTimeInput keeps local timestamp precision and incomplete parts without defaulting a clock or timezone', async () => {
  const h = harness(), changes = [], tree = await h.render(h.api.DateTimeInput, { value: '2026-10-18T14:35:20', onValueChange: value => changes.push(value), 'aria-label': '예약' });
  const date = () => tree.root.findAllByType('input').find(node => node.props.type === 'text');
  const time = () => tree.root.findAllByType('input').find(node => node.props.type === 'time');
  await act(async () => date().props.onChange({ target: { value: '2026-10-19' } })); assert.equal(changes.at(-1), '2026-10-19T14:35:20');
  await act(async () => time().props.onChange({ target: { value: '' } })); assert.equal(changes.at(-1), '');
  await act(async () => time().props.onChange({ target: { value: '09:15' } })); assert.equal(changes.at(-1), '2026-10-19T09:15');
  act(() => tree.unmount());
});

test('incomplete datetime is reported before empty values, including partial dates with no clock', async () => {
  const h = harness(), calls = [];
  const tree = await h.render(h.api.DateTimeInput, { value: '', onValueChange: value => calls.push(['value', value]), onIncompleteChange: value => calls.push(['incomplete', value]) });
  const date = () => tree.root.findAllByType('input').find(node => node.props.type === 'text');
  const time = () => tree.root.findAllByType('input').find(node => node.props.type === 'time');
  calls.length = 0;
  await act(async () => date().props.onChange({ target: { value: '2026-10-' } }));
  assert.deepEqual(calls.slice(0, 2), [['incomplete', true], ['value', '']]);
  assert.equal(time().props.required, true); assert.equal(date().props.onIncompleteChange, undefined, 'Internal callback is not leaked to HTML');
  await act(async () => date().props.onChange({ target: { value: '2026-10-19' } })); assert.deepEqual(calls.at(-1), ['value', '']);
  await act(async () => time().props.onChange({ target: { value: '14:20' } }));
  assert.equal(calls.findLast(row => row[0] === 'incomplete')[1], false); assert.equal(calls.findLast(row => row[0] === 'value')[1], '2026-10-19T14:20');
  await act(async () => time().props.onChange({ target: { value: '' } })); assert.equal(calls.findLast(row => row[0] === 'incomplete')[1], true);
  await act(async () => date().props.onChange({ target: { value: '' } })); assert.equal(calls.findLast(row => row[0] === 'incomplete')[1], false);
  act(() => tree.unmount());
});

test('existing reservation defaults, clear semantics and KST fallback remain unchanged', async () => {
  const h = harness(), changes = [], Component = h.load('components/ui/ReservationDateTimeEditor.tsx').ReservationDateTimeEditor;
  const tree = await h.render(Component, { value: undefined, onChange: value => changes.push(value) });
  const date = tree.root.findByType(h.api.DateInput);
  await act(async () => date.props.onValueChange('2026-10-20')); assert.equal(changes.at(-1), '2026-10-20T10:00');
  await act(async () => date.props.onValueChange('')); assert.equal(changes.at(-1), undefined);
  await act(async () => tree.root.findAllByType('select')[0].props.onChange({ target: { value: '14' } })); assert.equal(changes.at(-1), '2026-10-18T14:00');
  act(() => tree.unmount());
});

test('range calendar still applies sorted endpoints only on confirmation and cancels on Escape', async () => {
  const h = harness(), changes = [], Component = h.load('components/ui/DateRangePicker.tsx').DateRangePicker;
  const tree = await h.render(Component, { start: '2026-10-01', end: '2026-10-18', onChange: (...values) => changes.push(values) });
  await act(async () => button(tree, '조회 기간 선택').props.onClick());
  const labels = tree.root.findAllByType('div').filter(node => node.children.length === 1 && typeof node.children[0] === 'string').map(text);
  assert.deepEqual(labels.filter(value => ['월','화','수','목','금','토','일'].includes(value)), ['월','화','수','목','금','토','일']);
  await act(async () => button(tree, '2026-10-20').props.onClick()); await act(async () => button(tree, '2026-10-10').props.onClick());
  assert.equal(changes.length, 0); await act(async () => button(tree, '확인').props.onClick()); assert.deepEqual(changes, [['2026-10-10', '2026-10-20']]);
  await act(async () => button(tree, '조회 기간 선택').props.onClick());
  await act(async () => tree.root.findByProps({ role: 'dialog' }).props.onKeyDown(event('Escape'))); assert.equal(changes.length, 1); act(() => tree.unmount());
});

test('dashboard month calendar positions Sunday in the last column and preserves item contents', async () => {
  const h = harness(), Component = h.load('components/charts/MonthCalendar.tsx').MonthCalendar;
  const tree = await h.render(Component, { title: '검증 달력', month: '2025-06', onMonthChange() {}, items: [{ id: 'a', date: '2025-06-01', label: '합성 일정', sub: '검증', done: false, amount: 0 }], tone: 'blue' });
  const dayGrid = tree.root.findAllByType('div').find(node => node.props.className === 'grid grid-cols-7');
  assert.equal(dayGrid.children.length, 36); assert.ok(dayGrid.children.slice(0, 6).every(node => !text(node))); assert.match(text(dayGrid.children[6]), /1합성 일정검증/); act(() => tree.unmount());
});

test('compact numeric dates still reject impossible calendar dates and recover to a real leap day', async () => {
  const h = harness(), changes = [], tree = await h.render(h.api.DateInput, { value: '', onValueChange: value => changes.push(value) });
  try {
    for (const [raw, visible] of [['20230229', '2023-02-29'], ['20231301', '2023-13-01'], ['20260431', '2026-04-31'], ['00000101', '0000-01-01']]) {
      await act(async () => tree.root.findByType('input').props.onChange({ target: { value: raw } }));
      assert.equal(tree.root.findByType('input').props.value, visible);
      assert.equal(tree.root.findByType('input').props['aria-invalid'], true);
      assert.equal(changes.at(-1), ''); assert.ok(h.validity.at(-1));
    }
    await act(async () => tree.root.findByType('input').props.onChange({ target: { value: '20240229' } }));
    assert.equal(changes.at(-1), '2024-02-29'); assert.equal(h.validity.at(-1), '');
    assert.equal(tree.root.findByType('input').props['aria-invalid'], undefined);
  } finally { act(() => tree.unmount()); }
});

test('compact and ISO typing retain identical min/max validity and emission semantics', async () => {
  const h = harness(), changes = [], tree = await h.render(h.api.DateInput, { value: '', min: '2026-10-10', max: '2026-10-20', onValueChange: value => changes.push(value) });
  try {
    for (const [iso, allowed] of [['2026-10-09', false], ['2026-10-10', true], ['2026-10-20', true], ['2026-10-21', false]]) {
      const snapshots = [];
      for (const raw of [iso, iso.replaceAll('-', '')]) {
        await act(async () => tree.root.findByType('input').props.onChange({ target: { value: raw } }));
        snapshots.push({ value: tree.root.findByType('input').props.value, invalid: !!tree.root.findByType('input').props['aria-invalid'], emitted: changes.at(-1), validity: !!h.validity.at(-1) });
      }
      assert.deepEqual(snapshots[0], snapshots[1]);
      // A real but out-of-bounds date retains the existing emission contract;
      // native customValidity marks it invalid instead of silently clamping it.
      assert.deepEqual(snapshots[0], { value: iso, invalid: !allowed, emitted: iso, validity: !allowed });
    }
  } finally { act(() => tree.unmount()); }
});

test('controlled DateTimeInput accepts compact dates in either completion order without inventing or losing clock precision', async () => {
  for (const dateFirst of [true, false]) {
    const h = harness(), changes = [], incomplete = [];
    function Controlled() {
      const [value, setValue] = React.useState('');
      return React.createElement(h.api.DateTimeInput, { value, onValueChange: next => { changes.push(next); setValue(next); }, onIncompleteChange: next => incomplete.push(next) });
    }
    const tree = await h.render(Controlled, {});
    const date = () => tree.root.findAllByType('input').find(node => node.props.type === 'text');
    const time = () => tree.root.findAllByType('input').find(node => node.props.type === 'time');
    try {
      if (!dateFirst) {
        await act(async () => time().props.onChange({ target: { value: '09:15:20' } }));
        assert.equal(changes.at(-1), ''); assert.equal(incomplete.at(-1), true);
      }
      for (const character of '20261020') await act(async () => date().props.onChange({ target: { value: date().props.value + character } }));
      assert.equal(date().props.value, '2026-10-20');
      if (dateFirst) {
        assert.equal(changes.at(-1), ''); assert.equal(time().props.value, ''); assert.equal(incomplete.at(-1), true);
        await act(async () => time().props.onChange({ target: { value: '09:15:20' } }));
      }
      assert.equal(changes.at(-1), '2026-10-20T09:15:20'); assert.equal(incomplete.at(-1), false);
      await act(async () => date().props.onChange({ target: { value: '20261021' } }));
      assert.equal(changes.at(-1), '2026-10-21T09:15:20'); assert.equal(time().props.value, '09:15:20');
      await act(async () => date().props.onChange({ target: { value: '' } }));
      assert.equal(changes.at(-1), ''); assert.equal(incomplete.at(-1), true);
      await act(async () => time().props.onChange({ target: { value: '' } }));
      assert.equal(incomplete.at(-1), false);
    } finally { act(() => tree.unmount()); }
  }
});
