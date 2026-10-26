// Executes the actual public login route with request-local in-memory Auth clients.
// No network, real users, passwords, Auth writes, or operational records are accessed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const credentialError = '아이디 또는 이메일과 비밀번호를 확인해주세요. 아이디가 중복되는 경우 전체 이메일로 로그인해주세요.';

function harness(options = {}) {
  const calls = [], clients = [], logs = [], modules = new Map();
  const accounts = options.accounts ?? { 'alpha@firm.invalid': { id: 'user-alpha' } };
  const admin = {
    auth: new Proxy({}, { get(_target, key) { calls.push({ forbiddenAdminAuth: String(key) }); throw Error('Admin authentication forbidden'); } }),
    from() { calls.push({ forbiddenAdminTable: true }); throw Error('Admin table access forbidden'); },
    async rpc(name, args) {
      calls.push({ adminRpc: name, args: clone(args) });
      if (name === 'consume_public_rate_limit') {
        if (options.rateThrows) throw Error('Private rate-limit detail');
        return options.rates?.[args.p_scope] ?? { data: true, error: null };
      }
      assert.equal(name, 'resolve_login_identifier');
      if (options.lookupThrows) throw Error('Private lookup detail');
      return options.lookup ?? { data: Object.entries(accounts).filter(([email]) => email.split('@')[0].toLowerCase() === args.p_identifier.toLowerCase()).map(([email, account]) => ({ id: account.id, email })), error: null };
    },
  };
  function publicClient(url, key, config) {
    assert.equal(url, 'https://synthetic.supabase.invalid');
    assert.equal(key, 'synthetic-public-key');
    assert.deepEqual(clone(config), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const state = { number: clients.length, config: clone(config), credentials: null, account: null, profileReads: [], signedOut: [] };
    clients.push(state);
    return {
      auth: {
        async signInWithPassword(credentials) {
          state.credentials = clone(credentials);
          const account = accounts[credentials.email] ?? { id: 'unknown' };
          state.account = account;
          if (account.wait) await account.wait;
          if (account.signInThrows) throw Error('Private Auth provider detail');
          if (account.authError) return { data: { user: null, session: null }, error: account.authError };
          const user = account.noUser ? null : { id: account.authId ?? account.id, email: credentials.email, private: 'not exposed' };
          const session = account.noSession ? null : { access_token: `access-${account.id}`, refresh_token: `refresh-${account.id}`, expires_in: 3600, user };
          return { data: { user, session }, error: null };
        },
        async signOut(value) { state.signedOut.push(clone(value)); if (state.account?.signOutThrows) throw Error('Private revoke detail'); return { error: null }; },
      },
      from(table) {
        assert.equal(table, 'profiles');
        const query = { projection: '', key: '', value: '' };
        const q = {
          select(value) { query.projection = value; return q; },
          eq(key, value) { query.key = key; query.value = value; return q; },
          async maybeSingle() {
            state.profileReads.push(clone(query));
            const account = state.account;
            if (account.profileThrows) throw Error('Private profile detail');
            return {
              data: account.missingProfile ? null : { id: account.profileId ?? account.id, is_active: account.active ?? true },
              error: account.profileError ?? null,
            };
          },
        };
        return q;
      },
      async rpc(name) {
        assert.equal(name, 'is_active_user');
        calls.push({ userRpc: name, id: state.account.id });
        if (state.account.activeThrows) throw Error('Private firm detail');
        return { data: state.account.firmActive ?? true, error: state.account.activeError ?? null };
      },
    };
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const req = name => {
      if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      if (name === '@/lib/supabase/admin') return { createAdminClient: () => { calls.push({ createAdmin: true }); if (options.adminThrows) throw Error('Private service-role detail'); return admin; } };
      if (name === '@supabase/supabase-js') return { createClient: publicClient };
      if (name === 'crypto') return require('node:crypto');
      if (name === '@/lib/auth/login-identifier') return load('lib/auth/login-identifier.ts');
      throw Error(`Unexpected dependency: ${name}`);
    };
    const env = options.missingEnv ? {} : { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
      Buffer, TextDecoder, URL, Request, Response, process: { env }, console: new Proxy({}, { get: () => (...args) => logs.push(args) }),
      fetch() { throw Error('Network forbidden'); },
    }, { filename: file })(req, module, module.exports);
    return module.exports;
  }
  const route = load('app/api/auth/login/route.ts');
  function request(body = { identifier: 'alpha', password: ' synthetic password ' }, overrides = {}) {
    const req = new Request('https://offline.test/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://offline.test', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '192.0.2.1, 192.0.2.9', ...overrides.headers },
      body: overrides.raw ?? JSON.stringify(body),
    });
    if (overrides.withoutOrigin) req.headers.delete('origin');
    if (overrides.withoutType) req.headers.delete('content-type');
    req.nextUrl = new URL(req.url);
    return req;
  }
  async function run(body, overrides) {
    const response = await route.POST(request(body, overrides));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(logs.length, 0, 'Credentials and provider details must never be logged');
    assert.ok(!calls.some(call => call.forbiddenAdminAuth || call.forbiddenAdminTable));
    return { response, body: await response.json() };
  }
  return { calls, clients, logs, route, request, run };
}

