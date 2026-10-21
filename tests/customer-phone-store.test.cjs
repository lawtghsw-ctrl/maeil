const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer')), { act } = Renderer;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value ? text(value.children) : '';
const delay = () => new Promise(resolve => setTimeout(resolve, 1));
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function functionFrom(fileName, name, globals) {
  const file = ts.createSourceFile(fileName, fs.readFileSync(path.join(__dirname, fileName), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  return vm.runInNewContext(`(${fn.getText(file)})`, globals);
}
const makeFixture = functionFrom('store-performance.test.cjs', 'makeFixture', { clone, deferred });
const harness = functionFrom('manual-lead-assignment.test.cjs', 'harness', { makeFixture, clone, text, delay, fs, path, vm, ts, root, runtime, React, Renderer, act, require, console, Date, Error, Map, Set, Math, setTimeout, clearTimeout });
const call = async fn => { let result; await act(async () => { result = await fn(); }); return result; };
function rpcSuccess(h) {
  const original = h.fixture.client.rpc;
  h.fixture.client.rpc = async (name, args) => {
    if (name !== 'update_client_phone') return original(name, args);
    h.fixture.calls.push({ table: 'rpc:update_client_phone', args });
    const row = h.fixture.db.app_clients.find(row => row.id === args.target_client_id);
    row.data.phone = args.new_phone;
    const lead = h.fixture.db.app_leads.find(row => row.data.convertedClientId === args.target_client_id && row.law_firm_id === 'firm-1');
    if (lead) lead.data.phone = args.new_phone;
    return { data: { clientId: row.id, leadId: lead?.id ?? null, phone: args.new_phone }, error: null };
  };
}

test('store rejects invalid lead phone before optimistic mutation and retains basic-edit permission gate', async () => {
  const h = harness(); await h.mount();
  try {
    const before = clone(h.store.leads), calls = h.fixture.calls.length;
    assert.equal(await call(() => h.store.updateLead('L1', { phone: '010-1111-2222' })), false);
    assert.deepEqual(clone(h.store.leads), before); assert.equal(h.fixture.calls.length, calls);
    await h.refreshActor({ permissions: { 'db.view': true, 'db.edit_basic': true } });
    const oldPhone = h.store.leads[0].phone, beforeCalls = h.fixture.calls.length;
    for (const phone of ['', 'not a number', undefined]) assert.equal(await call(() => h.store.updateLead('L1', { phone })), false);
    assert.equal(h.store.leads[0].phone, oldPhone); assert.equal(h.fixture.calls.length, beforeCalls);
    assert.equal(await call(() => h.store.updateLead('L1', { phone: ' 010-1234-5678 ' })), true);
    assert.equal(h.fixture.db.app_leads.find(row => row.id === 'L1').data.phone, '010-1234-5678');
  } finally { await h.close(); }
});

test('client phone edits are admin-only and use one atomic RPC, preserving all unrelated data', async () => {
  const h = harness({ admin: true });
  Object.assign(h.fixture.db.app_clients[0].data, { fromLeadId: 'L1', memo: 'keep client', consultation: { memo: 'keep consultation' } });
  Object.assign(h.fixture.db.app_leads[0].data, { convertedClientId: 'C1', memo: 'keep lead' });
  await h.mount(); rpcSuccess(h);
  try {
    const baseline = clone(h.fixture.db);
    assert.equal(await call(() => h.store.updateClientPhone('C1', ' 010-2222-3333 ')), true);
    assert.equal(h.store.clients.find(row => row.id === 'C1').phone, '010-2222-3333');
    assert.equal(h.store.leads.find(row => row.id === 'L1').phone, '010-2222-3333');
    assert.equal(h.fixture.calls.filter(row => row.table === 'rpc:update_client_phone').length, 1);
    assert.equal(h.fixture.db.app_clients[0].data.memo, baseline.app_clients[0].data.memo);
    assert.deepEqual(clone(h.fixture.db.app_clients[0].data.consultation), baseline.app_clients[0].data.consultation);
    for (const table of ['app_cases', 'app_installments', 'firm_settings']) assert.deepEqual(clone(h.fixture.db[table]), baseline[table]);
    await h.refreshActor({ role: 'staff', platform_role: 'staff', permissions: { 'db.view': true, 'db.edit_basic': true, 'cases.view': true } });
    const calls = h.fixture.calls.length;
    assert.equal(await call(() => h.store.updateClientPhone('C1', '010-4444-5555')), false); assert.equal(h.fixture.calls.length, calls);
  } finally { await h.close(); }
});

test('failed RPC does not display a successful or partially optimistic customer edit', async () => {
  const h = harness({ admin: true }); await h.mount();
  h.fixture.client.rpc = async () => ({ data: null, error: new Error('synthetic transaction rollback') });
  try {
    const clients = clone(h.store.clients), leads = clone(h.store.leads);
    assert.equal(await call(() => h.store.updateClientPhone('C1', '010-8888-9999')), false);
    assert.deepEqual(clone(h.store.clients), clients); assert.deepEqual(clone(h.store.leads), leads); assert.match(h.store.syncError, /입력값은 유지/);
  } finally { await h.close(); }
});

test('global super view and rows from another firm cannot call customer phone RPC', async () => {
  const h = harness({ admin: true }); await h.mount(); rpcSuccess(h);
  try {
    let before = h.fixture.calls.length;
    assert.equal(await call(() => h.store.updateClientPhone('C2', '010-1111-9999')), false); assert.equal(h.fixture.calls.length, before);
    await h.refreshActor({ platform_role: 'super_admin', law_firm_id: null });
    before = h.fixture.calls.length;
    assert.equal(await call(() => h.store.updateClientPhone('C1', '010-1111-9999')), false); assert.equal(h.fixture.calls.length, before);
  } finally { await h.close(); }
});
