const test = require('node:test'), assert = require('node:assert/strict');
const harness = require('./store-performance.test.cjs');
const { act } = harness;
const clone = value => JSON.parse(JSON.stringify(value));
const base = {id:'shared',name:'합성 공용 고객',phone:'01000000000',receivedAt:'2026-10-01',assignedStaff:'Other',status:'종결_중단',detailStage:'장기부재',consultation:{memoLog:[]}};
test.after(()=>harness.restoreRuntime());
async function mount({permissions={'db.view':true},writer=false}={}) {
  await harness.mount(false,'/db', f=>{
    Object.assign(f.db.profiles[0],{role:'staff',platform_role:'staff',permissions:{...permissions,...writer&&{'staff.writer':true}}});
    f.db.app_leads=[{id:'shared',law_firm_id:'firm-1',data:clone(base)},{id:'normal',law_firm_id:'firm-1',data:{...clone(base),id:'normal',detailStage:'상담'}}];
    const prior=f.client.rpc;
    f.sharedCalls=[];
    f.client.rpc=async(name,args)=>{
      if(name!=='update_shared_long_absent_lead')return prior(name,args);
      f.sharedCalls.push(clone(args));
      if(f.sharedGate)await f.sharedGate;
      if(f.sharedError)return {data:null,error:{message:f.sharedError}};
      const row=f.db.app_leads.find(row=>row.id===args.target_lead_id);
      // Only a persistence/response fixture, NOT a substitute for actual SQL tests.
      // The separate PGlite suite executes auth/RLS/whitelist/row checks.
      if(row.data.detailStage!=='장기부재')return {data:null,error:{message:'현재 장기부재 DB만 공동관리할 수 있습니다.'}};
      if(JSON.stringify(row.data)!==JSON.stringify(args.expected_data))return {data:null,error:{message:'다른 담당자가 먼저 변경했습니다.'}};
      for(const [key,value]of Object.entries(args.patch)){if(value===null)delete row.data[key];else row.data[key]=clone(value);}
      if(args.patch.detailStage)row.data.stageUpdatedAt='2026-10-28T05:00:00Z';
      if(args.patch.contactLog)row.data.contactLog=row.data.contactLog.map(entry=>({...entry,staff:'Server Actor'}));
      f.db.app_change_logs.push({id:'audit',law_firm_id:'firm-1',data:{staff:'One'}});
      return {data:clone(row),error:null};
    };
  });
}
test('actual store uses one whitelisted patch RPC without optimistic or whole-row table writes',async()=>{
  await mount();try{
    const expected=clone(harness.store.leads.find(x=>x.id==='shared'));
    let release;harness.fixture.sharedGate=new Promise(resolve=>release=resolve);
    let result;await act(async()=>{result=harness.store.updateLead('shared',{consultation:{memoLog:[{id:'memo',text:'shared draft'}]},reservationAt:undefined},expected);});
    assert.deepEqual(harness.store.leads.find(x=>x.id==='shared'),expected);
    const call=harness.fixture.sharedCalls[0];assert.deepEqual(call.patch,{consultation:{memoLog:[{id:'memo',text:'shared draft'}]},reservationAt:null});
    assert.equal(call.expected_data._lawFirmId,undefined);assert.equal(call.expected_data._lawFirmName,undefined);assert.equal(call.expected_data.id,'shared');
    await act(async()=>{release();assert.equal(await result,true);});
    assert.equal(harness.store.leads.find(x=>x.id==='shared').consultation.memoLog[0].text,'shared draft');
    assert.equal(harness.fixture.calls.filter(c=>c.table==='app_leads'&&['update','insert'].includes(c.operation)).length,0);
    assert.equal(harness.fixture.calls.filter(c=>c.table==='app_change_logs'&&c.operation==='insert').length,0,'RPC owns atomic audit');
  }finally{await harness.unmount();}
});
test('store keeps failed shared drafts outside persisted state, errors explicitly, and preserves sensitive operation guards',async()=>{
  await mount({permissions:{'db.view':true,'db.delete':true,'db.convert':true,'db.edit_basic':true}});try{
    const before=clone(harness.fixture.db),expected=clone(harness.store.leads.find(x=>x.id==='shared'));
    harness.fixture.sharedError='다른 담당자가 먼저 변경했습니다.';
    await act(async()=>assert.equal(await harness.store.updateLead('shared',{name:'draft'},expected),false));
    assert.deepEqual(harness.fixture.db,before);assert.deepEqual(harness.store.leads.find(x=>x.id==='shared'),expected);assert.match(harness.store.syncError,/다른 담당자/);
    await act(async()=>{
      assert.equal(await harness.store.updateLead('shared',{_lawFirmId:'firm-2'}),false);
      harness.store.deleteLead('shared');assert.equal(harness.store.convertLeadToClient('shared'),undefined);
    });
    assert.deepEqual(harness.fixture.db,before);assert.equal(harness.fixture.sharedCalls.length,1);
  }finally{await harness.unmount();}
});
test('persisted metadata is adopted; old snapshot and stage-exit retries are rejected, not silently saved',async()=>{
  await mount();try{
    const opened=clone(harness.store.leads.find(x=>x.id==='shared'));
    await act(async()=>assert.equal(await harness.store.updateLead('shared',{contactLog:[{id:'call',at:'2026-10-28T04:00:00Z',staff:'draft actor',type:'phone'}]},opened),true));
    assert.equal(harness.store.leads.find(x=>x.id==='shared').contactLog[0].staff,'Server Actor');
    await act(async()=>assert.equal(await harness.store.updateLead('shared',{memo:'stale'},opened),false));
    const refreshed=clone(harness.store.leads.find(x=>x.id==='shared'));
    await act(async()=>assert.equal(await harness.store.updateLead('shared',{detailStage:'상담',status:'상담완료'},refreshed),true));
    assert.equal(harness.store.leads.find(x=>x.id==='shared').stageUpdatedAt,'2026-10-28T05:00:00Z');
    await act(async()=>assert.equal(await harness.store.updateLead('shared',{memo:'after exit'},refreshed),false));
    assert.equal(harness.fixture.db.app_leads[0].data.memo,undefined);
  }finally{await harness.unmount();}
});
test('writer and db.view-missing accounts never use shared RPC',async()=>{
  for(const opts of [{writer:true},{permissions:{}}]){
    await mount(opts);try{await act(async()=>assert.equal(await harness.store.updateLead('shared',{memo:'denied'}),false));assert.equal(harness.fixture.sharedCalls.length,0);}finally{await harness.unmount();}
  }
});
