// Isolated PostgreSQL/WASM authorization and persistence tests. Synthetic rows
// only; no Supabase credentials, live writes, HTTP or SMS/Meta providers.
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixture, actor, ids, actors, A, B, S, sql, migration, snapshot } = require('./support/long-absent-sql-fixture.cjs');
const editMigration = '20261028044629_shared_long_absent_edit.sql';
const endpoint = 'public.update_shared_long_absent_lead(text,jsonb,jsonb)';
const clone = value => JSON.parse(JSON.stringify(value));

const row = async (db, id, table = 'app_leads') => (await db.query(`select * from ${table} where id=$1`, [id])).rows[0];
const expected = row => ({ ...row.data, id: row.id });
const rpc = (db, id, patch, data) => db.query('select public.update_shared_long_absent_lead($1,$2::jsonb,$3::jsonb) as result', [id, JSON.stringify(patch), JSON.stringify(data)]);
async function reject(db, fn, label, pattern) {
  await db.exec('savepoint rejected_request');
  try { await assert.rejects(fn, pattern, label); }
  finally { await db.exec('rollback to savepoint rejected_request; release savepoint rejected_request'); }
}

// A transaction models one user's session; actor() always rolls it back. Changes
// are asserted before rollback, and each scenario starts with the same fixtures.
test('shared long-absence editing: real PostgreSQL permissions, atomic writes and stale-state protection', async t => {
  const db = await fixture();
  try {
    // Include the real normalization functions/trigger used before the field
    // permission guard in production. Never execute their historical backfills.
    const pivot=fs.readFileSync(path.resolve(__dirname,'../supabase/V28_6_1_PIVOT_FIX.sql'),'utf8');
    const extract=(source,name)=>{const found=source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`,'i'));assert.ok(found,name);return found[0];};
    for(const name of ['lawpower_normalize_debt_range','lawpower_normalize_income_range']) await db.exec(extract(pivot,name));
    await db.exec(extract(sql('010_weekend_consult_time_search_fix.sql'),'normalize_app_lead_pivot_fields'));
    await db.exec('create trigger trg_app_leads_normalize_pivot before insert or update of data on app_leads for each row execute function public.normalize_app_lead_pivot_fields()');
    await db.exec(migration);
    await db.exec(sql('004_db_lead_delete_permission.sql'));
    await db.exec(sql('20261027090340_long_absent_shared_read.sql'));
    // Reproduce Supabase's explicit default grants, not just PUBLIC inheritance.
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role');
    const extraActors = {
      assignee: ['30000000-0000-4000-8000-000000000001', A, 'staff', 'staff', true, true, 'Eligible'],
      foreign: ['30000000-0000-4000-8000-000000000002', B, 'staff', 'staff', true, true, 'Foreign'],
      disabled: ['30000000-0000-4000-8000-000000000003', A, 'staff', 'staff', false, true, 'Disabled'],
      nonwork: ['30000000-0000-4000-8000-000000000004', A, 'staff', 'staff', true, false, 'Nonwork'],
      super: ['30000000-0000-4000-8000-000000000005', null, 'admin', 'super_admin', true, false, 'Global'],
    };
    for (const [key, [id, firm, role, platform, active, work, name]] of Object.entries(extraActors)) {
      actors[key] = id;
      await db.query('insert into auth.users values($1)', [id]);
      await db.query(`insert into profiles(id,law_firm_id,role,platform_role,is_active,is_work_staff,permissions,staff_name,display_name)
        values($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [id, firm, role, platform, active, work, {'db.view':true}, name]);
    }
    // Normal staff intentionally has no individual edit bits: shared scope must
    // be usable, without granting any global permission or modifying profiles.
    await db.query('update profiles set permissions=$1 where id=any($2::uuid[])', [{'db.view':true}, [actors.normal,actors.suspended]]);
    const seeds = [
      ['shared', {detailStage:'장기부재',status:'종결_중단'}, A],
      ['own-absent', {detailStage:'장기부재',status:'종결_중단',assignedStaff:'SELF'}, A],
      ['legacy-absent', {status:'종결_중단'}, A],
      ['null-absent', {detailStage:null,status:'종결_중단'}, A],
      ['explicit-other', {detailStage:'상담',status:'종결_중단'}, A],
      ['empty-stage', {detailStage:'',status:'종결_중단'}, A],
      ['malformed-stage', {detailStage:['장기부재'],status:'종결_중단'}, A],
      ['foreign-absent', {detailStage:'장기부재',status:'종결_중단'}, B],
      ['suspended-absent', {detailStage:'장기부재',status:'종결_중단'}, S],
    ];
    for (const [id, data, firm] of seeds) await db.query('insert into app_leads(id,data,law_firm_id) values($1,$2,$3)',
      [id, {id, name:'Synthetic lead', phone:'010-0000-0001', assignedStaff:'OTHER', consultation:{memo:'preserved'}, sourceExternalKey:'immutable-import', ...data}, firm]);
    // Existing linked records are explicitly created before the lead, so a shared
    // update cannot silently manufacture a customer or a new contract.
    await db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)', ['client-shared', {id:'client-shared',fromLeadId:'linked-shared',name:'Synthetic linked',phone:'010-0000-0002',assignedStaff:'OTHER'}, A]);
    await db.query('insert into app_cases(id,data,law_firm_id) values($1,$2,$3)', ['case-shared', {id:'case-shared',clientId:'client-shared',fromLeadId:'linked-shared',assignedStaff:'OTHER',caseType:'개인회생',contractAmount:1250000,paidAmount:300000,stage:'착수'}, A]);
    await db.query('insert into app_leads(id,data,law_firm_id) values($1,$2,$3)', ['linked-shared', {id:'linked-shared',name:'Synthetic linked',phone:'010-0000-0002',assignedStaff:'OTHER',detailStage:'장기부재',status:'수임전환',convertedClientId:'client-shared',convertedCaseId:'case-shared',applicationType:'개인회생'}, A]);

    const policies = async () => (await db.query("select * from pg_policies order by schemaname,tablename,policyname")).rows;
    const guards = async () => (await db.query(`select proname,prosrc,prosecdef,proconfig from pg_proc
      where pronamespace='public'::regnamespace and proname in ('enforce_lead_update_permissions','sync_converted_lead_phone_to_client','sync_converted_lead_core_fields') order by proname`)).rows.map(fn => ({...fn,prosrc:fn.prosrc.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()}));
    const beforeData = await snapshot(db), beforePolicies = await policies(), beforeGuards = await guards();
    await t.test('migration is repeatable and changes no existing policies, profiles or customer rows', async () => {
      const source = sql(editMigration);
      assert.ok(source.trim(), 'migration must contain the reviewed implementation');
      await db.exec(source);
      assert.deepEqual(await snapshot(db), beforeData);
      assert.deepEqual(await policies(), beforePolicies);
      await db.exec(source);
      assert.deepEqual(await snapshot(db), beforeData);
      assert.deepEqual(await policies(), beforePolicies);
    });

    await t.test('public entrypoint is invoker-only and anonymous/service callers have no new function privilege', async () => {
      const access = (await db.query(`select p.prosecdef,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon,
        has_function_privilege('service_role',p.oid,'EXECUTE') as service
        from pg_proc p where p.oid=$1::regprocedure`, [endpoint])).rows[0];
      assert.deepEqual(access, {prosecdef:false,authenticated:true,anon:false,service:false});
      const privateFunctions = (await db.query(`select n.nspname,p.proname,p.prosecdef,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon,
        has_function_privilege('service_role',p.oid,'EXECUTE') as service
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname like '%long_absent%'`)).rows;
      assert.ok(privateFunctions.some(fn => fn.prosecdef), 'privileged implementation belongs in a private schema');
      assert.ok(privateFunctions.every(fn => !fn.anon && !fn.service));
      await db.exec('begin; set local role anon');
      try { await assert.rejects(() => rpc(db,'shared',{memo:'denied'},expected(beforeData.app_leads.find(r => r.id==='shared'))), /permission denied/); }
      finally { await db.exec('rollback'); }
    });

    await t.test('db.view-only staff can persist consultation, memo edits, reservations and contact records with audit', async () => {
      const source = await row(db, 'shared');
      await actor(db,'normal',async () => {
        const countBefore = (await db.query('select count(*)::int n from app_change_logs')).rows[0].n;
        const patch = {consultation:{memo:'journal changed',memoLog:[{id:'memo-1',text:'Collaborative note',at:'2026-10-28T04:00:00Z',staff:'SELF'}]},memo:'summary',reservationAt:'2026-10-29T10:30',
          contactLog:[{id:'contact-1',at:'2026-10-28T04:00:00Z',staff:'spoofed',type:'phone',connected:true,durationSeconds:12,note:'synthetic'}],invalidReason:'기타',nonContractReason:'진행 보류'};
        const result = (await rpc(db,'shared',patch,expected(source))).rows[0].result;
        assert.equal(result.id,'shared'); assert.equal(result.law_firm_id,A);
        const saved = await row(db,'shared');
        assert.deepEqual(result.data,saved.data);
        assert.deepEqual(saved.data.consultation,patch.consultation);
        assert.equal(saved.data.memo,'summary'); assert.equal(saved.data.reservationAt,patch.reservationAt);
        assert.equal(saved.data.contactLog[0].staff,'SELF','existing actor-stamping trigger remains active');
        assert.equal(saved.data.sourceExternalKey,source.data.sourceExternalKey);
        // The ordinary role may not read change logs; the RPC response and data
        // persistence are checked here, server-side audit is checked below.
        assert.ok((await db.query('select count(*)::int n from app_change_logs')).rows[0].n >= countBefore);
        const again = {...saved.data.consultation,memoLog:[{...saved.data.consultation.memoLog[0],text:'Edited collaborative note'}]};
        await rpc(db,'shared',{consultation:again,reservationAt:null},expected(saved));
        const edited = await row(db,'shared');
        assert.equal(edited.data.consultation.memoLog[0].text,'Edited collaborative note');
        assert.equal(edited.data.reservationAt,undefined,'null patch removes an optional field');
      });
      // Inspect the audit using the owner only, within the same transaction.
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.normal]);
        await db.exec('set local role authenticated');
        await rpc(db,'shared',{memo:'audited'},expected(source));
        await db.exec('reset role');
        const logs = (await db.query("select * from app_change_logs where id <> 'log'")).rows;
        assert.equal(logs.length,1); assert.equal(logs[0].law_firm_id,A);
        assert.equal(logs[0].data.staff,'SELF'); assert.equal(logs[0].data.category,'DB관리');
      } finally { await db.exec('rollback'); }
    });

    await t.test('ownership transfer validates active same-firm work staff and remains shared until stage exit', async () => {
      const source = await row(db,'shared');
      await actor(db,'normal',async () => {
        await rpc(db,'shared',{assignedStaff:'Eligible'},expected(source));
        const reassigned=await row(db,'shared'); assert.equal(reassigned.data.assignedStaff,'Eligible');
        await rpc(db,'shared',{memo:'still shared'},expected(reassigned));
        for(const name of ['Foreign','Disabled','Nonwork','Missing','SELF','']) {
          await reject(db,()=>rpc(db,'shared',{assignedStaff:name},expected({...reassigned,data:{...reassigned.data,memo:'still shared'}})), `reject assignee ${name}`);
        }
      });
    });

    await t.test('stage exit succeeds once, then immediately revokes the shared path and read visibility', async () => {
      const source=await row(db,'shared');
      await actor(db,'normal',async () => {
        const result=(await rpc(db,'shared',{detailStage:'상담',status:'상담완료'},expected(source))).rows[0].result;
        assert.equal(result.data.detailStage,'상담'); assert.equal(result.data.status,'상담완료');
        assert.ok(!(await ids(db,'app_leads')).includes('shared'));
        await reject(db,()=>rpc(db,'shared',{memo:'not allowed after exit'},expected(result)));
        await reject(db,()=>rpc(db,'shared',{detailStage:'장기부재'},expected(result)));
        await reject(db,()=>rpc(db,'shared',{memo:'old stale draft'},expected(source)));
      });
    });

    await t.test('concurrent/stale consultation and ownership snapshots cannot overwrite a newer save', async () => {
      const source=await row(db,'shared');
      await actor(db,'normal',async () => {
        await rpc(db,'shared',{consultation:{memo:'first save'}},expected(source));
        await reject(db,()=>rpc(db,'shared',{consultation:{memo:'stale overwrite'}},expected(source)));
        await reject(db,()=>rpc(db,'shared',{assignedStaff:'Eligible'},expected(source)));
        assert.equal((await row(db,'shared')).data.consultation.memo,'first save');
      });
    });

    await t.test('writer, stale writer flags, inactive, suspended, foreign and missing-view roles cannot use shared writes', async () => {
      const source=await row(db,'shared');
      for(const key of ['writer','legacy','inactive','suspended','foreign','basic']) await actor(db,key,()=>reject(db,()=>rpc(db,'shared',{memo:key},expected(source)),key));
      const suspended=await row(db,'suspended-absent');
      await actor(db,'suspended',()=>reject(db,()=>rpc(db,'suspended-absent',{memo:'denied'},expected(suspended))));
      await db.exec('begin; set local role authenticated');
      try {
        await db.query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','authenticated',true)");
        await reject(db,()=>rpc(db,'shared',{memo:'no identity'},expected(source)));
      } finally { await db.exec('rollback'); }
    });

    await t.test('only exact long-absence and null/missing fallback qualify; normal and cross-tenant rows remain unavailable', async () => {
      for(const id of ['legacy-absent','null-absent','own-absent']) {
        const source=await row(db,id);
        await actor(db,'normal',async()=>{await rpc(db,id,{memo:'allowed fallback'},expected(source)); assert.equal((await row(db,id)).data.memo,'allowed fallback');});
      }
      for(const id of ['explicit-other','empty-stage','malformed-stage','foreign-absent','consult','work']) {
        const source=await row(db,id);
        await actor(db,'normal',()=>reject(db,()=>rpc(db,id,{memo:'denied'},expected(source)),id));
      }
    });

    await t.test('arbitrary JSON keys, tenant/identity/lineage/conversion changes and malformed payloads are rejected atomically', async () => {
      const source=await row(db,'shared');
      const fields={id:'replacement',_lawFirmId:B,law_firm_id:B,convertedClientId:'client-foreign',convertedCaseId:'case-foreign',source:'forged',sourceExternalKey:'forged',ad_source_id:'00000000-0000-4000-8000-000000000000',created_by:actors.foreign,stageUpdatedAt:'1900-01-01',__proto_forbidden:'x'};
      await actor(db,'normal',async()=>{
        for(const [key,value] of Object.entries(fields)) await reject(db,()=>rpc(db,'shared',{memo:'must roll back',[key]:value},expected(source)),key);
        for(const patch of [null,[],{},'text',{assignedStaff:null},{phone:[]},{consultation:[]},{detailStage:'not-a-stage'},{status:'not-a-status'}]) await reject(db,()=>rpc(db,'shared',patch,expected(source)),JSON.stringify(patch));
        assert.deepEqual((await row(db,'shared')).data,source.data);
      });
    });

    await t.test('malformed fields and invalid dates/contact entries fail atomically, while existing contact history is append-only', async () => {
      const source=await row(db,'shared');
      await actor(db,'normal',async()=>{
        for(const patch of [{email:{}},{email:'x'.repeat(321)},{memo:[]},{memo:'x'.repeat(20001)},{reservationAt:[]},{reservationAt:'tomorrow'},{reservationAt:'2026-02-30T10:00'},{reservationAt:'infinity'},
          {invalidReason:'forged'},{nonContractReason:'forged'},{replacementRequestedAt:'infinity'},
          {contactLog:[{id:'bad',at:'2026-10-28T00:00:00Z',type:'call'}]},{contactLog:[{id:'bad',at:'not-a-date',type:'phone'}]},
          {contactLog:[{id:'bad',at:'2026-10-28T00:00:00Z',type:'phone',durationSeconds:-1}]},{contactLog:[{id:'bad',at:'2026-10-28T00:00:00Z',type:'phone',connected:'yes'}]}])
          await reject(db,()=>rpc(db,'shared',patch,expected(source)));
        const first={id:'existing-contact',at:'2026-10-28T04:00:00Z',staff:'forged',type:'phone',note:'Original'};
        await rpc(db,'shared',{contactLog:[first]},expected(source));
        let saved=await row(db,'shared');
        await rpc(db,'shared',{contactLog:[{...first,staff:'forged',note:'Cannot rewrite history'},{id:'new-contact',at:'2026-10-28T04:01:00Z',staff:'forged',type:'sms'}]},expected(saved));
        saved=await row(db,'shared');
        assert.equal(saved.data.contactLog.length,2);
        assert.equal(saved.data.contactLog.find(x=>x.id==='existing-contact').note,'Original');
        assert.ok(saved.data.contactLog.every(x=>x.staff==='SELF'));
        await rpc(db,'shared',{contactLog:[]},expected(saved));
        assert.equal((await row(db,'shared')).data.contactLog.length,2,'old contact rows cannot be erased');
      });
    });

    await t.test('direct PATCH cannot forge server-derived fields through the shared trigger exception', async () => {
      await db.exec('begin');
      try {
        await db.query('update profiles set permissions=$1 where id=$2',[{'db.view':true,'db.edit_consultation':true},actors.normal]);
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.normal]);
        await db.exec('set local role authenticated');
        for(const patch of [{stageUpdatedAt:'1900-01-01'},{debtRange:'1억원 이상'},{incomeRange:'400만원 이상'},{consultTime:'평일 오전(9시~12시)'}])
          await reject(db,()=>db.query("update app_leads set data=data||$1 where id='own-absent'",[patch]));
      } finally { await db.exec('rollback'); }
    });
    await t.test('raw conversion-status alias is denied through the RPC and the direct UPDATE trigger path', async () => {
      const source=await row(db,'shared');
      await actor(db,'normal',()=>reject(db,()=>rpc(db,'shared',{status:'수임전환'},expected(source))));
      // all has existing db.view_all + db.edit_basic, but not change_stage or
      // convert. The shared trigger exception must not become a back door.
      await actor(db,'all',()=>reject(db,()=>db.query("update app_leads set data=data||'{\"status\":\"수임전환\"}' where id='shared' returning id")));
      const converted=await row(db,'linked-shared');
      await actor(db,'normal',async()=>{
        await rpc(db,'linked-shared',{status:'수임전환',memo:'already converted remains valid'},expected(converted));
        assert.equal((await row(db,'linked-shared')).data.status,'수임전환');
      });
    });
    await t.test('direct table UPDATE/mass update/DELETE/conversion gain no shared privilege and existing admin rights remain', async () => {
      await actor(db,'normal',async()=>{
        assert.equal((await db.query("update app_leads set data=data||'{\"memo\":\"direct\"}' where id in ('shared','explicit-other','foreign-absent') returning id")).rows.length,0);
        assert.equal((await db.query("update app_leads set data=data||'{\"assignedStaff\":\"SELF\",\"detailStage\":\"상담\"}' where id='shared' returning id")).rows.length,0);
        assert.equal((await db.query("delete from app_leads where id='shared' returning id")).rows.length,0);
        await reject(db,()=>db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)',['new-client',{fromLeadId:'shared',assignedStaff:'OTHER'},A]));
        await reject(db,()=>db.query('insert into app_cases(id,data,law_firm_id) values($1,$2,$3)',['new-case',{fromLeadId:'shared',clientId:'client-work',assignedStaff:'OTHER'},A]));
      });
      await actor(db,'admin',async()=>assert.equal((await db.query("update app_leads set data=data||'{\"memo\":\"admin existing\"}' where id='explicit-other' returning id")).rows.length,1));
      await actor(db,'super',async()=>assert.equal((await db.query("update app_leads set data=data||'{\"memo\":\"super existing\"}' where id='foreign-absent' returning id")).rows.length,1));
    });

    await t.test('converted lead journal/memo/reservation remain shared while unrelated-client propagated fields do not', async () => {
      const source=await row(db,'linked-shared');
      await actor(db,'normal',async()=>{
        await rpc(db,'linked-shared',{consultation:{memo:'Shared converted journal'},memo:'Shared converted summary',reservationAt:'2026-10-29T11:00'},expected(source));
        const saved=await row(db,'linked-shared');
        assert.equal(saved.data.consultation.memo,'Shared converted journal');
        for(const patch of [{name:'Outside scope'},{phone:'010-0000-5555'},{applicationType:'개인파산'},{assignedStaff:'Eligible'}])
          await reject(db,()=>rpc(db,'linked-shared',patch,expected(saved)));
      });
    });
    await t.test('linked customer/contact/direction/assignee synchronization stays atomic and does not touch financial fields', async () => {
      const source=await row(db,'linked-shared');
      const originalClient=await row(db,'client-shared','app_clients'), originalCase=await row(db,'case-shared','app_cases');
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.all]);
        await db.exec('set local role authenticated');
        await rpc(db,'linked-shared',{name:'Corrected',phone:'010-0000-9999',applicationType:'개인파산',assignedStaff:'Eligible'},expected(source));
        await db.exec('reset role');
        const client=await row(db,'client-shared','app_clients'), record=await row(db,'case-shared','app_cases');
        assert.equal(client.data.name,'Corrected'); assert.equal(client.data.phone,'010-0000-9999'); assert.equal(client.data.assignedStaff,'Eligible');
        assert.equal(record.data.caseType,'개인파산'); assert.equal(record.data.assignedStaff,'Eligible');
        assert.equal(record.data.contractAmount,originalCase.data.contractAmount); assert.equal(record.data.paidAmount,originalCase.data.paidAmount);
        assert.equal(client.data.fromLeadId,originalClient.data.fromLeadId); assert.equal(record.data.fromLeadId,originalCase.data.fromLeadId);
      } finally { await db.exec('rollback'); }
    });

    await t.test('shared edits cannot turn a prior conversion-pointer write into access to another assignee legacy client', async () => {
      await db.exec('begin');
      try {
        await db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)', ['unrelated-legacy', {id:'unrelated-legacy',name:'Unrelated synthetic',phone:'010-0000-7777',assignedStaff:'SOMEONE_ELSE'}, A]);
        await db.query('update profiles set permissions=$1 where id=$2',[{'db.view':true,'db.convert':true},actors.normal]);
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.normal]);
        await db.exec('set local role authenticated');
        // Existing conversion permission allows changing the pointer in an
        // earlier request; the phone trigger was explicitly hardened for this.
        await db.query("update app_leads set data=data||'{\"convertedClientId\":\"unrelated-legacy\"}' where id='own-absent'");
        const source=await row(db,'own-absent');
        await reject(db,()=>rpc(db,'own-absent',{phone:'010-0000-9999'},expected(source)));
        await reject(db,()=>db.query("update app_leads set data=data||'{\"phone\":\"010-0000-9999\"}' where id='own-absent'"));
        await db.exec('reset role');
        assert.equal((await row(db,'unrelated-legacy','app_clients')).data.phone,'010-0000-7777');
      } finally { await db.exec('rollback'); }
    });
    await t.test('deleted-source identity impersonation cannot acquire another assignee retained client phone', async () => {
      await db.exec('begin');
      try {
        await db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)', ['retained-client', {id:'retained-client',fromLeadId:'deleted-source',name:'Retained synthetic',phone:'010-0000-6666',assignedStaff:'SOMEONE_ELSE'}, A]);
        await db.query('update profiles set permissions=$1 where id=$2',[{'db.view':true,'db.convert':true,'db.edit_basic':true},actors.normal]);
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.normal]);
        await db.exec('set local role authenticated');
        await db.query("update app_leads set id='deleted-source',data=data||'{\"convertedClientId\":\"retained-client\"}' where id='own-absent'");
        const source=await row(db,'deleted-source');
        await reject(db,()=>rpc(db,'deleted-source',{phone:'010-0000-9999'},expected(source)));
        await reject(db,()=>db.query("update app_leads set data=data||'{\"phone\":\"010-0000-9999\"}' where id='deleted-source'"));
        await db.exec('reset role');
        assert.equal((await row(db,'retained-client','app_clients')).data.phone,'010-0000-6666');
      } finally { await db.exec('rollback'); }
    });

    await t.test('prior conversion-pointer write cannot acquire another assignee legacy client through shared reassignment', async () => {
      await db.exec('begin');
      try {
        await db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)', ['unrelated-core', {id:'unrelated-core',name:'Unrelated synthetic',phone:'010-0000-5555',assignedStaff:'SOMEONE_ELSE'}, A]);
        await db.query('update profiles set permissions=$1 where id=$2',[{'db.view':true,'db.convert':true},actors.normal]);
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.normal]);
        await db.exec('set local role authenticated');
        await db.query("update app_leads set data=data||'{\"convertedClientId\":\"unrelated-core\"}' where id='own-absent'");
        const source=await row(db,'own-absent');
        await reject(db,()=>rpc(db,'own-absent',{assignedStaff:'Eligible'},expected(source)));
        await reject(db,()=>db.query("update app_leads set data=data||'{\"assignedStaff\":\"Eligible\"}' where id='own-absent'"));
        await db.exec('reset role');
        assert.equal((await row(db,'unrelated-core','app_clients')).data.assignedStaff,'SOMEONE_ELSE');
      } finally { await db.exec('rollback'); }
    });
    await t.test('shared-only direct reassignment cannot propagate through a mismatched related case', async () => {
      await db.exec('begin');
      try {
        await db.query('insert into app_cases(id,data,law_firm_id) values($1,$2,$3)', ['mismatched-case', {id:'mismatched-case',clientId:'client-consult',fromLeadId:'linked-shared',assignedStaff:'UNRELATED',caseType:'개인회생'}, A]);
        const source=await row(db,'linked-shared');
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.all]);
        await db.exec('set local role authenticated');
        await reject(db,()=>rpc(db,'linked-shared',{assignedStaff:'Eligible'},expected(source)));
        await reject(db,()=>db.query("update app_leads set data=data||'{\"assignedStaff\":\"Eligible\"}' where id='linked-shared'"));
        await db.exec('reset role');
        assert.equal((await row(db,'mismatched-case','app_cases')).data.assignedStaff,'UNRELATED');
      } finally { await db.exec('rollback'); }
    });
    await t.test('bad converted linkage cannot trigger another customer update or orphan reconstruction', async () => {
      // Seed corruption as owner in an isolated savepoint. The shared RPC must
      // not convert/create or repair customer/case rows with broadened rights.
      for(const change of [
        {convertedClientId:'client-foreign'},
        {convertedClientId:'missing-client'},
        {convertedCaseId:'missing-case'},
      ]) {
        await db.exec('begin');
        try {
          // Disable only automatic repair for fixture preparation, restore it
          // before exercising the actual production execution path.
          await db.exec("select set_config('request.jwt.claim.role','service_role',true)");
          await db.exec('alter table app_leads disable trigger trg_app_leads_ensure_converted_records');
          await db.query("update app_leads set data=data||$1 where id='linked-shared'",[change]);
          await db.exec('alter table app_leads enable trigger trg_app_leads_ensure_converted_records');
          const source=await row(db,'linked-shared'), before=await snapshot(db);
          await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.normal]);
          await db.exec('set local role authenticated');
          await reject(db,()=>rpc(db,'linked-shared',{memo:'must not repair'},expected(source)));
          await db.exec('reset role');
          assert.deepEqual(await snapshot(db),before);
        } finally { await db.exec('rollback'); }
      }
    });
    await t.test('no-op saves create no audit or side effect; an audit failure rolls back linked edits atomically', async () => {
      const source=await row(db,'linked-shared');
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.all]);
        await db.exec('set local role authenticated');
        await rpc(db,'linked-shared',{name:source.data.name},expected(source));
        await db.exec('reset role');
        assert.deepEqual(await snapshot(db),beforeData,'no-op creates no audit record and invokes no update trigger');
        await db.exec("alter table app_change_logs add constraint test_reject_new_logs check(id='log')");
        await db.exec('set local role authenticated');
        await reject(db,()=>rpc(db,'linked-shared',{name:'Cannot partially save',assignedStaff:'Eligible'},expected(source)),undefined,/test_reject_new_logs/);
        assert.equal((await db.query("select current_setting('request.jwt.claim.role',true) role")).rows[0].role,'authenticated');
        await db.exec('reset role');
        assert.deepEqual(await snapshot(db),beforeData,'audit insertion and all linked edits form one transaction');
      } finally { await db.exec('rollback'); }
    });

    await t.test('a linked-case failure restores all rows and the temporary service-role claim', async () => {
      const source=await row(db,'linked-shared');
      await db.exec('begin');
      try {
        await db.exec("alter table app_cases add constraint test_case_assignment_reject check(id<>'case-shared' or data->>'assignedStaff'='OTHER')");
        await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[actors.all]);
        await db.exec('set local role authenticated');
        await reject(db,()=>rpc(db,'linked-shared',{assignedStaff:'Eligible'},expected(source)),undefined,/test_case_assignment_reject/);
        assert.equal((await db.query("select current_setting('request.jwt.claim.role',true) role")).rows[0].role,'authenticated');
        await db.exec('reset role');
        assert.deepEqual(await snapshot(db),beforeData);
      } finally { await db.exec('rollback'); }
    });
    await t.test('rollback restores exact prior guard logic and read-only shared access without data changes', async () => {
      const rollback=fs.readFileSync(path.resolve(__dirname,'../docs/shared-longabsence-edit-rollback.sql'),'utf8');
      await db.exec(rollback);
      assert.equal((await db.query('select to_regprocedure($1) as endpoint',[endpoint])).rows[0].endpoint,null);
      assert.deepEqual(await guards(),beforeGuards,'pre-existing function bodies restored (ignoring comments/whitespace only)');
      assert.deepEqual(await policies(),beforePolicies);
      assert.deepEqual(await snapshot(db),beforeData);
      await actor(db,'normal',async()=>{
        assert.ok((await ids(db,'app_leads')).includes('shared'),'previous shared SELECT remains');
        assert.equal((await db.query("update app_leads set data=data||'{\"memo\":\"denied\"}' where id='shared' returning id")).rows.length,0);
      });
      // Safe retry/reapply after a complete rollback must be supported too.
      await db.exec(rollback);
      await db.exec(sql(editMigration));
      assert.deepEqual(await snapshot(db),beforeData);
      assert.deepEqual(await policies(),beforePolicies);
    });
    assert.deepEqual(await policies(),beforePolicies,'every existing RLS policy preserved through all exercises');
    assert.deepEqual(await snapshot(db),beforeData,'all scenario transactions rolled back and migration did not mutate rows');
  } finally { await db.close(); }
});
