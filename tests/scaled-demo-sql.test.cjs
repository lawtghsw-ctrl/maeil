// Native in-memory PostgreSQL only. No HTTP/provider/production connection.
// node --test tests/scaled-demo-sql.test.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createScaledDemoFixture, functionSql } = require('./support/scaled-demo-fixture.cjs');
const { buildScaledSalesDemo } = require('../lib/demo/scaled-demo.ts');
let fixture, plan;
before(async () => {
  fixture = await createScaledDemoFixture();
  plan = buildScaledSalesDemo({ firmId: fixture.firmId, batchKey: 'offline-500', existingLeads: fixture.legacy.leads, existingCases: fixture.legacy.cases });
});
after(async () => { if (fixture) await fixture.db.close(); });
async function rollback(fn) {
  await fixture.db.exec('begin');
  try { return await fn(); } finally { await fixture.db.exec('rollback'); }
}
const lead = (id, extra = {}) => ({ id, name: '[Synthetic] Lead', phone: '', assignedStaff: 'TEST1', status: '신규접수', detailStage: '신규디비', receivedAt: '2026-10-18T10:00:00+09:00', ...extra });

test('fixture enables actual core, SMS, Meta and supply triggers with TEST automation deliberately ON', async () => {
  const names = (await fixture.q("select tgname from pg_trigger where not tgisinternal and tgenabled<>'D'")).map(row => row.tgname);
  for (const name of ['crm_feedback_lead_metadata', 'crm_feedback_case_metadata', 'trg_app_leads_auto_sms', 'trg_app_leads_ensure_converted_records',
    'trg_app_leads_meta_queue', 'trg_app_cases_meta_contract_queue', 'trg_app_leads_normalize_pivot', 'trg_app_cases_tenant_links',
    'trg_sync_converted_lead_core_fields', 'trg_app_lead_imports_supply_ledger', 'platform_match_future_supply_contract']) assert.ok(names.includes(name), name);
  assert.equal((await fixture.one('select auto_enabled from sms_delivery_gates where law_firm_id=$1', [fixture.firmId])).auto_enabled, true);
  assert.equal((await fixture.one('select new_lead_enabled from sms_automation_settings where law_firm_id=$1', [fixture.firmId])).new_lead_enabled, true);
});

test('TEST exclusion stops INSERT and absence before epoch membership even with a valid recipient and enabled sender', () => rollback(async () => {
  const before = await fixture.snapshot();
  await fixture.insertEntity('app_leads', lead('reserved-probe', { phone: '01000000001' }));
  await fixture.q("update app_leads set data=data||'{\"detailStage\":\"부재\",\"status\":\"부재중\"}' where id='reserved-probe'");
  assert.deepEqual(await fixture.snapshot(), before);
  assert.equal((await fixture.one('select count(*)::int n from sms_delivery_lead_epochs')).n, 0);
  assert.equal((await fixture.one('select count(*)::int n from sms_delivery_trigger_errors')).n, 0);
}));

test('positive control: same SMS trigger queues outside the reserved identity, proving it is not an inactive stub', () => rollback(async () => {
  // WASM PostgreSQL lacks EUC_KR. This isolated positive control substitutes UTF8
  // for an ASCII-only message. TEST seed tests execute the untouched SQL body.
  await fixture.db.exec(functionSql('enqueue_lead_auto_sms', 'migrations/20261018082353_sms_consult_time_variables.sql').replaceAll("'EUC_KR'", "'UTF8'"));
  await fixture.q("update law_firms set name='Synthetic ordinary firm' where id=$1", [fixture.firmId]);
  await fixture.insertEntity('app_leads', lead('ordinary-sms-probe', { phone: '01000000003' }));
  const queued = await fixture.q("select source,message from sms_delivery_jobs where lead_id='ordinary-sms-probe'");
  assert.deepEqual(queued, [{ source: 'new_lead', message: 'hello' }]);
  assert.equal((await fixture.one("select count(*)::int n from sms_delivery_lead_epochs where lead_id='ordinary-sms-probe'")).n, 1);
  assert.equal((await fixture.one('select count(*)::int n from sms_delivery_trigger_errors')).n, 0);
}));

