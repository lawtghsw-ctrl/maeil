// Offline PostgreSQL fixture. This module has no Supabase/network client.
// The surrounding schema/auth helpers are synthetic; trigger bodies and SMS DDL
// are loaded verbatim from repository migrations, without running old backfills.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const { PGlite } = require(path.resolve(root, '../sms-sql-check/node_modules/@electric-sql/pglite'));
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
}).outputText, file);
const { buildSalesDemo } = require('../../lib/demo/sales-demo.ts');
const { summarizeFirmSupply } = require('../../lib/firm-reporting.ts');
const read = file => fs.readFileSync(path.join(root, 'supabase', file), 'utf8');
function functionSql(name, file) {
  const match = read(file).match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `Missing repository function ${name}`);
  return match[0];
}
const entityTables = ['app_leads', 'app_clients', 'app_cases', 'app_installments', 'app_schedule_items', 'app_board_posts', 'app_change_logs'];
const inertTables = ['sms_sender_numbers', 'sms_templates', 'sms_automation_settings', 'sms_staff_automation_settings',
  'sms_outbox', 'sms_delivery_gates', 'sms_delivery_jobs', 'sms_delivery_requests', 'sms_delivery_lead_epochs',
  'sms_delivery_trigger_errors', 'meta_event_queue', 'meta_event_logs', 'app_lead_imports', 'firm_meta_event_rules', 'ad_sources', 'firm_meta_accounts'];

