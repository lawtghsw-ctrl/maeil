// Offline: actual pure code and read adapters, in-memory projected Supabase rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
Module._load = function(name, parent, ...rest) {
  if (name.endsWith('/operations-meta') || name === './operations-meta') return { readOperationsMeta: async()=>[] };
  if (name.startsWith('@/')) return originalLoad.call(this,path.join(root,name.slice(2)),parent,...rest);
  return originalLoad.call(this,name,parent,...rest);
};
require.extensions['.ts'] = (module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename }).outputText,filename);
global.fetch=()=>{throw new Error('Network forbidden');};
const pure = require('../lib/performance/supply-conversion.ts');
const reporting = require('../lib/firm-reporting.ts');
const server = require('../lib/firm-reporting-server.ts');
const ops = require('../lib/platform/operations.ts');
const operationsServer = require('../lib/platform/operations-server.ts');
const firm='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const lead=(id,patch={})=>({id,_lawFirmId:firm,assignedStaff:'A',...patch});
const record=(id,fromLeadId,patch={})=>({id,_lawFirmId:firm,fromLeadId,status:'진행중',contractAmount:100,...patch});
const ledger=(id,leadId=id,patch={})=>({id,law_firm_id:firm,lead_id:leadId,supplied_at:'2026-08-01T00:00:00+09:00',classification:'new',origin:'ingest',billable:true,unit_price_snapshot:100,billing_type:'per_lead',ad_source_id:'s',...patch});
const cohort=(patch={})=>pure.buildSupplyConversionCohorts({firmId:firm,start:'2026-08-01',end:'2026-08-31',asOf:'2026-10-18',ledger:[],leads:[],cases:[],...patch});
const equal=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
const sumCheck=c=>{assert.equal(c.staff.reduce((n,r)=>n+r.db,0),c.supplied);assert.equal(c.staff.reduce((n,r)=>n+r.contractedDb,0),c.retained);};