test('ID resolves exactly once and authenticates with an isolated public client; response contains only own tokens', async () => {
  const h = harness(), { response, body } = await h.run({ identifier: ' ALPHA ', password: '  exact password  ' });
  assert.equal(response.status, 200);
  assert.deepEqual(body, { session: { access_token: 'access-user-alpha', refresh_token: 'refresh-user-alpha' } });
  assert.deepEqual(h.clients[0].credentials, { email: 'alpha@firm.invalid', password: '  exact password  ' });
  assert.deepEqual(h.clients[0].profileReads, [{ projection: 'id,is_active', key: 'id', value: 'user-alpha' }]);
  assert.deepEqual(h.calls.filter(call => call.adminRpc === 'resolve_login_identifier').map(call => call.args), [{ p_identifier: 'alpha' }]);
  assert.deepEqual(h.clients[0].signedOut, []);
  assert.equal(h.route.dynamic, 'force-dynamic'); assert.equal(h.route.revalidate, 0); assert.equal(h.route.fetchCache, 'force-no-store');
});

test('full email bypasses alias lookup, including a local part duplicated across firms', async () => {
  const h = harness({ accounts: { 'alpha@firm.invalid': { id: 'one' }, 'alpha@other.invalid': { id: 'two' } } });
  const result = await h.run({ identifier: 'alpha@other.invalid', password: 'unchanged' });
  assert.equal(result.response.status, 200); assert.equal(result.body.session.access_token, 'access-two');
  assert.equal(h.calls.filter(call => call.adminRpc === 'resolve_login_identifier').length, 0);
});

test('unknown and duplicated IDs share the same 401 and never try any candidate password', async () => {
  for (const data of [[], [{ id: 'one', email: 'alpha@one.invalid' }, { id: 'two', email: 'alpha@two.invalid' }]]) {
    const h = harness({ lookup: { data, error: null } }), result = await h.run();
    assert.equal(result.response.status, 401); assert.deepEqual(result.body, { error: credentialError }); assert.equal(h.clients.length, 0);
  }
});

test('rate limits are enforced before resolution, with hashed IP and normalized ID+IP keys and exact quotas', async () => {
  const h = harness(); await h.run({ identifier: ' ALPHA ', password: 'one' }); await h.run({ identifier: 'alpha', password: 'two' });
  const limits = h.calls.filter(call => call.adminRpc === 'consume_public_rate_limit').map(call => call.args);
  assert.equal(limits.length, 4); assert.deepEqual(limits.slice(0, 2), limits.slice(2));
  assert.deepEqual(limits.map(row => [row.p_scope, row.p_limit, row.p_window_seconds]).slice(0, 2), [['login_ip', 60, 900], ['login_identifier', 12, 900]]);
  assert.ok(limits.every(row => /^[a-f0-9]{64}$/.test(row.p_key_hash)));
  await h.run(undefined, { headers: { 'x-forwarded-for': '192.0.2.2' } });
  const last = h.calls.filter(call => call.adminRpc === 'consume_public_rate_limit').slice(-2).map(call => call.args);
  assert.notEqual(last[0].p_key_hash, limits[0].p_key_hash); assert.notEqual(last[1].p_key_hash, limits[1].p_key_hash);
  for (const scope of ['login_ip', 'login_identifier']) {
    const blocked = harness({ rates: { [scope]: { data: false, error: null } } }), result = await blocked.run();
    assert.equal(result.response.status, 429); assert.equal(blocked.clients.length, 0); assert.equal(blocked.calls.filter(call => call.adminRpc === 'resolve_login_identifier').length, 0);
  }
});

