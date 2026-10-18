const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const routePath = 'app/api/integrations/google-sheets/leads/route.ts';
const scriptPaths = ['integrations/google-sheets/Code.gs', 'docs/GOOGLE_APPS_SCRIPT_TEMPLATE.gs'];
const json = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');

function load(file, mocks = {}, cache = new Map()) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} }; cache.set(absolute, module);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const requireFile = request => {
    if (request in mocks) return mocks[request];
    if (request.startsWith('@/')) return load(request.slice(2) + '.ts', mocks, cache);
    throw new Error('Unexpected dependency: ' + request);
  };
  const context = { crypto: webcrypto, Date, console: { error() {} }, process: { env: { GOOGLE_SHEETS_WEBHOOK_SECRET: 'offline-legacy-only' } }, fetch() { throw new Error('Live network forbidden'); } };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, context, { filename: absolute })(requireFile, module, module.exports);
  return module.exports;
}

const identifiers = load('lib/integrations/meta-identifiers.ts');
const expectedIds = { metaLeadId: '92345678901234567', adId: '82345678901234567', adsetId: '72345678901234567', campaignId: '62345678901234567', formId: '52345678901234567' };
const prefixed = Object.fromEntries(Object.entries(expectedIds).map(([field, id]) => [field, identifiers.META_IDENTIFIER_PREFIXES[field] + id]));
const invalidIds = [undefined, null, 123, 82345678901234567, 0, false, true, {}, [], ['123'], '', ' ', '0', '01', '-123', '+123', '1.0', '1e18', '1 23', 'ag: 123', 'AG:123', 'ag:ag:123', '123\n456', '1'.repeat(33)];

test('each field accepts its exact prefix and decimal string without numeric conversion', () => {
  for (const [field, id] of Object.entries(expectedIds)) {
    assert.equal(identifiers.normalizeMetaIdentifier(id, field), id);
    assert.equal(identifiers.normalizeMetaIdentifier('  ' + prefixed[field] + '  ', field), id);
    for (const other of Object.keys(expectedIds).filter(key => key !== field)) {
      assert.equal(identifiers.normalizeMetaIdentifier(prefixed[other], field), null);
    }
  }
});

test('wrong types, malformed prefixes, rounding-prone numbers and scientific notation never become IDs', () => {
  for (const value of invalidIds) assert.equal(identifiers.normalizeMetaIdentifier(value, 'adId'), null);
});

test('body form fallback accepts only an absent row value, never hides malformed metadata', () => {
  assert.equal(identifiers.sheetMetaIdentifiers({}, prefixed.formId).ids.formId, expectedIds.formId);
  assert.equal(identifiers.sheetMetaIdentifiers({ formId: ' ' }, prefixed.formId).ids.formId, expectedIds.formId);
  for (const bad of [0, {}, 'ag:123']) {
    const result = identifiers.sheetMetaIdentifiers({ formId: bad }, prefixed.formId);
    assert.equal(result.ids.formId, null);
    assert.deepEqual(json(result.invalidFields), ['formId']);
  }
});

function source(patch = {}) {
  return { id: 'source-one', law_firm_id: 'firm-one', source_key: 'SOURCE-ONE', name: 'Offline source', meta_form_id: expectedIds.formId, campaign_id: null, adset_id: null, ad_id: null, meta_account_id: 'account-one', sheet_integration_id: 'sheet-one', active: true, ...patch };
}
function row(patch = {}) {
  return { externalKey: 'spreadsheet-one|Raw2|1211', rowNumber: 1211, intakeAt: '2026-10-01T12:34:56+09:00', adName: '회생 fixture', name: 'Offline customer', phone: '01000000000', email: 'offline@example.invalid', debtRange: 'fixture debt', income: 'fixture income', consultTime: '주말', ...prefixed, ...patch };
}

