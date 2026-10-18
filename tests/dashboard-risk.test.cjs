// Execute the real dashboard calculations with fixed time and offline store fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const now=Date.parse('2026-10-18T12:00:00+09:00');
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
let store,settings;
const modules=new Map();
function load(file,source){if(source===undefined&&modules.has(file))return modules.get(file);const m={exports:{}};const code=ts.transpileModule(source??fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const req=name=>{
  if(name==='react')return{useMemo:fn=>fn(),useState:value=>[typeof value==='function'?value():value,()=>{}]};
  if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>String(key)});
  if(name==='@/lib/store')return{useStore:()=>store};
  if(name==='@/lib/management-analytics')return{...load('lib/management-core.ts'),useManagementSettings:()=>settings};
  if(name==='@/lib/use-firm-supply')return{useFirmSupply:()=>({data:{purchaseCost:0,serviceMode:'crm_only'},error:null,loading:false})};
  if(name==='./types')return load('lib/types.ts');
  if(name.startsWith('@/lib/'))return load(name.slice(2)+'.ts');
  if(name.startsWith('.')){const target=path.resolve(root,path.dirname(file),name);const resolved=['.ts','.tsx'].map(ext=>target+ext).find(candidate=>fs.existsSync(candidate));if(resolved)return load(path.relative(root,resolved));}
  throw Error('Unmocked dependency '+name);
 };
 vm.runInNewContext(code,{module:m,exports:m.exports,require:req,Date:FixedDate,crypto,fetch:()=>{throw Error('Network forbidden');}},{filename:file});modules.set(file,m.exports);return m.exports;
}
const source=fs.readFileSync(path.join(root,'components/dashboard/FirmDashboard.tsx'),'utf8');
const component=load('dashboard-calculations.tsx',source.slice(0,source.indexOf('  return <>'))+'  return {neglected,stageUnknown,activeLeads,overCap,top,todos};\n}').default;
function lead(id,extra={}){return{id,name:id,assignedStaff:'담당자',status:'신규접수',detailStage:'미상담',receivedAt:'2026-01-01T00:00:00+09:00',consultation:{memoLog:[{at:'2026-01-02T00:00:00+09:00',text:'과거 메모',tag:'일반'}]},...extra};}
function fixture(leads,globalSuper=false){const defaults=structuredClone(load('lib/management-core.ts').DEFAULT_MANAGEMENT_SETTINGS);store={leads,clients:[],cases:[],installments:[],scheduleItems:[],isAdmin:true,currentStaff:'담당자',can:()=>true,profile:{platformRole:globalSuper?'super_admin':'firm_admin',role:'admin'},superAdminFirmScope:null,workStaffNames:['담당자'],firmDirectory:[]};settings={globalSuperView:globalSuper,effectiveFirmId:'f1',activeSettings:defaults,settingsByFirm:{},loading:false,error:null};}
test('old receipt/memo dates do not fabricate neglect; original contact warning and todo counts stay intact',()=>{fixture(Array.from({length:35},(_,i)=>lead(String(i))));const result=component();assert.equal(result.neglected.length,0);assert.equal(result.stageUnknown,35);assert.equal(result.activeLeads.length,35);assert.equal(result.top.contact,35);assert.equal(result.todos.length,20);assert.ok(result.todos.every(row=>row.kind==='부재콜'));assert.match(source,/기록 없음 \{stageUnknown\}건 제외/);});
test('risk counts seven-day stage dwell, ignores newer notes, and excludes terminal or unknown/future records',()=>{const at=days=>new Date(now-days*86400000).toISOString();fixture([
 lead('seven',{stageUpdatedAt:at(7),consultation:{memoLog:[{at:at(0),text:'방금 메모',tag:'일반'}]}}),
 lead('six',{stageUpdatedAt:at(6)}),lead('converted',{stageUpdatedAt:at(30),convertedClientId:'client'}),
 ...['거절','부적합','종결_중단'].map(status=>lead(status,{status,stageUpdatedAt:at(30)})),
 lead('invalid',{stageUpdatedAt:'invalid'}),lead('future',{stageUpdatedAt:at(-1)}),
 ]);const result=component();assert.deepEqual(Array.from(result.neglected,row=>row.id),['seven']);assert.equal(result.stageUnknown,2);assert.equal(result.activeLeads.length,4);});
test('global manager risk applies each firm threshold while keeping unknown rows out',()=>{const stageUpdatedAt=new Date(now-7*86400000).toISOString();fixture([lead('a',{_lawFirmId:'a',stageUpdatedAt}),lead('b',{_lawFirmId:'b',stageUpdatedAt}),lead('missing',{_lawFirmId:'b'})],true);settings.settingsByFirm={a:{...settings.activeSettings,neglectedDays:3},b:{...settings.activeSettings,neglectedDays:10}};const result=component();assert.deepEqual(Array.from(result.neglected,row=>row.id),['a']);assert.equal(result.stageUnknown,1);assert.equal(result.top.contact,3);assert.equal(result.todos.length,3);});

test('deleted greeting and contact memos cannot satisfy dashboard completed-contact indicators',()=>{
 const at=new Date(now).toISOString();
 const memo={id:'memo',at,text:'인사문자 발송 완료',tag:'재통화',staff:'합성담당자'};
 fixture([lead('today',{receivedAt:at,consultation:{memoLog:[{...memo,deletedAt:at,deletedBy:'합성담당자'}]}})]);
 let result=component();assert.equal(result.top.newToday,0);assert.equal(result.top.contact,1);
 fixture([lead('today',{receivedAt:at,consultation:{memoLog:[{...memo,pinned:true,pinOrder:0}]}})]);
 result=component();assert.equal(result.top.newToday,1);assert.equal(result.top.contact,0);
});
