// Pure, synthetic agreement and read-only server fixtures. No external services.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const ops = require('../lib/platform/operations.ts');
const fid = '11111111-1111-4111-8111-111111111111', cid = '22222222-2222-4222-8222-222222222222';
const terms = patch => ({ version: 1, quantityBasis: 'monthly', totalQuantity: null, cycleBasis: 'contract_month', paymentTiming: 'unspecified', lastPartial: 'included', ...patch });
const contract = patch => ({ id: cid, law_firm_id: fid, product: 'Synthetic', category: '회생', status: 'active', confirmed_at: '2026-10-18T00:00:00Z', revision: 2, unit_price: 50000, monthly_quantity: 500, start_date: '2026-10-21', end_date: '2027-01-22', billing_terms: terms(), ...patch });
const input = patch => ({ firms: [{ id: fid, name: 'Synthetic', status: 'active', firm_code: '1234567890', billing_type: 'per_lead' }], contracts: [contract()], adjustments: [], ledger: [], leads: [], cases: [], monthRows: [], adSpend: [], commercialProfiles: [{ law_firm_id: fid, service_mode: 'db_supply' }], ...patch });
const row = (id, patch = {}) => ({ id, law_firm_id: fid, lead_id: `lead-${id}`, classification: 'new', billable: true, billing_type: 'per_lead', unit_price_snapshot: 123, supplied_at: '2026-10-22T00:00:00Z', origin: 'ingest', supply_contract_id: cid, supply_contract_revision: 1, ad_source_id: null, ...patch });
const report = (data = input(), month = '2026-10', now = '2026-10-18T00:00:00Z') => ops.buildOperationsReport(data, month, false, new Date(now));

test('future confirmed agreement is 1500 DB and 75m remaining, starts later and has no invented current revenue or receipt', () => {
  const r = report(), p = r.contracts[0];
  assert.equal(p.totalExpected, 1500); assert.equal(p.remaining, 1500); assert.equal(p.agreementAmount, 75000000); assert.equal(r.remainingRevenue, 75000000);
  assert.equal(p.expectedToDate, 0); assert.equal(p.delivered, 0); assert.equal(p.status, 'scheduled'); assert.equal(p.forecast, null); assert.equal(p.fulfillment, null);
  assert.equal(p.neededPerDay, 1500 / 94); assert.equal(r.contractLifecycle.activeFirms, 0);
  assert.equal(r.totals.revenue, 0); assert.equal(r.totals.paid, null); assert.equal(r.alerts.filter(a => a.kind === 'risk' || a.kind === 'warning').length, 0);
});

test('confirmed remaining uses linked deliveries while original ledger prices, receipt and customer data remain untouched', () => {
  const data = input({ ledger: [row('1'), row('2'), row('other-contract', { supply_contract_id: 'other' }), row('backfill', { origin: 'backfill' }), row('duplicate', { classification: 'duplicate_phone', billable: false })], adjustments: [{ id: 'receipt', law_firm_id: fid, contract_id: cid, event_date: '2026-10-22', kind: 'receipt', quantity: 0, amount: 400, reason: 'synthetic' }], cases: [{ id: 'case', law_firm_id: fid, data: { contractAmount: 999, status: '진행중' } }] });
  const before = structuredClone(data), r = report(data, '2026-10', '2026-10-23T00:00:00Z'), p = r.contracts[0];
  assert.equal(p.delivered, 2); assert.equal(p.remaining, 1498); assert.equal(p.remainingAmount, 74900000); assert.equal(r.remainingRevenue, 74900000);
  assert.equal(r.totals.revenue, 369); assert.equal(r.totals.paid, 400); assert.deepEqual(data, before);
});

test('pacing follows exact period days and included tail adds neither quantity nor money', () => {
  const plan = ops.contractBillingPlan(contract());
  assert.equal(ops.agreementSupplyThrough(plan, '2026-10-20'), 0);
  assert.equal(ops.agreementSupplyThrough(plan, '2026-10-21'), 500 / 31);
  assert.equal(ops.agreementSupplyThrough(plan, '2026-11-20'), 500);
  assert.equal(ops.agreementSupplyThrough(plan, '2026-11-21'), 500 + 500 / 30);
  for (const day of ['2027-01-20', '2027-01-21', '2027-01-22', '2027-02-01']) assert.equal(ops.agreementSupplyThrough(plan, day), 1500);
  assert.throws(() => ops.agreementSupplyThrough(plan, '2026-02-30'));
  const r = report(input(), '2026-10'); assert.deepEqual(r.forecastMonths.map(p => p.committed), [25000000, 25000000, 0]);
  assert.ok(r.forecastMonths.every(p => p.agreementBasis === 'period_start'));
});

test('month-start agreement allocation obeys configured partial policy and ignores payment timing', () => {
  for (const paymentTiming of ['unspecified', 'prepaid', 'postpaid']) {
    const r = report(input({ contracts: [contract({ billing_terms: terms({ paymentTiming }) })] }));
    assert.deepEqual(r.forecastMonths.map(p => p.committed), [25000000, 25000000, 0]); assert.equal(r.totals.paid, null);
  }
  const prorated = report(input({ contracts: [contract({ billing_terms: terms({ lastPartial: 'prorate' }) })] }));
  assert.equal(prorated.forecastMonths[2].committed, 1612903); assert.equal(prorated.remainingRevenue, 76612903);
  const full = report(input({ contracts: [contract({ billing_terms: terms({ lastPartial: 'full' }) })] }));
  assert.equal(full.forecastMonths[2].committed, 25000000); assert.equal(full.contracts[0].totalExpected, 2000);
});