async function createScaledDemoFixture(options = {}) {
  const firmId = options.firmId ?? '11111111-1111-4111-8111-111111111111';
  const otherFirmId = '22222222-2222-4222-8222-222222222222';
  const actorId = options.actorId ?? '33333333-3333-4333-8333-333333333333';
  const metaId = '44444444-4444-4444-8444-444444444444';
  const sourceId = '44444444-4444-4444-8444-444444444445';
  const senderId = '55555555-5555-4555-8555-555555555555';
  const epochId = '66666666-6666-4666-8666-666666666666';
  const relayId = '77777777-7777-4777-8777-777777777777';
  const requestId = '88888888-8888-4888-8888-888888888888';
  const seedDate = options.seedDate ?? '2026-10-18';
  const legacy = options.legacy ?? buildSalesDemo(firmId, seedDate);
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  async function rows(table) { return q(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`); }
  async function snapshot() {
    const result = {};
    for (const table of inertTables) result[table] = await rows(table);
    return result;
  }
  const originalIds = {};
  async function originalSnapshot() {
    const result = {};
    for (const table of entityTables) result[table] = await q(`select to_jsonb(t) as row from public.${table} t where id=any($1::text[]) order by id`, [originalIds[table] ?? []]);
    result.oldSettings = await q("select to_jsonb(t) as row from firm_settings t where key in ('sales_demo_seed_v1','existing_fixture_setting') order by law_firm_id,key");
    return result;
  }
  async function insertEntity(table, data, targetFirm = firmId) {
    return q(`insert into public.${table}(id,law_firm_id,data) values($1,$2,$3) returning *`, [data.id, targetFirm, data]);
  }
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
      create table law_firms(id uuid primary key,firm_code char(10) not null,name text not null,status text not null default 'active',
        representative_name text,business_number text,phone text,is_legacy_default boolean not null default false,duplicate_window_days integer not null default 30,
        lead_unit_price bigint not null default 0,billing_type text not null default 'per_lead',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
      create table profiles(id uuid primary key references auth.users(id),law_firm_id uuid references law_firms(id),platform_role text,role text,
        email text,display_name text,staff_name text,is_active boolean,is_work_staff boolean default true,auto_assign_leads boolean default false,
        permissions jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
      create table firm_settings(law_firm_id uuid references law_firms(id),key text,value jsonb,updated_by uuid references auth.users(id),updated_at timestamptz default now(),primary key(law_firm_id,key));
      create table firm_meta_accounts(id uuid primary key,law_firm_id uuid references law_firms(id));
      create table ad_sources(id uuid primary key,law_firm_id uuid references law_firms(id),meta_account_id uuid references firm_meta_accounts(id));
      create table firm_meta_event_rules(law_firm_id uuid,enabled boolean,trigger_type text,trigger_value text,event_name text);
      create table meta_event_queue(id uuid primary key,law_firm_id uuid,lead_id text,ad_source_id uuid,meta_account_id uuid,event_name text,event_id text,crm_status text,crm_stage text,event_time timestamptz,quality_group text);
      create table meta_event_logs(id uuid primary key,payload jsonb);
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(id uuid primary key,name text,bucket_id text);
      create function public.is_active_user() returns boolean language sql as $$select true$$;
      create function public.is_super_admin() returns boolean language sql as $$select true$$;
      create function public.is_firm_admin() returns boolean language sql as $$select true$$;
      create function public.is_admin_user() returns boolean language sql as $$select true$$;
      create function public.current_law_firm_id() returns uuid language sql as $$select '${firmId}'::uuid$$;
      create function public.has_permission(k text) returns boolean language sql as $$select true$$;
      create function public.has_any_permission(k text[]) returns boolean language sql as $$select true$$;
      insert into law_firms(id,firm_code,name,status,representative_name) values('${firmId}','0000000000','TEST','active','영업 시연용 · 가상 데이터'),('${otherFirmId}','2222222222','Other fixture','active','Other');
      insert into auth.users values('${actorId}');
      insert into profiles(id,law_firm_id,platform_role,role,display_name,staff_name,is_active,is_work_staff) values('${actorId}',null,'super_admin','admin','Fixture admin','Fixture admin',true,false);
      insert into firm_meta_accounts values('${metaId}','${firmId}');
      insert into ad_sources values('${sourceId}','${firmId}','${metaId}');
      insert into firm_meta_event_rules values('${firmId}',true,'detail_stage','상담','Lead'),('${firmId}',true,'status','수임전환','Lead'),('${firmId}',true,'status','부재중','Contact');
      insert into meta_event_logs values(gen_random_uuid(),'{"original":"keep"}');
      insert into firm_settings(law_firm_id,key,value) values('${firmId}','sales_demo_seed_v1','{"version":1,"phase":"ready","kind":"lawpower_sales_demo_v1"}'),('${otherFirmId}','existing_fixture_setting','{"original":"keep"}');
    `);
    for (let index = 1; index <= 6; index++) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
      await q('insert into auth.users values($1)', [id]);
      await q("insert into profiles(id,law_firm_id,platform_role,role,display_name,staff_name,is_active,is_work_staff) values($1,$2,'staff','staff',$3,$3,true,true)", [id, firmId, `TEST${index}`]);
    }
    for (const table of entityTables) await db.exec(`create table public.${table}(id text primary key,law_firm_id uuid not null references law_firms(id),data jsonb not null,created_by uuid default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now())`);
    await db.exec(`alter table app_leads add column phone_normalized text,add column ad_source_id uuid references ad_sources(id),add column meta_account_id uuid references firm_meta_accounts(id),add column meta_lead_id text;
      create unique index lead_meta_unique on app_leads(law_firm_id,meta_lead_id) where nullif(meta_lead_id,'') is not null;
      create table app_lead_imports(id uuid primary key default gen_random_uuid(),law_firm_id uuid references law_firms(id),external_key text not null,lead_id text references app_leads(id),classification text,imported_at timestamptz default now());`);
    const initial = { app_leads: legacy.leads, app_clients: legacy.clients, app_cases: legacy.cases, app_installments: legacy.installments,
      app_schedule_items: legacy.schedules, app_board_posts: legacy.posts, app_change_logs: [] };
    for (const table of entityTables) {
      if (options.existingRows?.[table]) {
        const allowed = new Set(['id', 'law_firm_id', 'data', 'created_by', 'created_at', 'updated_at',
          ...(table === 'app_leads' ? ['phone_normalized', 'ad_source_id', 'meta_account_id', 'meta_lead_id'] : [])]);
        for (const row of options.existingRows[table]) {
          assert.equal(row.law_firm_id, firmId, 'Captured original must belong to fixture firm');
          assert.ok(Object.keys(row).every(key => allowed.has(key)), 'Unexpected captured entity column');
          if (row.created_by) await q('insert into auth.users values($1) on conflict do nothing', [row.created_by]);
          const keys = Object.keys(row);
          await q(`insert into ${table}(${keys.join(',')}) values(${keys.map((_, index) => `$${index + 1}`).join(',')})`, keys.map(key => row[key]));
        }
      } else for (const data of initial[table] ?? []) await insertEntity(table, data);
      await insertEntity(table, { id: `OTHER-${table}`, name: 'Other fixture', memo: 'must remain unchanged' }, otherFirmId);
      originalIds[table] = (await q(`select id from ${table} order by id`)).map(row => row.id);
    }
    // Only DDL/function/trigger section; never execute 006's historical backfill.
    const platformSql = read('migrations/006_multi_tenant_platform.sql');
    await db.exec(platformSql.slice(platformSql.indexOf('create table if not exists public.lead_supply_ledger'), platformSql.indexOf('-- Historical imports are retained')));
    const operations = read('migrations/20261018002334_platform_operations.sql');
    await db.exec(operations.slice(0, operations.indexOf('-- One transactional command endpoint.')));
    await db.exec(`insert into platform_firm_commercial_profiles(law_firm_id,service_mode) values('${otherFirmId}','crm_only');
      insert into lead_supply_ledger(law_firm_id,external_key,lead_id,classification,billable,unit_price_snapshot,origin,supplied_at)
      values('${otherFirmId}','other-original','OTHER-app_leads','new',true,12345,'manual','2026-10-01T01:00:00Z');`);
    for (const file of ['014_sms_center_foundation.sql', '015_sms_staff_automation_images.sql', '016_sms_permissions.sql',
      '20261017133745_sms_delivery_epoch_jobs.sql', '20261018082353_sms_consult_time_variables.sql']) await db.exec(read(`migrations/${file}`));
    await db.exec(`
      insert into sms_sender_numbers(id,law_firm_id,staff_name,phone,is_registered,is_default) values('${senderId}','${firmId}','TEST1','01011112222',true,true);
      update sms_automation_settings set new_lead_enabled=true,absence_enabled=true,new_lead_template='hello',absence_template='hello' where law_firm_id='${firmId}';
      insert into sms_staff_automation_settings(law_firm_id,staff_name,sender_number_id,new_lead_enabled,absence_enabled,new_lead_template,absence_template) values('${firmId}','TEST1','${senderId}',true,true,'hello','hello');
      insert into sms_delivery_gates(law_firm_id,manual_enabled,auto_enabled,epoch_id,relay_epoch,activated_at) values('${firmId}',true,true,'${epochId}','${relayId}','2000-01-01');
      insert into sms_delivery_requests(law_firm_id,request_id,actor_id,payload_hash) values('${firmId}','${requestId}','${actorId}',decode('1234','hex'));
      insert into sms_outbox(id,law_firm_id,lead_id,sender_number,receiver_number,message,status) values('99999999-9999-4999-8999-999999999991','${firmId}',null,'01011112222','01000000001','legacy pending','pending_api'),('99999999-9999-4999-8999-999999999992','${firmId}',null,'01011112222','01000000002','existing queued','queued');
      insert into sms_delivery_jobs(law_firm_id,outbox_id,epoch_id,relay_epoch,request_id,recipient_index,source,sender_number_id,sender_number,receiver_number,message,msg_type,available_at,expires_at)
      values('${firmId}','99999999-9999-4999-8999-999999999992','${epochId}','${relayId}','${requestId}',1,'manual','${senderId}','01011112222','01000000002','existing queued','SMS',now(),now()+interval '1 day');
    `);
    const functions = [
      ['attach_current_firm', 'migrations/006_multi_tenant_platform.sql'],
      ['touch_updated_at', 'migrations/001_initial.sql'],
      ['lawpower_normalize_debt_range', 'V28_6_1_PIVOT_FIX.sql'], ['lawpower_normalize_income_range', 'V28_6_1_PIVOT_FIX.sql'],
      ['lawpower_normalize_consult_time', 'migrations/010_weekend_consult_time_search_fix.sql'],
      ['normalize_app_lead_pivot_fields', 'migrations/010_weekend_consult_time_search_fix.sql'],
      ['sync_lead_search_columns', 'migrations/006_multi_tenant_platform.sql'],
      ['enforce_lead_lineage_tenant_consistency', 'migrations/006_multi_tenant_platform.sql'],
      ['enforce_operational_link_tenant', 'migrations/011_db_convert_race_fix.sql'],
      ['enforce_lead_update_permissions', 'migrations/018_case_delete_permission.sql'],
      ['enforce_case_update_permissions', 'migrations/013_staff_installment_finance_save_fix.sql'],
      ['ensure_converted_lead_records', 'migrations/012_db_convert_orphan_repair.sql'],
      ['sync_converted_lead_core_fields', 'migrations/021_converted_lead_direction_assignee_sync.sql'],
      ['meta_crm_stage_signal_group', 'migrations/007_meta_crm_optimization.sql'],
      ['enqueue_meta_events_for_lead', 'migrations/007_meta_crm_optimization.sql'],
      ['enqueue_meta_event_for_contract', 'migrations/007_meta_crm_optimization.sql'],
    ];
    for (const [name, file] of functions) await db.exec(functionSql(name, file));
    await db.exec(read('migrations/20261018003418_crm_feedback_fields.sql'));
    for (const table of entityTables) await db.exec(`create trigger trg_${table}_attach_firm before insert on ${table} for each row execute function attach_current_firm();create trigger trg_${table}_updated_at before update on ${table} for each row execute function touch_updated_at()`);
    for (const table of ['app_cases', 'app_installments', 'app_schedule_items']) await db.exec(`create trigger trg_${table}_tenant_links before insert or update on ${table} for each row execute function enforce_operational_link_tenant()`);
    await db.exec(`
      create trigger trg_app_leads_normalize_pivot before insert or update of data on app_leads for each row execute function normalize_app_lead_pivot_fields();
      create trigger trg_app_leads_permissions before update on app_leads for each row execute function enforce_lead_update_permissions();
      create trigger trg_app_cases_permissions before update on app_cases for each row execute function enforce_case_update_permissions();
      create trigger trg_app_leads_search_columns before insert or update of data on app_leads for each row execute function sync_lead_search_columns();
      create trigger trg_app_leads_lineage_tenant before insert or update of law_firm_id,ad_source_id,meta_account_id on app_leads for each row execute function enforce_lead_lineage_tenant_consistency();
      create trigger trg_app_leads_meta_queue after update of data on app_leads for each row execute function enqueue_meta_events_for_lead();
      create trigger trg_app_leads_ensure_converted_records after insert or update of data on app_leads for each row when(nullif(new.data->>'convertedClientId','') is not null and nullif(new.data->>'convertedCaseId','') is not null) execute function ensure_converted_lead_records();
      create trigger trg_sync_converted_lead_core_fields after update of data on app_leads for each row when(old.data->'name' is distinct from new.data->'name' or old.data->'applicationType' is distinct from new.data->'applicationType' or old.data->'assignedStaff' is distinct from new.data->'assignedStaff') execute function sync_converted_lead_core_fields();
      create trigger trg_app_cases_meta_contract_queue after insert or update of data on app_cases for each row execute function enqueue_meta_event_for_contract();
    `);
    // Optional one-off local capture, supplied explicitly by an offline runner.
    // No committed test depends on a production export or a real identifier.
    if (options.triggerDefinitions) {
      for (const trigger of options.triggerDefinitions) {
        assert.match(trigger.name, /^[a-z_][a-z0-9_]*$/);
        assert.ok([...entityTables, 'lead_supply_ledger'].includes(trigger.table));
        assert.match(trigger.function, /^CREATE OR REPLACE FUNCTION public\.[a-z_]+\(\)/i);
        assert.match(trigger.definition, /^CREATE TRIGGER /);
        await db.exec(`${trigger.function};`);
        await db.exec(`drop trigger if exists ${trigger.name} on public.${trigger.table};${trigger.definition};`);
      }
    }
    async function report() {
      const toEntity = row => ({ ...row.data, id: row.id, _lawFirmId: row.law_firm_id });
      // PGlite returns native Date objects; the production PostgREST adapter
      // receives ISO strings. Match that API boundary before using the model.
      const ledger = (await q('select * from lead_supply_ledger where law_firm_id=$1', [firmId]))
        .map(row => ({ ...row, supplied_at: row.supplied_at instanceof Date ? row.supplied_at.toISOString() : row.supplied_at }));
      const leads = (await q('select * from app_leads where law_firm_id=$1', [firmId])).map(toEntity);
      const cases = (await q('select * from app_cases where law_firm_id=$1', [firmId])).map(toEntity);
      const monthEnd = new Date(Date.UTC(Number(seedDate.slice(0, 4)), Number(seedDate.slice(5, 7)), 0)).toISOString().slice(0, 10);
      return summarizeFirmSupply(firmId, `${seedDate.slice(0, 7)}-01`, monthEnd, ledger, [], 0, cases, seedDate, leads, ['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5', 'TEST6']);
    }
    // A test-only transaction demonstrating the order. Root's final production
    // script can instead be passed unchanged to fixture.db.exec(sql).
    async function applyPlan(plan, { rollback = false } = {}) {
      await db.exec('begin isolation level repeatable read');
      try {
        const target = await one('select * from law_firms where id=$1 for update', [firmId]);
        assert.ok(target?.firm_code === '0000000000' && target.name === 'TEST', 'RESERVED_DEMO_REQUIRED');
        assert.equal(plan.seed.firmId, firmId, 'DEMO_TENANT_MISMATCH');
        assert.equal((await one("select count(*)::int n from firm_settings where law_firm_id=$1 and key=$2", [firmId, `scaled_demo_fixture:${plan.seed.batchKey}`])).n, 0, 'DEMO_BATCH_ALREADY_EXISTS');
        assert.equal((await one('select count(*)::int n from app_leads where law_firm_id=$1', [firmId])).n, 12, 'DEMO_BASELINE_CHANGED');
        assert.equal((await one('select count(*)::int n from app_cases where law_firm_id=$1', [firmId])).n, 4, 'DEMO_BASELINE_CHANGED');
        const inertBefore = await snapshot(), originalBefore = await originalSnapshot();
        const withOwner = data => ({ ...data, salesDemoSeed: plan.seed });
        for (const lead of plan.leads) {
          const { convertedClientId, convertedCaseId, ...base } = lead;
          await insertEntity('app_leads', withOwner(base));
        }
        for (const [table, data] of [['app_clients', plan.clients], ['app_cases', plan.cases], ['app_installments', plan.installments], ['app_schedule_items', plan.schedules]]) {
          for (const row of data) await insertEntity(table, withOwner(row));
        }
        for (const lead of plan.leads.filter(row => row.convertedCaseId)) {
          const result = await q("update app_leads set data=data||$3::jsonb where id=$1 and law_firm_id=$2 and data->'salesDemoSeed'=$4::jsonb and not(data?'convertedCaseId') and not(data?'convertedClientId') returning id",
            [lead.id, firmId, { convertedClientId: lead.convertedClientId, convertedCaseId: lead.convertedCaseId }, plan.seed]);
          assert.equal(result.length, 1, 'DEMO_POINTER_CAS_FAILED');
        }
        for (const lead of [...legacy.leads, ...plan.leads]) {
          await q("insert into lead_supply_ledger(law_firm_id,external_key,lead_id,classification,billable,billing_type,unit_price_snapshot,origin,supplied_at) values($1,$2,$3,'new',true,'per_lead',50000,'manual',$4)",
            [firmId, `${plan.seed.kind}:${plan.seed.batchKey}:${lead.id}`, lead.id, lead.receivedAt]);
        }
        await q("insert into platform_firm_commercial_profiles(law_firm_id,service_mode) values($1,'db_supply')", [firmId]);
        await q('insert into firm_settings(law_firm_id,key,value) values($1,$2,$3)', [firmId, `scaled_demo_fixture:${plan.seed.batchKey}`, { ...plan.seed, phase: 'ready', summary: plan.summary }]);
        assert.deepEqual(await snapshot(), inertBefore, 'SMS_META_IMPORT_STATE_CHANGED');
        assert.deepEqual(await originalSnapshot(), originalBefore, 'ORIGINAL_DATA_CHANGED');
        const result = await report();
        assert.equal(result.supplyCohort.supplied, 500); assert.equal(result.supplyCohort.retained, 90);
        assert.equal(result.supplyCohort.conversionRate, 18); assert.equal(result.purchaseCost, 25000000);
        await db.exec(rollback ? 'rollback' : 'commit');
        return result;
      } catch (error) { await db.exec('rollback'); throw error; }
    }
    return { db, q, one, rows, snapshot, originalSnapshot, originalIds, insertEntity, report, applyPlan, legacy,
      firmId, otherFirmId, actorId, metaId, sourceId, senderId, epochId, relayId, seedDate };
  } catch (error) { await db.close(); throw error; }
}
module.exports = { createScaledDemoFixture, functionSql, root, inertTables, entityTables };
