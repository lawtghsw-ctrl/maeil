const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const React = require(path.join(root, 'node_modules/react'));
const jsx = require(path.join(root, 'node_modules/react/jsx-runtime'));
const firm = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', epoch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sender = { id: 'sender-1', staff_name: '담당자', label: '업무', phone: '0212345678', is_active: true, is_registered: true, is_default: true };
const automation = { new_lead_enabled: false, absence_enabled: false, new_lead_template: '기존 신규 문구', absence_template: '기존 부재 문구', duplicate_guard_minutes: 5 };
const staffAutomation = { staff_name: '담당자', sender_number_id: 'sender-1', ...automation, new_lead_image_paths: [], absence_image_paths: [] };
const gate = () => ({ gate: { epochId: epoch, liveEnabled: true, autoEnabled: false, activatedAt: '2026-10-17T00:00:00.000Z' }, capabilities: { sms: true, lms: true, mms: true, maxRecipients: 1000, maxImages: 3, minReservationMinutes: 10 }, serverTime: new Date().toISOString(), canManageGate: true, globalReady: true });
const localDateTime = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const draft = (extra = {}) => ({ tab: 'send', senderId: 'sender-1', recipients: [{ name: '가상고객', phone: '01000000000' }], manualName: '', manualPhone: '', bulkText: '', title: '제목', message: '{고객명}님 안내', images: [], reservedAt: '', automation, automationStaff: '담당자', staffAutomation, newLeadAutoImages: [], absenceAutoImages: [], newSender: { staff_name: '담당자', label: '', phone: '', is_registered: false }, newTemplate: { name: '', category: '일반', body: '' }, pendingRequest: null, automationDirty: true, ...extra });
function nodes(node, predicate, found = []) {
  if (Array.isArray(node)) { node.forEach((child) => nodes(child, predicate, found)); return found; }
  if (!React.isValidElement(node)) return found;
  if (predicate(node)) found.push(node);
  nodes(node.props.children, predicate, found); return found;
}
function text(node) { return Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node); }
function engine() {
  let position = 0;
  const slots = [], effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const hooks = { ...React,
    useState(initial) { const index = position++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; const slot = slots[index]; return [slot.value, (value) => { slot.value = typeof value === 'function' ? value(slot.value) : value; }]; },
    useRef(initial) { const index = position++; return slots[index] ?? (slots[index] = { current: initial }); },
    useMemo(factory, deps) { const index = position++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, value: factory() }; return slots[index].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect, deps) { const index = position++; if (!slots[index] || !same(slots[index].deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = effect(); }); } },
  };
  return { hooks, render(fn, props) { position = 0; const result = fn(props); while (effects.length) effects.shift()(); return result; }, unmount() { slots.forEach((slot) => slot?.cleanup?.()); } };
}
function moduleFrom(relative, mocks, globals) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, console, Date, Math, Map, File, AbortController, crypto: require('node:crypto').webcrypto,
    require(name) { if (name === 'react/jsx-runtime') return jsx; if (name === 'lucide-react') return new Proxy({}, { get: () => () => null }); if (Object.hasOwn(mocks, name)) return mocks[name]; throw Error(`Unmocked import ${name}`); }, ...globals });
  return module.exports;
}
function harness(options = {}) {
  const runtime = engine();
  const apiCalls = [], writes = [], uploads = [], snapshots = [], sendPending = [], readPending = [], historyPending = [];
  const intervals = new Map(), listeners = new Map(); let intervalId = 0;
  const documentMock = { visibilityState: 'visible', addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name, fn) { if(listeners.get(name)===fn)listeners.delete(name); } };
  const historyRows = (options.history ?? []).map((row) => ({ ...row }));
  const store = { profile: { id: 'viewer', platformRole: 'staff', lawFirmId: firm, staffName: '담당자' }, superAdminFirmScope: null, workStaffNames: ['담당자'], can: (permission) => options.permissions ? options.permissions.includes(permission) : true };
  const controls = moduleFrom('components/sms/DeliveryControls.tsx', { react: runtime.hooks }, {});
  const client = { auth: { async getSession() { return { data: { session: options.noSession ? null : { access_token: 'mock-user-token' } }, error: null }; } }, from(table) {
    assert.notEqual(table, 'sms_outbox', 'Browser must never read or write old outbox for live dispatch');
    let payload;
    const result = () => ({ data: table === 'sms_sender_numbers' ? [options.sender ?? sender] : table === 'sms_templates' ? [] : table === 'sms_automation_settings' ? automation : [staffAutomation], error: null });
    const builder = { select() { return builder; }, eq() { return builder; }, order() { return builder; }, maybeSingle() { return Promise.resolve(result()); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      insert(value) { payload = value; writes.push({ table, value }); return builder; }, upsert(value) { payload = value; writes.push({ table, value }); return builder; }, update(value) { payload = value; writes.push({ table, value }); return builder; }, delete() { writes.push({ table, delete: true }); return builder; },
    }; return builder;
  }, storage: { from(bucket) { return { async upload(location, file) { uploads.push({ bucket, location, file }); return { error: null }; } }; } } };
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchMock = async (url, init = {}) => {
    assert.equal(init.headers.get('authorization'), 'Bearer mock-user-token', 'Every API call must include the current session bearer token');
    apiCalls.push({ url, init });
    if (url.startsWith('/api/sms/delivery?')) {
      if (options.delayGate) return new Promise((resolve, reject) => readPending.push({ resolve, reject, init }));
      return response(options.gate ?? gate(), options.gateStatus ?? 200);
    }
    if (url.startsWith('/api/sms/history?')) {
      if (options.delayHistory) return new Promise((resolve,reject)=>historyPending.push({resolve,reject,init,url}));
      const deleted = url.includes('view=deleted');
      return response({ items: historyRows.filter((row)=>!!row.deletedAt===deleted), canManageHistory: options.canManageHistory === true });
    }
    if (url === '/api/sms/history' && ['DELETE','PATCH'].includes(init.method)) {
      if (options.mutationStatus) return response({error:'목록 변경을 거절했습니다.'},options.mutationStatus);
      const ids=JSON.parse(init.body).ids;
      for(const row of historyRows)if(ids.includes(row.id))row.deletedAt=init.method==='DELETE'?new Date().toISOString():null;
      return response({ok:true});
    }
    if (url === '/api/sms/delivery' && init.method === 'PATCH') return response(options.savedGate ?? { ...gate(), gate: { ...gate().gate, ...JSON.parse(init.body), epochId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } });
    if (url === '/api/sms/send') return new Promise((resolve, reject) => sendPending.push({ resolve, reject, init }));
    throw new Error(`Unexpected fetch ${url}`);
  };
  const finalRuntime = engine();
  // Get the non-exported workspace via an AST export appended only to this test's in-memory source.
  const source = fs.readFileSync(path.join(root, 'app/sms/page.tsx'), 'utf8') + '\nexport { SmsFirmWorkspace };';
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console, Date, Math, Map, AbortController, Headers, crypto: require('node:crypto').webcrypto, fetch: fetchMock, confirm: () => options.confirm !== false,
    document: documentMock, window: documentMock, setInterval(fn, ms) { assert.equal(ms,12000); const id=++intervalId;intervals.set(id,fn);return id; }, clearInterval(id) {intervals.delete(id);},
    require(name) { if (name === 'react') return finalRuntime.hooks; if (name === 'react/jsx-runtime') return jsx; if (name === 'lucide-react') return new Proxy({}, { get: () => () => null }); if (name === '@/lib/supabase/client') return { createClient: () => client }; if (name === '@/lib/store') return { useStore: () => store, useStoreSession: () => store }; if (name === '@/components/sms/DeliveryControls') return controls; throw Error(name); } });
  const props = { initialDraft: options.draft ?? draft(), onDraftChange: (value) => snapshots.push(value) };
  const render = () => finalRuntime.render(module.exports.SmsFirmWorkspace, props);
  const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(setImmediate); render(); } };
  const button = (part) => nodes(render(), (node) => node.type === 'button' && text(node).includes(part))[0];
  return { render, flush, button, apiCalls, writes, uploads, snapshots, sendPending, readPending, historyPending, intervals, document: documentMock, tick: ()=>[...intervals.values()].forEach((fn)=>fn()), event: (name)=>listeners.get(name)?.(), response, unmount: () => finalRuntime.unmount(), controls, store };
}

