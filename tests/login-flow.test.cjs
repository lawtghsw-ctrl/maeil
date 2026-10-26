// Actual LoginPage and middleware, isolated React/Supabase/HTTP fixtures only.
// No account creation, real network, database or authentication requests.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer'));
const { act } = Renderer;
const h = React.createElement, clone = value => JSON.parse(JSON.stringify(value));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const forbidden = () => { throw new Error('Unexpected network or privileged client access'); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

function sourceLoader(mocks = {}, globals = {}) {
  const cache = new Map();
  const context = vm.createContext({ console, Error, Date, URL, URLSearchParams, Map, Set, JSON, fetch: forbidden, ...globals });
  function load(file) {
    const absolute = path.resolve(root, file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} }; cache.set(absolute, module);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { fileName: absolute,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context, { filename: absolute })(name => {
      if (name in mocks) return mocks[name];
      if (name === 'react' || name.startsWith('react/')) return require(path.join(runtime, name));
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(absolute), name);
        const resolved = ['.ts', '.tsx'].map(ext => target + ext).find(fs.existsSync);
        if (!resolved) throw new Error('Unexpected local dependency: ' + name);
        return load(resolved);
      }
      throw new Error('Unmocked dependency: ' + name);
    }, module, module.exports);
    return module.exports;
  }
  return load;
}

function loginFixture(options = {}) {
  const state = { status: 200, body: { session: { access_token: 'fixture-user-access', refresh_token: 'fixture-user-refresh' } },
    user: { id: 'fixture-user' }, profile: { role: 'staff', is_active: true, platform_role: 'staff', law_firm_id: 'fixture-firm' },
    active: true, ...options };
  const events = [], requests = [], sessionArgs = [], replacements = [], signOutArgs = [];
  let tree, signOuts = 0, refreshes = 0, authCalls = 0;
  const client = {
    auth: {
      signInWithPassword: forbidden,
      setSession: async session => {
        events.push('setSession:start'); authCalls++; sessionArgs.push(clone(session));
        if (state.sessionHold) await state.sessionHold.promise;
        events.push('setSession:end');
        if (state.sessionThrow) throw new Error('fixture session network failure');
        return { data: { user: state.user, session: state.user ? { ...session, user: state.user } : null }, error: state.sessionError ? new Error('fixture invalid session') : null };
      },
      signOut: async options => { events.push('signOut'); signOuts++; signOutArgs.push(clone(options)); return { error: null }; },
      admin: new Proxy({}, { get: () => forbidden }),
    },
    from(table) {
      assert.equal(table, 'profiles'); events.push('profile:start'); let profileId;
      return { select() { return this; }, eq(key, value) { assert.equal(key, 'id'); profileId = value; return this; },
        maybeSingle: async () => { assert.equal(profileId, state.user?.id); events.push('profile:end');
          return { data: clone(state.profile), error: state.profileError ? new Error('fixture profile error') : null }; } };
    },
    rpc: async name => { assert.equal(name, 'is_active_user'); events.push('active'); return { data: state.active, error: state.activeError ? new Error('fixture active check error') : null }; },
  };
  const fetch = async (url, init) => {
    assert.equal(url, '/api/auth/login'); assert.equal(init.method, 'POST');
    assert.equal(init.cache, 'no-store'); assert.equal(init.headers['Content-Type'], 'application/json');
    events.push('request:start'); requests.push({ url, ...init, body: JSON.parse(init.body) });
    if (state.requestHold) await state.requestHold.promise;
    events.push('request:end');
    if (state.requestError) throw new Error('fixture request failed');
    return { ok: state.status >= 200 && state.status < 300, status: state.status, json: async () => clone(state.body) };
  };
  const load = sourceLoader({
    'next/link': { __esModule: true, default: ({ children, ...props }) => h('a', props, children) },
    'next/navigation': { useRouter: () => ({ replace: value => { events.push('replace'); replacements.push(value); }, refresh: () => { events.push('refresh'); refreshes++; } }),
      useSearchParams: () => ({ get: key => key === 'next' ? state.next ?? null : null }) },
    '@/components/brand/BrandLogo': { BrandLogo: () => null },
    '@/lib/supabase/client': { hasSupabaseEnv: () => state.configured !== false, createClient: () => client },
    '@/lib/supabase/admin': { createAdminClient: forbidden },
  }, { fetch });
  const Page = load('app/login/page.tsx').default;
  return { state, events, requests, sessionArgs, replacements, signOutArgs, load,
    get tree() { return tree; }, get signOuts() { return signOuts; }, get refreshes() { return refreshes; }, get authCalls() { return authCalls; },
    mount: async () => { await act(async () => { tree = Renderer.create(h(Page)); }); },
    fill: async (identifier = 'fixture.person', password = ' fixture password ') => {
      await act(async () => {
        tree.root.findByProps({ autoComplete: 'username' }).props.onChange({ target: { value: identifier } });
        tree.root.findByProps({ autoComplete: 'current-password' }).props.onChange({ target: { value: password } });
      });
    },
    submit: async () => { await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); }); },
    close: async () => { await act(async () => tree.unmount()); },
  };
}

