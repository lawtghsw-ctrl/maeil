// Full isolated existing-RLS fixture copied from writing-staff-sql.test.cjs.
// No production credentials, external providers or customer records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve(__dirname, '../../../sms-sql-check/node_modules/@electric-sql/pglite'));
const root = path.resolve(__dirname, '../..');
const sql = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const migration = sql('20261023091407_writing_staff_scope.sql').replaceAll('\r\n','\n');
const functionSql = (name, file) => {
  const match = sql(file).match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, name); return match[0];
};
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002', S = '10000000-0000-4000-8000-000000000003';
const actors = Object.fromEntries(['writer','normal','all','admin','inactive','suspended','legacy','basic'].map((key, i) => [key, `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
const tables = ['app_leads','app_clients','app_cases','app_installments','app_schedule_items','app_change_logs','app_board_posts'];
const basePerms = {'db.view':true,'db.edit_basic':true,'db.edit_consultation':true,'cases.view':true,'cases.manage_installments':true};
const dirtyWriterPerms = {...basePerms,'staff.writer':true,'db.create':true,'cases.delete':true,'cases.create':true,'cases.send_docs':true,'econtracts.create':true,'sms.view':true,'sms.send':true,'sms.manage_settings':true,'changes.view':true,'dashboard.schedule_calendar':true};

async function fixture() {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; grant usage on schema auth to anon,authenticated,service_role;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user) $$;
 create table public.law_firms(id uuid primary key,status text);
 create table public.profiles(id uuid primary key,law_firm_id uuid,role text,platform_role text,is_active boolean,permissions jsonb,staff_name text,display_name text,email text,is_work_staff boolean default true,auto_assign_leads boolean default false,lead_assignment_order integer default 1000,created_at timestamptz default now());
 create table public.firm_runtime_state(law_firm_id uuid,key text,value jsonb,updated_at timestamptz default now(),primary key(law_firm_id,key));
 create table public.app_lead_imports(external_key text,lead_id text,source text,sheet_name text,row_number integer,assigned_profile_id uuid,assigned_staff text,law_firm_id uuid,primary key(law_firm_id,external_key));
 create table public.app_settings(key text primary key,value jsonb,updated_at timestamptz);
 create table public.firm_settings(law_firm_id uuid,key text,value jsonb,updated_by uuid,updated_at timestamptz,primary key(law_firm_id,key));
 ${tables.map(t => `create table public.${t}(id text primary key,data jsonb not null,law_firm_id uuid not null,created_by uuid,updated_by uuid,created_at timestamptz default now(),updated_at timestamptz default now()); alter table public.${t} enable row level security;`).join('\n')}
 alter table app_leads add column ad_source_id uuid,add column meta_account_id uuid,add column meta_lead_id text,add column phone_normalized text;
 alter table public.profiles enable row level security; alter table public.firm_settings enable row level security;
 alter table public.app_settings enable row level security;
 grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
 grant select on all tables in schema public to anon;`);
 const multi = '006_multi_tenant_platform.sql';
 for (const name of ['current_law_firm_id','current_platform_role','is_super_admin','is_firm_admin','is_active_user','is_admin_user']) await db.exec(functionSql(name,multi));
 const second = sql('002_staff_accounts_permissions.sql');
 await db.exec(second.slice(second.indexOf('create or replace function public.current_staff_name()'), second.indexOf('-- profiles 변경을')));
 await db.exec(functionSql('has_permission',multi));
 await db.exec(functionSql('lawpower_normalize_consult_time','010_weekend_consult_time_search_fix.sql'));
 await db.exec(functionSql('import_tenant_google_sheet_lead','010_weekend_consult_time_search_fix.sql'));
 await db.exec(sql('013_staff_installment_finance_save_fix.sql'));
 await db.exec(sql('017_staff_save_reliability.sql'));
 await db.exec(sql('018_case_delete_permission.sql'));
 await db.exec(sql('021_converted_lead_direction_assignee_sync.sql'));
 await db.exec(functionSql('enforce_operational_link_tenant',multi));
 for (const t of tables) {
  await db.exec(`create policy ${t}_tenant_guard on public.${t} as restrictive for all to authenticated
    using(public.is_super_admin() or (public.is_active_user() and law_firm_id=public.current_law_firm_id()))
    with check(public.is_super_admin() or (public.is_active_user() and law_firm_id=public.current_law_firm_id()));`);
 }
 for (const t of ['app_cases','app_installments','app_schedule_items']) await db.exec(`create trigger link_tenant before insert or update on public.${t} for each row execute function public.enforce_operational_link_tenant();`);
 const settingsRead = sql(multi).match(/create policy firm_settings_read[\s\S]*?;/i)[0];
 await db.exec(settingsRead);
 await db.exec("drop policy app_settings_select_permissions on public.app_settings; drop policy app_settings_insert_permissions on public.app_settings; drop policy app_settings_update_permissions on public.app_settings; create policy app_settings_super_admin_only on public.app_settings for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());");
 // Row types are enough to compile the preserved provider function; no SMS
 // trigger is attached and no provider/job function can be called in this DB.
 await db.exec(['sms_delivery_gates','sms_automation_settings','sms_sender_numbers'].map(t=>`create table public.${t}(id uuid primary key)`).join(';'));
 const staffSms=sql('015_sms_staff_automation_images.sql');
 await db.exec(staffSms.slice(staffSms.indexOf('create table'),staffSms.indexOf('drop policy')));
 await db.exec(`create schema storage; grant usage on schema storage to authenticated,service_role;
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;
   grant select,insert,update,delete on storage.objects,public.sms_staff_automation_settings to authenticated,service_role;`);
 for(const name of ['sms_staff_auto_read','sms_staff_auto_manage','sms_media_read','sms_media_insert','sms_media_delete']) {
  await db.exec(sql('016_sms_permissions.sql').match(new RegExp(`create policy ${name}\\b[\\s\\S]*?;`,'i'))[0]);
 }
 // Preserve the actual provider enqueue function verbatim; never attach/call it.
 await db.exec(functionSql('enqueue_lead_auto_sms','20261018082353_sms_consult_time_variables.sql'));
 for (const [id,status] of [[A,'active'],[B,'active'],[S,'suspended']]) await db.query('insert into law_firms values($1,$2)',[id,status]);
 for (const [key,id] of Object.entries(actors)) {
  await db.query('insert into auth.users values($1)',[id]);
  const permissions = ['writer','inactive','suspended','legacy'].includes(key) ? dirtyWriterPerms : key==='all' ? {...basePerms,'db.view_all':true,'cases.view_all':true} : key==='admin' ? dirtyWriterPerms : key==='basic' ? {'cases.view':true,'cases.edit_basic':true} : basePerms;
  await db.query('insert into profiles(id,law_firm_id,role,platform_role,is_active,permissions,staff_name,display_name) values($1,$2,$3,$4,$5,$6,$7,$7)',[id,key==='suspended'?S:A,key==='admin'?'admin':'staff',key==='admin'?'firm_admin':key==='legacy'?null:'staff',key!=='inactive',permissions,'SELF']);
 }
 const insert = (table,id,data,firm=A) => db.query(`insert into ${table}(id,data,law_firm_id) values($1,$2,$3)`,[id,{id,...data},firm]);
 await insert('app_leads','work',{detailStage:'1차 서류미비',status:'서류검토중',assignedStaff:'OTHER',convertedClientId:'client-work',convertedCaseId:'case-work',name:'가상',phone:''});
 await insert('app_leads','consult',{detailStage:'상담',status:'상담완료',assignedStaff:'SELF',convertedClientId:'client-consult',convertedCaseId:'case-consult'});
 await insert('app_leads','free',{detailStage:'착수금착수',status:'계약진행중',assignedStaff:'SELF'});
 await insert('app_leads','foreign',{detailStage:'착수금착수',assignedStaff:'SELF'},B);
 for (const id of ['work','consult']) {
  await insert('app_clients',`client-${id}`,{fromLeadId:id,assignedStaff:id==='work'?'OTHER':'SELF',name:'가상'});
  await insert('app_cases',`case-${id}`,{clientId:`client-${id}`,fromLeadId:id,assignedStaff:id==='work'?'OTHER':'SELF',contractAmount:1000,paidAmount:0,stage:'착수',memo:''});
  await insert('app_installments',`inst-${id}`,{caseId:`case-${id}`,amount:1000,paid:false});
 }
 await insert('app_clients','client-foreign',{fromLeadId:'foreign',assignedStaff:'SELF'},B);
 await insert('app_cases','case-foreign',{clientId:'client-foreign',fromLeadId:'foreign',assignedStaff:'SELF'},B);
 await insert('app_installments','inst-foreign',{caseId:'case-foreign'},B);
 await insert('app_schedule_items','schedule',{caseId:'case-work'});
 await insert('app_board_posts','board',{title:'가상 게시글'});
 await insert('app_change_logs','log',{staff:'SELF'});
 await db.query('insert into firm_settings values($1,$2,$3,null,null),($1,$4,$5,null,null)',[A,'min_living_cost',{amount:1},'case_documents',{secret:'synthetic'}]);
 // Install production conversion/sync and metadata after synthetic seed rows.
 const conversion = sql('012_db_convert_orphan_repair.sql');
 await db.exec(functionSql('ensure_converted_lead_records','012_db_convert_orphan_repair.sql'));
 await db.exec(conversion.slice(conversion.indexOf('drop trigger if exists'),conversion.indexOf('-- 기존에 이미 converted ID')));
 await db.exec(sql('20261018003418_crm_feedback_fields.sql'));
 await db.exec(functionSql('sync_lead_search_columns',multi));
 await db.exec('create trigger trg_app_leads_search_columns before insert or update of data on app_leads for each row execute function public.sync_lead_search_columns();');
 await db.exec(sql('20261021034000_customer_phone_edit.sql'));
 await db.exec(sql('20261021053916_sms_own_automation_settings.sql'));
 return db;
}
async function actor(db,key,fn) {
 await db.exec('begin; set local role authenticated;');
 await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors[key]]);
 try { return await fn(); } finally { await db.exec('rollback'); }
}
async function denied(db,query,params=[],pattern=/row-level security|권한|IMMUTABLE|law firm/) {
 await db.exec('savepoint denied');
 try { await assert.rejects(db.query(query,params),pattern); } finally { await db.exec('rollback to savepoint denied; release savepoint denied'); }
}
async function snapshot(db) {
 const result={};
 for (const t of [...tables,'profiles','firm_settings','firm_runtime_state','app_lead_imports','sms_staff_automation_settings','storage.objects']) result[t]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') rows from ${t} t`)).rows[0].rows;
 return result;
}
async function ids(db,table) {return (await db.query(`select id from ${table} order by id`)).rows.map(row=>row.id);}


module.exports = { fixture, actor, denied, snapshot, ids, actors, A, B, S, sql, migration };