test('opening legacy history makes only reads and never registers or processes old pending rows', async () => {
  const h = harness({ draft: draft({ tab: 'history' }), history: [
    { id: 'old', recordKind: 'legacy', status: 'pending_api', receiverNumber: '01000000000', createdAt: '2026-01-01', source: 'manual' },
    { id: 'old-sent', recordKind: 'legacy', status: 'sent', createdAt: '2026-01-01', source: 'manual' },
    { id: 'accepted', recordKind: 'delivery', status: 'accepted', createdAt: '2026-10-17', source: 'manual' },
    { id: 'unknown', recordKind: 'delivery', status: 'unknown', createdAt: '2026-10-17', source: 'manual' },
    { id: 'delivered', recordKind: 'delivery', status: 'delivery_delivered', createdAt: '2026-10-17', source: 'manual' },
    { id: 'failed', recordKind: 'delivery', status: 'delivery_failed', createdAt: '2026-10-17', source: 'manual' },
    { id: 'delivery-unknown', recordKind: 'delivery', status: 'delivery_unknown', createdAt: '2026-10-17', source: 'manual' },
  ] }); h.render(); await h.flush();
  const content = text(h.render());
  assert.match(content, /이전 보관 · 발송 대상 아님/); assert.match(content, /접수 · 결과확인중/); assert.match(content, /확인 필요 · 재발송 안함/); assert.match(content, /발송완료/);
  assert.match(content, /전달완료/); assert.match(content, /전달 실패/); assert.match(content, /전달 확인 필요 · 재발송 안함/);
  assert.equal(h.writes.length, 0); assert.ok(h.apiCalls.every((call) => !call.init.method));
});

