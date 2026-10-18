const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const runtime = path.resolve(__dirname, '../../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react'));
const Renderer = require(path.join(runtime, 'react-test-renderer'));
const { act } = Renderer;
const root = path.resolve(__dirname, '..');
const fid = '11111111-1111-4111-8111-111111111111';
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function harness(file, name, options = {}) {
  const calls = [], routed = [], entered = [], modules = new Map();
  const session = { profile: { id: 'user', platformRole: options.role ?? 'super_admin', isActive: options.active ?? true }, enterSuperAdminFirmScope: firm => entered.push(firm) };
  const router = { push: url => routed.push(url) };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
    const requireMock = name => {
      if (name === 'react') return React;
      if (name === 'react-dom') return { createPortal: children => children };
      if (name === 'xlsx') return require('xlsx');
      if (name === 'lucide-react') return new Proxy({}, { get: (_, name) => props => React.createElement('svg', { ...props, 'data-icon': name }) });
      if (name === 'next/navigation') return { useRouter: () => router };
      if (name === '@/lib/store') return { useStoreSession: () => session };
      if (name === '@/lib/platform/client') return { authJson: async (url, init) => { calls.push({ url, init }); return options.auth ? options.auth(url, init, response) : init?.method === 'POST' ? { ok: true } : response; } };
      if (name.startsWith('@/')) { const target = name.slice(2); return load(target + (fs.existsSync(path.join(root, target + '.tsx')) ? '.tsx' : '.ts')); }
      if (name.startsWith('.')) { const target = path.posix.join(path.posix.dirname(relative), name); return load(target + (fs.existsSync(path.join(root, target + '.tsx')) ? '.tsx' : '.ts')); }
      throw new Error(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { React, Date, Map, Set, Math, Number, Error, Intl, AbortController, structuredClone, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout }, { filename: relative })(requireMock, module, module.exports);
    modules.set(relative, module.exports); return module.exports;
  }
  const ops = load('lib/platform/operations.ts'), month = ops.opsToday().slice(0, 7), config = ops.emptyOperationsConfig();
  const firms = [{ id: fid, name: '실자료 로펌', status: 'active', firm_code: '1234567890', billing_type: 'per_lead' }];
  const monthRow = { month, config, revision: 2, closed_at: null, snapshot: null, updated_at: new Date().toISOString() };
  const report = ops.buildOperationsReport({ firms, contracts: [], adjustments: [], ledger: [], leads: [], cases: [], monthRows: [monthRow], adSpend: [], sales: [] }, month);
  const response = { firms, contracts: [], adjustments: [], ledger: [], month: monthRow, closings: [], report, ledgerTruncated: false, ledgerOffset: 0, ledgerCount: 0, commercialProfiles: [] };
  const Component = load(file)[name]; let tree;
  return { calls, session, routed, entered, response, mount: async () => { await act(async () => { tree = Renderer.create(React.createElement(Component)); }); }, tree: () => tree,
    update: async () => { await act(async () => tree.update(React.createElement(Component))); }, close: () => act(() => tree.unmount()) };
}

const cid = '33333333-3333-4333-8333-333333333333';
const legacy = () => ({ id:cid,law_firm_id:fid,product:'회생 공급',category:'회생',unit_price:50000,monthly_quantity:500,start_date:'2026-10-21',end_date:'2027-01-22',status:'active',confirmed_at:'2026-10-18T00:00:00Z',revision:3,billing_terms:null });
const setup = options => { const h=harness('components/platform/OperationsContracts.tsx','OperationsContracts',options);h.response.contracts=[legacy()];return h; };
const control = (h,label,type='select') => h.tree().root.findAllByType('label').find(n=>typeof n.props.children[0]==='string'&&n.props.children[0]===label).findByType(type);
const change = async (h,label,value,type='select') => act(async()=>control(h,label,type).props.onChange({target:{value}}));
const button = (h,label) => h.tree().root.findAllByType('button').find(n=>text(n.props.children)===label);
const edit = async h => act(async()=>button(h,'조건·회차 보기 / 수정').props.onClick());
const explicit = async h => act(async()=>h.tree().root.findAllByType('input').find(n=>n.props.type==='checkbox'&&n.parent.type==='label'&&text(n.parent).includes('약정·결제 조건')).props.onChange({target:{checked:true}}));
const submit = async h => act(async()=>{await h.tree().root.findAllByType('form')[0].props.onSubmit({preventDefault(){}});});
const posts = h => h.calls.filter(c=>c.init?.method==='POST');

test('contract scope rejects ordinary managers and issues no operations request',async()=>{
  const h=setup({role:'firm_admin'});await h.mount();assert.equal(h.calls.length,0);assert.match(text(h.tree().toJSON()),/슈퍼관리자 전용/);h.close();
});

