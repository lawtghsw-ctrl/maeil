const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Actual PostgreSQL/WASM and synthetic rows only. Never contacts Supabase or SMS providers.
const { PGlite } = require(path.resolve(__dirname, '../../sms-sql-check/node_modules/@electric-sql/pglite'));
const read = name => fs.readFileSync(path.resolve(__dirname, '../supabase/migrations', name), 'utf8');
const migration = path.resolve(__dirname, '../supabase/migrations/20261021053916_sms_own_automation_settings.sql');
const uuid = n => `00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const firm=uuid(1), otherFirm=uuid(2), sender=uuid(3);
const own=uuid(10), other=uuid(11), fresh=uuid(12), manager=uuid(13), admin=uuid(14), superAdmin=uuid(15);
const foreign=uuid(16), inactive=uuid(17), duplicate=uuid(18), duplicateInactive=uuid(19), noView=uuid(20);
const legacy=`${firm}/auto/new-lead/admin-created.png`, unrelated=`${firm}/auto/absence/unrelated.png`;
const newPath=(actor=own,kind='new-lead',suffix=30,tenant=firm)=>`${tenant}/auto-own/${actor}/${kind}/${uuid(suffix)}-photo.png`;
function functionSql(source,name){
  const matches=[...source.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,'gi'))];
  assert.ok(matches.length,`Missing helper ${name}`); return matches.at(-1)[0];
}

test('own SMS automation: real RLS, immutable ownership, safe backfill and storage isolation',async t=>{
  const db=new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,storage to authenticated,service_role;
      create table auth.users(id uuid primary key);
      create table law_firms(id uuid primary key,name text,status text default 'active');
      create table profiles(id uuid primary key references auth.users(id) on delete cascade,
        law_firm_id uuid,platform_role text,role text,staff_name text,display_name text,
        is_active boolean,permissions jsonb default '{}');
      create table app_leads(id text primary key,law_firm_id uuid references law_firms(id),data jsonb);
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(id uuid primary key default gen_random_uuid(),name text unique,bucket_id text,
        owner_id text,metadata jsonb);
      alter table storage.objects enable row level security;
      insert into law_firms values('${firm}','Synthetic A','active'),('${otherFirm}','Synthetic B','active');
    `);
    const profiles=[
      [own,firm,'staff','staff','Owner A','Owner A',true,{'sms.view':true}],
      [other,firm,'staff','staff','Other B','Other B',true,{'sms.view':true,'sms.send':true}],
      [fresh,firm,'staff','staff','','Fresh Fallback',true,{'sms.view':true}],
      [manager,firm,'staff','staff','Manager','Manager',true,{'sms.view':true,'sms.manage_settings':true}],
      [admin,firm,'firm_admin','admin','Admin','Admin',true,{}],
      [superAdmin,null,'super_admin','admin','Super','Super',true,{}],
      [foreign,otherFirm,'staff','staff','Owner A','Owner A',true,{'sms.view':true}],
      [inactive,firm,'staff','staff','Inactive','Inactive',false,{'sms.view':true}],
      [duplicate,firm,'staff','staff','Duplicate','Duplicate',true,{'sms.view':true}],
      [duplicateInactive,firm,'staff','staff','Duplicate','Duplicate',false,{'sms.view':true}],
      [noView,firm,'staff','staff','No View','No View',true,{}],
    ];
    for(const p of profiles){await db.query('insert into auth.users values($1)',[p[0]]);
      await db.query('insert into profiles values($1,$2,$3,$4,$5,$6,$7,$8)',p);}
    const tenantSql=read('006_multi_tenant_platform.sql');
    for(const name of ['current_law_firm_id','current_platform_role','is_super_admin','is_firm_admin',
      'is_active_user','is_admin_user','has_permission']) await db.exec(functionSql(tenantSql,name));
    await db.exec(functionSql(read('002_staff_accounts_permissions.sql'),'current_staff_name'));
    await db.exec(`alter table profiles enable row level security;
      create policy profiles_read on profiles for select to authenticated using(
        id=auth.uid() or public.is_super_admin() or
        (public.is_active_user() and law_firm_id=public.current_law_firm_id()));
      grant select on profiles to authenticated;`);
    for(const name of ['014_sms_center_foundation.sql','015_sms_staff_automation_images.sql','016_sms_permissions.sql']) await db.exec(read(name));
    await db.exec(`grant select,insert,update,delete on sms_staff_automation_settings,sms_automation_settings,
      sms_sender_numbers,sms_templates,storage.objects to authenticated;
      insert into sms_sender_numbers(id,law_firm_id,staff_name,phone,is_registered,is_active,is_default)
        values('${sender}','${firm}','Owner A','01011112222',true,true,true);
      insert into sms_staff_automation_settings(law_firm_id,staff_name,sender_number_id,new_lead_enabled,
        absence_enabled,new_lead_template,absence_template,new_lead_image_paths,updated_by) values
        ('${firm}','Owner A','${sender}',true,false,'Original A','Original absence','["${legacy}"]','${admin}'),
        ('${firm}','Other B',null,false,true,'Original B','B absence','[]','${admin}'),
        ('${firm}','Duplicate',null,true,true,'Ambiguous','Ambiguous absence','[]','${admin}'),
        ('${firm}','Unbound legacy',null,true,true,'Unbound','Unbound absence','[]','${admin}'),
        ('${otherFirm}','Owner A',null,true,true,'Other firm','Other firm absence','[]',null);
      insert into storage.objects(name,bucket_id,owner_id) values
        ('${legacy}','sms-media','${admin}'),('${unrelated}','sms-media','${admin}'),
        ('${otherFirm}/auto/photo.png','sms-media','${foreign}');
      alter default privileges grant execute on functions to anon,authenticated,service_role;
    `);
    const allSettings=async()=> (await db.query("select to_jsonb(s) - 'staff_profile_id' as value from sms_staff_automation_settings s order by law_firm_id,staff_name")).rows;
    const managerPolicies=async()=> (await db.query(`select tablename,policyname,cmd,qual,with_check from pg_policies
      where policyname in ('sms_staff_auto_read','sms_staff_auto_manage','sms_media_read','sms_media_insert','sms_media_delete',
      'sms_auto_read','sms_auto_manage','sms_sender_read','sms_sender_manage','sms_templates_read','sms_templates_manage') order by policyname`)).rows;
    const unrelatedState=async()=> (await db.query(`select jsonb_build_object(
      'global',(select jsonb_agg(to_jsonb(s)) from sms_automation_settings s),
      'senders',(select jsonb_agg(to_jsonb(s)) from sms_sender_numbers s),
      'templates',(select jsonb_agg(to_jsonb(s)) from sms_templates s),
      'outbox',(select jsonb_agg(to_jsonb(s)) from sms_outbox s),
      'leads',(select jsonb_agg(to_jsonb(s)) from app_leads s)) value`)).rows[0].value;
    const preRows=await allSettings(),prePolicies=await managerPolicies(),preUnrelated=await unrelatedState();
    await db.exec(fs.readFileSync(migration,'utf8'));
    const as=async(actor,fn,role='authenticated')=>{
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);await db.exec(`set role ${role}`);
      try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}
    };
    const ownRows=()=>db.query('select * from sms_staff_automation_settings order by staff_name');
    const update=(actor,patch,where='staff_profile_id=$2',target=actor)=>{
      const keys=Object.keys(patch),sets=keys.map((key,i)=>`${key}=$${i+1}`).join(',');
      const sqlWhere=where.replaceAll('$2',`$${keys.length+1}`);
      return as(actor,()=>db.query(`update sms_staff_automation_settings set ${sets} where ${sqlWhere} returning *`,[...Object.values(patch),target]));
    };
    const insert=(actor,overrides={})=>{
      const row={law_firm_id:firm,staff_profile_id:actor,staff_name:'Fresh Fallback',sender_number_id:null,
        new_lead_enabled:false,absence_enabled:false,new_lead_template:'Personal new',absence_template:'Personal absence',
        new_lead_image_paths:[],absence_image_paths:[],...overrides};
      const keys=Object.keys(row),args=keys.map(k=>['new_lead_image_paths','absence_image_paths'].includes(k)?JSON.stringify(row[k]):row[k]);
      return as(actor,()=>db.query(`insert into sms_staff_automation_settings(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')}) returning *`,args));
    };
    const upload=(actor,name)=>as(actor,()=>db.query("insert into storage.objects(name,bucket_id,owner_id) values($1,'sms-media',$2) returning name",[name,actor]));

    await t.test('migration changes ownership metadata only; original policies/functions remain intact',async()=>{
      assert.deepEqual(await allSettings(),preRows);assert.deepEqual(await managerPolicies(),prePolicies);
      assert.deepEqual(await unrelatedState(),preUnrelated);
      const rows=(await db.query('select staff_name,staff_profile_id from sms_staff_automation_settings where law_firm_id=$1 order by staff_name',[firm])).rows;
      assert.deepEqual(rows,[{staff_name:'Duplicate',staff_profile_id:null},{staff_name:'Other B',staff_profile_id:other},
        {staff_name:'Owner A',staff_profile_id:own},{staff_name:'Unbound legacy',staff_profile_id:null}]);
      const names=['sms_can_manage_automation','sms_is_own_automation','sms_is_own_automation_path','sms_own_automation_images_valid','enforce_sms_own_automation'];
      for(const name of names){
        const row=(await db.query(`select p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon,
          has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
          has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p where p.proname=$1`,[name])).rows[0];
        assert.equal(row.prosecdef,false);assert.equal(row.anon,false);assert.equal(row.service,false);
        assert.equal(row.authenticated,name!=='enforce_sms_own_automation');
      }
    });
    await t.test('same-firm identity RPC and own read expose only the linked current identity',async()=>{
      const rows=(await as(own,ownRows)).rows;assert.equal(rows.length,1);assert.equal(rows[0].staff_profile_id,own);
      assert.equal((await as(own,()=>db.query('select sms_is_own_automation($1,$2,$3) ok',[firm,own,'Owner A']))).rows[0].ok,true);
      assert.equal((await as(own,()=>db.query('select sms_is_own_automation($1,$2,$3) ok',[firm,other,'Other B']))).rows[0].ok,false);
      assert.equal((await as(duplicate,()=>db.query('select sms_is_own_automation($1,$2,$3) ok',[firm,duplicate,'Duplicate']))).rows[0].ok,false);
      assert.equal((await as(foreign,ownRows)).rows.length,1);
      assert.equal((await as(foreign,ownRows)).rows[0].law_firm_id,otherFirm);
    });
    await t.test('own existing text/flags round-trip with DB-owned audit and sender retained',async()=>{
      const rows=(await update(own,{new_lead_template:'  Edited text\n{담당자}  ',absence_template:'Edited absence',
        new_lead_enabled:false,absence_enabled:true,updated_by:other,updated_at:'2000-01-01T00:00:00Z'})).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].new_lead_template,'  Edited text\n{담당자}  ');
      assert.equal(rows[0].updated_by,own);assert.notEqual(new Date(rows[0].updated_at).getUTCFullYear(),2000);
      assert.equal(rows[0].sender_number_id,sender);assert.deepEqual(rows[0].new_lead_image_paths,[legacy]);
      assert.equal((await as(own,ownRows)).rows[0].absence_template,'Edited absence');
    });
    await t.test('own first row supports display-name fallback, null sender and disabled explicit defaults',async()=>{
      const row=(await insert(fresh)).rows[0];assert.equal(row.staff_name,'Fresh Fallback');assert.equal(row.staff_profile_id,fresh);
      assert.equal(row.sender_number_id,null);assert.equal(row.new_lead_enabled,false);assert.equal(row.absence_enabled,false);
      assert.equal(row.updated_by,fresh);assert.equal((await as(fresh,ownRows)).rows.length,1);
    });
    await t.test('immutable row identity/sender and another owner or firm cannot be changed',async()=>{
      const attempts=[{id:uuid(999)},{staff_profile_id:other},{staff_name:'Other B'},
        {law_firm_id:otherFirm},{sender_number_id:null},{created_at:'2000-01-01T00:00:00Z'}];
      for(const patch of attempts) await assert.rejects(update(own,patch),/SMS_AUTOMATION_(IDENTITY|IMMUTABLE)/);
      assert.equal((await update(own,{new_lead_template:'attacker'},'staff_profile_id=$2',other)).rows.length,0);
      assert.equal((await as(own,()=>db.query('delete from sms_staff_automation_settings returning id'))).rows.length,0);
      await assert.rejects(insert(own,{staff_profile_id:other,staff_name:'Other B'}),/SMS_AUTOMATION_IDENTITY/);
      await assert.rejects(insert(own,{law_firm_id:otherFirm,staff_name:'Owner A'}),/SMS_AUTOMATION_IDENTITY/);
      await assert.rejects(insert(fresh,{sender_number_id:sender}),/SMS_AUTOMATION_IMMUTABLE/);
      // Raw conflict-upsert cannot bypass the immutable-field trigger.
      await assert.rejects(as(own,()=>db.query(`insert into sms_staff_automation_settings
        (law_firm_id,staff_profile_id,staff_name,new_lead_enabled,absence_enabled)
        values($1,$2,'Owner A',false,false) on conflict(law_firm_id,staff_name)
        do update set sender_number_id=null returning *`,[firm,own])),/SMS_AUTOMATION_IMMUTABLE/);
      await assert.rejects(as(own,()=>db.query(`insert into sms_staff_automation_settings
        (law_firm_id,staff_profile_id,staff_name,new_lead_enabled,absence_enabled)
        values($1,$2,'Other B',false,false) on conflict(law_firm_id,staff_name)
        do update set new_lead_template='attacker' returning *`,[firm,own])),/SMS_AUTOMATION_IDENTITY/);

    });
    await t.test('global/sender/template powers are not granted and saving cannot enqueue SMS',async()=>{
      assert.deepEqual((await as(own,()=>db.query('select * from sms_automation_settings'))).rows,[]);
      assert.equal((await as(own,()=>db.query('update sms_automation_settings set duplicate_guard_minutes=0 returning law_firm_id'))).rows.length,0);
      assert.equal((await as(own,()=>db.query("update sms_sender_numbers set phone='01099999999' returning id"))).rows.length,0);
      await assert.rejects(as(own,()=>db.query("insert into sms_templates(law_firm_id,name,body) values($1,'Forbidden','Forbidden')",[firm])),/row-level security/);
      assert.deepEqual(await unrelatedState(),preUnrelated);
    });
    await t.test('own uploads and admin legacy references readable; unrelated/new foreign paths rejected',async()=>{
      const p=newPath();await upload(own,p);
      const uppercase=newPath(own,'absence',33).replace('.png','.JPG');await upload(own,uppercase);
      await update(own,{absence_image_paths:JSON.stringify([uppercase])});
      const visible=(await as(own,()=>db.query('select name from storage.objects order by name'))).rows.map(r=>r.name);
      assert.ok(visible.includes(p));assert.ok(visible.includes(legacy));assert.ok(!visible.includes(unrelated));
      await assert.rejects(upload(own,newPath(other)),/row-level security/);
      await assert.rejects(upload(own,newPath(own,'new-lead',31,otherFirm)),/row-level security/);
      await assert.rejects(upload(own,`${firm}/ordinary/forbidden.png`),/row-level security/);
      // Existing sms.send alone must not bypass the new reserved namespace guard.
      await assert.rejects(upload(other,newPath(own,'absence',32)),/row-level security/);
      await upload(other,`${firm}/ordinary/manual-send.png`);
      const saved=(await update(own,{new_lead_image_paths:JSON.stringify([legacy,p])})).rows[0];
      assert.deepEqual(saved.new_lead_image_paths,[legacy,p]);
      await assert.rejects(update(own,{absence_image_paths:JSON.stringify([p])}),/SMS_AUTOMATION_IMAGE_PATH/);
      await assert.rejects(update(own,{new_lead_image_paths:JSON.stringify([unrelated])}),/SMS_AUTOMATION_IMAGE_PATH/);
      await assert.rejects(update(own,{new_lead_image_paths:JSON.stringify([newPath(own,'new-lead',55)])}),/SMS_AUTOMATION_IMAGE_PATH/);
      await assert.rejects(update(own,{new_lead_image_paths:JSON.stringify([p,p])}),/SMS_AUTOMATION_IMAGE_PATH/);
      await assert.rejects(update(own,{new_lead_image_paths:JSON.stringify([p,p,p,p])}),/SMS_AUTOMATION_IMAGE_PATH/);
      await assert.rejects(update(own,{new_lead_image_paths:JSON.stringify([true])}),/SMS_AUTOMATION_IMAGE_PATH/);
      await update(own,{new_lead_image_paths:'[]'});
      assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[legacy])).rows[0].n,1);
      assert.equal((await as(own,()=>db.query('delete from storage.objects returning id'))).rows.length,0);
      assert.equal((await as(own,()=>db.query("update storage.objects set name=name||'-overwrite' returning id"))).rows.length,0);
    });
    await t.test('managers keep broad settings scope and can upload for employees',async()=>{
      for(const actor of [manager,admin]){
        assert.ok((await as(actor,ownRows)).rows.length>=5);
        const row=(await update(actor,{new_lead_template:'Manager edit',sender_number_id:sender},'staff_profile_id=$2',other)).rows[0];
        assert.equal(row.sender_number_id,sender);
        assert.equal((await as(actor,()=>db.query('select * from sms_staff_automation_settings where law_firm_id=$1',[otherFirm]))).rows.length,0);
      }
      assert.ok((await as(superAdmin,ownRows)).rows.some(r=>r.law_firm_id===otherFirm));
      const p=newPath(own,'absence',60);await upload(admin,p);
      await update(own,{absence_image_paths:JSON.stringify([p])});
      const newActor=uuid(61);await db.query('insert into auth.users values($1)',[newActor]);
      await db.query("insert into profiles values($1,$2,'staff','staff','Manager-created owner','Manager-created owner',true,'{\"sms.view\":true}')",[newActor,firm]);
      const row=(await as(manager,()=>db.query(`insert into sms_staff_automation_settings(law_firm_id,staff_name,new_lead_template)
        values($1,'Manager-created owner','Manager initial') on conflict(law_firm_id,staff_name)
        do update set new_lead_template=excluded.new_lead_template returning *`,[firm]))).rows[0];
      assert.equal(row.staff_profile_id,newActor);
      const again=(await as(manager,()=>db.query(`insert into sms_staff_automation_settings(law_firm_id,staff_name,new_lead_template)
        values($1,'Manager-created owner','Manager later') on conflict(law_firm_id,staff_name)
        do update set new_lead_template=excluded.new_lead_template returning *`,[firm]))).rows[0];
      assert.equal(again.staff_profile_id,newActor);assert.equal(again.id,row.id);
    });
    await t.test('inactive, no-view, suspended and revoked identities fail closed',async()=>{
      for(const [actor,name] of [[inactive,'Inactive'],[noView,'No View'],[duplicate,'Duplicate']]){
        assert.deepEqual((await as(actor,ownRows)).rows,[]);
        await assert.rejects(insert(actor,{staff_name:name}),/SMS_AUTOMATION_IDENTITY/);
        await assert.rejects(upload(actor,newPath(actor,'new-lead',80)),/row-level security/);
      }
      await db.query("update law_firms set status='suspended' where id=$1",[firm]);
      assert.deepEqual((await as(own,ownRows)).rows,[]);await assert.rejects(upload(own,newPath(own,'new-lead',81)),/row-level security/);
      await db.query("update law_firms set status='active' where id=$1",[firm]);
      await db.query("update profiles set permissions='{}' where id=$1",[own]);
      assert.deepEqual((await as(own,ownRows)).rows,[]);await assert.rejects(upload(own,newPath(own,'new-lead',82)),/row-level security/);
      await db.query("update profiles set permissions='{\"sms.view\":true}' where id=$1",[own]);
    });
    await t.test('a later inactive name collision also disables access to an already bound row',async()=>{
      const collision=uuid(85);await db.query('insert into auth.users values($1)',[collision]);
      await db.query("insert into profiles values($1,$2,'staff','staff','Owner A','Owner A',false,'{}')",[collision,firm]);
      assert.deepEqual((await as(own,ownRows)).rows,[]);
      assert.equal((await update(own,{new_lead_template:'blocked collision edit'})).rows.length,0);
      await assert.rejects(upload(own,newPath(own,'new-lead',86)),/row-level security/);
      await db.query('delete from auth.users where id=$1',[collision]);
      assert.equal((await as(own,ownRows)).rows.length,1);
    });
    await t.test('rename, name reuse, unbound conflicts and duplicates never transfer an existing row',async()=>{
      await db.query("update profiles set staff_name='Renamed A',display_name='Renamed A' where id=$1",[own]);
      assert.deepEqual((await as(own,ownRows)).rows,[]);
      await assert.rejects(insert(own,{staff_name:'Renamed A'}),/unique constraint/);
      const reused=uuid(90);await db.query('insert into auth.users values($1)',[reused]);
      await db.query("insert into profiles values($1,$2,'staff','staff','Owner A','Owner A',true,'{\"sms.view\":true}')",[reused,firm]);
      assert.deepEqual((await as(reused,ownRows)).rows,[]);
      await assert.rejects(insert(reused,{staff_name:'Owner A'}),/unique constraint/);
      const unbound=uuid(91);await db.query('insert into auth.users values($1)',[unbound]);
      await db.query("insert into profiles values($1,$2,'staff','staff','Unbound legacy','Unbound legacy',true,'{\"sms.view\":true}')",[unbound,firm]);
      assert.deepEqual((await as(unbound,ownRows)).rows,[]);
      await assert.rejects(insert(unbound,{staff_name:'Unbound legacy'}),/unique constraint/);
      await assert.rejects(as(unbound,()=>db.query(`insert into sms_staff_automation_settings
        (law_firm_id,staff_profile_id,staff_name,new_lead_enabled,absence_enabled)
        values($1,$2,'Unbound legacy',false,false) on conflict(law_firm_id,staff_name)
        do update set new_lead_template='attempted claim',staff_profile_id=excluded.staff_profile_id
        returning *`,[firm,unbound])),/row-level security|SMS_AUTOMATION_(FORBIDDEN|IMMUTABLE)/);

      // A JWT user-metadata name cannot affect the trusted server-side profile lookup.
      await db.query("select set_config('request.jwt.claim.user_metadata','{\"staff_name\":\"Other B\"}',false)");
      assert.equal((await as(reused,()=>db.query('select sms_is_own_automation($1,$2,$3) ok',[firm,other,'Other B']))).rows[0].ok,false);
    });
  }finally{await db.close();}
});
