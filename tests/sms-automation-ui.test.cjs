const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const ts = require('typescript');
const runtime = path.resolve(__dirname, '../../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react'));
const Renderer = require(path.join(runtime, 'react-test-renderer'));
const {act} = Renderer;
const root = path.resolve(__dirname, '..');
const firm = 'firm-a';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const deferred = () => { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise,resolve}; };
const globalSettings = () => ({new_lead_enabled:false,absence_enabled:false,new_lead_template:'기본 신규',absence_template:'기본 부재',duplicate_guard_minutes:5});
const row = (name='담당자') => ({id:`row-${name}`,law_firm_id:firm,staff_profile_id:name==='담당자'?actor:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',staff_name:name,sender_number_id:'sender-a',new_lead_enabled:false,absence_enabled:false,new_lead_template:`기존 신규 ${name}`,absence_template:`기존 부재 ${name}`,new_lead_image_paths:[],absence_image_paths:[]});
// Mirror Supabase Storage API key validation, not merely storage.objects SQL.
// https://github.com/supabase/storage/blob/master/src/storage/limits.ts
const validStorageKey = key => typeof key === 'string' && /^[A-Za-z0-9_/!.*'() &$=@;:+,?-]+$/.test(key);
const imageFile = (name='안내 사진.jpg') => new File([Buffer.from([255,216,255,0,255,217])],name,{type:'image/jpeg'});
const roles = [
  {name:'permitted staff',profile:{role:'staff',platformRole:'staff'}},
  {name:'scoped super admin',profile:{role:'admin',platformRole:'super_admin',lawFirmId:undefined},superAdminFirmScope:{id:firm}},
];
const ownProfile = {permissions:{'sms.view':true}};
const ownFields = ['absence_enabled','absence_image_paths','absence_template','new_lead_enabled','new_lead_image_paths','new_lead_template'];

function harness(options={}) {
  const modules=new Map(), reads=[],writes=[],uploads=[],snapshots=[],signed=[],rpcCalls=[];
  let tree, readError=options.readError??null, saveError=options.saveError??null, uploadError=options.uploadError??null;
  const db=options.db??{staff:[row(),row('다른담당자')],global:globalSettings()};
  const store={profile:{id:actor,lawFirmId:firm,role:'staff',platformRole:'staff',staffName:'담당자',isActive:true,
    permissions:{'sms.view':true,'sms.send':true,'sms.view_history':true,'sms.manage_settings':true},...options.profile},
    superAdminFirmScope:options.superAdminFirmScope??null,workStaffNames:['담당자','다른담당자'],
    can:permission=>store.profile.isActive&&(store.profile.role==='admin'||store.profile.permissions?.[permission]===true)};
  const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}},error:null})},
    rpc:async(name,args)=>{rpcCalls.push({name,args:structuredClone(args)});return {data:options.identityAllowed??true,error:options.identityError??null};},from(table){
    const filters={}; let payload,operation,selected=false,single=false;
    const query={eq(k,v){filters[k]=v;return query;},order(){return query;},select(){selected=true;return query;},maybeSingle(){single=true;return query;},single(){single=true;return query;},upsert(value){payload=value;operation='upsert';return query;},update(value){payload=value;operation='update';return query;},insert(value){payload=value;operation='insert';return query;},
      then(resolve,reject){return (async()=>{
        if(payload){
          writes.push({table,value:structuredClone(payload),filters:{...filters},selected,single,operation});
          if(options.delaySave)await options.delaySave.promise;
          if(saveError)return {data:null,error:saveError};
          if(table==='sms_staff_automation_settings'){
            const existing=operation==='update'?db.staff.find(r=>Object.entries(filters).every(([key,value])=>r[key]===value)):db.staff.find(r=>r.staff_name===payload.staff_name&&r.law_firm_id===payload.law_firm_id);
            if(operation==='update'&&!existing)return {data:null,error:{message:'No matching row'}};
            if(operation==='insert'&&existing)return {data:null,error:{message:'SMS_AUTOMATION_IDENTITY'}};
            const saved={...existing,...payload,id:existing?.id??`row-${payload.staff_name}`}; db.staff=[...db.staff.filter(r=>r.id!==saved.id),saved];
            if(options.failReadAfterSave)readError={message:'staff read unavailable'};
            return {data:selected?(options.invalidReturned??structuredClone(saved)):null,error:null};
          }
          if(options.globalError)return {data:null,error:options.globalError};
          db.global={...db.global,...payload,law_firm_id:payload.law_firm_id??filters.law_firm_id};return {data:selected?structuredClone(db.global):null,error:null};
        }
        reads.push({table,filters:{...filters}});
        if(options.delayLoad)await options.delayLoad.promise;
        if(table==='sms_sender_numbers')return {data:[{id:'sender-a',staff_name:'담당자',label:'업무',phone:'0211112222',is_active:true,is_registered:true,is_default:true}],error:null};
        if(table==='sms_templates')return {data:options.templates??[],error:null};
        if(table==='sms_automation_settings')return {data:structuredClone(db.global),error:null};
        return {data:readError?null:structuredClone(options.unfilteredStaffRead?db.staff:db.staff.filter(r=>Object.entries(filters).every(([key,value])=>r[key]===value))),error:readError};
      })().then(resolve,reject);}
    }; return query;
  }, storage:{from(bucket){return {
    upload:async(location,file)=>{
      uploads.push({bucket,location,file});
      if(options.delayUpload)await options.delayUpload.promise;
      return {error:!validStorageKey(location)?{code:'InvalidKey',message:`Invalid key: ${location}`,status:400}:uploadError};
    },
    createSignedUrl:async(path)=>{
      signed.push(path);
      const error=options.signedError??(!validStorageKey(path)?{code:'InvalidKey',message:`Invalid key: ${path}`,status:400}:null);
      return {data:error?null:{signedUrl:`https://synthetic.invalid/${path}`},error};
    },
  };}}};
  function load(relative){
    if(modules.has(relative))return modules.get(relative);
    const baseline=options.deployedBaseline?'f12a644596285e476886ec72b6c9813d05b88250':options.baseline?'db8f0b74d3de411103715767ec337363d3927d56':null;
    const source=baseline&&relative==='components/sms/SmsCenter.tsx'?execFileSync('git',['show',baseline+':'+relative],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,relative),'utf8');
    const code=ts.transpileModule(source,{fileName:relative,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
    const module={exports:{}};
    const mocks={react:React,'@/lib/store':{useStoreSession:()=>store},'@/lib/supabase/client':{createClient:()=>client},'@/components/sms/DeliveryControls':{default:()=>null},'@/components/sms/AutomationImagePicker':{default:()=>null},'@/components/ui/DateInput':{DateTimeInput:()=>null},'lucide-react':new Proxy({},{get:()=>()=>null})};
    const requireMock=name=>options.realPicker&&name==='@/components/sms/AutomationImagePicker'?load('components/sms/AutomationImagePicker.tsx'):name in mocks?mocks[name]:name.startsWith('@/lib/sms/')?load(name.slice(2)+'.ts'):(()=>{throw Error('Unmocked import '+name);})();
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`,{React,Error,URL,Date,Map,Math,AbortController,Headers,crypto:require('node:crypto').webcrypto,fetch:async()=>new Response(JSON.stringify({error:'Synthetic gate off'}),{status:503}),confirm:()=>true,console},{filename:relative})(requireMock,module,module.exports);
    modules.set(relative,module.exports);return module.exports;
  }
  const Component=load('components/sms/SmsCenter.tsx').default;
  const render=()=>React.createElement(Component,{contextKey:'test',draftCache:options.cache});
  const button=part=>tree.root.findAllByType('button').find(n=>text(n).includes(part));
  const get=label=>tree.root.findByProps({'aria-label':label});
  const flush=async()=>act(async()=>{await new Promise(setImmediate);});
  return {db,store,reads,writes,uploads,signed,snapshots,rpcCalls,get tree(){return tree;},button,get,
    setReadError:e=>{readError=e;},setSaveError:e=>{saveError=e;},setUploadError:e=>{uploadError=e;},
    picker:label=>tree.root.findByProps({label}),
    async mount(){await act(async()=>{tree=Renderer.create(render());});await flush();},
    async tab(label){act(()=>button(label).props.onClick());await flush();},
    async edit(label,value){act(()=>get(label).props.onChange({target:{value,checked:value}}));await flush();},
    async choose(label,files){await act(async()=>get(`${label} 파일 선택`).props.onChange({target:{files,value:'fake-path'}}));await flush();},
    async save(){act(()=>button('자동발송 설정 저장').props.onClick());await flush();},
    async refresh(){act(()=>tree.update(render()));await flush();},flush,
    unmount(){act(()=>tree.unmount());},
  };
}

test('baseline reproduces a saved form reset when the broad post-save staff read fails',async()=>{
  const h=harness({baseline:true,failReadAfterSave:true});await h.mount();await h.tab('자동발송');
  const textarea=h.tree.root.findAllByType('textarea')[0],toggle=h.tree.root.findAllByType('input').find(n=>n.props.type==='checkbox');
  // Actual capture handler protects edits in the old component.
  act(()=>h.tree.root.find(n=>!!n.props.onChangeCapture).props.onChangeCapture());
  act(()=>textarea.props.onChange({target:{value:'작성한 신규 문구'}}));act(()=>toggle.props.onChange({target:{checked:true}}));
  await h.save();await h.flush();
  assert.equal(h.db.staff.find(r=>r.staff_name==='담당자').new_lead_template,'작성한 신규 문구');
  assert.equal(h.tree.root.findAllByType('textarea')[0].props.value,'기존 신규 담당자','old cached row silently replaces the acknowledged database write');
  assert.equal(h.tree.root.findAllByType('input').find(n=>n.props.type==='checkbox').props.checked,false);
  h.unmount();
});

test('confirmed save keeps custom text and false/true flags, then survives a fresh remount',async()=>{
  const h=harness({failReadAfterSave:true});await h.mount();await h.tab('자동발송');
  await h.edit('신규 DB 자동발송 문구','직접 작성한 신규 문구');await h.edit('신규 DB 자동발송 사용',true);
  await h.edit('부재중 자동발송 문구','직접 작성한 부재 문구');await h.edit('부재중 자동발송 사용',false);
  await h.save();
  assert.equal(h.get('신규 DB 자동발송 문구').props.value,'직접 작성한 신규 문구');assert.equal(h.get('신규 DB 자동발송 사용').props.checked,true);
  assert.equal(h.get('부재중 자동발송 사용').props.checked,false);assert.match(text(h.tree.toJSON()),/설정을 저장했습니다/);
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].table,'sms_staff_automation_settings');assert.equal(h.writes[0].selected,true);assert.equal(h.writes[0].single,true);
  assert.equal(h.writes[0].value.law_firm_id,firm);h.unmount();
  const reopened=harness({db:h.db});await reopened.mount();await reopened.tab('자동발송');
  assert.equal(reopened.get('신규 DB 자동발송 문구').props.value,'직접 작성한 신규 문구');assert.equal(reopened.get('신규 DB 자동발송 사용').props.checked,true);assert.equal(reopened.get('부재중 자동발송 문구').props.value,'직접 작성한 부재 문구');reopened.unmount();
});

test('failed and unconfirmed saves preserve inputs and never announce success',async()=>{
  for(const options of [{saveError:{message:'permission denied'}},{invalidReturned:{}},{invalidReturned:{...row(),law_firm_id:'firm-b'}}]){
    const h=harness(options);await h.mount();await h.tab('자동발송');await h.edit('신규 DB 자동발송 문구','실패해도 보존');await h.edit('신규 DB 자동발송 사용',true);await h.save();
    assert.equal(h.get('신규 DB 자동발송 문구').props.value,'실패해도 보존');assert.equal(h.get('신규 DB 자동발송 사용').props.checked,true);
    assert.match(text(h.tree.toJSON()),/작성한 내용은 유지/);assert.doesNotMatch(text(h.tree.toJSON()),/설정을 저장했습니다/);h.unmount();
  }
});

test('loading/error blocks writes; retry hydrates the real settings instead of defaults',async()=>{
  const pending=deferred();const h=harness({delayLoad:pending});await h.mount();await h.tab('자동발송');
  assert.equal(h.button('자동발송 설정 저장').props.disabled,true);await h.save();assert.equal(h.writes.length,0);
  await act(async()=>{pending.resolve();await pending.promise;});await h.flush();h.unmount();
  const failed=harness({readError:{message:'missing permission'}});await failed.mount();await failed.tab('자동발송');
  assert.match(text(failed.tree.toJSON()),/missing permission/);assert.equal(failed.button('자동발송 설정 저장').props.disabled,true);await failed.save();assert.equal(failed.writes.length,0);
  failed.setReadError(null);act(()=>failed.button('설정 다시 불러오기').props.onClick());await failed.flush();
  assert.equal(failed.get('신규 DB 자동발송 문구').props.value,'기존 신규 담당자');assert.equal(failed.button('자동발송 설정 저장').props.disabled,false);failed.unmount();
});

test('repeated save clicks write once and disable staff switching until settled',async()=>{
  const pending=deferred(),h=harness({delaySave:pending});await h.mount();await h.tab('자동발송');await h.edit('신규 DB 자동발송 문구','한 번만 저장');
  const save=h.button('자동발송 설정 저장').props.onClick;act(()=>{save();save();});await h.flush();
  assert.equal(h.writes.length,1);assert.equal(h.button('저장 중...').props.disabled,true);
  assert.equal(h.tree.root.findAllByType('fieldset').some(n=>n.props.disabled),true);
  await h.edit('설정할 영업자','다른담당자');assert.equal(h.get('설정할 영업자').props.value,'담당자');
  await act(async()=>{pending.resolve();await pending.promise;});await h.flush();assert.match(text(h.tree.toJSON()),/설정을 저장했습니다/);h.unmount();
});

test('staff switching keeps each unsaved draft and saves only the selected staff',async()=>{
  const h=harness();await h.mount();await h.tab('자동발송');await h.edit('신규 DB 자동발송 문구','첫째 임시');await h.edit('신규 DB 자동발송 사용',true);
  await h.edit('설정할 영업자','다른담당자');assert.equal(h.get('신규 DB 자동발송 문구').props.value,'기존 신규 다른담당자');await h.edit('신규 DB 자동발송 문구','둘째 임시');
  await h.edit('설정할 영업자','담당자');assert.equal(h.get('신규 DB 자동발송 문구').props.value,'첫째 임시');assert.equal(h.get('신규 DB 자동발송 사용').props.checked,true);await h.save();
  assert.equal(h.writes[0].value.staff_name,'담당자');assert.equal(h.db.staff.find(r=>r.staff_name==='다른담당자').new_lead_template,'기존 신규 다른담당자');h.unmount();
});

test('changed firm and revoked permission cannot receive a late save or issue a new write',async()=>{
  const pending=deferred(),h=harness({delaySave:pending});await h.mount();await h.tab('자동발송');await h.edit('신규 DB 자동발송 문구','이전 로펌');await h.save();
  h.store.profile={...h.store.profile,lawFirmId:'firm-b'};await h.refresh();await act(async()=>{pending.resolve();await pending.promise;});await h.flush();
  assert.equal(h.writes.length,1);assert.doesNotMatch(text(h.tree.toJSON()),/설정을 저장했습니다/);h.unmount();
  const denied=harness();await denied.mount();await denied.tab('자동발송');const save=denied.button('자동발송 설정 저장').props.onClick;
  denied.store.can=()=>false;await denied.refresh();act(()=>save());await denied.flush();assert.equal(denied.writes.length,0);denied.unmount();
});

test('common duplicate guard is only written when changed and never overwrites global templates/flags',async()=>{
  const h=harness();await h.mount();await h.tab('자동발송');await h.edit('부재중 중복발송 방지 시간','12');await h.save();
  assert.equal(h.writes.length,2);const global=h.writes.find(w=>w.table==='sms_automation_settings').value;
  assert.equal(global.duplicate_guard_minutes,12);assert.equal(global.new_lead_enabled,undefined);assert.equal(global.new_lead_template,undefined);assert.equal(h.db.global.new_lead_template,'기본 신규');assert.equal(h.db.global.new_lead_enabled,false);h.unmount();
  const partial=harness({globalError:{message:'guard save failed'}});await partial.mount();await partial.tab('자동발송');await partial.edit('신규 DB 자동발송 문구','문구 저장됨');await partial.edit('부재중 중복발송 방지 시간','15');await partial.save();
  assert.match(text(partial.tree.toJSON()),/담당자 문구·체크 상태·이미지는 저장되었지만/);assert.equal(partial.get('신규 DB 자동발송 문구').props.value,'문구 저장됨');assert.equal(partial.get('부재중 중복발송 방지 시간').props.value,15);assert.doesNotMatch(text(partial.tree.toJSON()),/설정을 저장했습니다/);partial.unmount();
});

test('boxed template list has keyboard-native toggles and labelled collapsible panels',async()=>{
  const h=harness({templates:[{id:'t1',name:'첫 안내',category:'상담',body:'첫 내용'},{id:'t2',name:'둘째 안내',category:'일반',body:'둘째 내용'}]});await h.mount();await h.tab('발신번호 · 문구');
  const first=h.button('첫 안내'),second=h.button('둘째 안내');assert.equal(first.props.type,'button');assert.equal(first.props['aria-expanded'],false);
  let panel=h.tree.root.findByProps({id:first.props['aria-controls']});assert.equal(panel.props.hidden,true);assert.equal(panel.props['aria-labelledby'],first.props.id);
  act(()=>first.props.onClick());assert.equal(h.button('첫 안내').props['aria-expanded'],true);assert.equal(h.tree.root.findByProps({id:panel.props.id}).props.hidden,false);
  act(()=>second.props.onClick());assert.equal(h.button('첫 안내').props['aria-expanded'],false);assert.equal(h.button('둘째 안내').props['aria-expanded'],true);
  act(()=>h.button('둘째 안내').props.onClick());assert.equal(h.button('둘째 안내').props['aria-expanded'],false);assert.equal(h.writes.length,0);h.unmount();
});


test('image validation synchronously blocks Save, then acknowledged attachments persist across reload',async()=>{
  const h=harness();await h.mount();await h.tab('자동발송');
  const picker=()=>h.picker('신규 DB 자동발송 이미지');
  const save=h.button('자동발송 설정 저장').props.onClick;
  act(()=>{picker().props.onValidationChange(true);save();});await h.flush();
  assert.equal(h.writes.length,0);assert.equal(h.uploads.length,0);assert.equal(h.button('자동발송 설정 저장').props.disabled,true);
  assert.match(text(h.tree.toJSON()),/이미지.*확인/);
  const file=new File([Buffer.from([255,216,255,0,255,217])],'image.jpg',{type:'image/jpeg'});
  act(()=>{picker().props.onFilesChange([file]);picker().props.onValidationChange(false);});await h.flush();await h.save();
  assert.equal(h.uploads.length,1);assert.equal(h.writes.length,1);const saved=h.db.staff.find(r=>r.staff_name==='담당자');
  assert.equal(saved.new_lead_image_paths.length,1);assert.match(saved.new_lead_image_paths[0],/^firm-a\/auto\/new-lead\/[a-f0-9-]+-image.jpg$/);
  assert.equal(picker().props.files.length,0);assert.deepEqual([...picker().props.savedPaths],[...saved.new_lead_image_paths]);h.unmount();
  const fresh=harness({db:h.db});await fresh.mount();await fresh.tab('자동발송');assert.deepEqual([...fresh.picker('신규 DB 자동발송 이미지').props.savedPaths],[...saved.new_lead_image_paths]);fresh.unmount();
});

test('failed save retains selected images and retries without uploading the same bytes twice',async()=>{
  const h=harness({saveError:{message:'offline'}});await h.mount();await h.tab('자동발송');
  const picker=()=>h.picker('신규 DB 자동발송 이미지');
  const file=new File([Buffer.from([255,216,255,0,255,217])],'again.jpg',{type:'image/jpeg'});
  act(()=>picker().props.onFilesChange([file]));await h.flush();await h.save();assert.equal(h.uploads.length,1);assert.equal(picker().props.files.length,1);assert.doesNotMatch(text(h.tree.toJSON()),/설정을 저장했습니다/);
  h.setSaveError(null);await h.save();assert.equal(h.uploads.length,1);assert.equal(picker().props.files.length,0);assert.equal(picker().props.savedPaths.length,1);
  act(()=>picker().props.onSavedPathsChange([]));await h.flush();await h.save();assert.equal(h.db.staff.find(r=>r.staff_name==='담당자').new_lead_image_paths.length,0);h.unmount();
});

test('new global guard row is created disabled rather than enabling defaults',async()=>{
  const h=harness({db:{staff:[row()],global:null}});await h.mount();await h.tab('자동발송');await h.edit('부재중 중복발송 방지 시간','10');await h.save();
  assert.equal(h.db.global.duplicate_guard_minutes,10);assert.equal(h.db.global.new_lead_enabled,false);assert.equal(h.db.global.absence_enabled,false);h.unmount();
});


test('one legacy attachment cannot block other staff; unsafe previews are refused and the attachment can be removed',async()=>{
  const invalid=`${firm}/auto/다른담당자/new-lead/original-photo`;
  const h=harness({db:{staff:[row(),{...row('다른담당자'),new_lead_image_paths:[invalid]}],global:globalSettings()}});
  await h.mount();await h.tab('자동발송');assert.equal(h.button('자동발송 설정 저장').props.disabled,false);
  await h.edit('신규 DB 자동발송 문구','다른 영업자 이미지와 무관하게 저장');await h.save();assert.equal(h.writes.length,1);
  await h.edit('설정할 영업자','다른담당자');const picker=()=>h.picker('신규 DB 자동발송 이미지');
  assert.equal(picker().props.savedPaths[0],invalid);assert.equal(await picker().props.resolveSavedUrl(invalid),null);assert.equal(h.signed.length,0);
  await h.save();assert.equal(h.writes.length,1);assert.match(text(h.tree.toJSON()),/해당 이미지를 제거하거나/);
  act(()=>picker().props.onSavedPathsChange([]));await h.flush();await h.save();assert.equal(h.writes.length,2);
  assert.equal(h.db.staff.find(r=>r.staff_name==='다른담당자').new_lead_image_paths.length,0);h.unmount();
});

test('deployed f12a reproduces InvalidKey for Korean staff names before the settings write, for either role',async t=>{
  for(const role of roles)await t.test(role.name,async()=>{
    const h=harness({...role,deployedBaseline:true,realPicker:true});await h.mount();await h.tab('자동발송');
    await h.edit('신규 DB 자동발송 문구','이미지와 함께 보존할 문구');
    const file=imageFile();await h.choose('신규 DB 자동발송 이미지',[file]);await h.save();
    assert.equal(h.uploads.length,1);assert.match(h.uploads[0].location,/\/담당자\//);assert.equal(validStorageKey(h.uploads[0].location),false);
    assert.equal(h.writes.length,0);assert.equal(h.db.staff[0].new_lead_template,'기존 신규 담당자');
    assert.equal(h.get('신규 DB 자동발송 문구').props.value,'이미지와 함께 보존할 문구');assert.equal(h.picker('신규 DB 자동발송 이미지').props.files[0],file);
    assert.match(text(h.tree.toJSON()),/Invalid key/);assert.doesNotMatch(text(h.tree.toJSON()),/설정을 저장했습니다/);h.unmount();
  });
});

test('permitted staff and scoped super admin save both real image pickers with ASCII keys and reload exact text, flags and previews',async t=>{
  for(const role of roles)await t.test(role.name,async()=>{
    const h=harness({...role,realPicker:true});await h.mount();await h.tab('자동발송');
    const otherBefore=structuredClone(h.db.staff.find(r=>r.staff_name==='다른담당자'));
    await h.edit('신규 DB 자동발송 문구','  한글 접수 문구\n{고객명}님  ');await h.edit('신규 DB 자동발송 사용',true);
    await h.edit('부재중 자동발송 문구','  부재 문구\n{담당자}  ');await h.edit('부재중 자동발송 사용',false);
    const file=imageFile('한글 🖼️ 사진.JPG');await h.choose('신규 DB 자동발송 이미지',[file]);await h.choose('부재중 자동발송 이미지',[file]);
    assert.equal(h.uploads.length,0,'choosing files remains local until Save');await h.save();await h.flush();
    assert.equal(h.uploads.length,2);assert.equal(h.writes.length,1);assert.ok(h.uploads.every(u=>u.bucket==='sms-media'&&validStorageKey(u.location)));
    assert.ok(h.uploads.every(u=>!u.location.includes('담당자')));assert.notEqual(h.uploads[0].location,h.uploads[1].location);
    const saved=structuredClone(h.db.staff.find(r=>r.staff_name==='담당자'));
    assert.equal(saved.staff_name,'담당자');assert.equal(saved.sender_number_id,'sender-a');
    assert.equal(saved.new_lead_template,'  한글 접수 문구\n{고객명}님  ');assert.equal(saved.absence_template,'  부재 문구\n{담당자}  ');
    assert.equal(saved.new_lead_enabled,true);assert.equal(saved.absence_enabled,false);
    assert.match(saved.new_lead_image_paths[0],/^firm-a\/auto\/new-lead\/[a-f0-9-]+-[A-Za-z0-9._-]+\.JPG$/);
    assert.match(saved.absence_image_paths[0],/^firm-a\/auto\/absence\/[a-f0-9-]+-[A-Za-z0-9._-]+\.JPG$/);
    assert.deepEqual(h.db.staff.find(r=>r.staff_name==='다른담당자'),otherBefore);
    assert.equal(h.picker('신규 DB 자동발송 이미지').props.files.length,0);assert.equal(h.picker('부재중 자동발송 이미지').props.files.length,0);
    assert.match(text(h.tree.toJSON()),/설정을 저장했습니다/);h.unmount();
    const fresh=harness({...role,realPicker:true,db:h.db});await fresh.mount();await fresh.tab('자동발송');await fresh.flush();
    assert.equal(fresh.get('신규 DB 자동발송 문구').props.value,saved.new_lead_template);assert.equal(fresh.get('부재중 자동발송 문구').props.value,saved.absence_template);
    assert.equal(fresh.get('신규 DB 자동발송 사용').props.checked,true);assert.equal(fresh.get('부재중 자동발송 사용').props.checked,false);
    assert.deepEqual([...fresh.picker('신규 DB 자동발송 이미지').props.savedPaths],saved.new_lead_image_paths);
    assert.deepEqual([...fresh.picker('부재중 자동발송 이미지').props.savedPaths],saved.absence_image_paths);
    assert.deepEqual([...fresh.signed].sort(),[...saved.new_lead_image_paths,...saved.absence_image_paths].sort());
    assert.equal(fresh.tree.root.findAllByType('img').length,2);assert.equal(fresh.writes.length,0);assert.equal(fresh.uploads.length,0);fresh.unmount();
  });
});

test('staff without SMS view permission cannot open or save automation, including a stale image-save callback after revocation',async()=>{
  const permissions={};
  const denied=harness({profile:{permissions}}),before=structuredClone(denied.db);await denied.mount();
  assert.equal(denied.button('자동발송'),undefined);assert.equal(denied.button('발신번호 · 문구'),undefined);
  assert.equal(denied.writes.length,0);assert.equal(denied.uploads.length,0);assert.deepEqual(denied.db,before);denied.unmount();
  const h=harness({realPicker:true});await h.mount();await h.tab('자동발송');await h.edit('신규 DB 자동발송 문구','권한 철회 전 작성');
  await h.choose('신규 DB 자동발송 이미지',[imageFile()]);const save=h.button('자동발송 설정 저장').props.onClick;
  h.store.profile={...h.store.profile,permissions};await h.refresh();act(()=>save());await h.flush();
  assert.equal(h.writes.length,0);assert.equal(h.uploads.length,0);assert.equal(h.signed.length,0);assert.deepEqual(h.db,before);h.unmount();
});

test('Storage upload failure preserves real-picker files, both texts and flags until a successful retry',async()=>{
  const h=harness({realPicker:true,uploadError:{message:'new row violates row-level security policy',status:403}}),before=structuredClone(h.db);
  await h.mount();await h.tab('자동발송');await h.edit('신규 DB 자동발송 문구','접수 임시 문구');await h.edit('신규 DB 자동발송 사용',true);
  await h.edit('부재중 자동발송 문구','부재 임시 문구');await h.edit('부재중 자동발송 사용',true);
  const newFile=imageFile('접수.jpg'),absenceFile=imageFile('부재.jpg');await h.choose('신규 DB 자동발송 이미지',[newFile]);await h.choose('부재중 자동발송 이미지',[absenceFile]);await h.save();
  assert.equal(h.writes.length,0);assert.deepEqual(h.db,before);assert.equal(h.picker('신규 DB 자동발송 이미지').props.files[0],newFile);assert.equal(h.picker('부재중 자동발송 이미지').props.files[0],absenceFile);
  assert.equal(h.get('신규 DB 자동발송 문구').props.value,'접수 임시 문구');assert.equal(h.get('부재중 자동발송 문구').props.value,'부재 임시 문구');
  assert.equal(h.get('신규 DB 자동발송 사용').props.checked,true);assert.equal(h.get('부재중 자동발송 사용').props.checked,true);
  assert.match(text(h.tree.toJSON()),/row-level security/);assert.doesNotMatch(text(h.tree.toJSON()),/설정을 저장했습니다/);
  h.setUploadError(null);await h.save();assert.equal(h.writes.length,1);assert.equal(h.db.staff[0].staff_name,'다른담당자');
  assert.equal(h.db.staff.find(r=>r.staff_name==='담당자').new_lead_image_paths.length,1);assert.equal(h.db.staff.find(r=>r.staff_name==='담당자').absence_image_paths.length,1);
  assert.match(text(h.tree.toJSON()),/설정을 저장했습니다/);h.unmount();
});

test('failed signing or image rendering cannot clear persisted attachment paths or turn a preview failure into a save failure',async()=>{
  const path=`${firm}/auto/new-lead/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-image.jpg`;
  const db={staff:[{...row(),new_lead_image_paths:[path]}],global:globalSettings()};
  const h=harness({realPicker:true,db,signedError:{message:'signed URL temporarily unavailable'}});await h.mount();await h.tab('자동발송');await h.flush();
  assert.deepEqual([...h.picker('신규 DB 자동발송 이미지').props.savedPaths],[path]);assert.match(text(h.tree.toJSON()),/저장됨/);assert.match(text(h.tree.toJSON()),/미리보기 없음/);
  assert.equal(h.tree.root.findAllByType('img').length,0);assert.equal(h.writes.length,0);await h.edit('신규 DB 자동발송 문구','이미지 그대로 문구 변경');await h.save();
  assert.deepEqual(h.db.staff[0].new_lead_image_paths,[path]);assert.match(text(h.tree.toJSON()),/설정을 저장했습니다/);h.unmount();
  const fresh=harness({realPicker:true,db});await fresh.mount();await fresh.tab('자동발송');await fresh.flush();
  assert.equal(fresh.tree.root.findAllByType('img').length,1);act(()=>fresh.tree.root.findByType('img').props.onError());await fresh.flush();
  assert.match(text(fresh.tree.toJSON()),/미리보기 없음/);assert.match(text(fresh.tree.toJSON()),/저장됨/);
  assert.deepEqual([...fresh.picker('신규 DB 자동발송 이미지').props.savedPaths],[path]);assert.deepEqual(db.staff[0].new_lead_image_paths,[path]);assert.equal(fresh.writes.length,0);fresh.unmount();
});

test('existing staff-name paths remain unchanged and per-staff upload retries cannot reuse another staff image key',async()=>{
  const legacy=`${firm}/auto/기존 담당자/new-lead/legacy.jpg`,db={staff:[{...row(),new_lead_image_paths:[legacy]},row('다른담당자')],global:globalSettings()};
  const h=harness({realPicker:true,db});await h.mount();await h.tab('자동발송');await h.edit('신규 DB 자동발송 문구','기존 첨부 유지');await h.save();
  assert.deepEqual(h.db.staff.find(r=>r.staff_name==='담당자').new_lead_image_paths,[legacy]);assert.equal(h.uploads.length,0);
  const sameFile=imageFile();await h.choose('신규 DB 자동발송 이미지',[sameFile]);await h.save();
  const firstPath=h.db.staff.find(r=>r.staff_name==='담당자').new_lead_image_paths[0];
  await h.edit('설정할 영업자','다른담당자');await h.choose('신규 DB 자동발송 이미지',[sameFile]);await h.save();
  const secondPath=h.db.staff.find(r=>r.staff_name==='다른담당자').new_lead_image_paths[0];
  assert.equal(h.uploads.length,2);assert.notEqual(firstPath,secondPath);assert.ok(validStorageKey(firstPath)&&validStorageKey(secondPath));
  assert.equal(h.db.staff.find(r=>r.staff_name==='담당자').new_lead_template,'기존 첨부 유지');h.unmount();
});

test('SMS-view-only staff reads only the bound own row and sees no other staff or management controls',async()=>{
  const h=harness({profile:ownProfile,realPicker:true});await h.mount();await h.tab('내 자동발송');
  assert.deepEqual(h.rpcCalls,[{name:'sms_is_own_automation',args:{p_firm_id:firm,p_profile_id:actor,p_staff_name:'담당자'}}]);
  assert.deepEqual(h.reads,[{table:'sms_staff_automation_settings',filters:{law_firm_id:firm,staff_profile_id:actor}}]);
  assert.equal(h.get('설정할 영업자').props.disabled,true);assert.equal(h.get('설정할 영업자').props.value,'담당자');
  assert.deepEqual(h.get('설정할 영업자').findAllByType('option').map(o=>o.props.value),['담당자']);
  await h.edit('설정할 영업자','다른담당자');assert.equal(h.get('설정할 영업자').props.value,'담당자');
  assert.equal(h.button('발신번호 · 문구'),undefined);assert.doesNotMatch(text(h.tree.toJSON()),/다른담당자|자동발송 발신번호|중복발송 방지|저장 문구 불러오기/);
  assert.equal(h.tree.root.findAllByType('select').length,1);assert.equal(h.writes.length,0);assert.equal(h.uploads.length,0);h.unmount();
});

test('SMS-view-only owner updates exactly six fields, retaining sender/identity and saving uppercase-named images in its own namespace',async()=>{
  const h=harness({profile:ownProfile,realPicker:true}),before=structuredClone(h.db);await h.mount();await h.tab('내 자동발송');
  await h.edit('신규 DB 자동발송 문구','내 접수 문구');await h.edit('신규 DB 자동발송 사용',true);
  await h.edit('부재중 자동발송 문구','내 부재 문구');await h.edit('부재중 자동발송 사용',false);
  await h.choose('신규 DB 자동발송 이미지',[imageFile('한글 사진.JPG')]);await h.choose('부재중 자동발송 이미지',[imageFile('부재 사진.JPEG')]);await h.save();
  assert.equal(h.writes.length,1);const write=h.writes[0];assert.equal(write.operation,'update');assert.deepEqual(Object.keys(write.value).sort(),ownFields);
  assert.deepEqual(write.filters,{id:'row-담당자',law_firm_id:firm,staff_profile_id:actor});
  const saved=h.db.staff.find(r=>r.staff_profile_id===actor);assert.equal(saved.staff_name,'담당자');assert.equal(saved.sender_number_id,'sender-a');
  assert.equal(saved.new_lead_template,'내 접수 문구');assert.equal(saved.absence_template,'내 부재 문구');assert.equal(saved.new_lead_enabled,true);assert.equal(saved.absence_enabled,false);
  assert.equal(h.uploads.length,2);assert.ok(h.uploads.every(u=>u.location.startsWith(`${firm}/auto-own/${actor}/`)&&validStorageKey(u.location)));
  assert.match(saved.new_lead_image_paths[0],/\/new-lead\/[a-f0-9-]+-[A-Za-z0-9._-]+\.JPG$/);assert.match(saved.absence_image_paths[0],/\/absence\/[a-f0-9-]+-[A-Za-z0-9._-]+\.JPEG$/);
  assert.deepEqual(h.db.staff.find(r=>r.staff_name==='다른담당자'),before.staff[1]);assert.deepEqual(h.db.global,before.global);assert.match(text(h.tree.toJSON()),/설정을 저장했습니다/);h.unmount();
  const fresh=harness({profile:ownProfile,realPicker:true,db:h.db});await fresh.mount();await fresh.tab('내 자동발송');await fresh.flush();
  assert.equal(fresh.get('신규 DB 자동발송 문구').props.value,'내 접수 문구');assert.equal(fresh.get('부재중 자동발송 문구').props.value,'내 부재 문구');
  assert.equal(fresh.tree.root.findAllByType('img').length,2);assert.deepEqual(fresh.db.staff.find(r=>r.staff_profile_id===actor),saved);assert.equal(fresh.writes.length,0);fresh.unmount();
});

test('first own settings start disabled, never inherit global enable flags, and insert explicit identity without audit writes',async()=>{
  const global={...globalSettings(),new_lead_enabled:true,absence_enabled:true},h=harness({profile:ownProfile,db:{staff:[row('다른담당자')],global}});
  await h.mount();await h.tab('내 자동발송');assert.equal(h.get('신규 DB 자동발송 사용').props.checked,false);assert.equal(h.get('부재중 자동발송 사용').props.checked,false);
  await h.edit('신규 DB 자동발송 문구','처음 작성한 나의 문구');await h.save();assert.equal(h.writes.length,1);const write=h.writes[0];
  assert.equal(write.operation,'insert');assert.deepEqual(Object.keys(write.value).sort(),[...ownFields,'law_firm_id','sender_number_id','staff_name','staff_profile_id'].sort());
  assert.equal(write.value.staff_profile_id,actor);assert.equal(write.value.staff_name,'담당자');assert.equal(write.value.law_firm_id,firm);assert.equal(write.value.sender_number_id,null);
  assert.equal(write.value.new_lead_enabled,false);assert.equal(write.value.absence_enabled,false);assert.deepEqual(h.db.global,global);
  assert.equal(h.reads.some(r=>r.table==='sms_automation_settings'),false);assert.match(text(h.tree.toJSON()),/설정을 저장했습니다/);
  await h.edit('부재중 자동발송 문구','다음 수정');await h.save();assert.equal(h.writes[1].operation,'update');assert.deepEqual(Object.keys(h.writes[1].value).sort(),ownFields);h.unmount();
});

test('missing, renamed, duplicate or untrusted own identity fails closed before any upload or settings write',async()=>{
  for(const options of [
    {identityAllowed:false},
    {identityError:{message:'identity check unavailable'}},
    {profile:{...ownProfile,staffName:undefined}},
    {db:{staff:[{...row(),staff_name:'이전 이름'}],global:globalSettings()}},
    {db:{staff:[row(),{...row('중복 이름'),staff_profile_id:actor}],global:globalSettings()}},
    {unfilteredStaffRead:true},
  ]){
    const h=harness({...options,profile:options.profile??ownProfile}),before=structuredClone(h.db);await h.mount();await h.tab('내 자동발송');
    assert.match(text(h.tree.toJSON()),/다시 불러온 뒤 저장|관리자에게 문의/);
    if(h.button('자동발송 설정 저장')){assert.equal(h.button('자동발송 설정 저장').props.disabled,true);await h.save();}
    assert.equal(h.uploads.length,0);assert.equal(h.writes.length,0);assert.deepEqual(h.db,before);h.unmount();
  }
});

test('an unbound legacy or another-owner name collision never gets claimed by own insert',async()=>{
  for(const owner of [null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']){
    const db={staff:[{...row(),staff_profile_id:owner}],global:globalSettings()},before=structuredClone(db),h=harness({profile:ownProfile,db});
    await h.mount();await h.tab('내 자동발송');await h.edit('신규 DB 자동발송 문구','보존되는 내 초안');await h.save();
    assert.equal(h.writes.length,1);assert.equal(h.writes[0].operation,'insert');assert.deepEqual(db,before);
    assert.match(text(h.tree.toJSON()),/관리자에게 문의/);assert.doesNotMatch(text(h.tree.toJSON()),/설정을 저장했습니다/);assert.equal(h.get('신규 DB 자동발송 문구').props.value,'보존되는 내 초안');h.unmount();
  }
});

test('downgrading a manager to self-service never restores another staff draft or reuses an in-flight upload',async()=>{
  const h=harness({realPicker:true});await h.mount();await h.tab('자동발송');await h.edit('설정할 영업자','다른담당자');
  await h.edit('신규 DB 자동발송 문구','다른 직원 미저장 비공개 초안');await h.choose('신규 DB 자동발송 이미지',[imageFile()]);
  h.store.profile={...h.store.profile,...ownProfile};await h.refresh();await h.tab('내 자동발송');
  assert.equal(h.get('설정할 영업자').props.value,'담당자');assert.equal(h.get('신규 DB 자동발송 문구').props.value,'기존 신규 담당자');
  assert.equal(h.picker('신규 DB 자동발송 이미지').props.files.length,0);assert.doesNotMatch(text(h.tree.toJSON()),/다른 직원 미저장|다른담당자/);
  assert.equal(h.reads.at(-1).filters.staff_profile_id,actor);assert.equal(h.writes.length,0);assert.equal(h.uploads.length,0);h.unmount();
  const pending=deferred(),revoked=harness({profile:ownProfile,realPicker:true,delayUpload:pending});await revoked.mount();await revoked.tab('내 자동발송');await revoked.choose('신규 DB 자동발송 이미지',[imageFile()]);await revoked.save();
  assert.equal(revoked.uploads.length,1);revoked.store.profile={...revoked.store.profile,permissions:{}};await revoked.refresh();
  await act(async()=>{pending.resolve();await pending.promise;});await revoked.flush();assert.equal(revoked.writes.length,0);assert.doesNotMatch(text(revoked.tree.toJSON()),/설정을 저장했습니다/);revoked.unmount();
});

test('own saved legacy images remain referenced and can be removed without a storage delete or sender change',async()=>{
  const legacy=`${firm}/auto/admin/new-lead/previous.jpg`,db={staff:[{...row(),new_lead_image_paths:[legacy]}],global:globalSettings()},h=harness({profile:ownProfile,realPicker:true,db});
  await h.mount();await h.tab('내 자동발송');await h.flush();assert.deepEqual(h.signed,[legacy]);assert.equal(h.tree.root.findAllByType('img').length,1);
  await h.edit('신규 DB 자동발송 문구','기존 사진 그대로');await h.save();assert.deepEqual(db.staff[0].new_lead_image_paths,[legacy]);
  act(()=>h.picker('신규 DB 자동발송 이미지').props.onSavedPathsChange([]));await h.flush();await h.save();
  assert.deepEqual(db.staff[0].new_lead_image_paths,[]);assert.equal(db.staff[0].sender_number_id,'sender-a');assert.equal(h.uploads.length,0);
  assert.ok(h.writes.every(w=>w.operation==='update'&&Object.keys(w.value).sort().join()===ownFields.join()));h.unmount();
});

test('inactive SMS-view staff never gains self-service automation',async()=>{
  const h=harness({profile:{...ownProfile,isActive:false}});await h.mount();assert.equal(h.button('내 자동발송'),undefined);
  assert.equal(h.rpcCalls.length,0);assert.equal(h.reads.some(r=>r.table==='sms_staff_automation_settings'),false);assert.equal(h.writes.length,0);h.unmount();
});