test('old immutable forecast keeps unallocated unknowns and explicitly labels its former calendar basis',async()=>{
  const h=harness('components/platform/OperationsOverview.tsx','OpsHome');
  delete h.response.report.remainingAgreementBasis;h.response.report.remainingRevenue=76612903;
  h.response.report.forecastMonths=[{month:'2026-11',committed:0,pipeline:120,projectedRevenue:120,projectedProfit:60,projectedOperatingProfit:40,pendingProposals:0,unallocatedContracts:1},{month:'2026-12',committed:12345,pipeline:0,projectedRevenue:12345,projectedProfit:100,projectedOperatingProfit:50,pendingProposals:0}];
  await h.mount();assert.match(text(h.tree().toJSON()),/마감 당시 달력 일할 기준/);assert.match(text(h.tree().toJSON()),/예상 입금·실제 청구매출·회계상 매출 인식으로 보지 않습니다/);const rows=h.tree().root.findAllByType('tr');const unknown=rows.find(r=>text(r).startsWith('2026-11'));
  assert.equal((text(unknown).match(/월 배분 확인 필요/g)||[]).length,4);assert.match(text(unknown),/총량 계약 1건/);assert.equal(text(unknown.findAllByType('td')[1]),'월 배분 확인 필요');assert.match(text(rows.find(r=>text(r).startsWith('2026-12'))),/12,345원/);assert.match(text(h.tree().toJSON()),/잔여 약정액 · 마감 당시 기준76,612,903원/);h.close();
});

test('current home displays confirmed undelivered agreement and future-start status separately from actual billing or payment',async()=>{
  const h=harness('components/platform/OperationsOverview.tsx','OpsHome');
  Object.assign(h.response.report,{remainingAgreementBasis:'confirmed_periods',remainingRevenue:75000000,knownRemainingAgreement:75000000,unconfiguredAgreements:0});
  const contract={...legacy(),billing_terms:{version:1,quantityBasis:'monthly',totalQuantity:null,cycleBasis:'contract_month',paymentTiming:'unspecified',lastPartial:'included'}};
  h.response.report.contracts=[{contract,firmName:'실자료 로펌',planningBasis:'confirmed_periods',totalExpected:1500,expectedToDate:0,delivered:0,remaining:1500,remainingAmount:75000000,agreementAmount:75000000,forecast:null,fulfillment:null,neededPerDay:1500/94,status:'scheduled'}];
  h.response.report.forecastMonths=[{month:'2027-01',committed:0,knownCommitted:0,pipeline:0,projectedRevenue:0,projectedProfit:null,projectedOperatingProfit:null,pendingProposals:0,agreementBasis:'period_start'}];
  await h.mount();const rendered=text(h.tree().toJSON());assert.match(rendered,/잔여 약정가치 · 미공급분75,000,000원/);assert.match(rendered,/실제 미수금 아님/);assert.match(rendered,/시작 전/);assert.match(rendered,/회차 시작월 기준/);assert.match(rendered,/예상 입금·실제 청구매출·회계상 매출 인식으로 보지 않습니다/);assert.ok(!rendered.includes('76,612,903'));assert.equal(posts(h).length,0);h.close();
});

test('incomplete agreement totals remain unknown while only the known subtotal is labeled',async()=>{
  const h=harness('components/platform/OperationsOverview.tsx','OpsHome');
  Object.assign(h.response.report,{remainingAgreementBasis:'confirmed_periods',remainingRevenue:null,knownRemainingAgreement:75000000,unconfiguredAgreements:1});
  h.response.report.forecastMonths=[{month:'2026-11',committed:null,knownCommitted:25000000,pipeline:0,projectedRevenue:null,projectedProfit:null,projectedOperatingProfit:null,pendingProposals:0,agreementBasis:'period_start',unconfiguredContracts:1}];
  await h.mount();const rendered=text(h.tree().toJSON());assert.match(rendered,/잔여 약정가치 · 미공급분확인 필요/);assert.match(rendered,/조건 미확인 1건 · 확인된 부분 75,000,000원 · 전체 합계 미확정/);assert.match(rendered,/확인된 부분 25,000,000원 · 전체 미확정/);assert.match(rendered,/약정 조건 1건 미확인/);h.close();
});
test('legacy edit preserves unregistered terms, commas and reference-only calendar preview',async()=>{
  const h=setup();await h.mount();await edit(h);
  assert.equal(control(h,'공급 단가 (원 · VAT 제외)','input').props.value,'50,000');assert.equal(control(h,'월 공급 약정량 (건)','input').props.value,'500');
  assert.match(text(h.tree().toJSON()),/결제 조건 미등록/);assert.match(text(h.tree().toJSON()),/17,741,935원/);assert.equal(posts(h).length,0);
  await submit(h);const body=JSON.parse(posts(h)[0].init.body);assert.equal(body.billing_terms,null);assert.equal(body.unit_price,50000);assert.equal(body.monthly_quantity,500);assert.equal(body.expectedRevision,3);h.close();
});
test('explicit three-cycle agreement previews 75 million without writes then saves exact numeric metadata',async()=>{
  const h=setup();await h.mount();await edit(h);await explicit(h);
  await change(h,'결제시점','prepaid');await change(h,'계약금액 회차 기준','contract_month');await change(h,'마지막 부분기간 약정','included');
  const rendered=text(h.tree().toJSON());assert.match(rendered,/75,000,000원/);assert.match(rendered,/2026-10-21 ~ 2026-11-20/);assert.match(rendered,/2027-01-21 ~ 2027-01-22/);assert.equal(posts(h).length,0);
  await submit(h);const body=JSON.parse(posts(h)[0].init.body);assert.deepEqual(body.billing_terms,{version:1,quantityBasis:'monthly',totalQuantity:null,cycleBasis:'contract_month',paymentTiming:'prepaid',lastPartial:'included'});assert.equal(body.start_date,'2026-10-21');assert.equal(body.end_date,'2027-01-22');h.close();
});

