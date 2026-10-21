// Actual DB UI/store + isolated PostgreSQL checks. Synthetic records only;
// no live Supabase, Meta, SMS provider or production configuration is accessed.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), renderer = require(path.join(runtime, 'react-test-renderer'));
const Renderer = renderer, { act } = renderer, jsx = require(path.join(runtime, 'react/jsx-runtime'));
const { PGlite } = require(path.resolve(root, '../sms-sql-check/node_modules/@electric-sql/pglite'));
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const clean = clone;
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value ? text(value.children) : '';
const delay = () => new Promise(resolve => setTimeout(resolve, 1));
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function functionFrom(fileName, name, globals) {
  const file = ts.createSourceFile(fileName, fs.readFileSync(path.join(__dirname, fileName), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, `Shared fixture function ${name} exists`);
  return vm.runInNewContext(`(${fn.getText(file)})`, globals);
}
const instrument = functionFrom('db-performance.test.cjs', 'instrument', { ts });
const createHarness = functionFrom('db-performance.test.cjs', 'createHarness', { instrument, React, renderer, jsx, ts, vm, fs, path, root, clean, console, Date, Map, Set, Math });
const makeFixture = functionFrom('store-performance.test.cjs', 'makeFixture', { clone, deferred });
const storeHarness = functionFrom('manual-lead-assignment.test.cjs', 'harness', { makeFixture, clone, text, delay, fs, path, vm, ts, root, runtime, React, Renderer, act, require, console, Date, Error, Map, Set, Math, setTimeout, clearTimeout });
const source = fs.readFileSync(path.join(root, 'app/db/page.tsx'), 'utf8');
const hostText = node => node.children.map(child => typeof child === 'string' ? child : hostText(child)).join('');
const stageSelects = h => h.view.root.findAll(node => node.type === 'select' && node.findAllByType('option').some(option => option.props.value === '본인취소'));
const call = async fn => { let result; await act(async () => { result = await fn(); }); return result; };

test('본인취소 is additive and immediately follows 불가 in both shared option lists and every responsive selector', () => {
  const h = createHarness(source);
  try {
    const types = h.types;
    for (const list of [types.DB_DETAIL_STAGE_OPTIONS, types.DB_DETAIL_STAGE_GROUPS.상담]) {
      assert.equal(list[list.indexOf('불가') + 1], '본인취소');
      assert.equal(list.filter(value => value === '본인취소').length, 1);
    }
    assert.equal(types.DB_DETAIL_STAGE_TRACK_OF.본인취소, '상담');
    assert.equal(types.DB_LEAD_DEFAULT_STAGE_BY_STATUS.거절, '불가');
    assert.equal(types.DB_LEAD_DEFAULT_STAGE_BY_STATUS.부적합, '불가');
    assert.equal(types.DB_LEAD_DEFAULT_STAGE_BY_STATUS.종결_중단, '장기부재');
    // HEAD already contains this additive change after deployment; compare with
    // the immutable pre-feature baseline rather than the current branch tip.
    const original = require('node:child_process').execFileSync('git', ['show', 'db8f0b74d3de411103715767ec337363d3927d56:lib/types.ts'], { cwd: root, encoding: 'utf8' });
    const old = { exports: {} };
    vm.runInNewContext(ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: old, exports: old.exports });
    assert.deepEqual(clone(types.DB_DETAIL_STAGE_OPTIONS.filter(value => value !== '본인취소')), clone(old.exports.DB_DETAIL_STAGE_OPTIONS));
    assert.deepEqual(clone(types.DB_LEAD_STATUSES), clone(old.exports.DB_LEAD_STATUSES));
    const selectors = stageSelects(h);
    assert.equal(selectors.length, 20, '10 rows each have a mobile and a desktop selector');
    for (const select of selectors) {
      const options = select.findAllByType('option').map(option => option.props.value);
      assert.equal(options[options.indexOf('불가') + 1], '본인취소');
    }
    const board = h.view.root.findAllByType('button').find(button => hostText(button).startsWith('본인취소'));
    assert.ok(board, 'The shared board exposes the new filter');
    const siblings = board.parent.children.filter(node => typeof node !== 'string' && node.type === 'button');
    assert.equal(hostText(siblings[siblings.indexOf(board) - 1]).startsWith('불가'), true);
  } finally { h.close(); }
});

