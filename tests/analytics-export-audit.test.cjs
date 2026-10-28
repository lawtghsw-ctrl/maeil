// Offline audit authorization checks. No production database or external requests.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function harness(overrides={}){
  const profile={id:'synthetic-manager',role:'admin',platform_role:'firm_admin',law_firm_id:'firm-a',...overrides};
  const writes=[];
  const admin={from(table){return {insert:async value=>{writes.push({table,value});return {error:null}},select(){return this},eq(){return this},single:async()=>({data:{permissions:{'settlements.view':true,'settlements.export':true}},error:null})}}};
  const cache=new Map();
  function load(file){
    const filename=path.resolve(root,file);if(cache.has(filename))return cache.get(filename);
    const module={exports:{}};cache.set(filename,module.exports);
    const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const requireFile=name=>{
      if(name==='next/server')return {NextResponse:{json:(value,init)=>Response.json(value,init)}};
      if(name==='@/lib/platform/server')return {requirePlatformUser:async()=>({admin,profile}),platformError:error=>({status:error.message==='FORBIDDEN'?403:400,message:error.message})};
      if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
      if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(filename),name))+'.ts');
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`,{Date,Response},{filename})(requireFile,module,module.exports);cache.set(filename,module.exports);return module.exports;
  }
  const route=load('app/api/admin/management-export/route.ts');
  return {writes,post:body=>route.POST({json:async()=>({firmId:'firm-a',kind:'meeting',format:'xlsx',start:'2024-01-01',end:'2026-10-31',...body})})};
}
test('multi-year audit is allowed only for an explicit cumulative manager meeting export',async()=>{
  const h=harness();
  assert.equal((await h.post({mode:'cumulative'})).status,200);
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].table,'platform_audit_logs');
  assert.equal(h.writes[0].value.law_firm_id,'firm-a');
  assert.equal(h.writes[0].value.detail.mode,'cumulative');
  assert.equal(h.writes[0].value.detail.start,'2024-01-01');
  for(const body of [{},{mode:'monthly'},{mode:'cumulative',kind:'ledger'},{mode:'invalid'},{mode:'cumulative',start:'2026-02-30'},{mode:'cumulative',start:'2026-11-01'},{mode:'cumulative',firmId:'firm-b'}]){
    const x=harness();assert.notEqual((await x.post(body)).status,200);assert.equal(x.writes.length,0);
  }
});
test('ordinary staff cannot widen settlement or meeting exports into cumulative access',async()=>{
  for(const kind of ['meeting','settlements']){
    const h=harness({role:'staff',platform_role:'staff',staff_name:'Synthetic staff'});
    assert.equal((await h.post({mode:'cumulative',kind})).status,403);assert.equal(h.writes.length,0);
  }
});
