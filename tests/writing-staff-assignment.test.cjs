// Actual assignment API + modal against an in-memory, projection-aware client.
// Never contacts Supabase, invokes intake RPCs, or changes operational records.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),runtime=path.resolve(root,'../store-test-runtime/node_modules');
const React=require(path.join(runtime,'react')),Renderer=require(path.join(runtime,'react-test-renderer')),{act}=Renderer;
const clone=value=>JSON.parse(JSON.stringify(value));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?text(node.children):'';
function harness(options={}){
  const base={role:'staff',platform_role:'staff',law_firm_id:'firm-1',is_active:true,is_work_staff:true,auto_assign_leads:true,lead_assignment_order:2,permissions:{}};
  const profiles=[
    {...base,id:'manager',role:'admin',platform_role:'firm_admin',display_name:'관리자',is_work_staff:false,auto_assign_leads:false},
    {...base,id:'writer',display_name:'합성 작성직원',permissions:{'staff.writer':true}},
    {...base,id:'ordinary',display_name:'합성 상담직원'},
    {...base,id:'inactive',display_name:'비활성',is_active:false},
    {...base,id:'nonwork',display_name:'비실무',is_work_staff:false},
    {...base,id:'foreign',display_name:'다른 로펌',law_firm_id:'firm-2'},
  ];
  if(options.exceptions)profiles.push({...base,id:'legacy-admin',display_name:'일반 관리자',role:'admin',permissions:{'staff.writer':true}}, {...base,id:'firm-admin',display_name:'로펌 관리자',platform_role:'firm_admin',permissions:{'staff.writer':true}}, {...base,id:'string-marker',display_name:'문자 마커',permissions:{'staff.writer':'true'}});
  const members=profiles.map((p,i)=>({profileId:p.id,enabled:true,order:i+1,weight:p.id==='writer'?99:3}));
  const stored={version:2,enabled:true,timezone:'Asia/Seoul',members,rules:[{id:'weekend',name:'원본 상세규칙',enabled:true,priority:2,dayType:'weekend',weekdays:[],startTime:'08:00',endTime:'12:00',consultTimeSlots:['주말 오전(8~12시)'],members:clone(members)}]};
  const rows={profiles,law_firms:[{id:'firm-1',name:'합성 로펌',status:'active'},{id:'firm-2',name:'다른 로펌',status:'active'}],firm_runtime_state:[{law_firm_id:'firm-1',key:'lead_auto_assignment_config',value:stored}],app_change_logs:[]};
  const before=clone(rows),reads=[],writes=[],requests=[],cache=new Map();
  const actorId=options.actorId??'manager';
  const admin={auth:{getUser:async()=>({data:{user:{id:actorId}},error:null}),getSession:async()=>({data:{session:{access_token:'synthetic-token'}}})},from(table){
    const filters=[];let projection='*',mutation=null,kind;
    const q={select(value){projection=value;return q;},eq(key,value){filters.push(row=>row[key]===value);return q;},in(key,values){filters.push(row=>values.includes(row[key]));return q;},order(){return q;},
      update(value){kind='update';mutation=value;return q;},upsert(value){kind='upsert';mutation=value;return q;},insert(value){kind='insert';mutation=value;return q;},
      maybeSingle(){return finish(true);},then(a,b){return finish(false).then(a,b);}};
    async function finish(single){
      const matches=(rows[table]??[]).filter(row=>filters.every(filter=>filter(row)));
      if(mutation){
        writes.push({table,kind,value:clone(mutation),ids:matches.map(row=>row.id)});
        if(kind==='update')matches.forEach(row=>Object.assign(row,clone(mutation)));
        else if(kind==='upsert'){const old=(rows[table]??[]).find(row=>row.law_firm_id===mutation.law_firm_id&&row.key===mutation.key);if(old)Object.assign(old,clone(mutation));else(rows[table]??=[]).push(clone(mutation));}
        else(rows[table]??=[]).push(clone(mutation));
        return {data:null,error:null};
      }
      reads.push({table,projection});
      const selected=matches.map(row=>projection==='*'?clone(row):Object.fromEntries(projection.split(',').filter(key=>key in row).map(key=>[key,clone(row[key])])));
      return {data:single?selected[0]??null:selected,error:null};
    }
    return q;
  },rpc(){throw Error('Intake/other RPC forbidden');}};
  const host=tag=>({children,...props})=>React.createElement(tag,props,children);
  const primitives={Button:host('button'),Card:host('section'),Input:host('input'),Select:host('select'),Modal:({open,children})=>open?React.createElement('main',{},children):null};
  function load(relative){
    if(cache.has(relative))return cache.get(relative).exports;
    const module={exports:{}};cache.set(relative,module);
    const source=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const requireFile=name=>{
      if(name==='react'||name.startsWith('react/'))return require(path.join(runtime,name));
      if(name==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
      if(name==='@/lib/supabase/admin')return {createAdminClient:()=>admin};
      if(name==='@/lib/supabase/client')return {createClient:()=>admin};
      if(name==='@/lib/platform/server')return {writePlatformAudit:async()=>writes.push({audit:true})};
      if(name==='@/components/ui/Primitives')return primitives;
      if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
      if(name.startsWith('@/')||name.startsWith('.')){const file=name.startsWith('@/')?name.slice(2):path.posix.join(path.posix.dirname(relative),name);return load(file+(fs.existsSync(path.join(root,file+'.tsx'))?'.tsx':'.ts'));}
      throw Error('Unexpected dependency: '+name);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`,{React,console,Date,Map,Set,URL,Request,Response,crypto:require('node:crypto').webcrypto,
      fetch:async(url,init)=>{
        assert.ok(String(url).startsWith('/api/admin/lead-assignment'));requests.push({url,method:init.method,body:init.body?JSON.parse(init.body):undefined});
        const response=await route[init.method](request(init.method,init.body?JSON.parse(init.body):undefined));
        if(options.staleUi&&init.method==='GET'){const payload=await response.json();payload.config.members.find(row=>row.profileId==='writer').enabled=true;payload.config.rules[0].members.push({profileId:'writer',enabled:true,order:1,weight:99});return Response.json(payload);}
        return response;
      }},{filename:relative})(requireFile,module,module.exports);return module.exports;
  }
  const route=load('app/api/admin/lead-assignment/route.ts');
  function request(method='GET',body,query='?lawFirmId=firm-2'){
    const req=new Request('http://offline.test/api/admin/lead-assignment'+query,{method,headers:{authorization:'Bearer synthetic-token','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});req.nextUrl=new URL(req.url);return req;
  }
  let tree;
  return {rows,before,stored,reads,writes,requests,route,request,load,get tree(){return tree;},
    mount:async()=>{const Component=load('components/staff/LeadAssignmentModal.tsx').LeadAssignmentModal;await act(async()=>{tree=Renderer.create(React.createElement(Component,{open:true,onClose(){},lawFirmId:'firm-1'}));});},
    close:()=>act(()=>tree.unmount()),
  };
}

test('GET excludes existing writer base/rule entries without changing stored settings or profiles',async()=>{
  const h=harness(),response=await h.route.GET(h.request());assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.lawFirm.id,'firm-1');assert.equal(result.config.members.find(row=>row.profileId==='writer').enabled,false);
  assert.equal(result.config.members.find(row=>row.profileId==='writer').weight,99);assert.equal(result.config.members.find(row=>row.profileId==='ordinary').enabled,true);
  assert.deepEqual(result.config.rules[0].members.map(row=>row.profileId),['ordinary']);
  assert.equal(result.staff.find(row=>row.id==='writer').isWritingStaff,true);assert.ok(result.staff.every(row=>!('permissions'in row)&&!('role'in row)));
  assert.ok(!result.staff.some(row=>row.id==='foreign'));assert.equal(h.writes.length,0);assert.deepEqual(h.rows,h.before);
  assert.equal(h.route.dynamic,'force-dynamic');assert.equal(h.route.revalidate,0);assert.equal(h.route.fetchCache,'force-no-store');
});

test('PATCH sanitizes stale or forged writer candidates in every rule while preserving ordinary order/weight',async()=>{
  const h=harness(),config=clone(h.stored);config.rules.push({...clone(config.rules[0]),id:'writer-only',members:[{profileId:'writer',enabled:true,order:4,weight:100}]});
  const response=await h.route.PATCH(h.request('PATCH',{lawFirmId:'firm-2',config}));assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.config.members.find(row=>row.profileId==='writer').enabled,false);assert.deepEqual(result.config.rules[1].members,[]);
  const ordinary=result.config.members.find(row=>row.profileId==='ordinary');assert.deepEqual(ordinary,{profileId:'ordinary',enabled:true,order:3,weight:3});
  assert.equal(h.rows.profiles.find(row=>row.id==='writer').auto_assign_leads,false);assert.equal(h.rows.profiles.find(row=>row.id==='ordinary').auto_assign_leads,true);
  assert.deepEqual(h.rows.profiles.find(row=>row.id==='foreign'),h.before.profiles.find(row=>row.id==='foreign'));
  assert.deepEqual(h.rows.profiles.find(row=>row.id==='writer').permissions,{'staff.writer':true});
  assert.ok(h.writes.filter(row=>row.table).every(row=>['profiles','firm_runtime_state','app_change_logs'].includes(row.table)));
  assert.ok(h.writes.filter(row=>row.table==='firm_runtime_state').every(row=>row.value.law_firm_id==='firm-1'));
});

test('exact writer marker excludes staff only; administrators and ordinary/string-marker staff remain eligible',async()=>{
  const h=harness({exceptions:true}),result=await(await h.route.GET(h.request())).json();
  for(const id of ['legacy-admin','firm-admin','string-marker','ordinary']){
    assert.equal(result.staff.find(row=>row.id===id).isWritingStaff,false,id);assert.equal(result.config.members.find(row=>row.profileId===id).enabled,true,id);
    assert.ok(result.config.rules[0].members.some(row=>row.profileId===id));
  }
  for(const id of ['inactive','nonwork','writer'])assert.equal(result.config.members.find(row=>row.profileId===id).enabled,false,id);
});

test('ordinary and writing staff cannot open or save the administrator assignment endpoint',async()=>{
  for(const actorId of ['writer','ordinary'])for(const method of ['GET','PATCH']){
    const h=harness({actorId}),response=await h.route[method](h.request(method,method==='PATCH'?{config:h.stored}:undefined));
    assert.equal(response.status,403);assert.equal(h.writes.length,0);assert.deepEqual(h.rows,h.before);assert.deepEqual(h.reads.map(row=>row.table),['profiles']);
  }
});

test('actual assignment modal disables writer checkbox, omits detailed candidates and cannot re-enable from a stale response',async()=>{
  const h=harness({staleUi:true});await h.mount();
  try{
    assert.equal(h.requests.length,1);assert.equal(h.writes.length,0);assert.deepEqual(h.rows,h.before);
    const writerLabels=h.tree.root.findAllByType('label').filter(node=>text(node).includes('합성 작성직원'));
    assert.equal(writerLabels.length,1);const checkbox=writerLabels[0].findByType('input');assert.equal(checkbox.props.disabled,true);assert.equal(checkbox.props.checked,false);
    assert.match(text(writerLabels[0]),/작성직원 · 자동배정 제외/);
    await act(async()=>checkbox.props.onChange({target:{checked:true}}));
    const save=h.tree.root.findAllByType('button').find(node=>text(node)==='자동배정 설정 저장');await act(async()=>save.props.onClick());
    const patch=h.requests.find(row=>row.method==='PATCH').body.config;
    assert.equal(patch.members.find(row=>row.profileId==='writer').enabled,false);assert.ok(patch.rules.every(rule=>!rule.members.some(row=>row.profileId==='writer')));
    assert.equal(patch.members.find(row=>row.profileId==='ordinary').enabled,true);assert.match(text(h.tree.toJSON()),/100%/);
  }finally{h.close();}
});

test('new custom rule keeps ordinary candidates and does not add the writer back to its saved members',async()=>{
  const h=harness();await h.mount();
  try{
    await act(async()=>h.tree.root.findAllByType('button').find(node=>text(node).includes('직접 설정')).props.onClick());
    await act(async()=>h.tree.root.findAllByType('button').find(node=>text(node)==='자동배정 설정 저장').props.onClick());
    const config=h.requests.find(row=>row.method==='PATCH').body.config;assert.equal(config.rules.length,2);
    assert.ok(config.rules[1].members.some(row=>row.profileId==='ordinary'));assert.ok(!config.rules[1].members.some(row=>row.profileId==='writer'));
  }finally{h.close();}
});
