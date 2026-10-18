const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Existing offline PostgreSQL WASM test runtime, outside the product dependencies.
const pglitePath = path.resolve(__dirname, '../../sms-sql-check/node_modules/@electric-sql/pglite');
const { PGlite } = require(pglitePath);
const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261018002334_platform_operations.sql'), 'utf8');
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firm = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
test('native offline PostgreSQL: permissions, immutable history, future match, revisions, cross-tenant, close history', async t => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles(id uuid primary key,is_active boolean,platform_role text);
    create table public.law_firms(id uuid primary key);
    create table public.lead_supply_ledger(id uuid primary key default gen_random_uuid(),law_firm_id uuid references law_firms(id),lead_id text,classification text,billable boolean,billing_type text,unit_price_snapshot bigint,origin text,supplied_at timestamptz default now());
    insert into profiles values('${actor}',true,'super_admin'); insert into law_firms values('${firm}'),('${other}');
    insert into lead_supply_ledger(law_firm_id,lead_id,classification,billable,billing_type,unit_price_snapshot,origin) values('${firm}','old','new',true,'per_lead',12345,'ingest');
    grant select on profiles,law_firms,lead_supply_ledger to service_role;`);
  const before = JSON.stringify((await db.query('select * from lead_supply_ledger')).rows);
  await db.exec(migration);
  const command = async c => (await db.query('select public.platform_operations_command($1,$2::jsonb,$3::jsonb) as value', [actor, JSON.stringify(c), c.action === 'close' ? JSON.stringify({ month: c.month, includeDemo: false, adjustmentCount: 1, totals: { revenue: 123 } }) : null])).rows[0].value;
  let contract;
  await t.test('migration never rewrites existing snapshot', async () => { const row = (await db.query('select * from lead_supply_ledger')).rows[0]; assert.equal(row.unit_price_snapshot, 12345); assert.equal(row.supply_contract_id, null); assert.equal(JSON.parse(before)[0].lead_id, row.lead_id); });
  await t.test('authenticated role cannot read or invoke private commands', async () => {
    await db.exec('set role authenticated'); await assert.rejects(db.query('select * from platform_operations_months')); await assert.rejects(db.query('select public.platform_operations_command($1,$2::jsonb,null)', [actor, '{}'])); await db.exec('reset role');
  });
  const today = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text as d")).rows[0].d;
  const base = { action: 'contract', id: null, expectedRevision: 0, law_firm_id: firm, product: 'DB', category: '회생', unit_price: 50000, monthly_quantity: 100, start_date: today, end_date: today, status: 'active' };
  await t.test('new confirmed contract records immutable version', async () => { contract = await command(base); assert.equal(contract.revision, 1); assert.equal((await db.query('select count(*)::int as n from platform_supply_contract_versions')).rows[0].n, 1); });
  await t.test('new future intake matches, old timestamp/backfill/manual keeps original price', async () => {
    await db.exec(`insert into lead_supply_ledger(law_firm_id,lead_id,classification,billable,billing_type,unit_price_snapshot,origin,supplied_at) values
      ('${firm}','future','new',true,'per_lead',111,'ingest',clock_timestamp()),
      ('${firm}','backfill','new',true,'per_lead',222,'backfill',clock_timestamp()),
      ('${firm}','manual','new',true,'per_lead',333,'manual',clock_timestamp()),
      ('${firm}','past','new',true,'per_lead',444,'ingest',now()-interval '1 day');`);
    const rows = (await db.query('select * from lead_supply_ledger')).rows; assert.equal(rows.find(r => r.lead_id === 'future').unit_price_snapshot, 50000); assert.equal(rows.find(r => r.lead_id === 'future').supply_contract_id, contract.id);
    for (const [id, amount] of [['backfill',222],['manual',333],['past',444]]) { assert.equal(rows.find(r => r.lead_id === id).unit_price_snapshot, amount); assert.equal(rows.find(r => r.lead_id === id).supply_contract_id, null); }
  });
  await t.test('contract edits preserve earlier ledger price and retain versions', async () => {
    contract = await command({ ...base, id: contract.id, expectedRevision: 1, unit_price: 60000 });
    assert.equal((await db.query("select unit_price_snapshot from lead_supply_ledger where lead_id='future'")).rows[0].unit_price_snapshot, 50000);
    assert.equal((await db.query('select count(*)::int as n from platform_supply_contract_versions')).rows[0].n, 2);
    await assert.rejects(command({ ...base, id: contract.id, expectedRevision: 1 }), /CONFLICT/);
  });
  await t.test('overlapping active contracts rejected; CRM-only cannot become active', async () => {
    await assert.rejects(command(base), /기간이 겹치는/);
    await command({ action: 'commercial', law_firm_id: other, service_mode: 'crm_only', expectedRevision: 0 });
    await assert.rejects(command({ ...base, law_firm_id: other }), /어드민 전용/);
    await assert.rejects(command({ action: 'commercial', law_firm_id: firm, service_mode: 'crm_only', expectedRevision: 1 }), /활성 DB 공급계약/);
  });
  await t.test('adjustments reject foreign contract and ledger links', async () => {
    await assert.rejects(command({ action: 'adjustment', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', law_firm_id: other, contract_id: contract.id, ledger_id: null, event_date: today, kind: 'receipt', quantity: 0, amount: 100, reason: '입금' }), /로펌이 일치하지/);
  });
  const receipt = { action: 'adjustment', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', law_firm_id: firm, contract_id: contract.id, ledger_id: null, event_date: today, kind: 'receipt', quantity: 0, amount: 100, reason: '입금' };
  await t.test('adjustment idempotency accepts exact retry and rejects changed payload', async () => { await command(receipt); await command(receipt); await assert.rejects(command({ ...receipt, amount: 200 }), /CONFLICT/); assert.equal((await db.query('select count(*)::int as n from platform_supply_adjustments')).rows[0].n, 1); });
  const month = today.slice(0, 7); const config = { goals: {}, costs: [], people: [], adSpend: [], rules: {} };
  await t.test('monthly settings CAS and closing snapshot survives reopening', async () => {
    await command({ action: 'settings', month, expectedRevision: 0, config });
    await assert.rejects(command({ action: 'settings', month, expectedRevision: 0, config }), /CONFLICT/);
    await assert.rejects(db.query('select public.platform_operations_command($1,$2::jsonb,$3::jsonb)', [actor, JSON.stringify({ action: 'close', month, expectedRevision: 1 }), JSON.stringify({ month, includeDemo: false, adjustmentCount: 0 })]), /CONFLICT/);
    await command({ action: 'close', month, expectedRevision: 1 });
    await assert.rejects(command({ ...receipt, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }), /마감된 월/);
    await assert.rejects(command({ action: 'settings', month, expectedRevision: 2, config }), /마감된 월/);
    await command({ action: 'reopen', month, expectedRevision: 2 });
    const row = (await db.query('select * from platform_operations_months')).rows[0]; assert.equal(row.closed_at, null); assert.equal(row.snapshot.totals.revenue, 123);
    const history = (await db.query('select * from platform_operations_closings')).rows; assert.equal(history.length, 2); assert.equal(history[0].snapshot.totals.revenue, 123);
  });
  await t.test('inactive/non-super actor rejected before writes', async () => { await db.exec(`update profiles set is_active=false where id='${actor}'`); await assert.rejects(command({ action: 'settings', month, expectedRevision: 3, config }), /FORBIDDEN/); });
  await db.close();
});
