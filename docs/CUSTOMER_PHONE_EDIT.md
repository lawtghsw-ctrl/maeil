# Customer phone editing and consultation PDF

Prepared against `main` at `db8f0b74d3de411103715767ec337363d3927d56`.

## What changes

- DB management → consultation journal → basic information: the phone field can be edited under the existing consultation/basic-information permissions. A phone-only change participates in dirty detection, customer-scoped local draft recovery, the normal save action, and the PDF snapshot.
- Contract/customer detail popup and standalone detail page: an active administrator in a selected firm can choose **수정** beside the phone, save it, or cancel. Saving is separate from contract/installment edits. Staff and global all-firm views remain read-only for this action.
- New phone values accept 8–15 digits and familiar separators (`+` country prefix, spaces, parentheses, dots, hyphens); leading zeros and country prefixes are preserved. Empty or invalid edits are rejected. Unchanged legacy values do not block unrelated consultation updates.
- Linked lead/customer phone values are updated atomically in PostgreSQL, preserving all other JSON fields. A server failure preserves the edit for retry. Tenant and existing role/field permissions remain enforced.
- This phone implementation does not change SMS delivery, production data, contract amounts, installments, or existing permissions. The cumulative follow-up also includes separate SMS settings/UI and PDF layout fixes; see `docs/LAWPOWER_FOLLOWUP_KO.md`.

## Existing PDF feature

The current base already has a real client-side A4 portrait PDF exporter with an embedded Korean font. The **상담일지 A4 PDF 다운로드** button is in the consultation journal footer. It exports the current draft, including unsaved consultation fields and draft memo, without saving customer data. Long notes and debt rows continue onto additional A4 pages. Attachment metadata is listed, not attachment contents.

Phone editing reuses that exporter and ensures an edited phone appears in the snapshot. The cumulative follow-up compacts its layout while retaining readable Korean text and multipage overflow. It does not add another exporter or an external PDF service.

## Deployment prerequisite (not performed by this patch)

1. Review and test `supabase/migrations/20261021034000_customer_phone_edit.sql` in the normal staging environment first. It depends on the repository's existing multi-tenant tables and permission helpers. The migration has no data backfill.
2. Apply the approved migration before deploying the updated application. It creates a narrowly scoped `update_client_phone(text,text)` RPC and a lead phone change trigger. Only `authenticated` may invoke the RPC, which independently checks active admin status, stored-row firm ownership, firm active status, validation, and link consistency.
3. Confirm the migration's read-only final check returns true for both columns. Do not test with real customer data without appropriate authorization.
4. In staging, test a permitted staff consultation edit, an admin customer-detail edit, a linked lead/customer, a standalone customer, and a retained customer whose original lead was deleted. Verify read-only users and other firms cannot edit.
5. If the migration is missing, direct customer-phone saves fail visibly and preserve the entered number. Do not deploy the UI first: lead-to-customer phone synchronization relies on the new trigger.

The migration rejects cross-firm, ambiguous, or mismatched links rather than guessing which record to update. A missing original lead is accepted only when it no longer exists and no conflicting reverse link exists.

## Offline verification

All automated fixtures use synthetic data, without production Supabase access or SMS delivery.

```sh
npm install --package-lock=false
npm install --prefix ../store-test-runtime --no-save --package-lock=false react@18.3.1 react-test-renderer@18.3.1
npm install --prefix ../sms-sql-check --no-save --package-lock=false @electric-sql/pglite
node --test --test-concurrency=1 tests/customer-phone*.test.cjs tests/consultation-pdf*.test.cjs
node --test --test-concurrency=1 tests/*.test.cjs
npx tsc --noEmit --incremental false
NEXT_TELEMETRY_DISABLED=1 npm run build
```

The existing PDF test also needs `pdfinfo` and Python `pypdf`. Set `CONSULTATION_PDF_SAMPLE_DIR` to retain the synthetic PDF for visual review. The existing full regression suite uses repository history, so retain the full Git checkout.

A real authenticated staging/browser end-to-end test remains advisable before production rollout. Offline UI rendering and SQL integration tests are not a claim that production was changed or verified.

### 운영 기본 ACL 호환

Supabase의 public 스키마는 함수 생성 시 anon/authenticated/service_role에 EXECUTE를 자동 부여할 수 있습니다. 제공 SQL은 PUBLIC과 이 세 역할의 권한을 명시적으로 회수한 뒤 관리자·로펌 검증이 있는 update_client_phone RPC만 authenticated에 다시 부여합니다. 트리거/검증 보조 함수는 직접 호출할 수 없습니다. 운영 기본 ACL을 재현한 오프라인 PostgreSQL 검사에 포함됩니다.
