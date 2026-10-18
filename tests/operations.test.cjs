const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, deps = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Map, Set, Buffer, structuredClone, console })(name => { if (name in deps) return deps[name]; throw new Error('Unexpected dependency ' + name); }, module, module.exports);
  return module.exports;
}
const ops = load('lib/platform/operations.ts');
const firmId = '11111111-1111-4111-8111-111111111111', otherId = '22222222-2222-4222-8222-222222222222';
const firm = { id: firmId, name: '공급 로펌', firm_code: '1234567890', status: 'active', billing_type: 'per_lead' };
const contract = { id: '33333333-3333-4333-8333-333333333333', law_firm_id: firmId, product: '확인된 상품', category: '회생', unit_price: 50000, monthly_quantity: 310, start_date: '2026-10-01', end_date: '2026-12-31', status: 'active', confirmed_at: '2026-10-01T00:00:00+09:00', revision: 1, created_at: '2026-10-01T00:00:00+09:00', updated_at: '2026-10-01T00:00:00+09:00' };
const row = (patch = {}) => ({ id: 'ledger1', law_firm_id: firmId, lead_id: 'lead1', classification: 'new', billable: true, billing_type: 'per_lead', unit_price_snapshot: 50000, supplied_at: '2026-10-01T00:00:00+09:00', origin: 'ingest', supply_contract_id: contract.id, supply_contract_revision: 1, ad_source_id: 'source', ...patch });
const input = (patch = {}) => ({ firms: [firm], contracts: [contract], adjustments: [], ledger: [row()], leads: [{ id: 'lead1', law_firm_id: firmId, data: {} }], cases: [], monthRows: [], adSpend: [], commercialProfiles: [{ law_firm_id: firmId, service_mode: 'db_supply' }], ...patch });
const report = (patch = {}, month = '2026-10', now = '2026-12-15T12:00:00Z') => ops.buildOperationsReport(input(patch), month, false, new Date(now));
test('config contains no example money and preserves explicit zero versus missing', () => {
  const c = ops.emptyOperationsConfig(); assert.equal(c.goals.margin, null); assert.equal(c.costs.length, 0); assert.equal(c.rules.fulfillmentWarning, 98);
  assert.equal(report().totals.adSpend, null); assert.equal(report().totals.paid, null); assert.equal(report().operatingCost, null);
  c.adSpend = [{ firmId, amount: 0, note: '' }];
  const r = report({ monthRows: [{ month: '2026-10', config: c }] }); assert.equal(r.totals.adSpend, 0); assert.equal(r.totals.profit, 50000); assert.equal(r.operatingCost, null);
});
test('positive historical snapshot stays exact; missing/zero/negative/monthly is unknown', () => {
  assert.equal(report().totals.revenue, 50000);
  for (const price of [null, 0, -1, 'oops']) { const r = report({ ledger: [row({ unit_price_snapshot: price })] }); assert.equal(r.totals.revenue, null); assert.equal(r.totals.missingPrices, 1); }
  assert.equal(report({ ledger: [row({ billing_type: 'monthly' })] }).totals.revenue, null);
});
test('explicit nonbillable and backfill do not add revenue, backfill does not add supply', () => {
  const r = report({ ledger: [row({ billable: false }), row({ id: 'old', origin: 'backfill', unit_price_snapshot: 999999 })] });
  assert.equal(r.totals.revenue, 0); assert.equal(r.totals.supplied, 1); assert.equal(r.totals.billable, 0);
});
test('TEST and CRM-only exclusions do not mutate raw data', () => {
  const demo = { ...firm, id: otherId, name: 'TEST', firm_code: '0000000000' };
  const source = input({ firms: [firm, demo], ledger: [row(), row({ id: 'd', law_firm_id: otherId })] });
  const before = JSON.stringify(source); const r = ops.buildOperationsReport(source, '2026-10');
  assert.equal(r.totals.supplied, 1); assert.equal(r.excludedDemo, 1); assert.equal(JSON.stringify(source), before);
  const c = report({ commercialProfiles: [{ law_firm_id: firmId, service_mode: 'crm_only' }] }); assert.equal(c.firms.length, 0); assert.equal(c.contracts.length, 0); assert.equal(c.excludedDemo, 0);
});
test('manual ad input overrides, never adds to existing ad and Meta amounts', () => {
  const c = ops.emptyOperationsConfig(); c.adSpend = [{ firmId, amount: 10000, note: '' }];
  const r = report({ monthRows: [{ month: '2026-10', config: c }], adSpend: [{ firmId, month: '2026-10', amount: 7000, source: 'firm_settings' }] });
  assert.equal(r.totals.adSpend, 10000); assert.equal(r.totals.profit, 40000);
});
test('replacement adds quantity only, receipt is distinct and overpayment stays negative receivable', () => {
  const r = report({ adjustments: [{ id: 'a', law_firm_id: firmId, event_date: '2026-10-02', kind: 'replacement', quantity: 2, amount: 0 }, { id: 'b', law_firm_id: firmId, event_date: '2026-10-02', kind: 'receipt', quantity: 0, amount: 60000 }] });
  assert.equal(r.totals.revenue, 50000); assert.equal(r.totals.replacements, 2); assert.equal(r.totals.receivable, -10000);
});
test('calendar proration handles leap February and partial start month', () => {
  assert.equal(ops.plannedSupply({ monthly_quantity: 290, start_date: '2024-02-01', end_date: '2024-02-29' }, '2024-02-29'), 290);
  assert.equal(ops.plannedSupply({ monthly_quantity: 310, start_date: '2026-10-17', end_date: '2026-10-31' }, '2026-10-31'), 150);
  assert.equal(ops.plannedSupply(contract, '2026-09-30'), 0); assert.equal(ops.plannedSupply({ ...contract, monthly_quantity: null }, '2026-12-31'), null);
});
test('contract matching by tenant and ID ignores unrelated supply, unlinked legacy stays unlinked', () => {
  const r = report({ ledger: [row(), row({ id: 'old', supply_contract_id: null }), row({ id: 'foreign', law_firm_id: otherId })] });
  assert.equal(r.contracts[0].delivered, 1); assert.equal(r.totals.supplied, 2);
});
test('60-day cohort uses current evaluation date, current valid contract and tenant joins', () => {
  const leads = [{ id: 'lead1', law_firm_id: firmId, data: { convertedCaseId: 'case1' } }];
  let r = report({ leads, cases: [{ id: 'case1', law_firm_id: firmId, data: { contractAmount: 1000, status: '진행' } }] }); assert.equal(r.totals.mature, 1); assert.equal(r.totals.converted, 1);
  r = report({ leads, cases: [{ id: 'case1', law_firm_id: otherId, data: { contractAmount: 1000 } }] }); assert.equal(r.totals.conversionRate, null); assert.equal(r.totals.missingConversions, 1);
  r = report({ leads, cases: [{ id: 'case1', law_firm_id: firmId, data: { contractAmount: 1000, status: '취하' } }] }); assert.equal(r.totals.converted, 0);
  assert.equal(report({}, '2026-10', '2026-10-31T00:00:00Z').totals.mature, 0);
});
test('cohort deduplicates a repeated lead while revenue preserves distinct ledger events', () => {
  const r = report({ ledger: [row(), row({ id: 'reentry', classification: 'reentry' })] }); assert.equal(r.totals.revenue, 100000); assert.equal(r.totals.mature, 1);
});
test('KST month boundary includes 15:00Z and excludes prior minute', () => {
  const r = report({ ledger: [row({ supplied_at: '2026-09-30T15:00:00Z' }), row({ id: 'prior', supplied_at: '2026-09-30T14:59:59Z' })] }); assert.equal(r.totals.supplied, 1);
});
test('strict command rejects invalid dates, surplus fields, negative amounts, and fake active price', () => {
  const c = { action: 'contract', id: null, expectedRevision: 0, law_firm_id: firmId, product: 'DB', category: '회생', unit_price: 50000, monthly_quantity: 100, start_date: '2026-10-01', end_date: '2026-12-31', status: 'active' };
  assert.equal(ops.validateOperationCommand(c).unit_price, 50000);
  for (const change of [{ start_date: '2026-02-30' }, { unit_price: 0 }, { unit_price: '50000' }, { injected: true }, { end_date: '2026-09-01' }, { expectedRevision: -1 }]) assert.throws(() => ops.validateOperationCommand({ ...c, ...change }));
  assert.throws(() => ops.validateOperationCommand({ action: 'commercial', law_firm_id: firmId, service_mode: 'other', expectedRevision: 0 }));
});
test('settings reject duplicate firm costs and unsafe totals', () => {
  const c = ops.emptyOperationsConfig(); c.adSpend = [{ firmId, amount: 100, note: '' }, { firmId, amount: 200, note: '' }]; assert.throws(() => ops.validateOperationsConfig(c));
  c.adSpend = []; c.rules.fulfillmentRisk = 100; assert.throws(() => ops.validateOperationsConfig(c));
});
test('incentive uses verified signing month, configured owner, rate and month limit', () => {
  const p = { id: 'p', name: '영업', base: 0, incentive: 999, employerCost: 0, salesOwner: '영업', incentiveRate: 3, incentiveMonths: 3 };
  const sale = { id: 's', stage: '서명완료', signed_at: '2026-10-15T00:00:00Z', data: { owner: '영업' }, law_firm_id: null, proposal: { quantity: 100, unitPrice: 50000, startDate: '2026-10-01', endDate: '2026-12-31', vat: 'excluded' } };
  assert.equal(ops.incentiveForPerson(p, [sale], '2026-10').amount, 150000);
  assert.equal(ops.incentiveForPerson(p, [sale], '2027-01').amount, 0);
  assert.equal(ops.incentiveForPerson(p, [{ ...sale, signed_at: null }], '2026-10').amount, 0);
  assert.equal(ops.incentiveForPerson({ ...p, salesOwner: '' }, [sale], '2026-10').amount, 999);
});
test('three-month forecast excludes unknown proposal dates and prevents linked contract double-count', () => {
  const sale = { id: 's', stage: '제안 · 조건협의', signed_at: null, data: {}, law_firm_id: null, proposal: { quantity: 100, unitPrice: 50000, startDate: '2026-11-01', endDate: '2026-12-31', vat: 'excluded' } };
  const r = report({ sales: [sale, { ...sale, id: 'unknown', proposal: null }, { ...sale, id: 'linked', law_firm_id: firmId }] });
  assert.equal(r.forecastMonths[0].pipeline, 2500000); assert.equal(r.forecastMonths[0].pendingProposals, 1); assert.equal(r.forecastMonths[2].pipeline, 0); assert.equal(r.forecastMonths[0].projectedProfit, null);
});
test('pagination reads past configured row cap and rejects repeated pages', async () => {
  const server = load('lib/platform/operations-server.ts', { './operations': ops, './operations-meta': {} }); const values = [1,2,3,4,5];
  const rows = await server.allOperationRows(async offset => ({ data: values.slice(offset, offset + 2).map(id => ({ id: String(id) })), error: null }), r => r.id);
  assert.equal(rows.length, 5);
  await assert.rejects(server.allOperationRows(async () => ({ data: [{ id: 'repeat' }], error: null }), r => r.id));
});
test('GET is read-only/no-store; unauthorized POST performs no input read or mutation', async () => {
  let reads = 0, writes = 0;
  const route = load('app/api/platform/operations/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers }) } },
    '@/lib/platform/server': { requirePlatformUser: async (_, roles) => { assert.deepEqual(Array.from(roles), ['super_admin']); throw new Error('FORBIDDEN'); }, platformError: () => ({ status: 403, message: 'denied' }), writePlatformAudit: async () => writes++ },
    '@/lib/platform/operations': ops, '@/lib/platform/operations-server': { loadOperations: async () => { reads++; return {}; } },
  });
  const request = { headers: { get: () => { writes++; return 'application/json'; } }, body: { getReader: () => { writes++; } } };
  assert.equal((await route.POST(request)).status, 403); assert.equal(writes, 0); assert.equal(reads, 0);
  assert.equal((await route.GET(request)).status, 403); assert.equal(reads, 0);
  const source = fs.readFileSync(path.join(root, 'app/api/platform/operations/route.ts'), 'utf8');
  assert.match(source, /fetchCache = "force-no-store"/); assert.match(source, /revalidate = 0/);
});
test('unregistered service keeps positive price facts but does not classify them as sales', () => {
  const r = report({ commercialProfiles: [] }); assert.equal(r.totals.knownRevenue, 50000); assert.equal(r.totals.revenue, null); assert.equal(r.unregisteredFirms, 1);
});
test('new contact logs only: unknown historical calls remain unknown; invalid and future timestamps excluded', () => {
  const r = report({ leads: [{ id: 'lead1', law_firm_id: firmId, data: { contactLog: [
    { at: '2026-10-01T00:20:00+09:00', type: 'phone', connected: false },
    { at: '2026-10-01T00:30:00+09:00', type: 'phone', connected: true },
    { at: 'bad', type: 'phone', connected: true }, { at: '2027-01-01T00:00:00Z', type: 'phone', connected: true },
    { at: '2026-10-01T00:10:00+09:00', type: 'sms', connected: true },
  ] } }] });
  assert.equal(r.firms[0].phoneAttempts, 2); assert.equal(r.firms[0].phoneConnectionRate, 50); assert.equal(r.firms[0].firstCallMedianMinutes, 20);
  assert.equal(report().firms[0].firstCallMedianMinutes, null); assert.equal(report().firms[0].phoneConnectionRate, null);
});
test('contact KPIs use distinct DB denominators, recorded outcomes, and never current absence stage', () => {
  const call = connected => ({ at: '2026-10-01T01:00:00+09:00', type: 'phone', ...(connected === undefined ? {} : { connected }) });
  const leads = [
    { id: 'a', law_firm_id: firmId, data: { detailStage: '부재', contactLog: [call(false), call(true), call(false)] } },
    { id: 'b', law_firm_id: firmId, data: { detailStage: '상담', contactLog: [call(false), call(false)] } },
    { id: 'c', law_firm_id: firmId, data: { status: '상담완료' } },
    { id: 'd', law_firm_id: firmId, data: { status: '신규접수' } },
  ];
  const ledger = leads.map((l, i) => row({ id: String(i), lead_id: l.id })); ledger.push(row({ id: 'again', lead_id: 'a', classification: 'reentry' }));
  const r = report({ leads, ledger }).firms[0];
  assert.equal(r.supplied, 5); assert.equal(r.suppliedDb, 4); assert.equal(r.phoneAttemptedDb, 2);
  assert.equal(r.connectedDb, 1); assert.equal(r.unconnectedDb, 1); assert.equal(r.absenceRate, 50);
  assert.equal(r.contactRate, 25); assert.equal(r.consultedDb, 2); assert.equal(r.consultationRate, 50);
  leads[1].data.contactLog.push(call(undefined));
  const unknown = report({ leads, ledger }).firms[0]; assert.equal(unknown.absenceRate, null); assert.equal(unknown.contactRate, null); assert.equal(unknown.unknownConnectionDb, 1);
  assert.equal(report({ leads: [], ledger }).firms[0].consultationRate, null);
});
test('current seven-day stage dwell includes old unsupplied DB but excludes closed/converted and unknown history', () => {
  const now = '2026-10-18T00:00:00Z';
  const lead = (id, data = {}, law_firm_id = firmId) => ({ id, law_firm_id, data: { detailStage: '신규디비', stageUpdatedAt: '2026-10-11T00:00:00Z', ...data } });
  const currentStageLeads = [lead('boundary'), lead('recent', { stageUpdatedAt: '2026-10-11T00:00:01Z' }), lead('missing', { stageUpdatedAt: undefined }), lead('future', { stageUpdatedAt: '2026-10-19T00:00:00Z' }), lead('invalid', { stageUpdatedAt: 'bad' }), lead('converted', { convertedClientId: 'client' }), lead('closed', { status: '종결_중단' }), lead('rejected', { status: '거절' }), lead('foreign', {}, otherId)];
  const r = report({ currentStageLeads }, '2026-10', now).firms[0];
  assert.equal(r.neglectedDb, 1); assert.equal(r.stageRecordedDb, 2); assert.equal(r.stageUnrecordedDb, 3);
  assert.equal(report({ currentStageLeads: [lead('old')] }, '2026-08', now).firms[0].neglectedDb, 1);
});
test('consultation reached matches firm report explicit-stage precedence and client conversion', () => {
  const data = [{ detailStage: '상담' }, { detailStage: '설득필요' }, { detailStage: '착수금 안내' }, { status: '상담완료' }, { status: '고려중' }, { convertedClientId: 'client' }, { detailStage: '신규디비', status: '상담완료' }, { detailStage: '예약' }];
  const leads = data.map((data, id) => ({ id: String(id), law_firm_id: firmId, data }));
  const r = report({ leads, ledger: leads.map(l => row({ id: l.id, lead_id: l.id })) }).firms[0];
  assert.equal(r.consultedDb, 6); assert.equal(r.consultationRate, 75);
});
test('registered source names are tenant-joined and supply classifications have Korean labels', () => {
  const r = report({ adSources: [{ id: 'source', law_firm_id: otherId, name: '타 로펌 광고' }, { id: 'source', law_firm_id: firmId, name: '실제 등록 유입원' }] });
  assert.equal(r.sources[0].sourceName, '실제 등록 유입원');
  assert.equal(report({ adSources: [{ id: 'source', law_firm_id: otherId, name: '타 로펌 광고' }] }).sources[0].sourceName, undefined);
  assert.equal(ops.operationSupplyLabel('new'), '신규'); assert.equal(ops.operationSupplyLabel('reentry'), '재유입'); assert.match(ops.operationSupplyLabel('duplicate_phone'), /중복/);
});
test('Meta exact completed cache becomes actual cost, ambiguous/incomplete is not zero and manual overrides alone', () => {
  const actual = { firmId, month: '2026-10', amount: 20000, source: 'meta_actual' };
  const r = report({ metaCosts: [actual], adSpend: [{ firmId, month: '2026-10', amount: 999, source: 'firm_settings' }] }); assert.equal(r.totals.adSpend, 20000); assert.equal(r.firms[0].adSource, 'meta_actual');
  assert.equal(report({ metaCosts: [{ ...actual, amount: null, source: 'meta_ambiguous' }] }).totals.profit, null);
  const config = ops.emptyOperationsConfig(); config.adSpend = [{ firmId, amount: 12000, note: '' }];
  assert.equal(report({ metaCosts: [actual], monthRows: [{ month: '2026-10', config }] }).totals.adSpend, 12000);
});
test('Meta adapter rejects old fingerprint, shared account, non-KRW, failed refresh and duplicate rows', () => {
  const insight = load('lib/platform/meta-insights.ts');
  const meta = load('lib/platform/operations-meta.ts', { crypto: require('node:crypto'), './meta-insights': insight, './operations': ops });
  const connections = [{ id: 'c1', law_firm_id: firmId, ad_account_id: 'act_123', access_token_ciphertext: 'encrypted-value' }];
  const fingerprint = require('node:crypto').createHash('sha256').update(JSON.stringify(['123', 'v25.0', [['c1', 'encrypted-value']]])).digest('hex');
  const day = { accountId: '123', date: '2026-10-01', adId: 'ad1', spend: 123.45 };
  const cache = { account_id: '123', range_start: '2026-10-01', range_end: '2026-10-31', fingerprint, last_error: null, snapshot: { version: 1, accountId: '123', start: '2026-10-01', end: '2026-10-31', currency: 'KRW', fetchedAt: '2026-11-01T00:00:00Z', rows: [day] } };
  const calculate = (cs = connections, c = cache) => meta.operationMetaCosts(cs, [], [c], ['2026-10'], 'v25.0', new Date('2026-11-02T00:00:00Z'));
  assert.equal(calculate()[0].amount, 123.45);
  for (const c of [{ ...cache, fingerprint: 'old' }, { ...cache, last_error: 'error' }, { ...cache, snapshot: { ...cache.snapshot, currency: 'USD' } }, { ...cache, snapshot: { ...cache.snapshot, rows: [day, day] } }]) assert.equal(calculate(connections, c)[0].amount, null);
  assert.equal(calculate([...connections, { ...connections[0], id: 'c2', law_firm_id: otherId }])[0].source, 'meta_ambiguous');
  const now = new Date('2026-10-18T03:00:00Z');
  const mtd = { ...cache, range_end: '2026-10-18', snapshot: { ...cache.snapshot, end: '2026-10-18', fetchedAt: '2026-10-18T01:00:00Z' } };
  const current = c => meta.operationMetaCosts(connections, [], [c], ['2026-10'], 'v25.0', now)[0];
  assert.equal(current(mtd).amount, 123.45); assert.equal(current(cache).amount, null);
  assert.equal(current({ ...mtd, range_end: '2026-10-17', snapshot: { ...mtd.snapshot, end: '2026-10-17' } }).amount, null);
  assert.equal(current({ ...mtd, snapshot: { ...mtd.snapshot, fetchedAt: '2026-10-17T01:00:00Z' } }).amount, null);
  assert.equal(current({ ...mtd, snapshot: { ...mtd.snapshot, rows: [{ ...day, date: '2026-10-19' }] } }).amount, null);
  assert.equal(calculate(connections, { ...cache, snapshot: { ...cache.snapshot, fetchedAt: '2026-10-18T01:00:00Z' } })[0].amount, null);
});
test('advertising spreadsheet preview rejects mismatched firm, duplicate, blank, formulas and malformed currency', () => {
  const importer = load('lib/platform/operations-import.ts'); const header = importer.OPERATIONS_AD_HEADERS;
  const valid = importer.previewOperationsAds([header, [firmId, firm.name, '1,000', '근거'], [otherId, '다른 로펌', 0, '명시적 0원']], [firm, { ...firm, id: otherId, name: '다른 로펌' }]);
  assert.equal(valid.errors.length, 0); assert.equal(valid.rows[0].amount, 1000); assert.equal(valid.rows[1].amount, 0);
  for (const rows of [[[firmId, '틀린 이름', 100, '']], [[firmId, firm.name, '', '']], [[firmId, firm.name, '=1+1', '']], [[firmId, firm.name, '1,23', '']], [[firmId, firm.name, 1, ''], [firmId, firm.name, 2, '']]]) {
    const preview = importer.previewOperationsAds([header, ...rows], [firm]); assert.ok(preview.errors.length); assert.throws(() => importer.mergeOperationsAds([], preview));
  }
  const merged = importer.mergeOperationsAds([{ firmId, amount: 5, note: '' }], valid); assert.equal(merged.length, 2); assert.equal(merged[0].amount, 1000);
});
