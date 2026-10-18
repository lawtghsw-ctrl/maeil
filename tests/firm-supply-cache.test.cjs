// Offline: exercise the installed Next fetch cache with synthetic responses.
// No Supabase credentials, network requests, or database writes are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const routePath = path.resolve(__dirname, '../app/api/admin/firm-supply/route.ts');
const source = fs.readFileSync(routePath, 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: exportsObject,
  require: () => ({}),
});

test('firm supply disables both route and nested Supabase GET caching', () => {
  assert.equal(exportsObject.dynamic, 'force-dynamic');
  assert.equal(exportsObject.revalidate, 0);
  assert.equal(exportsObject.fetchCache, 'force-no-store');
  assert.match(source, /Cache-Control": "private, no-store"/);
});

test('installed Next runtime reproduces old stale reads, while route config reads new supply and lead snapshots on every request', async () => {
  const originalFetch = global.fetch;
  const cache = new Map();
  let store;
  let sourceCount = 238;
  let originCalls = 0;
  global.fetch = async () => {
    originCalls++;
    return new Response(JSON.stringify({ supplied: sourceCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    require('next/dist/server/lib/patch-fetch').patchFetch({
      serverHooks: { DynamicServerError: class extends Error {} },
      staticGenerationAsyncStorage: { getStore: () => store },
    });
    const incrementalCache = {
      fetchCacheKey: async url => url,
      lock: async () => async () => {},
      get: async key => cache.has(key) ? { value: cache.get(key), isStale: false } : null,
      set: async (key, value) => { cache.set(key, value); },
    };
    async function read(config = {}, table = 'lead_supply_ledger') {
      // Next 14's route module sets forceDynamic without revalidate=0.
      store = { urlPathname: '/api/admin/firm-supply', pagePath: '/api/admin/firm-supply/route',
        isStaticGeneration: false, forceDynamic: true, revalidate: false, incrementalCache, ...config };
      return (await global.fetch(`https://offline.invalid/rest/v1/${table}`, {
        headers: { authorization: 'Bearer synthetic-test-only' },
      })).json();
    }
    assert.equal((await read()).supplied, 238);
    sourceCount = 241;
    assert.equal((await read()).supplied, 238);
    assert.equal(originCalls, 1, 'baseline reproduces a cached nested read');
    const config = { revalidate: exportsObject.revalidate, fetchCache: exportsObject.fetchCache };
    assert.equal((await read(config)).supplied, 241);
    sourceCount = 242;
    assert.equal((await read(config)).supplied, 242);
    assert.equal((await read(config, 'app_leads')).supplied, 242);
    sourceCount = 243;
    assert.equal((await read(config, 'app_leads')).supplied, 243);
    assert.equal(originCalls, 5, 'every fixed route read reaches the mock origin');
  } finally {
    global.fetch = originalFetch;
  }
});
