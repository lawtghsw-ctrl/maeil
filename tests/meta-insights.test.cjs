const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}, cache = new Map()) {
  const name = path.resolve(root, file);
  if (cache.has(name)) return cache.get(name).exports;
  const module = { exports: {} }; cache.set(name, module);
  const source = ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const requireFile = request => {
    if (request in mocks) return mocks[request];
    if (request.startsWith('.') || request.startsWith('@/')) return load((request.startsWith('@/') ? request.slice(2) : path.relative(root, path.resolve(path.dirname(name), request))) + '.ts', mocks, cache);
    return require(request);
  };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { URL, Response, Request, AbortController, TextDecoder, setTimeout, clearTimeout, Intl, Date, process: { env: { META_GRAPH_API_VERSION: 'v25.0' } }, fetch: () => { throw new Error('Unexpected live fetch'); } }, { filename: name })(requireFile, module, module.exports);
  return module.exports;
}
const pure = load('lib/platform/meta-insights.ts');
const graph = load('lib/platform/meta-insights-graph.ts');
const start = '2026-10-01', end = '2026-10-31';
const connection = (id = 'm1', lawFirmId = 'f1') => ({ id, lawFirmId, firmName: lawFirmId, name: id, accountId: '123', hasToken: true, hasReadToken: false });
const day = (patch = {}) => ({ date: start, accountId: '123', adId: '456', adName: '회생 광고', campaignId: '789', campaignName: '캠페인', adsetId: '890', adsetName: '세트', spend: 1000, impressions: 500, clicks: 10, metaLeads: 2, ...patch });
const snapshot = (patch = {}) => ({ version: 1, accountId: '123', accountName: '광고계정', currency: 'KRW', timezone: 'Asia/Seoul', start, end, fetchedAt: '2026-10-18T00:00:00Z', rows: [day()], ...patch });
const account = (patch = {}) => ({ accountId: '123', connections: [connection()], status: 'cached', error: null, snapshot: snapshot(), ...patch });
const lead = (patch = {}) => ({ id: 'l1', law_firm_id: 'f1', meta_account_id: 'm1', receivedAt: '2026-09-30T15:00:00Z', platform: { metaAccountId: 'm1', adId: '456' }, ...patch });
const supply = (patch = {}) => ({ id: 's1', law_firm_id: 'f1', lead_id: 'l1', supplied_at: '2026-10-01T00:00:00+09:00', classification: 'new', billable: true, billing_type: 'per_lead', unit_price_snapshot: 2500, ...patch });
const fixture = (patch = {}) => ({ start, end, accounts: [account()], unconfigured: [], leads: [lead()], cases: [{ id: 'c1', law_firm_id: 'f1', fromLeadId: 'l1', contractAmount: '50000', status: '진행' }], supplies: [supply()], firms: [{ id: 'f1', name: '로펌', billing_type: 'per_lead' }], commercialProfiles: [{ law_firm_id: 'f1', service_mode: 'db_supply' }], ...patch });
test('range, ID normalization and Korean date boundaries', () => {
  assert.equal(pure.normalizeAdAccountId(' act_123 '), '123'); assert.equal(pure.normalizeAdAccountId('../123'), null);
  assert.throws(() => pure.validateInsightRange('2026-02-30', end)); assert.throws(() => pure.validateInsightRange('2026-01-01', end));
  assert.equal(pure.insightDate('2026-09-30T15:00:00Z', 'Asia/Seoul'), start);
  assert.equal(pure.insightDate('2026-10-01T00:00', 'America/Los_Angeles'), '2026-09-30');
});
test('actual spend, distinct CRM contract cohort, zero/negative margin definitions', () => {
  const input = fixture(); input.cases.push({ ...input.cases[0], id: 'c2' });
  const result = pure.aggregateMetaInsights(input);
  assert.equal(result.totals.spend, 1000); assert.equal(result.totals.metaCpl, 500); assert.equal(result.totals.crmLeads, 1); assert.equal(result.totals.contracts, 1);
  assert.equal(result.totals.conversionRate, 100); assert.equal(result.totals.supplyRevenue, 2500); assert.equal(result.totals.marginRate, 60);
  const zero = pure.aggregateMetaInsights(fixture({ supplies: [supply({ unit_price_snapshot: 0 })] }));
  assert.equal(zero.totals.supplyRevenue, null); assert.equal(zero.totals.contribution, null); assert.equal(zero.totals.marginRate, null);
});

