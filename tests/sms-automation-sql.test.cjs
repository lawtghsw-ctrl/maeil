const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Real PostgreSQL/WASM and synthetic records only. No network, Supabase project,
// provider, relay or production SMS is used by this fixture.
const { PGlite } = require(path.resolve(__dirname, '../../sms-sql-check/node_modules/@electric-sql/pglite'));
const read = name => fs.readFileSync(path.resolve(__dirname, '../supabase/migrations', name), 'utf8');
const firm = '11111111-1111-4111-8111-111111111111';
const otherFirm = '22222222-2222-4222-8222-222222222222';
const manager = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const viewer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const inactive = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const admin = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherAdmin = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const sender = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreignSender = '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const disabledSender = '33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unregisteredSender = '44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const relay = '55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fields = 'id,law_firm_id,staff_name,sender_number_id,new_lead_enabled,absence_enabled,new_lead_template,absence_template,new_lead_image_paths,absence_image_paths,updated_by';

function functionSql(source, name) {
  const matches = [...source.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'gi'))];
  assert.ok(matches.length, `Missing production helper ${name}`);
  return matches.at(-1)[0];
}

test('offline PostgreSQL: staff automation persists under actual permission, tenant and delivery policies', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,storage to authenticated,service_role;
      create table law_firms(id uuid primary key,firm_code char(10),name text,status text default 'active');
      create table profiles(id uuid primary key,law_firm_id uuid,platform_role text,role text,
        staff_name text,is_active boolean,permissions jsonb default '{}');
      create table app_leads(id text primary key,law_firm_id uuid references law_firms(id),data jsonb);
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(id uuid primary key default gen_random_uuid(),name text,bucket_id text);
      alter table storage.objects enable row level security;
      insert into law_firms values
        ('${firm}','1234567890','Synthetic A','active'),('${otherFirm}','9876543210','Synthetic B','active');
      insert into auth.users values('${manager}'),('${viewer}'),('${inactive}'),('${admin}'),('${otherAdmin}');
      insert into profiles values
        ('${manager}','${firm}','staff','staff','담당자 A',true,'{"sms.view":true,"sms.manage_settings":true}'),
        ('${viewer}','${firm}','staff','staff','읽기 전용',true,'{"sms.view":true}'),
        ('${inactive}','${firm}','staff','staff','비활성 담당자',false,'{"sms.view":true,"sms.manage_settings":true}'),
        ('${admin}','${firm}','firm_admin','admin','관리자',true,'{}'),
        ('${otherAdmin}','${otherFirm}','firm_admin','admin','다른 관리자',true,'{}');
    `);
    // Extract the real authorization definitions instead of allowing every actor.
    const tenants = read('006_multi_tenant_platform.sql');
    for (const name of ['current_law_firm_id','current_platform_role','is_super_admin','is_firm_admin',
      'is_active_user','is_admin_user','has_permission']) await db.exec(functionSql(tenants, name));
    for (const name of ['014_sms_center_foundation.sql','015_sms_staff_automation_images.sql',
      '016_sms_permissions.sql','022_aligo_safe_cutover.sql','20261017133745_sms_delivery_epoch_jobs.sql',
      '20261018082353_sms_consult_time_variables.sql']) {
      // PGlite has no EUC_KR codec. This suite checks persistence/authorization,
      // not carrier byte counts (covered separately by the relay codec tests).
      await db.exec(read(name).replaceAll("'EUC_KR'", "'UTF8'"));
    }
    // Supabase normally grants exposed-table privileges separately from RLS.
    // This isolated setup models those grants; it does not verify live grants.
    await db.exec(`grant select,insert,update,delete on sms_sender_numbers,sms_templates,
      sms_automation_settings,sms_staff_automation_settings,storage.objects to authenticated;
      insert into sms_sender_numbers(id,law_firm_id,staff_name,phone,is_registered,is_active,is_default) values
        ('${sender}','${firm}','담당자 A','01011112222',true,true,true),
        ('${foreignSender}','${otherFirm}','담당자 A','01022223333',true,true,true),
        ('${disabledSender}','${firm}','비활성 번호','01033334444',true,false,false),
        ('${unregisteredSender}','${firm}','미등록 번호','01044445555',false,true,false);
      insert into sms_staff_automation_settings(law_firm_id,staff_name,sender_number_id,new_lead_template,absence_template)
        values('${otherFirm}','담당자 A','${foreignSender}','다른 로펌 문구','다른 로펌 부재 문구');
    `);

    const as = async (actor, callback, role = 'authenticated') => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor || '']);
      await db.exec(`set role ${role}`);
      try { return await callback(); } finally {
        await db.exec('reset role');
        await db.query("select set_config('request.jwt.claim.sub','',false)");
      }
    };
    const values = overrides => ({ law_firm_id:firm,staff_name:'담당자 A',sender_number_id:sender,
      new_lead_enabled:true,absence_enabled:false,
      new_lead_template:'  {고객명}님, 직접 작성한 안내입니다.\n담당: {담당자} / {상담시간대}  ',
      absence_template:'통화가 어려우시면 문자로 답장 부탁드립니다.\n감사합니다.',
      new_lead_image_paths:[`${firm}/auto/담당자 A/new-lead/sample.png`],
      absence_image_paths:[],updated_by:manager,...overrides });
    const upsert = input => db.query(`
      insert into sms_staff_automation_settings(law_firm_id,staff_name,sender_number_id,new_lead_enabled,
        absence_enabled,new_lead_template,absence_template,new_lead_image_paths,absence_image_paths,updated_by,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,now())
      on conflict(law_firm_id,staff_name) do update set sender_number_id=excluded.sender_number_id,
        new_lead_enabled=excluded.new_lead_enabled,absence_enabled=excluded.absence_enabled,
        new_lead_template=excluded.new_lead_template,absence_template=excluded.absence_template,
        new_lead_image_paths=excluded.new_lead_image_paths,absence_image_paths=excluded.absence_image_paths,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at returning ${fields}`,
      [input.law_firm_id,input.staff_name,input.sender_number_id,input.new_lead_enabled,input.absence_enabled,
        input.new_lead_template,input.absence_template,JSON.stringify(input.new_lead_image_paths),
        JSON.stringify(input.absence_image_paths),input.updated_by]);
    const load = (tenant = firm, staff = '담당자 A') => db.query(
      `select ${fields} from sms_staff_automation_settings where law_firm_id=$1 and staff_name=$2`, [tenant,staff]);
    const safetySnapshot = async () => (await db.query(`select jsonb_build_object(
      'gates',(select jsonb_agg(to_jsonb(t)) from sms_delivery_gates t),
      'guards',(select jsonb_agg(to_jsonb(t)) from sms_auto_delivery_guard t),
      'jobs',(select jsonb_agg(to_jsonb(t)) from sms_delivery_jobs t),
      'outbox',(select jsonb_agg(to_jsonb(t)) from sms_outbox t),
      'leads',(select jsonb_agg(to_jsonb(t)) from app_leads t)) value`)).rows[0].value;
    const allSettings = async () => (await db.query(`select ${fields} from sms_staff_automation_settings order by law_firm_id,staff_name`)).rows;

    await t.test('permitted staff insert and conflict-update round-trip exact custom text, flags, sender and image paths', async () => {
      const before = await safetySnapshot();
      const globalBefore = (await db.query('select * from sms_automation_settings order by law_firm_id')).rows;
      const otherBefore = (await load(otherFirm)).rows;
      const initial = values();
      const inserted = (await as(manager, () => upsert(initial))).rows[0];
      assert.deepEqual(inserted, { id:inserted.id,...initial });
      assert.deepEqual((await as(manager, () => load())).rows, [inserted], 'fresh authenticated load sees saved values');
      const changed = values({new_lead_enabled:false,absence_enabled:true,
        new_lead_template:'수정한 접수 문구',absence_template:'수정한 부재 문구 {고객명}',
        new_lead_image_paths:[],absence_image_paths:[`${firm}/auto/담당자 A/absence/sample.jpg`]});
      const updated = (await as(manager, () => upsert(changed))).rows[0];
      assert.deepEqual(updated, {id:inserted.id,...changed});
      assert.deepEqual((await as(manager, () => load())).rows, [updated]);
      assert.equal((await load()).rows.length,1,'the same tenant/staff pair updates one row, not a duplicate');
      assert.deepEqual((await load(otherFirm)).rows,otherBefore,'identical staff names do not cross tenant boundaries');
      assert.deepEqual((await db.query('select * from sms_automation_settings order by law_firm_id')).rows,globalBefore);
      assert.deepEqual(await safetySnapshot(),before,'saving settings alone cannot activate delivery or enqueue SMS');
    });

    await t.test('same-firm administrator can save without a separate fine-grained permission', async () => {
      const saved = (await as(admin, () => upsert(values({staff_name:'관리자 설정',updated_by:admin})))).rows[0];
      assert.equal(saved.staff_name,'관리자 설정');
      assert.deepEqual((await as(admin, () => load(firm,'관리자 설정'))).rows,[saved]);
    });

    await t.test('no-permission and inactive staff cannot read, insert or conflict-update settings', async () => {
      for (const actor of [viewer,inactive]) {
        const before = await allSettings();
        assert.deepEqual((await as(actor, () => load())).rows,[]);
        await assert.rejects(as(actor, () => upsert(values({updated_by:actor}))), /row-level security/);
        await assert.rejects(as(actor, () => upsert(values({staff_name:'Unauthorized new',updated_by:actor}))), /row-level security/);
        assert.equal((await as(actor, () => db.query('update sms_staff_automation_settings set new_lead_enabled=false returning id'))).rows.length,0);
        assert.deepEqual(await allSettings(),before);
      }
    });

    await t.test('a settings manager cannot load, overwrite or move another firm’s settings', async () => {
      const before = await allSettings();
      assert.deepEqual((await as(manager, () => load(otherFirm))).rows,[]);
      await assert.rejects(as(manager, () => upsert(values({law_firm_id:otherFirm,sender_number_id:foreignSender}))), /row-level security/);
      await assert.rejects(as(manager, () => db.query(
        'update sms_staff_automation_settings set law_firm_id=$1 where law_firm_id=$2 and staff_name=$3',
        [otherFirm,firm,'관리자 설정'])), /row-level security/);
      assert.deepEqual((await as(otherAdmin, () => load())).rows,[]);
      assert.deepEqual(await allSettings(),before);
    });

    await t.test('missing sender and malformed images reject the write and preserve the existing saved row', async () => {
      const before = (await load()).rows;
      await assert.rejects(as(manager, () => upsert(values({sender_number_id:'99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))), /foreign key constraint/);
      await assert.rejects(as(manager, () => upsert(values({new_lead_image_paths:{path:'not-an-array'}}))), /check constraint/);
      assert.deepEqual((await load()).rows,before);
    });

    await t.test('MMS object metadata and sender reads retain same-tenant and active/permission boundaries', async () => {
      const upload = name => db.query("insert into storage.objects(name,bucket_id) values($1,'sms-media') returning name", [name]);
      const ownPath = `${firm}/auto/담당자 A/new-lead/synthetic.png`;
      await as(manager, () => upload(ownPath));
      assert.deepEqual((await as(manager, () => db.query('select name from storage.objects'))).rows,[{name:ownPath}]);
      await assert.rejects(as(manager, () => upload(`${otherFirm}/auto/foreign.png`)), /row-level security/);
      for (const actor of [viewer,inactive]) await assert.rejects(as(actor, () => upload(`${firm}/auto/denied-${actor}.png`)), /row-level security/);
      assert.deepEqual((await as(otherAdmin, () => db.query('select name from storage.objects'))).rows,[]);
      assert.deepEqual((await as(inactive, () => db.query('select id from sms_sender_numbers'))).rows,[]);
      const visible = (await as(manager, () => db.query('select id from sms_sender_numbers'))).rows.map(row=>row.id);
      assert.ok(visible.includes(sender));
      assert.ok(!visible.includes(foreignSender));
      assert.equal((await db.query('select count(*)::int count from storage.objects')).rows[0].count,1);
    });

    await t.test('current auto-delivery guard rejects invalid explicit senders without falling back to the default', async () => {
      await as(null, () => db.query('select * from sms_delivery_set_gate($1,$2,null,true,true,$3)',[admin,firm,relay]), 'service_role');
      const gateBefore = (await db.query('select * from sms_delivery_gates')).rows;
      const addLead = id => db.query('insert into app_leads values($1,$2,$3::jsonb)',[id,firm,
        JSON.stringify({name:'Synthetic Customer',phone:'01055556666',assignedStaff:'담당자 A'})]);
      for (const [label,id] of [['foreign',foreignSender],['inactive',disabledSender],['unregistered',unregisteredSender]]) {
        // Seed invalid legacy references as the fixture owner: the settings FK is
        // ID-only, while the delivery trigger is the final tenant/status guard.
        await upsert(values({sender_number_id:id,new_lead_image_paths:[],new_lead_template:'hello {고객명}'}));
        await addLead(`blocked-${label}`);
        assert.equal((await db.query('select count(*)::int count from sms_delivery_jobs where lead_id=$1',[`blocked-${label}`])).rows[0].count,0);
      }
      await as(manager, () => upsert(values({new_lead_image_paths:[],new_lead_template:'hello {고객명}'})));
      assert.equal((await db.query('select count(*)::int count from sms_delivery_jobs')).rows[0].count,0,'settings saves never queue a request');
      await addLead('permitted-new-event');
      const job = (await db.query("select sender_number_id,message from sms_delivery_jobs where lead_id='permitted-new-event'")).rows[0];
      assert.deepEqual(job,{sender_number_id:sender,message:'hello Synthetic Customer'});
      assert.deepEqual((await db.query('select * from sms_delivery_gates')).rows,gateBefore,'settings updates cannot rotate or mutate the live gate');
      assert.equal((await db.query('select count(*)::int count from sms_delivery_trigger_errors')).rows[0].count,0);
      // The test ends at an in-memory queued row. Nothing claims or dispatches it.
    });
  } finally { await db.close(); }
});