test('legacy unconfigured agreement stays unknown, including mixed overall totals, with known subtotal separate', () => {
  const legacy = contract({ id: 'legacy', billing_terms: null });
  const r = report(input({ contracts: [contract(), legacy] }));
  assert.equal(r.remainingRevenue, null); assert.equal(r.unconfiguredAgreements, 1); assert.equal(r.knownRemainingAgreement, 75000000);
  const p = r.contracts.find(p => p.contract.id === 'legacy'); assert.equal(p.status, 'unregistered'); assert.equal(p.totalExpected, null); assert.equal(p.expectedToDate, null); assert.equal(p.remainingAmount, null); assert.ok(p.legacyTotalEstimate > 1500);
  assert.equal(r.forecastMonths[0].committed, null); assert.equal(r.forecastMonths[0].knownCommitted, 25000000); assert.equal(r.forecastMonths[0].unconfiguredContracts, 1); assert.equal(r.forecastMonths[0].projectedRevenue, null);
});

test('missing price cannot silently disappear from otherwise confirmed forecast', () => {
  const r = report(input({ contracts: [contract(), contract({ id: 'missing-price', unit_price: null })] }));
  assert.equal(r.remainingRevenue, null); assert.equal(r.unconfiguredAgreements, 1); assert.equal(r.forecastMonths[0].committed, null); assert.equal(r.forecastMonths[0].knownCommitted, 25000000);
});

test('total quantity spans one term for pacing and contributes only once in its start month', () => {
  const c = contract({ start_date: '2026-11-01', end_date: '2026-11-30', monthly_quantity: null, billing_terms: terms({ quantityBasis: 'total', totalQuantity: 300 }) });
  const r = report(input({ contracts: [c] })); assert.deepEqual(r.forecastMonths.map(f => f.committed), [15000000, 0, 0]);
  const plan = ops.contractBillingPlan(c); assert.equal(ops.agreementSupplyThrough(plan, '2026-11-15'), 150);
  const inPeriod = report(input({ contracts: [c] }), '2026-11', '2026-11-15T00:00:00Z'); assert.equal(inPeriod.contracts[0].totalExpected, 300); assert.equal(inPeriod.contracts[0].remaining, 300); assert.equal(inPeriod.remainingRevenue, 15000000);
});

test('delivery membership respects contract bounds, today, tenant and backfill; overdelivery cannot make negative remaining', () => {
  const c = contract({ monthly_quantity: 1, end_date: '2026-11-20' });
  const rows = [row('pre', { supplied_at: '2026-10-20T14:59:59Z' }), row('start', { supplied_at: '2026-10-20T15:00:00Z' }), row('extra'), row('end', { supplied_at: '2026-11-20T14:59:59Z' }), row('after', { supplied_at: '2026-11-20T15:00:00Z' }), row('future', { supplied_at: '2026-11-22T00:00:00Z' }), row('foreign', { law_firm_id: 'foreign' })];
  const r = report(input({ contracts: [c], ledger: rows }), '2026-11', '2026-11-21T00:00:00Z');
  assert.equal(r.contracts[0].delivered, 3); assert.equal(r.contracts[0].outsidePeriodDeliveries, 2); assert.equal(r.contracts[0].remaining, 0); assert.equal(r.remainingRevenue, 0); assert.equal(r.contracts[0].neededPerDay, null);
});

test('read handler preserves historical closed snapshots byte-for-byte without applying new agreement basis', async () => {
  const filename = path.resolve(__dirname, '../lib/platform/operations-server.ts'), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Map, Set, structuredClone })(name => name === './operations' ? ops : name === './operations-meta' ? { readOperationsMeta: async () => [] } : assert.fail(name), module, module.exports);
  const snapshot = report(); delete snapshot.remainingAgreementBasis; delete snapshot.unconfiguredAgreements; delete snapshot.knownRemainingAgreement;
  snapshot.remainingRevenue = 76612903; snapshot.contracts = []; snapshot.forecastMonths = [{ month: '2026-11', committed: 123, pipeline: 0, projectedRevenue: 123, projectedProfit: null, projectedOperatingProfit: null, pendingProposals: 0 }];
  const original = structuredClone(snapshot), rows = { platform_operations_months: [{ month: '2026-10', config: ops.emptyOperationsConfig(), closed_at: '2026-11-01', snapshot }], law_firms: input().firms, platform_supply_contracts: [contract()], platform_firm_commercial_profiles: input().commercialProfiles };
  const admin = { from(table) { const predicates = [], q = { select: () => q, order: () => q, abortSignal: () => q, gte: (k,v) => (predicates.push(r=>r[k]>=v),q), lte: (k,v) => (predicates.push(r=>r[k]<=v),q), lt: (k,v) => (predicates.push(r=>r[k]<v),q), eq: (k,v) => (predicates.push(r=>r[k]===v),q), neq: (k,v) => (predicates.push(r=>r[k]!==v),q), in: (k,v) => (predicates.push(r=>v.includes(r[k])),q), range: (a,b) => Promise.resolve({ data: (rows[table] ?? []).filter(r=>predicates.every(p=>p(r))).slice(a,b+1), error: null }) }; return q; } };
  const result = await module.exports.loadOperations(admin, '2026-10', false, undefined, new Date('2026-10-18T00:00:00Z'));
  assert.equal(result.report.remainingRevenue, 76612903); assert.equal(result.report.remainingAgreementBasis, undefined); assert.deepEqual(result.report.forecastMonths, original.forecastMonths); assert.deepEqual(snapshot, original);
});
