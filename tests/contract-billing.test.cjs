// All tests are offline: pure calculations and PostgreSQL WASM memory fixtures.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const ops=require('../lib/platform/operations.ts');
const firm='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const terms=(patch={})=>({version:1,quantityBasis:'monthly',totalQuantity:null,cycleBasis:'contract_month',paymentTiming:'prepaid',lastPartial:'prorate',...patch});
const contract=(patch={})=>({id:'33333333-3333-4333-8333-333333333333',law_firm_id:firm,unit_price:50000,monthly_quantity:500,start_date:'2026-10-21',end_date:'2027-01-22',billing_terms:terms(),...patch});
const command=(patch={})=>({action:'contract',id:null,expectedRevision:0,law_firm_id:firm,product:'공급',category:'회생',unit_price:50000,monthly_quantity:500,start_date:'2026-10-21',end_date:'2027-01-22',status:'active',...patch});
test('17,741,935 is a 22/31 calendar-month forecast, never a receipt',()=>{
  const c=contract({billing_terms:null}),p=ops.contractBillingPlan(c);assert.equal(p.configured,false);assert.equal(p.periods[3].amount,17741935);assert.equal(p.periods[3].dueDate,null);assert.equal(p.monthlyAmount,25000000);
  assert.equal(Math.round((ops.plannedSupply(c,'2027-01-22')-ops.plannedSupply(c,'2026-12-31'))*50000),17741935);
});
test('contract months expose three complete cycles plus two extra days',()=>{
  const p=ops.contractBillingPlan(contract());assert.deepEqual(p.periods.map(r=>[r.start,r.end,r.amount]),[['2026-10-21','2026-11-20',25000000],['2026-11-21','2026-12-20',25000000],['2026-12-21','2027-01-20',25000000],['2027-01-21','2027-01-22',1612903]]);assert.equal(p.totalAmount,76612903);assert.equal(p.periods[3].fullDays,31);assert.equal(p.periods[3].days,2);
});
test('exact three contract months end January 20 and do not add a fourth period',()=>{
  const p=ops.contractBillingPlan(contract({end_date:'2027-01-20'}));assert.equal(p.periods.length,3);assert.equal(p.totalAmount,75000000);assert.equal(p.totalQuantity,1500);
});
test('additional two days are explicitly prorated, charged full, or included without extra quantity',()=>{
  const included=ops.contractBillingPlan(contract({billing_terms:terms({lastPartial:'included'})}));assert.equal(included.totalAmount,75000000);assert.equal(included.totalQuantity,1500);assert.equal(included.periods[3].extraIncluded,true);assert.equal(included.periods[3].amount,0);
  const full=ops.contractBillingPlan(contract({billing_terms:terms({lastPartial:'full'})}));assert.equal(full.totalAmount,100000000);assert.equal(full.totalQuantity,2000);
});
test('calendar first partial remains prorated even when final period is included',()=>{
  const p=ops.contractBillingPlan(contract({billing_terms:terms({cycleBasis:'calendar_month',lastPartial:'included'})}));assert.equal(p.periods[0].amount,8870968);assert.equal(p.periods[3].amount,0);assert.equal(p.totalAmount,58870968);
});
test('end-of-month anchors clamp from the original date without drifting after February',()=>{
  const p=ops.contractBillingPlan(contract({start_date:'2027-01-31',end_date:'2027-04-29'}));assert.deepEqual(p.periods.map(r=>[r.start,r.end]),[['2027-01-31','2027-02-27'],['2027-02-28','2027-03-30'],['2027-03-31','2027-04-29']]);assert.equal(p.totalAmount,75000000);
});
test('leap February follows calendar days',()=>{
  const p=ops.contractBillingPlan(contract({start_date:'2028-02-01',end_date:'2028-02-29',billing_terms:terms({cycleBasis:'calendar_month'})}));assert.equal(p.periods[0].fullDays,29);assert.equal(p.totalAmount,25000000);
});
test('total quantity means one agreement over the whole term, not quantity per month',()=>{
  const c=contract({monthly_quantity:null,billing_terms:terms({quantityBasis:'total',totalQuantity:500})});const p=ops.contractBillingPlan(c);assert.equal(p.monthlyAmount,null);assert.equal(p.periods.length,1);assert.equal(p.totalAmount,25000000);assert.equal(p.totalQuantity,500);assert.equal(ops.plannedSupply(c,'2027-01-22'),null);
});