function harness(options = {}) {
  const firms = [{ id: 'firm-one', firm_code: '1234567890', name: 'Offline firm', status: 'active', is_legacy_default: true }];
  const sheets = options.sheets ?? [{ id: 'sheet-one', law_firm_id: 'firm-one', spreadsheet_id: 'spreadsheet-one', sheet_name: 'Raw2', active: true, secret_hash: digest('offline-new-only') }];
  const tables = { law_firms: firms, firm_sheet_integrations: sheets, ad_sources: options.sources ?? [source()] };
  const reads = [], writes = [], calls = [], imports = new Map();
  const admin = {
    from(table) {
      const filters = [];
      let mode = 'select', value, selectionOptions;
      const query = {
        select(columns, config) { selectionOptions = config; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        insert(v) { mode = 'insert'; value = v; return query; },
        update(v) { mode = 'update'; value = v; return query; },
        maybeSingle() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };
      async function execute(single) {
        if (mode !== 'select') { writes.push({ table, mode, value: json(value), filters }); return { data: null, error: null }; }
        reads.push({ table, filters, exactCount: selectionOptions?.count });
        if (options.throwTable === table) throw new Error('Offline lookup failure');
        if (options.errorTable === table) return { data: null, error: { message: 'Offline lookup error' }, count: null };
        const result = (tables[table] ?? []).filter(item => filters.every(([key, val]) => item[key] === val));
        if (single && result.length > 1) return { data: null, error: { message: 'Multiple rows' } };
        return { data: single ? (result[0] ?? null) : result, error: null, count: options.sourceCount != null && table === 'ad_sources' ? options.sourceCount : result.length };
      }
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'import_tenant_google_sheet_lead', 'Only the existing ingestion RPC may be called');
      calls.push(json(args));
      const key = args.p_law_firm_id + '|' + args.p_external_key;
      if (imports.has(key)) return { data: { duplicate: true, leadId: imports.get(key).p_lead_id, assignedStaff: 'Existing assignment' }, error: null };
      imports.set(key, json(args));
      return { data: { duplicate: false, leadId: args.p_lead_id, assignedStaff: 'Existing assignment' }, error: null };
    },
  };
  const route = load(routePath, {
    'crypto': require('node:crypto'),
    'next/server': { NextResponse: { json: (body, opts) => ({ status: opts?.status ?? 200, body: json(body) }) } },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
  });
  async function post(rows = [row()], config = {}) {
    const body = { sheetId: 'spreadsheet-one', sheetName: 'Raw2', rows, ...config.body };
    const headers = new Map(Object.entries(config.modern ? { 'x-lawpower-firm-code': '1234567890', 'x-lawpower-ingest-secret': 'offline-new-only' } : { 'x-lawpower-webhook-secret': 'offline-legacy-only' }));
    for (const [key, value] of Object.entries(config.headers ?? {})) headers.set(key, value);
    return route.POST({ json: async () => body, headers: { get: key => headers.get(key) ?? null } });
  }
  return { post, reads, writes, calls, imports };
}

function assertIntake(h, response, linked = false) {
  assert.equal(response.status, 200);
  assert.equal(response.body.imported, 1);
  assert.equal(h.calls.length, 1);
  const args = h.calls[0];
  assert.equal(args.p_ad_source_id, linked ? 'source-one' : null);
  assert.equal(args.p_meta_account_id, linked ? 'account-one' : null);
  assert.equal(args.p_external_key, 'spreadsheet-one|Raw2|1211');
  assert.equal(args.p_row_number, 1211);
  assert.equal(args.p_lead_data.name, 'Offline customer');
  assert.equal(args.p_lead_data.phone, '010-0000-0000');
  assert.equal(args.p_lead_data.status, '신규접수');
  assert.equal(args.p_lead_data.detailStage, '신규디비');
  assert.equal(args.p_lead_data.receivedAt, '2026-10-01T03:34:56.000Z');
  assert.equal(args.p_lead_data.consultTimeRaw, '주말');
  assert.equal('assignedStaff' in args.p_lead_data, false, 'Assignment remains entirely in the existing RPC');
  assert.equal(h.writes.length, 0, 'Legacy metadata lookup performs no direct writes');
}

