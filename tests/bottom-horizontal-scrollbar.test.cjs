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

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    emit(name) { for (const handler of listeners.get(name) ?? []) handler({ type: name }); },
    get listenerCount() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); },
  };
}

// Real React hooks, effects and event handlers, with deterministic browser
// dimensions/observers. No services, user data, authentication or network.
function harness(options = {}) {
  let tree, rawPosition = options.position ?? 0, writes = 0, frameId = 0;
  const frames = new Map(), resizes = [], mutations = [], captures = new Set();
  const layout = { width: 1280, left: 276, clientWidth: 976, contentWidth: 1680, height: 900, displayed: true, visibility: 'visible', ...options.layout };
  const documentElement = { clientWidth: layout.width, parentElement: null };
  const body = { parentElement: documentElement };
  const parent = { parentElement: body };
  const target = {
    ...eventTarget(), id: 'db-customer-table-scroll', isConnected: true, parentElement: parent, firstElementChild: { tag: 'table' },
    get clientWidth() { return layout.clientWidth; },
    get scrollWidth() { return layout.contentWidth; },
    get scrollLeft() { return Math.max(0, Math.min(rawPosition, layout.contentWidth - layout.clientWidth)); },
    set scrollLeft(value) { writes++; rawPosition = Math.max(0, Math.min(value, layout.contentWidth - layout.clientWidth)); },
    getBoundingClientRect: () => ({ left: layout.left, right: layout.left + layout.clientWidth, width: layout.clientWidth, height: layout.height, top: 500, bottom: 500 + layout.height }),
    getClientRects: () => layout.displayed ? [{}] : [],
  };
  const visualViewport = options.visualViewport ? { ...eventTarget(), offsetLeft: 0, offsetTop: 0, width: layout.width, height: 800, ...options.visualViewport } : undefined;
  const window = {
    ...eventTarget(), innerWidth: layout.width, innerHeight: 800, visualViewport,
    getComputedStyle: () => ({ visibility: layout.visibility }),
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const observer = registry => class {
    constructor(callback) { this.callback = callback; this.observed = new Set(); this.disconnected = false; registry.push(this); }
    observe(node) { this.observed.add(node); }
    unobserve(node) { this.observed.delete(node); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
  };
  const module = { exports: {} };
  const file = path.resolve(__dirname, '../components/ui/BottomHorizontalScrollbar.tsx');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const requireMock = name => {
    if (name === 'react') return React;
    if (name === 'react-dom') return { createPortal: children => children };
    throw Error('Unexpected dependency/network forbidden: ' + name);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
    React, window, document: { documentElement, body },
    ResizeObserver: observer(resizes), MutationObserver: observer(mutations),
  }, { filename: file })(requireMock, module, module.exports);
  const Component = module.exports.BottomHorizontalScrollbar;
  const ref = { current: target };
  let props = { targetRef: ref, targetId: target.id, label: '고객리스트 좌우 이동' };
  const render = () => React.createElement(Component, props);
  const find = name => tree.root.findAll(node => name in node.props)[0];
  const dock = () => find('data-bottom-horizontal-scrollbar');
  const rail = () => tree.root.findAllByProps({ role: 'scrollbar' })[0];
  const railNode = {
    focused: false,
    getBoundingClientRect: () => ({ left: dock().props.style.left + 49, width: dock().props.style.width - 98 }),
    focus() { this.focused = true; },
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id),
  };
  const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); });
  const pointer = (handler, patch = {}) => {
    const event = { currentTarget: railNode, isPrimary: true, button: 0, pointerId: 1, clientX: railNode.getBoundingClientRect().left + 5, preventDefault() {}, ...patch };
    act(() => rail().props[handler](event));
  };
  return {
    layout, target, window, documentElement, resizes, mutations, captures, frames, railNode, ref,
    dock, rail, get writes() { return writes; }, get tree() { return tree; },
    spacer: () => find('data-bottom-scrollbar-spacer'), thumb: () => find('data-bottom-scrollbar-thumb'),
    mount: () => act(() => { tree = Renderer.create(render(), { createNodeMock: element => element.props.role === 'scrollbar' ? railNode : {} }); }),
    props: patch => { props = { ...props, ...patch }; act(() => tree.update(render())); },
    resize: patch => { Object.assign(layout, patch); window.innerWidth = layout.width; documentElement.clientWidth = layout.width; act(() => window.emit('resize')); flush(); },
    content: patch => { Object.assign(layout, patch); act(() => mutations[0].callback([])); flush(); },
    nativeScroll: position => { rawPosition = position; act(() => target.emit('scroll')); flush(); },
    flush,
    key: (key, modifiers = {}) => { let prevented = false; act(() => rail().props.onKeyDown({ key, preventDefault() { prevented = true; }, ...modifiers })); return prevented; },
    clickArrow: direction => act(() => tree.root.findByProps({ 'aria-label': `고객리스트 좌우 이동: ${direction}` }).props.onClick()),
    pointer,
    close: () => act(() => tree.unmount()),
  };
}