for (const [name, state, status] of [
  ['disabled gate', { ...gate(), gate: { epochId: null, liveEnabled: false, autoEnabled: false, activatedAt: null } }, 200],
  ['TEST firm', { ...gate(), globalReady: false, disabledReason: 'TEST 로펌은 시연 계정입니다.' }, 200],
  ['unavailable server', { error: '상태 조회 실패' }, 503],
  ['malformed active gate', { ...gate(), gate: { ...gate().gate, epochId: null } }, 200],
]) test(`${name}: live request disabled but draft remains editable and preserved`, async () => {
  const h = harness({ gate: state, gateStatus: status }); h.render(); await h.flush();
  assert.equal(h.button('발송 요청').props.disabled, true);
  assert.equal(nodes(h.render(), (node) => node.type === 'textarea' && node.props.value === '{고객명}님 안내').length, 1);
  assert.ok(nodes(h.render(), (node) => node.type === 'fieldset').every((node) => !node.props.disabled));
  assert.equal(h.sendPending.length, 0); assert.equal(h.writes.length, 0);
  if (name === 'TEST firm') assert.match(text(h.render()), /TEST 로펌은 시연 계정입니다/);
});

test('new request uses API once with epoch and UUID; queued success is not delivery completion', async () => {
  const h = harness(); h.render(); await h.flush(); const click = h.button('발송 요청').props.onClick;
  click(); click(); await h.flush();
  assert.equal(h.sendPending.length, 1); assert.equal(h.writes.length, 0);
  const request = JSON.parse(h.sendPending[0].init.body);
  assert.equal(request.lawFirmId, firm); assert.equal(request.epochId, epoch); assert.equal(request.senderNumberId, sender.id);
  assert.match(request.requestId, /^[a-f0-9-]{36}$/); assert.equal(request.message, '{고객명}님 안내');
  assert.deepEqual(request.recipients, [{ name: '가상고객', phone: '01000000000' }]);
  assert.equal(request.sender_number, undefined); assert.equal(request.status, undefined);
  h.sendPending[0].resolve(h.response({ ok: true, batchId: 'batch', createdCount: 1, reused: false, status: 'queued' })); await h.flush();
  assert.match(text(h.render()), /새 요청을 등록했습니다/); assert.match(text(h.render()), /발송 결과는 아래 내역에서 확인해주세요/);
  assert.doesNotMatch(text(h.render()), /아직 문자 전달이 완료된 상태는 아닙니다/);
  assert.equal(h.snapshots.at(-1).message, ''); assert.equal(h.snapshots.at(-1).pendingRequest, null);
});