test('legacy authenticates then uniquely links exact registered tenant/sheet/form, preserving every ID', async () => {
  const h = harness(); const response = await h.post(); assertIntake(h, response, true);
  for (const [field, value] of Object.entries(expectedIds)) assert.equal(h.calls[0].p_lead_data._platform[field], value);
  assert.equal(h.calls[0].p_meta_lead_id, expectedIds.metaLeadId);
  assert.equal(h.calls[0].p_lead_data._platform.sourceKey, 'SOURCE-ONE');
  assert.ok(h.reads.find(read => read.table === 'ad_sources' && read.exactCount === 'exact'));
});

test('legacy supports exact ad-only registration, without matching campaign/name', async () => {
  const h = harness({ sources: [source({ meta_form_id: null, ad_id: expectedIds.adId })] });
  assertIntake(h, await h.post([row({ formId: undefined })]), true);
});

for (const [name, options, patch, body] of [
  ['missing IDs', {}, Object.fromEntries(Object.keys(expectedIds).map(key => [key, undefined]))],
  ['only campaign/set identifiers', { sources: [source({ meta_form_id: null, campaign_id: expectedIds.campaignId })] }, { formId: undefined, adId: undefined }],
  ['unregistered form/ad', {}, { formId: 'f:999', adId: 'ag:999' }],
  ['wrong ID prefix', {}, { adId: 'l:82345678901234567' }],
  ['numeric rounded ID', {}, { adId: 82345678901234567 }],
  ['invalid lead ID alongside valid form', {}, { metaLeadId: true }],
  ['no sheet ID', {}, {}, { sheetId: undefined }],
  ['wrong spreadsheet', {}, {}, { sheetId: 'other-spreadsheet' }],
  ['wrong registered sheet name', { sheets: [{ id: 'sheet-one', law_firm_id: 'firm-one', spreadsheet_id: 'spreadsheet-one', sheet_name: 'Raw3', active: true }] }],
  ['inactive sheet', { sheets: [{ id: 'sheet-one', law_firm_id: 'firm-one', spreadsheet_id: 'spreadsheet-one', sheet_name: 'Raw2', active: false }] }],
  ['other tenant sheet', { sheets: [{ id: 'sheet-one', law_firm_id: 'firm-two', spreadsheet_id: 'spreadsheet-one', sheet_name: 'Raw2', active: true }] }],
  ['other tenant source', { sources: [source({ law_firm_id: 'firm-two' })] }],
  ['other sheet source', { sources: [source({ sheet_integration_id: 'sheet-two' })] }],
  ['inactive source', { sources: [source({ active: false })] }],
  ['ambiguous matching forms', { sources: [source(), source({ id: 'source-two' })] }],
  ['conflicting form/ad registrations', { sources: [source(), source({ id: 'source-two', meta_form_id: null, ad_id: expectedIds.adId })] }],
  ['registered campaign contradicts form row', { sources: [source({ campaign_id: '999' })] }],
  ['required registered lineage missing', { sources: [source({ campaign_id: expectedIds.campaignId })] }, { campaignId: undefined }],
  ['partial/capped source result', { sourceCount: 2 }],
  ['sheet database error', { errorTable: 'firm_sheet_integrations' }],
  ['source database error', { errorTable: 'ad_sources' }],
  ['source lookup exception', { throwTable: 'ad_sources' }],
]) {
  test(`legacy ${name}: customer accepted with no inferred link`, async () => {
    const h = harness(options); assertIntake(h, await h.post([row(patch)], { body }), false);
  });
}

test('invalid legacy secret rejects before optional source lookups and import', async () => {
  const h = harness(); const result = await h.post(undefined, { headers: { 'x-lawpower-webhook-secret': 'wrong' } });
  assert.equal(result.status, 401);
  assert.equal(h.calls.length, 0);
  assert.equal(h.reads.some(read => ['firm_sheet_integrations', 'ad_sources'].includes(read.table)), false);
});

