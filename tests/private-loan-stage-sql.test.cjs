// Offline PostgreSQL/WASM only. Existing RLS/trigger definitions and synthetic
// rows exercise the new stage without live credentials, HTTP or SMS providers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  fixture, actor, denied, ids, actors, A, B, S, sql, migration, snapshot,
} = require('./support/long-absent-sql-fixture.cjs');
const migrationName = '20261113095617_private_loan_connection_stage.sql';
const patch = sql(migrationName).replaceAll('\r\n', '\n');
const writerSignature = 'public.is_writing_lead_data(jsonb)';
const sharedSignature = 'long_absent_private.update_lead(text,jsonb,jsonb)';
const extract = (source, name) => {
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n$$;', start);
  assert.ok(end > start, name);
  return source.slice(start, end + 4);
};
const oldWriter = extract(migration, 'public.is_writing_lead_data');
const oldShared = extract(sql('20261028044629_shared_long_absent_edit.sql').replaceAll('\r\n', '\n'), 'long_absent_private.update_lead');
const read = async (db, id) => (await db.query('select data from app_leads where id=$1', [id])).rows[0]?.data;
const sharedSave = (db, id, data, changes) => db.query(
  'select public.update_shared_long_absent_lead($1,$2::jsonb,$3::jsonb) result', [id, JSON.stringify(changes), JSON.stringify({...data, id})]);

test('stage migration is exactly two allowlist additions with no other DDL/DML', () => {
  const functionNames = ['public.is_writing_lead_data', 'long_absent_private.update_lead'];
  let remainder = patch;
  for (const [index, name] of functionNames.entries()) {
    const current = extract(patch, name);
    assert.equal(current.split("'사채연결',").length - 1, 1);
    assert.equal(current.replace("'사채연결',", ''), [oldWriter, oldShared][index]);
    remainder = remainder.replace(current, '');
  }
  assert.equal(remainder.replace(/--[^\n]*/g, '').replace(/\s+/g, '').toLowerCase(), 'begin;commit;');
});

