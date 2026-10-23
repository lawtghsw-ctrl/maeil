const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve(__dirname, '../../sms-sql-check/node_modules/@electric-sql/pglite'));
const root = path.resolve(__dirname, '..');
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

test('writing-staff migration: actual existing RLS/permission/conversion triggers in isolated PostgreSQL', async t => {
 const db=await fixture();
 try {
  const before=await snapshot(db);
  const smsBefore=(await db.query("select pg_get_functiondef('public.enqueue_lead_auto_sms()'::regprocedure) definition")).rows[0].definition;
  const currentHelpers=['public.sync_converted_lead_phone_to_client()','public.update_client_phone(text,text)','public.sms_is_own_automation(uuid,uuid,text)','public.enforce_sms_own_automation()'];
  const helperBefore=await Promise.all(currentHelpers.map(async signature=>(await db.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition));
  const baseline={};
  for (const key of ['normal','all','admin']) baseline[key]=await actor(db,key,async()=>({leads:await ids(db,'app_leads'),cases:await ids(db,'app_cases'),clients:await ids(db,'app_clients'),installments:await ids(db,'app_installments')}));
  await db.exec(migration);
  await t.test('DDL only: all original rows and existing SMS function unchanged',async()=>{
   assert.deepEqual(await snapshot(db),before);
   assert.equal((await db.query("select pg_get_functiondef('public.enqueue_lead_auto_sms()'::regprocedure) definition")).rows[0].definition,smsBefore);
   assert.deepEqual(await Promise.all(currentHelpers.map(async signature=>(await db.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition)),helperBefore);
  });
  await t.test('stage allowlist matches every TS track; null fallback only; malformed values denied',async()=>{
   const ts=require('typescript'); const Module=require('node:module');
   const mod=new Module(path.join(root,'lib/types.ts')); mod.filename=path.join(root,'lib/types.ts'); mod.paths=module.paths;
   mod._compile(ts.transpileModule(fs.readFileSync(mod.filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,mod.filename);
   for(const [stage,track] of Object.entries(mod.exports.DB_DETAIL_STAGE_TRACK_OF)) {
    const actual=(await db.query('select public.is_writing_lead_data($1) ok',[{detailStage:stage,status:'수임전환'}])).rows[0].ok;
    assert.equal(actual,track!=='상담',stage);
   }
   for(const [status,stage] of Object.entries(mod.exports.DB_LEAD_DEFAULT_STAGE_BY_STATUS)) for(const value of [{status},{status,detailStage:null}]) {
    assert.equal((await db.query('select public.is_writing_lead_data($1) ok',[value])).rows[0].ok,mod.exports.DB_DETAIL_STAGE_TRACK_OF[stage]!=='상담',status);
   }
   for(const detailStage of ['', 'unknown',42,true,{},[]]) assert.equal((await db.query('select public.is_writing_lead_data($1) ok',[{detailStage,status:'수임전환'}])).rows[0].ok,false);
  });
  await t.test('writer fixed permissions mask stale create/delete/SMS/docs bits without rewriting them',()=>actor(db,'writer',async()=>{
   for(const key of ['db.create','cases.create','cases.delete','cases.send_docs','sms.send','changes.view','dashboard.schedule_calendar']) assert.equal((await db.query('select public.has_permission($1) ok',[key])).rows[0].ok,false,key);
   for(const key of ['db.view_all','db.convert','cases.edit_basic','cases.manage_installments']) assert.equal((await db.query('select public.has_permission($1) ok',[key])).rows[0].ok,true,key);
   const ts=require('typescript'); const Module=require('node:module');
   const mod=new Module(path.join(root,'lib/permissions.ts')); mod.filename=path.join(root,'lib/permissions.ts');mod.paths=module.paths;
   mod._compile(ts.transpileModule(fs.readFileSync(mod.filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,mod.filename);
   for(const key of mod.exports.ALL_PERMISSION_KEYS) assert.equal((await db.query('select public.has_permission($1) ok',[key])).rows[0].ok,mod.exports.WRITING_STAFF_PERMISSIONS[key]===true,key);
  }));
  await t.test('writer sees post-consultation of all assignees; not own consultation or another tenant',()=>actor(db,'writer',async()=>{
   assert.deepEqual(await ids(db,'app_leads'),['free','work']);
   assert.deepEqual(await ids(db,'app_clients'),['client-work']);
   assert.deepEqual(await ids(db,'app_cases'),['case-work']);
   assert.deepEqual(await ids(db,'app_installments'),['inst-work']);
   assert.equal((await db.query("select public.can_access_case_id('case-consult') a,public.can_access_case_id('case-foreign') b, public.can_access_client_id('client-foreign') c")).rows[0].a,false);
   assert.deepEqual((await db.query("select public.can_access_case_id('case-foreign') a,writing_staff_private.lead_allowed('foreign',$1) b",[B])).rows[0],{a:false,b:false});
  }));
  await t.test('normal self/all staff and flagged administrator keep identical row scopes',async()=>{
   for(const key of ['normal','all','admin']) assert.deepEqual(await actor(db,key,async()=>({leads:await ids(db,'app_leads'),cases:await ids(db,'app_cases'),clients:await ids(db,'app_clients'),installments:await ids(db,'app_installments')})),baseline[key],key);
  });
  await t.test('legacy platform-null staff receives writer scope; inactive/suspended receive no rows',async()=>{
   assert.deepEqual(await actor(db,'legacy',()=>ids(db,'app_leads')),['free','work']);
   for(const key of ['inactive','suspended']) assert.deepEqual(await actor(db,key,()=>ids(db,'app_leads')),[]);
  });
  await t.test('writer basic/consultation/assignee edits allowed, old and new consultation stages blocked',()=>actor(db,'writer',async()=>{
   assert.equal((await db.query("update app_leads set data=data||'{\"memo\":\"new\",\"consultation\":{\"memoLog\":[]}}' where id='free' returning id")).rows.length,1);
   assert.equal((await db.query("update app_leads set data=data||'{\"assignedStaff\":\"OTHER\"}' where id='free' returning id")).rows.length,1);
   await denied(db,"update app_leads set data=data||'{\"detailStage\":\"상담\"}' where id='free'");
   assert.equal((await db.query("update app_leads set data=data||'{\"detailStage\":\"법원접수\"}' where id='consult' returning id")).rows.length,0);
  }));
  await t.test('lead identity and arbitrary pointer hijacking rejected before existing sync can mutate targets',()=>actor(db,'writer',async()=>{
   await denied(db,"update app_leads set id='new-id' where id='free'");
   await denied(db,"update app_leads set data=data||'{\"id\":\"new-id\"}' where id='free'");
   await denied(db,'update app_leads set law_firm_id=$1 where id=\'free\'',[B]);
   await denied(db,"update app_leads set data=data||'{\"name\":\"hijack\",\"convertedClientId\":\"client-consult\",\"convertedCaseId\":\"case-consult\"}' where id='free'");
   await denied(db,"update app_leads set data=data||'{\"convertedClientId\":\"client-foreign\",\"convertedCaseId\":\"case-foreign\"}' where id='free'");
  }));
  await t.test('writer manual lead/client/case creation and lead/case deletion are denied',()=>actor(db,'writer',async()=>{
   await denied(db,'insert into app_leads(id,data,law_firm_id) values($1,$2,$3)',['new',{detailStage:'법원접수'},A]);
   await denied(db,'insert into app_clients(id,data,law_firm_id) values($1,$2,$3)',['new-client',{},A]);
   await denied(db,'insert into app_cases(id,data,law_firm_id) values($1,$2,$3)',['new-case',{clientId:'client-work'},A]);
   assert.equal((await db.query("delete from app_leads where id='free' returning id")).rows.length,0);
   assert.equal((await db.query("delete from app_cases where id='case-work' returning id")).rows.length,0);
   await denied(db,"select public.delete_case_with_relations('case-work')");
  }));
  await t.test('normal db.convert new IDs still trigger atomic client/case repair and remain visible',()=>actor(db,'writer',async()=>{
   await db.query("update app_leads set data=data||'{\"convertedClientId\":\"converted-client\",\"convertedCaseId\":\"converted-case\",\"status\":\"수임전환\"}' where id='free'");
   assert.ok((await ids(db,'app_clients')).includes('converted-client'));
   assert.ok((await ids(db,'app_cases')).includes('converted-case'));
   assert.equal((await db.query("select data->>'fromLeadId' lead from app_cases where id='converted-case'")).rows[0].lead,'free');
   await db.query("update app_leads set data=data||'{\"name\":\"가상 변경\",\"assignedStaff\":\"NEXT\",\"applicationType\":\"개인파산\"}' where id='free'");
   assert.equal((await db.query("select data->>'assignedStaff' staff from app_cases where id='converted-case'")).rows[0].staff,'NEXT');
  }));
  await t.test('explicit db conversion inserts accepted only from an allowed lead and matching customer',()=>actor(db,'writer',async()=>{
   await db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)',['explicit-client',{fromLeadId:'free'},A]);
   await db.query('insert into app_cases(id,data,law_firm_id) values($1,$2,$3)',['explicit-case',{clientId:'explicit-client',fromLeadId:'free'},A]);
   await denied(db,'insert into app_clients(id,data,law_firm_id) values($1,$2,$3)',['denied-client',{fromLeadId:'consult'},A]);
   await denied(db,'insert into app_cases(id,data,law_firm_id) values($1,$2,$3)',['denied-case',{clientId:'client-consult',fromLeadId:'free'},A]);
  }));
  await t.test('writer cannot directly edit clients; lead-sync remains the existing authorized path',()=>actor(db,'writer',async()=>{
   assert.equal((await db.query("update app_clients set data=data||'{\"name\":\"x\"}' where id='client-work' returning id")).rows.length,0);
  }));
  await t.test('latest phone trigger: writer edits allowed lead and its single linked customer, preserving contract fields',()=>actor(db,'writer',async()=>{
   const contractBefore=(await db.query("select data from app_cases where id='case-work'")).rows[0].data;
   await db.query("update app_leads set data=data||'{\"phone\":\" 000-0000-0000 \"}' where id='work'");
   assert.deepEqual((await db.query("select data->>'phone' phone,phone_normalized from app_leads where id='work'")).rows[0],{phone:'000-0000-0000',phone_normalized:'00000000000'});
   assert.equal((await db.query("select data->>'phone' phone from app_clients where id='client-work'")).rows[0].phone,'000-0000-0000');
   assert.deepEqual((await db.query("select data from app_cases where id='case-work'")).rows[0].data,contractBefore);
  }));
  await t.test('latest phone trigger cannot edit consultation/foreign lead or delegate administrator RPC as writer',()=>actor(db,'writer',async()=>{
   for(const id of ['consult','foreign']) assert.equal((await db.query("update app_leads set data=data||'{\"phone\":\"00000000000\"}' where id=$1 returning id",[id])).rows.length,0);
   await denied(db,"select public.update_client_phone('client-work','00000000000')",[],/활성 관리자만/);
  }));
  await t.test('later writer WITH CHECK failure rolls back the phone BEFORE-trigger customer write',()=>actor(db,'writer',async()=>{
   const leadBefore=(await db.query("select data from app_leads where id='work'")).rows[0].data;
   const clientBefore=(await db.query("select data from app_clients where id='client-work'")).rows[0].data;
   await denied(db,"update app_leads set data=data||'{\"phone\":\"00000000000\",\"detailStage\":\"상담\"}' where id='work'");
   assert.deepEqual((await db.query("select data from app_leads where id='work'")).rows[0].data,leadBefore);
   assert.deepEqual((await db.query("select data from app_clients where id='client-work'")).rows[0].data,clientBefore);
  }));
  await t.test('phone plus linkage edit is rejected atomically; original phone validation remains strict',()=>actor(db,'writer',async()=>{
   await denied(db,"update app_leads set data=data||'{\"phone\":\"00000000000\",\"convertedClientId\":\"client-consult\"}' where id='work'",[],/동시에 변경할 수 없습니다/);
   for(const phone of ['', 'bad value', '12']) await denied(db,"update app_leads set data=jsonb_set(data,'{phone}',to_jsonb($1::text)) where id='free'",[phone],/숫자 8~15자리/);
  }));
  await t.test('phone sync counts hidden consultation backlinks and refuses ambiguous customer',async()=>{
   await db.exec('begin');
   try {
    await db.query('insert into app_leads(id,data,law_firm_id) values($1,$2,$3)',['phone-hidden',{detailStage:'상담',convertedClientId:'client-work'},A]);
    const clientBefore=(await db.query("select data from app_clients where id='client-work'")).rows[0].data;
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.writer]);
    await denied(db,"update app_leads set data=data||'{\"phone\":\"00000000000\"}' where id='work'",[],/고객을 확인할 수 없어/);
    assert.deepEqual((await db.query("select data from app_clients where id='client-work'")).rows[0].data,clientBefore);
   } finally {await db.exec('rollback');}
  });
  await t.test('latest phone behavior remains available to normal own/all staff and administrator RPC',async()=>{
   for(const [key,id,client] of [['normal','consult','client-consult'],['all','work','client-work']]) await actor(db,key,async()=>{
    await db.query("update app_leads set data=data||'{\"phone\":\"00000000000\"}' where id=$1",[id]);
    assert.equal((await db.query("select data->>'phone' phone from app_clients where id=$1",[client])).rows[0].phone,'00000000000');
   });
   await actor(db,'admin',async()=>{
    const result=(await db.query("select public.update_client_phone('client-work','00000000000') result")).rows[0].result;
    assert.equal(result.leadId,'work');assert.equal(result.clientId,'client-work');
    assert.equal((await db.query("select data->>'phone' phone from app_leads where id='work'")).rows[0].phone,'00000000000');
   });
  });
  async function ownSmsActor(key,fn) {
   await db.exec('begin');
   try {
    await db.query("update profiles set staff_name=$2,display_name=$2,permissions=permissions||'{\"sms.view\":true}' where id=$1",[actors[key],`SMS-${key}`]);
    await db.query('insert into sms_staff_automation_settings(law_firm_id,staff_name,staff_profile_id) values($1,$2,$3)',[A,`SMS-${key}`,actors[key]]);
    const media=`${A}/auto-own/${actors[key]}/new-lead/30000000-0000-4000-8000-000000000001.jpg`;
    await db.query("insert into storage.objects(bucket_id,name) values('sms-media',$1)",[media]);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors[key]]);
    await fn(media);
   } finally {await db.exec('rollback');}
  }
  await t.test('new own-SMS settings/media routes remain denied to writer even with old raw SMS bits',()=>ownSmsActor('writer',async media=>{
   assert.deepEqual((await db.query('select public.sms_can_manage_automation($1) manage,public.sms_is_own_automation($1,$2,$3) own,public.sms_is_own_automation_path($4) path',[A,actors.writer,'SMS-writer',media])).rows[0],{manage:false,own:false,path:false});
   assert.equal((await db.query('select * from sms_staff_automation_settings')).rows.length,0);
   assert.equal((await db.query("update sms_staff_automation_settings set new_lead_template='synthetic' where staff_profile_id=$1 returning id",[actors.writer])).rows.length,0);
   await denied(db,'insert into sms_staff_automation_settings(law_firm_id,staff_name,staff_profile_id) values($1,$2,$3)',[A,'SMS-writer',actors.writer],/SMS_AUTOMATION_IDENTITY|row-level security/);
   assert.equal((await db.query('select * from storage.objects')).rows.length,0);
   await denied(db,"insert into storage.objects(bucket_id,name) values('sms-media',$1)",[media.replace('000000000001','000000000002')]);
  }));
  await t.test('normal employee own-SMS settings remain editable without manage-settings permission',()=>ownSmsActor('normal',async media=>{
   assert.deepEqual((await db.query('select public.sms_can_manage_automation($1) manage,public.sms_is_own_automation($1,$2,$3) own',[A,actors.normal,'SMS-normal'])).rows[0],{manage:false,own:true});
   assert.equal((await db.query("update sms_staff_automation_settings set new_lead_template='synthetic updated' where staff_profile_id=$1 returning id",[actors.normal])).rows.length,1);
   assert.equal((await db.query('select name from storage.objects where name=$1',[media])).rows.length,1);
  }));
  await t.test('case general edit allowed; relationship/identity/provider fields remain immutable',()=>actor(db,'writer',async()=>{
   assert.equal((await db.query("update app_cases set data=data||'{\"court\":\"가상법원\",\"stage\":\"서류준비\",\"memo\":\"작성\",\"filingDate\":\"2026-10-23\"}' where id='case-work' returning id")).rows.length,1);
   for(const [key,value] of [['id','other'],['clientId','client-consult'],['fromLeadId','consult'],['eformsignDocumentId','fake'],['docsSentAt','2026-10-23']]) await denied(db,"update app_cases set data=jsonb_set(data,array[$1],to_jsonb($2::text)) where id='case-work'",[key,value]);
   await denied(db,"update app_cases set id='other' where id='case-work'");
  }));
  await t.test('ordinary employee cases.edit_basic permits own basic fields without granting finance/docs/all',()=>actor(db,'basic',async()=>{
   assert.equal((await db.query("update app_cases set data=data||'{\"court\":\"가상법원\"}' where id='case-consult' returning id")).rows.length,1);
   assert.equal((await db.query("update app_cases set data=data||'{\"court\":\"x\"}' where id='case-work' returning id")).rows.length,0);
   await denied(db,"update app_cases set data=data||'{\"contractAmount\":999}' where id='case-consult'");
   await denied(db,"update app_cases set data=data||'{\"assignedStaff\":\"OTHER\"}' where id='case-consult'");
   await denied(db,"update app_cases set data=data||'{\"docsSentAt\":\"2026-10-23\"}' where id='case-consult'");
  }));
  await t.test('existing finance-only employee can edit finance but not new basic fields',()=>actor(db,'normal',async()=>{
   await db.query("update app_cases set data=data||'{\"contractAmount\":2000,\"paidAmount\":500}' where id='case-consult'");
   await denied(db,"update app_cases set data=data||'{\"court\":\"x\"}' where id='case-consult'");
  }));
  await t.test('installment writes/reparenting constrained to allowed cases with old/new checks',()=>actor(db,'writer',async()=>{
   assert.equal((await db.query("update app_installments set data=data||'{\"paid\":true}' where id='inst-work' returning id")).rows.length,1);
   await denied(db,"update app_installments set data=data||'{\"caseId\":\"case-consult\"}' where id='inst-work'");
   await denied(db,"update app_installments set data=data||'{\"caseId\":\"case-foreign\"}' where id='inst-work'");
   await denied(db,'insert into app_installments(id,data,law_firm_id) values($1,$2,$3)',['i-denied',{caseId:'case-consult'},A]);
   await db.query('insert into app_installments(id,data,law_firm_id) values($1,$2,$3)',['i-new',{caseId:'case-work'},A]);
   assert.equal((await db.query("delete from app_installments where id='i-new' returning id")).rows.length,1);
   assert.equal((await db.query("delete from app_installments where id='inst-consult' returning id")).rows.length,0);
  }));
  await t.test('no schedules/board/log reads; audit insertion and consultation living-cost read retained',()=>actor(db,'writer',async()=>{
   for(const table of ['app_schedule_items','app_board_posts','app_change_logs']) assert.deepEqual(await ids(db,table),[]);
   assert.deepEqual((await db.query('select key from firm_settings order by key')).rows.map(r=>r.key),['min_living_cost']);
   await db.query('insert into app_change_logs(id,data,law_firm_id) values($1,$2,$3)',['new-log',{staff:'SELF'},A]);
  }));
  await t.test('raw reverse ambiguity and conflicting direct IDs deny even when hidden lead caused conflict',async()=>{
   await db.exec('begin');
   try {
    await db.query("insert into app_clients(id,data,law_firm_id) values('reverse-client','{}',$1)",[A]);
    await db.query("insert into app_cases(id,data,law_firm_id) values('reverse-case','{\"clientId\":\"reverse-client\"}',$1)",[A]);
    await db.query("insert into app_leads(id,data,law_firm_id) values('reverse-good','{\"detailStage\":\"법원접수\",\"convertedCaseId\":\"reverse-case\",\"convertedClientId\":\"reverse-client\"}',$1)",[A]);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.writer]);
    assert.equal((await db.query("select public.can_access_case_id('reverse-case') ok")).rows[0].ok,true);
    await db.exec('reset role');
    await db.query("insert into app_leads(id,data,law_firm_id) values('reverse-hidden','{\"detailStage\":\"상담\",\"convertedCaseId\":\"reverse-case\",\"convertedClientId\":\"reverse-client\"}',$1)",[A]);
    await db.exec('set local role authenticated');
    assert.equal((await db.query("select public.can_access_case_id('reverse-case') ok")).rows[0].ok,false);
    assert.equal((await db.query("select public.can_access_client_id('reverse-client') ok")).rows[0].ok,false);
    for(const [fromLeadId,clientId] of [['missing','client-work'],['consult','client-work'],['free','client-work']]) assert.equal((await db.query('select writing_staff_private.case_allowed($1,$2,$3) ok',['case-work',{fromLeadId,clientId},A])).rows[0].ok,false);
   } finally {await db.exec('rollback');}
  });
  await t.test('missing explicit link never falls back; client-direct and case-only fallback remain supported',async()=>{
   await db.exec('begin');
   try {
    for(const [id,data] of [
     ['client-direct',{fromLeadId:'free'}],['client-case-only',{}],['client-missing',{fromLeadId:'missing'}],
    ]) await db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)',[id,data,A]);
    for(const [id,data] of [
     ['case-client-direct',{clientId:'client-direct'}],
     ['case-only',{clientId:'client-case-only',fromLeadId:'free'}],
     ['case-missing',{clientId:'client-missing',fromLeadId:'missing'}],
    ]) await db.query('insert into app_cases(id,data,law_firm_id) values($1,$2,$3)',[id,data,A]);
    await db.query('insert into app_leads(id,data,law_firm_id) values($1,$2,$3)',['reverse-cannot-repair',{detailStage:'법원접수',convertedCaseId:'case-missing',convertedClientId:'client-missing'},A]);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.writer]);
    for(const id of ['case-client-direct','case-only']) assert.equal((await db.query('select public.can_access_case_id($1) ok',[id])).rows[0].ok,true,id);
    assert.equal((await db.query("select public.can_access_client_id('client-case-only') ok")).rows[0].ok,true);
    assert.equal((await db.query("select public.can_access_case_id('case-missing') ok")).rows[0].ok,false);
    assert.equal((await db.query("select public.can_access_client_id('client-missing') ok")).rows[0].ok,false);
   } finally {await db.exec('rollback');}
  });
  await t.test('rejected case-before-client write cannot bypass original tenant FK guard; ordered conversion succeeds',()=>actor(db,'writer',async()=>{
   await denied(db,'insert into app_cases(id,data,law_firm_id) values($1,$2,$3)',['ordered-case',{clientId:'ordered-client',fromLeadId:'free'},A]);
   await db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)',['ordered-client',{fromLeadId:'free'},A]);
   await db.query('insert into app_cases(id,data,law_firm_id) values($1,$2,$3)',['ordered-case',{clientId:'ordered-client',fromLeadId:'free'},A]);
   await db.query("update app_leads set data=data||'{\"convertedClientId\":\"ordered-client\",\"convertedCaseId\":\"ordered-case\"}' where id='free'");
   assert.ok((await ids(db,'app_cases')).includes('ordered-case'));
  }));
  await t.test('anonymous cannot execute private lookups or self-profile helper',async()=>{
   await db.exec('begin; set local role anon');
   try {
    await denied(db,'select public.is_writing_staff()',[],/permission denied/);
    await denied(db,'select writing_staff_private.lead_allowed($1,$2)',['work',A],/permission denied/);
    assert.deepEqual(await ids(db,'app_leads'),[]);
   } finally {await db.exec('rollback');}
  });
  await t.test('removing designation restores original raw permission interpretation without migration edits',async()=>{
   await db.exec('begin');
   try {
    await db.query("update profiles set permissions=permissions-'staff.writer' where id=$1",[actors.writer]);
    await db.exec('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.writer]);
    assert.equal((await db.query("select public.has_permission('db.create') ok")).rows[0].ok,true);
   } finally {await db.exec('rollback');}
  });
  await t.test('assignment function differs from prior deployed source only by five writer candidate exclusions',()=>{
   const original=functionSql('import_tenant_google_sheet_lead','010_weekend_consult_time_search_fix.sql').replaceAll('\r\n','\n');
   const current=migration.match(/create or replace function public\.import_tenant_google_sheet_lead\([\s\S]*?\$\$[\s\S]*?\$\$;/i)[0];
   const extra="\n      and not coalesce(p.role='staff' and coalesce(p.platform_role,'staff') not in ('firm_admin','super_admin')\n        and p.permissions->'staff.writer'='true'::jsonb,false)";
   assert.equal(current.split(extra).length-1,5);
   assert.equal(current.replaceAll(extra,''),original);
  });
  const member=key=>({profileId:actors[key],enabled:true,order:1,weight:1});
  async function assignment(config,{auto=['writer','normal'],disableAdmin=false,mutate}={},check) {
   await db.exec('begin');
   try {
    await db.query('update profiles set auto_assign_leads=(id=any($1::uuid[]))',[auto.map(key=>actors[key])]);
    if(disableAdmin) await db.query('update profiles set is_active=false where id=$1',[actors.admin]);
    if(mutate) await mutate();
    if(config!==null) await db.query('insert into firm_runtime_state(law_firm_id,key,value) values($1,$2,$3)',[A,'lead_auto_assignment_config',config]);
    const configBefore=(await db.query("select value from firm_runtime_state where key='lead_auto_assignment_config'")).rows;
    await db.exec('set local role service_role');
    await db.query("select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true)");
    const ingest=async(key='synthetic-key')=>(await db.query('select public.import_tenant_google_sheet_lead($1,$2,$3,$4,$5,$6) result',[A,key,`assigned-${key}`,{name:'합성 테스트',phone:'NOT-A-PHONE',receivedAt:'2026-10-23T01:00:00Z',status:'신규접수',detailStage:'신규디비'},'Synthetic',1])).rows[0].result;
    await check(ingest);
    assert.deepEqual((await db.query("select value from firm_runtime_state where key='lead_auto_assignment_config'")).rows,configBefore);
   } finally {await db.exec('rollback');}
  }
  await t.test('JSON enabled writer excluded from base weighted pool even when stored config still includes them',()=>assignment({enabled:true,members:[member('writer'),member('normal')]},{auto:[]},async ingest=>{
   const result=await ingest();assert.equal(result.assignedProfileId,actors.normal);assert.equal(result.assignmentRouteKey,'default');
   const duplicate=await ingest();assert.equal(duplicate.duplicate,true);
   assert.equal((await db.query("select count(*)::int n from app_leads where id='assigned-synthetic-key'")).rows[0].n,1);
  }));
  await t.test('writer-only detail rule falls back to valid base pool; no saved rules rewritten',()=>assignment({enabled:true,members:[member('normal')],rules:[{id:'specific',name:'조건',enabled:true,priority:1,dayType:'all',startTime:'00:00',endTime:'23:59',members:[member('writer')]}]}, {},async ingest=>{
   const result=await ingest();assert.equal(result.assignedProfileId,actors.normal);assert.equal(result.assignmentRouteKey,'default');
  }));
  await t.test('legacy auto_assign flags cannot assign newly designated writer',()=>assignment(null,{},async ingest=>{
   const result=await ingest();assert.equal(result.assignedProfileId,actors.normal);assert.equal(result.assignmentRouteKey,'legacy');
  }));
  await t.test('writer-only pool falls back to real manager; marker on admin is not a writer role',()=>assignment({enabled:true,members:[member('writer')]},{auto:['writer']},async ingest=>{
   const result=await ingest();assert.equal(result.assignedProfileId,actors.admin);assert.equal(result.assignmentRoute,'관리자 fallback');
  }));
  await t.test('automatic assignment OFF keeps the existing manager fallback',()=>assignment({enabled:false,members:[member('writer'),member('normal')]},{},async ingest=>{
   const result=await ingest();assert.equal(result.assignedProfileId,actors.admin);assert.equal(result.assignmentRouteKey,'disabled');
  }));
  await t.test('only writer candidates and no active manager fails closed without inserting incoming lead',()=>assignment({enabled:true,members:[member('writer')]},{auto:['writer'],disableAdmin:true},async ingest=>{
   await db.exec('savepoint no_candidate');
   await assert.rejects(ingest(),/활성 관리자\/자동배정 담당자가 없습니다/);
   await db.exec('rollback to savepoint no_candidate');
   assert.equal((await db.query("select count(*)::int n from app_leads where id='assigned-synthetic-key'")).rows[0].n,0);
  }));
  await t.test('writer marker is exact boolean: string true never silently changes a normal staff role',()=>assignment({enabled:true,members:[member('writer')]},{auto:[],mutate:()=>db.query("update profiles set permissions=jsonb_set(permissions,'{staff.writer}','\"true\"'::jsonb) where id=$1",[actors.writer])},async ingest=>{
   assert.equal((await ingest()).assignedProfileId,actors.writer);
  }));
  await t.test('authenticated writer cannot invoke service-role ingestion RPC',()=>actor(db,'writer',async()=>{
   await denied(db,'select public.import_tenant_google_sheet_lead($1,$2,$3,$4,$5,$6)',[A,'not-called','not-created',{name:'synthetic',phone:'NOT-A-PHONE'},'Synthetic',1],/service_role only/);
  }));
 } finally {await db.close();}
});