test('whole-term agreement forecast records the amount once in its start month, never as recurring monthly receipts',()=>{
  const input={firms:[{id:firm,name:'F',status:'active',firm_code:'1234567890',billing_type:'per_lead'}],contracts:[contract({status:'active',confirmed_at:'2026-10-18T00:00:00Z',monthly_quantity:null,end_date:'2026-12-20',billing_terms:terms({quantityBasis:'total',totalQuantity:1500})})],adjustments:[],ledger:[],leads:[],cases:[],monthRows:[],adSpend:[],commercialProfiles:[{law_firm_id:firm,service_mode:'db_supply'}]};
  const report=ops.buildOperationsReport(input,'2026-10',false,new Date('2026-10-18T00:00:00Z'));
  assert.deepEqual(report.forecastMonths.map(row=>row.committed),[0,0,0]);assert.equal(report.forecastMonths[0].agreementBasis,'period_start');assert.equal(report.forecastMonths[0].pipeline,0);
  const beforeStart=ops.buildOperationsReport(input,'2026-09',false,new Date('2026-09-18T00:00:00Z'));
  assert.deepEqual(beforeStart.forecastMonths.map(row=>row.committed),[75000000,0,0]);
  const monthly=ops.buildOperationsReport({...input,contracts:[contract({status:'active',confirmed_at:'2026-10-18T00:00:00Z'})]},'2026-10',false,new Date('2026-10-18T00:00:00Z'));
  assert.equal(monthly.forecastMonths[0].unallocatedContracts,undefined);assert.equal(monthly.forecastMonths[0].committed,25000000);
});
test('prepayment/postpayment only change due-date references, never amounts or actual receipts',()=>{
  const prepaid=ops.contractBillingPlan(contract()),postpaid=ops.contractBillingPlan(contract({billing_terms:terms({paymentTiming:'postpaid'})})),unknown=ops.contractBillingPlan(contract({billing_terms:terms({paymentTiming:'unspecified'})}));assert.equal(prepaid.periods[0].dueDate,'2026-10-21');assert.equal(postpaid.periods[0].dueDate,'2026-11-20');assert.equal(unknown.periods[0].dueDate,null);assert.equal(prepaid.totalAmount,postpaid.totalAmount);
});
test('missing price/quantity remains unknown; malformed conditions and unsafe totals fail closed',()=>{
  assert.equal(ops.contractBillingPlan(contract({unit_price:null})).totalAmount,null);assert.equal(ops.contractBillingPlan(contract({monthly_quantity:null})).totalAmount,null);
  for(const patch of [{version:2},{cycleBasis:'x'},{paymentTiming:''},{lastPartial:''},{totalQuantity:500},{quantityBasis:'total',totalQuantity:0},{quantityBasis:'total',totalQuantity:1.5},{private:'secret'}])assert.throws(()=>ops.validateContractBillingTerms(terms(patch)));
  assert.throws(()=>ops.contractBillingPlan(contract({unit_price:1000000000000,monthly_quantity:10000000})));assert.throws(()=>ops.contractBillingPlan(contract({start_date:'2026-02-30'})));
});
test('command validates terms, preserves omitted fields for old callers, and rejects mixed total/monthly quantities',()=>{
  assert.equal('billing_terms' in ops.validateOperationCommand(command()),false);assert.equal(ops.validateOperationCommand(command({billing_terms:null})).billing_terms,null);
  assert.equal(ops.validateOperationCommand(command({billing_terms:terms()})).billing_terms.cycleBasis,'contract_month');assert.throws(()=>ops.validateOperationCommand(command({billing_terms:terms({quantityBasis:'total',totalQuantity:500})})));
  assert.equal(ops.validateOperationCommand(command({monthly_quantity:null,billing_terms:terms({quantityBasis:'total',totalQuantity:500})})).monthly_quantity,null);
});
test('all-time linked receipt totals preserve explicit zero and never allocate unrelated firm or unlinked receipts',()=>{
  const c=contract(),rows=[{id:'old',law_firm_id:firm,contract_id:c.id,event_date:'2024-01-01',kind:'receipt',amount:100},{id:'zero',law_firm_id:firm,contract_id:c.id,event_date:'2026-10-01',kind:'receipt',amount:0},{id:'foreign',law_firm_id:other,contract_id:c.id,kind:'receipt',amount:999},{id:'unlinked',law_firm_id:firm,contract_id:null,kind:'receipt',amount:999},{id:'replacement',law_firm_id:firm,contract_id:c.id,kind:'replacement',amount:0}];const before=JSON.stringify({c,rows});const r=ops.contractReceiptTotals([c],rows);assert.deepEqual(r,[{contractId:c.id,firmId:firm,amount:100,count:2}]);assert.equal(JSON.stringify({c,rows}),before);assert.deepEqual(ops.contractReceiptTotals([c],[]),[]);
});

