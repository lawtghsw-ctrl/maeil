-- The historical JSON is preserved. Only the authenticated direct-REST path
-- to this private key is closed; validated server APIs use service_role.
begin;
create policy firm_management_api_only
on public.firm_settings as restrictive for all to authenticated
using (key <> 'management_analytics_v1')
with check (key <> 'management_analytics_v1');
commit;
