// Exercise the installed Next 14 fetch cache with an entirely fake origin.
// No application credentials, database, relay, or network are accessed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { patchFetch } = require('next/dist/server/lib/patch-fetch');

const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

function harness() {
  const storage = new AsyncLocalStorage(), entries = new Map();
  let rows = 2, calls = 0;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).hostname, 'offline.invalid');
    calls++;
    return new Response(JSON.stringify({ rows }), { headers: { 'content-type': 'application/json' } });
  };
  patchFetch({ serverHooks: { DynamicServerError: class extends Error {} }, staticGenerationAsyncStorage: storage });
  const patchedFetch = globalThis.fetch;
  const cache = {
    fetchCacheKey: async (url, init) => JSON.stringify([url, init.method || 'GET', init.body || '']),
    lock: async () => async () => {},
    get: async key => entries.get(key),
    set: async (key, value) => { entries.set(key, { value, isStale: false }); },
  };
  return {
    setRows(value) { rows = value; },
    calls: () => calls,
    async read({ directives = {}, method = 'GET', explicitNoStore = false } = {}) {
      // Matches a GET-only App Route's initial store in Next 14.2.15:
      // force-dynamic sets forceDynamic, but leaves the fetch default false.
      const store = {
        forceDynamic: true, isStaticGeneration: false, revalidate: false,
        urlPathname: '/api/sms/history', pagePath: '/api/sms/history/route',
        incrementalCache: cache, ...directives,
      };
      return storage.run(store, async () => {
        const response = await patchedFetch('https://offline.invalid/rest/v1/history-read', {
          method, headers: { authorization: 'Bearer offline-only' },
          ...(method === 'POST' ? { body: '{"scope":"offline"}' } : {}),
          ...(explicitNoStore ? { cache: 'no-store' } : {}),
        });
        return response.json();
      });
    },
  };
}

function routeDirectives(name) {
  const source = readFileSync(resolve(__dirname, '../../../app/api/sms', name, 'route.ts'), 'utf8');
  assert.match(source, /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(source, /export\s+const\s+revalidate\s*=\s*0\s*;/, `${name} must explicitly disable fetch revalidation caching`);
  assert.match(source, /export\s+const\s+fetchCache\s*=\s*["']force-no-store["']\s*;/, `${name} must disable nested Supabase/RPC fetch caching`);
  return { revalidate: 0, fetchCache: 'force-no-store' };
}

for (const method of ['GET', 'POST']) {
  test(`reproduce stale ${method} Supabase reads with force-dynamic alone`, async () => {
    const fixture = harness();
    assert.equal((await fixture.read({ method })).rows, 2);
    fixture.setRows(3);
    assert.equal((await fixture.read({ method })).rows, 2);
    assert.equal(fixture.calls(), 1);
  });
  for (const route of ['history', 'delivery']) {
    test(`${route} directives refresh ${method} reads even when an older fetch cache entry exists`, async () => {
      const fixture = harness();
      assert.equal((await fixture.read({ method })).rows, 2);
      fixture.setRows(3);
      const directives = routeDirectives(route);
      assert.equal((await fixture.read({ method, directives })).rows, 3);
      fixture.setRows(4);
      assert.equal((await fixture.read({ method, directives })).rows, 4);
      assert.equal(fixture.calls(), 3);
    });
  }
}
test('explicit fetch no-store also bypasses a previously cached authenticated read', async () => {
  const fixture = harness();
  assert.equal((await fixture.read()).rows, 2);
  fixture.setRows(3);
  assert.equal((await fixture.read({ explicitNoStore: true })).rows, 3);
  assert.equal(fixture.calls(), 2);
});