test('confirmed three-installment 75-million agreement labels included two days without inventing a fourth charge or cash receipt',async()=>{
  const h=setup();h.response.contracts[0].billing_terms={version:1,quantityBasis:'monthly',totalQuantity:null,cycleBasis:'contract_month',paymentTiming:'unspecified',lastPartial:'included'};
  const before=JSON.stringify(h.response.contracts);await h.mount();await edit(h);
  const rows=h.tree().root.findAllByType('tr');
  for(const number of [1,2,3]){const row=rows.find(r=>text(r).startsWith(`${number}회`));assert.ok(row);assert.equal(text(row.findAllByType('td')[4]),'25,000,000원');}
  const included=rows.find(r=>text(r).startsWith('추가 2일'));assert.ok(included);assert.match(text(included),/2027-01-21 ~ 2027-01-22/);assert.equal(text(included.findAllByType('td')[4]),'0원');assert.match(text(included),/추가 청구 없음/);assert.ok(!rows.some(r=>text(r).startsWith('4회')));
  const rendered=text(h.tree().toJSON());assert.match(rendered,/75,000,000원/);assert.match(rendered,/1,500건/);assert.match(rendered,/수납 미등록/);assert.match(rendered,/확정 회차 총액에서 연결 공급분을 차감/);
  assert.equal(posts(h).length,0);assert.equal(JSON.stringify(h.response.contracts),before);h.close();
});
test('incomplete agreement choices cannot be submitted or guessed',async()=>{
  const h=setup();await h.mount();await edit(h);await explicit(h);await submit(h);assert.equal(posts(h).length,0);assert.match(text(h.tree().toJSON()),/직접 선택해주세요/);assert.equal(control(h,'공급 단가 (원 · VAT 제외)','input').props.value,'50,000');h.close();
});
test('whole-term quantity keeps monthly allocation absent and saves one-term agreement',async()=>{
  const h=setup();await h.mount();await edit(h);await explicit(h);await change(h,'수량 기준','total');await change(h,'계약 전체 총 수량 (건)','1,500','input');await change(h,'결제시점','postpaid');
  assert.equal(control(h,'계약 전체 총 수량 (건)','input').props.value,'1,500');assert.match(text(h.tree().toJSON()),/전체 기간 1회 약정/);assert.match(text(h.tree().toJSON()),/75,000,000원/);await submit(h);
  const body=JSON.parse(posts(h)[0].init.body);assert.equal(body.monthly_quantity,null);assert.equal(body.billing_terms.totalQuantity,1500);assert.equal(body.billing_terms.quantityBasis,'total');h.close();
});
test('recorded zero receipt remains zero while a contract with no receipts stays unregistered',async()=>{
  const h=setup();h.response.contracts.push({...legacy(),id:'44444444-4444-4444-8444-444444444444',product:'미입력'});h.response.contractReceipts=[{contractId:cid,firmId:fid,amount:0,count:1}];await h.mount();
  const rows=h.tree().root.findAllByType('tr');assert.match(text(rows.find(r=>text(r).includes('회생 공급'))),/0원연결 기록 1건/);assert.match(text(rows.find(r=>text(r).includes('미입력'))),/수납 미등록/);assert.equal(posts(h).length,0);h.close();
});
test('failed explicit save preserves chosen conditions and revision, and disables editing during the request',async()=>{
  const waiting=deferred();const h=setup({auth:(_url,init,data)=>init?.method==='POST'?waiting.promise:data});await h.mount();await edit(h);await explicit(h);await change(h,'결제시점','prepaid');await change(h,'계약금액 회차 기준','contract_month');await change(h,'마지막 부분기간 약정','included');
  let pending;await act(async()=>{pending=h.tree().root.findAllByType('form')[0].props.onSubmit({preventDefault(){}});});assert.equal(h.tree().root.findByType('fieldset').props.disabled,true);assert.equal(button(h,'저장 중...').props.disabled,true);
  await act(async()=>{waiting.resolve(Promise.reject(new Error('다른 관리자가 수정했습니다')));await pending;});assert.match(text(h.tree().toJSON()),/다른 관리자가 수정했습니다/);assert.equal(control(h,'마지막 부분기간 약정').props.value,'included');assert.equal(JSON.parse(posts(h)[0].init.body).expectedRevision,3);h.close();
});
