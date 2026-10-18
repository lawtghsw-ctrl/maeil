// Offline native PostgreSQL and actual pure code; no remote calls or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');const {PGlite}=require(path.resolve(root,'../sms-sql-check/node_modules/@electric-sql/pglite'));
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/platform/sales.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:m.exports,URL,Date});const pure=m.exports;
const actor='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222';
const id=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
const oldMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261018002931_platform_sales_pipeline.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261018102532_platform_sales_editable_records.sql'),'utf8');
const equal=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));

test('Excel aliases preserve stage, multiline memo and priority; blank defaults and provider-stage rejection are explicit',()=>{
 const row=pure.mapSalesImportRow({'로펌명':'법률사무소','영업 단계':'미팅예정','메모':'첫 줄\n둘째 줄','우선순위':'높음','유입 경로':'소개'},[['로펌명 *','name']]);
 assert.equal(row.stage,'미팅예정');assert.equal(row.note,'첫 줄\n둘째 줄');assert.equal(row.priority,'높음');assert.equal(row.source,'referral');
 assert.equal(pure.normalizeSalesImport({name:'기본'}).stage,'신규접수');assert.equal(pure.normalizeSalesImport({name:'기본'}).priority,'보통');
 for(const stage of ['서명완료','계약서발송','오타'])assert.throws(()=>pure.normalizeSalesImport({name:'검증',stage}));
 assert.throws(()=>pure.normalizeSalesImport({name:'검증',stage:'실패'}));assert.throws(()=>pure.normalizeSalesImport({name:'검증',priority:'오타'}));assert.throws(()=>pure.normalizeSalesImport({name:'검증',note:'a'.repeat(5001)}));
});
test('event projection is immutable and only active effective meetings enter the KPI',()=>{
 const events=[{id:'a',lead_id:'lead',kind:'meeting',created_at:'2026-10-18',actor_name:'원본',data:{at:'2026-10-18T00:00:00Z',note:'원본',status:'예정'}}];const before=JSON.stringify(events);
 const revision={id:'v',event_id:'a',lead_id:'lead',revision:1,action:'event_archive',data:{...events[0].data,note:'수정'},archived:true};
 const projected=pure.projectSalesEvents(events,[revision,{...revision,id:'foreign',lead_id:'other',revision:2}]);assert.equal(projected[0].data.note,'수정');assert.equal(projected[0].originalData.note,'원본');assert.equal(projected[0].history.length,1);assert.equal(JSON.stringify(events),before);assert.equal(pure.salesMetrics([],projected,'2026-10-18').meetings,0);
});

