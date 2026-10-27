const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, actor, ids, actors, A, B, S, sql, migration, snapshot } = require('./support/long-absent-sql-fixture.cjs');
const patch = sql('20261027090340_long_absent_shared_read.sql');

test('shared long-absent read: actual PostgreSQL RLS, unchanged write rights and writer/tenant isolation', async t => {
  const db = await fixture();
  try {
    await db.exec(migration);
    // Include the actual delete policy (the historical writer fixture starts at 002).
    await db.exec(sql('004_db_lead_delete_permission.sql'));
    const rows = [
      ['shared', {detailStage:'장기부재',status:'부재중'}, A],
      ['legacy', {status:'종결_중단'}, A],
      ['null-stage', {detailStage:null,status:'종결_중단'}, A],
      ['explicit-other', {detailStage:'상담',status:'종결_중단'}, A],
      ['empty-stage', {detailStage:'',status:'종결_중단'}, A],
      ['malformed-stage', {detailStage:['장기부재'],status:'종결_중단'}, A],
      ['foreign-absent', {detailStage:'장기부재'}, B],
      ['suspended-absent', {detailStage:'장기부재'}, S],
    ];
    for (const [id,data,firm] of rows) await db.query('insert into app_leads(id,data,law_firm_id) values($1,$2,$3)', [id, {id,name:'합성 고객',assignedStaff:'OTHER',...data},firm]);
    // Exercise every mutation permission without granting full read scope.
    const editPerms = {'db.view':true,'db.create':true,'db.edit_basic':true,'db.edit_consultation':true,'db.change_stage':true,'db.change_assignee':true,'db.manage_reservation':true,'db.convert':true,'db.delete':true};
    await db.query('update profiles set permissions=$1 where id=$2',[editPerms,actors.normal]);
    await db.query('update profiles set permissions=$1 where id=$2',[{...editPerms,'db.view_all':true},actors.all]);
    const before = await snapshot(db);
    const policies = async () => (await db.query("select * from pg_policies where schemaname='public' and policyname <> 'app_leads_long_absent_shared_read' order by tablename,policyname")).rows;
    const beforePolicies = await policies();
    const beforeAccess = {};
    for (const key of Object.keys(actors)) beforeAccess[key] = await actor(db,key,()=>ids(db,'app_leads'));
    const mutations = async key => actor(db,key,async () => {
      const result = {};
      for (const id of ['shared','consult','work','foreign-absent']) {
        result[id] = {};
        for (const [field,value] of Object.entries({memo:'edit',detailStage:'상담',assignedStaff:'SELF',consultation:{memo:'edit'},reservationAt:'2026-10-28',convertedClientId:'attempt-client',convertedCaseId:'attempt-case'})) {
          await db.exec('savepoint attempt');
          try { result[id][field] = (await db.query('update app_leads set data=data||$1::jsonb where id=$2 returning id',[JSON.stringify({[field]:value}),id])).rows.length; }
          catch (error) { result[id][field] = `denied:${error.code}`; }
          finally { await db.exec('rollback to savepoint attempt; release savepoint attempt'); }
        }
        result[id].delete = (await db.query('delete from app_leads where id=$1 returning id',[id])).rows.length;
      }
      for (const [table,data] of [
        ['app_clients',{fromLeadId:'shared',assignedStaff:'OTHER',name:'synthetic'}],
        ['app_cases',{fromLeadId:'shared',clientId:'client-work',assignedStaff:'OTHER'}],
      ]) {
        await db.exec('savepoint conversion');
        try { result[table] = (await db.query(`insert into ${table}(id,data,law_firm_id) values($1,$2,$3) returning id`,['conversion-attempt',data,A])).rows.length; }
        catch (error) { result[table] = `denied:${error.code}`; }
        finally { await db.exec('rollback to savepoint conversion; release savepoint conversion'); }
      }
      return result;
    });
    const writesBefore = {};
    for (const key of ['normal','all','admin','writer','inactive','suspended','basic']) writesBefore[key] = await mutations(key);
    await db.exec(patch);
    assert.deepEqual(await snapshot(db), before, 'migration must not mutate customer/config data');
    assert.deepEqual(await policies(), beforePolicies, 'all existing policies stay byte-equivalent');
    await t.test('same-firm ordinary staff gains only long-absent and legacy fallback reads', async () => {
      assert.deepEqual(await actor(db,'normal',()=>ids(db,'app_leads')), [...beforeAccess.normal,'shared','legacy','null-stage'].sort());
      assert.equal((await actor(db,'normal',()=>db.query("select id from app_leads where id='shared'"))).rows.length,1);
    });
    await t.test('writers excluded, including obsolete broad permissions; inactive and foreign tenants denied', async () => {
      for (const key of ['writer','legacy','inactive','suspended','basic']) assert.deepEqual(await actor(db,key,()=>ids(db,'app_leads')), beforeAccess[key]);
      for (const key of ['normal','writer','all','admin']) assert.ok(!(await actor(db,key,()=>ids(db,'app_leads'))).includes('foreign-absent'));
      await db.exec('begin; set local role anon');
      try { assert.deepEqual(await ids(db,'app_leads'),[]); } finally { await db.exec('rollback'); }
    });
    await t.test('UPDATE, self-reassignment, stage, memo, consultation, reservation and DELETE rights unchanged', async () => {
      for (const key of Object.keys(writesBefore)) assert.deepEqual(await mutations(key), writesBefore[key],key);
      assert.equal(writesBefore.normal.shared.memo,0);
      assert.equal(writesBefore.normal.shared.assignedStaff,0);
      assert.equal(writesBefore.normal.shared.delete,0);
      assert.equal(writesBefore.normal.shared.convertedClientId,0);
      assert.match(writesBefore.normal.app_clients,/^denied:/);
      assert.match(writesBefore.normal.app_cases,/^denied:/);
      assert.equal(writesBefore.normal.consult.memo,1);
      assert.equal(writesBefore.all.shared.memo,1);
    });
    await t.test('sharing ends immediately when the row leaves long-absent', async () => {
      await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
      await db.query("update app_leads set data=data||'{\"detailStage\":\"상담\"}' where id='shared'");
      await db.exec("select set_config('request.jwt.claim.role','',false)");
      assert.ok(!(await actor(db,'normal',()=>ids(db,'app_leads'))).includes('shared'));
    });
  } finally { await db.close(); }
});
