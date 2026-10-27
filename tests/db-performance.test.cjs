// Offline equivalence tests: actual committed/current TSX with actual React 18 renderer.
// Test-only runtime lives outside the application; no production dependency is added.
// Run: node --test tests/db-performance.test.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const runtime = process.env.DB_TEST_RUNTIME || path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react'));
const renderer = require(path.join(runtime, 'react-test-renderer'));
const jsx = require(path.join(runtime, 'react/jsx-runtime'));
const ts = require(path.join(root, 'node_modules/typescript'));
const BASELINE = '6acb7b9473fec6d36e5a20eda0ae1695bec7a131';
// Normalize only the explicitly requested contact threshold/tooltip change in the
// historical baseline. All other controls, warning calculations and data remain compared.
const baseline = execFileSync('git', ['show', `${BASELINE}:app/db/page.tsx`], { cwd: root, encoding: 'utf8' })
  .replace('const threshold = stage === "착수금 안내" ? 1 : 2;', 'const threshold = stage === "미상담" || stage === "착수금 안내" ? 1 : 2;')
  .replace('title: stage === "착수금 안내" ? "착수금 안내 고객은 하루 1회 컨택이 필요합니다." : "미상담/부재 고객은 하루 2회 컨택이 필요합니다.",', 'title: `${stage} 고객은 하루 ${threshold}회 컨택이 필요합니다.`,');
const current = fs.readFileSync(path.join(root, 'app/db/page.tsx'), 'utf8');
const clean = (value) => JSON.parse(JSON.stringify(value));