test('positive control: real linked Meta stage and positive contract triggers enqueue only when lineage is present', () => rollback(async () => {
  await fixture.q('insert into app_leads(id,law_firm_id,data,ad_source_id,meta_account_id,meta_lead_id) values($1,$2,$3,$4,$5,$6)',
    ['meta-probe', fixture.firmId, lead('meta-probe'), fixture.sourceId, fixture.metaId, 'synthetic-meta-id']);
  await fixture.q("update app_leads set data=data||'{\"detailStage\":\"상담\"}' where id='meta-probe'");
  await fixture.insertEntity('app_clients', { id: 'meta-client', name: 'Synthetic', fromLeadId: 'meta-probe' });
  await fixture.insertEntity('app_cases', { id: 'meta-case', clientId: 'meta-client', fromLeadId: 'meta-probe', contractAmount: 3300000, contractDate: '2026-10-18', caseType: '개인회생', status: '진행중' });
  const events = await fixture.q("select quality_group from meta_event_queue where lead_id='meta-probe' order by quality_group");
  assert.deepEqual(events, [{ quality_group: 'CONVERTED' }, { quality_group: 'ENGAGED' }]);
}));

test('premature conversion pointers really create a zero-value repair case; planned seed order avoids that path', () => rollback(async () => {
  await fixture.insertEntity('app_leads', lead('wrong-order', { convertedClientId: 'wrong-client', convertedCaseId: 'wrong-case' }));
  const repaired = await fixture.one("select data from app_cases where id='wrong-case'");
  assert.equal(repaired.data.contractAmount, 0);
  assert.equal(repaired.data.fromLeadId, 'wrong-order');
}));

test('real operational tenant trigger rejects a foreign client, rolling back the attempted seed case', () => rollback(async () => {
  await fixture.db.exec('savepoint foreign_case');
  await assert.rejects(() => fixture.insertEntity('app_cases', { id: 'foreign-case', clientId: 'OTHER-app_clients', fromLeadId: fixture.legacy.leads[0].id, contractAmount: 3300000 }), /different law firm/);
  await fixture.db.exec('rollback to savepoint foreign_case');
  assert.equal((await fixture.one("select count(*)::int n from app_cases where id='foreign-case'")).n, 0);
}));