test('desktop widths follow the actual table/sidebar, and mobile/fitting tables have no dock or spacer', () => {
  for (const width of [768, 1024, 1280, 1920]) {
    const left = width >= 1024 ? 276 : 16;
    const clientWidth = width - left - (width >= 1024 ? 28 : 16);
    const h = harness({ layout: { width, left, clientWidth } }); h.mount();
    assert.equal(h.dock().props.style.left, left);
    assert.equal(h.dock().props.style.width, clientWidth);
    assert.equal(h.rail().props['aria-valuemax'], 1680 - clientWidth);
    assert.match(h.spacer().props.style.height, /60px/);
    assert.equal(h.rail().props['aria-controls'], 'db-customer-table-scroll');
    assert.equal(h.rail().props.tabIndex, 0);
    h.content({ contentWidth: clientWidth });
    assert.equal(h.dock(), undefined); assert.equal(h.spacer(), undefined); h.close();
  }
  const mobile = harness({ layout: { width: 767 } }); mobile.mount();
  assert.equal(mobile.tree.toJSON(), null); mobile.close();
});

test('resize across sidebar/mobile/full-width boundaries remeasures without modifying page layout', () => {
  const h = harness(); h.mount();
  h.resize({ width: 768, left: 16, clientWidth: 736 });
  assert.equal(h.dock().props.style.width, 736); assert.equal(h.dock().props.style.left, 16);
  h.resize({ width: 767 }); assert.equal(h.dock(), undefined);
  h.resize({ width: 1024, left: 276, clientWidth: 720 }); assert.ok(h.dock());
  h.resize({ width: 2200, clientWidth: 1896 }); assert.equal(h.dock(), undefined);
  h.resize({ width: 1280, clientWidth: 976 }); assert.ok(h.dock());
  assert.equal(h.writes, 0); h.close();
});

test('native horizontal scrolling updates thumb and ARIA without writing back or looping', () => {
  const h = harness({ position: 120 }); h.mount();
  assert.equal(h.rail().props['aria-valuenow'], 120);
  h.nativeScroll(352);
  assert.equal(h.rail().props['aria-valuenow'], 352);
  assert.equal(h.rail().props['aria-valuetext'], '50%');
  assert.equal(h.thumb().props.style.left, '50%');
  assert.equal(h.thumb().props.style.transform, 'translateX(-50%)');
  assert.equal(h.writes, 0); assert.equal(h.frames.size, 0); h.close();
});

test('keyboard arrows, Home/End, paging and button clicks scroll the native target with clamped endpoints', () => {
  const h = harness(); h.mount();
  assert.equal(h.key('ArrowRight'), true); assert.equal(h.target.scrollLeft, 40);
  h.key('ArrowLeft'); assert.equal(h.target.scrollLeft, 0);
  h.key('End'); assert.equal(h.target.scrollLeft, 704);
  h.key('ArrowRight'); assert.equal(h.target.scrollLeft, 704);
  h.key('Home'); assert.equal(h.target.scrollLeft, 0);
  h.key('PageDown'); assert.equal(h.target.scrollLeft, 704);
  h.key('PageUp'); assert.equal(h.target.scrollLeft, 0);
  h.clickArrow('오른쪽'); assert.equal(h.target.scrollLeft, 80);
  h.clickArrow('왼쪽'); assert.equal(h.target.scrollLeft, 0);
  assert.equal(h.key('Tab'), false); assert.equal(h.key('ArrowRight', { ctrlKey: true }), false);
  assert.equal(h.target.scrollLeft, 0); h.close();
});

test('pointer/touch drag keeps grab offset, supports rail clicks and releases capture on cancellation', () => {
  const h = harness(); h.mount();
  const { left, width } = h.railNode.getBoundingClientRect();
  const thumbWidth = width * 976 / 1680;
  h.pointer('onPointerDown', { clientX: left + 10, pointerType: 'touch' });
  assert.ok(h.captures.has(1)); assert.equal(h.railNode.focused, true); assert.equal(h.target.scrollLeft, 0);
  h.pointer('onPointerMove', { clientX: left + 10 + (width - thumbWidth) / 2 });
  assert.ok(Math.abs(h.target.scrollLeft - 352) < 0.0001);
  h.pointer('onPointerMove', { clientX: left + width + 100 }); assert.equal(h.target.scrollLeft, 704);
  h.pointer('onPointerCancel'); assert.equal(h.captures.size, 0);
  h.pointer('onPointerMove', { clientX: left }); assert.equal(h.target.scrollLeft, 704);
  h.pointer('onPointerDown', { clientX: left }); assert.equal(h.target.scrollLeft, 0);
  h.pointer('onPointerUp'); assert.equal(h.captures.size, 0);
  h.pointer('onPointerDown', { clientX: left + width, button: 2 }); assert.equal(h.captures.size, 0);
  h.pointer('onPointerDown', { clientX: left + width, isPrimary: false }); assert.equal(h.captures.size, 0);
  h.close();
});