test('only rehabilitation advertisement names contribute to totals, CRM, contracts and supply', () => {
  const other = day({ adId: '666', adName: '불법사채 광고', campaignName: '회생 캠페인', adsetName: '회생 세트', spend: 9000, metaLeads: 30 });
  const input = fixture({ accounts: [account({ snapshot: snapshot({ rows: [day(), other] }) })] });
  input.leads.push(lead({ id: 'other', adName: '회생이라는 잘못된 CRM 이름', platform: { metaAccountId: 'm1', adId: '666' } }));
  input.cases.push({ ...input.cases[0], id: 'other-case', fromLeadId: 'other' });
  input.supplies.push(supply({ id: 'other-supply', lead_id: 'other', unit_price_snapshot: 99999 }));
  const before = JSON.stringify(input), result = pure.aggregateMetaInsights(input);
  assert.equal(result.ads.length, 1); assert.equal(result.ads[0].adId, '456');
  assert.equal(result.totals.spend, 1000); assert.equal(result.totals.metaLeads, 2);
  assert.equal(result.totals.crmLeads, 1); assert.equal(result.totals.contracts, 1);
  assert.equal(result.totals.supplyRevenue, 2500); assert.equal(result.totals.marginRate, 60);
  assert.equal(result.quality.unattributedSupply, 0);
  assert.equal(result.accounts[0].snapshot.rows.length, 1);
  assert.ok(!JSON.stringify(result).includes('불법사채'));
  assert.equal(JSON.stringify(input), before);
});

test('completed other-product-only account is a real zero without inventing conversion or revenue', () => {
  const result = pure.aggregateMetaInsights(fixture({ accounts: [account({ snapshot: snapshot({ rows: [day({ adName: '불법사채 광고' })] }) })] }));
  assert.equal(result.totals.spend, 0); assert.equal(result.totals.metaLeads, 0);
  assert.equal(result.totals.crmLeads, 0); assert.equal(result.totals.contracts, 0);
  assert.equal(result.totals.supplyRevenue, 0); assert.equal(result.totals.conversionRate, null);
  assert.equal(result.ads.length, 0); assert.equal(result.quality.unattributedLeads, 0);
  assert.equal(result.quality.unattributedSupply, 0);
});

test('missing provider ad name is incomplete rather than a confirmed zero cost', () => {
  for (const adName of ['', '   ', null]) {
    const result = pure.aggregateMetaInsights(fixture({ accounts: [account({ snapshot: snapshot({ rows: [day({ adName })] }) })], leads: [], cases: [], supplies: [] }));
    assert.equal(result.totals.spend, null); assert.equal(result.quality.incompleteAccounts, 1);
    assert.equal(result.accounts[0].status, 'error'); assert.equal(result.ads.length, 0);
  }
});

test('omitted zero-spend CRM ad requires a recorded rehabilitation name', () => {
  const empty = [account({ snapshot: snapshot({ rows: [] }) })];
  const named = pure.aggregateMetaInsights(fixture({ accounts: empty, leads: [lead({ adName: '신규 개인회생 광고' })] }));
  assert.equal(named.totals.spend, 0); assert.equal(named.totals.crmLeads, 1);
  assert.equal(named.totals.contracts, 1); assert.equal(named.ads[0].adName, '신규 개인회생 광고');
  const unnamed = pure.aggregateMetaInsights(fixture({ accounts: empty }));
  assert.equal(unnamed.ads.length, 0); assert.equal(unnamed.totals.crmLeads, 0);
  assert.equal(unnamed.quality.unattributedLeads, 1); assert.equal(unnamed.totals.supplyRevenue, null);
});

test('zero-spend fallback checks each CRM name and is independent of input order', () => {
  const yes = lead({ adName: '회생 광고' });
  const no = lead({ id: 'other', adName: '불법사채 광고' });
  const absent = lead({ id: 'unnamed' });
  for (const leads of [[yes, no, absent], [absent, no, yes], [no, yes, absent]]) {
    const input = fixture({ accounts: [account({ snapshot: snapshot({ rows: [] }) })], leads });
    input.cases.push({ ...input.cases[0], id: 'other-case', fromLeadId: 'other' });
    const result = pure.aggregateMetaInsights(input);
    assert.equal(result.totals.crmLeads, 1); assert.equal(result.totals.contracts, 1);
    assert.equal(result.ads.length, 1); assert.equal(result.ads[0].adName, '회생 광고');
    assert.equal(result.quality.unattributedLeads, 1);
  }
});