test('operations read returns all-time contract receipts while monthly figures and visible rows retain their own month',async()=>{
  const vm=require('node:vm'),module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,'lib/platform/operations-server.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`,{Date,Map,Set,structuredClone})(name=>name==='./operations'?ops:name==='./operations-meta'?{readOperationsMeta:async()=>[]}:assert.fail(name),module,module.exports);
  const c={...contract(),status:'active',confirmed_at:'2026-10-18T00:00:00Z'};
  const receipt=(id,date,amount,contract_id=c.id)=>({id,law_firm_id:firm,contract_id,ledger_id:null,event_date:date,kind:'receipt',quantity:0,amount,reason:'fixture'});
  const rows={law_firms:[{id:firm,name:'F',status:'active',firm_code:'1234567890',billing_type:'per_lead'}],platform_supply_contracts:[c],platform_firm_commercial_profiles:[{law_firm_id:firm,service_mode:'db_supply'}],platform_supply_adjustments:[receipt('old','2024-01-01',100),receipt('current','2026-10-10',200),receipt('unlinked','2026-10-10',300,null),receipt('later','2027-01-01',400)]};
  let pages=0;const admin={from(table){let predicates=[];const q={select(){return q;},order(){return q;},abortSignal(){return q;},gte(k,v){predicates.push(r=>r[k]>=v);return q;},lte(k,v){predicates.push(r=>r[k]<=v);return q;},lt(k,v){predicates.push(r=>r[k]<v);return q;},eq(k,v){predicates.push(r=>r[k]===v);return q;},neq(k,v){predicates.push(r=>r[k]!==v);return q;},in(k,v){predicates.push(r=>v.includes(r[k]));return q;},range(from,to){if(table==='platform_supply_adjustments')pages++;return Promise.resolve({data:(rows[table]??[]).filter(r=>predicates.every(p=>p(r))).slice(from,Math.min(to+1,from+2)),error:null});}};return q;}};
  const before=JSON.stringify(rows);const r=await module.exports.loadOperations(admin,'2026-10',false,undefined,new Date('2026-10-18T00:00:00Z'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.contractReceipts)),[{contractId:c.id,firmId:firm,amount:700,count:3}]);assert.equal(r.adjustments.length,2);assert.equal(r.report.firms[0].paid,500);assert.equal(r.report.adjustmentCount,2);assert.ok(pages>=3);assert.equal(JSON.stringify(rows),before);
});
test('native PostgreSQL billing extension preserves existing financial/customer/SMS state and atomic CAS history',async t=>{
  const {PGlite}=require(path.resolve(__dirname,'../../sms-sql-check/node_modules/@electric-sql/pglite'));const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table profiles(id uuid primary key,is_active boolean,platform_role text);create table law_firms(id uuid primary key);
    create table lead_supply_ledger(id uuid primary key default gen_random_uuid(),law_firm_id uuid references law_firms(id),lead_id text,classification text,billable boolean,billing_type text,unit_price_snapshot bigint,origin text,supplied_at timestamptz default now());
    create table app_clients(id text primary key,data jsonb);create table app_cases(id text primary key,data jsonb);create table sms_delivery_jobs(id text primary key,data jsonb);
    insert into profiles values('${actor}',true,'super_admin');insert into law_firms values('${firm}'),('${other}');insert into app_clients values('keep','{"name":"customer"}');insert into app_cases values('keep','{"amount":100}');insert into sms_delivery_jobs values('pending','{"status":"pending","auto":false}');
    grant select on profiles,law_firms,lead_supply_ledger to service_role;`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261018002334_platform_operations.sql'),'utf8'));
  const run=async c=>(await db.query('select public.platform_operations_command($1,$2::jsonb,null) value',[actor,JSON.stringify(c)])).rows[0].value;
  let original=await run(command());
  await db.exec(`insert into lead_supply_ledger(law_firm_id,lead_id,classification,billable,billing_type,unit_price_snapshot,origin) values('${firm}','keep','new',true,'per_lead',12345,'backfill');`);
  const protectedState=async()=>JSON.stringify((await db.query(`select jsonb_build_object('clients',(select jsonb_agg(t) from app_clients t),'cases',(select jsonb_agg(t) from app_cases t),'sms',(select jsonb_agg(t) from sms_delivery_jobs t),'ledger',(select jsonb_agg(t) from lead_supply_ledger t),'receipts',(select jsonb_agg(t) from platform_supply_adjustments t),'months',(select jsonb_agg(t) from platform_operations_months t)) value`)).rows[0].value);
  const before=await protectedState(),oldVersion=(await db.query('select value from platform_supply_contract_versions')).rows[0].value;
  const triggerBefore=(await db.query("select pg_get_functiondef('public.platform_match_future_supply_contract()'::regprocedure) value")).rows[0].value;
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261018082255_platform_contract_billing_terms.sql'),'utf8'));
  await t.test('migration adds NULL metadata without rewriting any original contract or protected record',async()=>{const after=(await db.query('select to_jsonb(c) value from platform_supply_contracts c')).rows[0].value;assert.equal(after.billing_terms,null);delete after.billing_terms;assert.deepEqual(after,original);assert.equal(await protectedState(),before);assert.deepEqual((await db.query('select value from platform_supply_contract_versions')).rows[0].value,oldVersion);assert.equal((await db.query("select pg_get_functiondef('public.platform_match_future_supply_contract()'::regprocedure) value")).rows[0].value,triggerBefore);});
  await t.test('anon/authenticated cannot call commands, validation helper or private tables',async()=>{for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(run(command()),/permission denied/);await assert.rejects(db.query('select * from platform_supply_contracts'),/permission denied/);await assert.rejects(db.query('select public.platform_contract_billing_terms_valid(null)'),/permission denied/);await db.exec('reset role');}});
  let saved;
  await t.test('service command stores explicit conditions in same immutable revision',async()=>{await db.exec('set role service_role');saved=await run(command({id:original.id,expectedRevision:1,billing_terms:terms({lastPartial:'included'})}));await db.exec('reset role');assert.equal(saved.revision,2);assert.equal(saved.billing_terms.lastPartial,'included');assert.deepEqual((await db.query('select value from platform_supply_contract_versions where revision=2')).rows[0].value,saved);});
  await t.test('old caller omitting billing_terms preserves saved metadata',async()=>{saved=await run(command({id:saved.id,expectedRevision:saved.revision,product:'상품명 수정'}));assert.equal(saved.billing_terms.lastPartial,'included');assert.equal(saved.revision,3);});
  await t.test('stale revision and wrong tenant fail atomically',async()=>{const n=(await db.query('select count(*)::int n from platform_supply_contract_versions')).rows[0].n;await assert.rejects(run(command({id:saved.id,expectedRevision:2,billing_terms:terms()})),/CONFLICT/);await assert.rejects(run(command({id:saved.id,expectedRevision:3,law_firm_id:other,billing_terms:terms()})),/로펌은 변경/);assert.equal((await db.query('select count(*)::int n from platform_supply_contract_versions')).rows[0].n,n);});
  await t.test('total quantity can replace monthly quantity only with explicit valid metadata',async()=>{saved=await run(command({id:saved.id,expectedRevision:saved.revision,monthly_quantity:null,billing_terms:terms({quantityBasis:'total',totalQuantity:500})}));assert.equal(saved.monthly_quantity,null);assert.equal(saved.billing_terms.totalQuantity,500);});
  await t.test('invalid/null field JSON and mixed quantities are rejected at the database boundary',async()=>{for(const bad of [terms({version:2}),terms({paymentTiming:null}),terms({quantityBasis:'total',totalQuantity:0}),terms({extra:'x'})])await assert.rejects(run(command({id:saved.id,expectedRevision:saved.revision,billing_terms:bad})),/결제 조건/);await assert.rejects(run(command({id:saved.id,expectedRevision:saved.revision,billing_terms:terms({quantityBasis:'total',totalQuantity:500})})),/월 약정량/);});
  await t.test('explicit metadata clear is allowed only through an ordinary revision-checked save',async()=>{saved=await run(command({id:saved.id,expectedRevision:saved.revision,billing_terms:null}));assert.equal(saved.billing_terms,null);assert.equal(saved.monthly_quantity,500);});
  await t.test('non-super/inactive actor remains rejected and all protected records remain unchanged',async()=>{await db.exec(`update profiles set is_active=false where id='${actor}'`);await assert.rejects(run(command({id:saved.id,expectedRevision:saved.revision,billing_terms:terms()})),/FORBIDDEN/);assert.equal(await protectedState(),before);});
  await db.close();
});