test('manual supply keeps 50,000 snapshot despite active matching contract; import trigger still works for real ingest', () => rollback(async () => {
  await fixture.q("insert into platform_supply_contracts(id,law_firm_id,product,category,unit_price,monthly_quantity,start_date,end_date,status,confirmed_at,updated_at) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1,'Fixture','Fixture',99999,500,current_date-365,current_date+365,'active',now()-interval '2 days',now()-interval '2 days')", [fixture.firmId]);
  await fixture.q("insert into lead_supply_ledger(law_firm_id,external_key,lead_id,classification,billable,unit_price_snapshot,origin) values($1,'manual-probe',$2,'new',true,50000,'manual')", [fixture.firmId, fixture.legacy.leads[0].id]);
  assert.deepEqual(await fixture.one("select unit_price_snapshot::int,supply_contract_id from lead_supply_ledger where external_key='manual-probe'"), { unit_price_snapshot: 50000, supply_contract_id: null });
  await fixture.q("insert into app_lead_imports(law_firm_id,external_key,lead_id,classification) values($1,'ingest-probe',$2,'new')", [fixture.firmId, fixture.legacy.leads[1].id]);
  assert.deepEqual(await fixture.one("select unit_price_snapshot::int,supply_contract_id,origin from lead_supply_ledger where external_key='ingest-probe'"), { unit_price_snapshot: 99999, supply_contract_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', origin: 'ingest' });
}));

test('default rollback rehearsal executes all 488/86 additions and preserves every original and side-effect table', async () => {
  const original = await fixture.originalSnapshot(), inert = await fixture.snapshot();
  const result = await fixture.applyPlan(plan, { rollback: true });
  assert.equal(result.supplyCohort.conversionRate, 18);
  assert.deepEqual(await fixture.originalSnapshot(), original);
  assert.deepEqual(await fixture.snapshot(), inert);
  assert.equal((await fixture.one('select count(*)::int n from app_leads where law_firm_id=$1', [fixture.firmId])).n, 12);
  assert.equal((await fixture.one('select count(*)::int n from lead_supply_ledger where law_firm_id=$1', [fixture.firmId])).n, 0);
});

test('wrong target identity rejects the batch before any added row or setting is persisted', async () => {
  const invalid = { ...plan, seed: { ...plan.seed, firmId: fixture.otherFirmId } };
  const original = await fixture.originalSnapshot(), inert = await fixture.snapshot();
  await assert.rejects(() => fixture.applyPlan(invalid), /DEMO_TENANT_MISMATCH/);
  assert.deepEqual(await fixture.originalSnapshot(), original);
  assert.deepEqual(await fixture.snapshot(), inert);
});

test('commit has 500/90/18%, 240 active and six staff at 40 active/15 retained, with no orphan or zero-price cases', async () => {
  const original = await fixture.originalSnapshot(), inert = await fixture.snapshot();
  const result = await fixture.applyPlan(plan);
  assert.equal(result.purchaseCost, 25000000);
  assert.equal(result.billableCount, 500);
  assert.deepEqual(result.supplyCohort.quality, { unlinkedRows: 0, missingLeads: 0, duplicateSupplyRows: 0, unknownSupplyRows: 0, invalidSupplyDates: 0, unresolvedContracts: 0 });
  assert.equal(result.supplyCohort.staff.reduce((n, row) => n + row.db, 0), 500);
  assert.ok(result.supplyCohort.staff.every(row => row.contractedDb === 15));
  const active = await fixture.q("select data->>'assignedStaff' staff,count(*)::int n from app_leads where law_firm_id=$1 and coalesce(data->>'convertedClientId','')='' and data->>'status' not in ('거절','부적합','종결_중단') group by 1 order by 1", [fixture.firmId]);
  assert.deepEqual(active.map(row => row.n), [40, 40, 40, 40, 40, 40]);
  assert.equal((await fixture.one("select count(*)::int n from app_leads where law_firm_id=$1 and data->>'status' in ('거절','부적합','종결_중단')", [fixture.firmId])).n, 170);
  assert.equal((await fixture.one("select count(*)::int n from app_cases where law_firm_id=$1 and (data->>'contractAmount')::numeric<=0", [fixture.firmId])).n, 0);
  assert.equal((await fixture.one('select count(*)::int n from app_clients where law_firm_id=$1', [fixture.firmId])).n, 90);
  assert.equal((await fixture.one('select count(*)::int n from app_installments where law_firm_id=$1', [fixture.firmId])).n, 8 + plan.installments.length);
  assert.equal((await fixture.one("select count(*)::int n from app_leads l left join app_cases c on c.id=l.data->>'convertedCaseId' and c.law_firm_id=l.law_firm_id left join app_clients cl on cl.id=l.data->>'convertedClientId' and cl.law_firm_id=l.law_firm_id where l.law_firm_id=$1 and l.data?'convertedCaseId' and (c.id is null or cl.id is null or c.data->>'fromLeadId'<>l.id or c.data->>'clientId'<>cl.id)", [fixture.firmId])).n, 0);
  assert.deepEqual(await fixture.originalSnapshot(), original);
  assert.deepEqual(await fixture.snapshot(), inert);
  assert.equal((await fixture.one('select service_mode from platform_firm_commercial_profiles where law_firm_id=$1', [fixture.firmId])).service_mode, 'db_supply');
});

test('repeating the same seed fails closed before writes and leaves all 500 rows, money and pending messages unchanged', async () => {
  const tables = ['app_leads', 'app_clients', 'app_cases', 'app_installments', 'app_schedule_items', 'lead_supply_ledger', 'firm_settings', 'platform_firm_commercial_profiles'];
  const before = await Promise.all(tables.map(table => fixture.rows(table)));
  const inert = await fixture.snapshot();
  await assert.rejects(() => fixture.applyPlan(plan), /DEMO_BATCH_ALREADY_EXISTS/);
  assert.deepEqual(await Promise.all(tables.map(table => fixture.rows(table))), before);
  assert.deepEqual(await fixture.snapshot(), inert);
});