test('rehabilitation classification never crosses accounts with the same ad ID', () => {
  const otherAccount = account({ accountId: '222', connections: [{ ...connection('m2', 'f2'), accountId: '222' }], snapshot: snapshot({ accountId: '222', rows: [day({ accountId: '222', adName: '다른 상품', spend: 7000 })] }) });
  const result = pure.aggregateMetaInsights(fixture({ accounts: [account(), otherAccount], leads: [lead(), lead({ law_firm_id: 'f2', meta_account_id: 'm2', platform: { metaAccountId: 'm2', adId: '456' } })], commercialProfiles: [{ law_firm_id: 'f1', service_mode: 'db_supply' }, { law_firm_id: 'f2', service_mode: 'db_supply' }] }));
  assert.equal(result.ads.length, 1); assert.equal(result.totals.spend, 1000);
  assert.equal(result.totals.crmLeads, 1); assert.equal(result.accounts[1].snapshot.rows.length, 0);
});
test('duplicate external account connections count spend once, exact tenant joins', () => {
  const result = pure.aggregateMetaInsights(fixture({ accounts: [account({ connections: [connection(), connection('m2', 'f2')] })], cases: [{ id: 'x', law_firm_id: 'f2', fromLeadId: 'l1', contractAmount: 1, status: '진행' }] }));
  assert.equal(result.totals.spend, 1000); assert.equal(result.totals.contracts, 0);
});
test('invalid/ad-mismatched or missing lineage is unknown; no ad-name guessing', () => {
  const result = pure.aggregateMetaInsights(fixture({ leads: [lead({ platform: { metaAccountId: 'other', adId: '456', adName: '광고' } })] }));
  assert.equal(result.quality.unattributedLeads, 1); assert.equal(result.quality.unattributedSupply, 1); assert.equal(result.totals.supplyRevenue, null); assert.equal(result.totals.marginRate, null);
});
test('recorded referrals suppress only the unattributed-lead warning across missing lineage and missing ad evidence', () => {
  const scenarios = [
    { leads: [lead({ meta_account_id: null, platform: null })] },
    { leads: [lead({ platform: { metaAccountId: 'm1' } })] },
    { accounts: [account({ snapshot: null, status: 'not_synced' })] },
    { accounts: [account({ snapshot: snapshot({ rows: [] }) })] },
  ];
  for (const patch of scenarios) {
    const input = fixture(patch);
    const baseline = pure.aggregateMetaInsights(input);
    assert.equal(baseline.quality.unattributedLeads, 1);
    input.leads = input.leads.map(row => ({ ...row, source: '지인소개' }));
    const before = JSON.stringify(input), result = pure.aggregateMetaInsights(input);
    assert.equal(result.quality.unattributedLeads, 0);
    // Source affects this warning alone, even when supply or account quality is incomplete.
    const comparable = value => JSON.stringify({ ...value, generatedAt: null, quality: { ...value.quality, unattributedLeads: 0 } });
    assert.equal(comparable(result), comparable(baseline));
    assert.equal(JSON.stringify(input), before);
  }
});
test('25 unresolved records retain all 19 unspecified and one Meta warning while excluding five explicit referrals', () => {
  const leads = Array.from({ length: 25 }, (_, index) => lead({
    id: `unresolved-${index}`, meta_account_id: null, platform: null,
    source: index < 5 ? '지인소개' : index === 24 ? '메타' : null,
  }));
  const input = fixture({ leads, cases: [], supplies: [] });
  const before = JSON.stringify(input), result = pure.aggregateMetaInsights(input);
  assert.equal(result.quality.unattributedLeads, 20);
  assert.equal(result.totals.crmLeads, 0); assert.equal(result.totals.contracts, 0);
  assert.equal(result.totals.spend, 1000); assert.equal(result.totals.metaLeads, 2);
  assert.equal(JSON.stringify(input), before);
  const baseline = pure.aggregateMetaInsights({ ...input, leads: leads.map(row => ({ ...row, source: null })) });
  assert.equal(baseline.quality.unattributedLeads, 25);
  assert.deepEqual(result.totals, baseline.totals); assert.deepEqual(result.ads, baseline.ads);
});
test('referral source never removes a valid CRM cohort, contract, supply or cost association', () => {
  for (const accounts of [[account()], [account({ snapshot: snapshot({ rows: [] }) })]]) {
    const input = fixture({ accounts, leads: [lead({ adName: '회생 광고' })] });
    const baseline = pure.aggregateMetaInsights(input);
    const referralInput = { ...input, leads: input.leads.map(row => ({ ...row, source: '지인소개' })) };
    const before = JSON.stringify(referralInput), result = pure.aggregateMetaInsights(referralInput);
    assert.equal(result.totals.crmLeads, 1); assert.equal(result.totals.contracts, 1);
    assert.equal(result.totals.supplyRevenue, 2500); assert.equal(result.totals.conversionRate, 100);
    assert.equal(JSON.stringify({ ...result, generatedAt: null }), JSON.stringify({ ...baseline, generatedAt: null }));
    assert.equal(JSON.stringify(referralInput), before);
  }
});
test('other or merely similar source labels remain unresolved and date/tenant boundaries stay unchanged', () => {
  const sources = [undefined, null, '', '메타', '네이버', '구글', '유튜브', '인스타그램', '쓰레드', '기타', '소개', '지인 소개', '지인소개 ', ' 지인소개', '지인소개(직원)'];
  const leads = sources.map((source, index) => lead({ id: `source-${index}`, meta_account_id: null, platform: null, source }));
  const result = pure.aggregateMetaInsights(fixture({ leads, cases: [], supplies: [] }));
  assert.equal(result.quality.unattributedLeads, sources.length);
  const outOfScope = [null, '', 'invalid', '2026-09-30T14:59:59Z', '2026-10-31T15:00:00Z'].flatMap((receivedAt, index) =>
    [null, '지인소개'].map((source, variant) => lead({ id: `outside-${index}-${variant}`, meta_account_id: null, platform: null, source, receivedAt })));
  outOfScope.push(lead({ id: 'unrelated-referral', law_firm_id: 'unrelated', meta_account_id: null, platform: null, source: '지인소개' }));
  const outside = pure.aggregateMetaInsights(fixture({ leads: outOfScope, cases: [], supplies: [] }));
  assert.equal(outside.quality.unattributedLeads, 0);
});
test('unrelated firms do not invalidate connected-account margin', () => {
  const result = pure.aggregateMetaInsights(fixture({ leads: [lead(), lead({ id: 'other', law_firm_id: 'unrelated', platform: null })], supplies: [supply(), supply({ id: 'other', law_firm_id: 'unrelated', lead_id: null })] }));
  assert.equal(result.quality.unattributedLeads, 0); assert.equal(result.quality.unattributedSupply, 0); assert.equal(result.totals.marginRate, 60);
});
test('CRM-only has real advertising/CRM metrics but is outside supply revenue and margin', () => {
  const result = pure.aggregateMetaInsights(fixture({ commercialProfiles: [{ law_firm_id: 'f1', service_mode: 'crm_only' }], supplies: [supply({ unit_price_snapshot: 0 }), supply({ lead_id: null, unit_price_snapshot: null })] }));
  assert.equal(result.totals.spend, 1000); assert.equal(result.totals.crmLeads, 1); assert.equal(result.totals.conversionRate, 100);
  assert.equal(result.totals.supplyRevenue, null); assert.equal(result.totals.contribution, null); assert.equal(result.totals.marginRate, null); assert.equal(result.quality.unattributedSupply, 0);
  assert.equal(result.ads[0].supplyScope, 'not_applicable'); assert.match(result.ads[0].attributionNote, /비대상/);
});
test('unregistered profile cannot imply a confirmed sale or margin from old billing mode', () => {
  const result = pure.aggregateMetaInsights(fixture({ commercialProfiles: [] }));
  assert.equal(result.totals.supplyRevenue, null); assert.equal(result.totals.contribution, null); assert.equal(result.quality.pendingBillingFirms, 1); assert.equal(result.ads[0].supplyScope, 'unknown');
});
test('shared CRM-only and supply account has unknown spend allocation without double counting', () => {
  const result = pure.aggregateMetaInsights(fixture({ accounts: [account({ connections: [connection(), connection('m2', 'crm')] })], commercialProfiles: [{ law_firm_id: 'f1', service_mode: 'db_supply' }, { law_firm_id: 'crm', service_mode: 'crm_only' }] }));
  assert.equal(result.totals.spend, 1000); assert.equal(result.totals.supplyRevenue, null); assert.equal(result.totals.supplyAdSpend, null); assert.equal(result.totals.contribution, null);
});
test('separate CRM-only account spend is excluded from supply margin but included in all-account advertising', () => {
  const crmAccount = account({ accountId: '222', connections: [{ ...connection('m2', 'crm'), accountId: '222' }], snapshot: snapshot({ accountId: '222', rows: [day({ accountId: '222', adId: '999', spend: 5000 })] }) });
  const result = pure.aggregateMetaInsights(fixture({ accounts: [account(), crmAccount], commercialProfiles: [{ law_firm_id: 'f1', service_mode: 'db_supply' }, { law_firm_id: 'crm', service_mode: 'crm_only' }] }));
  assert.equal(result.totals.spend, 6000); assert.equal(result.totals.supplyRevenue, 2500); assert.equal(result.totals.supplyAdSpend, 1000); assert.equal(result.totals.contribution, 1500); assert.equal(result.totals.marginRate, 60);
});
test('monthly/manual duplicate-only history and invalid prices never invent revenue', () => {
  for (const billing_type of ['monthly', 'manual']) {
    const result = pure.aggregateMetaInsights(fixture({ supplies: [supply({ billable: false, classification: 'duplicate_phone', billing_type })] }));
    assert.equal(result.totals.supplyRevenue, null); assert.equal(result.quality.pendingBillingFirms, 1);
  }
  assert.equal(pure.aggregateMetaInsights(fixture({ supplies: [supply({ unit_price_snapshot: -1 })] })).totals.marginRate, null);
});
test('withdrawn/zero contracts excluded; supply date and received cohort stay separate', () => {
  const result = pure.aggregateMetaInsights(fixture({ leads: [lead({ receivedAt: '2026-09-01T00:00:00Z' })], cases: [{ id: 'c', law_firm_id: 'f1', fromLeadId: 'l1', contractAmount: 10, status: '진행' }] }));
  assert.equal(result.totals.crmLeads, 0); assert.equal(result.totals.contracts, 0); assert.equal(result.totals.supplyRevenue, 2500);
  for (const patch of [{ status: '취하' }, { contractAmount: 0 }]) assert.equal(pure.aggregateMetaInsights(fixture({ cases: [{ ...fixture().cases[0], ...patch }] })).totals.contracts, 0);
});
test('multi-currency total, stale failure and empty data remain explicit', () => {
  assert.equal(pure.aggregateMetaInsights(fixture({ accounts: [account({ snapshot: snapshot({ currency: 'USD' }) })] })).totals.marginRate, null);
  const failed = pure.aggregateMetaInsights(fixture({ accounts: [account({ status: 'error', error: '조회 실패' })] }));
  assert.equal(failed.totals.spend, null); assert.equal(failed.ads[0].spend, 1000); assert.equal(failed.quality.incompleteAccounts, 1);
  const empty = pure.aggregateMetaInsights(fixture({ accounts: [], leads: [], cases: [], supplies: [] }));
  assert.equal(empty.totals.spend, null); assert.equal(empty.totals.metaCpl, null);
});