test('same external key replay stays a duplicate and never calls a metadata update or SMS endpoint', async () => {
  const h = harness();
  const old = row(Object.fromEntries(Object.keys(expectedIds).map(key => [key, undefined])));
  await h.post([old]); const before = JSON.stringify([...h.imports]);
  const replay = await h.post();
  assert.equal(replay.body.imported, 0); assert.equal(replay.body.duplicates, 1);
  assert.equal(h.imports.size, 1); assert.equal(JSON.stringify([...h.imports]), before);
  assert.equal(h.writes.length, 0);
});

test('modern authentication and mapping work with prefixed IDs and preserve the existing RPC', async () => {
  const h = harness(); const response = await h.post(undefined, { modern: true });
  assert.equal(response.status, 200); assert.equal(h.calls[0].p_ad_source_id, 'source-one');
  assert.equal(h.calls[0].p_lead_data._platform.adId, expectedIds.adId);
  assert.deepEqual(h.writes.map(write => [write.table, write.mode]), [['firm_sheet_integrations', 'update']]);
});

test('modern missing metadata preserves the existing registered lineage rejection', async () => {
  const h = harness();
  const result = await h.post([row(Object.fromEntries(Object.keys(expectedIds).map(key => [key, undefined])))], { modern: true });
  assert.equal(result.status, 409); assert.equal(h.calls.length, 0);
});

test('modern fixed source cannot bypass lineage validation using malformed or absent IDs', async () => {
  for (const patch of [{ adId: 'l:123' }, { metaLeadId: 123 }, Object.fromEntries(Object.keys(expectedIds).map(key => [key, undefined]))]) {
    const h = harness();
    const response = await h.post([row(patch)], { modern: true, headers: { 'x-lawpower-source-key': 'SOURCE-ONE' } });
    assert.equal(response.status, 409); assert.equal(response.body.retryable, true); assert.equal(h.calls.length, 0);
  }
});

test('modern fixed source accepts normalized original IDs with unchanged lineage checks', async () => {
  const h = harness({ sources: [source({ ad_id: expectedIds.adId, adset_id: expectedIds.adsetId, campaign_id: expectedIds.campaignId })] });
  const response = await h.post(undefined, { modern: true, headers: { 'x-lawpower-source-key': 'SOURCE-ONE' } });
  assert.equal(response.status, 200); assert.equal(h.calls[0].p_ad_source_id, 'source-one');
});

test('modern wrong secret remains rejected and a valid but contradictory configured lineage remains retryable', async () => {
  const unauthorized = harness();
  assert.equal((await unauthorized.post(undefined, { modern: true, headers: { 'x-lawpower-ingest-secret': 'wrong' } })).status, 401);
  assert.equal(unauthorized.calls.length, 0);
  const mismatch = harness({ sources: [source({ campaign_id: '999' })] });
  const response = await mismatch.post(undefined, { modern: true });
  assert.equal(response.status, 409); assert.equal(response.body.retryable, true); assert.equal(mismatch.calls.length, 0);
});

test('both Apps Script copies stay identical and use the same strict ID normalization as the server', () => {
  const a = fs.readFileSync(path.join(root, scriptPaths[0]), 'utf8');
  assert.equal(a, fs.readFileSync(path.join(root, scriptPaths[1]), 'utf8'));
  const script = vm.createContext({}); vm.runInContext(a, script);
  for (const field of Object.keys(expectedIds)) {
    for (const value of [...invalidIds, ...Object.values(prefixed), expectedIds[field]]) {
      assert.equal(script.lawPowerNormalizeMetaId_(value, field), identifiers.normalizeMetaIdentifier(value, field));
    }
  }
  assert.equal(script.lawPowerMetaIdCell_(['ag:123'], 0, 'adId'), '123');
  assert.equal(script.lawPowerMetaIdCell_(['l:123'], 0, 'adId'), 'l:123', 'Server must see an invalid supplied field rather than silently treating it as absent');
  for (const rawValue of [123, 82345678901234567, false, true]) {
    assert.equal(script.lawPowerMetaIdCell_(['82345678901234568'], 0, 'adId', rawValue), rawValue, 'Original non-string cell type must not become an apparently valid ID');
  }
  assert.equal(script.lawPowerMetaIdCell_(['8.23457E+16'], 0, 'adId', prefixed.adId), expectedIds.adId, 'Original string is authoritative over display formatting');
});

