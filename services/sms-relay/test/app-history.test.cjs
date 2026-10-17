const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
const firm='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
class Failure extends Error{constructor(status,message){super(message);this.status=status;}}
function fixture(options={}){
 const calls=[];
 const rpc=async(name,args)=>{calls.push({name,args});return {data:options.data??(name==='sms_history_read'?{items:[]}:[{outbox_id:id,archived:args.p_archived}]),error:options.rpcError?{message:options.rpcError}:null}};
 const helper={fail:(status,message)=>{throw new Failure(status,message)},readJson:async request=>request.body,
  requireUuid:(value)=>{if(typeof value!=='string'||!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value))throw new Failure(400,'bad uuid');return value},
  requireSmsActor:async(request,requested,permission)=>{if(options.authError)throw new Failure(401,'unauthorized');assert.equal(requested,firm);assert.equal(permission,'sms.view_history');return{admin:{rpc},firmId:firm,actorId,canManage:options.manager!==false}},
  smsErrorResponse:error=>({status:error.status||503,error:error.message})};
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(path.join(root,'app/api/sms/history/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,Date,require:name=>name==='next/server'?{NextResponse:{json:(body,options={})=>({body,status:200,...options})}}:name==='@/lib/sms/delivery'?helper:(()=>{throw Error(name)})()});
 const request=(view='active',body={lawFirmId:firm,ids:[id]},authorization='Bearer fixture')=>({nextUrl:new URL(`https://fixture.test/api/sms/history?lawFirmId=${firm}&view=${view}`),body,headers:new Headers(authorization?{authorization}:{})});
 return{route:module.exports,calls,request};
}
test('history uses one tenant-authorized RPC and preserves stored delivered status',async()=>{const items=[{id,status:'delivery_delivered',recordKind:'delivery',deletedAt:null}];const f=fixture({data:{items}});const r=await f.route.GET(f.request());assert.equal(r.status,200);assert.equal(r.body.items[0].status,'delivery_delivered');assert.equal(r.body.canManageHistory,true);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'sms_history_read');assert.equal(f.calls[0].args.p_actor_id,actorId);assert.equal(f.calls[0].args.p_law_firm_id,firm)});
test('empty current history remains an explicit empty array',async()=>{const f=fixture();const r=await f.route.GET(f.request());assert.equal(r.status,200);assert.equal(r.body.items.length,0)});
test('nonmanager may view active history but not deleted history',async()=>{const f=fixture({manager:false});assert.equal((await f.route.GET(f.request())).status,200);assert.equal((await f.route.GET(f.request('deleted'))).status,403);assert.equal(f.calls.length,1)});
test('invalid filter is rejected without database access',async()=>{const f=fixture();assert.equal((await f.route.GET(f.request('all-tenants'))).status,400);assert.equal(f.calls.length,0)});
test('failed history query reports failure rather than silently hiding records',async()=>{const f=fixture({rpcError:'private database detail'});const r=await f.route.GET(f.request());assert.equal(r.status,503);assert.ok(!r.body.error.includes('private database'))});
test('unauthenticated history cannot read database',async()=>{const f=fixture({authError:true});assert.equal((await f.route.GET(f.request())).status,401);assert.equal(f.calls.length,0)});
for(const method of ['DELETE','PATCH']){
 test(`${method} requires bearer authorization`,async()=>{const f=fixture();assert.equal((await f.route[method](f.request('active',undefined,''))).status,401);assert.equal(f.calls.length,0)});
 test(`${method} requires administrator`,async()=>{const f=fixture({manager:false});assert.equal((await f.route[method](f.request())).status,403);assert.equal(f.calls.length,0)});
 test(`${method} modifies only archive metadata via RPC`,async()=>{const f=fixture();const r=await f.route[method](f.request());assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'sms_history_set_archived');assert.equal(f.calls[0].args.p_law_firm_id,firm);assert.equal(f.calls[0].args.p_archived,method==='DELETE');assert.equal(f.calls[0].args.p_outbox_ids[0],id)});
}
for(const ids of [[],Array(101).fill(id),['bad-id'],[id,id.toUpperCase()]])test(`invalid archive selection ${JSON.stringify(ids).slice(0,60)} is rejected`,async()=>{const f=fixture();assert.equal((await f.route.DELETE(f.request('active',{lawFirmId:firm,ids}))).status,400);assert.equal(f.calls.length,0)});
test('foreign-record rejection returns a safe error and never attempts partial fallback',async()=>{const f=fixture({rpcError:'SMS_HISTORY_OUTBOX_NOT_FOUND'});const r=await f.route.DELETE(f.request());assert.equal(r.status,400);assert.equal(f.calls.length,1)});
test('unconfirmed archive response never claims success',async()=>{const f=fixture({data:[]});assert.equal((await f.route.DELETE(f.request())).status,503)});
