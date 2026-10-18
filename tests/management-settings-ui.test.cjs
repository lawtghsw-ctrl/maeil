// Actual React renderer, controlled offline HTTP responses; no network.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root=path.resolve(__dirname,'..'), runtime=path.resolve(root,'../store-test-runtime/node_modules');
const React=require(path.join(runtime,'react')), renderer=require(path.join(runtime,'react-test-renderer')), {act}=renderer;
const ts=require('typescript');
const original=Module._load;
const client={auth:{getSession:async()=>({data:{session:{access_token:'offline'}}})}};
Module._load=function(name,parent,...rest){if(name==='react')return React;if(name==='react/jsx-runtime')return require(path.join(runtime,'react/jsx-runtime'));if(name==='@/lib/supabase/client')return{createClient:()=>client};if(name.startsWith('@/'))return original.call(this,path.join(root,name.slice(2)),parent,...rest);return original.call(this,name,parent,...rest);};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const {useManagementSettings}=require('../lib/management-analytics.ts');
const {DEFAULT_MANAGEMENT_SETTINGS}=require('../lib/management-core.ts');
let latest,calls,pending;
function View({firm='f1',tick=0}){latest=useManagementSettings({id:'manager',platformRole:'firm_admin',lawFirmId:firm},null,['가람']);return React.createElement('output',null,`${tick}:${latest.loading}:${latest.error??''}`);}
function respond(request,firm='f1',target=7){request.resolve({ok:true,json:async()=>({rows:[{law_firm_id:firm,value:{...DEFAULT_MANAGEMENT_SETTINGS,monthlyContractTarget:target}}]})});}
function installFetch(){calls=[];pending=[];global.fetch=(url,options)=>{const request={url,options};calls.push(request);request.promise=new Promise((resolve,reject)=>{request.resolve=resolve;request.reject=reject;});pending.push(request);return request.promise;};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('equivalent new staff arrays do not start a reload loop; settings reference stays stable',async()=>{installFetch();let tree;await act(async()=>{tree=renderer.create(React.createElement(View,{}));await tick();});assert.equal(calls.length,1);await act(async()=>{respond(calls[0]);await tick();});assert.equal(latest.loading,false);const first=latest.activeSettings;for(let i=1;i<=4;i++)await act(async()=>{tree.update(React.createElement(View,{tick:i}));await tick();});assert.equal(calls.length,1);assert.strictEqual(latest.activeSettings,first);await act(async()=>tree.unmount());});
test('a late response for another firm cannot replace current settings or loading state',async()=>{installFetch();let tree;await act(async()=>{tree=renderer.create(React.createElement(View,{firm:'f1'}));await tick();});await act(async()=>{tree.update(React.createElement(View,{firm:'f2'}));await tick();});assert.equal(calls.length,2);assert.equal(calls[0].options.signal.aborted,true);await act(async()=>{respond(calls[1],'f2',22);await tick();});assert.equal(latest.activeSettings.monthlyContractTarget,22);await act(async()=>{respond(calls[0],'f1',11);await tick();});assert.equal(latest.activeSettings.monthlyContractTarget,22);assert.equal(latest.loading,false);await act(async()=>tree.unmount());});
test('failed settings read ends loading with visible error and explicit reload recovers',async()=>{installFetch();let tree;await act(async()=>{tree=renderer.create(React.createElement(View,{}));await tick();});await act(async()=>{calls[0].resolve({ok:false,json:async()=>({error:'offline fixture failure'})});await tick();});assert.equal(latest.loading,false);assert.equal(latest.error,'offline fixture failure');let refresh;await act(async()=>{refresh=latest.reload();await tick();});await act(async()=>{respond(calls[1]);await refresh;});assert.equal(latest.loading,false);assert.equal(latest.error,null);assert.equal(latest.activeSettings.monthlyContractTarget,7);await act(async()=>tree.unmount());});


// Exercise the actual close/reopen controls against failed and successful saves.
let pageState, pageSave, alerts;
const stableStaff=[];
const priorLoader=Module._load;
Module._load=function(name,parent,...rest){
 if(parent?.filename.endsWith(path.join('app','settlement-settings','page.tsx'))){
  if(name==='@/lib/store')return{useStore:()=>({profile:{id:'manager',platformRole:'firm_admin',lawFirmId:'f1'},superAdminFirmScope:null,workStaffNames:stableStaff})};
  if(name==='@/lib/management-analytics')return{...require('../lib/management-core.ts'),useManagementSettings:()=>({manager:true,globalSuperView:false,effectiveFirmId:'f1',activeSettings:pageState,loading:false,error:null,reload:async()=>{},save:next=>pageSave(next)})};
  if(name==='@/lib/use-firm-supply')return{useFirmSupply:()=>({data:null,loading:false,error:null})};
  if(name==='@/components/analytics/FirmSupplyCard')return{FirmSupplyCard:()=>null};
  if(name==='@/components/ui/DateInput')return{DateInput:({onValueChange,...props})=>React.createElement('input',{...props,type:'date',onChange:event=>onValueChange(event.target.value)})};
  if(name==='@/components/ui/Primitives')return{Card:({children})=>React.createElement('div',null,children),PageHeader:({action})=>React.createElement('header',null,action)};
 }
 return priorLoader.call(this,name,parent,...rest);
};
const SettingsPage=require('../app/settlement-settings/page.tsx').default;
const textOf=node=>node.children.map(child=>typeof child==='string'?child:textOf(child)).join('');
const closeButton=tree=>tree.root.findAllByType('button').find(button=>/월마감|마감됨/.test(textOf(button)));
function setupPage(closed=false){pageState=structuredClone(DEFAULT_MANAGEMENT_SETTINGS);if(closed){const date=new Date(),month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;pageState.monthClosings[month]={closedAt:'old',snapshot:require('../lib/management-core.ts').makeFinancialSnapshot(pageState)};}alerts=[];global.alert=value=>alerts.push(value);}
test('failed month close leaves editing unlocked and reports the server error',async()=>{setupPage();pageSave=async()=>{throw new Error('공급 단가 확인 필요');};let tree;await act(async()=>{tree=renderer.create(React.createElement(SettingsPage));});await act(async()=>{closeButton(tree).props.onClick();await tick();});assert.match(textOf(closeButton(tree)),/월마감/);assert.equal(textOf(closeButton(tree)).includes('마감됨'),false);assert.deepEqual(alerts,['공급 단가 확인 필요']);const save=tree.root.findAllByType('button').find(button=>textOf(button)==='설정 저장');assert.equal(save.props.disabled,false);await act(async()=>tree.unmount());});
test('successful month close displays the returned server result',async()=>{setupPage();pageSave=async next=>next;let tree;await act(async()=>{tree=renderer.create(React.createElement(SettingsPage));});await act(async()=>{closeButton(tree).props.onClick();await tick();});assert.match(textOf(closeButton(tree)),/마감됨/);assert.equal(alerts.length,0);await act(async()=>tree.unmount());});
test('failed reopen preserves the existing closed month',async()=>{setupPage(true);pageSave=async()=>{throw new Error('동시 변경');};let tree;await act(async()=>{tree=renderer.create(React.createElement(SettingsPage));});await act(async()=>{closeButton(tree).props.onClick();await tick();});assert.match(textOf(closeButton(tree)),/마감됨/);assert.deepEqual(alerts,['동시 변경']);await act(async()=>tree.unmount());});

test('settings save sends the read revision and advances it only after a confirmed save',async()=>{installFetch();let tree;await act(async()=>{tree=renderer.create(React.createElement(View));await tick();});await act(async()=>{calls[0].resolve({ok:true,json:async()=>({rows:[{law_firm_id:'f1',updated_at:'v1',value:DEFAULT_MANAGEMENT_SETTINGS}]})});await tick();});let save;await act(async()=>{save=latest.save(latest.activeSettings);await tick();});assert.equal(JSON.parse(calls[1].options.body).expectedUpdatedAt,'v1');await act(async()=>{calls[1].resolve({ok:true,json:async()=>({value:DEFAULT_MANAGEMENT_SETTINGS,updatedAt:'v2'})});await save;});await act(async()=>{save=latest.save(latest.activeSettings);await tick();});assert.equal(JSON.parse(calls[2].options.body).expectedUpdatedAt,'v2');await act(async()=>{calls[2].resolve({ok:true,json:async()=>({value:DEFAULT_MANAGEMENT_SETTINGS,updatedAt:'v3'})});await save;tree.unmount();});});

const compensation=patch=>({staff:'가람',employmentType:'프리랜서',baseSalary:1200000,incentiveMode:'건당고정',incentiveValue:40000,clawbackOnCancel:true,...patch});
const control=(tree,label)=>tree.root.find(node=>node.type==='input'&&node.props['aria-label']===label || node.type==='select'&&node.props['aria-label']===label);
const saveButton=tree=>tree.root.findAllByType('button').find(button=>/^(설정 저장|저장됨)$/.test(textOf(button)));
async function change(node,value){await act(async()=>node.props.onChange({target:{value}}));}
async function mountCompensation(patch={}){
 setupPage();pageState.staffCompensations=[compensation(patch)];const writes=[];pageSave=async next=>{writes.push(structuredClone(next));return next;};
 let tree;await act(async()=>{tree=renderer.create(React.createElement(SettingsPage));});return{tree,writes};
}
test('existing fixed incentive remains unchanged and three modes describe their actual bases',async()=>{
 const{tree,writes}=await mountCompensation();const before=structuredClone(pageState);
 assert.equal(control(tree,'가람 인센티브 지급 방식').props.value,'건당고정');assert.equal(control(tree,'가람 건당 인센티브 금액').props.value,40000);
 assert.deepEqual(control(tree,'가람 인센티브 지급 방식').findAllByType('option').map(textOf),['건당 정액 (원)','수임료 기준 (%)','실입금 기준 (%)']);
 assert.match(textOf(tree.root),/선택 기간 계약일의 담당 사건 수 × 건당 금액/);assert.match(textOf(tree.root),/마감된 월은 당시 조건과 확정 합계를 유지/);
 assert.equal(writes.length,0);await act(async()=>{saveButton(tree).props.onClick();await tick();});assert.deepEqual(writes[0],before);assert.deepEqual(pageState,before);await act(async()=>tree.unmount());
});
test('fixed-to-percent requires explicit rate and saves only the intended compensation fields',async()=>{
 const{tree,writes}=await mountCompensation();const before=structuredClone(pageState);
 await change(control(tree,'가람 인센티브 지급 방식'),'수임액%');assert.equal(control(tree,'가람 인센티브 비율').props.value,'');assert.equal(control(tree,'가람 인센티브 비율').props['aria-invalid'],true);
 await act(async()=>{saveButton(tree).props.onClick();await tick();});assert.equal(writes.length,0);assert.match(textOf(tree.root.findByProps({role:'alert'})),/직접 입력/);
 await change(control(tree,'가람 인센티브 비율'),'12.5');assert.match(textOf(tree.root),/수임료 합계 × 비율 · 입금 여부와 무관/);
 await act(async()=>{saveButton(tree).props.onClick();await tick();});const expected=structuredClone(before);expected.staffCompensations[0].incentiveMode='수임액%';expected.staffCompensations[0].incentiveValue=12.5;assert.deepEqual(writes,[expected]);assert.deepEqual(pageState,before);await act(async()=>tree.unmount());
});
test('switching percentage basis keeps the entered rate and clarifies actual receipts',async()=>{
 const{tree,writes}=await mountCompensation({incentiveMode:'수임액%',incentiveValue:12.5});await change(control(tree,'가람 인센티브 지급 방식'),'회수매출%');assert.equal(control(tree,'가람 인센티브 비율').props.value,12.5);assert.match(textOf(tree.root),/실제 납부액 합계 × 비율 · 이전 계약의 입금도 포함/);
 await act(async()=>{saveButton(tree).props.onClick();await tick();});assert.equal(writes[0].staffCompensations[0].incentiveMode,'회수매출%');assert.equal(writes[0].staffCompensations[0].incentiveValue,12.5);await act(async()=>tree.unmount());
});
test('changed percentage above 100 is rejected, then valid zero saves without clamping old money',async()=>{
 const{tree,writes}=await mountCompensation();await change(control(tree,'가람 인센티브 지급 방식'),'수임액%');await change(control(tree,'가람 인센티브 비율'),'101');await act(async()=>{saveButton(tree).props.onClick();await tick();});assert.equal(writes.length,0);assert.match(textOf(tree.root.findByProps({role:'alert'})),/0~100%/);assert.equal(control(tree,'가람 인센티브 비율').props.value,101);
 await change(control(tree,'가람 인센티브 비율'),'0');await act(async()=>{saveButton(tree).props.onClick();await tick();});assert.equal(writes[0].staffCompensations[0].incentiveValue,0);await act(async()=>tree.unmount());
});
test('changing percent to fixed requires a money input; reversing an unedited unit change restores stored money',async()=>{
 const first=await mountCompensation({incentiveMode:'회수매출%',incentiveValue:10});await change(control(first.tree,'가람 인센티브 지급 방식'),'건당고정');assert.equal(control(first.tree,'가람 건당 인센티브 금액').props.value,'');await act(async()=>{saveButton(first.tree).props.onClick();await tick();});assert.equal(first.writes.length,0);await change(control(first.tree,'가람 건당 인센티브 금액'),'50000');await act(async()=>{saveButton(first.tree).props.onClick();await tick();});assert.equal(first.writes[0].staffCompensations[0].incentiveValue,50000);await act(async()=>first.tree.unmount());
 const second=await mountCompensation();await change(control(second.tree,'가람 인센티브 지급 방식'),'수임액%');await change(control(second.tree,'가람 인센티브 지급 방식'),'건당고정');assert.equal(control(second.tree,'가람 건당 인센티브 금액').props.value,40000);await act(async()=>{saveButton(second.tree).props.onClick();await tick();});assert.equal(second.writes[0].staffCompensations[0].incentiveValue,40000);await act(async()=>second.tree.unmount());
});
test('unchanged historical percentage remains saved as-is instead of silently rewriting old settings',async()=>{
 const{tree,writes}=await mountCompensation({incentiveMode:'수임액%',incentiveValue:125});await act(async()=>{saveButton(tree).props.onClick();await tick();});assert.equal(writes[0].staffCompensations[0].incentiveValue,125);await act(async()=>tree.unmount());
});

test('active DB cap is a read-only common standard and opening settings never saves it',async()=>{
 setupPage();const writes=[];pageSave=async next=>{writes.push(next);return next;};let tree;
 await act(async()=>{tree=renderer.create(React.createElement(SettingsPage));});
 const cap=tree.root.findByProps({'aria-describedby':'active-db-cap-policy'});
 assert.equal(cap.props.value,40);assert.equal(cap.props.readOnly,true);assert.equal(cap.props.onChange,undefined);
 assert.match(textOf(tree.root),/전 로펌 공통 · 1인 40건/);assert.equal(writes.length,0);
 await act(async()=>tree.unmount());
});
