// Offline PostgreSQL only: no Supabase connection, API calls, queue worker or SMS.
// Run: node --test tests/lead-attribution-backfill.test.cjs
// Uses only repository SQL function bodies and synthetic fixtures.
// One-off production capture/script checks are kept outside the repository.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { PGlite } = require(path.resolve(root, '../sms-sql-check/node_modules/@electric-sql/pglite'));
const db = new PGlite();
const firm = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const meta = '44444444-4444-4444-8444-444444444444';
const sourceId = '44444444-4444-4444-8444-444444444445';
const sender = '55555555-5555-4555-8555-555555555555';
const epoch = '66666666-6666-4666-8666-666666666666';
const relay = '77777777-7777-4777-8777-777777777777';
const request = '88888888-8888-4888-8888-888888888888';
const ids = ['fixture-1', 'fixture-2', 'fixture-3'];
const read = file => fs.readFileSync(path.join(root, 'supabase', file), 'utf8');
const functions = [
  ['crm_feedback_lead_metadata', '20261018003418_crm_feedback_fields.sql'],
  ['enforce_lead_update_permissions', '018_case_delete_permission.sql'],
  ['enqueue_lead_auto_sms', '20261017133745_sms_delivery_epoch_jobs.sql'],
  ['enqueue_meta_events_for_lead', '007_meta_crm_optimization.sql'],
  ['ensure_converted_lead_records', '012_db_convert_orphan_repair.sql'],
  ['normalize_app_lead_pivot_fields', '010_weekend_consult_time_search_fix.sql'],
  ['sync_converted_lead_core_fields', '021_converted_lead_direction_assignee_sync.sql'],
  ['sync_lead_search_columns', '006_multi_tenant_platform.sql'],
  ['touch_updated_at', '001_initial.sql'],
];
function functionSql(name, file) {
  const match = read(file).match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(match, `Missing SQL function ${name}`);
  return { sql: match[0], body: match[1] };
}
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const protectedTables = ['app_clients', 'app_cases', 'app_installments', 'app_lead_imports', 'lead_supply_ledger',
  'sms_outbox', 'sms_delivery_jobs', 'sms_delivery_requests', 'sms_delivery_gates', 'sms_delivery_lead_epochs',
  'sms_delivery_trigger_errors', 'sms_automation_settings', 'sms_staff_automation_settings', 'meta_event_queue', 'meta_event_logs'];