test('supply timestamp, not intake or contract month, defines both numerator and denominator',()=>{
  const r=cohort({ledger:[ledger('a'),ledger('b'),ledger('outside','c',{supplied_at:'2026-07-31T14:59:59Z'})],leads:[lead('a',{receivedAt:'2026-01-01'}),lead('b'),lead('c')],cases:[record('ca','a',{contractDate:'2026-10-18'}),record('cc','c')]});
  assert.equal(r.supplyCohort.supplied,2);assert.equal(r.supplyCohort.retained,1);assert.equal(r.supplyCohort.conversionRate,50);sumCheck(r.supplyCohort);
});
test('KST month and exact 60-calendar-day boundaries stay independent',()=>{
  const r=cohort({ledger:[ledger('a','a',{supplied_at:'2026-07-31T15:00:00Z'}),ledger('b','b',{supplied_at:'2026-08-19T14:59:59Z'}),ledger('c','c',{supplied_at:'2026-08-19T15:00:00Z'}),ledger('d','d',{supplied_at:'2026-08-31T15:00:00Z'})],leads:['a','b','c','d'].map(id=>lead(id)),cases:[record('c','c')]});
  assert.equal(r.supplyCohort.supplied,3);assert.equal(r.matureCohort.cutoff,'2026-08-19');assert.equal(r.matureCohort.supplied,2);assert.equal(r.matureCohort.retained,0);sumCheck(r.matureCohort);
});
test('nonbillable supplies count; imports/backfills and duplicate events do not',()=>{
  const r=cohort({ledger:[ledger('free','a',{billable:false,unit_price_snapshot:0}),ledger('again','b',{classification:'reentry'}),ledger('old','c',{origin:'backfill'}),...['duplicate_external','duplicate_meta','duplicate_phone'].map(classification=>ledger(classification,'c',{classification}))],leads:['a','b','c'].map(id=>lead(id)),cases:[record('c','a')]});
  assert.equal(r.supplyCohort.supplied,2);assert.equal(r.supplyCohort.retained,1);assert.equal(r.supplyCohort.conversionRate,50);
});
test('same DB repeated in one month is counted once using earliest eligible supply',()=>{
  const r=cohort({ledger:[ledger('later','a',{supplied_at:'2026-08-20T00:00:00+09:00'}),ledger('early','a'),ledger('latest','a',{classification:'reentry'})],leads:[lead('a')],cases:[record('c','a')]});
  assert.equal(r.supplyCohort.supplied,1);assert.equal(r.supplyCohort.retained,1);assert.equal(r.supplyCohort.quality.duplicateSupplyRows,2);assert.equal(r.supplyCohort.conversionRate,100);assert.equal(r.matureCohort.supplied,1);
});
test('positive finite retained contracts deduplicate and exclude cancellation, zero, infinity and boolean',()=>{
  const ids=['a','b','c','d','e'];const r=cohort({ledger:ids.map(id=>ledger(id)),leads:ids.map(id=>lead(id)),cases:[record('a','a'),record('a2','a'),record('b','b',{status:'취하'}),record('c','c',{contractAmount:0}),record('d','d',{contractAmount:Infinity}),record('e','e',{contractAmount:true})]});
  assert.equal(r.supplyCohort.retained,1);assert.equal(r.supplyCohort.conversionRate,20);
});
test('explicit fromLeadId works without reverse pointer, unique fallback works, client-only does not',()=>{
  const r=cohort({ledger:['a','b','c'].map(id=>ledger(id)),leads:[lead('a'),lead('b',{convertedCaseId:'cb'}),lead('c',{convertedClientId:'client'})],cases:[record('ca','a'),record('cb',undefined),record('cc',undefined,{clientId:'client'})]});
  assert.equal(r.supplyCohort.retained,2);assert.equal(r.supplyCohort.quality.unresolvedContracts,0);
});
test('off-period fallback claimants prevent ambiguous assignment and never inflate valid conversions',()=>{
  const r=cohort({ledger:[ledger('a')],leads:[lead('a',{convertedCaseId:'c'}),lead('offperiod',{convertedCaseId:'c'})],cases:[record('c',undefined)]});
  assert.equal(r.supplyCohort.retained,0);assert.equal(r.supplyCohort.quality.unresolvedContracts,1);assert.equal(r.supplyCohort.conversionRate,null);
});
test('conflicting explicit links and missing converted case report uncertainty',()=>{
  const r=cohort({ledger:[ledger('a'),ledger('b')],leads:[lead('a',{convertedCaseId:'c'}),lead('b',{convertedCaseId:'missing'}),lead('other')],cases:[record('c','other')]});
  assert.equal(r.supplyCohort.retained,0);assert.equal(r.supplyCohort.quality.unresolvedContracts,2);assert.equal(r.supplyCohort.conversionRate,null);
});
test('missing lead and null lead retain provisional denominators in a separate non-staff row',()=>{
  const r=cohort({ledger:[ledger('a'),ledger('missing'),ledger('null',null)],leads:[lead('a')],cases:[record('ca','a')]});const c=r.supplyCohort;
  assert.equal(c.supplied,3);assert.equal(c.retained,1);assert.equal(c.conversionRate,null);assert.equal(c.quality.missingLeads,1);assert.equal(c.quality.unlinkedRows,1);assert.equal(c.staff.find(s=>s.kind==='unlinked').db,2);sumCheck(c);sumCheck(r.matureCohort);
});
test('unknown origin/classification and invalid date are explicit uncertainty, never fabricated supply',()=>{
  const r=cohort({ledger:[ledger('a'),ledger('origin','b',{origin:null}),ledger('class','c',{classification:undefined}),ledger('invalid','d',{supplied_at:'invalid'})],leads:['a','b','c','d'].map(id=>lead(id)),cases:[]});
  assert.equal(r.supplyCohort.supplied,1);assert.equal(r.supplyCohort.quality.unknownSupplyRows,2);assert.equal(r.supplyCohort.quality.invalidSupplyDates,1);assert.equal(r.supplyCohort.conversionRate,null);sumCheck(r.supplyCohort);
});
test('staff groups use current trimmed lead owner, preserve zero staff, and first duplicate row wins',()=>{
  const r=cohort({ledger:[ledger('a'),ledger('b')],leads:[lead('a',{assignedStaff:' A '}),lead('a',{assignedStaff:'wrong'}),lead('b',{assignedStaff:' '}),lead('old',{assignedStaff:'Past'})],cases:[record('ca','a'),record('ca','b')],staffNames:['Zero','A']});const c=r.supplyCohort;
  assert.equal(c.staff.find(s=>s.name==='A').contractedDb,1);assert.equal(c.staff.find(s=>s.name==='미지정').db,1);assert.equal(c.staff.find(s=>s.name==='Zero').db,0);assert.equal(c.staff.find(s=>s.name==='Past').db,0);assert.equal(c.staff.some(s=>s.name==='wrong'),false);sumCheck(c);
});
test('empty cohort stays undefined ratio, invalid boundaries and foreign rows fail closed',()=>{
  assert.equal(cohort().supplyCohort.conversionRate,null);
  for(const patch of [{start:'2026-02-30'},{end:'2026-01-01'},{asOf:'bad'},{ledger:[ledger('a','a',{law_firm_id:other})]},{leads:[lead('a',{_lawFirmId:other})]},{cases:[record('a','a',{_lawFirmId:other})]}])assert.throws(()=>cohort(patch));
});
test('all input customer, contract and ledger content remains byte-equivalent',()=>{
  const data={ledger:[ledger('a'),ledger('later','a')],leads:[lead('a',{privateNote:'preserve',convertedCaseId:'c'})],cases:[record('c','a',{contractDate:'2026-12-01',privateMemo:'preserve'})],staffNames:['A']};const before=JSON.stringify(data);cohort(data);assert.equal(JSON.stringify(data),before);
});