test('private-loan stage: current writer and long-absence SQL in isolated PostgreSQL', async t => {
  const db = await fixture();
  try {
    // Production normalization is used by the shared-edit field guard. Extract
    // functions only, never historical backfills from the source migrations.
    const pivot = fs.readFileSync(path.resolve(__dirname, '../supabase/V28_6_1_PIVOT_FIX.sql'), 'utf8').replaceAll('\r\n', '\n');
    for (const name of ['lawpower_normalize_debt_range', 'lawpower_normalize_income_range']) {
      await db.exec(extract(pivot, `public.${name}`));
    }
    await db.exec(extract(sql('010_weekend_consult_time_search_fix.sql').replaceAll('\r\n', '\n'), 'public.normalize_app_lead_pivot_fields'));
    await db.exec('create trigger trg_app_leads_normalize_pivot before insert or update of data on app_leads for each row execute function public.normalize_app_lead_pivot_fields()');
    await db.exec(migration);
    await db.exec(sql('004_db_lead_delete_permission.sql'));
    await db.exec(sql('20261027090340_long_absent_shared_read.sql'));
    await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role');
    await db.exec(sql('20261028044629_shared_long_absent_edit.sql'));

    const seed = async (id, detailStage, firm = A) => db.query(
      'insert into app_leads(id,data,law_firm_id) values($1,$2,$3)',
      [id, {id, name:'Synthetic stage test', assignedStaff:'OTHER', detailStage, status:'계약진행중'}, firm]);
    await seed('private-loan', '사채연결');
    await seed('private-loan-foreign', '사채연결', B);
    await seed('shared', '장기부재');
    await seed('shared-foreign', '장기부재', B);
    await seed('shared-suspended', '장기부재', S);
    await db.query('insert into app_clients(id,data,law_firm_id) values($1,$2,$3)',
      ['private-client', {id:'private-client', fromLeadId:'private-loan', assignedStaff:'OTHER'}, A]);
    await db.query('insert into app_cases(id,data,law_firm_id) values($1,$2,$3)',
      ['private-case', {id:'private-case', fromLeadId:'private-loan', clientId:'private-client', assignedStaff:'OTHER', contractAmount:1000, paidAmount:0}, A]);
    await db.query('insert into app_installments(id,data,law_firm_id) values($1,$2,$3)',
      ['private-installment', {id:'private-installment', caseId:'private-case', status:'예정', amount:1000}, A]);
    await db.query('update profiles set permissions=$1 where id=$2', [{'db.view':true}, actors.normal]);

    const allFunctions = async () => (await db.query(`select n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')' signature, p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text,p.proowner
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','writing_staff_private','long_absent_private') order by p.oid`)).rows.map(fn=>({...fn,prosrc:fn.prosrc.replaceAll('\r\n','\n')}));
    const policies = async () => (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
    const triggers = async () => (await db.query(`select oid,tgrelid,tgname,pg_get_triggerdef(oid) definition from pg_trigger
      where not tgisinternal order by oid`)).rows;
    const beforeRows = await snapshot(db), beforeFunctions = await allFunctions(), beforePolicies = await policies(), beforeTriggers = await triggers();
    const scope = async key => actor(db, key, async () => ({
      leads:await ids(db,'app_leads'), clients:await ids(db,'app_clients'), cases:await ids(db,'app_cases'), installments:await ids(db,'app_installments'),
    }));
    const baselineScopes = Object.fromEntries(['normal','all','admin','inactive','suspended'].map(key => [key, null]));
    // actor() uses one connection/transaction; sessions must be run sequentially.
    for (const key of Object.keys(baselineScopes)) baselineScopes[key] = await scope(key);
    assert.ok(!(await actor(db,'writer',()=>ids(db,'app_leads'))).includes('private-loan'));
    await db.exec(patch);

    await t.test('apply/reapply changes no rows, policy, trigger, ACL or unrelated function', async () => {
      const verify = async () => {
        assert.deepEqual(await snapshot(db), beforeRows);
        assert.deepEqual(await policies(), beforePolicies);
        assert.deepEqual(await triggers(), beforeTriggers);
        const after = await allFunctions();
        assert.equal(after.length,beforeFunctions.length);
        for (const [index, fn] of after.entries()) {
          if ([writerSignature,sharedSignature].includes(fn.signature)) {
            assert.deepEqual({...fn,prosrc:fn.prosrc.replace("'사채연결',",'')},beforeFunctions[index]);
          } else assert.deepEqual(fn,beforeFunctions[index]);
        }
      };
      await verify(); await db.exec(patch); await verify();
    });
    await t.test('all old stage/fallback/invalid results preserved and exact new stage enabled', async () => {
      const ts = require('typescript'), Module = require('node:module');
      const filename = path.resolve(__dirname, '../lib/types.ts');
      const mod = new Module(filename); mod.filename=filename; mod.paths=module.paths;
      mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);
      for (const [detailStage, track] of Object.entries(mod.exports.DB_DETAIL_STAGE_TRACK_OF)) {
        assert.equal((await db.query('select public.is_writing_lead_data($1) ok',[{detailStage,status:'수임전환'}])).rows[0].ok,track !== '상담',detailStage);
      }
      for (const [status, stage] of Object.entries(mod.exports.DB_LEAD_DEFAULT_STAGE_BY_STATUS)) for (const data of [{status},{status,detailStage:null}]) {
        assert.equal((await db.query('select public.is_writing_lead_data($1) ok',[data])).rows[0].ok,mod.exports.DB_DETAIL_STAGE_TRACK_OF[stage] !== '상담',status);
      }
      for (const detailStage of ['', '사채 연결',' 사채연결','사채연결 ', 'unknown',42,true,{},[]]) {
        assert.equal((await db.query('select public.is_writing_lead_data($1) ok',[{detailStage,status:'수임전환'}])).rows[0].ok,false);
      }
    });
    await t.test('writer can read/edit new-stage other assignee and its explicit linked records only', () => actor(db,'writer',async () => {
      assert.deepEqual(await ids(db,'app_leads'),['free','private-loan','work']);
      assert.deepEqual(await ids(db,'app_clients'),['client-work','private-client']);
      assert.deepEqual(await ids(db,'app_cases'),['case-work','private-case']);
      assert.deepEqual(await ids(db,'app_installments'),['inst-work','private-installment']);
      assert.equal((await db.query("update app_leads set data=data||'{\"memo\":\"synthetic edit\"}' where id='private-loan' returning id")).rows.length,1);
      assert.equal((await db.query("update app_cases set data=data||'{\"memo\":\"synthetic case edit\"}' where id='private-case' returning id")).rows.length,1);
      for (const id of ['consult','foreign','private-loan-foreign','shared']) {
        assert.equal((await db.query("update app_leads set data=data||'{\"detailStage\":\"사채연결\"}' where id=$1 returning id",[id])).rows.length,0,id);
      }
    }));
    await t.test('writer old/new stage checks allow commencement transition but reject consultation exit', () => actor(db,'writer',async () => {
      await db.query("update app_leads set data=data||'{\"detailStage\":\"사채연결\"}' where id='free'");
      assert.equal((await read(db,'free')).detailStage,'사채연결');
      await denied(db,"update app_leads set data=data||'{\"detailStage\":\"상담\"}' where id='free'");
      await db.query("update app_leads set data=data||'{\"detailStage\":\"착수금착수\"}' where id='free'");
      assert.equal((await read(db,'free')).detailStage,'착수금착수');
      await denied(db,"update app_installments set data=data||'{\"caseId\":\"case-consult\"}' where id='private-installment'");
    }));
    await t.test('existing JSON installment accepts 선납부 with actual zero/date preserved; no SQL aggregate rewrite', () => actor(db,'writer',async () => {
      const beforeCase=(await db.query("select data from app_cases where id='private-case'")).rows[0].data;
      const receipt={status:'선납부',actualPaidAmount:0,paidDate:'2026-11-13'};
      const data=(await db.query("update app_installments set data=data||$1::jsonb where id='private-installment' returning data",[JSON.stringify(receipt)])).rows[0].data;
      for(const [key,value] of Object.entries(receipt)) assert.equal(data[key],value);
      assert.deepEqual((await db.query("select data from app_cases where id='private-case'")).rows[0].data,beforeCase);
    }));
    await t.test('nonwriter/admin/inactive/suspended row scopes are unchanged', async () => {
      for (const key of Object.keys(baselineScopes)) assert.deepEqual(await scope(key),baselineScopes[key],key);
    });
    await t.test('same-firm db.view-only staff may move shared row to new stage, then shared access ends', async () => {
      const data=await read(db,'shared');
      await actor(db,'normal',async () => {
        const saved=(await sharedSave(db,'shared',data,{detailStage:'사채연결',status:'계약진행중'})).rows[0].result;
        assert.equal(saved.data.detailStage,'사채연결');
        assert.ok(!(await ids(db,'app_leads')).includes('shared'));
        await denied(db,'select public.update_shared_long_absent_lead($1,$2::jsonb,$3::jsonb)',
          ['shared',JSON.stringify({memo:'forbidden continuation'}),JSON.stringify(saved.data)],/장기부재 DB만/);
      });
    });
    await t.test('shared new-stage update still denies writer, other tenant, inactive, stale and malformed input', async () => {
      const source=await read(db,'shared'), foreign=await read(db,'shared-foreign');
      for (const key of ['writer','inactive','suspended']) await actor(db,key,async () => {
        await denied(db,'select public.update_shared_long_absent_lead($1,$2::jsonb,$3::jsonb)',
          ['shared',JSON.stringify({detailStage:'사채연결'}),JSON.stringify(source)],/권한|장기부재 DB만/);
      });
      await actor(db,'normal',async () => {
        for(const [id,data,changes,pattern] of [
          ['shared-foreign',foreign,{detailStage:'사채연결'},/장기부재 DB만/],
          ['shared',{...source,memo:'stale'},{detailStage:'사채연결'},/다른 담당자가 먼저/],
          ['shared',source,{detailStage:'사채연결 '},/진행 단계를/],
          ['shared',source,{detailStage:'사채연결',convertedClientId:'client-consult'},/변경할 수 없는 항목/],
          ['shared',source,{detailStage:'사채연결',status:'수임전환'},/고객 전환은 별도/],
        ]) await denied(db,'select public.update_shared_long_absent_lead($1,$2::jsonb,$3::jsonb)',[id,JSON.stringify(changes),JSON.stringify(data)],pattern);
      });
      assert.deepEqual(await snapshot(db),beforeRows,'every synthetic write scenario rolled back');
    });
  } finally { await db.close(); }
});