function instrument(source) {
  const sf = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  let responsiveMap = 0;
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const key = { leadTimeCategory: 'time', leadDebtCategory: 'debt', leadIncomeCategory: 'income' }[node.name.text];
      if (key) edits.push({ start: node.body.getStart(sf) + 1, end: node.body.getStart(sf) + 1, text: `globalThis.__stats.${key}++;` });
      if (node.name.text === 'DbManagementPage') {
        const output = node.body.statements.find(ts.isReturnStatement);
        edits.push({ start: output.getStart(sf), end: output.getStart(sf), text: `
          globalThis.__snapshot = { sourceIds:sourceUniverse.map(x=>x.id), sourceCounts, stageIds:stageUniverse.map(x=>x.id), stageCounts,
            baseIds:baseRows.map(x=>x.id), timeCounts, debtCounts, incomeCounts, rowIds:rows.map(x=>x.id), visibleIds:visibleRows.map(x=>x.id), financeSummary, stageWarningCounts };
          globalThis.__controls = { query:setQuery, source:setSourceFilter, stage:setStageFilter, staff:setStaffFilter, time:setTimeFilter,
            debt:setDebtFilter, income:setIncomeFilter, page:setPage, add:setNewLeadOpen, consultation:setConsultTarget, deletion:setDeleteTarget, today:setTodayIso };
        ` });
      }
    }
    if (ts.isFunctionExpression(node) && ['MobileLeadRow', 'DesktopLeadRow'].includes(node.name?.text)) {
      edits.push({ start: node.body.getStart(sf) + 1, end: node.body.getStart(sf) + 1, text: `globalThis.__stats.${node.name.text === 'MobileLeadRow' ? 'mobile' : 'desktop'}++;` });
    }
    // The baseline constructs rows inline. Count those actual mapper executions.
    if (ts.isCallExpression(node) && node.expression.getText(sf) === 'visibleRows.map' && !source.includes('const MobileLeadRow = memo')) {
      const body = node.arguments[0].body;
      edits.push({ start: body.getStart(sf), end: body.end, text: `(globalThis.__stats.${responsiveMap++ === 0 ? 'mobile' : 'desktop'}++, ${body.getText(sf)})` });
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);
  for (const edit of edits.sort((a,b)=>b.start-a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

function createHarness(source, options = {}) {
  const stats = { mobile:0, desktop:0, time:0, debt:0, income:0 };
  const writes = [];
  const timers = new Map();
  const now = new Date('2026-10-17T02:00:00Z').getTime();
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ console, Date: FixedDate, Map, Set, Math, crypto: { randomUUID: () => `fixture-contact-${writes.length}` }, __stats: stats,
    window: { sessionStorage: { getItem() { return null; }, removeItem() {} } },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  const h = React.createElement;
  const host = (tag) => ({ children, variant, size, ...props }) => h(tag, props, children);
  const primitives = {
    Button: host('button'), Card: host('div'), Input: host('input'), Select: host('select'),
    PageHeader: ({ title }) => h('h1', null, title),
    Modal: ({ open, title, children, onClose }) => open ? h('section', { 'data-modal':title }, h('button', { onClick:onClose }, '닫기'), children) : null,
    SearchBox: ({ value, onChange, onReset, placeholder }) => h('div', null, h('input', { value, placeholder, onChange:event=>onChange(event.target.value) }), h('button', { onClick:onReset }, '검색 초기화')),
    Pagination: ({ page, total, onChange, pageSize }) => h('nav', { 'data-page':page, 'data-total':total, 'data-size':pageSize }, h('button', { onClick:()=>onChange(Math.max(1,page-1)) }, '이전'), h('button', { onClick:()=>onChange(Math.min(Math.max(1,Math.ceil(total/pageSize)),page+1)) }, '다음')),
    pageRows: (rows,page,size) => rows.slice((page-1)*size,page*size),
    useClickOutside: () => React.useRef(null),
  };
  const modules = new Map();
  let store;
  const requireMock = (name) => {
    if (name === '@/lib/writing-staff') return load('lib/writing-staff.ts');
    if (name === '@/lib/permissions') return load('lib/permissions.ts');
    if (name === '@/lib/case-consultation') return load('lib/case-consultation.ts');
    if (name === '@/lib/consultation-memos' || name === './consultation-memos') return load('lib/consultation-memos.ts');
    if (name === '@/components/db/LeadWorkDialog' && options.workDialog) return load('components/db/LeadWorkDialog.tsx');
    if (name === '@/components/sms/LeadSmsDialog' || name === '@/components/db/LeadWorkDialog') return { __esModule: true, default: () => null };
    if (name === 'react') return React;
    if (name === '@/components/ui/DateInput') return { DateInput: ({ onValueChange, onIncompleteChange, ...props }) => h('input', { ...props, type:'date', onChange:event=>onValueChange(event.target.value) }) };
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'next/link') return { __esModule:true, default:host('a') };
    if (name === 'lucide-react') return new Proxy({}, { get:(_target,key)=>()=>h('i', {'data-icon':key}) });
    if (name === '@/lib/store') return { useStore:()=>store };
    if (name === '@/components/ui/Primitives') return primitives;
    // Scroll geometry has its own actual-component tests; this suite compares
    // every DB control/data calculation against the historical baseline.
    if (name === '@/components/ui/BottomHorizontalScrollbar') return { BottomHorizontalScrollbar: () => null };
    if (name === '@/components/ui/ConfirmDelete') return { ConfirmDelete:({open,name,onClose,onConfirm})=>open?h('section',{'data-delete':name},h('button',{onClick:onClose},'취소'),h('button',{onClick:onConfirm},'삭제 확인')):null };
    if (name === '@/components/ui/consultation/ConsultationModal') return { ConsultationModal:({open,displayName,onClose,applicationType,reservationAt,readOnly})=>open?h('section',{'data-consultation':displayName,'data-direction':applicationType,'data-reservation':reservationAt,'data-readonly':readOnly},h('button',{onClick:onClose},'상담 닫기')):null };
    const names = { './types':'lib/types.ts', '@/lib/types':'lib/types.ts', '@/lib/format':'lib/format.ts', '@/lib/consultation':'lib/consultation.ts', '@/lib/list-indexes':'lib/list-indexes.ts', '@/lib/manual-lead-assignment':'lib/manual-lead-assignment.ts', '@/components/ui/ReservationDateTimeEditor':'components/ui/ReservationDateTimeEditor.tsx' };
    if (!names[name]) throw new Error(`Unmocked dependency ${name}`);
    return load(names[name]);
  };
  function load(relative, customSource) {
    if (modules.has(relative)) return modules.get(relative);
    const code = ts.transpileModule(customSource ?? fs.readFileSync(path.join(root,relative),'utf8'), { compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports:{} }; modules.set(relative,module.exports);
    const factory = vm.runInContext(`(function(require,module,exports){${code}\n})`,context);
    factory(requireMock,module,module.exports); return module.exports;
  }
  const types = load('lib/types.ts');
  const statuses = ['신규접수','부재중','재통화필요','종결_중단','거절','수임전환'];
  const stages = ['미상담','부재','착수금 안내','장기부재','예약','상담'];
  const sources = ['Facebook광고','인스타그램','구글','네이버','지인 소개','threads','기타',''];
  const leads = Array.from({length:43},(_,index)=>({
    id:`lead-${index}`, name:`고객${index}`, phone:`010-1234-${String(index).padStart(4,'0')}`, receivedAt:`2026-10-${String(index%20+1).padStart(2,'0')}`,
    assignedStaff:index%2?'담당B':'담당A', status:statuses[index%statuses.length], detailStage:index%7?stages[index%stages.length]:undefined,
    applicationType:index%3?'개인회생':'개인파산', source:sources[index%sources.length], sourceSheet:index%8===7?'Raw2':undefined,
    debtRange:types.DEBT_RANGE_OPTIONS[index%types.DEBT_RANGE_OPTIONS.length], incomeRaw:index%3?'연 3000만원':'알 수 없음',
    incomeRange:index%4?types.INCOME_RANGE_OPTIONS[index%types.INCOME_RANGE_OPTIONS.length]:undefined,
    consultTime:types.CONSULT_TIME_OPTIONS[index%types.CONSULT_TIME_OPTIONS.length], adName:`광고${index%4}`, email:`fixture${index}@example.invalid`, memo:`기초메모 ${index}`,
    convertedClientId:index%9===0?`client-${index}`:undefined, convertedCaseId:index%18===0?`case-${index}`:undefined,
    reservationAt:index%3===0?'2026-10-19T10:20':undefined,_lawFirmName:`로펌${index%2}`,
    consultation:{personal:{occupationType:index%4===0?'무직':'직장인'},memo:`상담 메모 ${index}`,memoLog:[{id:`memo-${index}`,at:'2026-10-17T00:10:00Z',staff:'담당A',tag:index%2?'통화완료':'부재중',text:`상담 내용 ${index}`}]} ,
  }));
  const cases = Array.from({length:65},(_,index)=>({id:`case-${index}`,fromLeadId:`lead-${index%43}`,clientId:`client-${index%43}`,caseNumber:`2026개회${String(index).padStart(4,'0')}`,assignedStaff:index%2?'담당B':'담당A',contractAmount:index*10000,paidAmount:index*3000}));
  let rights = options.rights ? new Set(options.rights) : null;
  store = { leads:options.empty?[]:leads, cases, profile:{id:'viewer',platformRole:options.global?'super_admin':'staff',staffName:'담당A',displayName:'별칭A'},superAdminFirmScope:null,currentStaff:'담당A',workStaffNames:['담당A','담당B'],isAdmin:!rights,
    can:permission=>!rights || rights.has(permission),
    updateLead:async(id,patch)=>{writes.push(['update',id,clean(patch)]);return true;},
    deleteLead:id=>writes.push(['delete',id]), convertLeadToClient:id=>{writes.push(['convert',id]);return 'client-fixture';},addLead:row=>writes.push(['add',clean(row)]),
  };
  const Page = load('app/db/page.tsx',instrument(source)).default;
  let view;
  renderer.act(()=>{view=renderer.create(h(Page));});
  return { stats,writes,store,types,view,controls:()=>context.__controls,snapshot:()=>clean(context.__snapshot),tree:()=>clean(view.toJSON()),
    set(values) {renderer.act(()=>{for(const [key,value]of Object.entries(values))context.__controls[key](value);});},
    refresh() {renderer.act(()=>view.update(h(Page)));},
    permissions(next) {rights=new Set(next);store.can=permission=>rights.has(permission);this.refresh();},
    close() {renderer.act(()=>view.unmount());},
  };
}

function pair(options) { return [createHarness(baseline,options),createHarness(current,options)]; }
// The historical baseline predates the SMS row action. Contact/reason is
// restored by request; compare every other control and value unchanged.
function originalTree(value, manualLeadModal = false) {
  if (Array.isArray(value)) return value.map(item=>originalTree(item,manualLeadModal)).filter(item=>item!==null);
  if (!value || typeof value !== 'object') return value;
  const insideManualLeadModal=manualLeadModal || value.props?.['data-modal']==='DB 수기 추가';
  // Only this intentionally changed assignee row is covered by the dedicated
  // actual-UI/store regression; every other field in the modal stays compared.
  if (insideManualLeadModal && value.type==='label' && value.children?.some(child=>typeof child==='string'&&child.trim()==='담당자')) return null;
  if (value.type === 'button' && ['컨택 · 사유','문자발송'].some(label=>value.children?.includes(label))) return null;
  if (value.props?.id === 'db-customer-table-scroll') {
    value = { ...value, props: { className: 'hidden overflow-x-auto md:block' } };
  }
  return {...value, ...(value.children ? {children:originalTree(value.children,insideManualLeadModal)} : {})};
}
function equalPair(a,b) { assert.deepEqual(b.snapshot(),a.snapshot()); assert.deepEqual(originalTree(b.tree()),originalTree(a.tree())); }
function hostNodes(h,type) { return h.view.root.findAll(node=>node.type===type); }
function hostText(node) { return node.children.map(child=>typeof child==='string'?child:hostText(child)).join(''); }

test('same rows, counts, warnings, finance, tie ordering and 10-row pagination for combined filters/search',()=>{
  const [old,next]=pair();try{
    equalPair(old,next); assert.equal(next.snapshot().visibleIds.length,10);
    const scenarios=[{page:2},{page:5},{page:1,source:'메타'},{source:'전체',stage:'부재'},{stage:'전체',staff:'담당B'},
      {staff:'전체',time:old.types.CONSULT_TIME_OPTIONS[0]},{debt:old.types.DEBT_RANGE_OPTIONS[1]},
      {time:'전체',debt:'전체',income:'무직'},{income:'전체',query:'010123400'},
      {query:'2026개회0018'},{query:'상담 내용 12'},{query:'고객'},{query:'없는결과'},{query:'',today:'2026-10-18'}];
    for(const values of scenarios){old.set(values);next.set(values);equalPair(old,next);}
  }finally{old.close();next.close();}
});

test('staff scope, global firm column, empty and permission-limited rows match the committed page',()=>{
  for(const options of [{rights:['db.view','db.view_consultation']},{global:true},{empty:true}]){
    const [old,next]=pair(options);try{equalPair(old,next);old.set({query:'고객',staff:'담당B'});next.set({query:'고객',staff:'담당B'});equalPair(old,next);}finally{old.close();next.close();}
  }
});

test('unrelated page dialogs skip all 20 row bodies while preserving identical output',(t)=>{
  const [old,next]=pair();try{
    const beforeOld=old.stats.mobile+old.stats.desktop,beforeNext=next.stats.mobile+next.stats.desktop;
    for(const values of [{add:true},{add:false},{consultation:old.store.leads[0]},{consultation:null},{deletion:old.store.leads[1]},{deletion:null}]){
      old.set(values);next.set(values);equalPair(old,next);
    }
    assert.equal(old.stats.mobile+old.stats.desktop-beforeOld,120);
    assert.equal(next.stats.mobile+next.stats.desktop-beforeNext,0);
    t.diagnostic('Six unrelated dialog changes: row bodies 120 → 0; both responsive trees remain mounted.');
  }finally{old.close();next.close();}
});

test('pivot changes reuse already-normalized categories rather than scan them again',(t)=>{
  const [old,next]=pair();try{
    const initial=clean(next.stats),oldInitial=clean(old.stats);
    for(const values of [{time:old.types.CONSULT_TIME_OPTIONS[0]},{debt:old.types.DEBT_RANGE_OPTIONS[0]},{income:old.types.INCOME_RANGE_OPTIONS[0]},{time:'전체',debt:'전체',income:'전체'}]){
      old.set(values);next.set(values);equalPair(old,next);
    }
    assert.deepEqual([next.stats.time,next.stats.debt,next.stats.income],[initial.time,initial.debt,initial.income]);
    assert.ok(old.stats.time>oldInitial.time && old.stats.debt>oldInitial.debt && old.stats.income>oldInitial.income);
    t.diagnostic(`Four pivot changes: category normalizations ${old.stats.time+old.stats.debt+old.stats.income-oldInitial.time-oldInitial.debt-oldInitial.income} → 0.`);
  }finally{old.close();next.close();}
});

test('row edit and reservation handlers preserve payloads; callbacks and permission changes invalidate memo',()=>{
  const [old,next]=pair();try{
    for(const harness of [old,next]){
      const selects=hostNodes(harness,'select');
      renderer.act(()=>{selects[0].props.onChange({target:{value:'개인파산'}});selects[1].props.onChange({target:{value:'담당B'}});selects[2].props.onChange({target:{value:'상담'}});});
      const date=hostNodes(harness,'input').find(node=>node.props.type==='date');renderer.act(()=>date.props.onChange({target:{value:'2026-11-11'}}));
    }
    assert.deepEqual(next.writes,old.writes);
    const before=next.stats.mobile+next.stats.desktop;
    old.permissions(['db.view_all','db.view_consultation']);next.permissions(['db.view_all','db.view_consultation']);equalPair(old,next);
    assert.equal(next.stats.mobile+next.stats.desktop-before,20);
    const nextCount=next.stats.mobile+next.stats.desktop;
    next.store.updateLead=async()=>true;next.refresh();assert.equal(next.stats.mobile+next.stats.desktop-nextCount,20);
  }finally{old.close();next.close();}
});

test('memo popover remains open across parent rerenders and responsive branches stay mounted',()=>{
  const [old,next]=pair();try{
    for(const harness of [old,next]){
      const memo=hostNodes(harness,'button').find(node=>hostText(node).includes('메모 1건'));
      renderer.act(()=>memo.props.onClick());
      const opened=hostNodes(harness,'ul').length;assert.equal(opened,1);
      harness.set({add:true});harness.set({add:false});assert.equal(hostNodes(harness,'ul').length,opened);
      assert.ok(hostNodes(harness,'div').some(node=>node.props.className==='divide-y divide-slate-100 md:hidden'));
      assert.ok(hostNodes(harness,'div').some(node=>['hidden','overflow-x-auto','md:block'].every(token=>node.props.className?.split(' ').includes(token))));
      assert.equal(hostNodes(harness,'tr').length,11);
    }
    equalPair(old,next);
  }finally{old.close();next.close();}
});

test('DB bottom scroll control targets only the desktop customer table and hides behind dialogs',()=>{
  const currentPage=createHarness(current);
  try {
    const target=currentPage.view.root.findByProps({id:'db-customer-table-scroll'});
    assert.equal(target.props.role,'region');
    assert.equal(target.props['aria-label'],'DB 고객리스트');
    assert.equal(target.props.tabIndex,0);
    const control=()=>currentPage.view.root.find(node=>typeof node.type==='function'&&node.type.name==='BottomHorizontalScrollbar');
    assert.equal(control().props.targetId,target.props.id);
    assert.equal(control().props.label,'고객리스트 좌우 이동');
    assert.equal(control().props.hideWhen,false);
    currentPage.set({add:true});assert.equal(control().props.hideWhen,true);
    currentPage.set({add:false});assert.equal(control().props.hideWhen,false);
    currentPage.set({consultation:currentPage.store.leads[0]});assert.equal(control().props.hideWhen,true);
    currentPage.set({consultation:null});assert.equal(control().props.hideWhen,false);
    currentPage.set({deletion:currentPage.store.leads[0]});assert.equal(control().props.hideWhen,true);
    currentPage.set({deletion:null});assert.equal(control().props.hideWhen,false);
    renderer.act(()=>hostNodes(currentPage,'button').find(node=>hostText(node)==='컨택 · 사유').props.onClick());
    assert.equal(control().props.hideWhen,true);
  } finally { currentPage.close(); }
});

test('DB preview and search expose only active memo text, with pins first and original customer actions unchanged',()=>{
  const currentPage=createHarness(current);
  try {
    const original=currentPage.store.leads[0], at='2026-10-17T00:10:00Z';
    const log=[{id:'deleted',at,staff:'합성 작성자',tag:'부재중',text:'삭제메모고유검색어',deletedAt:at},
      {id:'active',at,staff:'합성 작성자',tag:'일반',text:'현재메모고유검색어'},
      {id:'pinned',at:'2026-10-01T00:00:00Z',staff:'합성 작성자',tag:'일반',text:'고정메모고유검색어',pinned:true,pinOrder:0}];
    currentPage.store.leads=[{...original,consultation:{...original.consultation,memoLog:log}}];
    currentPage.refresh();
    const button=hostNodes(currentPage,'button').find(node=>hostText(node).includes('메모 2건'));
    assert.ok(button);assert.match(hostText(button),/\[고정\] 고정메모고유검색어/);
    renderer.act(()=>button.props.onClick());
    const list=hostNodes(currentPage,'ul')[0];
    assert.doesNotMatch(hostText(list),/삭제메모고유검색어/);
    const visible=list.findAll(node=>node.type==='li');
    assert.match(hostText(visible[0]),/고정메모고유검색어/);assert.match(hostText(visible[1]),/현재메모고유검색어/);
    currentPage.set({query:'삭제메모고유검색어'});assert.equal(currentPage.snapshot().visibleIds.length,0);
    currentPage.set({query:'현재메모고유검색어'});assert.deepEqual(currentPage.snapshot().visibleIds,[original.id]);
    assert.deepEqual(currentPage.writes,[]);assert.deepEqual(log.map(entry=>entry.id),['deleted','active','pinned']);
  } finally { currentPage.close(); }
});

test('new lead draft and search reset behaviors remain unchanged',()=>{
  const [old,next]=pair();try{
    for(const harness of [old,next]){
      harness.set({add:true});const input=hostNodes(harness,'input').find(node=>node.props.placeholder==='고객명');
      renderer.act(()=>input.props.onChange({target:{value:'보존할 임시 고객명'}}));harness.set({add:false});harness.set({add:true});
      assert.equal(hostNodes(harness,'input').find(node=>node.props.placeholder==='고객명').props.value,'보존할 임시 고객명');
      harness.set({add:false,source:'구글',stage:'상담',time:harness.types.CONSULT_TIME_OPTIONS[0],page:3});
      const search=hostNodes(harness,'input').find(node=>node.props.placeholder?.startsWith('고객명 ·'));
      renderer.act(()=>search.props.onChange({target:{value:'고객'}}));assert.equal(harness.snapshot().visibleIds.length,10);
    }
    equalPair(old,next);
  }finally{old.close();next.close();}
});

test('an immutable lead update invalidates its two responsive rows and the derived categories',()=>{
  const [old,next]=pair();try{
    const id=old.snapshot().visibleIds[0],oldCount=old.stats.mobile+old.stats.desktop,nextCount=next.stats.mobile+next.stats.desktop;
    for(const harness of [old,next]){
      harness.store.leads=harness.store.leads.map(lead=>lead.id===id?{...lead,name:'수정한 고객',debtRange:harness.types.DEBT_RANGE_OPTIONS[0],reservationAt:'2026-12-20T13:30'}:lead);
      harness.refresh();
    }
    equalPair(old,next);assert.equal(old.stats.mobile+old.stats.desktop-oldCount,20);assert.equal(next.stats.mobile+next.stats.desktop-nextCount,2);
    assert.ok(JSON.stringify(next.tree()).includes('수정한 고객'));
  }finally{old.close();next.close();}
});

test('existing-client conversion and lead deletion preserve original callbacks',()=>{
  const [old,next]=pair();try{
    for(const harness of [old,next]){
      harness.set({query:'고객9'});
      const convert=hostNodes(harness,'button').find(node=>hostText(node)==='계약 생성');assert.ok(convert);
      renderer.act(()=>convert.props.onClick());
      const remove=hostNodes(harness,'button').find(node=>hostText(node)==='삭제');assert.ok(remove);
      renderer.act(()=>remove.props.onClick());
      const confirm=hostNodes(harness,'button').find(node=>hostText(node)==='삭제 확인');renderer.act(()=>confirm.props.onClick());
    }
    assert.deepEqual(next.writes,old.writes);assert.deepEqual(next.writes,[['convert','lead-9'],['delete','lead-9']]);equalPair(old,next);
  }finally{old.close();next.close();}
});


test('contact/reason action is restored on desktop/mobile while consultation, SMS, memo and warnings remain',()=>{
  const h=createHarness(current);try{
    const before=clean(h.store.leads);
    const buttons=hostNodes(h,'button').map(hostText);
    assert.equal(buttons.filter(text=>text==='컨택 · 사유').length,20);
    assert.equal(buttons.filter(text=>text==='문자발송').length,20);
    assert.equal(buttons.filter(text=>text==='상담일지').length,10);
    assert.equal(buttons.filter(text=>text==='상담일지 작성').length,10);
    assert.ok(JSON.stringify(h.tree()).includes('컨택 알림'));
    assert.ok(JSON.stringify(h.tree()).includes('상담 내용'));
    assert.deepEqual(clean(h.store.leads),before);
    assert.deepEqual(h.writes,[]);
    assert.equal(current.includes('LeadWorkDialog'),true);
  }finally{h.close();}
});

test('미상담 one missed call clears both responsive badges and stage count until the next KST day',()=>{
  const h=createHarness(current);try{
    const base={...h.store.leads[0],id:'warning-only',status:'신규접수',detailStage:'미상담',convertedClientId:undefined,convertedCaseId:undefined,consultation:{memoLog:[]}};
    h.store.leads=[base];h.refresh();
    const badges=()=>hostNodes(h,'span').filter(node=>node.props.title==='미상담 고객은 하루 1회 컨택이 필요합니다.');
    assert.equal(badges().length,2);assert.ok(badges().every(node=>hostText(node).includes('부재중 0/1')));
    assert.equal(h.snapshot().stageWarningCounts['미상담'],1);
    h.store.leads=[{...base,consultation:{memoLog:[{id:'missed',at:'2026-10-16T15:00:00Z',tag:'부재중',text:'',staff:'담당A'}]}}];h.refresh();
    assert.equal(badges().length,0);assert.equal(h.snapshot().stageWarningCounts['미상담']??0,0);
    h.set({today:'2026-10-18'});
    assert.equal(badges().length,2);assert.equal(h.snapshot().stageWarningCounts['미상담'],1);
    assert.deepEqual(h.writes,[]);
  }finally{h.close();}
});


test('restored responsive actions open the correct real dialog, preserve history and close without writes',()=>{
  const h=createHarness(current,{workDialog:true});try{
    for(const index of [0,10]){
      const button=hostNodes(h,'button').filter(node=>hostText(node)==='컨택 · 사유')[index];
      renderer.act(()=>button.props.onClick());
      const dialog=hostNodes(h,'section').find(node=>node.props['data-modal']?.includes('컨택 · 사유 기록'));
      assert.ok(dialog);assert.ok(hostNodes(h,'h3').some(node=>hostText(node)==='컨택 기록 0건'));
      renderer.act(()=>dialog.findAll(node=>node.type==='button'&&hostText(node)==='닫기')[0].props.onClick());
      assert.equal(hostNodes(h,'section').some(node=>node.props['data-modal']?.includes('컨택 · 사유 기록')),false);
    }
    assert.deepEqual(h.writes,[]);
  }finally{h.close();}
});

test('restored contact dialog appends a record and preserves the existing contact history',async()=>{
  const h=createHarness(current,{workDialog:true});try{
    const id=h.snapshot().visibleIds[0], original={id:'historical-contact',at:'2026-10-16T00:00:00Z',staff:'담당A',type:'phone',connected:false,note:'이전 기록'};
    h.store.leads=h.store.leads.map(lead=>lead.id===id?{...lead,contactLog:[original],invalidReason:'기타'}:lead);h.refresh();
    renderer.act(()=>hostNodes(h,'button').find(node=>hostText(node)==='컨택 · 사유').props.onClick());
    assert.ok(JSON.stringify(h.tree()).includes('이전 기록'));
    const area=hostNodes(h,'textarea').find(node=>node.props.maxLength===2000);
    renderer.act(()=>area.props.onChange({target:{value:'복원 후 테스트'}}));
    await renderer.act(async()=>{hostNodes(h,'button').find(node=>hostText(node)==='현재 시각으로 컨택 기록').props.onClick();});
    assert.equal(h.writes.length,1);const [kind,savedId,patch]=h.writes[0];
    assert.equal(kind,'update');assert.equal(savedId,id);assert.equal(patch.contactLog.length,2);
    assert.deepEqual(patch.contactLog[0],original);assert.equal(patch.contactLog[1].note,'복원 후 테스트');assert.equal(patch.invalidReason,'기타');
    assert.ok(JSON.stringify(h.tree()).includes('컨택 기록을 저장했습니다.'));
    assert.equal(area.props.value,'');
    assert.deepEqual(Object.keys(patch).sort(),['contactLog','invalidReason']);
  }finally{h.close();}
});

test('restored dialog respects consultation permission and closes on account or firm changes',()=>{
  const h=createHarness(current,{workDialog:true,rights:['db.view_all','db.view_consultation']});try{
    renderer.act(()=>hostNodes(h,'button').find(node=>hostText(node)==='컨택 · 사유').props.onClick());
    assert.ok(hostNodes(h,'fieldset').every(node=>node.props.disabled));
    h.store.profile={...h.store.profile,id:'other-viewer'};h.refresh();
    assert.equal(hostNodes(h,'section').some(node=>node.props['data-modal']?.includes('컨택 · 사유 기록')),false);
    h.permissions(['db.view_all']);
    assert.equal(hostNodes(h,'button').some(node=>hostText(node)==='컨택 · 사유'),false);
    assert.deepEqual(h.writes,[]);
  }finally{h.close();}
  const global=createHarness(current,{workDialog:true,global:true});try{
    renderer.act(()=>hostNodes(global,'button').find(node=>hostText(node)==='컨택 · 사유').props.onClick());
    assert.ok(hostNodes(global,'fieldset').every(node=>node.props.disabled));
    assert.deepEqual(global.writes,[]);
  }finally{global.close();}
});


test('reason save does not append contacts and failed saves preserve the entered note',async()=>{
  const h=createHarness(current,{workDialog:true});try{
    renderer.act(()=>hostNodes(h,'button').find(node=>hostText(node)==='컨택 · 사유').props.onClick());
    const invalid=hostNodes(h,'select').find(node=>node.children.some(child=>typeof child!=='string'&&hostText(child)==='연락처 오류'));
    renderer.act(()=>invalid.props.onChange({target:{value:'연락처 오류'}}));
    await renderer.act(async()=>{hostNodes(h,'button').find(node=>hostText(node)==='사유 저장').props.onClick();});
    assert.deepEqual(h.writes[0][2],{invalidReason:'연락처 오류'});
    h.store.updateLead=async()=>false;h.refresh();
    renderer.act(()=>hostNodes(h,'textarea').find(node=>node.props.maxLength===2000).props.onChange({target:{value:'재시도할 내용'}}));
    await renderer.act(async()=>{hostNodes(h,'button').find(node=>hostText(node)==='현재 시각으로 컨택 기록').props.onClick();});
    assert.ok(JSON.stringify(h.tree()).includes('저장하지 못했습니다. 입력은 유지됩니다.'));
    assert.equal(hostNodes(h,'textarea').find(node=>node.props.maxLength===2000).props.value,'재시도할 내용');
  }finally{h.close();}
});

test('same-firm other-assignee long absence appears on desktop/mobile as read-only and leaves when stage changes', () => {
  const h = createHarness(current,{rights:['db.view','db.edit_basic','db.edit_consultation','db.view_consultation','db.change_stage','db.change_assignee','db.manage_reservation','db.convert','db.delete','sms.send']});
  try {
    h.store.profile={...h.store.profile,role:'staff',isActive:true,lawFirmId:'firm-1'};
    const row={...h.store.leads[1],id:'shared-only',name:'공유 장기부재',assignedStaff:'담당B',_lawFirmId:'firm-1',detailStage:'장기부재',convertedClientId:undefined,convertedCaseId:undefined};
    h.store.leads=[row];h.refresh();
    assert.deepEqual(h.snapshot().rowIds,['shared-only']);
    assert.ok(JSON.stringify(h.tree()).includes('공유 장기부재'));
    assert.ok(hostNodes(h,'select').filter(node=>['개인회생','개인파산','담당B','장기부재'].includes(node.props.value)).every(node=>node.props.disabled));
    for(const label of ['문자발송','고객전환','삭제','상담일지 작성']) assert.equal(hostNodes(h,'button').filter(node=>hostText(node)===label).length,0,label);
    assert.ok(hostNodes(h,'button').some(node=>hostText(node)==='상담일지 조회'));
    h.store.leads=[{...row,detailStage:'상담'}];h.refresh();assert.deepEqual(h.snapshot().rowIds,[]);
    h.store.leads=[{...row,_lawFirmId:'firm-2'}];h.refresh();assert.deepEqual(h.snapshot().rowIds,[]);
    h.store.leads=[row];h.store.profile={...h.store.profile,permissions:{'staff.writer':true}};h.refresh();assert.deepEqual(h.snapshot().rowIds,[]);
  }finally{h.close();}
});