// Simulates PostgREST aliases and pagination; writes, auth and network are absent.
function database(tables,cap=137,options={}) {
  const calls=[];
  class Query {
    constructor(table){this.table=table;this.filters=[];this.orders=[];this.offset=0;this.maximum=Infinity;}
    select(columns){this.columns=columns;return this;}
    eq(k,v){this.filters.push(r=>r[k]===v);return this;}
    neq(k,v){this.filters.push(r=>r[k]!==v);return this;}
    gt(k,v){this.filters.push(r=>r[k]>v);return this;}
    gte(k,v){this.filters.push(r=>r[k]>=v);return this;}
    lt(k,v){this.filters.push(r=>r[k]<v);return this;}
    lte(k,v){this.filters.push(r=>r[k]<=v);return this;}
    in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
    order(k,opts={}){this.orders.push([k,opts.ascending!==false]);return this;}
    limit(n){this.maximum=n;return this;}
    range(f,t){this.offset=f;this.maximum=t-f+1;return this;}
    maybeSingle(){this.single=true;return this;}
    abortSignal(){return this;}
    then(resolve,reject){calls.push({table:this.table,columns:this.columns,filters:this.filters.length});let rows=(tables[this.table]??[]).filter(r=>options.ignoreScope||this.filters.every(fn=>fn(r))).slice();rows.sort((a,b)=>{for(const [k,asc] of this.orders){const c=String(a[k]??'').localeCompare(String(b[k]??''));if(c)return asc?c:-c;}return 0;});rows=rows.slice(this.offset,this.offset+Math.min(cap,this.maximum));if(this.columns!=='*')rows=rows.map(r=>Object.fromEntries(this.columns.split(',').map(col=>{const match=col.match(/^([^:]+):data->>(.+)$/);return match?[match[1],r.data?.[match[2]]??null]:col==='contactLog:data->contactLog'?['contactLog',r.data?.contactLog??null]:[col,r[col]];})));return Promise.resolve({data:this.single?rows[0]??null:rows,error:options.fail===this.table?{message:'fixture failure'}:null}).then(resolve,reject);}
  }
  return {admin:{from(table){return new Query(table);}},calls};
}
const dbLead=(id,data={},law_firm_id=firm)=>({id,law_firm_id,data});
const dbCase=(id,data={},law_firm_id=firm)=>({id,law_firm_id,data});
test('read adapter uses complete tenant-scoped minimal projections and includes registered zero staff',async()=>{
  const d=database({lead_supply_ledger:[ledger('a')],app_leads:[dbLead('a',{assignedStaff:'A',privatePhone:'SECRET'})],app_cases:[dbCase('c',{fromLeadId:'a',status:'진행중',contractAmount:100,privateMemo:'SECRET'})],profiles:[{id:'zero',law_firm_id:firm,platform_role:'staff',is_work_staff:true,staff_name:'Zero'},{id:'super',law_firm_id:firm,platform_role:'super_admin',is_work_staff:true,staff_name:'Super'},{id:'nonwork',law_firm_id:firm,platform_role:'staff',is_work_staff:false,staff_name:'Excluded'},{id:'foreign',law_firm_id:other,platform_role:'staff',is_work_staff:true,staff_name:'Foreign'}],platform_firm_commercial_profiles:[{law_firm_id:firm,service_mode:'db_supply'}]});
  const r=await server.readFirmSupply(d.admin,firm,'2026-08-01','2026-08-31');assert.equal(r.supplyCohort.retained,1);assert.equal(r.supplyCohort.staff.some(s=>s.name==='Zero'),true);assert.equal(r.supplyCohort.staff.some(s=>['Super','Excluded','Foreign'].includes(s.name)),false);assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.ok(d.calls.filter(c=>['app_leads','app_cases','profiles'].includes(c.table)).every(c=>!c.columns.split(',').includes('data')&&!c.columns.includes('*')));
});
test('read adapter paginates >1000 at a lower cap without losing whole-cohort ambiguity',async()=>{
  const rows=Array.from({length:1120},(_,i)=>dbLead(String(i).padStart(5,'0'),{assignedStaff:'A',convertedCaseId:i===0||i===1119?'c':undefined}));
  const d=database({app_leads:rows,app_cases:[dbCase('c',{contractAmount:100,status:'진행중'})],lead_supply_ledger:[ledger('l','00000')]});const r=await server.readFirmSupply(d.admin,firm,'2026-08-01','2026-08-31');assert.equal(r.supplyCohort.retained,0);assert.equal(r.supplyCohort.quality.unresolvedContracts,1);assert.ok(d.calls.filter(c=>c.table==='app_leads').length>8);
});
test('tenant guard and read failures prevent partial success while all reads remain read-only',async()=>{
  const foreign=database({app_leads:[dbLead('x',{},other)]},137,{ignoreScope:true});await assert.rejects(()=>server.readFirmSupply(foreign.admin,firm,'2026-08-01','2026-08-31'),/FORBIDDEN/);
  const failed=database({},137,{fail:'app_cases'});await assert.rejects(()=>server.readFirmSupply(failed.admin,firm,'2026-08-01','2026-08-31'),/app_cases/);
});
test('CRM-only keeps actual supply and conversion while purchase costs and supply contracts stay absent',async()=>{
  const d=database({lead_supply_ledger:[ledger('a')],app_leads:[dbLead('a',{assignedStaff:'A'})],app_cases:[dbCase('c',{fromLeadId:'a',status:'진행중',contractAmount:100})],platform_supply_contracts:[{id:'contract',law_firm_id:firm,unit_price:999}],platform_firm_commercial_profiles:[{law_firm_id:firm,service_mode:'crm_only'}]});const r=await server.readFirmSupply(d.admin,firm,'2026-08-01','2026-08-31');assert.equal(r.purchaseCost,0);assert.equal(r.knownPurchaseCost,0);equal(r.contracts,[]);assert.equal(r.supplyCohort.supplied,1);assert.equal(r.supplyCohort.retained,1);assert.equal(r.supplyCohort.conversionRate,100);
});
test('platform and firm share 60-day definitions and isolate colliding tenant lead/case IDs',()=>{
  const common={ledger:[ledger('a'),ledger('dup','a'),ledger('null',null)],leads:[lead('a')],cases:[record('c','a')]};const expected=cohort(common);
  const input={firms:[{id:firm,name:'F',status:'active',firm_code:'1',billing_type:'per_lead'},{id:other,name:'Other',status:'active',firm_code:'2',billing_type:'per_lead'}],contracts:[],adjustments:[],ledger:[...common.ledger,ledger('foreign','a',{law_firm_id:other})],leads:[...common.leads.map(l=>({id:l.id,law_firm_id:l._lawFirmId,data:l})),{id:'a',law_firm_id:other,data:{}}],cases:common.cases.map(c=>({id:c.id,law_firm_id:c._lawFirmId,data:c})),monthRows:[],adSpend:[]};const r=ops.buildOperationsReport(input,'2026-08',false,new Date('2026-10-18T00:00:00Z'));
  equal(r.firms[0].supplyCohort,expected.supplyCohort);equal(r.firms[0].matureCohort,expected.matureCohort);assert.equal(r.firms[1].converted,0);assert.equal(r.sources.reduce((n,s)=>n+s.denominator,0),r.totals.mature);assert.equal(r.sources.reduce((n,s)=>n+s.numerator,0),r.totals.converted);
});
test('operations server loads direct contracts and all claimants without private client payload',async()=>{
  const d=database({law_firms:[{id:firm,name:'F',status:'active',firm_code:'1',billing_type:'per_lead'}],lead_supply_ledger:[ledger('a')],app_leads:[dbLead('a',{assignedStaff:'A',privateMemo:'SECRET'})],app_cases:[dbCase('c',{fromLeadId:'a',contractAmount:100,status:'진행중',privateMemo:'SECRET'})],platform_firm_commercial_profiles:[{law_firm_id:firm,service_mode:'db_supply'}]});const r=await operationsServer.loadOperations(d.admin,'2026-08',false,undefined,new Date('2026-10-18T00:00:00Z'));assert.equal(r.report.firms[0].supplyCohort.retained,1);assert.equal(r.report.totals.converted,1);assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.ok(d.calls.some(c=>c.table==='app_cases'&&c.columns.includes('fromLeadId:data->>fromLeadId')));
});
test('source maturity follows earliest actual timestamp across timezone representations',()=>{
  const input={firms:[{id:firm,name:'F',status:'active',firm_code:'1',billing_type:'per_lead'}],contracts:[],adjustments:[],ledger:[ledger('later','a',{supplied_at:'2026-08-19T15:00:00Z',ad_source_id:'later'}),ledger('earlier','a',{supplied_at:'2026-08-19T23:00:00+09:00',ad_source_id:'earlier'})],leads:[{id:'a',law_firm_id:firm,data:{}}],cases:[{id:'c',law_firm_id:firm,data:{fromLeadId:'a',contractAmount:100,status:'진행중'}}],monthRows:[],adSpend:[]};
  const r=ops.buildOperationsReport(input,'2026-08',false,new Date('2026-10-18T00:00:00Z'));assert.equal(r.totals.mature,1);assert.equal(r.sources.length,1);assert.equal(r.sources[0].source,'earlier');assert.equal(r.sources[0].denominator,1);assert.equal(r.sources[0].numerator,1);
});
test('operations adapter keeps off-period claimants when paginating complete lead identity reads',async()=>{
  const leads=Array.from({length:1120},(_,i)=>dbLead(String(i).padStart(5,'0'),{assignedStaff:'A',convertedCaseId:i===0||i===1119?'c':undefined}));
  const d=database({law_firms:[{id:firm,name:'F',status:'active',firm_code:'1',billing_type:'per_lead'}],lead_supply_ledger:[ledger('l','00000')],app_leads:leads,app_cases:[dbCase('c',{contractAmount:100,status:'진행중'})]});const r=await operationsServer.loadOperations(d.admin,'2026-08',false,undefined,new Date('2026-10-18T00:00:00Z'));assert.equal(r.report.firms[0].supplyCohort.retained,0);assert.equal(r.report.firms[0].supplyCohort.quality.unresolvedContracts,1);assert.equal(r.report.firms[0].supplyCohort.conversionRate,null);
});
test('old closed report stays a snapshot with no fabricated new cohort/lifecycle fields',async()=>{
  const snapshot={month:'2026-08',generatedAt:'old',firms:[{firmId:firm,converted:9}],totals:{revenue:123,adSpend:7,profit:116},trend:[]};const d=database({platform_operations_months:[{month:'2026-08',config:ops.emptyOperationsConfig(),closed_at:'old',snapshot}]});const r=await operationsServer.loadOperations(d.admin,'2026-08',false,undefined,new Date('2026-10-18T00:00:00Z'));assert.equal(r.report.firms[0].converted,9);assert.equal(r.report.firms[0].supplyCohort,undefined);assert.equal(r.report.contractLifecycle,undefined);assert.equal(snapshot.trend.length,0);equal(r.report.totals,snapshot.totals);
});
// Pin the pre-change implementation, so committing this test does not silently
// turn financial-preservation assertions into comparisons with the new code.
const FINANCIAL_BASELINE='54c4810122de4e19435cf5e6c2dd9e95d6aa56fd';
function fromHead(file){const code=execFileSync('git',['show',`${FINANCIAL_BASELINE}:${file}`],{cwd:root,encoding:'utf8'});const module={exports:{}};const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(`(function(require,module,exports){${js}\n})`,{Date,Map,Set,structuredClone,console})(Module.createRequire(path.join(root,file)),module,module.exports);return module.exports;}
test('existing firm purchase costs, weekly/monthly counts and per-lead costs match committed formulas exactly',()=>{
  const old=fromHead('lib/firm-reporting.ts');const rows=[ledger('a'),ledger('free','a',{billable:false}),ledger('zero','b',{unit_price_snapshot:0}),ledger('null',null),ledger('backfill','c',{origin:'backfill'}),ledger('out','a',{supplied_at:'2026-09-01T00:00:00+09:00'})];const args=[firm,'2026-08-01','2026-08-31',rows,[],3,[],'2026-10-18'];const before=old.summarizeFirmSupply(...args),after=reporting.summarizeFirmSupply(...args);delete before.matureCohort;delete after.matureCohort;delete after.supplyCohort;equal(after,before);
});
test('all existing platform money, contact, forecast and business fields match committed calculations',()=>{
  const old=fromHead('lib/platform/operations.ts');const input={firms:[{id:firm,name:'F',status:'active',firm_code:'1',billing_type:'per_lead'}],contracts:[],adjustments:[{id:'r',law_firm_id:firm,event_date:'2026-08-10',kind:'receipt',amount:37,quantity:0}],ledger:[ledger('a'),ledger('again','a'),ledger('free','a',{billable:false}),ledger('null',null)],leads:[{id:'a',law_firm_id:firm,data:{assignedStaff:'A',status:'미상담'}}],cases:[],monthRows:[],adSpend:[{firmId:firm,month:'2026-08',amount:19,source:'firm_settings'}],commercialProfiles:[{law_firm_id:firm,service_mode:'db_supply'}]};
  const before=old.buildOperationsReport(input,'2026-08',false,new Date('2026-10-18T00:00:00Z')),after=ops.buildOperationsReport(input,'2026-08',false,new Date('2026-10-18T00:00:00Z'));for(const result of [before,after]){delete result.contractLifecycle;delete result.sources;for(const m of [...result.firms,result.totals])for(const k of ['mature','converted','missingConversions','conversionRate','supplyCohort','matureCohort'])delete m[k];}equal(after,before);
});
