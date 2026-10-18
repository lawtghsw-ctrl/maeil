// Actual React renderer, mocked API only. No credentials or network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),runtime=path.resolve(root,'../store-test-runtime/node_modules');
const React=require(path.join(runtime,'react')),renderer=require(path.join(runtime,'react-test-renderer')),jsx=require(path.join(runtime,'react/jsx-runtime'));
const text=node=>typeof node==='string'?node:(node.children||[]).map(text).join('');
test('saving a proposal preserves unsaved profile and contact drafts across the API refresh',async()=>{
 const modules=new Map(),writes=[]; let lead;
 function load(file){if(modules.has(file))return modules.get(file);const m={exports:{}};modules.set(file,m.exports);const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const req=name=>{if(name==='react')return React;if(name==='@/components/ui/DateInput'){const DateInput=({onValueChange,onIncompleteChange,...props})=>React.createElement('input',{...props,type:'date',onChange:e=>onValueChange(e.target.value)});return {DateInput,DateTimeInput:DateInput};}if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});if(name==='@/lib/platform/sales')return load('lib/platform/sales.ts');if(name==='@/lib/format')return {fmtWon:v=>`${v}원`};if(name==='@/components/ui/Primitives')return {Modal:({open,title,children})=>open?React.createElement('section',{'aria-label':title},children):null};if(name==='@/lib/platform/client')return {authJson:async(url,init)=>{if(init?.method==='POST'){const body=JSON.parse(init.body);writes.push(body);lead={...lead,proposal:{...body.proposal,version:1},revision:lead.revision+1};return {ok:true};}return {leads:[lead],events:[],esignReady:false,esignNotice:'준비 중'};}};throw Error('Unmocked '+name);};
 vm.runInNewContext(`(function(require,module,exports){${source}\n})`,{console,Date,URL,crypto:require('node:crypto').webcrypto,confirm:()=>true})(req,m,m.exports);return m.exports;}
 const pure=load('lib/platform/sales.ts');lead={id:'one',stage:'신규접수',revision:1,data:{...pure.emptySalesLead(),name:'원본 로펌'},proposal:null,created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',last_contact_at:null,sources:['listup'],law_firm_id:null};
 const Page=load('components/platform/SalesPipeline.tsx').default;let view;
 const flush=async()=>{await renderer.act(async()=>{await new Promise(r=>setTimeout(r,0));});};
 const click=async(label)=>{const button=view.root.findAll(n=>n.type==='button').find(n=>text(n)===label||text(n).startsWith(label));assert.ok(button,label);await renderer.act(async()=>button.props.onClick());await flush();};
 try{await renderer.act(async()=>{view=renderer.create(React.createElement(Page));});await flush();await click('원본 로펌');
  const note=()=>view.root.findAll(n=>n.type==='textarea')[0];await renderer.act(async()=>note().props.onChange({target:{value:'다른 탭의 미저장 연락'}}));
  await click('로펌 정보 · 단계');const name=view.root.findAll(n=>n.type==='input').find(n=>n.props.value==='원본 로펌');await renderer.act(async()=>name.props.onChange({target:{value:'미저장 로펌명'}}));
  await click('제안조건');await click('제안조건 저장');assert.equal(writes.length,1);assert.equal(writes[0].action,'proposal');
  await click('로펌 정보 · 단계');assert.ok(view.root.findAll(n=>n.type==='input').some(n=>n.props.value==='미저장 로펌명'));
  await click('연락 · 미팅');assert.equal(note().props.value,'다른 탭의 미저장 연락');
  const nextAt=view.root.findByProps({'aria-label':'다음 업무 기한'});
  await renderer.act(async()=>nextAt.props.onIncompleteChange(true));
  const record=()=>view.root.findAll(n=>n.type==='button').find(n=>text(n)==='기록 저장');
  assert.equal(record().props.disabled,true,'An incomplete optional deadline cannot silently become absent');
  await renderer.act(async()=>nextAt.props.onIncompleteChange(false));assert.equal(record().props.disabled,false);
 }finally{if(view)renderer.act(()=>view.unmount());}
});
