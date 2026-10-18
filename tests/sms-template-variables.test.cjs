const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,mocks={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,console,Date,Set,require:n=>{if(n in mocks)return mocks[n];throw Error(n)}});return m.exports;}
const vars=load('lib/sms/template-variables.ts');
test('application slots use normalized/raw application fields without guessing appointment times',()=>{
 assert.equal(vars.smsConsultTime({consultTime:'평일 오후(1시~6시)',consultTimeRaw:'오후'}),'평일 오후(1시~6시)');
 assert.equal(vars.smsConsultTime({consultTimeRaw:' 토요일 오후\n2시 '}),'토요일 오후 2시');
 assert.equal(vars.smsConsultTime({reservationAt:'2026-10-18T14:00',consultation:{callRequestTime:'저녁'}}),'');
 assert.equal(vars.smsConsultTime({consultTime:123,consultTimeRaw:{}}),'');
 assert.equal(vars.smsConsultTime({consultTimeRaw:'x'.repeat(300)}).length,200);
});
test('per-recipient rendering keeps static staff chat links and resolves missing slots explicitly',()=>{
 const body='{고객명}님 {담당자} / {상담시간대} / {상담시간}\nhttps://open.kakao.com/o/fixture';
 assert.equal(vars.renderSmsTemplate(body,{name:'가상 A',consultTime:'평일 오전(9시~12시)'},'가상담당'),'가상 A님 가상담당 / 평일 오전(9시~12시) / 평일 오전(9시~12시)\nhttps://open.kakao.com/o/fixture');
 assert.equal(vars.renderSmsTemplate('{고객명}/{담당자}/{상담시간대}',{}),'고객/담당자/미지정');
});
test('manual API validates slot length/control characters and snapshots recipients in one existing idempotent enqueue',async()=>{
 const captures=[],state={recipients:[{name:'가상 A',phone:'01000000000',consultTime:'평일 오후(1시~6시)'}]};
 const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
 const admin={from(table){const q={select(){return q},eq(){return q},limit(){return Promise.resolve({data:[],error:null})},maybeSingle(){return Promise.resolve({data:{id:'sender',phone:'01011112222',staff_name:'담당'},error:null})}};return q},async rpc(n,p){captures.push({n,p});return {data:[{id:'new-job'}],error:null}}};
 const delivery={APPROVED_SENDERS:new Set(['01011112222']),assertRelayReady:async()=>({epoch:'relay'}),assertRpc:e=>{if(e)throw e},fail,isDemoFirm:async()=>false,MOBILE:/^\d{9,11}$/,readJson:async()=>({lawFirmId:'firm',epochId:'gate',requestId:'request',senderNumberId:'sender',recipients:state.recipients,message:'{고객명} {상담시간대}',imagePaths:[]}),requireSmsActor:async()=>({admin,firmId:'firm',actorId:'actor'}),requireUuid:v=>v,smsErrorResponse:e=>({status:e.status||500,error:e.message})};
 const route=load('app/api/sms/send/route.ts',{'next/server':{NextResponse:{json:(body,o)=>({body,status:o.status||200})}},'@/lib/sms/delivery':delivery,'@/lib/sms/media':{imagePaths:x=>x,loadImages:async()=>[]},'@/lib/sms/template-variables':vars,'@/services/sms-relay/src/validation.mjs':{countEucKrBytes:s=>s.length*2,validateMessage:()=>{}}});
 const request={headers:{get:()=> 'Bearer fixture'}};
 assert.equal((await route.POST(request)).status,200);assert.equal(captures.length,1);assert.equal(captures[0].n,'sms_delivery_enqueue');assert.equal(captures[0].p.p_request_id,'request');assert.equal(captures[0].p.p_recipients[0].consultTime,'평일 오후(1시~6시)');
 for(const consultTime of ['x'.repeat(201),'오후\n2시',{},null]){state.recipients=[{name:'A',phone:'01000000000',consultTime}];assert.equal((await route.POST(request)).status,400)}
 assert.equal(captures.length,1);
});