test('actual login form describes existing account IDs and preserves username/password autofill semantics', async () => {
  const f = loginFixture(); await f.mount();
  try {
    assert.match(text(f.tree.toJSON()), /아이디 또는 이메일/);
    assert.match(text(f.tree.toJSON()), /기존 계정은 이메일의 @ 앞부분을 아이디로 사용할 수 있습니다\./);
    const identifier = f.tree.root.findByProps({ autoComplete: 'username' }), password = f.tree.root.findByProps({ autoComplete: 'current-password' });
    assert.equal(identifier.props.type, 'text'); assert.equal(identifier.props.autoCapitalize, 'none'); assert.equal(identifier.props.spellCheck, false);
    assert.equal(identifier.props.required, true); assert.equal(password.props.type, 'password'); assert.equal(password.props.required, true);
    assert.equal(f.requests.length, 0); assert.equal(f.authCalls, 0);
  } finally { await f.close(); }
});

test('actual alias submit authenticates through endpoint, installs user session, then verifies profile/firm before navigation', async () => {
  const f = loginFixture({ next: '/cases?status=active#selected' }); await f.mount();
  try {
    await f.fill(' fixture.person ', '  exact password  '); await f.submit();
    assert.deepEqual(f.requests.map(row => row.body), [{ identifier: 'fixture.person', password: '  exact password  ' }]);
    assert.deepEqual(f.sessionArgs, [{ access_token: 'fixture-user-access', refresh_token: 'fixture-user-refresh' }]);
    assert.deepEqual(f.events, ['request:start', 'request:end', 'setSession:start', 'setSession:end', 'profile:start', 'profile:end', 'active', 'replace', 'refresh']);
    assert.deepEqual(f.replacements, ['/cases?status=active#selected']); assert.equal(f.refreshes, 1); assert.equal(f.signOuts, 0);
  } finally { await f.close(); }
});

test('full email, plus-tag email and demo IDs reach the same login endpoint without rewriting a password', async () => {
  for (const identifier of [' Person+tag@firm.example ', 'TEST4', 'test6@demo.lawpower.invalid']) {
    const f = loginFixture(); await f.mount();
    try {
      await f.fill(identifier, ' padded password '); await f.submit();
      assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.identifier.toLowerCase(), identifier.trim().toLowerCase());
      assert.equal(f.requests[0].body.password, ' padded password '); assert.deepEqual(f.replacements, ['/']);
    } finally { await f.close(); }
  }
});

test('actual login cannot navigate or query profile while browser session installation is pending', async () => {
  const held = deferred(), f = loginFixture({ sessionHold: held }); await f.mount(); await f.fill(); let submission;
  try {
    await act(async () => { submission = f.tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); await Promise.resolve(); });
    assert.deepEqual(f.events, ['request:start', 'request:end', 'setSession:start']); assert.equal(f.replacements.length, 0);
    assert.equal(f.tree.root.findByType('button').props.disabled, true);
    held.resolve(); await act(async () => { await submission; });
    assert.deepEqual(f.replacements, ['/']); assert.equal(f.events.filter(event => event === 'profile:start').length, 1);
  } finally { held.resolve(); await f.close(); }
});

