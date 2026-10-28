# Same-firm long-absence collaborative editing

Prepared against main `5a059efff359c7e8e2ff402b58f5343f6702010e`.

## Scope

An active same-firm user with `db.view` can manage a currently `장기부재`
lead, regardless of assignee: consultation/journal and memo edits, contact
records/reasons, basic lead fields, reservations, ordinary stage changes, and
assignment to one active same-firm work-staff account. `staff.writer` remains
excluded under the existing exact rule (`role=staff`, not platform
`firm_admin`/`super_admin`, boolean permission `staff.writer=true`). Existing
administrator rights and normal-state lead permissions remain in place.
Missing/null `detailStage` uses the existing `status=종결_중단` fallback;
explicit empty, malformed or other stages do not qualify.

No new deletion, conversion, manual SMS, finance, other-tenant, or general
client/case edit rights. This does not grant `db.view_all` or change profiles.

### Linked converted records

Consultation/memo/contact/reservation/stage updates remain shared if existing
converted references are valid and no missing records would be auto-created.
Linked name/phone/direction/assignee propagation additionally requires exact
reciprocal, unique linkage and **independent existing client assignment scope**
(client owner, `db.view_all`, or administrator). All related cases must have
matching reciprocal links. A mutable lead pointer—even one made to match a
retained customer's old source ID—is not sufficient authority. Unsupported
legacy or unowned converted core edits fail atomically with an administrator
review message. There is no automatic lineage repair/backfill.

## Database boundary

`20261028044629_shared_long_absent_edit.sql`:

- Adds non-exposed `long_absent_private` helpers and one authenticated-only
  `public.update_shared_long_absent_lead(text,jsonb,jsonb)` invoker wrapper.
- The private definer endpoint checks verified `auth.uid()`, active account and
  firm, `db.view`, non-writer status, same tenant, and the **locked current**
  old lead state. It accepts no caller-selected firm or unrestricted row.
- Checks the complete opening data snapshot (with the real row ID) under
  `FOR UPDATE`; concurrent changes fail rather than overwrite. Allows an
  authorized stage exit once, then shared access ends. Duplicate/stale
  submissions do not append duplicate audits.
- Only patches `name`, `phone`, `email`, `applicationType`, `memo`,
  `consultation`, `contactLog`, `invalidReason`, `nonContractReason`,
  `replacementRequestedAt`, `detailStage`, `status`, `assignedStaff`, and
  `reservationAt`. Required values, types, dates and assignee membership are
  validated. Null removes an optional property. New raw `수임전환` status,
  converted IDs, source/identity/tenant fields and derived metadata are denied.
- Narrowly extends three existing trigger permission functions. Direct
  updates retain their old RLS gate; conversion guards and all seven lead
  policies are unchanged. Derived values must match the existing normalizers
  and server-generated stage timestamp, not arbitrary caller values.
- Keeps old phone target-client access checks. Existing linked synchronization,
  contact append-only validation/actor attribution, and stage metadata run in
  the same transaction. Adds the ordinary change log atomically.
- Revokes explicit/default `PUBLIC`, `anon`, `service_role` function grants;
  only the entrypoint (and the internal endpoint needed by its invoker wrapper)
  is executable by `authenticated`. Internal guard helpers are not callable.

The migration does not update any lead/client/case/profile and therefore
produces no customer-change automation events. **Later authorized ordinary
edits still run the existing SMS/Meta automation triggers.** The app preserves
its existing best-effort Meta flush after a successful save. Tests never send
provider requests.

## UI and concurrency

Desktop/mobile rows, DB journal/memo, contact dialog and already-authorized
case journal use the same scoped capability helper. Shared writes do not
optimistically mutate persisted state. Server-normalized data replaces the
row only after confirmed success and only in the same user/tenant session.

Open dialogs retain their original snapshot while checking current access.
Failed drafts remain visible. Shared local drafts retain the original source
version across close/reopen, refresh, failed saves and abrupt unmount. A stale
or legacy unversioned restored draft is readable/exportable but cannot silently
overwrite a colleague's update; the user can explicitly discard it and reopen
the latest version. Contact repeat saves rebase only onto the server-confirmed
row.

## Validation and rollout

Offline synthetic PostgreSQL tests execute the actual policies/triggers and
migration (including repeated application and rollback), not permissive mocks.
They cover role/tenant/status matrices, paused firms, stage exit, stale requests,
malformed/injected patches, direct mass updates, derived-field forgery, assignment
collisions, linked-pointer and deleted-ID impersonation, atomic linked updates,
audit failure rollback and restored service-role claims. Actual React/store
fixtures cover persistence, failure, repetition and draft recovery.

Before production: recheck remote main and live definitions of the three
replaced functions; preserve newer unrelated changes. Apply only this reviewed
migration to the verified 회생/파산 project after explicit approval, then publish
the matching application commit. Verify endpoint ACLs, unchanged policies,
function definitions, unchanged customer aggregates and deployment identity.
Do not test by modifying a real customer or sending an SMS/Meta event.

Rollback: deploy the previous UI/store, then execute
`docs/shared-longabsence-edit-rollback.sql`. It restores exactly the three
preflight trigger function definitions and removes only this feature's
functions/schema. Existing shared-read policy stays. No customer data restore
is performed or needed. Recheck that no newer authorized trigger changes would
be overwritten before applying the rollback.