test('rate-limit errors or unexpected values fail closed before alias or password access', async () => {
  for (const options of [{ rateThrows: true }, ...[null, 'true', 1].map(data => ({ rates: { login_ip: { data, error: null } } })), { rates: { login_identifier: { data: true, error: { message: 'private detail' } } } }]) {
    const h = harness(options), result = await h.run(); assert.equal(result.response.status, 503); assert.equal(h.clients.length, 0);
    assert.equal(h.calls.filter(call => call.adminRpc === 'resolve_login_identifier').length, 0); assert.doesNotMatch(JSON.stringify(result.body), /private detail/i);
  }
});

test('lookup failures, malformed candidates, and mismatched prefixes never fall back to arbitrary accounts', async () => {
  for (const options of [{ lookupThrows: true }, { lookup: { data: null, error: { message: 'private database detail' } } }, ...[null, {}, [{ id: 'one', email: 'other@firm.invalid' }], [{ id: '', email: 'alpha@firm.invalid' }]].map(data => ({ lookup: { data, error: null } }))]) {
    const h = harness(options), result = await h.run(); assert.equal(result.response.status, 503); assert.equal(h.clients.length, 0); assert.doesNotMatch(JSON.stringify(result.body), /database|firm\.invalid/);
  }
});

test('wrong passwords and provider rate limiting expose no provider details', async () => {
  for (const [status, expected] of [[400, 401], [422, 401], [429, 429]]) {
    const h = harness({ accounts: { 'alpha@firm.invalid': { id: 'one', authError: { status, message: 'Secret email/provider detail' } } } }), result = await h.run();
    assert.equal(result.response.status, expected); assert.doesNotMatch(JSON.stringify(result.body), /Secret|provider|firm\.invalid/);
    assert.equal(h.clients[0].profileReads.length, 0); assert.equal(h.clients[0].signedOut.length, 0);
  }
});

test('alias/auth identity mismatch and incomplete sessions revoke only the attempted session', async () => {
  for (const account of [{ id: 'one', authId: 'different' }, { id: 'one', noUser: true }, { id: 'one', noSession: true }]) {
    const h = harness({ accounts: { 'alpha@firm.invalid': account } }), result = await h.run();
    assert.equal(result.response.status, 401); assert.deepEqual(result.body, { error: credentialError });
    assert.deepEqual(h.clients[0].signedOut, [{ scope: 'local' }]); assert.equal(h.clients[0].profileReads.length, 0);
  }
});

test('missing/inactive/foreign profiles and suspended or errored firm checks never return tokens', async () => {
  for (const extra of [{ missingProfile: true }, { active: false }, { active: 'true' }, { profileId: 'foreign' }, { profileError: { message: 'private profile' } }, { firmActive: false }, { firmActive: 'true' }, { activeError: { message: 'private firm' } }]) {
    const h = harness({ accounts: { 'alpha@firm.invalid': { id: 'one', ...extra } } }), result = await h.run();
    assert.equal(result.response.status, 401); assert.deepEqual(result.body, { error: credentialError }); assert.deepEqual(h.clients[0].signedOut, [{ scope: 'local' }]);
  }
});