test('ambiguous response retains inputs and retries exactly the same request, with no second upload', async () => {
  const file = { name: 'fixture.png' };
  const h = harness({ draft: draft({ images: [file], reservedAt: localDateTime(new Date(Date.now() + 3600000)) }) });
  h.render(); await h.flush(); h.button('발송 요청').props.onClick(); await h.flush();
  assert.equal(h.uploads.length, 1); const original = h.sendPending[0].init.body;
  h.sendPending[0].reject(new TypeError('connection lost')); await h.flush();
  assert.equal(h.snapshots.at(-1).message, '{고객명}님 안내'); assert.equal(h.snapshots.at(-1).images.length, 1);
  assert.ok(nodes(h.render(), (node) => node.type === 'fieldset').every((node) => node.props.disabled));
  h.button('동일 요청 접수 여부 확인').props.onClick(); await h.flush();
  assert.equal(h.sendPending.length, 2); assert.equal(h.sendPending[1].init.body, original); assert.equal(h.uploads.length, 1);
  h.sendPending[1].resolve(h.response({ ok: true, batchId: 'batch', createdCount: 1, reused: true, status: 'scheduled' })); await h.flush();
  assert.match(text(h.render()), /기존 요청을 확인했습니다/); assert.match(text(h.render()), /예약 요청/);
});

test('explicit API validation failure retains message and recipient for correction', async () => {
  const h = harness(); h.render(); await h.flush(); h.button('발송 요청').props.onClick(); await h.flush();
  h.sendPending[0].resolve(h.response({ error: '등록 발신번호를 확인해주세요.' }, 400)); await h.flush();
  assert.match(text(h.render()), /등록 발신번호를 확인해주세요/); assert.equal(h.snapshots.at(-1).message, '{고객명}님 안내');
  assert.equal(h.snapshots.at(-1).recipients.length, 1); assert.equal(h.snapshots.at(-1).pendingRequest, null);
});

test('reservation validation uses server time instead of an inaccurate browser clock', async () => {
  const serverTime = new Date(Date.now() + 3600000).toISOString();
  const h = harness({ gate: { ...gate(), serverTime }, draft: draft({ reservedAt: localDateTime(new Date(Date.now() + 1800000)) }) });
  h.render(); await h.flush(); h.button('발송 요청').props.onClick(); await h.flush();
  assert.equal(h.sendPending.length, 0); assert.match(text(h.render()), /서버 현재 시각보다 10분/); assert.ok(h.snapshots.at(-1).reservedAt);
});

test('gate changes are separate from saved automation data and do not enable automatic sending implicitly', async () => {
  const h = harness({ draft: draft({ tab: 'automation', staffAutomation: { ...staffAutomation, new_lead_template: '보존할 임시 문구' } }) });
  h.render(); await h.flush();
  const controls = nodes(h.render(), (node) => node.type === h.controls.default)[0];
  await controls.props.onSave(true, false); await h.flush();
  const patch = h.apiCalls.find((call) => call.init.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.init.body), { lawFirmId: firm, expectedEpochId: epoch, liveEnabled: true, autoEnabled: false, acknowledgeNewOnly: true });
  assert.equal(h.writes.length, 0); assert.equal(h.snapshots.at(-1).staffAutomation.new_lead_template, '보존할 임시 문구');
});