test('Apps Script polls only after the saved cursor, sends all IDs and does not reset triggers', () => {
  const headers = ['created_time', 'ad_name', 'full_name', 'phone', 'form_id', 'leadgen_id', 'campaign_id', 'adset_id', 'ad_id'];
  const cells = ['2026-10-01T12:34:56+09:00', '회생 fixture', 'Offline customer', '01000000000', prefixed.formId, prefixed.metaLeadId, prefixed.campaignId, prefixed.adsetId, prefixed.adId];
  const saved = new Map(Object.entries({ LAWPOWER_WEBHOOK_URL: 'https://offline.invalid/api/integrations/google-sheets/leads', LAWPOWER_FIRM_CODE: '1234567890', LAWPOWER_INGEST_SECRET: 'offline-new-only', LAWPOWER_LAST_SYNCED_ROW_Raw2: '1210' }));
  const ranges = [], requests = [], changes = [];
  let currentLastRow = 1211;
  let responseStatus = 200;
  let rawCells = cells;
  const sheet = { getLastColumn: () => headers.length, getLastRow: () => currentLastRow, getRange(start, col, count, columns) { ranges.push([start, count]); return { getDisplayValues: () => start === 1 ? [headers] : [cells], getValues: () => [rawCells] }; } };
  const spreadsheet = { getId: () => 'spreadsheet-one', getSheetByName: () => sheet, getSpreadsheetTimeZone: () => 'Asia/Seoul' };
  const script = vm.createContext({
    Date, console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => saved.get(key) ?? null, setProperty(key, value) { changes.push([key, value]); saved.set(key, value); } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: new Proxy({}, { get() { throw new Error('Existing triggers must not be changed'); } }),
    UrlFetchApp: { fetch(url, opts) { requests.push({ url, opts: json(opts) }); return { getResponseCode: () => responseStatus, getContentText: () => JSON.stringify({ ok: responseStatus === 200, imported: responseStatus === 200 ? 1 : 0 }) }; } },
  });
  vm.runInContext(fs.readFileSync(path.join(root, scriptPaths[0]), 'utf8'), script);
  script.syncLawPowerNewRows();
  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].opts.payload);
  assert.equal(payload.rows.length, 1); assert.equal(payload.rows[0].externalKey, 'spreadsheet-one|Raw2|1211');
  for (const [field, value] of Object.entries(expectedIds)) assert.equal(payload.rows[0][field], value);
  assert.deepEqual(changes, [['LAWPOWER_LAST_SYNCED_ROW_Raw2', '1211']]);
  assert.equal(ranges.some(([start]) => start > 1 && start !== 1211), false, 'No historical scan');
  script.syncLawPowerNewRows(); assert.equal(requests.length, 1, 'No resend once cursor advances');
  // New row: displayed decimal digits must not hide that all original ID cells are Numbers.
  currentLastRow = 1212;
  rawCells = [...cells];
  const fields = ['formId', 'metaLeadId', 'campaignId', 'adsetId', 'adId'];
  for (let i = 0; i < fields.length; i++) {
    rawCells[i + 4] = Number(expectedIds[fields[i]]);
    cells[i + 4] = String(rawCells[i + 4]);
  }
  responseStatus = 409;
  assert.throws(() => script.syncLawPowerNewRows(), /409/);
  const numericPayload = JSON.parse(requests[1].opts.payload);
  assert.equal(numericPayload.rows[0].externalKey, 'spreadsheet-one|Raw2|1212');
  for (const field of fields) {
    assert.equal(typeof numericPayload.rows[0][field], 'number');
    assert.equal(identifiers.normalizeMetaIdentifier(numericPayload.rows[0][field], field), null);
  }
  assert.equal(saved.get('LAWPOWER_LAST_SYNCED_ROW_Raw2'), '1211', 'Rejected numeric IDs must not advance the existing cursor');
  assert.deepEqual(changes, [['LAWPOWER_LAST_SYNCED_ROW_Raw2', '1211']]);
});
