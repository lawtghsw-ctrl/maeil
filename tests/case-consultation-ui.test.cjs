// Actual contract list, consultation bridge and progress card with React.
// Supabase, SMS and provider operations are forbidden; all records are synthetic.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer')), { act } = Renderer;
const clone = value => JSON.parse(JSON.stringify(value));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';

function harness(options = {}) {
  const modules = new Map(), updates = [], caseUpdates = [], storage = new Map(), captures = {}, timers = new Map();
  let tree, nextTimer = 0, closed = 0;
  const permissions = Object.fromEntries(['db.view','db.view_all','db.view_consultation','db.edit_consultation','db.edit_basic','db.manage_reservation','db.view_finance','cases.view','cases.view_all','cases.view_finance'].map(key => [key,true]));
  Object.assign(permissions, options.permissions);
  const state = {
    profile: { id: 'actor-1', role: 'staff', platformRole: 'staff', lawFirmId: 'firm-1', displayName: '작성자', permissions },
    currentStaff: '작성자', isAdmin: false, superAdminFirmScope: null,
    leads: [{ id:'lead-1',_lawFirmId:'firm-1',name:'합성 고객',phone:'',receivedAt:'2026-10-01',assignedStaff:'다른 담당',detailStage:'착수금착수',status:'계약진행중',applicationType:'개인회생',convertedCaseId:'case-1',consultation:{personal:{basicIncomeNote:'원본'},memoLog:[]} }],
    clients: [{ id:'client-1',_lawFirmId:'firm-1',name:'합성 고객',phone:'',assignedStaff:'다른 담당',fromLeadId:'lead-1' }],
    cases: [{ id:'case-1',_lawFirmId:'firm-1',clientId:'client-1',fromLeadId:'lead-1',caseNumber:'합성-2026',caseType:'개인회생',status:'진행중',stage:'서류준비',assignedStaff:'다른 담당',contractDate:'2026-10-02',contractAmount:3300000,paidAmount:1000000,feeStandardSnapshot:{baseFee:4000000} }],
    installments: [], workStaffNames: ['작성자','다른 담당'],
    can: key => permissions[key] === true,
    updateLead: async (id, patch) => { updates.push({id,patch:clone(patch)}); return options.failSave ? false : true; },
    updateCase: (id, patch) => { caseUpdates.push({id,patch:clone(patch)}); },
    deleteCase() { throw Error('Unexpected delete'); }, addCase() { throw Error('Unexpected contract create'); },
  };
  if (options.writer) state.profile.permissions['staff.writer'] = true;
  if (options.mutate) options.mutate(state, permissions);
  const original = clone({ leads:state.leads, clients:state.clients, cases:state.cases, installments:state.installments });
  const host = tag => ({children,...props}) => React.createElement(tag,props,children);
  const primitives = {
    Button:host('button'),Card:host('section'),Input:host('input'),Select:host('select'),
    Modal:({open,children,title}) => open ? React.createElement('section',{'aria-label':title},children) : null,
    PageHeader:({title,description,action})=>React.createElement('header',{},title,description,action),
    SearchBox:()=>null,Pagination:()=>null,pageRows:(rows,page,size)=>rows.slice((page-1)*size,page*size),
  };
  const window = { localStorage:{ getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key) },
    setTimeout:callback=>{timers.set(++nextTimer,callback);return nextTimer;},clearTimeout:id=>timers.delete(id),addEventListener(){},removeEventListener(){},confirm:()=>true };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = {exports:{}}; modules.set(relative,module);
    const code = ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const requireFile = name => {
      if(name==='react'||name.startsWith('react/')) return require(path.join(runtime,name));
      if(name==='next/link')return {__esModule:true,default:host('a')};
      if(name==='next/navigation')return {useRouter:()=>({push(){throw Error('Unexpected navigation');}})};
      if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
      if(name==='@/lib/store')return {useStore:()=>state,useStoreSession:()=>state};
      if(name==='@/components/ui/Primitives')return primitives;
      if(name==='@/components/ui/DateInput')return {DateInput:host('input')};
      if(name==='@/components/ui/Badge')return {StatusBadge:({status})=>React.createElement('span',{},status)};
      if(name==='@/components/cases/CaseDetailPopup')return {CaseDetailPopup:()=>null};
      if(name==='@/components/ui/consultation/ConsultationModal')return {ConsultationModal:props=>{
        captures.modal=props;
        return options.realModal ? React.createElement(load('components/ui/consultation/ConsultationModal.tsx').ConsultationModal,props) : React.createElement('consultation-probe',props);
      }};
      if(/^\.\/(BasicInfoSection|IncomeSection|AssetSection|DecisionSection|PlanSection|DebtListSection)$/.test(name)) {const key=name.slice(2);return {[key]:props=>{captures[key]=props;return null;}};}
      if(name==='./shared')return {SectionCard:host('section'),compactTextareaClass:''};
      if(name==='@/lib/consultation-pdf')throw Error('Unexpected PDF operation');
      if(name.startsWith('@/')||name.startsWith('.')){
        const file=name.startsWith('@/')?name.slice(2):path.posix.join(path.posix.dirname(relative),name);
        return load(file+(fs.existsSync(path.join(root,file+'.tsx'))?'.tsx':'.ts'));
      }
      throw Error('Unexpected dependency/network: '+name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`,{React,console,Date,Map,Set,Math,window,confirm:()=>true,structuredClone,setTimeout,clearTimeout,fetch(){throw Error('Network forbidden');}}, {filename:relative})(requireFile,module,module.exports);
    return module.exports;
  }
  function render(){
    const Component=options.component==='card'?load('components/cases/CaseProgressCard.tsx').default:options.component==='bridge'?load('components/cases/CaseConsultationModal.tsx').CaseConsultationModal:load('app/cases/page.tsx').default;
    return React.createElement(Component,options.component==='card'?{record:state.cases[0]}:{caseId:'case-1',onClose:()=>closed++});
  }
  return {state,permissions,original,updates,caseUpdates,captures,storage,load,get tree(){return tree;},get closed(){return closed;},
    get modal(){return captures.modal;},
    mount:async()=>act(async()=>{tree=Renderer.create(render());}),
    rerender:async()=>act(async()=>tree.update(render())),
    buttons:()=>tree.root.findAllByType('button').filter(node=>node.props['aria-label']==='합성 고객 상담일지'),
    open:async index=>act(async()=>tree.root.findAllByType('button').filter(node=>node.props['aria-label']==='합성 고객 상담일지')[index??0].props.onClick()),
    save:async(consultation,name,phone)=>{let result;await act(async()=>{result=await captures.modal.onSave(consultation,name,phone);});return result;},
    flushDraft:()=>{for(const [id,callback]of timers){timers.delete(id);callback();}},
    close:()=>act(()=>tree.unmount()),
  };
}

test('stored case/client/reverse links are exact, unambiguous and tenant safe',()=>{
  const h=harness(),resolve=h.load('lib/case-consultation.ts').caseConsultationLead;
  const record=h.state.cases[0],client=h.state.clients[0],lead=h.state.leads[0];
  assert.equal(resolve(record,client,[lead],'firm-1'),lead);
  assert.equal(resolve({...record,fromLeadId:undefined},client,[lead],'firm-1'),lead);
  assert.equal(resolve({...record,fromLeadId:undefined},{...client,fromLeadId:undefined},[lead],'firm-1'),lead);
  for(const value of [
    resolve(record,{...client,fromLeadId:'other'},[lead],'firm-1'),
    resolve({...record,fromLeadId:'missing'},{...client,fromLeadId:undefined},[lead],'firm-1'),
    resolve(record,client,[lead,{...lead}],'firm-1'),
    resolve({...record,fromLeadId:undefined},{...client,fromLeadId:undefined},[lead,{...lead,id:'other'}],'firm-1'),
    resolve(record,client,[{...lead,_lawFirmId:'foreign'}],'firm-1'),
    resolve(record,{...client,_lawFirmId:'foreign'},[lead],'firm-1'),
    resolve({...record,_lawFirmId:'foreign'},client,[lead],'firm-1'),
    resolve(record,client,[lead],undefined),
    resolve({...record,fromLeadId:undefined},{...client,fromLeadId:undefined},[{...lead,convertedCaseId:undefined}],'firm-1'),
  ])assert.equal(value,undefined);
});

test('desktop detail and mobile card each open the shared original DB consultation without writes',async()=>{
  const h=harness();await h.mount();
  assert.equal(h.buttons().length,2);assert.ok(h.buttons().every(button=>!button.props.disabled));
  assert.ok(h.tree.root.findAllByType('button').some(button=>text(button)==='상세'));
  await h.open(1);assert.equal(h.modal.displayName,'합성 고객');assert.equal(h.modal.caseNumberLabel,'합성-2026');assert.equal(h.modal.initialConsultation.personal.basicIncomeNote,'원본');
  assert.equal(h.modal.showFinanceSummary,true);assert.equal(h.updates.length,0);assert.equal(h.caseUpdates.length,0);
  await act(async()=>h.modal.onClose());await h.open(0);assert.equal(h.tree.root.findAllByType('consultation-probe').length,1);h.close();
});

test('consultation access preserves normal own/all restrictions and closes after revocation',async()=>{
  const h=harness({permissions:{'db.view_all':false}});await h.mount();assert.ok(h.buttons().every(button=>button.props.disabled));
  h.state.leads=[{...h.state.leads[0],assignedStaff:'작성자'}];await h.rerender();assert.ok(h.buttons().every(button=>!button.props.disabled));await h.open();
  h.permissions['db.view_consultation']=false;await h.rerender();assert.equal(h.buttons().length,0);assert.equal(h.tree.root.findAllByType('consultation-probe').length,0);h.close();
});

test('writer can open another assignee post-consultation lead but not first-track consultation',async()=>{
  const h=harness({writer:true});await h.mount();
  assert.ok(h.buttons().every(button=>!button.props.disabled));await h.open();assert.equal(h.modal.readOnly,false);
  h.state.leads=[{...h.state.leads[0],detailStage:'상담',status:'상담완료'}];await h.rerender();
  assert.ok(h.buttons().every(button=>button.props.disabled));assert.equal(h.tree.root.findAllByType('consultation-probe').length,0);h.close();
});

test('super administrator can open the selected firm but not a global or foreign firm consultation',async()=>{
  const h=harness({mutate:state=>{state.profile={...state.profile,platformRole:'super_admin',role:'admin',lawFirmId:'original-firm'};state.isAdmin=true;state.superAdminFirmScope={id:'firm-1'};}});await h.mount();
  assert.ok(h.buttons().every(button=>!button.props.disabled));await h.open();assert.equal(h.tree.root.findAllByType('consultation-probe').length,1);
  h.state.superAdminFirmScope=null;await h.rerender();assert.ok(h.buttons().every(button=>button.props.disabled));assert.equal(h.tree.root.findAllByType('consultation-probe').length,0);h.close();
});

test('missing/cross-firm links stay disabled; actor or tenant switch removes the open original',async()=>{
  for(const mutate of [state=>{state.cases[0].fromLeadId='missing';},state=>{state.leads[0]._lawFirmId='foreign';},state=>{state.clients[0].fromLeadId='conflict';}]){
    const h=harness({mutate});await h.mount();assert.ok(h.buttons().every(button=>button.props.disabled));await h.open();assert.equal(h.tree.root.findAllByType('consultation-probe').length,0);h.close();
  }
  for(const patch of [{id:'another-actor'},{lawFirmId:'firm-2'}]){
    const h=harness();await h.mount();await h.open();h.state.profile={...h.state.profile,...patch};await h.rerender();assert.equal(h.tree.root.findAllByType('consultation-probe').length,0);h.close();
  }
});

test('save changes only allowed original lead fields and never contract/customer/finance fields',async()=>{
  const h=harness({component:'bridge'});await h.mount();
  await act(async()=>{h.modal.onApplicationTypeChange('개인파산');h.modal.onReservationChoiceChange(true);h.modal.onReservationAtChange('2026-10-25T14:00');});
  const consultation={personal:{basicIncomeNote:'수정본'},memoLog:[]};assert.equal(await h.save(consultation,'수정 이름'),true);
  assert.deepEqual(h.updates,[{id:'lead-1',patch:{consultation,name:'수정 이름',applicationType:'개인파산',reservationAt:'2026-10-25T14:00'}}]);
  assert.equal(h.caseUpdates.length,0);assert.deepEqual(clone({leads:h.state.leads,clients:h.state.clients,cases:h.state.cases,installments:h.state.installments}),h.original);h.close();
});

test('readonly/partial permissions cannot save hidden name, direction, reservation or finance',async()=>{
  const h=harness({component:'bridge',permissions:{'db.edit_basic':false,'db.manage_reservation':false,'db.view_finance':false}});await h.mount();
  assert.equal(h.modal.allowNameEdit,false);assert.equal(h.modal.allowPhoneEdit,false);assert.equal(h.modal.allowApplicationTypeEdit,false);assert.equal(h.modal.onReservationChoiceChange,undefined);assert.equal(h.modal.showFinanceSummary,false);
  await h.save({memoLog:[]},'ignored','010-0000-0099');assert.deepEqual(h.updates,[{id:'lead-1',patch:{consultation:{memoLog:[]}}}]);
  h.permissions['db.edit_consultation']=false;h.permissions['db.edit_basic']=true;await h.rerender();assert.equal(h.modal.readOnly,true);assert.equal(h.modal.allowPhoneEdit,false);assert.equal(await h.save({memoLog:[]},undefined,'010-0000-0099'),false);assert.equal(h.updates.length,1);h.close();
});

test('fresh server snapshot is read on open while an unsaved local direction/reservation is preserved',async()=>{
  const h=harness({component:'bridge'});await h.mount();
  await act(async()=>{h.modal.onApplicationTypeChange('개인파산');h.modal.onReservationChoiceChange(true);h.modal.onReservationAtChange('2026-10-25T14:00');});
  h.state.leads=[{...h.state.leads[0],name:'서버 이름',consultation:{memoLog:[],personal:{basicIncomeNote:'새 서버본'}}}];await h.rerender();
  assert.equal(h.modal.displayName,'서버 이름');assert.equal(h.modal.initialConsultation.personal.basicIncomeNote,'새 서버본');assert.equal(h.modal.applicationType,'개인파산');assert.equal(h.modal.reservationAt,'2026-10-25T14:00');h.close();
});

test('real shared modal keeps a failed save draft and does not close or write any contract',async()=>{
  const h=harness({component:'bridge',realModal:true,failSave:true});await h.mount();
  await act(async()=>h.captures.BasicInfoSection.patchPersonal({basicIncomeNote:'실패해도 보존'}));h.flushDraft();
  const button=h.tree.root.findAllByType('button').find(node=>text(node)==='저장');assert.ok(button);
  await act(async()=>button.props.onClick());assert.equal(h.updates.length,1);assert.equal(h.updates[0].patch.consultation.personal.basicIncomeNote,'실패해도 보존');
  assert.equal(h.closed,0);assert.equal(h.captures.BasicInfoSection.personal.basicIncomeNote,'실패해도 보존');assert.match(text(h.tree.toJSON()),/서버 저장에 실패/);assert.equal(h.caseUpdates.length,0);assert.ok(h.storage.size>0);h.close();
});

test('case basic permission allows only existing stage update; discount approval remains manager-only',async()=>{
  const h=harness({component:'card',writer:true,permissions:{'cases.edit_basic':true}});await h.mount();
  const stage=h.tree.root.findByProps({'aria-label':'사건 진행 단계'});assert.equal(stage.props.disabled,false);await act(async()=>stage.props.onChange({target:{value:'신청서작성'}}));
  assert.deepEqual(h.caseUpdates,[{id:'case-1',patch:{stage:'신청서작성'}}]);assert.doesNotMatch(text(h.tree.toJSON()),/현재 할인 승인 기록/);
  h.permissions['cases.edit_basic']=false;await h.rerender();assert.equal(h.tree.root.findByProps({'aria-label':'사건 진행 단계'}).props.disabled,true);await act(async()=>h.tree.root.findByProps({'aria-label':'사건 진행 단계'}).props.onChange({target:{value:'보정대기'}}));assert.equal(h.caseUpdates.length,1);
  h.state.isAdmin=true;h.state.profile={...h.state.profile,role:'admin',platformRole:'firm_admin',permissions:{}};await h.rerender();assert.equal(h.tree.root.findByProps({'aria-label':'사건 진행 단계'}).props.disabled,false);assert.match(text(h.tree.toJSON()),/현재 할인 승인 기록/);h.close();
});

test('real contract consultation sends edited phone as the third save argument to the original lead only',async()=>{
  const h=harness({component:'bridge',realModal:true,writer:true});await h.mount();
  try{
    assert.equal(h.modal.allowPhoneEdit,true);assert.equal(h.captures.BasicInfoSection.allowPhoneEdit,true);
    await act(async()=>h.captures.BasicInfoSection.onPhoneChange(' 010-0000-0099 '));
    await act(async()=>h.tree.root.findAllByType('button').find(node=>text(node)==='저장').props.onClick());
    assert.equal(h.updates.length,1);assert.equal(h.updates[0].id,'lead-1');assert.equal(h.updates[0].patch.phone,'010-0000-0099');
    assert.equal(h.closed,1);assert.equal(h.caseUpdates.length,0);assert.deepEqual(clone(h.state.clients),h.original.clients);assert.deepEqual(clone(h.state.cases),h.original.cases);
  }finally{h.close();}
});

test('failed phone save preserves the exact editable phone and local draft; unchanged legacy phone is not patched',async()=>{
  const h=harness({component:'bridge',realModal:true,failSave:true,mutate:state=>{state.leads[0].phone='legacy-import-value';}});await h.mount();
  try{
    const save=()=>h.tree.root.findAllByType('button').find(node=>text(node)==='저장').props.onClick();
    await act(async()=>save());assert.equal(h.updates.length,1);assert.ok(!('phone'in h.updates[0].patch));
    await act(async()=>h.captures.BasicInfoSection.onPhoneChange('010-0000-0088'));h.flushDraft();
    await act(async()=>save());assert.equal(h.updates[1].patch.phone,'010-0000-0088');assert.equal(h.closed,0);
    assert.equal(h.captures.BasicInfoSection.displayPhone,'010-0000-0088');assert.match(text(h.tree.toJSON()),/서버 저장에 실패/);
    const draft=JSON.parse(h.storage.get('lawpower:consultation-draft:v1:'+h.modal.resetKey));assert.equal(draft.customerPhone,'010-0000-0088');
    assert.equal(h.caseUpdates.length,0);assert.deepEqual(clone(h.state.clients),h.original.clients);
  }finally{h.close();}
});

test('reopening restores real localStorage direction, reservation and unsaved consultation together',async()=>{
  const h=harness({component:'bridge',realModal:true});await h.mount();
  await act(async()=>{
    h.modal.onApplicationTypeChange('개인파산');
    h.modal.onReservationChoiceChange(true);
    h.modal.onReservationAtChange('2026-10-28T15:40');
    h.captures.BasicInfoSection.patchPersonal({basicIncomeNote:'재열기 때 보존할 내용'});
    h.captures.BasicInfoSection.onPhoneChange('010-0000-0077');
  });
  h.flushDraft();const draftKey='lawpower:consultation-draft:v1:'+h.modal.resetKey;
  const saved=JSON.parse(h.storage.get(draftKey));assert.equal(saved.applicationType,'개인파산');assert.equal(saved.reservationAt,'2026-10-28T15:40');
  h.close();await h.mount();
  try{
    assert.equal(h.modal.applicationType,'개인파산');assert.equal(h.modal.reservationChoice,true);assert.equal(h.modal.reservationAt,'2026-10-28T15:40');
    assert.equal(h.captures.BasicInfoSection.personal.basicIncomeNote,'재열기 때 보존할 내용');assert.equal(h.captures.BasicInfoSection.displayPhone,'010-0000-0077');
    assert.equal(h.updates.length,0);h.flushDraft();
    const restored=JSON.parse(h.storage.get(draftKey));assert.equal(restored.applicationType,'개인파산');assert.equal(restored.reservationAt,'2026-10-28T15:40');
  }finally{h.close();}
});

test('a different lead in the same case gets independent controller state and actor/firm draft keys',async()=>{
  const h=harness({component:'bridge',realModal:true});await h.mount();
  try{
    const oldKey=h.modal.resetKey;
    await act(async()=>{h.modal.onApplicationTypeChange('개인파산');h.modal.onReservationChoiceChange(true);h.modal.onReservationAtChange('2026-10-28T15:40');h.captures.BasicInfoSection.patchPersonal({basicIncomeNote:'첫 대상 초안'});});h.flushDraft();
    h.state.leads=[{...h.state.leads[0],id:'lead-2',name:'두번째 고객',applicationType:'워크아웃',reservationAt:'2026-11-01T09:00',consultation:{personal:{basicIncomeNote:'두번째 서버본'}}}];
    h.state.cases=[{...h.state.cases[0],fromLeadId:'lead-2'}];h.state.clients=[{...h.state.clients[0],fromLeadId:'lead-2'}];await h.rerender();
    assert.notEqual(h.modal.resetKey,oldKey);assert.equal(h.modal.applicationType,'워크아웃');assert.equal(h.modal.reservationAt,'2026-11-01T09:00');assert.equal(h.captures.BasicInfoSection.personal.basicIncomeNote,'두번째 서버본');
    const nextKey=h.modal.resetKey;h.state.profile={...h.state.profile,id:'actor-2'};await h.rerender();assert.notEqual(h.modal.resetKey,nextKey);
    h.state.profile={...h.state.profile,lawFirmId:'firm-2'};await h.rerender();assert.equal(h.tree.toJSON(),null);assert.equal(h.updates.length,0);
  }finally{h.close();}
});