const graphRaw = (patch = {}) => ({ account_id: '123', account_currency: 'KRW', ad_id: '456', ad_name: '광고', date_start: start, date_stop: start, spend: '1000.25', impressions: '100', clicks: '5', actions: [{ action_type: 'lead', value: '2' }, { action_type: 'onsite_conversion.lead_grouped', value: '2' }], ...patch });
function graphHarness(pages) {
  const requests = [];
  const fetcher = async (url, init) => { requests.push({ url, init }); if (requests.length === 1) return Response.json({ account_id: '123', name: '테스트', currency: 'KRW', timezone_name: 'Asia/Seoul' }); const value = pages[requests.length - 2]; return value instanceof Response ? value : Response.json(value); };
  return { requests, run: () => graph.fetchMetaInsights({ accountId: '123', token: 'private-token', version: 'v25.0', start, end, fetcher }) };
}
test('Graph uses GET only, Bearer header, fixed host, no redirects; no duplicate lead actions', async () => {
  const h = graphHarness([{ data: [graphRaw()] }]); const result = await h.run();
  assert.equal(result.rows[0].metaLeads, 2); assert.equal(result.rows[0].spend, 1000.25);
  for (const r of h.requests) { assert.equal(r.init.method, 'GET'); assert.equal(r.init.redirect, 'error'); assert.equal(r.init.cache, 'no-store'); assert.equal(r.init.headers.Authorization, 'Bearer private-token'); assert.ok(!r.url.includes('private-token')); }
});
test('all pages read before complete result; provider next URL not blindly followed', async () => {
  const h = graphHarness([{ data: [graphRaw()], paging: { next: 'https://graph.facebook.com/v25.0/act_123/insights?access_token=untrusted&fields=wrong', cursors: { after: 'cursor-1' } } }, { data: [graphRaw({ date_start: '2026-10-02', date_stop: '2026-10-02' })] }]);
  const result = await h.run(); assert.equal(result.rows.length, 2);
  assert.ok(h.requests[2].url.includes('after=cursor-1')); assert.ok(!h.requests[2].url.includes('untrusted'));
});
test('partial page errors are rejected without provider error/secret echo', async () => {
  const h = graphHarness([{ data: [graphRaw()], paging: { next: 'https://graph.facebook.com/v25.0/act_123/insights', cursors: { after: 'a' } } }, Response.json({ error: { code: 190, message: 'private-token secret raw error' } }, { status: 400 })]);
  await assert.rejects(h.run(), e => e.code === 'PERMISSION' && !e.message.includes('private-token'));
});
test('foreign hosts, duplicate rows, malformed dates and currencies are rejected', async () => {
  for (const page of [
    { data: [graphRaw()], paging: { next: 'https://attacker.test/', cursors: { after: 'a' } } },
    { data: [graphRaw(), graphRaw()] }, { data: [graphRaw({ account_currency: 'USD' })] },
    { data: [graphRaw({ date_start: '2026-11-01', date_stop: '2026-11-01' })] },
    { data: [graphRaw({ spend: '-1' })] }, { data: [graphRaw({ ad_name: '' })] },
    { data: [graphRaw({ ad_name: '   ' })] }, { data: [graphRaw({ ad_name: null })] },
  ]) await assert.rejects(graphHarness([page]).run(), e => e.code === 'INVALID_RESPONSE');
});
test('Graph repeated pagination fails instead of publishing a partial result', async () => {
  const page = index => ({ data: [graphRaw({ ad_id: String(index) })], paging: { next: 'https://graph.facebook.com/v25.0/act_123/insights', cursors: { after: 'same' } } });
  await assert.rejects(graphHarness([page(111), page(222)]).run(), e => e.code === 'INVALID_RESPONSE');
});
test('Graph aborted/network calls use a sanitized error', async () => {
  await assert.rejects(graph.fetchMetaInsights({ accountId: '123', token: 'secret', version: 'v25.0', start, end, fetcher: async () => { throw new Error('secret'); } }), e => e.code === 'NETWORK' && !e.message.includes('secret'));
});

