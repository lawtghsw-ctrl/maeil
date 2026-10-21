# Consultation PDF download reliability

## Reproduced failures and fixes

- With `structuredClone` unavailable, the previous consultation export handler failed before invoking PDF generation. The snapshot now uses a small plain-data deep copy that preserves nested records, optional values, zero/false and non-finite numeric values without that browser API. It still captures the click-time draft before asynchronous loading.
- Persisted consultation JSON is type-asserted, not runtime-validated (`fetchEntityTable` in `lib/store.tsx`). Synthetic legacy arrays/objects in otherwise allowed text fields reproduced `value.replace is not a function`. Scalar lists now retain every value. Unexpected objects display `[입력 형식 확인 필요]` in the affected field rather than aborting the whole PDF. Their unknown keys/IDs/URLs/bytes are deliberately not serialized. Stored customer data is not modified.
- Null/non-object items in asset, debt, loan, memo and attachment collections also reproduced property-access failures. Export now retains one explicitly numbered warning row per invalid item, all valid neighboring rows and complete visible counts. Invalid collection shapes are marked rather than traversed. Deleted memos remain excluded and pin ordering remains unchanged. Inferred loan totals display `확인 필요` when a corrupt loan row prevents a complete total; explicit user-entered totals still take precedence. This hardening is limited to PDF serialization, not general malformed-record handling in the consultation UI.
- An extreme but parseable date could exceed JavaScript's date range after adding the Korean-time offset. Invalid/extreme legacy dates are retained as text rather than throwing.
- The original flow offered only an automatic download after asynchronous generation. The modal now retains native **만든 PDF 파일 저장** and **만든 PDF 열기** links to the same generated local blob, including when the automatic click throws. A fresh explicit click does not regenerate the PDF or wait for asynchronous work. This is a compatibility fallback, not a claim that a particular user's browser blocked the old flow.

These are verified code-path defects using synthetic records/browser-API simulation, not proof of the exact cause of the reported production failures. No real customer record was exported or uploaded during verification.

## Boundaries preserved

- The existing consultation-view boundary and read-only export behavior remain unchanged. Hidden finance and hidden detail-stage data are not included.
- Middleware, role policies, tenant selection, database schema and customer access are unchanged. Synthetic middleware checks confirm the existing font route accepts authenticated staff, firm administrators and super administrators; anonymous requests still redirect to login.
- The only fetch made by PDF creation is the existing same-origin static font request. No new API, upload, external PDF service or customer-data transmission is introduced.
- Prepared blob URLs are revoked on regeneration, customer switch, modal close and unmount. Late generation results after a close/switch never become downloadable under another customer.
- The compact A4 portrait layout, embedded NanumGothic, 10 pt body, 9 pt labels/footers, complete multi-page overflow and attachment metadata allowlist are retained. Unsupported emoji remain represented by reversible Unicode markers.

## Verification

```sh
node --test tests/consultation-pdf*.test.cjs tests/consultation-memos.test.cjs tests/customer-phone-ui.test.cjs
npx tsc --noEmit --pretty false
git diff --check
```

The targeted run passed 50 tests. Real generated PDFs are checked for A4 dimensions, embedded Korean glyphs, readable text, bounded cells, complete long text and footers. Short/populated/stress fixtures remain at 1/2/7 pages. Added cases cover empty/partial consultation records, null arrays accepted by the modal's existing defaults, legacy scalar arrays, malformed text objects, null/non-object collection items, invalid collection shapes, preserved neighbor rows/counts, incomplete inferred loan totals, invalid/extreme dates, negative/non-finite numeric values, emoji and long memos/debts. UI tests cover unavailable `structuredClone`, blocked automatic download, native fallback links, retries, close/switch races and read-only/finance boundaries.

A synthetic-only real Chromium check was prepared but did not execute: the task sandbox blocked Chromium's socket startup, and the supported escalation route also failed during environment setup. Therefore actual Safari/mobile/embedded-browser behavior and authenticated production end-to-end download behavior remain unverified. The existing PDF render/extraction tests and React UI tests did run successfully; they are not a substitute for those browser checks.
