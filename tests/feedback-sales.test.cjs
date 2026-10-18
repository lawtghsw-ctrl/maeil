const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const runtime=path.resolve(root,'../sms-sql-check/node_modules/@electric-sql/pglite');
const {PGlite}=require(runtime);
const moduleValue={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/platform/sales.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleValue,exports:moduleValue.exports,URL,Date});
const pure=moduleValue.exports;
const firm='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
test('sales proposal validation and identity never turn missing terms into confirmed amounts',()=>{
 assert.throws(()=>pure.normalizeSalesLead({name:''}));
 assert.throws(()=>pure.normalizeSalesLead({name:'테스트',website:'javascript:alert(1)'}));
 const data=pure.normalizeSalesLead({name:'테스트 법률',phone:'02-1234-5678',businessNumber:'123-45-67890',website:'www.example.org'});
 assert.equal(pure.salesIdentity(data).domain,'example.org');assert.equal(pure.salesIdentity(data).phone,'0212345678');
 assert.throws(()=>pure.normalizeProposal({product:'3Q',quantity:0,months:3,unitPrice:100,startDate:'2026-10-01',endDate:'2026-12-31'}));
 assert.ok(!pure.EDITABLE_SALES_STAGES.includes('서명완료'));
 assert.equal(pure.validDate('2026-99-40'),false); assert.equal(pure.validDate('2026-02-30'),false);
});

test('sales mutation SQL is atomic, deduplicates and preserves old data and event request IDs',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table law_firms(id uuid primary key);insert into law_firms values('${firm}');`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261018002931_platform_sales_pipeline.sql'),'utf8'));
 const run=async(action,payload)=>(await db.query('select platform_sales_mutate($1,$2,$3,$4::jsonb) as result',[actor,'테스트 담당자',action,JSON.stringify(payload)])).rows[0].result;
 const data=pure.normalizeSalesLead({name:'새 로펌',phone:'0212345678',source:'listup'});
 const create=await run('create',{rows:[{data,identity:pure.salesIdentity(data)}]});assert.equal(create.created,1);
 const imported=await run('import',{rows:[{data:{...data,name:'덮어쓰면 안 됨',source:'referral'},identity:pure.salesIdentity(data)}]});assert.equal(imported.merged,1);
 let row=(await db.query('select * from platform_sales_leads')).rows[0];assert.equal(row.data.name,'새 로펌');assert.deepEqual(row.sources,['listup','referral']);
 const requestId='33333333-3333-4333-8333-333333333333';const event={id:row.id,revision:row.revision,requestId,data:{type:'전화',note:'연락 완료',at:'2026-10-01T00:00:00Z'}};
 await run('activity',event);assert.equal((await run('activity',event)).reused,true);
 assert.equal((await db.query("select count(*)::int n from platform_sales_events where kind='activity'")).rows[0].n,1);
 await assert.rejects(()=>run('update',{id:row.id,revision:1,data,identity:pure.salesIdentity(data),stage:'첫연락'}),/REVISION_CONFLICT/);
 row=(await db.query('select * from platform_sales_leads')).rows[0];
 await assert.rejects(()=>run('update',{id:row.id,revision:row.revision,data,identity:pure.salesIdentity(data),stage:'서명완료'}),/PROVIDER_STAGE_LOCKED/);
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from platform_sales_leads'),/permission denied/);await assert.rejects(()=>run('create',{rows:[{data,identity:pure.salesIdentity(data)}]}),/permission denied/);
 }finally{await db.close();}
});

test('CRM triggers preserve historical data, fee snapshots and append concurrent contact records',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid()returns uuid language sql as $$select '${actor}'::uuid$$;
 create table profiles(id uuid primary key,display_name text,staff_name text,platform_role text);insert into profiles values('${actor}','테스트 관리자','담당자','firm_admin');
 create table firm_settings(law_firm_id uuid,key text,value jsonb);create table app_leads(id text primary key,law_firm_id uuid,data jsonb);create table app_cases(id text primary key,law_firm_id uuid,data jsonb);
 insert into app_leads values('old','${firm}','{"detailStage":"미상담"}');insert into app_cases values('old','${firm}','{"stage":"상담접수","contractAmount":1000}');`);
 const before=await db.query('select data from app_cases where id=$1',['old']);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261018003418_crm_feedback_fields.sql'),'utf8'));
 assert.deepEqual((await db.query('select data from app_cases where id=$1',['old'])).rows,before.rows);
 await db.query('insert into firm_settings values($1,$2,$3)',[firm,'management_analytics_v1',{feeRules:[{id:'fee',caseType:'개인회생',baseFee:4000000,minFee:3000000,approvalDiscountAmount:400000,effectiveFrom:'2026-10-01'}]}]);
 await db.query('insert into app_cases values($1,$2,$3)',['new',firm,{caseType:'개인회생',contractDate:'2026-10-18',stage:'상담접수'}]);
 let record=(await db.query("select data from app_cases where id='new'")).rows[0].data;assert.equal(record.feeStandardSnapshot.baseFee,4000000);
 await db.query('update app_cases set data=$1 where id=$2',[{...record,feeStandardSnapshot:{baseFee:5},stage:'서류준비'},'new']);
 record=(await db.query("select data from app_cases where id='new'")).rows[0].data;assert.equal(record.feeStandardSnapshot.baseFee,4000000);assert.ok(record.stageUpdatedAt);
 await db.query("update app_cases set data=data||$1::jsonb where id='old'",[{feeStandardSnapshot:{baseFee:9999}}]);assert.equal((await db.query("select data from app_cases where id='old'")).rows[0].data.feeStandardSnapshot,undefined);
 await db.query("update app_leads set data=data||$1::jsonb where id='old'",[{contactLog:[{id:'a',at:'2026-10-18T00:00:00Z',type:'phone',staff:'forged',connected:true}]}]);
 await db.query("update app_leads set data=data||$1::jsonb where id='old'",[{contactLog:[{id:'b',at:'2026-10-18T00:01:00Z',type:'phone',staff:'forged'}],detailStage:'상담'}]);
 const lead=(await db.query("select data from app_leads where id='old'")).rows[0].data;assert.equal(lead.contactLog.length,2);assert.equal(lead.contactLog[0].staff,'테스트 관리자');assert.ok(lead.stageUpdatedAt);
 await db.query("update app_leads set data=$1 where id='old'",[{detailStage:'상담',name:'기존 화면 편집'}]);
 assert.equal((await db.query("select data from app_leads where id='old'")).rows[0].data.contactLog.length,2);
 for(const bad of [{id:'c',at:'2026-10-18T00:00:00Z'},{id:'c',at:'invalid',type:'phone'},{id:'c',at:'2026-10-18T00:00:00Z',type:'phone',durationSeconds:-1}]) await assert.rejects(()=>db.query("update app_leads set data=data||$1::jsonb where id='old'",[{contactLog:[bad]}]));
 await db.query("update app_cases set data=data||$1::jsonb where id='new'",[{contractAmount:3000000}]);
 await db.query("update app_cases set data=data||$1::jsonb where id='new'",[{discountApprovedBy:'승인'}]);
 assert.equal((await db.query("select data from app_cases where id='new'")).rows[0].data.discountApprovedBy,'테스트 관리자');
 await db.query("update app_cases set data=data||$1::jsonb where id='new'",[{contractAmount:2000000}]);
 assert.equal((await db.query("select data from app_cases where id='new'")).rows[0].data.discountApprovedBy,undefined);
 }finally{await db.close();}
});