async function snapshot() {
  const rows = {};
  for (const table of protectedTables) rows[table] = await q(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`);
  return rows;
}
async function rollback(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}
// Mirrors the intended guard, not an application write API: the real one-off SQL
// must compare only explicit ad keys, not discard existing _platform metadata.
async function guardedBackfill() {
  await db.exec('savepoint metadata_backfill');
  try {
    const before = await q('select * from app_leads where law_firm_id=$1 and id=any($2::text[]) order by id for update', [firm, ids]);
    assert.equal(before.length, 3, 'exact target count');
    const untouched = await snapshot();
    const patch = { adId: '120000000000001', campaignId: '111', adsetId: '222' };
    const changed = await q(`update app_leads set ad_source_id=$4,meta_account_id=$5,
      data=data||jsonb_build_object('_platform',coalesce(data->'_platform','{}'::jsonb)||$3::jsonb)
      where law_firm_id=$1 and id=any($2::text[]) returning *`, [firm, ids, patch, sourceId, meta]);
    assert.equal(changed.length, 3);
    const strip = row => {
      const clone = structuredClone(row);
      delete clone.updated_at; // Existing touch_updated_at behavior is intentional.
      delete clone.ad_source_id; delete clone.meta_account_id;
      for (const key of Object.keys(patch)) delete clone.data._platform[key];
      return clone;
    };
    assert.deepEqual(changed.sort((a, b) => a.id.localeCompare(b.id)).map(strip), before.map(strip), 'non-advertising lead data and normalized columns must be identical');
    assert.ok(changed.every(row => row.ad_source_id === sourceId && row.meta_account_id === meta));
    assert.deepEqual(await snapshot(), untouched, 'linked entities, SMS state and Meta queue must remain identical');
    await db.exec('release savepoint metadata_backfill');
    return changed;
  } catch (error) {
    await db.exec('rollback to savepoint metadata_backfill; release savepoint metadata_backfill');
    throw error;
  }
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
    create table law_firms(id uuid primary key, firm_code char(10), name text, status text default 'active');
    create table profiles(id uuid primary key references auth.users(id),law_firm_id uuid,platform_role text,role text,display_name text,staff_name text,is_active boolean,permissions jsonb default '{}');
    create table firm_settings(law_firm_id uuid,key text,value jsonb);
    create table app_leads(id text primary key,law_firm_id uuid,data jsonb,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now(),phone_normalized text,ad_source_id uuid,meta_account_id uuid,meta_lead_id text);
    create table app_clients(id text primary key,law_firm_id uuid,data jsonb,created_by uuid);
    create table app_cases(id text primary key,law_firm_id uuid,data jsonb,created_by uuid);
    create table app_installments(id text primary key,law_firm_id uuid,data jsonb);
    create table app_lead_imports(id uuid primary key,law_firm_id uuid,payload jsonb);
    create table lead_supply_ledger(id uuid primary key,law_firm_id uuid,payload jsonb);
    create table firm_meta_accounts(id uuid primary key,law_firm_id uuid);
    create table ad_sources(id uuid primary key,law_firm_id uuid,meta_account_id uuid);
    create table firm_meta_event_rules(law_firm_id uuid,enabled boolean,trigger_type text,trigger_value text,event_name text);
    create table meta_event_queue(id uuid primary key,law_firm_id uuid,lead_id text,ad_source_id uuid,meta_account_id uuid,event_name text,event_id text,crm_status text,crm_stage text,event_time timestamptz,quality_group text);
    create table meta_event_logs(id uuid primary key,payload jsonb);
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key,name text,bucket_id text);
    create function public.is_active_user() returns boolean language sql as $$select true$$;
    create function public.is_super_admin() returns boolean language sql as $$select true$$;
    create function public.is_firm_admin() returns boolean language sql as $$select true$$;
    create function public.is_admin_user() returns boolean language sql as $$select true$$;
    create function public.current_law_firm_id() returns uuid language sql as $$select '${firm}'::uuid$$;
    create function public.has_permission(k text) returns boolean language sql as $$select true$$;
    create function public.has_any_permission(k text[]) returns boolean language sql as $$select true$$;
    insert into law_firms values('${firm}','1111111111','Fixture','active'),('${other}','2222222222','Other','active');
    insert into auth.users values('${actor}');
    insert into profiles(id,law_firm_id,platform_role,role,is_active) values('${actor}','${firm}','firm_admin','admin',true);
    insert into firm_meta_accounts values('${meta}','${firm}');
    insert into ad_sources values('${sourceId}','${firm}','${meta}');
    insert into firm_meta_event_rules values('${firm}',true,'detail_stage','상담','Lead'),('${firm}',true,'status','부재중','Contact');
    insert into app_clients values('client-1','${firm}','{"name":"Existing client","memo":"keep","fromLeadId":"fixture-1"}',null);
    insert into app_cases values('case-1','${firm}','{"clientId":"client-1","contractAmount":4000000,"paidAmount":900000,"fromLeadId":"fixture-1","memo":"keep","feeStandardSnapshot":{"baseFee":4000000}}',null);
    insert into app_installments values('installment-1','${firm}','{"caseId":"case-1","amount":1000000,"actualPaidAmount":900000,"status":"완납"}');
    insert into app_lead_imports values(gen_random_uuid(),'${firm}','{"original":"keep"}');
    insert into lead_supply_ledger values(gen_random_uuid(),'${firm}','{"snapshotUnitPrice":12345}');
    insert into meta_event_logs values(gen_random_uuid(),'{"status":"success"}');
  `);
  // Old rows predate the trigger installation; no fixture INSERT can enqueue.
  for (let i = 0; i < ids.length; i++) {
    const data = { id: ids[i], name: `Fixture ${i}`, phone: '010-1234-5678', assignedStaff: 'Fixture Staff',
      detailStage: i === 1 ? '부재' : '미상담', status: i === 1 ? '부재중' : '미진행', stageUpdatedAt: '2026-10-01T00:00:00Z',
      receivedAt: '2026-10-01T00:00:00Z', adName: '원본 회생 광고명 유지', contactLog: [{ id: 'call-1', type: 'phone', at: '2026-10-01T00:00:00Z', connected: false }],
      consultation: { memoLog: [{ tag: '부재중', text: 'keep', at: '2026-10-01T00:00:00Z' }] }, memo: 'unchanged',
      debtRange: '1억원 이상', incomeRange: '400만원 이상', consultTime: '주말 오전(8~12시)', consultTimeRaw: '주말 오전 (8시 ~ 12시)',
      _platform: { metaAccountId: meta, leadgenId: `external-${i}`, untouched: { value: ['keep'] } },
      ...(i === 0 ? { convertedClientId: 'client-1', convertedCaseId: 'case-1' } : {}),
    };
    await q('insert into app_leads(id,law_firm_id,data,meta_account_id,meta_lead_id,phone_normalized,updated_at) values($1,$2,$3,$4,$5,$6,$7)',
      [ids[i], firm, data, meta, `external-${i}`, '01012345678', '2026-10-01T00:00:00Z']);
  }
  for (const file of ['014_sms_center_foundation.sql', '015_sms_staff_automation_images.sql', '016_sms_permissions.sql', '20261017133745_sms_delivery_epoch_jobs.sql']) await db.exec(read(`migrations/${file}`));
  await db.exec(`
    insert into sms_sender_numbers(id,law_firm_id,staff_name,phone,is_registered,is_default) values('${sender}','${firm}','Fixture Staff','01011112222',true,true);
    insert into sms_staff_automation_settings(law_firm_id,staff_name,sender_number_id,new_lead_template,absence_template) values('${firm}','Fixture Staff','${sender}','hello','hello');
    insert into sms_delivery_gates(law_firm_id,manual_enabled,auto_enabled,epoch_id,relay_epoch,activated_at) values('${firm}',true,false,'${epoch}','${relay}','2026-10-01');
    insert into sms_delivery_requests(law_firm_id,request_id,actor_id,payload_hash) values('${firm}','${request}','${actor}',decode('1234','hex'));
    insert into sms_outbox(id,law_firm_id,lead_id,sender_number,receiver_number,message,status) values('99999999-9999-4999-8999-999999999991','${firm}','fixture-1','01011112222','01012345678','legacy pending','pending_api'),('99999999-9999-4999-8999-999999999992','${firm}','fixture-2','01011112222','01012345678','new queued','queued');
    insert into sms_delivery_jobs(law_firm_id,outbox_id,epoch_id,relay_epoch,request_id,recipient_index,source,lead_id,sender_number_id,sender_number,receiver_number,message,msg_type,available_at,expires_at)
      values('${firm}','99999999-9999-4999-8999-999999999992','${epoch}','${relay}','${request}',1,'manual','fixture-2','${sender}','01011112222','01012345678','new queued','SMS',now(),now()+interval '1 day');
  `);
  for (const name of ['lawpower_normalize_debt_range', 'lawpower_normalize_income_range']) await db.exec(functionSql(name, 'V28_6_1_PIVOT_FIX.sql').sql);
  await db.exec(functionSql('lawpower_normalize_consult_time', 'migrations/010_weekend_consult_time_search_fix.sql').sql);
  await db.exec(functionSql('meta_crm_stage_signal_group', 'migrations/007_meta_crm_optimization.sql').sql);
  for (const [name, file] of functions) await db.exec(functionSql(name, `migrations/${file}`).sql);
  await db.exec(functionSql('enforce_lead_lineage_tenant_consistency', 'migrations/006_multi_tenant_platform.sql').sql);
  await db.exec(functionSql('enqueue_meta_event_for_contract', 'migrations/007_meta_crm_optimization.sql').sql);
  await db.exec(functionSql('crm_feedback_case_metadata', 'migrations/20261018003418_crm_feedback_fields.sql').sql);
  await db.exec(`
    create trigger crm_feedback_lead_metadata before insert or update of data on app_leads for each row execute function crm_feedback_lead_metadata();
    create trigger trg_app_leads_normalize_pivot before insert or update of data on app_leads for each row execute function normalize_app_lead_pivot_fields();
    create trigger trg_app_leads_permissions before update on app_leads for each row execute function enforce_lead_update_permissions();
    create trigger trg_app_leads_search_columns before insert or update of data on app_leads for each row execute function sync_lead_search_columns();
    create trigger trg_app_leads_updated_at before update on app_leads for each row execute function touch_updated_at();
    create trigger trg_app_leads_lineage_tenant before insert or update of law_firm_id,ad_source_id,meta_account_id on app_leads for each row execute function enforce_lead_lineage_tenant_consistency();
    create trigger trg_app_leads_meta_queue after update of data on app_leads for each row execute function enqueue_meta_events_for_lead();
    create trigger trg_app_leads_ensure_converted_records after insert or update of data on app_leads for each row when(nullif(new.data->>'convertedClientId','') is not null and nullif(new.data->>'convertedCaseId','') is not null) execute function ensure_converted_lead_records();
    create trigger trg_sync_converted_lead_core_fields after update of data on app_leads for each row when(old.data->'name' is distinct from new.data->'name' or old.data->'applicationType' is distinct from new.data->'applicationType' or old.data->'assignedStaff' is distinct from new.data->'assignedStaff') execute function sync_converted_lead_core_fields();
    create trigger crm_feedback_case_metadata before insert or update of data on app_cases for each row execute function crm_feedback_case_metadata();
    create trigger trg_app_cases_meta_contract_queue after insert or update of data on app_cases for each row execute function enqueue_meta_event_for_contract();
  `);
});
after(() => db.close());

