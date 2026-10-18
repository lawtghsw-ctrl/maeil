const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.resolve(__dirname, '../../sms-sql-check/node_modules/@electric-sql/pglite'));

test('native Postgres: management key API-only policy preserves other keys and all original rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role service_role bypassrls;
      create table public.firm_settings (key text primary key, value jsonb);
      insert into public.firm_settings values ('management_analytics_v1','{"adSpendEntries":[{"amount":777}]}'),('case_documents','{"case":{"doc":true}}');
      alter table public.firm_settings enable row level security;
      grant select,insert,update,delete on public.firm_settings to authenticated,service_role;
      create policy existing_access on public.firm_settings for all to authenticated using(true) with check(true);`);
    const before = (await db.query('select md5(string_agg(row_to_json(f)::text,\'\' order by key)) hash from public.firm_settings f')).rows[0].hash;
    await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261018002409_firm_management_private_costs.sql'),'utf8'));
    await db.exec('set role authenticated');
    assert.deepEqual((await db.query('select key from public.firm_settings')).rows.map(row=>row.key),['case_documents']);
    assert.equal((await db.query("update public.firm_settings set value='{}' where key='management_analytics_v1' returning key")).rows.length,0);
    await assert.rejects(db.query("insert into public.firm_settings values ('management_analytics_v1','{}') on conflict(key) do update set value=excluded.value"), /row-level security/);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select count(*)::int count from public.firm_settings')).rows[0].count,2);
    await db.exec('reset role');
    assert.equal((await db.query('select md5(string_agg(row_to_json(f)::text,\'\' order by key)) hash from public.firm_settings f')).rows[0].hash,before);
  } finally { await db.close(); }
});