test('automation settings remain saveable while live and automatic gates are off', async () => {
  const h = harness({ draft: draft({ tab: 'automation' }), gate: { ...gate(), gate: { epochId: null, activatedAt: null, liveEnabled: false, autoEnabled: false } } });
  h.render(); await h.flush(); h.button('자동발송 설정 저장').props.onClick(); await h.flush();
  assert.deepEqual(h.writes.map((row) => row.table), ['sms_automation_settings', 'sms_staff_automation_settings']);
  assert.equal(h.apiCalls.filter((call) => call.init.method === 'PATCH' || call.init.method === 'POST').length, 0);
});

test('late gate responses cannot revive an unmounted firm workspace', async () => {
  const h = harness({ delayGate: true }); h.render(); await h.flush();
  const pending = h.readPending[0]; h.unmount(); assert.equal(pending.init.signal.aborted, true);
  pending.resolve(h.response(gate())); await new Promise(setImmediate);
  assert.equal(h.sendPending.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.snapshots.at(-1).message, '{고객명}님 안내');
});

test('missing session keeps the draft and makes no API request', async () => {
  const h = harness({ noSession: true }); h.render(); await h.flush();
  assert.equal(h.apiCalls.length, 0); assert.equal(h.button('발송 요청').props.disabled, true);
  assert.match(text(h.render()), /로그인이 필요합니다/); assert.equal(h.snapshots.at(-1).message, '{고객명}님 안내');
});

test('an ambiguous request retains its ID even when a later recheck returns a permission error', async () => {
  const h = harness(); h.render(); await h.flush(); h.button('발송 요청').props.onClick(); await h.flush();
  const first = h.sendPending[0].init.body;
  h.sendPending[0].resolve(h.response({ error: '접수 확인 중' }, 503)); await h.flush();
  h.button('동일 요청 접수 여부 확인').props.onClick(); await h.flush();
  h.sendPending[1].resolve(h.response({ error: '현재 권한을 확인해주세요.' }, 403)); await h.flush();
  assert.ok(h.snapshots.at(-1).pendingRequest);
  h.button('동일 요청 접수 여부 확인').props.onClick(); await h.flush();
  assert.equal(h.sendPending[2].init.body, first);
});

test('gate controls never enable automatically and require an explicit acknowledgment before activation', async () => {
  const runtime = engine();
  const controls = moduleFrom('components/sms/DeliveryControls.tsx', { react: runtime.hooks }, {});
  const saved = [];
  const props = { state: { ...gate(), gate: { epochId: null, liveEnabled: false, autoEnabled: false, activatedAt: null } }, loading: false, saving: false, error: '', onRefresh() {}, async onSave(...args) { saved.push(args); } };
  const render = () => runtime.render(controls.default, props);
  render(); let tree = render();
  assert.equal(saved.length, 0);
  const checks = nodes(tree, (node) => node.type === 'input' && node.props.type === 'checkbox');
  assert.deepEqual(checks.map((node) => node.props.checked), [false, false]);
  checks[0].props.onChange({ target: { checked: true } }); tree = render();
  let save = nodes(tree, (node) => node.type === 'button' && text(node).includes('상태 적용'))[0];
  assert.equal(save.props.disabled, true); assert.equal(saved.length, 0);
  nodes(tree, (node) => node.type === 'input' && node.props.type === 'checkbox')[2].props.onChange({ target: { checked: true } });
  tree = render(); save = nodes(tree, (node) => node.type === 'button' && text(node).includes('상태 적용'))[0];
  assert.equal(save.props.disabled, false); await save.props.onClick();
  assert.deepEqual(saved, [[true, false]]);
});

