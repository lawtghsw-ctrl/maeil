# Same-firm long-absent DB read sharing

Prepared against main `f064f99600011695b361cabcd0c0aac9a04b7c05`.

## Scope

Active users with existing `db.view` access may read another assignee's
`장기부재` lead in their own firm. Writing staff (`staff.writer`) remain
excluded, including accounts retaining stale broad permissions. Existing owner,
manager and `db.view_all` rights are retained. Other stages and firms are not
newly shared. Missing/null detailStage follows the existing `종결_중단` fallback;
an explicit different/unknown stage does not qualify.

The migration adds one SELECT policy only. It does not set `db.view_all`, change
write policies, alter profiles or customer rows, or enqueue SMS. Existing
restrictive tenant/writing-staff policies remain in force. Newly shared rows
have read-only consultation/contact dialogs and no edit, conversion, deletion
or SMS shortcuts. Existing general SMS permissions are not changed.

## Verification

Synthetic offline fixtures execute current TypeScript/React and PostgreSQL RLS.
They cover same-firm reads, writer/inactive/foreign-firm denial, unchanged owner
and view_all writes, denied shared updates/deletes/conversion, and stage-exit
revocation. UI checks cover desktop/mobile and secondary dialogs.

Read-only live preflight on 2026-10-27 confirmed the six existing app_leads
policies and writer migration on Supabase project `xmxkdltynoupkxtdkmnp`
(매일 회생 어드민) match the relevant tested policies. No customer rows were
read or modified for this preflight.

## Release (requires explicit production approval)

1. Recheck remote main and preserve any newer changes.
2. Apply only `20261027090340_long_absent_shared_read.sql` to the verified
   회생 project. Confirm the new policy is SELECT-only and all six original
   app_leads policies remain unchanged.
3. Publish/deploy the reviewed code to the matching maeil application.
4. Verify the exact deployment commit and health; confirm same-firm shared
   visibility and writer exclusion without customer mutations or SMS.

Rollback: remove only policy `app_leads_long_absent_shared_read` from
`public.app_leads`, and roll back this code change if needed. Removing the
policy restores prior DB visibility; no data restoration is required.