test('new stage changes and filters correctly while preserving legacy status and converted links', async () => {
  const h = createHarness(source);
  try {
    const plain = { ...h.store.leads[1], id: 'self-canceled', detailStage: '상담', status: '상담완료', convertedClientId: undefined, convertedCaseId: undefined };
    const converted = { ...h.store.leads[0], id: 'converted-canceled', detailStage: '상담', status: '수임전환', convertedClientId: 'existing-client', convertedCaseId: 'existing-case' };
    h.store.leads = [plain, converted]; h.refresh();
    const selectors = stageSelects(h);
    assert.equal(selectors.length, 4);
    for (const select of selectors) await act(async () => { select.props.onChange({ target: { value: '본인취소' } }); });
    for (const [kind, id, patch] of h.writes) {
      assert.equal(kind, 'update'); assert.equal(patch.detailStage, '본인취소');
      if (id === plain.id) assert.equal(patch.status, '상담완료', 'Do not invent a legacy cancellation/event mapping');
      else assert.deepEqual(patch, { detailStage: '본인취소' }, 'Converted contract status is not rewritten');
    }
    h.store.leads = h.store.leads.map(lead => ({ ...lead, ...h.writes.find(write => write[1] === lead.id)[2] })); h.refresh();
    assert.ok(stageSelects(h).every(select => select.props.value === '본인취소'));
    const board = h.view.root.findAllByType('button').find(button => hostText(button).startsWith('본인취소'));
    assert.match(hostText(board), /2건/);
    act(() => board.props.onClick());
    assert.deepEqual(h.snapshot().rowIds.sort(), ['converted-canceled', 'self-canceled']);
    assert.equal(h.snapshot().stageCounts.본인취소, 2);
    assert.equal(h.snapshot().stageWarningCounts.본인취소, undefined);
    h.set({ stage: '불가' }); assert.deepEqual(h.snapshot().rowIds, []);
    h.set({ stage: '전체' }); assert.equal(h.snapshot().rowIds.length, 2);
    h.permissions(['db.view']); assert.ok(stageSelects(h).every(select => select.props.disabled));
  } finally { h.close(); }
});

test('store persists and reloads the independent stage without altering historical records, links or consultation', async () => {
  const h = storeHarness({ admin: true });
  Object.assign(h.fixture.db.app_leads[0].data, { status: '상담완료', detailStage: '상담', consultation: { memo: 'Keep consultation' }, memo: 'Keep memo', convertedClientId: 'C1', convertedCaseId: 'K1' });
  await h.mount();
  try {
    const original = clone(h.fixture.db.app_leads[0].data), other = clone(h.fixture.db.app_leads[1]), clients = clone(h.fixture.db.app_clients), cases = clone(h.fixture.db.app_cases);
    assert.equal(await call(() => h.store.updateLead('L1', { detailStage: '본인취소' })), true);
    assert.deepEqual(clone(h.fixture.db.app_leads[0].data), { ...original, id: 'L1', detailStage: '본인취소' });
    await call(() => h.store.reloadData());
    assert.equal(h.store.leads.find(lead => lead.id === 'L1').detailStage, '본인취소');
    assert.equal(h.store.leads.find(lead => lead.id === 'L1').status, original.status);
    assert.deepEqual(clone(h.fixture.db.app_leads[1]), other);
    assert.deepEqual(clone(h.fixture.db.app_clients), clients); assert.deepEqual(clone(h.fixture.db.app_cases), cases);
    // Reopening an existing stage remains possible; no old enum values are removed.
    assert.equal(await call(() => h.store.updateLead('L1', { detailStage: '불가' })), true);
    await call(() => h.store.reloadData()); assert.equal(h.store.leads.find(lead => lead.id === 'L1').detailStage, '불가');
  } finally { await h.close(); }
});

test('new stage retains the existing store permission and failed-save/retry behavior', async () => {
  const h = storeHarness();
  Object.assign(h.fixture.db.app_leads[0].data, { status: '신규접수', detailStage: '미상담' });
  await h.mount();
  try {
    const before = clone(h.fixture.db.app_leads), calls = h.fixture.calls.length;
    assert.equal(await call(() => h.store.updateLead('L1', { detailStage: '본인취소' })), false);
    assert.deepEqual(clone(h.fixture.db.app_leads), before); assert.equal(h.fixture.calls.length, calls);
    await h.refreshActor({ permissions: { 'db.view': true, 'db.change_stage': true } });
    h.fixture.errors.push('app_leads');
    assert.equal(await call(() => h.store.updateLead('L1', { detailStage: '본인취소' })), false);
    assert.match(h.store.syncError, /저장 실패/);
    assert.equal(h.store.leads[0].detailStage, '본인취소', 'Current behavior retains the unsaved draft');
    assert.deepEqual(clone(h.fixture.db.app_leads), before, 'Failed persistence cannot silently change stored data');
    assert.equal(await call(() => h.store.updateLead('L1', { detailStage: '본인취소' })), true);
    await call(() => h.store.reloadData()); assert.equal(h.store.leads[0].detailStage, '본인취소');
    assert.equal(h.store.leads[0].status, '신규접수'); assert.equal(h.store.syncError, null);
    const page = createHarness(source);
    try {
      page.store.leads = clone(h.store.leads); page.refresh();
      assert.equal(page.snapshot().stageCounts.본인취소, 1);
      assert.equal(page.snapshot().stageCounts.미상담, undefined);
      assert.equal(page.snapshot().stageCounts.신규디비, undefined);
      assert.ok(stageSelects(page).every(select => select.props.value === '본인취소'));
      assert.deepEqual(page.snapshot().stageWarningCounts, {});
      assert.equal(page.view.root.findAll(node => node.type === 'span' && typeof node.props.title === 'string' && node.findAll(child => child.props['data-icon'] === 'ShieldAlert').length > 0).length, 0);
      page.set({ stage: '본인취소' }); assert.deepEqual(page.snapshot().rowIds, ['L1']);
    } finally { page.close(); }

  } finally { await h.close(); }
});

