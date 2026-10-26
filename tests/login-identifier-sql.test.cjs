// Isolated PostgreSQL only: no Supabase connection, authentication or email send.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve(__dirname, '../../sms-sql-check/node_modules/@electric-sql/pglite'));
const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261026063321_resolve_login_identifier.sql'), 'utf8');
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

async function asRole(db, role, claim, callback, readOnly = false) {
  await db.exec(`begin${readOnly ? ' read only' : ''}; set local role ${role};`);
  await db.query("select set_config('request.jwt.claim.role',$1,true)",[claim]);
  try { return await callback(); } finally { await db.exec('rollback'); }
}

test('resolve_login_identifier actual SQL: precise matching, service isolation and no account writes', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create role unrelated;
      create schema auth; grant usage on schema auth to anon,authenticated,service_role;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role',true),'')
      $$;
      create table auth.users(id uuid primary key,email varchar(320),banned_until timestamptz,deleted_at timestamptz,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
      create table public.profiles(id uuid primary key,is_active boolean);
      -- Model Supabase installations whose default ACL grants every API role.
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
    const users = [
      [7,'dupe@third.invalid',null,null],
      [3,'DUPE@second.invalid',null,'2026-10-01T00:00:00Z'],
      [1,'dupe@first.invalid','2099-01-01T00:00:00Z',null],
      [8,'MiXeD@Example.invalid',null,null],
      [9,'sales+tag@example.invalid',null,null],
      [10,'staff_name@example.invalid',null,null],
      [11,'staffXname@example.invalid',null,null],
      [12,'literal%name@example.invalid',null,null],
      [13,'literalANYname@example.invalid',null,null],
      [14,'%@example.invalid',null,null],
      [15,'_@example.invalid',null,null],
      [16,"o'reilly@example.invalid",null,null],
      [17,'a'.repeat(254)+'@example.invalid',null,null],
      [18,null,null,null],
    ];
    for (const [n,email,banned,deleted] of users) {
      await db.query('insert into auth.users values($1,$2,$3,$4,null,$5)',[uuid(n),email,banned,deleted,{synthetic:true,unchanged:'original'}]);
      await db.query('insert into public.profiles values($1,$2)',[uuid(n),n!==1]);
    }
    const snapshot = async () => ({
      users:(await db.query('select * from auth.users order by id')).rows,
      profiles:(await db.query('select * from public.profiles order by id')).rows,
      indexes:(await db.query("select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('auth','public') order by indexname")).rows,
    });
    const before = await snapshot();
    await db.exec(migration);
    const lookup = value => db.query('select * from public.resolve_login_identifier($1)',[value]).then(r=>r.rows);
    const lookupAsService = value => asRole(db,'service_role','service_role',()=>lookup(value),true);

    await t.test('case/outer-space normalization returns the original stored email unchanged',async()=>{
      assert.deepEqual(await lookupAsService('  mixed  '),[{id:uuid(8),email:'MiXeD@Example.invalid'}]);
      assert.deepEqual(await lookupAsService('MIXED'),[{id:uuid(8),email:'MiXeD@Example.invalid'}]);
    });
    await t.test('duplicate local parts across domains retain inactive/banned/deleted candidates and cap at two',async()=>{
      const expected=[{id:uuid(1),email:'dupe@first.invalid'},{id:uuid(3),email:'DUPE@second.invalid'}];
      assert.deepEqual(await lookupAsService('dupe'),expected);
      assert.deepEqual(await lookupAsService(' DUPE '),expected);
    });
    await t.test('plus addressing is literal and never stripped',async()=>{
      assert.deepEqual(await lookupAsService('sales+tag'),[{id:uuid(9),email:'sales+tag@example.invalid'}]);
      assert.deepEqual(await lookupAsService('sales'),[]);
    });
    await t.test('underscore/percent do not operate as SQL wildcards',async()=>{
      for (const [value,n] of [['staff_name',10],['literal%name',12],['%',14],['_',15]]) {
        assert.deepEqual(await lookupAsService(value),[{id:uuid(n),email:users.find(u=>u[0]===n)[1]}]);
      }
      assert.deepEqual(await lookupAsService('staff%'),[]);
      assert.deepEqual(await lookupAsService('literal_name'),[]);
    });
    await t.test('apostrophe remains an exact bound argument and cannot change SQL structure',async()=>{
      assert.deepEqual(await lookupAsService("o'reilly"),[{id:uuid(16),email:"o'reilly@example.invalid"}]);
      await assert.rejects(lookupAsService("' OR true --"),{code:'22023'});
    });
    await t.test('unknown/partial identifier has no match',async()=>{
      for(const value of ['unknown','mix','mixed.other','prefixmixed']) assert.deepEqual(await lookupAsService(value),[]);
    });
    await t.test('blank/null/full email/whitespace/control/unrecognized characters fail closed',async()=>{
      for(const value of [null,'',' ','\t','mixed@example.invalid','a@@b','mixed user','mixed\n','mixed\r','mixed\t','관리자','a:b','"mixed"','a\\b']) {
        await assert.rejects(lookupAsService(value),{code:'22023'},JSON.stringify(value));
      }
    });
    await t.test('length boundaries are enforced including excessive input padding',async()=>{
      assert.equal((await lookupAsService('a'.repeat(254))).length,1);
      await assert.rejects(lookupAsService('a'.repeat(255)),{code:'22023'});
      await assert.rejects(lookupAsService(' '.repeat(1024)+'mixed'),{code:'22023'});
    });
    await t.test('ACL allows only service_role among API roles even under permissive default grants',async()=>{
      const rows=(await db.query("select r,has_function_privilege(r,'public.resolve_login_identifier(text)','EXECUTE') allowed from unnest(array['anon','authenticated','service_role','unrelated']) r order by r")).rows;
      assert.deepEqual(rows,[{r:'anon',allowed:false},{r:'authenticated',allowed:false},{r:'service_role',allowed:true},{r:'unrelated',allowed:false}]);
      for(const role of ['anon','authenticated','unrelated']) {
        await assert.rejects(asRole(db,role,'service_role',()=>lookup('mixed')),{code:'42501'});
      }
    });
    await t.test('body guard requires exact service claim, including for the function owner',async()=>{
      for(const claim of ['', 'anon', 'authenticated', 'SERVICE_ROLE']) {
        await assert.rejects(asRole(db,'service_role',claim,()=>lookup('mixed')),{code:'42501',message:'service_role only'});
      }
      await assert.rejects(lookup('mixed'),{code:'42501',message:'service_role only'});
    });
    await t.test('SECURITY DEFINER lookup works without granting auth.users SELECT and pins pg_catalog search_path',async()=>{
      assert.equal((await db.query("select has_table_privilege('service_role','auth.users','SELECT') allowed")).rows[0].allowed,false);
      const meta=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid='public.resolve_login_identifier(text)'::regprocedure")).rows[0];
      assert.equal(meta.prosecdef,true);assert.equal(meta.provolatile,'s');assert.deepEqual(meta.proconfig,['search_path=pg_catalog']);
      assert.equal((await lookupAsService('mixed')).length,1);
    });
    await t.test('migration and all read-only lookups preserve every auth/profile row and index',async()=>{
      assert.deepEqual(await snapshot(),before);
      await db.exec(migration);
      assert.deepEqual(await lookupAsService('mixed'),[{id:uuid(8),email:'MiXeD@Example.invalid'}]);
      assert.deepEqual(await snapshot(),before);
    });
  } finally { await db.close(); }
});
