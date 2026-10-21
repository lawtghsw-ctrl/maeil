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
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const deferred = () => { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise,resolve}; };
const globalSettings = () => ({new_lead_enabled:false,absence_enabled:false,new_lead_template:'기본 신규',absence_template:'기본 부재',duplicate_guard_minutes:5});
const row = (name='담당자') => ({id:`row-${name}`,law_firm_id:firm,staff_name:name,sender_number_id:'sender-a',new_lead_enabled:false,absence_enabled:false,new_lead_template:`기존 신규 ${name}`,absence_template:`기존 부재 ${name}`,new_lead_image_paths:[],absence_image_paths:[]});

function harness(options={}) {
  const modules=new Map(), reads=[],writes=[],uploads=[],snapshots=[],signed=[];
  let tree, readError=options.readError??null, saveError=options.saveError??null;
  const db=options.db??{staff:[row(),row('다른담당자')],global:globalSettings()};
  const store={profile:{id:'actor-a',lawFirmId:firm,platformRole:'staff',staffName:'담당자',isActive:true},superAdminFirmScope:null,workStaffNames:['담당자','다른담당자'],can:()=>true};
  const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}},error:null})},from(table){
    const filters={}; let payload,selected=false,single=false;
    const query={eq(k,v){filters[k]=v;return query;},order(){return query;},select(){selected=true;return query;},maybeSingle(){single=true;return query;},single(){single=true;return query;},upsert(value){payload=value;return query;},update(value){payload=value;return query;},insert(value){payload=value;return query;},
      then(resolve,reject){return (async()=>{
        if(payload){
          writes.push({table,value:structuredClone(payload),filters:{...filters},selected,single});
          if(options.delaySave)await options.delaySave.promise;
          if(saveError)return {data:null,error:saveError};
          if(table==='sms_staff_automation_settings'){
            const saved={...payload,id:`row-${payload.staff_name}`}; db.staff=[...db.staff.filter(r=>r.staff_name!==payload.staff_name),saved];
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
        return {data:readError?null:structuredClone(db.staff),error:readError};
      })().then(resolve,reject);}
    }; return query;
  }, storage:{from(bucket){return {upload:async(location,file)=>{uploads.push({bucket,location,file});return {error:null};},createSignedUrl:async(path)=>{signed.push(path);return {data:{signedUrl:`https://synthetic.invalid/${path}`},error:null};}}}}};
  function load(relative){
    if(modules.has(relative))return modules.get(relative);
    const source=options.baseline&&relative==='components/sms/SmsCenter.tsx'?execFileSync('git',['show','db8f0b74d3de411103715767ec337363d3927d56:'+relative],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,relative),'utf8');
    const code=ts.transpileModule(source,{fileName:relative,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
    const module={exports:{}};
    const mocks={react:React,'@/lib/store':{useStoreSession:()=>store},'@/lib/supabase/client':{createClient:()=>client},'@/components/sms/DeliveryControls':{default:()=>null},'@/components/sms/AutomationImagePicker':{default:()=>null},'@/components/ui/DateInput':{DateTimeInput:()=>null},'lucide-react':new Proxy({},{get:()=>()=>null})};
    const requireMock=name=>name in mocks?mocks[name]:name.startsWith('@/lib/sms/')?load(name.slice(2)+'.ts'):(()=>{throw Error('Unmocked import '+name);})();
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`,{React,Error,URL,Date,Map,Math,AbortController,Headers,crypto:require('node:crypto').webcrypto,fetch:async()=>new Response(JSON.stringify({error:'Synthetic gate off'}),{status:503}),confirm:()=>true,console},{filename:relative})(requireMock,module,module.exports);
    modules.set(relative,module.exports);return module.exports;
  }
  const Component=load('components/sms/SmsCenter.tsx').default;
  const render=()=>React.createElement(Component,{contextKey:'test',draftCache:options.cache});
  const button=part=>tree.root.findAllByType('button').find(n=>text(n).includes(part));
  const get=label=>tree.root.findByProps({'aria-label':label});
  const flush=async()=>act(async()=>{await new Promise(setImmediate);});
  return {db,store,reads,writes,uploads,signed,snapshots,get tree(){return tree;},button,get,
    setReadError:e=>{readError=e;},setSaveError:e=>{saveError=e;},
    picker:label=>tree.root.findByProps({label}),
    async mount(){await act(async()=>{tree=Renderer.create(render());});await flush();},
    async tab(label){act(()=>button(label).props.onClick());await flush();},
    async edit(label,value){act(()=>get(label).props.onChange({target:{value,checked:value}}));await flush();},
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
  assert.equal(saved.new_lead_image_paths.length,1);assert.match(saved.new_lead_image_paths[0],/^firm-a\/auto\/담당자\/new-lead\/[a-f0-9-]+-image.jpg$/);
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
