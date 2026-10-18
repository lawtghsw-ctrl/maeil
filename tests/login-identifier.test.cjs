// Offline alias/provisioning compatibility checks. Never creates or signs in users.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} }; cache.set(absolute, module);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const req = name => name.startsWith('@/') ? load(name.slice(2) + '.ts')
    : name.startsWith('.') ? load(path.resolve(path.dirname(absolute), name) + '.ts') : require(name);
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Intl, URL, fetch() { throw Error('Network forbidden'); } }, { filename: absolute })(req, module, module.exports);
  return module.exports;
}
const login = load('lib/auth/login-identifier.ts');
const { provisionSalesDemo } = load('lib/demo/provision.ts');
const seed = load('lib/demo/sales-demo.ts');

test('TEST4–6 normalize only to demo addresses while original four provisioning identities stay fixed', () => {
  assert.deepEqual(Array.from(login.DEMO_LOGIN_IDS), ['test', 'test1', 'test2', 'test3']);
  assert.deepEqual(Array.from(login.DEMO_LOGIN_ALIASES), ['test', 'test1', 'test2', 'test3', 'test4', 'test5', 'test6']);
  for (const alias of login.DEMO_LOGIN_ALIASES) {
    assert.equal(login.normalizeLoginIdentifier(alias), `${alias}@demo.lawpower.invalid`);
    assert.equal(login.normalizeLoginIdentifier(` ${alias.toUpperCase()} `), `${alias}@demo.lawpower.invalid`);
  }
});

test('ordinary email syntax and invalid bare identifiers retain the prior behavior', () => {
  for (const email of ['Person+tag@example.org', 'user@firm.example', 'test6@demo.lawpower.invalid']) assert.equal(login.normalizeLoginIdentifier(` ${email} `), email);
  for (const input of ['', 'test0', 'test7', 'test42', 'test01', 'test 4', 'TEST4@example bad', '관리자', 'a@@b.example']) assert.throws(() => login.normalizeLoginIdentifier(input), /이메일 또는 아이디/);
});

function readyFixture() {
  const firm = { id: '00000000-0000-4000-8000-000000000001', name: 'TEST', firm_code: seed.SALES_DEMO_CODE, representative_name: seed.SALES_DEMO_REPRESENTATIVE, status: 'active' };
  const marker = { version: 1, kind: seed.SALES_DEMO_KIND, firmId: firm.id, seedDate: '2026-10-18', phase: 'ready', leaseToken: 'synthetic-lease', leaseExpiresAt: '2026-10-18T00:00:00Z', revision: 10, lawyersSeeded: true,
    accountIds: { test: 'original-admin', test1: 'original-staff-1', test2: 'original-staff-2', test3: 'original-staff-3' }, initializedProfiles: { test: true, test1: true, test2: true, test3: true } };
  const reads = [];
  const admin = {
    auth: { admin: new Proxy({}, { get() { return () => { throw Error('Auth access forbidden for ready provisioner'); }; } }) },
    from(table) {
      reads.push(table);
      if (!['law_firms', 'firm_settings'].includes(table)) throw Error(`Unexpected table ${table}`);
      const query = {
        select() { return query; }, eq() { return query; },
        or() { assert.equal(table, 'law_firms'); return Promise.resolve({ data: [firm], error: null }); },
        maybeSingle() { assert.equal(table, 'firm_settings'); return Promise.resolve({ data: { value: marker, updated_at: '2026-10-18T00:00:00Z' }, error: null }); },
      };
      return query;
    },
  };
  return { admin, firm, marker, reads };
}

test('actual completed provisioner remains read-only and does not require or create the three new aliases', async () => {
  const fixture = readyFixture(), before = JSON.stringify(fixture.marker);
  const result = await provisionSalesDemo(fixture.admin, 'synthetic-actor', 'synthetic-password');
  assert.equal(result.alreadyExists, true); assert.equal(result.firmId, fixture.firm.id);
  assert.deepEqual(Array.from(result.accounts, account => account.loginId), ['test', 'test1', 'test2', 'test3']);
  assert.deepEqual(Array.from(result.accounts, account => account.displayName), ['TEST 관리자', 'TEST1', 'TEST2', 'TEST3']);
  assert.deepEqual(fixture.reads, ['law_firms', 'firm_settings']);
  assert.equal(JSON.stringify(fixture.marker), before);
});

test('original ready-marker account checks still fail closed without reinitializing accounts or data', async () => {
  const fixture = readyFixture(); delete fixture.marker.accountIds.test3;
  await assert.rejects(() => provisionSalesDemo(fixture.admin, 'synthetic-actor', 'synthetic-password'), /계정 생성 정보가 누락/);
  assert.deepEqual(fixture.reads, ['law_firms', 'firm_settings']);
});