test('lost pointer capture ends dragging and ignores a different pointer', () => {
  const h = harness(); h.mount();
  h.pointer('onPointerDown');
  h.pointer('onPointerMove', { pointerId: 2, clientX: 1200 }); assert.equal(h.target.scrollLeft, 0);
  h.pointer('onLostPointerCapture');
  h.pointer('onPointerMove', { clientX: 1200 }); assert.equal(h.target.scrollLeft, 0);
  h.close();
});

test('intrinsic content resize, text mutation and table replacement update overflow and clamped position', () => {
  const h = harness(); h.mount(); h.key('End');
  assert.ok(h.resizes[0].observed.has(h.target.firstElementChild));
  const oldTable = h.target.firstElementChild;
  h.target.firstElementChild = { tag: 'replacement table' };
  h.content({ contentWidth: 1200 });
  assert.equal(h.target.scrollLeft, 224); assert.equal(h.rail().props['aria-valuenow'], 224);
  assert.equal(h.rail().props['aria-valuemax'], 224);
  assert.ok(!h.resizes[0].observed.has(oldTable)); assert.ok(h.resizes[0].observed.has(h.target.firstElementChild));
  h.content({ contentWidth: 976 }); assert.equal(h.dock(), undefined);
  h.layout.contentWidth = 1800;
  act(() => h.resizes[0].callback([])); h.flush();
  assert.equal(h.rail().props['aria-valuemax'], 824); h.close();
});

test('hidden, detached and zero-sized targets are excluded; modal hiding preserves the spacer', () => {
  const h = harness(); h.mount();
  h.props({ hideWhen: true }); assert.equal(h.dock(), undefined); assert.ok(h.spacer());
  h.props({ hideWhen: false }); assert.ok(h.dock());
  h.content({ displayed: false }); assert.equal(h.dock(), undefined);
  h.content({ displayed: true, visibility: 'hidden' }); assert.equal(h.dock(), undefined);
  h.content({ visibility: 'visible', height: 0 }); assert.equal(h.dock(), undefined);
  h.content({ height: 900 }); assert.ok(h.dock());
  h.target.isConnected = false; h.content({}); assert.equal(h.dock(), undefined); h.close();
});

test('visual viewport changes and clipping keep the dock inside the currently visible table region', () => {
  const h = harness({ visualViewport: { width: 800, offsetLeft: 300, height: 600, offsetTop: 50 } }); h.mount();
  assert.equal(h.dock().props.style.left, 300);
  assert.equal(h.dock().props.style.width, 800);
  assert.equal(h.dock().props.style.bottom, 150);
  h.window.visualViewport.offsetLeft = 400;
  act(() => h.window.visualViewport.emit('scroll')); h.flush();
  assert.equal(h.dock().props.style.left, 400); assert.equal(h.dock().props.style.width, 800); h.close();
});

test('the companion never intercepts wheel events or changes the native table scroll behavior', () => {
  const h = harness(); h.mount();
  assert.equal(h.rail().props.onWheel, undefined);
  assert.equal(h.target.listeners.has('wheel'), false);
  assert.equal(h.window.listeners.has('wheel'), false);
  h.nativeScroll(180); assert.equal(h.rail().props['aria-valuenow'], 180);
  assert.equal(h.writes, 0); h.close();
});

test('scroll/resize bursts are coalesced, and unmount removes observers/listeners and cancels queued work', () => {
  const h = harness({ visualViewport: {} }); h.mount();
  act(() => { for (let i = 0; i < 20; i++) { h.window.emit('resize'); h.target.emit('scroll'); } });
  assert.equal(h.frames.size, 1);
  h.close();
  assert.equal(h.frames.size, 0); assert.equal(h.target.listenerCount, 0); assert.equal(h.window.listenerCount, 0);
  assert.equal(h.window.visualViewport.listenerCount, 0);
  assert.ok(h.resizes.every(o => o.disconnected)); assert.ok(h.mutations.every(o => o.disconnected));
  for (const observer of [...h.resizes, ...h.mutations]) observer.callback([]);
  assert.equal(h.frames.size, 0);
});
