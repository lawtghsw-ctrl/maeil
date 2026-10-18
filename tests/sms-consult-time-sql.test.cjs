const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(path.resolve(__dirname,'../../sms-sql-check/node_modules/@electric-sql/pglite'));
const root=path.resolve(__dirname,'..'),firm='11111111-1111-4111-8111-111111111111',actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sender='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',relay='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
test('offline PostgreSQL: slot migration preserves data and old waits, renders future manual/auto requests once',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table law_firms(id uuid primary key,firm_code char(10),name text,status text default 'active');
 create table profiles(id uuid primary key,law_firm_id uuid,platform_role text,role text,staff_name text,is_active boolean,permissions jsonb default '{}');
 create table app_leads(id text primary key,law_firm_id uuid references law_firms(id),data jsonb);
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key,name text,bucket_id text);
 create function is_active_user() returns boolean language sql as $$select true$$;
 create function is_super_admin() returns boolean language sql as $$select true$$;
 create function is_firm_admin() returns boolean language sql as $$select true$$;
 create function is_admin_user() returns boolean language sql as $$select true$$;
 create function current_law_firm_id() returns uuid language sql as $$select '${firm}'::uuid$$;
 create function has_permission(k text) returns boolean language sql as $$select true$$;
 insert into law_firms values('${firm}','1234567890','Synthetic','active');
 insert into auth.users values('${actor}');insert into profiles values('${actor}','${firm}','firm_admin','admin','Staff',true,'{}');
 insert into app_leads values('old','${firm}','{"name":"Old","phone":"01000000000","assignedStaff":"Staff"}');`);
 for(const name of ['014_sms_center_foundation.sql','015_sms_staff_automation_images.sql','016_sms_permissions.sql','20261017133745_sms_delivery_epoch_jobs.sql'])await db.exec(read(name).replaceAll("'EUC_KR'","'UTF8'"));
 // PGlite cannot exercise EUC_KR; byte validation is covered by the relay codec tests.
 await db.query('insert into sms_sender_numbers(id,law_firm_id,staff_name,phone,is_registered,is_default) values($1,$2,$3,$4,true,true)',[sender,firm,'Staff','01011112222']);
 await db.query("insert into sms_outbox(law_firm_id,sender_number,receiver_number,message,status) values($1,'01011112222','01000000000','old waiting','pending_api')",[firm]);
 const gate=async (auto,expected=null)=>(await db.query('select * from sms_delivery_set_gate($1,$2,$3,true,$4,$5)',[actor,firm,expected,auto,relay])).rows[0];
 const g=await gate(false);
 const snapshot=async()=>JSON.stringify((await db.query(`select jsonb_build_object('leads',(select jsonb_agg(to_jsonb(t)) from app_leads t),'outbox',(select jsonb_agg(to_jsonb(t)) from sms_outbox t),'gates',(select jsonb_agg(to_jsonb(t)) from sms_delivery_gates t),'settings',(select jsonb_agg(to_jsonb(t)) from sms_automation_settings t)) evidence`)).rows);
 const before=await snapshot();await db.exec(read('20261018082353_sms_consult_time_variables.sql').replaceAll("'EUC_KR'","'UTF8'"));assert.equal(await snapshot(),before);
 assert.equal((await db.query('select count(*)::int n from sms_delivery_jobs')).rows[0].n,0);
 const request='dddddddd-dddd-4ddd-8ddd-dddddddddddd',recipients=[{name:'A',phone:'01000000001',consultTime:'평일 오후(1시~6시)'},{name:'B',phone:'01000000002',consultTime:'주말 오전(8~12시)'}];
 const enqueue=()=>db.query('select * from sms_delivery_enqueue($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,$11,$12)',[actor,firm,g.epoch_id,relay,request,sender,JSON.stringify(recipients),'{고객명}:{상담시간대}:{담당자}','','[]','manual','LMS']);
 const first=(await enqueue()).rows;assert.equal(first[0].message,'A:평일 오후(1시~6시):Staff');assert.equal(first[1].message,'B:주말 오전(8~12시):Staff');
 assert.deepEqual((await enqueue()).rows.map(r=>r.id),first.map(r=>r.id));
 assert.equal((await db.query('select count(*)::int n from sms_delivery_jobs')).rows[0].n,2);
 await db.query("update sms_automation_settings set new_lead_enabled=true,absence_enabled=true,new_lead_template='{고객명}:{상담시간대}',absence_template='{고객명}:{상담시간대}' where law_firm_id=$1",[firm]);
 await assert.rejects(()=>gate(true),/SMS_GATE_CHANGED/,'gate changes still require the version originally read');
 const enabledGate=await gate(true,g.epoch_id);
 assert.notEqual(enabledGate.epoch_id,g.epoch_id);
 // Memo maintenance must stay inert even with automation ON and a current-epoch
 // lead, so the duplicate guard cannot conceal an accidentally queued SMS.
 const memoEntries=[{id:'newer',staff:'Staff',at:'2026-10-18T01:00:00Z',tag:'부재중',text:'newer note'},
   {id:'older',staff:'Staff',at:'2026-10-17T01:00:00Z',tag:'부재중',text:'older note'}];
 await db.query('insert into app_leads values($1,$2,$3)',['memo-maintenance',firm,JSON.stringify({name:'Memo fixture',phone:'01000000006',assignedStaff:'Staff',consultation:{memoLog:memoEntries}})]);
 const memoSmsBefore=JSON.stringify((await db.query("select * from sms_delivery_jobs where lead_id='memo-maintenance' order by id")).rows);
 const writeMemos=entries=>db.query("update app_leads set data=jsonb_set(data,'{consultation,memoLog}',$1::jsonb) where id='memo-maintenance'",[JSON.stringify(entries)]);
 for (const entries of [
   memoEntries.map(e=>e.id==='newer'?{...e,text:'corrected note',editedAt:'2026-10-18T02:00:00Z',editedBy:'Staff',editHistory:[{text:e.text,at:e.at,by:e.staff}]}:e),
   memoEntries.map(e=>({...e,pinned:true,pinOrder:e.id==='older'?0:1})),
   memoEntries.map(e=>({...e,pinned:true,pinOrder:e.id==='newer'?0:1})),
   memoEntries.map(e=>e.id==='newer'?{...e,deletedAt:'2026-10-18T02:00:00Z',deletedBy:'Staff'}:e),
   memoEntries,
 ]) {
   await writeMemos(entries);
   assert.equal(JSON.stringify((await db.query("select * from sms_delivery_jobs where lead_id='memo-maintenance' order by id")).rows),memoSmsBefore,'edit, pin, reorder, soft-delete and restore create no SMS or modify existing jobs');
 }
 assert.equal((await db.query("select count(*)::int n from sms_delivery_jobs where lead_id='memo-maintenance' and source='absence'")).rows[0].n,0);
 await db.query("update app_leads set data=data||'{\"detailStage\":\"부재\"}' where id='old'");
 assert.equal((await db.query("select count(*)::int n from sms_delivery_jobs where lead_id is distinct from 'memo-maintenance'")).rows[0].n,2,'old leads are not adopted by a new epoch');
 await db.query('insert into app_leads values($1,$2,$3)',['fresh',firm,JSON.stringify({name:'Fresh',phone:'01000000003',assignedStaff:'Staff',consultTimeRaw:'토요일 오후 2시',receivedAt:'1999-01-01T00:00:00Z'})]);
 assert.equal((await db.query("select message from sms_delivery_jobs where lead_id='fresh'")).rows[0].message,'Fresh:토요일 오후 2시');
 await db.query("update app_leads set data=data||'{\"detailStage\":\"부재\",\"consultTime\":\"일요일 오전\"}' where id='fresh'");
 assert.equal((await db.query("select message from sms_delivery_jobs where lead_id='fresh' and source='absence'")).rows[0].message,'Fresh:일요일 오전');
 await db.query("update app_leads set data=data||'{\"detailStage\":\"상담중\"}' where id='fresh'");
 await db.query("update app_leads set data=data||'{\"detailStage\":\"부재\"}' where id='fresh'");
 assert.equal((await db.query("select count(*)::int n from sms_delivery_jobs where lead_id='fresh' and source='absence'")).rows[0].n,1,'the duplicate guard still suppresses repeated absence events');
 assert.equal((await db.query("select sms_apply_consult_time('{상담시간대}|{상담시간}',null) rendered")).rows[0].rendered,'미지정|미지정');
 assert.equal((await db.query("select sms_apply_consult_time('{상담시간대}|{상담시간}',$1) rendered",['  오전\n10시  '])).rows[0].rendered,'오전 10시|오전 10시');
 const unchangedRequest='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 const enqueueCurrent=(values,id=unchangedRequest)=>db.query('select * from sms_delivery_enqueue($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,$11,$12)',[actor,firm,enabledGate.epoch_id,relay,id,sender,JSON.stringify(values),'{상담시간대}','','[]','manual','SMS']);
 await enqueueCurrent([{name:'A',phone:'01000000004',consultTime:'오전'}]);
 await assert.rejects(()=>enqueueCurrent([{name:'A',phone:'01000000004',consultTime:'오후'}]),/SMS_IDEMPOTENCY_CONFLICT/,'changing the slot is a changed request, not a replay');
 const beforeInvalid=(await db.query('select count(*)::int n from sms_delivery_jobs')).rows[0].n;
 for(const consultTime of ['x'.repeat(201),'오전\n10시',{},null])await assert.rejects(()=>enqueueCurrent([{name:'A',phone:'01000000005',consultTime}],'ffffffff-ffff-4fff-8fff-ffffffffffff'),/SMS_RECIPIENT_INVALID/);
 assert.equal((await db.query('select count(*)::int n from sms_delivery_jobs')).rows[0].n,beforeInvalid,'invalid slot values never partially enqueue a batch');
 assert.equal((await enqueueCurrent([{name:'A',phone:'01000000005'}],'ffffffff-ffff-4fff-8fff-ffffffffffff')).rows[0].message,'미지정','old clients without consultTime remain supported');
 const errors=(await db.query('select count(*)::int n from sms_delivery_trigger_errors')).rows[0].n;assert.equal(errors,0);
 assert.equal((await db.query("select status from sms_outbox where message='old waiting'")).rows[0].status,'pending_api');
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query("select sms_apply_consult_time('x','y')"),/permission denied/);await db.exec('reset role');}
 }finally{await db.close()}
});
