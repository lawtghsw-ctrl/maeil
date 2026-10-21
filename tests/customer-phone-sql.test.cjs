const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Real PostgreSQL/WASM, synthetic rows only. This never contacts Supabase or SMS.
const { PGlite } = require(path.resolve(__dirname, '../../sms-sql-check/node_modules/@electric-sql/pglite'));
const migrationRoot = path.resolve(__dirname, '../supabase/migrations');
const read = name => fs.readFileSync(path.join(migrationRoot, name), 'utf8');
const permissions = read('002_staff_accounts_permissions.sql');
const tenants = read('006_multi_tenant_platform.sql');
const phoneMigration = read('20261021034000_customer_phone_edit.sql');
const firm = '11111111-1111-4111-8111-111111111111';
const otherFirm = '22222222-2222-4222-8222-222222222222';
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const staff = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const foreignAdmin = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const superAdmin = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function functionSql(source, name) {
  const matches = [...source.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'gi'))];
  assert.ok(matches.length, `Missing real function ${name}`);
  return matches.at(-1)[0];
}
function policySql(source, name) {
  const match = source.match(new RegExp(`create policy ${name}\\b[\\s\\S]*?;`, 'i'));
  assert.ok(match, `Missing real policy ${name}`);
  return match[0];
}

test('offline PostgreSQL: customer phone edits preserve tenancy, field permissions and linked rows', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      -- Reproduce the read-only verified production per-schema default grants.
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      grant usage on schema auth to authenticated,anon,service_role;
      create table law_firms(id uuid primary key,status text not null default 'active');
      create table profiles(id uuid primary key,law_firm_id uuid,platform_role text,role text,
        staff_name text,display_name text,is_active boolean,permissions jsonb default '{}');
      create table app_leads(id text primary key,law_firm_id uuid not null references law_firms(id),
        data jsonb not null,phone_normalized text,created_by uuid,updated_at timestamptz default now());
      create table app_clients(id text primary key,law_firm_id uuid not null references law_firms(id),
        data jsonb not null,created_by uuid,updated_at timestamptz default now());
      create table app_cases(id text primary key,law_firm_id uuid not null references law_firms(id),
        data jsonb not null,created_by uuid,updated_at timestamptz default now());
      create table app_installments(like app_cases including all);
      create table app_schedule_items(like app_cases including all);
      create table app_board_posts(like app_cases including all);
      create table app_change_logs(like app_cases including all);
      insert into law_firms(id) values('${firm}'),('${otherFirm}');
      insert into profiles values
        ('${admin}','${firm}','firm_admin','admin','Admin','Admin',true,'{}'),
        ('${staff}','${firm}','staff','staff','Assigned','Assigned',true,'{"db.view":true,"db.edit_basic":true}'),
        ('${foreignAdmin}','${otherFirm}','firm_admin','admin','Foreign','Foreign',true,'{}'),
        ('${superAdmin}',null,'super_admin','admin','Global','Global',true,'{}');
      grant select,insert,update,delete on app_leads,app_clients,app_cases to authenticated,service_role;
      alter table app_leads enable row level security;
      alter table app_clients enable row level security;
      alter table app_cases enable row level security;
    `);
    // Use the production authorization functions and policies, not permissive stubs.
    for (const name of ['current_law_firm_id','current_platform_role','is_super_admin','is_firm_admin','is_active_user','is_admin_user','has_permission']) {
      await db.exec(functionSql(tenants, name));
    }
    for (const name of ['current_staff_name','has_any_permission','can_access_client_id']) await db.exec(functionSql(permissions, name));
    await db.exec(functionSql(read('018_case_delete_permission.sql'), 'enforce_lead_update_permissions'));
    await db.exec(functionSql(tenants, 'sync_lead_search_columns'));
    await db.exec(`
      create trigger trg_app_leads_permissions before update on app_leads
        for each row execute function enforce_lead_update_permissions();
      create trigger trg_app_leads_search_columns before insert or update of data on app_leads
        for each row execute function sync_lead_search_columns();
    `);
    const guardBlock = tenants.slice(tenants.indexOf('-- Tenant isolation is a RESTRICTIVE'), tenants.indexOf('-- Lead import audit'));
    assert.ok(guardBlock.includes('as restrictive for all'));
    await db.exec(guardBlock);
    for (const name of ['app_leads_select_permissions','app_clients_select_permissions','app_clients_update_permissions']) {
      await db.exec(policySql(permissions, name));
    }
    await db.exec(read('021_converted_lead_direction_assignee_sync.sql'));

    const as = async (actor, callback, role = 'authenticated') => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [actor || '', role]);
      await db.exec(`set role ${role}`);
      try { return await callback(); } finally { await db.exec('reset role'); }
    };
    const insert = (table, id, data, tenant = firm) => db.query(
      `insert into ${table}(id,law_firm_id,data) values($1,$2,$3::jsonb)`, [id, tenant, JSON.stringify(data)]);
    const baselineLead = { id:'lead-a',name:'Synthetic A',phone:'010-1111-2222',assignedStaff:'Assigned',
      convertedClientId:'client-a',applicationType:'개인회생',consultation:{personal:{notes:'preserve lead notes'}},detailStage:'상담중' };
    const baselineClient = { id:'client-a',name:'Synthetic A',phone:'010-1111-2222',assignedStaff:'Assigned',
      fromLeadId:'lead-a',applicationType:'개인회생',consultation:{personal:{notes:'preserve client notes'}},memo:'untouched' };
    const seed = async ({ lead = baselineLead, client = baselineClient } = {}) => {
      await db.exec('truncate app_leads,app_clients,app_cases');
      await db.query('update law_firms set status=$1', ['active']);
      await db.query('update profiles set is_active=true,permissions=$1::jsonb where id=$2', ['{"db.view":true,"db.edit_basic":true}', staff]);
      await db.query('update profiles set is_active=true where id=$1', [admin]);
      if (client) await insert('app_clients', 'client-a', client);
      if (lead) await insert('app_leads', 'lead-a', lead);
      await insert('app_leads','lead-other',{name:'Other firm',phone:'010-5555-5555',assignedStaff:'Foreign'},otherFirm);
      await insert('app_clients','client-other',{name:'Other firm',phone:'010-5555-5555',assignedStaff:'Foreign'},otherFirm);
      await insert('app_cases','case-a',{clientId:'client-a',fromLeadId:'lead-a',caseType:'개인회생',contractAmount:12345,paidAmount:6789});
    };
    const snapshot = async () => (await db.query(`select jsonb_build_object(
      'leads',(select jsonb_agg(to_jsonb(l) order by id) from app_leads l),
      'clients',(select jsonb_agg(to_jsonb(c) order by id) from app_clients c),
      'cases',(select jsonb_agg(to_jsonb(c) order by id) from app_cases c)) as value`)).rows[0].value;
    const row = async (table, id) => (await db.query(`select * from ${table} where id=$1`,[id])).rows[0];
    const editLead = (phone, id='lead-a') => db.query("update app_leads set data=jsonb_set(data,'{phone}',$1::jsonb) where id=$2 returning id", [JSON.stringify(phone),id]);
    const editClient = (phone, id='client-a') => db.query('select update_client_phone($1,$2) as value',[id,phone]);

    await seed();
    await t.test('migration leaves all pre-existing rows unchanged and can be re-applied', async () => {
      const before = await snapshot();
      await db.exec(phoneMigration);
      assert.deepEqual(await snapshot(), before);
      await db.exec(phoneMigration);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('explicit Supabase default grants do not expose the phone RPC or trigger helpers', async () => {
      const grants = (await db.query(`select
        has_function_privilege('anon','public.update_client_phone(text,text)','EXECUTE') as anon_rpc,
        has_function_privilege('authenticated','public.update_client_phone(text,text)','EXECUTE') as auth_rpc,
        has_function_privilege('service_role','public.update_client_phone(text,text)','EXECUTE') as service_rpc,
        has_function_privilege('anon','public.checked_customer_phone(text)','EXECUTE') as anon_validator,
        has_function_privilege('authenticated','public.checked_customer_phone(text)','EXECUTE') as auth_validator,
        has_function_privilege('authenticated','public.sync_converted_lead_phone_to_client()','EXECUTE') as auth_trigger`)).rows[0];
      assert.deepEqual(grants,{anon_rpc:false,auth_rpc:true,service_rpc:false,anon_validator:false,auth_validator:false,auth_trigger:false});
    });

    await t.test('assigned staff with basic edit can update lead and only linked client phone', async () => {
      await seed();
      const before = await snapshot();
      await as(staff, () => editLead('  +82 (10) 3333-4444  '));
      const lead = await row('app_leads','lead-a');
      assert.equal(lead.phone_normalized,'821033334444');
      assert.deepEqual(lead.data,{...baselineLead,phone:'+82 (10) 3333-4444'});
      assert.deepEqual((await row('app_clients','client-a')).data,{...baselineClient,phone:'+82 (10) 3333-4444'});
      const after = await snapshot();
      assert.deepEqual(after.cases,before.cases);
      assert.deepEqual(after.leads.find(r=>r.id==='lead-other'),before.leads.find(r=>r.id==='lead-other'));
      assert.deepEqual(after.clients.find(r=>r.id==='client-other'),before.clients.find(r=>r.id==='client-other'));
      assert.equal((await as(staff,()=>db.query("update app_clients set data=data||'{\"phone\":\"010-7777-7777\"}' where id='client-a' returning id"))).rows.length,0);
    });

    await t.test('read-only staff cannot change phone, and basic editing remains assignment-scoped', async () => {
      await seed();
      await db.query('update profiles set permissions=$1 where id=$2',[JSON.stringify({'db.view':true,'db.edit_consultation':true}),staff]);
      const before = await snapshot();
      await assert.rejects(as(staff,()=>editLead('010-3333-4444')),/기본정보 수정 권한/);
      assert.deepEqual(await snapshot(),before);
      await db.query('update profiles set permissions=$1 where id=$2',[JSON.stringify({'db.view':true,'db.edit_basic':true}),staff]);
      await insert('app_leads','unassigned',{phone:'010-1111-1111',assignedStaff:'Someone else'});
      assert.equal((await as(staff,()=>editLead('010-3333-4444','unassigned'))).rows.length,0);
      await db.query('update profiles set permissions=permissions||\'{"db.view_all":true}\' where id=$1',[staff]);
      assert.equal((await as(staff,()=>editLead('010-3333-4444','unassigned'))).rows.length,1);
    });

    await t.test('direct lead edits preserve cross-tenant and inactive-user RLS restrictions', async () => {
      await seed();
      const before=await snapshot();
      assert.equal((await as(admin,()=>editLead('010-3333-4444','lead-other'))).rows.length,0);
      await db.query('update profiles set is_active=false where id=$1',[staff]);
      assert.equal((await as(staff,()=>editLead('010-3333-4444'))).rows.length,0);
      assert.deepEqual(await snapshot(),before);
    });

    await t.test('DB view-all staff can synchronize legitimate different-assignee links', async () => {
      await seed({client:{...baselineClient,assignedStaff:'Someone else'}});
      await db.query('update profiles set permissions=permissions||\'{"db.view_all":true}\' where id=$1',[staff]);
      await as(staff,()=>editLead('010-3333-4444'));
      assert.equal((await row('app_clients','client-a')).data.phone,'010-3333-4444');
      assert.equal((await row('app_clients','client-a')).data.assignedStaff,'Someone else');
    });

    await t.test('anonymous, missing-session, staff, inactive and cross-tenant RPC attempts cannot mutate rows', async () => {
      await seed();
      const before = await snapshot();
      for (const actor of [null,staff,foreignAdmin]) await assert.rejects(as(actor,()=>editClient('010-3333-4444')));
      await assert.rejects(as(null,()=>editClient('010-3333-4444'),'anon'),/permission denied/);
      await db.query('update profiles set is_active=false where id=$1',[admin]);
      await assert.rejects(as(admin,()=>editClient('010-3333-4444')),/활성 관리자/);
      assert.deepEqual(await snapshot(),before);
      await assert.rejects(as(staff,()=>db.query("select checked_customer_phone('010-3333-4444')")),/permission denied/);
      await assert.rejects(as(staff,()=>db.query('select sync_converted_lead_phone_to_client()')),/permission denied/);
    });

    await t.test('suspended firms are protected even from the global administrator RPC', async () => {
      await seed();
      await db.query("update law_firms set status='suspended' where id=$1",[firm]);
      const before = await snapshot();
      await assert.rejects(as(admin,()=>editClient('010-3333-4444')),/활성 관리자/);
      await assert.rejects(as(superAdmin,()=>editClient('010-3333-4444')),/이용 중지/);
      assert.deepEqual(await snapshot(),before);
    });

    await t.test('admin RPC synchronizes both rows and repairs pre-existing phone divergence', async () => {
      await seed({client:{...baselineClient,phone:'010-0000-0000'}});
      const before = await snapshot();
      const result = (await as(admin,()=>editClient(' 010-1111-2222 '))).rows[0].value;
      assert.deepEqual(result,{clientId:'client-a',leadId:'lead-a',phone:'010-1111-2222'});
      assert.deepEqual((await row('app_leads','lead-a')).data,baselineLead);
      assert.deepEqual((await row('app_clients','client-a')).data,baselineClient);
      assert.deepEqual((await snapshot()).cases,before.cases);
      await as(admin,()=>editClient('02-1234-5678'));
      assert.equal((await row('app_leads','lead-a')).data.phone,'02-1234-5678');
      assert.equal((await row('app_clients','client-a')).data.phone,'02-1234-5678');
    });

    await t.test('standalone and legacy reverse-only links remain editable', async () => {
      const {fromLeadId,...legacyClient}=baselineClient;
      await seed({lead:null,client:legacyClient});
      assert.equal((await as(admin,()=>editClient('02-1234-5678'))).rows[0].value.leadId,null);
      assert.equal((await row('app_clients','client-a')).data.phone,'02-1234-5678');
      await seed({client:legacyClient});
      await as(admin,()=>editClient('02-1234-5678'));
      assert.equal((await row('app_leads','lead-a')).data.phone,'02-1234-5678');
      assert.equal((await row('app_clients','client-a')).data.phone,'02-1234-5678');
    });

    await t.test('retained customers remain editable after intentional source-lead deletion', async () => {
      await seed({lead:null});
      const before=await snapshot();
      const result=(await as(admin,()=>editClient('010-3333-4444'))).rows[0].value;
      assert.equal(result.leadId,null);
      assert.deepEqual((await row('app_clients','client-a')).data,{...baselineClient,phone:'010-3333-4444'});
      assert.deepEqual((await snapshot()).leads,before.leads);
      assert.deepEqual((await snapshot()).cases,before.cases);
      // A missing source is different from an existing source in another tenant.
      await seed({lead:null,client:{...baselineClient,fromLeadId:'lead-other'}});
      const foreignBefore=await snapshot();
      await assert.rejects(as(admin,()=>editClient('010-3333-4444')),/연결된 원본 DB/);
      assert.deepEqual(await snapshot(),foreignBefore);
    });

    await t.test('invalid phone edits are atomic and unchanged legacy numbers do not block other edits', async () => {
      await seed();
      const before = await snapshot();
      for (const value of ['', '   ', '1234567','1234567890123456','010-12x4-5678','010\n12345678',null]) {
        await assert.rejects(as(staff,()=>editLead(value)),/연락처/);
        await assert.rejects(as(admin,()=>editClient(value)),/연락처/);
        assert.deepEqual(await snapshot(),before);
      }
      await seed({lead:{...baselineLead,phone:'legacy unknown'},client:{...baselineClient,phone:'legacy unknown'}});
      await as(staff,()=>db.query("update app_leads set data=data||'{\"name\":\"Renamed\"}' where id='lead-a'"));
      assert.equal((await row('app_leads','lead-a')).data.phone,'legacy unknown');
      assert.equal((await row('app_clients','client-a')).data.phone,'legacy unknown');
    });

    await t.test('client write rolls back when the lead subsequently fails a constraint', async () => {
      await seed();
      await db.exec("alter table app_leads add constraint synthetic_reject_phone check(data->>'phone' <> '010-9999-9999')");
      try {
        const before=await snapshot();
        await assert.rejects(as(staff,()=>editLead('010-9999-9999')),/synthetic_reject_phone/);
        assert.deepEqual(await snapshot(),before);
        await assert.rejects(as(admin,()=>editClient('010-9999-9999')),/synthetic_reject_phone/);
        assert.deepEqual(await snapshot(),before);
      } finally { await db.exec('alter table app_leads drop constraint synthetic_reject_phone'); }
    });

    await t.test('mismatched or cross-tenant links fail closed in both editing directions', async () => {
      for (const client of [
        {...baselineClient,fromLeadId:'missing'},
        {...baselineClient,fromLeadId:'lead-other'},
      ]) {
        await seed({client});
        const before=await snapshot();
        await assert.rejects(as(staff,()=>editLead('010-3333-4444')),/연결된 계약 고객/);
        await assert.rejects(as(admin,()=>editClient('010-3333-4444')),/연결정보가 일치하지/);
        assert.deepEqual(await snapshot(),before);
      }
      await seed({lead:{...baselineLead,convertedClientId:'client-other'}});
      const before=await snapshot();
      await assert.rejects(as(staff,()=>editLead('010-3333-4444')),/연결된 계약 고객/);
      await assert.rejects(as(admin,()=>editClient('010-3333-4444')),/연결된 원본 DB/);
      assert.deepEqual(await snapshot(),before);
    });

    await t.test('staff cannot relink an owned lead to overwrite another assignee legacy client phone', async () => {
      const {fromLeadId,...legacyClient}=baselineClient;
      await seed({lead:{...baselineLead,convertedClientId:null},client:{...legacyClient,assignedStaff:'Someone else'}});
      await db.query('update profiles set permissions=permissions||\'{"db.convert":true}\' where id=$1',[staff]);
      // Existing conversion permission allows a link to be set in a separate request.
      await as(staff,()=>db.query("update app_leads set data=data||'{\"convertedClientId\":\"client-a\"}' where id='lead-a'"));
      const before=await snapshot();
      await assert.rejects(as(staff,()=>editLead('010-3333-4444')));
      assert.deepEqual(await snapshot(),before);
    });

    await t.test('staff cannot impersonate a deleted source to edit another assignee retained client', async () => {
      await seed({lead:{...baselineLead,convertedClientId:null},client:{...baselineClient,fromLeadId:'deleted-source',assignedStaff:'Someone else'}});
      await db.query('update profiles set permissions=permissions||\'{"db.convert":true}\' where id=$1',[staff]);
      await as(staff,()=>db.query("update app_leads set id='deleted-source',data=data||'{\"convertedClientId\":\"client-a\"}' where id='lead-a'"));
      const before=await snapshot();
      await assert.rejects(as(staff,()=>editLead('010-3333-4444','deleted-source')));
      assert.deepEqual(await snapshot(),before);
    });

    await t.test('ambiguous reverse links and simultaneous relinking cannot redirect phone writes', async () => {
      await seed();
      await insert('app_leads','second-link',{phone:'010-1111-2222',assignedStaff:'Assigned',convertedClientId:'client-a'});
      const before=await snapshot();
      await assert.rejects(as(admin,()=>editClient('010-3333-4444')),/연결정보가 일치하지/);
      assert.deepEqual(await snapshot(),before);
      await assert.rejects(as(staff,()=>editLead('010-3333-4444')),/연결된 계약 고객/);
      assert.deepEqual(await snapshot(),before);
      await assert.rejects(as(admin,()=>db.query("update app_leads set id='renamed-lead',data=data||'{\"phone\":\"010-3333-4444\"}' where id='lead-a'")),/동시에 변경/);
      assert.deepEqual(await snapshot(),before);
      await assert.rejects(as(admin,()=>db.query("update app_leads set data=data||'{\"phone\":\"010-3333-4444\",\"convertedClientId\":\"client-other\"}' where id='lead-a'")),/동시에 변경/);
      assert.deepEqual(await snapshot(),before);
      await assert.rejects(as(admin,()=>db.query('update app_leads set law_firm_id=$1,data=data||\'{"phone":"010-3333-4444"}\' where id=$2',[otherFirm,'lead-a'])),/동시에 변경/);
      assert.deepEqual(await snapshot(),before);
    });
  } finally { await db.close(); }
});