test('thrown authorization reads still revoke the local session and hide infrastructure details', async () => {
  for (const extra of [{ profileThrows: true }, { activeThrows: true }, { active: false, signOutThrows: true }]) {
    const h = harness({ accounts: { 'alpha@firm.invalid': { id: 'one', ...extra } } }), result = await h.run();
    assert.equal(result.response.status, extra.active === false ? 401 : 503); assert.deepEqual(h.clients[0].signedOut, [{ scope: 'local' }]); assert.doesNotMatch(JSON.stringify(result.body), /Private|detail/);
  }
});

test('cross-origin and cross-site requests are rejected before any database or Auth call', async () => {
  for (const headers of [{ origin: 'https://attacker.invalid' }, { origin: 'null' }, { origin: 'https://offline.test.attacker.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
    const h = harness(), result = await h.run(undefined, { headers }); assert.equal(result.response.status, 403); assert.deepEqual(h.calls, []); assert.equal(h.clients.length, 0);
  }
  const allowed = harness(); assert.equal((await allowed.run(undefined, { withoutOrigin: true })).response.status, 200);
});

test('JSON content type, syntax, field types, unknown keys, and bounded identifiers/passwords are validated before lookup', async () => {
  for (const body of [null, [], 'text', {}, { identifier: 'alpha', password: '' }, { identifier: 'alpha', password: 123 }, { identifier: {}, password: 'x' }, { identifier: 'a'.repeat(321), password: 'x' }, { identifier: 'alpha', password: 'x'.repeat(4097) }, { identifier: 'alpha', password: 'x', lawFirmId: 'forged' }, { identifier: 'bad@@example.org', password: 'x' }, { identifier: 'alpha beta', password: 'x' }]) {
    const h = harness(), result = await h.run(body); assert.equal(result.response.status, 400); assert.deepEqual(h.calls, []);
  }
  for (const overrides of [{ raw: '{"identifier":' }, { raw: '\ufeff{}' }]) {
    const h = harness(), result = await h.run(undefined, overrides); assert.equal(result.response.status, 400); assert.deepEqual(h.calls, []);
  }
  for (const overrides of [{ withoutType: true }, { headers: { 'content-type': 'text/plain' } }, { headers: { 'content-type': 'application/jsonp' } }]) {
    const h = harness(), result = await h.run(undefined, overrides); assert.equal(result.response.status, 415); assert.deepEqual(h.calls, []);
  }
});

test('actual streamed UTF-8 byte size is bounded even without or despite a forged content-length', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    const h = harness(), result = await h.run({ identifier: 'alpha', password: '가'.repeat(3000) }, { headers });
    assert.equal(result.response.status, 413); assert.deepEqual(h.calls, []);
  }
  const h = harness(), result = await h.run(undefined, { headers: { 'content-length': '8193' } }); assert.equal(result.response.status, 413); assert.deepEqual(h.calls, []);
});

test('request configuration and unexpected Auth failures return sanitized no-store errors', async () => {
  for (const options of [{ missingEnv: true }, { adminThrows: true }, { accounts: { 'alpha@firm.invalid': { id: 'one', signInThrows: true } } }]) {
    const h = harness(options), result = await h.run(); assert.equal(result.response.status, 503); assert.doesNotMatch(JSON.stringify(result.body), /Private|service.role|provider|detail/);
  }
});

test('simultaneous logins cannot share or replace each other\'s Auth session', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const h = harness({ accounts: { 'alpha@firm.invalid': { id: 'alpha', wait }, 'beta@other.invalid': { id: 'beta' } } });
  const alpha = h.run({ identifier: 'alpha', password: 'first' });
  await new Promise(resolve => setImmediate(resolve));
  const beta = await h.run({ identifier: 'beta', password: 'second' });
  assert.equal(beta.body.session.access_token, 'access-beta'); release();
  assert.equal((await alpha).body.session.access_token, 'access-alpha'); assert.equal(h.clients.length, 2);
  assert.deepEqual(h.clients.map(client => client.profileReads[0].value).sort(), ['alpha', 'beta']);
  assert.ok(h.clients.every(client => client.signedOut.length === 0));
});
