const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real middleware with synthetic sessions only. This deliberately
// does not exempt fonts from login, alter roles, or access any customer records.
async function request(pathname, role, authenticated = true) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../middleware.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }, queries = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'synthetic-user' } : null } }) },
    from: table => { queries.push(table); return { select: () => ({ eq: (_key, value) => {
      assert.equal(value, 'synthetic-user');
      return { maybeSingle: async () => ({ data: { is_active: true, platform_role: role, law_firm_id: 'synthetic-firm' } }) };
    } }) }; },
  };
  const requireMock = name => {
    if (name === '@supabase/ssr') return { createServerClient: () => supabase };
    if (name === 'next/server') return { NextResponse: { next: () => ({ kind: 'next', cookies: { set() {} } }), redirect: url => ({ kind: 'redirect', url }) } };
    throw new Error('Unexpected dependency: ' + name);
  };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-only' } } })(requireMock, module, module.exports);
  const url = new URL(pathname, 'https://synthetic.invalid');
  const result = await module.exports.middleware({ nextUrl: { pathname, clone: () => new URL(url) }, cookies: { getAll: () => [], set() {} } });
  return { result, queries };
}

test('font required by PDF is available to authenticated staff, firm admins and super admins without export-specific access', async () => {
  for (const role of ['staff', 'firm_admin', 'super_admin']) {
    const { result, queries } = await request('/fonts/NanumGothic-Regular.ttf', role);
    assert.equal(result.kind, 'next', role); assert.deepEqual(queries, ['profiles']);
  }
});

test('PDF font checks preserve anonymous login and unrelated role boundaries', async () => {
  const anonymous = await request('/fonts/NanumGothic-Regular.ttf', 'staff', false);
  assert.equal(anonymous.result.kind, 'redirect'); assert.equal(anonymous.result.url.pathname, '/login');
  assert.equal(anonymous.result.url.searchParams.get('next'), '/fonts/NanumGothic-Regular.ttf');
  assert.deepEqual(anonymous.queries, []);
  for (const pathname of ['/platform', '/firm/settings']) {
    const { result } = await request(pathname, 'staff');
    assert.equal(result.kind, 'redirect'); assert.equal(result.url.pathname, '/');
  }
});