function routeHarness({ role = 'super_admin', graphResult = snapshot(), graphError = null, pageCap = 137 } = {}) {
  const id = '11111111-1111-1111-1111-111111111111';
  const database = {
    firm_meta_accounts: [{ id, law_firm_id: 'f1', name: '연결1', ad_account_id: 'act_123', access_token_ciphertext: 'encrypted-capi', active: true }, { id: '22222222-2222-2222-2222-222222222222', law_firm_id: 'f1', name: '중복연결', ad_account_id: '123', access_token_ciphertext: 'encrypted-capi', active: true }],
    platform_meta_insights_tokens: [], platform_meta_insights_cache: [], law_firms: fixture().firms, platform_firm_commercial_profiles: fixture().commercialProfiles,
    app_leads: [{ ...lead(), meta_account_id: id, platform: { metaAccountId: id, adId: '456' } }], app_cases: fixture().cases, lead_supply_ledger: fixture().supplies,
  };
  const writes = [], reads = [], projections = [], graphCalls = [];
  function from(table) {
    reads.push(table); let filters = [], offset = 0, to = Infinity, single = false, write = null;
    const q = {
      select(columns) { projections.push({ table, columns }); return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; }, neq(k, v) { filters.push(r => r[k] !== v); return q; }, gte(k, v) { filters.push(r => r[k] >= v); return q; }, lt(k, v) { filters.push(r => r[k] < v); return q; }, order() { return q; }, abortSignal() { return q; }, range(a, b) { offset = a; to = b; return q; }, maybeSingle() { single = true; return q; },
      upsert(payload, options) { write = { kind: 'upsert', payload, options }; return q; }, delete() { write = { kind: 'delete' }; return q; },
      then(resolve) {
        let data;
        if (write) {
          writes.push({ table, ...write });
          if (write.kind === 'delete') database[table] = database[table].filter(r => !filters.every(f => f(r)));
          else { const keys = write.options.onConflict.split(','); const existing = database[table].find(r => keys.every(k => r[k] === write.payload[k])); if (existing) Object.assign(existing, write.payload); else database[table].push({ ...write.payload }); }
          data = null;
        } else { const result = database[table].filter(r => filters.every(f => f(r))).slice(offset, Math.min(to + 1, offset + pageCap)); data = single ? result[0] || null : result; }
        return Promise.resolve(resolve({ data, error: null }));
      },
    }; return q;
  }
  const route = load('app/api/platform/meta-insights/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/platform/server': { requirePlatformUser: async (_request, allowed) => { if (!allowed.includes(role)) throw new Error('FORBIDDEN'); return { admin: { from }, profile: { id: 'user' } }; }, platformError: e => ({ status: e.message === 'FORBIDDEN' ? 403 : 400, message: e.message }), decryptIntegrationSecret: () => 'never-return-this-token', encryptIntegrationSecret: () => 'new-encrypted-read-token' },
    '@/lib/platform/meta-insights-graph': { MetaInsightsError: graph.MetaInsightsError, fetchMetaInsights: async args => { graphCalls.push(args); if (graphError) throw graphError; return graphResult; } },
  });
  const request = (method = 'GET', body) => Object.assign(new Request(`https://app.test/api/platform/meta-insights?start=${start}&end=${end}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }), { nextUrl: new URL(`https://app.test/?start=${start}&end=${end}`) });
  return { route, request, database, writes, reads, projections, graphCalls, id };
}
test('all API methods deny firm administrators before reading data', async () => {
  for (const method of ['GET', 'POST', 'PATCH']) { const h = routeHarness({ role: 'firm_admin' }); const response = await h.route[method](h.request(method, method === 'GET' ? undefined : {})); assert.equal(response.status, 403); assert.equal(h.reads.length, 0); assert.equal(h.graphCalls.length, 0); }
});
test('GET performs no Meta request and duplicate registrations return one account', async () => {
  const h = routeHarness(); const response = await h.route.GET(h.request()); const body = await response.json();
  assert.equal(body.accounts.length, 1); assert.equal(body.accounts[0].connections.length, 2); assert.equal(h.graphCalls.length, 0); assert.equal(h.writes.length, 0); assert.equal(body.totals.spend, null); assert.ok(!JSON.stringify(body).includes('encrypted-capi')); assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('GET explicitly reads the stored source and excludes only five referral warnings without any mutation or Meta request', async () => {
  const h = routeHarness();
  h.database.app_leads = Array.from({ length: 25 }, (_, index) => ({
    ...h.database.app_leads[0], id: `unresolved-${index}`, meta_account_id: null, platform: null,
    source: index < 5 ? '지인소개' : index === 24 ? '메타' : null,
  }));
  const before = JSON.stringify(h.database), response = await h.route.GET(h.request()), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.quality.unattributedLeads, 20);
  const leadReads = h.projections.filter(item => item.table === 'app_leads');
  assert.ok(leadReads.length > 0);
  assert.ok(leadReads.every(item => item.columns.split(',').includes('source:data->>source')));
  assert.equal(h.writes.length, 0); assert.equal(h.graphCalls.length, 0);
  assert.equal(JSON.stringify(h.database), before);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('refresh uses only registered credentials and publishes complete snapshot once', async () => {
  const h = routeHarness(); const response = await h.route.POST(h.request('POST', { action: 'refresh', accountId: '123', start, end, token: 'attacker' }));
  assert.equal((await response.json()).ok, true); assert.equal(h.graphCalls.length, 1); assert.equal(h.graphCalls[0].token, 'never-return-this-token');
  assert.deepEqual(h.writes.map(w => w.table), ['platform_meta_insights_cache']);
  const body = await (await h.route.GET(h.request())).json(); assert.equal(body.accounts[0].status, 'cached'); assert.equal(body.totals.spend, 1000);
});

test('GET scopes old full-account caches without writes or another Meta request', async () => {
  const h = routeHarness({ graphResult: snapshot({ rows: [day(), day({ adId: '666', adName: '불법사채 광고', spend: 5000 })] }) });
  await h.route.POST(h.request('POST', { action: 'refresh', accountId: '123', start, end }));
  const cacheBefore = JSON.stringify(h.database.platform_meta_insights_cache);
  assert.equal(h.database.platform_meta_insights_cache[0].snapshot.rows.length, 2);
  const body = await (await h.route.GET(h.request())).json();
  assert.equal(body.totals.spend, 1000); assert.equal(body.ads.length, 1);
  assert.equal(body.accounts[0].snapshot.rows.length, 1);
  assert.ok(!JSON.stringify(body).includes('불법사채'));
  assert.equal(JSON.stringify(h.database.platform_meta_insights_cache), cacheBefore);
  assert.equal(h.writes.length, 1); assert.equal(h.graphCalls.length, 1);
});
test('failed refresh does not write a partial snapshot or echo credentials', async () => {
  const h = routeHarness({ graphError: new graph.MetaInsightsError('PERMISSION', '조회 권한 확인 필요') });
  const body = await (await h.route.POST(h.request('POST', { action: 'refresh', accountId: '123', start, end }))).json();
  assert.equal(body.ok, false); assert.equal(Object.hasOwn(h.writes[0].payload, 'snapshot'), false); assert.equal(h.writes[0].options.defaultToNull, false); assert.ok(!JSON.stringify(body).includes('never-return'));
});
test('changing read token invalidates cache without modifying CAPI; null removes override', async () => {
  const h = routeHarness(); await h.route.POST(h.request('POST', { action: 'refresh', accountId: '123', start, end }));
  assert.equal((await h.route.PATCH(h.request('PATCH', { metaAccountId: h.id, accessToken: 'private-new-read-token' }))).status, 200);
  assert.equal(h.database.firm_meta_accounts[0].access_token_ciphertext, 'encrypted-capi');
  const body = await (await h.route.GET(h.request())).json(); assert.equal(body.accounts[0].status, 'not_synced'); assert.ok(!JSON.stringify(body).includes('private-new'));
  await h.route.PATCH(h.request('PATCH', { metaAccountId: h.id, accessToken: null })); assert.equal(h.database.platform_meta_insights_tokens.length, 0);
});
test('Supabase configured page cap smaller than 1000 does not truncate CRM', async () => {
  const h = routeHarness({ pageCap: 137 }); h.database.app_leads = Array.from({ length: 1101 }, (_, i) => ({ ...h.database.app_leads[0], id: `l${i}` }));
  await h.route.POST(h.request('POST', { action: 'refresh', accountId: '123', start, end }));
  const body = await (await h.route.GET(h.request())).json(); assert.equal(body.totals.crmLeads, 1101);
});
test('unregistered account refresh never contacts Meta or writes', async () => {
  const h = routeHarness(); const response = await h.route.POST(h.request('POST', { action: 'refresh', accountId: '999', start, end })); assert.equal(response.status, 400); assert.equal(h.graphCalls.length, 0); assert.equal(h.writes.length, 0);
});

test('migration denies anon/authenticated and permits service role (actual local Postgres)', async () => {
  const { PGlite } = require(path.resolve(root, '../sms-sql-check/node_modules/@electric-sql/pglite'));
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create table public.firm_meta_accounts(id uuid primary key);`);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261018002220_platform_meta_insights.sql'), 'utf8'));
    for (const role of ['anon', 'authenticated']) for (const table of ['platform_meta_insights_tokens', 'platform_meta_insights_cache']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
      await assert.rejects(db.query(`delete from public.${table}`), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await db.query("insert into public.platform_meta_insights_cache(account_id,range_start,range_end,fingerprint,snapshot) values ('123','2026-10-01','2026-10-31',$1,$2)", ['a'.repeat(64), JSON.stringify(snapshot())]);
    await db.query("update public.platform_meta_insights_cache set last_error='failed' where account_id='123'");
    const result = await db.query('select snapshot from public.platform_meta_insights_cache'); assert.equal(result.rows[0].snapshot.rows[0].spend, 1000);
    await db.exec('reset role');
    const flags = await db.query("select relrowsecurity from pg_class where relname in ('platform_meta_insights_tokens','platform_meta_insights_cache')"); assert.ok(flags.rows.every(r => r.relrowsecurity));
  } finally { await db.close(); }
});