test('stored enabled gate can be stopped even when relay readiness is false', async () => {
  const runtime = engine(), saved = [];
  const controls = moduleFrom('components/sms/DeliveryControls.tsx', { react: runtime.hooks }, {});
  const props = { state: { ...gate(), globalReady: false, disabledReason: '연결 확인 필요' }, loading: false, saving: false, error: '', onRefresh() {}, async onSave(...args) { saved.push(args); } };
  const render = () => runtime.render(controls.default, props);
  render(); let tree = render();
  nodes(tree, (node) => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } });
  tree = render(); const save = nodes(tree, (node) => node.type === 'button' && text(node).includes('발송 중지 적용'))[0];
  assert.equal(save.props.disabled, false); await save.props.onClick(); assert.deepEqual(saved, [[false, false]]);
});

const historyRow = (index=1,extra={}) => ({ id:`dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12,'0')}`, recordKind:'delivery', status:'delivery_delivered', receiverName:`고객${index}`, receiverNumber:'01000000000', senderNumber:'0212345678', message:`내역 본문 ${index}`, msgType:'SMS', createdAt:'2026-10-17T00:00:00Z', source:'manual', deletedAt:null, ...extra });
const historyReads = (h) => h.apiCalls.filter((call)=>call.url.startsWith('/api/sms/history?'));
const byLabel = (h,label) => nodes(h.render(),(node)=>node.props['aria-label']===label)[0];

test('history refreshes on entry, every 12s only while visible, on focus, and stops after leaving', async () => {
  const h=harness({history:[historyRow()]});h.render();await h.flush();assert.equal(historyReads(h).length,0);
  h.button('발송내역').props.onClick();await h.flush();assert.equal(historyReads(h).length,1);assert.equal(h.intervals.size,1);
  h.tick();await h.flush();assert.equal(historyReads(h).length,2);
  h.document.visibilityState='hidden';h.tick();h.event('focus');await h.flush();assert.equal(historyReads(h).length,2);
  h.document.visibilityState='visible';h.event('visibilitychange');await h.flush();assert.equal(historyReads(h).length,3);
  h.event('focus');await h.flush();assert.equal(historyReads(h).length,4);
  h.button('문자 보내기').props.onClick();await h.flush();assert.equal(h.intervals.size,0);h.tick();await h.flush();assert.equal(historyReads(h).length,4);
  h.button('발송내역').props.onClick();await h.flush();assert.equal(historyReads(h).length,5);h.unmount();assert.equal(h.intervals.size,0);
});

test('send success invalidates a pre-send history request even if user already opened history', async () => {
  const h=harness({delayHistory:true});h.render();await h.flush();h.button('발송 요청').props.onClick();await h.flush();
  h.button('발송내역').props.onClick();await h.flush();const old=h.historyPending[0];
  h.sendPending[0].resolve(h.response({ok:true,batchId:'batch',createdCount:1,reused:false,status:'queued'}));await h.flush();
  assert.equal(h.historyPending.length,2);assert.equal(old.init.signal.aborted,true);
  h.historyPending[1].resolve(h.response({items:[historyRow(1,{message:'최신 전달 완료 내역'})],canManageHistory:false}));await h.flush();
  old.resolve(h.response({items:[historyRow(2,{message:'이전 목록 응답'})],canManageHistory:false}));await h.flush();
  assert.match(text(h.render()),/최신 전달 완료 내역/);assert.doesNotMatch(text(h.render()),/이전 목록 응답/);
});

