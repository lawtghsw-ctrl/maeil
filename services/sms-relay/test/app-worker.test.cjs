const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname,'../../..');
const epoch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attempt='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const job={id:'job-fixture',outbox_id:'new-mirror-only',law_firm_id:'fixture-firm',epoch_id:epoch,relay_epoch:epoch,attempt_id:attempt,
  source:'manual',sender_number_id:'fixture-sender',sender_number:'01026492494',receiver_number:'01000000000',message:'Fixture',title:'',
  msg_type:'SMS',image_paths:[],created_at:new Date().toISOString(),status:'claimed'};
function load(file,mocks,globals={}){
  const module={exports:{}};
  const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,URL,Buffer,AbortSignal,Date,console,require:n=>{if(n in mocks)return mocks[n];throw Error(`Unmocked ${n}`)},...globals},{filename:file});
  return module.exports;
}
function fixture(options={}){
  const calls=[],queries=[],requests=[];
  const configuration={epoch,origin:'https://relay.example.test',provider:{key:'fixture-key',userId:'fixture-user'},token:'fixture-token'};
  const admin={
    rpc:async(name,args)=>{calls.push({name,args});if(name==='sms_delivery_claim')return {data:options.noJobs?[]:[{...job,...options.job}],error:options.claimError?{}:null};return {data:[],error:options.finishError&&name==='sms_delivery_finish'?{}:null}},
    from(table){queries.push(table);let result;
      if(table==='law_firms')result={data:{status:'active',name:options.demo?'TEST':'Fixture',firm_code:options.demo?'0000000000':'fixture'}};
      else if(table==='sms_sender_numbers')result={data:{phone:job.sender_number,is_active:true,is_registered:options.senderValid!==false}};
      else if(table==='sms_delivery_jobs')result={data:options.receipt?[{...job,provider_message_id:'123',status:'accepted'}]:[]};
      else throw Error(`Legacy or unexpected query: ${table}`);
      const chain=new Proxy({then(resolve){return Promise.resolve(result).then(resolve)}},{get(target,key){if(key in target)return target[key];return ()=>chain}});return chain;
    }
  };
  const worker=load('lib/sms/worker.ts',{
    './delivery':{APPROVED_SENDERS:new Set([job.sender_number]),MOBILE:/^\d{9,11}$/,UUID:/^[\da-f-]{36}$/i,
      readGate:async()=>({epoch_id:options.gateChanged?'different':epoch,relay_epoch:epoch,manual_enabled:options.gateOff!==true,auto_enabled:false}),readLiveConfiguration:()=>configuration},
    './media':{loadImages:async()=>{if(options.mediaError)throw Error('bad media');return []}},
    '@/services/sms-relay/src/validation.mjs':{validateMessage:()=>{if(options.messageError)throw Error('bad message')}},
  },{fetch:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});if(options.timeout)throw Error('timeout');return new Response(JSON.stringify(options.result||{state:'accepted',dispatchId:attempt,testMode:false,messageId:'123',providerCode:1}),{status:options.httpStatus||200})}});
  return {run:()=>worker.runSmsWorker(admin),calls,queries,requests};
}
test('empty new queue never reads or adopts legacy outbox',async()=>{const f=fixture({noJobs:true});const r=await f.run();assert.equal(r.claimed,0);assert.equal(f.requests.length,0);assert.deepEqual(f.queries,['sms_delivery_jobs'])});
test('claim failure makes no provider call',async()=>{const f=fixture({claimError:true});await assert.rejects(f.run());assert.equal(f.requests.length,0)});
test('accepted means accepted, never delivered',async()=>{const f=fixture();await f.run();const finish=f.calls.find(c=>c.name==='sms_delivery_finish');assert.equal(finish.args.p_outcome,'accepted');assert.equal(finish.args.p_provider_message_id,'123');assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.dispatchId,attempt)});
for(const [label,options] of Object.entries({closed:{gateOff:true},changed:{gateChanged:true},demo:{demo:true},sender:{senderValid:false},media:{mediaError:true},message:{messageError:true},oldEpoch:{job:{relay_epoch:'different'}}})){
  test(`${label} blocks provider call`,async()=>{const f=fixture(options);await f.run();assert.equal(f.requests.length,0);assert.equal(f.calls.find(c=>c.name==='sms_delivery_finish').args.p_outcome,'failed')});
}
for(const [label,options] of Object.entries({timeout:{timeout:true},http:{httpStatus:502},testMode:{result:{state:'accepted',dispatchId:attempt,testMode:true,messageId:'123',providerCode:1}},missingId:{result:{state:'accepted',dispatchId:attempt,testMode:false,providerCode:1}},wrongAttempt:{result:{state:'accepted',dispatchId:'other',testMode:false,messageId:'123',providerCode:1}}})){
  test(`${label} remains unknown and never retries`,async()=>{const f=fixture(options);await f.run();assert.equal(f.requests.length,1);assert.equal(f.calls.find(c=>c.name==='sms_delivery_finish').args.p_outcome,'unknown')});
}
test('documented provider rejection is failed',async()=>{const f=fixture({result:{state:'rejected',dispatchId:attempt,testMode:false,providerCode:-101,messageId:null}});await f.run();assert.equal(f.calls.find(c=>c.name==='sms_delivery_finish').args.p_outcome,'failed')});
test('database finish failure never repeats provider attempt',async()=>{const f=fixture({finishError:true});await assert.rejects(f.run());assert.equal(f.requests.length,1)});
for(const state of ['delivered','failed','pending','unknown'])test(`receipt ${state} never calls send endpoint`,async()=>{const f=fixture({noJobs:true,receipt:true,result:{state,dispatchId:attempt,testMode:false,messageId:'123',providerCode:1}});await f.run();assert.equal(f.requests.length,1);assert.ok(f.requests[0].url.endsWith('/results'));assert.equal(f.calls.find(c=>c.name==='sms_delivery_reconcile').args.p_delivery_state,state)});
test('unauthorized machine endpoint does not construct database client',async()=>{let opened=0;const route=load('app/api/sms/dispatch/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/supabase/admin':{createAdminClient:()=>{opened++;throw Error()}},'@/lib/sms/delivery':{workerAuthorized:()=>false},'@/lib/sms/worker':{runSmsWorker:()=>{throw Error()}}});const result=await route.POST({});assert.equal(result.status,401);assert.equal(opened,0)});