test('same-tick and pending duplicate form submissions produce only one request and one installed session', async () => {
  const held = deferred(), f = loginFixture({ requestHold: held }); await f.mount(); await f.fill(); let first, duplicate;
  try {
    await act(async () => {
      const handler = f.tree.root.findByType('form').props.onSubmit;
      first = handler({ preventDefault() {} }); duplicate = handler({ preventDefault() {} });
    });
    assert.equal(f.requests.length, 1); assert.equal(f.tree.root.findByType('button').props.disabled, true);
    await act(async () => { await f.tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.equal(f.requests.length, 1);
    held.resolve(); await act(async () => { await Promise.all([first, duplicate]); });
    assert.equal(f.authCalls, 1); assert.deepEqual(f.replacements, ['/']);
  } finally { held.resolve(); await f.close(); }
});

test('generic endpoint rejection leaves no browser session or redirect and permits a corrected retry', async () => {
  const message = '아이디 또는 이메일과 비밀번호를 확인해주세요.';
  const f = loginFixture({ status: 401, body: { error: message } }); await f.mount(); await f.fill('missing', 'wrong password');
  try {
    await f.submit(); assert.equal(f.authCalls, 0); assert.equal(f.replacements.length, 0); assert.equal(f.refreshes, 0);
    assert.match(text(f.tree.toJSON()), /아이디 또는 이메일과 비밀번호를 확인해주세요/);
    assert.equal(f.tree.root.findByType('button').props.disabled, false);
    assert.equal(f.tree.root.findByProps({ autoComplete: 'username' }).props.value, 'missing');
    f.state.status = 200; f.state.body = { session: { access_token: 'retry-access', refresh_token: 'retry-refresh' } };
    await f.fill('fixture.person', 'correct password'); await f.submit();
    assert.equal(f.requests.length, 2); assert.deepEqual(f.sessionArgs, [{ access_token: 'retry-access', refresh_token: 'retry-refresh' }]);
    assert.deepEqual(f.replacements, ['/']); assert.doesNotMatch(text(f.tree.toJSON()), /아이디 또는 이메일과 비밀번호를 확인해주세요/);
  } finally { await f.close(); }
});

test('request errors and malformed session payloads fail without profile reads or navigation', async () => {
  for (const options of [{ requestError: true }, { body: {} }, { body: { session: null } },
    { body: { session: { access_token: 'one-token-only' } } }, { body: { session: { access_token: '', refresh_token: 'refresh' } } }]) {
    const f = loginFixture(options); await f.mount(); await f.fill();
    try {
      await f.submit(); assert.equal(f.authCalls, 0); assert.equal(f.replacements.length, 0); assert.equal(f.refreshes, 0);
      assert.ok(!f.events.includes('profile:start')); assert.equal(f.tree.root.findByType('button').props.disabled, false);
      assert.ok(!text(f.tree.toJSON()).includes('fixture-user-access'));
    } finally { await f.close(); }
  }
});

test('failed or incomplete installed auth sessions are cleaned up and cannot enter the application', async () => {
  for (const options of [{ sessionError: true }, { sessionThrow: true }, { user: null }]) {
    const f = loginFixture(options); await f.mount(); await f.fill();
    try {
      await f.submit(); assert.equal(f.authCalls, 1); assert.equal(f.signOuts, 1);
      assert.deepEqual(f.signOutArgs, [{ scope: 'local' }]);
      assert.ok(!f.events.includes('profile:start')); assert.equal(f.replacements.length, 0); assert.equal(f.refreshes, 0);
      assert.equal(f.tree.root.findByType('button').props.disabled, false);
    } finally { await f.close(); }
  }
});

test('profile missing/error/inactive and suspended-firm/RPC failures sign out before any redirect', async () => {
  for (const options of [{ profile: null }, { profileError: true }, { profile: { is_active: false, platform_role: 'staff' } },
    { active: false }, { active: null }, { activeError: true }]) {
    const f = loginFixture(options); await f.mount(); await f.fill();
    try {
      await f.submit(); assert.equal(f.authCalls, 1); assert.equal(f.signOuts, 1); assert.equal(f.replacements.length, 0); assert.equal(f.refreshes, 0);
      assert.deepEqual(f.signOutArgs, [{ scope: 'local' }]);
      assert.equal(f.events.at(-1), 'signOut'); assert.equal(f.tree.root.findByType('button').props.disabled, false);
      if (options.profile === null || options.profileError || options.profile?.is_active === false) assert.ok(!f.events.includes('active'));
    } finally { await f.close(); }
  }
});

test('superadmin default and slash next use platform, normal internal next is retained, external-shaped next is rejected', async () => {
  for (const [options, expected] of [
    [{}, '/'],
    [{ profile: { role: 'admin', is_active: true, platform_role: 'super_admin', law_firm_id: null } }, '/platform'],
    [{ profile: { role: 'admin', is_active: true, platform_role: 'super_admin', law_firm_id: null }, next: '/' }, '/platform'],
    [{ next: '/db?query=%EA%B3%A0%EA%B0%9D' }, '/db?query=%EA%B3%A0%EA%B0%9D'],
    ...['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/%2fevil.invalid', '/%5cevil.invalid', '/%252fevil.invalid', '/\nevil.invalid'].map(next => [{ next }, '/']),
  ]) {
    const f = loginFixture(options); await f.mount(); await f.fill();
    try { await f.submit(); assert.deepEqual(f.replacements, [expected], String(options.next)); }
    finally { await f.close(); }
  }
});

test('invalid identifiers and missing configuration cannot initiate authentication', async () => {
  for (const identifier of ['', 'some body', 'a@@firm.example', 'user@domain space']) {
    const f = loginFixture(); await f.mount(); await f.fill(identifier);
    try { await f.submit(); assert.equal(f.requests.length, 0); assert.equal(f.authCalls, 0); assert.equal(f.replacements.length, 0); }
    finally { await f.close(); }
  }
  const f = loginFixture({ configured: false }); await f.mount();
  try { assert.equal(f.tree.root.findAllByType('form').length, 0); assert.match(text(f.tree.toJSON()), /Supabase 연결정보가 없습니다/); assert.equal(f.requests.length, 0); }
  finally { await f.close(); }
});

test('actual parser preserves full email and treats local-part punctuation literally with bounded input lengths', () => {
  const { parseLoginIdentifier } = sourceLoader()('lib/auth/login-identifier.ts');
  for (const value of ['Person+tag@firm.example', 'Person.Name@firm.example']) assert.deepEqual(clone(parseLoginIdentifier(' ' + value + ' ')), { kind: 'email', value });
  for (const value of ['Person', 'PERSON.Name+tag_99', 'literal%part', 'test4']) {
    assert.deepEqual(clone(parseLoginIdentifier(' ' + value + ' ')), { kind: 'id', value: value.toLowerCase() });
  }
  assert.equal(parseLoginIdentifier('x'.repeat(64)).kind, 'id');
  const email254 = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61);
  assert.equal(email254.length, 254); assert.equal(parseLoginIdentifier(email254).kind, 'email');
  for (const value of ['', ' ', 'x'.repeat(65), email254 + 'd', 'a@@b.example', 'spaces here', 'name\\suffix', 'a\u0000b']) {
    assert.throws(() => parseLoginIdentifier(value), /아이디 또는 이메일/);
  }
});

test('actual safe-next helper rejects external/encoded separators, controls and malformed escapes while retaining internal query/hash', () => {
  const { safeLoginNext } = sourceLoader()('lib/auth/login-identifier.ts');
  for (const [value, expected] of [['/', '/'], ['/cases/one?tab=payment#history', '/cases/one?tab=payment#history'],
    ['/db?query=%EA%B3%A0%EA%B0%9D', '/db?query=%EA%B3%A0%EA%B0%9D'], ['/cases/../db', '/db'], ['/db?name=two%20words', '/db?name=two%20words']]) {
    assert.equal(safeLoginNext(value), expected);
  }
  for (const value of [null, '', 'https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/\tevil.invalid', '/\u0000evil.invalid',
    '/%2Fevil.invalid', '/%5Cevil.invalid', '/%252fevil.invalid', '/%255cevil.invalid', '/%0devil.invalid', '/%20evil.invalid', '/%', '/%zz',
    '/%25252525252fevil.invalid', ' /cases', '/cases with spaces']) {
    assert.equal(safeLoginNext(value), null, String(value));
  }
});

test('generic parser does not change legacy demo provisioning identities or ready-marker aliases', () => {
  const login = sourceLoader()('lib/auth/login-identifier.ts');
  assert.deepEqual(Array.from(login.DEMO_LOGIN_IDS), ['test', 'test1', 'test2', 'test3']);
  assert.deepEqual(Array.from(login.DEMO_LOGIN_ALIASES), ['test', 'test1', 'test2', 'test3', 'test4', 'test5', 'test6']);
  for (const alias of login.DEMO_LOGIN_ALIASES) assert.equal(login.normalizeLoginIdentifier(alias.toUpperCase()), alias + '@demo.lawpower.invalid');
  assert.throws(() => login.normalizeLoginIdentifier('ordinary.localpart'));
  assert.deepEqual(clone(login.parseLoginIdentifier('ordinary.localpart')), { kind: 'id', value: 'ordinary.localpart' });
});

async function middlewareFixture(pathname, { authenticated = false, role = 'staff', refresh = false } = {}) {
  const events = [], requestCookies = [], responseCookies = [];
  let options;
  const client = { auth: { getUser: async () => {
    events.push('getUser');
    if (refresh) options.cookies.setAll([{ name: 'sb-fixture', value: 'refreshed-user-cookie', options: { path: '/', sameSite: 'lax' } }]);
    return { data: { user: authenticated ? { id: 'fixture-user' } : null }, error: null };
  } }, from(table) { assert.equal(table, 'profiles'); events.push('profile'); return { select() { return this; }, eq(key, value) { assert.equal(key, 'id'); assert.equal(value, 'fixture-user'); return this; },
    maybeSingle: async () => ({ data: { is_active: true, platform_role: role, law_firm_id: 'fixture-firm' }, error: null }) }; } };
  const resultFactory = (kind, url) => ({ kind, url, cookies: { set: (...args) => responseCookies.push(args) }, headers: new Map() });
  const load = sourceLoader({
    '@supabase/ssr': { createServerClient: (url, key, config) => { assert.equal(url, 'https://fixture.invalid'); assert.equal(key, 'fixture-public-key'); events.push('createClient'); options = config; return client; } },
    'next/server': { NextResponse: { next: () => resultFactory('next'), redirect: url => resultFactory('redirect', url) } },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key', SUPABASE_SERVICE_ROLE_KEY: 'never-use-privileged-key' } } });
  const url = new URL(pathname, 'https://fixture.invalid');
  const result = await load('middleware.ts').middleware({ nextUrl: { pathname: url.pathname, clone: () => new URL(url) },
    cookies: { getAll: () => [], set: (...args) => requestCookies.push(args) } });
  return { result, events, requestCookies, responseCookies };
}

test('actual middleware permits only the exact new anonymous login endpoint, leaving other auth/admin APIs protected', async () => {
  const login = await middlewareFixture('/api/auth/login'); assert.equal(login.result.kind, 'next'); assert.deepEqual(login.events, []);
  for (const pathname of ['/api/auth/login-extra', '/api/auth/login/nested', '/api/auth/users', '/api/admin/users', '/api/account/password', '/db']) {
    const f = await middlewareFixture(pathname); assert.equal(f.result.kind, 'redirect', pathname);
    assert.equal(f.result.url.pathname, '/login'); assert.equal(f.result.url.searchParams.get('next'), pathname);
    assert.deepEqual(f.events, ['createClient', 'getUser']);
  }
});

test('actual middleware preserves existing public integrations, invitation and login page behavior', async () => {
  for (const pathname of ['/join', '/api/join', '/api/integrations/google-sheets/leads', '/api/integrations/meta/flush', '/api/sms/dispatch']) {
    const f = await middlewareFixture(pathname); assert.equal(f.result.kind, 'next'); assert.deepEqual(f.events, []);
  }
  const login = await middlewareFixture('/login'); assert.equal(login.result.kind, 'next'); assert.deepEqual(login.events, ['createClient', 'getUser']);
});

test('actual middleware keeps role boundaries and authenticated login redirect while refreshing user cookies', async () => {
  for (const [pathname, role, target] of [['/login', 'staff', '/'], ['/login', 'super_admin', '/platform'],
    ['/platform', 'staff', '/'], ['/firm/settings', 'staff', '/']]) {
    const f = await middlewareFixture(pathname, { authenticated: true, role });
    assert.equal(f.result.kind, 'redirect'); assert.equal(f.result.url.pathname, target); assert.equal(f.result.url.search, '');
    assert.deepEqual(f.events, ['createClient', 'getUser', 'profile']);
  }
  for (const role of ['staff', 'firm_admin', 'super_admin']) {
    const f = await middlewareFixture('/db', { authenticated: true, role, refresh: true });
    assert.equal(f.result.kind, 'next'); assert.deepEqual(f.requestCookies, [['sb-fixture', 'refreshed-user-cookie']]);
    assert.deepEqual(clone(f.responseCookies), [['sb-fixture', 'refreshed-user-cookie', { path: '/', sameSite: 'lax' }]]);
  }
});