test('dashboard contact warning respects explicit 본인취소 even with a legacy unconsulted status', () => {
  const page = createHarness(source);
  try {
    const file = ts.createSourceFile('FirmDashboard.tsx', fs.readFileSync(path.join(root, 'components/dashboard/FirmDashboard.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const helpers = file.statements.filter(node => ts.isFunctionDeclaration(node) && ['stageOf', 'leadNeedsContact'].includes(node.name?.text)).map(node => node.getText(file)).join('\n');
    const compiled = ts.transpileModule(helpers + '\nexport { stageOf, leadNeedsContact };', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    const warningMustNotRun = () => { throw Error('Canceled rows must not request a contact warning'); };
    vm.runInNewContext(compiled, { module, exports: module.exports, DB_LEAD_DEFAULT_STAGE_BY_STATUS: page.types.DB_LEAD_DEFAULT_STAGE_BY_STATUS,
      checkCallWarning: warningMustNotRun, checkPeriodicContactWarning: warningMustNotRun, dailyContactThreshold: warningMustNotRun });
    for (const status of ['신규접수', '부재중', '재통화필요', '종결_중단']) {
      const lead = { status, detailStage: '본인취소', consultation: { memoLog: [] } };
      assert.equal(module.exports.stageOf(lead), '본인취소');
      assert.equal(module.exports.leadNeedsContact(lead, '2026-10-21'), false);
    }
  } finally { page.close(); }
});

const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
function sqlFunction(source, name) {
  const matches = [...source.matchAll(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?(?:\\n|;)\\$\\$;`, 'gi'))];
  assert.ok(matches.length, `Production function ${name} exists`); return matches.at(-1)[0];
}

test('offline PostgreSQL: existing JSONB schema accepts the new stage and canonical Meta does not reinterpret it', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table profiles(id uuid,display_name text,staff_name text);
      create table app_leads(id text primary key,law_firm_id uuid,data jsonb not null,ad_source_id uuid,meta_account_id uuid);
      create table firm_meta_event_rules(law_firm_id uuid,enabled boolean,trigger_type text,trigger_value text,event_name text);
      create table meta_event_queue(id uuid,law_firm_id uuid,lead_id text,ad_source_id uuid,meta_account_id uuid,event_name text,event_id text,crm_status text,crm_stage text,event_time timestamptz,quality_group text);`);
    const meta = migration('007_meta_crm_optimization.sql');
    await db.exec(sqlFunction(meta, 'meta_crm_stage_signal_group'));
    await db.exec(sqlFunction(meta, 'enqueue_meta_events_for_lead'));
    await db.exec(sqlFunction(migration('20261018003418_crm_feedback_fields.sql'), 'crm_feedback_lead_metadata'));
    await db.exec(`create trigger metadata before update on app_leads for each row execute function crm_feedback_lead_metadata();
      create trigger meta after update on app_leads for each row execute function enqueue_meta_events_for_lead();`);
    const firm = '11111111-1111-4111-8111-111111111111', account = '22222222-2222-4222-8222-222222222222';
    const initial = { name: 'Synthetic', status: '상담완료', detailStage: '상담', memo: 'Preserve all data', consultation: { memo: 'Unchanged' } };
    await db.query('insert into app_leads values($1,$2,$3::jsonb,null,$4)', ['lead', firm, JSON.stringify(initial), account]);
    await db.query('insert into firm_meta_event_rules values($1,true,$2,$3,$4),($1,true,$2,$5,$4),($1,true,$6,$7,$8)',
      [firm, 'detail_stage', '상담', 'Lead', '착수금 안내', 'status', '거절', 'ExistingConfiguredEvent']);
    assert.equal((await db.query("select meta_crm_stage_signal_group('본인취소') as value")).rows[0].value, null);
    await db.query("update app_leads set data=data||'{\"detailStage\":\"본인취소\"}'::jsonb where id='lead'");
    const persisted = (await db.query("select data from app_leads where id='lead'")).rows[0].data;
    assert.ok(persisted.stageUpdatedAt); delete persisted.stageUpdatedAt;
    assert.deepEqual(persisted, { ...initial, detailStage: '본인취소' });
    assert.equal((await db.query('select count(*)::int n from meta_event_queue')).rows[0].n, 0, 'No canonical or existing status event is invented');
    // Legacy status fallback intentionally remains intact: arbitrary configured
    // status rules can still fire if someone later decides to map to 거절.
    await db.query("update app_leads set data=data||'{\"status\":\"거절\"}'::jsonb where id='lead'");
    assert.equal((await db.query('select event_name from meta_event_queue')).rows[0].event_name, 'ExistingConfiguredEvent');
  } finally { await db.close(); }
});
