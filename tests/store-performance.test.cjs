// Offline, actual React 18 renderer + a thenable Supabase/RLS fixture. No network.
// Test-only runtime: npm install --prefix ../store-test-runtime --save-exact react@18.3.1 react-test-renderer@18.3.1
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),runtime=path.resolve(root,'../store-test-runtime/node_modules');
const React=require(path.join(runtime,'react')),renderer=require(path.join(runtime,'react-test-renderer'));
const ts=require(path.join(root,'node_modules/typescript')),{act}=renderer;
let fixture,pathname='/';
const originalLoad=Module._load;
Module._load=function(name,parent,...rest){
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return require(path.join(runtime,'react/jsx-runtime'));
  if(name==='next/navigation')return {usePathname:()=>pathname};
  if(name==='./supabase/client'&&parent?.filename===path.join(root,'lib/store.tsx'))return {hasSupabaseEnv:()=>true,createClient:()=>fixture.client};
  if(name.startsWith('@/'))return originalLoad.call(this,path.join(root,name.slice(2)),parent,...rest);
  return originalLoad.call(this,name,parent,...rest);
};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:file,
}).outputText,file);
const {AppStoreProvider,useStore,useStoreSession}=require(path.join(root,'lib/store.tsx'));
const {createStoreRefreshQueue,retainEqual}=require(path.join(root,'lib/store-refresh.ts'));
const realTimeout=global.setTimeout;
const realFetch=global.fetch;
global.setTimeout=(fn,ms,...args)=>realTimeout(fn,ms===180?0:ms,...args);
global.fetch=()=>{throw new Error('Network prohibited by test');};
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const delay=()=>new Promise(resolve=>realTimeout(resolve,1));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function eventTarget(extra={}){const listeners=new Map();return {...extra,addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(k,fn){listeners.get(k)?.delete(fn);},emit(k){listeners.get(k)?.forEach(fn=>fn());}};}
function makeFixture(superAdmin=false){
  const f={calls:[],authCalls:0,signOuts:0,channels:[],authListeners:new Set(),holds:[],errors:[],hidden:new Set(),active:true,rowCap:1000,user:{id:'user-1',email:'one@fixture.invalid'}};
  const profile={id:'user-1',email:f.user.email,display_name:'One',staff_name:'One',role:'admin',platform_role:superAdmin?'super_admin':'firm_admin',law_firm_id:superAdmin?null:'firm-1',is_active:true,is_work_staff:true,permissions:{'db.view':true}};
  f.db={profiles:[profile],law_firms:[{id:'firm-1',firm_code:'1111111111',name:'Firm One',status:'active'},{id:'firm-2',firm_code:'2222222222',name:'Firm Two',status:'active'}],
    app_leads:[{id:'L1',law_firm_id:'firm-1',data:{name:'Lead One',receivedAt:'2026-10-01',assignedStaff:'One',phone:'01000000001'}},{id:'L2',law_firm_id:'firm-2',data:{name:'Lead Two',receivedAt:'2026-10-02'}}],
    app_clients:[{id:'C1',law_firm_id:'firm-1',data:{name:'Client One',phone:'01000000002'}},{id:'C2',law_firm_id:'firm-2',data:{name:'Client Two'}}],
    app_cases:[{id:'K1',law_firm_id:'firm-1',data:{clientId:'C1',contractAmount:100,paidAmount:0}}],
    app_installments:[{id:'I1',law_firm_id:'firm-1',data:{caseId:'K1',amount:100,actualPaidAmount:0,status:'완납'}}],
    app_schedule_items:[{id:'S1',law_firm_id:'firm-1',data:{title:'Schedule'}}],
    app_board_posts:[{id:'P1',law_firm_id:'firm-1',data:{title:'Post'}}],
    app_change_logs:[{id:'H1',law_firm_id:'firm-1',data:{at:'2026-10-01',detail:'Older'}},{id:'H2',law_firm_id:'firm-1',data:{at:'2026-10-02',detail:'Newer'}}],
    firm_settings:[{law_firm_id:'firm-1',key:'case_documents',value:{K1:{one:true}}}],app_settings:[]};
  f.hold=(table)=>{const gate=deferred();f.holds.push({table,...gate});return gate;};
  f.client={auth:{getUser:async()=>{f.authCalls++;return {data:{user:clone(f.user)},error:null};},getSession:async()=>({data:{session:null}}),
    signOut:async()=>{f.signOuts++;f.user=null;f.authListeners.forEach(cb=>cb('SIGNED_OUT',null));return {error:null};},
    onAuthStateChange(cb){f.authListeners.add(cb);return {data:{subscription:{unsubscribe(){f.authListeners.delete(cb);}}}};}},
    rpc:async(name)=>{f.calls.push({table:'rpc:'+name});return {data:f.active,error:null};},
    from(table){const filters=[],orders=[];let columns='*',single=false,operation='select',payload;
      const q={select(c){columns=c;return q;},eq(k,v){filters.push([k,v]);return q;},order(k,opts){orders.push([k,opts?.ascending!==false]);return q;},maybeSingle(){single=true;return q;},
        update(v){operation='update';payload=v;return q;},insert(v){operation='insert';payload=v;return q;},delete(){operation='delete';return q;},upsert(v){operation='upsert';payload=v;return q;},
        then(resolve,reject){return (async()=>{
          f.calls.push({table,columns,filters:clone(filters),operation});
          const errorIndex=f.errors.indexOf(table);if(errorIndex>=0){f.errors.splice(errorIndex,1);return {data:null,error:new Error('fixture read failed '+table)};}
          let rows=(f.db[table]||[]).filter(row=>filters.every(([k,v])=>row[k]===v));
          if(operation==='update'){rows.forEach(row=>Object.assign(row,clone(payload)));return {data:rows.map(row=>({id:row.id})),error:null};}
          if(operation==='insert'||operation==='upsert'){f.db[table].push(clone(payload));return {data:null,error:null};}
          if(operation==='delete'){f.db[table]=f.db[table].filter(row=>!rows.includes(row));return {data:null,error:null};}
          const actor=f.db.profiles.find(row=>row.id===f.user?.id);
          rows=rows.filter(row=>!f.hidden.has(row.id)&&(actor?.platform_role==='super_admin'||(table==='law_firms'?row.id===actor?.law_firm_id:table==='profiles'?row.id===actor?.id||row.law_firm_id===actor?.law_firm_id:row.law_firm_id===actor?.law_firm_id)));
          for(const [key,asc]of [...orders].reverse())rows.sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''))*(asc?1:-1));
          rows=rows.slice(0,f.rowCap).map(row=>columns==='*'?clone(row):Object.fromEntries(columns.split(',').map(key=>[key,clone(row[key])])));
          const result={data:single?(rows[0]||null):rows,error:null};
          const holdIndex=f.holds.findIndex(h=>h.table===table);if(holdIndex>=0){const [hold]=f.holds.splice(holdIndex,1);await hold.promise;}
          return result;
        })().then(resolve,reject);}};return q;},
    channel(name){const channel={name,handlers:[],active:true,on(type,filter,cb){this.handlers.push({filter,cb});return this;},subscribe(cb){this.status=cb;cb?.('SUBSCRIBED');return this;}};f.channels.push(channel);return channel;},
    removeChannel(channel){channel.active=false;return Promise.resolve('ok');}};
  f.emit=(table,event='UPDATE',row={law_firm_id:'firm-1'})=>f.channels.filter(ch=>ch.active).forEach(ch=>ch.handlers.filter(({filter})=>filter.table===table&&filter.event===event).forEach(({filter,cb})=>{
    if(filter.filter){const [key,value]=filter.filter.split('=eq.');if(row[key]!==value)return;}cb({eventType:event,new:row,old:event==='DELETE'?{id:row.id}:{}});
  }));
  f.authEvent=(event,user)=>{f.user=user;f.authListeners.forEach(cb=>cb(event,user?{user}:null));};
  return f;
}
let store,session,view,childElements,mounts=0,sessionRenders=0,draft;
const Data=()=>{store=useStore();return null;};
const Session=React.memo(()=>{session=useStoreSession();sessionRenders++;return null;});
const Draft=()=>{const ref=React.useRef(new Map());draft=ref.current;React.useEffect(()=>{mounts++;return()=>mounts--;},[]);return null;};
async function tick(){for(let i=0;i<5;i++)await act(async()=>{await delay();});}
async function mount(superAdmin=false,route='/',prepare){
  fixture=makeFixture(superAdmin);pathname=route;store=null;session=null;sessionRenders=0;mounts=0;
  prepare?.(fixture);
  global.window=eventTarget({sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{replace(){},href:''}});
  global.document=eventTarget({visibilityState:'visible'});
  childElements=React.createElement(React.Fragment,null,React.createElement(Data),React.createElement(Session),React.createElement(Draft));
  await act(async()=>{view=renderer.create(React.createElement(AppStoreProvider,null,childElements));});await tick();
}
async function unmount(){await act(async()=>view.unmount());await tick();}
async function navigate(route){pathname=route;await act(async()=>view.update(React.createElement(AppStoreProvider,null,childElements)));await tick();}
async function emit(table,event,row){await act(async()=>fixture.emit(table,event,row));await tick();}
const calls=table=>fixture.calls.filter(call=>call.table===table).length;
let passed=0;async function check(name,fn){await fn();console.log(`PASS ${++passed} ${name}`);}
async function runSuite(){
  await check('Original write callbacks and permission rules remain equivalent; new consultation fields use existing permission',()=>{
    const original=require('node:child_process').execFileSync('git',['show','6acb7b9:lib/store.tsx'],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
    const source=fs.readFileSync(path.join(root,'lib/store.tsx'),'utf8').replaceAll('\r\n','\n');
    const addition=' || key === "contactLog" || key === "invalidReason" || key === "nonContractReason" || key === "replacementRequestedAt"';
    assert.ok(source.includes('if (key === "consultation"'+addition+') return can("db.edit_consultation");'));
    // These phone-only additions are exercised by customer-phone tests. Strip
    // exactly the new validator and dedicated RPC callback; every pre-existing
    // persistence/permission callback remains compared byte-for-byte below.
    const phoneValidation = "      // Validate before the optimistic update, including direct store callers.\n      // Unchanged legacy/imported numbers must not block unrelated edits.\n      if (Object.prototype.hasOwnProperty.call(patch, \"phone\")) {\n        try {\n          if (typeof patch.phone !== \"string\") throw new Error(\"고객 연락처를 입력해주세요.\");\n          const phone = changedCustomerPhone(before.phone, patch.phone, true);\n          patch = { ...patch, phone: phone ?? before.phone };\n        } catch (err) {\n          setSyncError(`저장 실패 · ${err instanceof Error ? err.message : \"연락처를 확인해주세요.\"}`);\n          return false;\n        }\n      }\n";
    assert.ok(source.includes(phoneValidation));
    const phoneStart=source.indexOf('  const updateClientPhone ='),phoneEnd=source.indexOf('  const deleteLead =',phoneStart);
    assert.ok(phoneStart>=0&&phoneEnd>phoneStart);
    let current=(source.slice(0,phoneStart)+source.slice(phoneEnd)).replace(phoneValidation,'').replace(addition,'');
    // Writer restrictions and the explicitly introduced case-basic permission
    // are exercised by writing-staff-ui against the actual provider. Remove
    // only these exact additions here; every original callback remains compared.
    const writerAdditions=[
      '        if (["caseNumber", "caseType", "court", "stage", "stageUpdatedAt", "status", "filingDate", "nextHearingDate", "monthlyRepayment", "contractDate", "memo"].includes(key)) return can("cases.edit_basic");\n',
      '      if (isWritingStaff(profile) && (!isWritingLead(before) || !isWritingLead(next) || Object.keys(patch).some(key => ["id", "_lawFirmId", "_lawFirmName"].includes(key)))) {\n        setSyncError("저장 실패 · 작성직원은 착수 이후 DB만 수정할 수 있습니다.");\n        return false;\n      }\n',
      '      if (isWritingStaff(profile) && !isWritingLead(lead)) return undefined;\n',
      '      if (isWritingStaff(profile) && (!writingCaseAllowed(before, clients, leads, effectiveFirmId) || !writingCaseAllowed(next, clients, leads, effectiveFirmId))) return;\n',
      '      const editableCase = cases.find(record => record.id === caseId);\n      if (isWritingStaff(profile) && (!editableCase || !writingCaseAllowed(editableCase, clients, leads, effectiveFirmId))) {\n        setSyncError("저장 실패 · 작성직원은 착수 이후 DB에 연결된 계약만 수정할 수 있습니다.");\n        return false;\n      }\n',
      '  const writingData = useMemo(() => isWritingStaff(profile)\n    ? writingWorkspaceData({ leads, clients, cases, installments, scheduleItems }, effectiveFirmId)\n    : null, [profile, leads, clients, cases, installments, scheduleItems, effectiveFirmId]);\n\n',
    ];
    for(const addition of writerAdditions){assert.equal(current.split(addition).length,2,'Expected one precise writer addition');current=current.replace(addition,'');}
    for(const [before,after]of [
      ['[canPatchLead, isGlobalSuperAdmin, leads, logChange, saveEntity, profile]','[canPatchLead, isGlobalSuperAdmin, leads, logChange, saveEntity]'],
      ['[can, clients, isGlobalSuperAdmin, leads, logChange, queueWrite, saveEntity, profile]','[can, clients, isGlobalSuperAdmin, leads, logChange, queueWrite, saveEntity]'],
      ['[canPatchCase, cases, isGlobalSuperAdmin, logChange, queueWrite, saveEntity, profile, clients, leads, effectiveFirmId]','[canPatchCase, cases, isGlobalSuperAdmin, logChange, queueWrite, saveEntity]'],
      ['[can, cases, deleteEntity, installments, isGlobalSuperAdmin, logChange, saveEntity, profile, clients, leads, effectiveFirmId]','[can, cases, deleteEntity, installments, isGlobalSuperAdmin, logChange, saveEntity]'],
    ]){assert.equal(current.split(before).length,2,'Expected exact writer hook dependency list');current=current.replace(before,after);}
    for(const [before,after]of [
      ['queueWrite(isWritingStaff(profile)\n          ? saveEntity("app_cases", caseRecord).then(() => saveEntity("app_leads", nextLead))\n          : Promise.all([','queueWrite(Promise.all(['],
      ['        isWritingStaff(profile)\n          ? saveEntity("app_clients", client).then(() => saveEntity("app_cases", caseRecord)).then(() => saveEntity("app_leads", nextLead))\n          : Promise.all([','        Promise.all(['],
    ]){assert.equal(current.split(before).length,2,'Expected exact writer ordered-conversion branch');current=current.replace(before,after);}
    // Manual creation now deliberately assigns the current staff member. Its
    // full UI -> store -> persisted payload is tested in manual-lead-assignment.
    // Retain exact baseline comparison of every other write callback.
    const withoutManualCreator=source=>{
      const start=source.indexOf('  const addLead ='),end=source.indexOf('  const updateClient =',start);
      assert.ok(start>=0&&end>start);
      return source.slice(0,start)+source.slice(end);
    };
    for(const [start,end]of [['  const canPatchLead =','  const fetchEntityTable ='],['  const saveEntity =','  const value = useMemo<AppStoreValue>']]){
      const before=original.slice(original.indexOf(start),original.indexOf(end)),after=current.slice(current.indexOf(start),current.indexOf(end));
      assert.equal(start==='  const saveEntity ='?withoutManualCreator(after):after,start==='  const saveEntity ='?withoutManualCreator(before):before);
    }
  });
  await check('Queue coalesces synchronous table notifications',async()=>{const batches=[];const q=createStoreRefreshQueue(async b=>batches.push([...b.tables].sort()),e=>{throw e;});await Promise.all([q.enqueue({tables:['a']}),q.enqueue({tables:['a','b']})]);assert.deepEqual(batches,[['a','b']]);});
  await check('Queue serializes reads, retains follow-ups, invalidates stale results',async()=>{const gate=deferred(),events=[];let active=0,max=0;const q=createStoreRefreshQueue(async b=>{max=Math.max(max,++active);if(events.length===0){events.push('start');await gate.promise;}events.push(b.isCurrent()?[...b.tables].join():'stale');active--;},e=>{throw e;});const one=q.enqueue({tables:['old']});await delay();q.invalidate();const two=q.enqueue({tables:['new']});gate.resolve();await Promise.all([one,two]);await q.enqueue({tables:['last']});assert.deepEqual(events,['start','stale','new','last']);assert.equal(max,1);});
  await check('Row identity reuse preserves duplicates, order, zero amounts and firm boundaries',()=>{const a={id:'same',_lawFirmId:'one',amount:0},b={id:'same',_lawFirmId:'two',amount:0},c={...a};const result=retainEqual([a,b,c],[{...b},{...a},{...c},{id:'new',amount:10}]);assert.equal(result[0],b);assert.equal(result[1],a);assert.equal(result[2],c);assert.equal(result[3].amount,10);assert.equal(retainEqual([a,b],[{...a},{...b}])[0],a);});
  await mount();
  await check('Initial load keeps all five header domains and defers unused history/posts',()=>{for(const t of ['app_leads','app_clients','app_cases','app_installments','app_schedule_items'])assert.equal(calls(t),1);assert.equal(calls('app_change_logs'),0);assert.equal(calls('app_board_posts'),0);assert.equal(fixture.authCalls,1);assert.equal(store.installments[0].actualPaidAmount,0);assert.equal(store.caseDocuments.K1.one,true);});
  await check('Foreign-firm inserts/updates are filtered before refresh',async()=>{const before=fixture.calls.length;await emit('app_clients','UPDATE',{law_firm_id:'firm-2'});assert.equal(fixture.calls.length,before);});
  await check('One entity event performs only fresh permission checks and affected table query',async()=>{const before=fixture.calls.length,identity=session,oldRows=store.clients,rendered=sessionRenders;await emit('app_clients');assert.deepEqual(fixture.calls.slice(before).map(c=>c.table).sort(),['app_clients','profiles','rpc:is_active_user']);assert.equal(fixture.authCalls,1);assert.equal(store.clients,oldRows);assert.equal(session,identity);assert.equal(sessionRenders,rendered);});
  await check('Changed client updates without replacing unrelated data or Session context',async()=>{const oldLeads=store.leads,identity=session,rendered=sessionRenders;fixture.db.app_clients[0].data.name='Changed';await emit('app_clients');assert.equal(store.clients[0].name,'Changed');assert.equal(store.leads,oldLeads);assert.equal(session,identity);assert.equal(sessionRenders,rendered);});
  await check('DELETE with only primary key re-reads scoped table and removes row',async()=>{fixture.db.app_clients=fixture.db.app_clients.filter(x=>x.id!=='C1');await emit('app_clients','DELETE',{id:'C1'});assert.deepEqual(store.clients,[]);assert.ok(fixture.calls.filter(x=>x.table==='app_clients').every(x=>x.filters.some(([key,value])=>key==='law_firm_id'&&value==='firm-1')));});
  await check('RLS-invisible rows disappear from a fresh table snapshot',async()=>{fixture.hidden.add('K1');await emit('app_cases');assert.deepEqual(store.cases,[]);fixture.hidden.clear();await emit('app_cases');assert.equal(store.cases.length,1);});
  await check('Query error preserves previous data and successful retry clears read error',async()=>{const previous=store.leads;fixture.errors.push('app_leads');await emit('app_leads');assert.equal(store.leads,previous);assert.match(store.syncError,/fixture read failed/);await emit('app_leads');assert.equal(store.syncError,null);});
  await check('First history visit loads only history and preserves child draft/mount',async()=>{const before=fixture.calls.length,authBefore=fixture.authCalls;draft.set('firm-1','unsent');const originalDraft=draft;await navigate('/changes');assert.equal(calls('app_change_logs'),1);assert.equal(fixture.authCalls,authBefore);assert.deepEqual(fixture.calls.slice(before).map(c=>c.table).sort(),['app_change_logs','profiles','rpc:is_active_user']);assert.deepEqual(store.changeLog.map(x=>x.id),['H2','H1']);assert.equal(draft,originalDraft);assert.equal(mounts,1);await navigate('/');await navigate('/changes');assert.equal(calls('app_change_logs'),1);});
  await check('Loaded history remains live after navigation and board uses separate lazy query',async()=>{await navigate('/');fixture.db.app_change_logs[0].data.detail='fresh';await emit('app_change_logs');assert.equal(store.changeLog.find(x=>x.id==='H1').detail,'fresh');await navigate('/board');assert.equal(calls('app_board_posts'),1);assert.equal(store.posts[0].id,'P1');});
  await check('Unchanged lead row references survive another row edit/reorder',async()=>{fixture.db.app_leads.push({id:'L3',law_firm_id:'firm-1',data:{name:'Third',receivedAt:'2026-09-01'}});await emit('app_leads');const unchanged=store.leads.find(x=>x.id==='L1');fixture.db.app_leads.find(x=>x.id==='L3').data.receivedAt='2026-11-01';await emit('app_leads');assert.deepEqual(store.leads.map(x=>x.id),['L3','L1']);assert.equal(store.leads[1],unchanged);});
  await check('Read started before optimistic edit cannot overwrite local draft',async()=>{const hold=fixture.hold('app_leads');fixture.emit('app_leads');await tick();await act(async()=>{await store.updateLead('L1',{name:'Edited during read'});});hold.resolve();await tick();assert.equal(store.leads.find(x=>x.id==='L1').name,'Edited during read');await emit('app_leads');assert.equal(store.leads.find(x=>x.id==='L1').name,'Edited during read');});
  await check('Role/permission changes trigger verified bootstrap and retained RLS scope',async()=>{const before=fixture.authCalls;fixture.db.profiles[0].role='staff';fixture.db.profiles[0].platform_role='staff';fixture.db.profiles[0].permissions={'db.view':false};await emit('profiles','UPDATE',{id:'user-1',law_firm_id:'firm-1'});assert.ok(fixture.authCalls>before);assert.equal(store.isAdmin,false);assert.equal(store.can('db.view'),false);});
  await check('Focus refresh verifies identity without using stale cached permissions',async()=>{const before=fixture.authCalls;await act(async()=>window.emit('focus'));await tick();assert.equal(fixture.authCalls,before+1);});
  await check('Realtime reconnection refreshes identity and all loaded table snapshots',async()=>{const before=fixture.authCalls;await act(async()=>fixture.channels.filter(x=>x.active).forEach(x=>x.status('SUBSCRIBED')));await tick();assert.equal(fixture.authCalls,before+1);});
  await check('Events during a pending read coalesce into one follow-up snapshot',async()=>{const before=calls('app_leads'),hold=fixture.hold('app_leads');fixture.emit('app_leads');await tick();fixture.db.app_leads[0].data.name='Latest';fixture.emit('app_leads');fixture.emit('app_leads');await tick();assert.equal(calls('app_leads'),before+1);hold.resolve();await tick();assert.equal(calls('app_leads'),before+2);assert.equal(store.leads.find(x=>x.id==='L1').name,'Latest');});
  await check('Suspension clears business data and signs out',async()=>{fixture.active=false;await emit('app_leads');assert.equal(fixture.signOuts,1);assert.deepEqual(store.leads,[]);assert.equal(store.profile,null);});
  await unmount();
  await mount(true);
  await check('Global superadmin loads aggregates separately without customer entities or all-firm staff profiles',()=>{assert.deepEqual(store.leads,[]);assert.deepEqual(store.clients,[]);assert.deepEqual(store.cases,[]);assert.deepEqual(store.staffDirectory,[]);assert.ok(!fixture.calls.some(x=>['app_leads','app_clients','app_cases','app_installments','app_schedule_items'].includes(x.table)));assert.ok(fixture.calls.filter(x=>x.table==='profiles').every(x=>x.filters.some(([key,value])=>key==='id'&&value==='user-1')));assert.ok(fixture.channels.filter(x=>x.active).every(x=>x.handlers.every(h=>h.filter.table==='law_firms'||h.filter.table==='profiles'&&h.filter.event==='UPDATE'&&h.filter.filter==='id=eq.user-1')));});
  await check('Repeated platform mount exit while already global is a safe no-op',async()=>{const before=fixture.authCalls,previous=store.leads;await act(async()=>{session.exitSuperAdminFirmScope();session.exitSuperAdminFirmScope();});await tick();assert.equal(store.loading,false);assert.equal(store.leads,previous);assert.equal(fixture.authCalls,before);assert.ok(!JSON.stringify(view.toJSON()).includes('데이터를 불러오는 중'));});
  await check('Scope change drops late old snapshot, retains child state, exposes only new firm',async()=>{const originalDraft=draft;draft.set('firm-1','keep');const hold=fixture.hold('app_leads');fixture.emit('app_leads');await tick();await act(async()=>session.enterSuperAdminFirmScope({id:'firm-2',firmCode:'2222222222',name:'Firm Two',status:'active'}));assert.equal(mounts,1);assert.equal(draft,originalDraft);hold.resolve();await tick();assert.deepEqual(store.leads.map(x=>x.id),['L2']);assert.deepEqual(store.clients.map(x=>x.id),['C2']);assert.equal(draft.get('firm-1'),'keep');assert.equal(mounts,1);});
  await check('Selecting identical firm metadata preserves loaded scope without a spinner',async()=>{const before=fixture.authCalls,previous=store.leads;await act(async()=>session.enterSuperAdminFirmScope({...session.superAdminFirmScope}));await tick();assert.equal(store.loading,false);assert.equal(store.leads,previous);assert.equal(fixture.authCalls,before);assert.equal(mounts,1);});
  await check('Account change invalidates in-flight scope and rejects previous-account rows',async()=>{const hold=fixture.hold('app_clients');fixture.emit('app_clients','UPDATE',{law_firm_id:'firm-2'});await tick();fixture.db.profiles.push({...fixture.db.profiles[0],id:'user-2',role:'staff',platform_role:'staff',law_firm_id:'firm-1'});await act(async()=>fixture.authEvent('SIGNED_IN',{id:'user-2',email:'two@fixture.invalid'}));hold.resolve();await tick();assert.equal(store.profile.id,'user-2');assert.deepEqual(store.clients.map(x=>x.id),['C1']);assert.equal(mounts,1);});
  await unmount();
  await mount(true);
  await check('Failed tenant bootstrap never restores rows from the previous tenant',async()=>{fixture.errors.push('app_leads');const oldDraft=draft;await act(async()=>session.enterSuperAdminFirmScope({id:'firm-2',firmCode:'2222222222',name:'Firm Two',status:'active'}));await tick();assert.deepEqual(store.leads,[]);assert.deepEqual(store.clients,[]);assert.match(store.syncError,/fixture read failed/);assert.equal(draft,oldDraft);assert.equal(mounts,1);await act(async()=>store.reloadData());await tick();assert.deepEqual(store.leads.map(x=>x.id),['L2']);});
  await unmount();
  await mount();
  await check('Failed first lazy history load shows error and next visit retries without remount',async()=>{fixture.errors.push('app_change_logs');const before=calls('app_change_logs');await navigate('/changes');assert.match(store.syncError,/fixture read failed/);assert.equal(mounts,1);assert.ok(!JSON.stringify(view.toJSON()).includes('데이터를 불러오는 중'));await navigate('/');await navigate('/changes');assert.equal(calls('app_change_logs'),before+2);assert.equal(store.changeLog.length,2);});
  await unmount();
  await mount();
  await check('Lazy-load failure queued behind same-scope full refresh cannot leave a permanent spinner',async()=>{const hold=fixture.hold('app_leads');let pending;await act(async()=>{pending=store.reloadData();});await tick();await navigate('/changes');fixture.errors.push('app_change_logs');hold.resolve();await act(async()=>{await pending;});await tick();assert.equal(store.loading,false);assert.match(store.syncError,/fixture read failed app_change_logs/);assert.ok(!JSON.stringify(view.toJSON()).includes('데이터를 불러오는 중'));assert.equal(mounts,1);});
  await unmount();
  await mount(false,'/changes');
  await check('Direct history entry fetches history with initial bootstrap',()=>{assert.equal(calls('app_change_logs'),1);assert.equal(store.changeLog.length,2);assert.equal(calls('app_board_posts'),0);});
  await check('Existing server row cap remains unchanged; no hidden pagination or limit added',async()=>{fixture.rowCap=1;await act(async()=>store.reloadData());await tick();assert.equal(store.changeLog.length,1);assert.equal(store.changeLog[0].id,'H1');});
  await unmount();
  await mount(false,'/',fixture=>fixture.errors.push('firm_settings'));
  await check('Initial settings-only failure still publishes business and staff data',()=>{assert.equal(store.leads[0].id,'L1');assert.equal(store.clients[0].id,'C1');assert.equal(store.cases[0].id,'K1');assert.equal(store.staffDirectory.length,1);assert.deepEqual(store.caseDocuments,{});assert.match(store.syncError,/fixture read failed firm_settings/);assert.equal(mounts,1);});
  await check('Initial settings failure retains scoped subscriptions and recovers on settings event',async()=>{const authBefore=fixture.authCalls;await emit('firm_settings');assert.equal(fixture.authCalls,authBefore);assert.equal(store.caseDocuments.K1.one,true);assert.equal(store.syncError,null);});
  await check('Mixed realtime settings failure applies valid entity changes and preserves existing settings',async()=>{const documents=store.caseDocuments;fixture.db.app_leads[0].data.name='Business refresh succeeded';fixture.errors.push('firm_settings');await act(async()=>{fixture.emit('app_leads');fixture.emit('firm_settings');});await tick();assert.equal(store.leads[0].name,'Business refresh succeeded');assert.equal(store.caseDocuments,documents);assert.match(store.syncError,/fixture read failed firm_settings/);await emit('firm_settings');assert.equal(store.syncError,null);});
  await check('Directory-only failure still applies fresh role and permissions',async()=>{fixture.db.profiles[0].role='staff';fixture.db.profiles[0].platform_role='staff';fixture.db.profiles[0].permissions={'db.view':false};fixture.errors.push('law_firms');await act(async()=>store.reloadData());await tick();assert.equal(store.isAdmin,false);assert.equal(store.can('db.view'),false);assert.match(store.syncError,/fixture read failed law_firms/);});
  await check('Changed profile tenant clears previous tenant data even if directory read fails',async()=>{fixture.db.profiles[0].law_firm_id='firm-2';fixture.errors.push('law_firms');await act(async()=>store.reloadData());await tick();assert.equal(store.profile.lawFirmId,'firm-2');assert.deepEqual(store.leads,[]);assert.deepEqual(store.clients,[]);assert.match(store.syncError,/fixture read failed law_firms/);});
  await unmount();
  await mount(false,'/',fixture=>{fixture.db.profiles[0].is_active=false;});
  await check('Inactive profile retains the original specific error message',()=>{assert.equal(store.syncError,'비활성 계정입니다. 관리자에게 계정 활성화를 요청해주세요.');assert.equal(store.profile,null);assert.deepEqual(store.leads,[]);});
  await unmount();
  for(const route of ['/changes','/board']){
    await mount(true,route,fixture=>{fixture.db.profiles[0].law_firm_id='firm-1';});
    await check(`Global direct ${route} entry with a legacy profile firm does not load private rows or wait forever`,async()=>{
      assert.equal(store.loading,false);assert.equal(store.profile.lawFirmId,'firm-1');assert.equal(session.superAdminFirmScope,null);
      assert.ok(!JSON.stringify(view.toJSON()).includes('데이터를 불러오는 중'));
      for(const rows of [store.leads,store.clients,store.cases,store.installments,store.changeLog,store.posts,store.staffDirectory])assert.deepEqual(rows,[]);
      assert.ok(fixture.calls.every(call=>['profiles','law_firms','rpc:is_active_user'].includes(call.table)));
      const before=fixture.calls.length;await emit('profiles','UPDATE',{id:'other-staff',law_firm_id:'firm-2'});await emit('app_leads','UPDATE',{law_firm_id:'firm-1'});
      assert.equal(fixture.calls.length,before);
      await navigate('/');await navigate(route);assert.ok(!JSON.stringify(view.toJSON()).includes('데이터를 불러오는 중'));
      assert.equal(fixture.calls.length,before);
    });
    await unmount();
  }
  await mount(true,'/',fixture=>{fixture.db.profiles[0].law_firm_id='firm-1';});
  await check('Selected firm wins over a superadmin legacy profile firm for reads and existing-record updates',async()=>{
    assert.deepEqual(store.leads,[]);assert.ok(!fixture.calls.some(call=>call.table.startsWith('app_')));
    const firmOneBefore=JSON.stringify(Object.fromEntries(Object.entries(fixture.db).map(([table,rows])=>[table,rows.filter(row=>row.law_firm_id==='firm-1')])));
    await act(async()=>session.enterSuperAdminFirmScope({id:'firm-2',firmCode:'2222222222',name:'Firm Two',status:'active'}));await tick();
    assert.deepEqual(store.leads.map(row=>row.id),['L2']);assert.deepEqual(store.clients.map(row=>row.id),['C2']);
    assert.equal(store.profile.lawFirmId,'firm-1');const before=fixture.calls.length;
    let saved;await act(async()=>{saved=await store.updateLead('L2',{name:'Selected tenant update'});});await tick();
    assert.equal(saved,true);assert.equal(store.syncError,null);
    const writes=fixture.calls.slice(before).filter(call=>call.table==='app_leads'&&call.operation!=='select');
    assert.equal(writes.length,1);assert.equal(writes[0].operation,'update');
    assert.ok(writes[0].filters.some(([key,value])=>key==='law_firm_id'&&value==='firm-2'));
    assert.equal(fixture.db.app_leads.find(row=>row.id==='L2').law_firm_id,'firm-2');
    assert.equal(fixture.db.app_leads.find(row=>row.id==='L2').data.name,'Selected tenant update');
    assert.equal(firmOneBefore,JSON.stringify(Object.fromEntries(Object.entries(fixture.db).map(([table,rows])=>[table,rows.filter(row=>row.law_firm_id==='firm-1')]))));
    await act(async()=>session.exitSuperAdminFirmScope());await tick();
    assert.deepEqual(store.leads,[]);assert.deepEqual(store.clients,[]);assert.equal(store.profile.lawFirmId,'firm-1');
  });
  await unmount();
  console.log(`PASS ${passed} store checks; actual React renderer, offline Supabase fixture, zero network calls.`);
}
function restoreRuntime(){global.setTimeout=realTimeout;global.fetch=realFetch;Module._load=originalLoad;}
// Reuse this actual-provider fixture for feature tests without rerunning or
// weakening the original performance/equivalence suite above.
module.exports={React,renderer,act,mount,unmount,tick,navigate,emit,restoreRuntime,
  get store(){return store;},get session(){return session;},get fixture(){return fixture;}};
if(require.main===module)runSuite().catch(error=>{console.error(error);process.exitCode=1;}).finally(restoreRuntime);