test('manager can hide one row and restore it from deleted view without any send or outbox write', async () => {
  const row=historyRow();const h=harness({draft:draft({tab:'history'}),history:[row],canManageHistory:true});h.render();await h.flush();
  assert.match(text(h.render()),/발송·예약을 취소하지 않으며/);
  byLabel(h,'고객1 내역 삭제').props.onClick();await h.flush();
  const remove=h.apiCalls.find((call)=>call.init.method==='DELETE');assert.deepEqual(JSON.parse(remove.init.body),{lawFirmId:firm,ids:[row.id]});
  assert.doesNotMatch(text(h.render()),/내역 본문 1/);h.button('삭제한 내역').props.onClick();await h.flush();
  assert.ok(historyReads(h).at(-1).url.endsWith('&view=deleted'));assert.match(text(h.render()),/내역 본문 1/);assert.match(text(h.render()),/목록 삭제/);
  byLabel(h,'고객1 내역 복구').props.onClick();await h.flush();const restore=h.apiCalls.find((call)=>call.url==='/api/sms/history'&&call.init.method==='PATCH');
  assert.deepEqual(JSON.parse(restore.init.body),{lawFirmId:firm,ids:[row.id]});assert.match(text(h.render()),/삭제한 내역이 없습니다/);
  h.button('발송내역 보기').props.onClick();await h.flush();assert.match(text(h.render()),/내역 본문 1/);
  assert.equal(h.writes.length,0);assert.equal(h.sendPending.length,0);
});

test('selection caps at 100 and only those IDs are hidden', async () => {
  const rows=Array.from({length:101},(_,index)=>historyRow(index+1));const h=harness({draft:draft({tab:'history'}),history:rows,canManageHistory:true});h.render();await h.flush();
  byLabel(h,'표시된 내역 최대 100건 선택').props.onChange({target:{checked:true}});h.render();
  assert.match(text(h.render()),/100\/100건 선택/);assert.equal(byLabel(h,'고객101 내역 선택').props.disabled,true);
  byLabel(h,'고객101 내역 선택').props.onChange();h.render();h.button('선택 삭제').props.onClick();await h.flush();
  const remove=h.apiCalls.find((call)=>call.init.method==='DELETE');const ids=JSON.parse(remove.init.body).ids;
  assert.equal(ids.length,100);assert.ok(!ids.includes(rows[100].id));assert.match(text(h.render()),/내역 본문 101/);
});

test('ordinary history viewers have no deletion, recovery, or selection controls', async () => {
  const h=harness({draft:draft({tab:'history'}),history:[historyRow()],canManageHistory:false});h.render();await h.flush();
  assert.equal(nodes(h.render(),(node)=>node.type==='input'&&node.props.type==='checkbox').length,0);
  assert.equal(h.button('삭제한 내역'),undefined);assert.equal(h.button('선택 삭제'),undefined);assert.equal(byLabel(h,'고객1 내역 삭제'),undefined);
});

test('failed history mutation keeps the row and selection so the user can review the error', async () => {
  const h=harness({draft:draft({tab:'history'}),history:[historyRow()],canManageHistory:true,mutationStatus:403});h.render();await h.flush();
  byLabel(h,'고객1 내역 선택').props.onChange();h.render();h.button('선택 삭제').props.onClick();await h.flush();
  assert.match(text(h.render()),/목록 변경을 거절했습니다/);assert.match(text(h.render()),/내역 본문 1/);assert.match(text(h.render()),/1\/100건 선택/);
  assert.equal(h.apiCalls.filter((call)=>call.init.method==='DELETE').length,1);assert.equal(h.sendPending.length,0);
});

test('a delayed active response cannot overwrite the deleted view', async () => {
  const options={draft:draft({tab:'history'}),history:[historyRow()],canManageHistory:true};const h=harness(options);h.render();await h.flush();
  options.delayHistory=true;byLabel(h,'발송내역 새로고침').props.onClick();await h.flush();const stale=h.historyPending[0];
  h.button('삭제한 내역').props.onClick();await h.flush();assert.equal(stale.init.signal.aborted,true);
  const current=h.historyPending[1];current.resolve(h.response({items:[historyRow(2,{deletedAt:'2026-10-17T10:00:00Z'})],canManageHistory:true}));await h.flush();
  stale.resolve(h.response({items:[historyRow()],canManageHistory:true}));await h.flush();
  assert.match(text(h.render()),/내역 본문 2/);assert.doesNotMatch(text(h.render()),/내역 본문 1/);
});
