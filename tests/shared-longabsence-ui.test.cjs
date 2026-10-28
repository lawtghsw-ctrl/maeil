// Actual React controls with synthetic rows. No provider, live database or SMS use.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const runtime = process.env.DB_TEST_RUNTIME || path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), renderer = require(path.join(runtime, 'react-test-renderer'));
const ts = require(path.join(root, 'node_modules/typescript')), { act } = renderer, h = React.createElement;
const clone = value => JSON.parse(JSON.stringify(value));
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('');
const buttons = (tree, label) => tree.root.findAll(node => node.type === 'button' && text(node).trim() === label);
const shared = { id:'shared', _lawFirmId:'firm-1', name:'합성 공용 고객', phone:'01000000000', receivedAt:'2026-10-01', assignedStaff:'Other', status:'부재중', detailStage:'장기부재', consultation:{memoLog:[]} };
const profile = { id:'actor', role:'staff', platformRole:'staff', lawFirmId:'firm-1', isActive:true, staffName:'One', displayName:'One', permissions:{} };
function fixture() {
  const updates = [], modules = new Map(), captures = {}, permissions = new Set(['db.view']);
  const state = { profile:clone(profile), currentStaff:'One', superAdminFirmScope:null, leads:[clone(shared)], cases:[], clients:[],
    workStaffNames:['One','Other'], can:key=>permissions.has(key), updateLead:async(id,patch,expected)=>{updates.push({id,patch:clone(patch),expected:clone(expected)});return state.saveResult;}, saveResult:true };
  const host = tag => ({children,variant,size,...props})=>h(tag,props,children);
  const primitives = { Button:host('button'), Card:host('div'), Input:host('input'), Select:host('select'),
    Modal:({open,children,title})=>open?h('section',{'data-modal':title},children):null,
    PageHeader:()=>null, SearchBox:()=>null, Pagination:()=>null, pageRows:(rows,page,size)=>rows.slice((page-1)*size,page*size), useClickOutside:()=>React.useRef(null) };
  const mocks = {
    '@/lib/store':{useStore:()=>state}, '@/components/ui/Primitives':primitives,
    '@/components/ui/consultation/ConsultationModal':{ConsultationModal:props=>{captures.modal=props;return h('consultation-probe',props);}},
    '@/components/ui/ReservationDateTimeEditor':{ReservationDateTimeEditor:props=>h('reservation-probe',props)},
    '@/components/ui/BottomHorizontalScrollbar':{BottomHorizontalScrollbar:()=>null},
    '@/components/ui/ConfirmDelete':{ConfirmDelete:()=>null},
    '@/components/sms/LeadSmsDialog':{__esModule:true,default:()=>null},
  };
  const context = vm.createContext({console,Date,Map,Set,Math,Intl,URL,URLSearchParams,crypto:{randomUUID:()=>`synthetic-${updates.length}`},
    window:{sessionStorage:{getItem:()=>null,removeItem(){}}},setTimeout,clearTimeout,fetch:()=>{throw Error('Network forbidden');}});
  function load(file) {
    const filename=path.resolve(root,file); if(modules.has(filename))return modules.get(filename).exports;
    const module={exports:{}};modules.set(filename,module);
    let source=fs.readFileSync(filename,'utf8');
    if(file==='app/db/page.tsx')source+='\nexport { MobileLeadRow, DesktopLeadRow, LeadConsultationModal };';
    const code=ts.transpileModule(source,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    vm.runInContext(`(function(require,module,exports){${code}\n})`,context,{filename})(name=>{
      if(name in mocks)return mocks[name];
      if(name==='react'||name.startsWith('react/'))return require(path.join(runtime,name));
      if(name==='lucide-react')return new Proxy({},{get:(_,icon)=>()=>h('i',{'data-icon':String(icon)})});
      if(name==='next/link')return {__esModule:true,default:host('a')};
      if(name.startsWith('@/')||name.startsWith('.')){
        const target=name.startsWith('@/')?path.resolve(root,name.slice(2)):path.resolve(path.dirname(filename),name);
        const resolved=['.ts','.tsx'].map(ext=>target+ext).find(fs.existsSync);if(!resolved)throw Error('Unmocked '+name);
        return load(path.relative(root,resolved));
      }
      return require(name);
    },module,module.exports);return module.exports;
  }
  return {state,updates,permissions,captures,load};
}

test('desktop and mobile shared rows enable ordinary editing without global consultation rights, not privileged actions', async()=>{
  const f=fixture();for(const key of ['sms.send','db.delete','db.convert'])f.permissions.add(key);
  const page=f.load('app/db/page.tsx');
  for(const component of [page.MobileLeadRow,page.DesktopLeadRow]){
    let tree; const lead=f.state.leads[0];
    await act(async()=>{tree=renderer.create(h(component,{lead,profile:f.state.profile,currentStaff:'One',globalSuperView:false,todayIso:'2026-10-28',can:f.state.can,workStaffNames:f.state.workStaffNames,updateLead:f.state.updateLead,onOpenConsultation(){},onOpenMemo(){},onConvert(){throw Error('Forbidden conversion');},onDelete(){throw Error('Forbidden delete');},onSms(){throw Error('Forbidden SMS');},onWork(){}}));});
    try{
      const selects=tree.root.findAllByType('select');assert.equal(selects.length,3);assert.ok(selects.every(node=>node.props.disabled===false));
      assert.equal(tree.root.findByType('reservation-probe').props.disabled,false);
      assert.equal(buttons(tree,'컨택 · 사유').length,1);
      assert.equal(buttons(tree,'삭제').length,0);assert.equal(buttons(tree,'고객 전환').length,0);assert.equal(buttons(tree,'문자발송').length,0);
      await act(async()=>selects[1].props.onChange({target:{value:'One'}}));
      assert.deepEqual(f.updates.at(-1),{id:'shared',patch:{assignedStaff:'One'},expected:lead});
    }finally{await act(async()=>tree.unmount());}
  }
});

test('consultation and memo save keeps opened baseline across realtime edits and rechecks stage permissions', async()=>{
  const f=fixture(), Component=f.load('app/db/page.tsx').LeadConsultationModal;
  const original=clone(f.state.leads[0]);let tree;
  const render=()=>h(Component,{open:true,lead:f.state.leads[0],onClose(){}});
  await act(async()=>{tree=renderer.create(render());});
  try{
    assert.equal(f.captures.modal.readOnly,false);assert.equal(f.captures.modal.allowNameEdit,true);assert.equal(f.captures.modal.allowPhoneEdit,true);
    f.state.syncError='연결된 고객의 기본정보 수정 권한이 없습니다.';await act(async()=>tree.update(render()));assert.equal(f.captures.modal.saveErrorMessage,f.state.syncError);
    f.state.leads=[{...f.state.leads[0],consultation:{memoLog:[{id:'new',text:'다른 담당자 메모'}]}}];
    await act(async()=>tree.update(render()));
    assert.deepEqual(clone(f.captures.modal.initialConsultation),original.consultation);
    const draft={memoLog:[{id:'draft',text:'보존할 입력'}]};f.state.saveResult=false;
    let result;await act(async()=>{result=await f.captures.modal.onSave(draft);});
    assert.equal(result,false);assert.deepEqual(f.updates.at(-1).expected,original);assert.deepEqual(f.updates.at(-1).patch.consultation,draft);
    f.state.leads=[{...f.state.leads[0],detailStage:'상담'}];await act(async()=>tree.update(render()));
    assert.equal(f.captures.modal.readOnly,true);
    const count=f.updates.length;await act(async()=>{result=await f.captures.modal.onSave(draft);});assert.equal(result,false);assert.equal(f.updates.length,count);
  }finally{await act(async()=>tree.unmount());}
});

test('contact dialog preserves failure draft, prevents repeated writes, and rebases on server-normalized data', async()=>{
  const f=fixture(),Component=f.load('components/db/LeadWorkDialog.tsx').default,original=clone(f.state.leads[0]);let tree;
  const render=()=>h(Component,{leadId:'shared',onClose(){}});
  const rawUpdate=f.state.updateLead;
  let persisted,release,held;
  f.state.updateLead=async(...args)=>{
    if(held)await held;
    const ok=await rawUpdate(...args);
    if(ok){
      persisted={...f.state.leads[0],...clone(args[1]),contactLog:(args[1].contactLog??f.state.leads[0].contactLog??[]).map(row=>({...row,staff:'서버 정규화 담당자',at:'2026-10-28T04:00:00.000Z'}))};
      f.state.leads=[persisted];
    }else f.state.syncError='다른 담당자가 변경했습니다. 다시 열어주세요.';
    tree.update(render());return ok;
  };
  await act(async()=>{tree=renderer.create(render());});
  try{
    assert.ok(tree.root.findAllByType('fieldset').every(node=>node.props.disabled===false));
    await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'합성 연락 메모'}}));
    f.state.saveResult=false;await act(async()=>buttons(tree,'현재 시각으로 컨택 기록')[0].props.onClick());
    assert.equal(tree.root.findByType('textarea').props.value,'합성 연락 메모');assert.deepEqual(f.updates.at(-1).expected,original);
    assert.match(text(tree.root),/다른 담당자가 변경했습니다/);
    f.state.saveResult=true;
    held=new Promise(resolve=>{release=resolve;});
    const oldHandler=buttons(tree,'현재 시각으로 컨택 기록')[0].props.onClick,count=f.updates.length;
    await act(async()=>{oldHandler();oldHandler();});
    assert.equal(f.updates.length,count);
    await act(async()=>{release();await Promise.resolve();await Promise.resolve();});held=null;
    assert.equal(f.updates.length,count+1,'rapid repeated invocation writes once');
    assert.equal(tree.root.findByType('textarea').props.value,'');assert.deepEqual(f.updates.at(-1).expected,original);
    const confirmed=clone(persisted);
    await act(async()=>buttons(tree,'사유 저장')[0].props.onClick());assert.deepEqual(f.updates.at(-1).expected,confirmed);
    assert.equal(f.updates.at(-1).expected.contactLog[0].staff,'서버 정규화 담당자');
    assert.equal(f.updates.at(-1).expected.contactLog[0].at,'2026-10-28T04:00:00.000Z');
  }finally{release?.();await act(async()=>tree.unmount());}
});

test('case consultation shares DB editing only while existing case access remains authorized',async()=>{
  const f=fixture();f.permissions.add('cases.view');
  f.state.leads[0].convertedClientId='client';f.state.leads[0].convertedCaseId='case';
  f.state.clients=[{id:'client',_lawFirmId:'firm-1',fromLeadId:'shared'}];
  f.state.cases=[{id:'case',_lawFirmId:'firm-1',clientId:'client',fromLeadId:'shared',assignedStaff:'One',contractAmount:0,paidAmount:0}];
  const Component=f.load('components/cases/CaseConsultationModal.tsx').CaseConsultationModal;let tree;
  const render=()=>h(Component,{caseId:'case',onClose(){}});
  await act(async()=>{tree=renderer.create(render());});
  try{
    assert.equal(tree.root.findAllByType('consultation-probe').length,1);assert.equal(f.captures.modal.readOnly,false);
    f.permissions.delete('cases.view');await act(async()=>tree.update(render()));assert.equal(tree.root.findAllByType('consultation-probe').length,0);
  }finally{await act(async()=>tree.unmount());}
});