test('three metadata-only updates preserve normalized data, linked contracts and all SMS/Meta state with auto disabled', () => rollback(async () => {
  const changed = await guardedBackfill();
  assert.ok(changed.every(row => row.data._platform.adId === '120000000000001' && row.data.adName === '원본 회생 광고명 유지'));
  assert.ok(changed.every(row => row.updated_at !== '2026-10-01T00:00:00.000Z'));
}));
test('automatic gate ON plus current membership and an existing absence never enqueue from ad metadata or repeat the patch', () => rollback(async () => {
  await db.exec(`update sms_delivery_gates set auto_enabled=true where law_firm_id='${firm}';
    insert into sms_delivery_lead_epochs(law_firm_id,lead_id,epoch_id,relay_epoch,observed_at) select law_firm_id,id,'${epoch}','${relay}',now() from app_leads;`);
  await guardedBackfill();
  await guardedBackfill();
  assert.equal((await one('select count(*)::int n from sms_delivery_jobs')).n, 1);
  assert.equal((await one('select count(*)::int n from sms_delivery_trigger_errors')).n, 0);
}));
test('metadata-only updates do not adopt old leads into the automatic-delivery epoch', () => rollback(async () => {
  await db.exec(`update sms_delivery_gates set auto_enabled=true where law_firm_id='${firm}'`);
  await guardedBackfill();
  assert.equal((await one('select count(*)::int n from sms_delivery_lead_epochs')).n, 0);
}));
test('an existing orphan would be repaired by the real trigger; preservation assertion rolls the entire patch back', () => rollback(async () => {
  await db.exec("delete from app_cases where id='case-1'");
  const before = await q('select * from app_leads order by id');
  await assert.rejects(guardedBackfill, /linked entities/);
  assert.deepEqual(await q('select * from app_leads order by id'), before);
  assert.equal((await one("select count(*)::int n from app_cases where id='case-1'")).n, 0);
}));
test('mis-normalized historical phone is detected and rolls back every metadata update', () => rollback(async () => {
  await db.exec("update app_leads set phone_normalized='legacy-wrong' where id='fixture-2'");
  const before = await q('select * from app_leads order by id');
  await assert.rejects(guardedBackfill, /non-advertising/);
  assert.deepEqual(await q('select * from app_leads order by id'), before);
}));
test('Meta trigger is active: actual stage progression creates an event while metadata-only updates do not', () => rollback(async () => {
  assert.equal((await one('select count(*)::int n from meta_event_queue')).n, 0);
  await q("update app_leads set data=data||'{\"detailStage\":\"상담\"}'::jsonb where id='fixture-3'");
  assert.equal((await one('select count(*)::int n from meta_event_queue')).n, 1);
}));
test('attempt to change lineage across firms is rejected atomically', () => rollback(async () => {
  await db.exec(`insert into firm_meta_accounts values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${other}')`);
  await db.exec('savepoint foreign_lineage');
  await assert.rejects(() => q("update app_leads set meta_account_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id='fixture-1'"), /another law firm/);
  await db.exec('rollback to savepoint foreign_lineage');
  assert.equal((await one("select meta_account_id from app_leads where id='fixture-1'")).meta_account_id, meta);
}));


test('missing target rejects the entire batch before changing any remaining lead', () => rollback(async () => {
  await db.exec("delete from app_leads where id='fixture-3'");
  const before = await q('select * from app_leads order by id');
  const protectedBefore = await snapshot();
  await assert.rejects(guardedBackfill, /exact target count/);
  assert.deepEqual(await q('select * from app_leads order by id'), before);
  assert.deepEqual(await snapshot(), protectedBefore);
}));