test('native migration preserves existing records; corrections append atomically with CAS, authorization, retry, archive and restore',async t=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   alter default privileges in schema public grant all on tables to service_role;
   create function auth.uid()returns uuid language sql as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
   create table profiles(id uuid primary key,is_active boolean,platform_role text);insert into profiles values('${actor}',true,'super_admin'),('${staff}',true,'staff');grant select on profiles to service_role;grant usage on schema auth to service_role;
   create table law_firms(id uuid primary key);create table app_leads(id text,data jsonb);insert into app_leads values('customer','{"name":"untouched"}');create table sms_outbox(id text,data jsonb);insert into sms_outbox values('pending','{"status":"pending"}');`);
  await db.exec(oldMigration);
  const run=async(action,payload,who=actor)=>(await db.query('select platform_sales_mutate($1,$2,$3,$4::jsonb) result',[who,'담당자',action,JSON.stringify(payload)])).rows[0].result;
  const data=pure.normalizeSalesLead({name:'원본',note:'기존 메모',priority:'높음',phone:'01012345678'});
  const created=await run('create',{rows:[{data,identity:pure.salesIdentity(data)}]});const leadId=created.ids[0];
  const baseline=(await db.query('select to_jsonb(t) row from platform_sales_leads t')).rows;
  await db.exec(migration);equal((await db.query('select to_jsonb(t) row from platform_sales_leads t')).rows,baseline);
  const current=async()=>(await db.query('select * from platform_sales_leads where id=$1',[leadId])).rows[0];
  let n=100;
  const change=async(action,eventId,eventRevision,extra={})=>{const payload={id:leadId,revision:(await current()).revision,eventId,eventRevision,requestId:id(n++),...extra};return {payload,result:await run(action,payload)};};
  await t.test('super identity, service-only grants and protected source tables',async()=>{
   await assert.rejects(()=>run('create',{rows:[{data,identity:pure.salesIdentity(data)}]},staff),/FORBIDDEN/);
   await db.exec(`set fixture.uid='${staff}'`);await assert.rejects(()=>run('create',{rows:[{data,identity:pure.salesIdentity(data)}]}),/FORBIDDEN/);await db.exec("set fixture.uid=''");
   await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from platform_sales_event_revisions'),/permission denied/);await assert.rejects(()=>run('create',{}),/permission denied/);await db.exec('reset role');
   assert.ok(!/\b(?:update|insert into|delete from)\s+public\.(?:app_|sms_|lead_supply)/i.test(migration));
  });
  await t.test('import stage metadata works for new only and never overwrites duplicates',async()=>{
   const other=pure.normalizeSalesLead({name:'신규',note:'첫 메모',priority:'낮음'});const made=await run('import',{rows:[{data:other,stage:'미팅예정',identity:pure.salesIdentity(other)}]});assert.equal(made.created,1);assert.equal((await db.query('select stage from platform_sales_leads where id=$1',[made.ids[0]])).rows[0].stage,'미팅예정');
   const merged={...data,note:'덮지 않음',priority:'낮음',source:'referral'};await run('import',{rows:[{data:merged,stage:'실패',identity:pure.salesIdentity(merged)}]}).then(()=>assert.fail('loss reason required'),e=>assert.match(e.message,/INVALID_LOSS_REASON/));
   await run('import',{rows:[{data:merged,stage:'첫연락',identity:pure.salesIdentity(merged)}]});assert.equal((await current()).data.note,'기존 메모');assert.equal((await current()).stage,'신규접수');
   await assert.rejects(()=>run('create',{rows:[{data:other,stage:'서명완료',identity:pure.salesIdentity(other)}]}),/PROVIDER_STAGE_LOCKED/);
  });
  const activity={id:leadId,revision:(await current()).revision,requestId:id(1),data:pure.normalizeSalesEvent({type:'전화',at:'2020-10-01T00:00:01Z',note:'원본 전화'},'activity')};await run('activity',activity);
  const meeting={id:leadId,revision:(await current()).revision,requestId:id(2),data:pure.normalizeSalesEvent({at:'2020-10-02T00:00:00Z',note:'원본 미팅',status:'완료'},'meeting')};await run('meeting',meeting);
  const originals=(await db.query('select to_jsonb(t) row from platform_sales_events t order by id')).rows;
  await t.test('edit keeps original creation retry, ignores memo/future/cancelled meetings for last contact',async()=>{
   const edited=await change('event_update',id(2),0,{kind:'meeting',data:{...meeting.data,status:'취소',note:'취소 정정'}});
   assert.equal(new Date((await current()).last_contact_at).toISOString(),'2020-10-01T00:00:01.000Z');assert.equal((await run('meeting',meeting)).reused,true);assert.equal((await run('event_update',edited.payload)).reused,true);
   await assert.rejects(()=>run('event_update',{...edited.payload,data:{...edited.payload.data,note:'충돌'}}),/REQUEST_CONFLICT/);
   await assert.rejects(()=>change('event_update',id(2),0,{kind:'meeting',data:meeting.data}),/REVISION_CONFLICT/);
   await change('event_update',id(2),1,{kind:'meeting',data:{...meeting.data,at:'2099-01-01T00:00:00Z'}});assert.equal(new Date((await current()).last_contact_at).toISOString(),'2020-10-01T00:00:01.000Z');
  });
  await t.test('archive and restore re-evaluate the latest effective snapshot, retaining every old record',async()=>{
   const hidden=await change('event_archive',id(1),0);assert.equal((await current()).last_contact_at,null);assert.equal((await run('event_archive',hidden.payload)).reused,true);
   await change('event_restore',id(1),1);assert.equal(new Date((await current()).last_contact_at).toISOString(),'2020-10-01T00:00:01.000Z');
   equal((await db.query('select to_jsonb(t) row from platform_sales_events t order by id')).rows,originals);
   await assert.rejects(()=>change('event_update',id(1),0,{kind:'activity',data:activity.data}),/REVISION_CONFLICT/);
  });
  await t.test('wrong lead, stale revisions and management events are never edited',async()=>{
   const foreign=(await db.query('select id from platform_sales_leads where id<>$1',[leadId])).rows[0].id;
   await assert.rejects(()=>run('event_archive',{id:foreign,revision:1,eventId:id(1),eventRevision:2,requestId:id(999)}),/EVENT_UNAVAILABLE/);
   await assert.rejects(()=>run('event_archive',{id:leadId,revision:1,eventId:id(1),eventRevision:2,requestId:id(998)}),/REVISION_CONFLICT/);
   const management=(await db.query("select id from platform_sales_events where lead_id=$1 and kind='create'",[leadId])).rows[0].id;await assert.rejects(()=>change('event_archive',management,0),/EVENT_UNAVAILABLE/);
  });
  await t.test('signed stage remains locked while activity corrections are allowed, and unrelated tables are unchanged',async()=>{
   await db.query("update platform_sales_leads set stage='서명완료' where id=$1",[leadId]);
   const revision=(await current()).revision;await assert.rejects(()=>run('update',{id:leadId,revision,data,stage:'첫연락',identity:pure.salesIdentity(data)}),/PROVIDER_STAGE_LOCKED/);
   await change('event_update',id(1),2,{kind:'activity',data:{...activity.data,type:'메모',note:'메모 정정'}});assert.equal((await current()).last_contact_at,null);assert.equal((await current()).stage,'서명완료');
   equal((await db.query('select data from app_leads')).rows,[{data:{name:'untouched'}}]);equal((await db.query('select data from sms_outbox')).rows,[{data:{status:'pending'}}]);
  });
  await t.test('Supabase default ALL grants are removed: service can read/append but cannot update, delete or truncate history',async()=>{
   // Prove the fixture grants ALL by default, not merely a role with no grants.
   assert.equal((await db.query("select has_table_privilege('service_role','app_leads','DELETE') allowed")).rows[0].allowed,true);
   const privileges=(await db.query("select has_table_privilege('service_role','platform_sales_event_revisions','SELECT') can_select,has_table_privilege('service_role','platform_sales_event_revisions','INSERT') can_insert,has_table_privilege('service_role','platform_sales_event_revisions','UPDATE') can_update,has_table_privilege('service_role','platform_sales_event_revisions','DELETE') can_delete,has_table_privilege('service_role','platform_sales_event_revisions','TRUNCATE') can_truncate")).rows[0];
   equal(privileges,{can_select:true,can_insert:true,can_update:false,can_delete:false,can_truncate:false});
   const before=(await db.query('select to_jsonb(t) row from platform_sales_event_revisions t order by id')).rows;
   await db.exec('set role service_role');
   assert.ok((await db.query('select id from platform_sales_event_revisions')).rows.length>0);
   for(const sql of ['update platform_sales_event_revisions set archived=false','delete from platform_sales_event_revisions','truncate platform_sales_event_revisions'])await assert.rejects(()=>db.query(sql),/permission denied/);
   await db.exec('reset role;begin;set local role service_role');
   try{const inserted=await db.query("insert into platform_sales_event_revisions(id,event_id,lead_id,revision,action,data,archived,actor_id,actor_name,request_payload) select $1,event_id,lead_id,99999,action,data,archived,actor_id,actor_name,request_payload from platform_sales_event_revisions order by id limit 1 returning id",[id(99999)]);assert.equal(inserted.rows.length,1);}finally{await db.exec('rollback');}
   equal((await db.query('select to_jsonb(t) row from platform_sales_event_revisions t order by id')).rows,before);
  });
 }finally{await db.close();}
});
