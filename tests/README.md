# Performance regression checks

These checks compare the optimized code with commit
`6acb7b9473fec6d36e5a20eda0ae1695bec7a131`. They run offline with synthetic
fixtures and mocked Supabase/provider access. They never use production records
or send text messages.

Install the application dependencies first. The store and DB component checks
also use React's renderer in a separate test runtime, so no renderer dependency
is included in the deployed application:

```powershell
npm install --prefix ../store-test-runtime --no-save --package-lock=false react@18.3.1 react-test-renderer@18.3.1
node --test --test-concurrency=1 tests/*.test.cjs
node --test --test-timeout=20000 --test-concurrency=1 services/sms-relay/test/*.test.mjs services/sms-relay/test/*.test.cjs
npm run build
```

The baseline commit must be available in the Git checkout (including when using
a shallow CI clone). Lookup counts and render counts measure specific work
avoided; they are not production response-time measurements. The isolated DB
fixture's single-row update count assumes stable callbacks, while the real store
may invalidate callbacks when its lead collection changes.
