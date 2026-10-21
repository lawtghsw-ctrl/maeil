-- Own SMS automation editing, without granting sms.manage_settings.
-- Existing message contents, images, senders, enable flags and delivery state are unchanged.
begin;

alter table public.sms_staff_automation_settings
  add column staff_profile_id uuid references public.profiles(id) on delete set null;

-- Bind only exact, unambiguous identities. Include inactive profiles so a reused
-- name never silently claims somebody else's legacy configuration.
with identities as (
  select p.law_firm_id,
    coalesce(nullif(p.staff_name,''),nullif(p.display_name,'')) as staff_name,
    min(p.id::text)::uuid as profile_id
  from public.profiles p
  where p.law_firm_id is not null
    and nullif(btrim(coalesce(nullif(p.staff_name,''),nullif(p.display_name,''))),'') is not null
  group by p.law_firm_id,coalesce(nullif(p.staff_name,''),nullif(p.display_name,''))
  having count(*)=1
)
update public.sms_staff_automation_settings s
set staff_profile_id=i.profile_id
from identities i
where s.law_firm_id=i.law_firm_id and s.staff_name=i.staff_name;

create unique index sms_staff_auto_firm_profile_uq
  on public.sms_staff_automation_settings(law_firm_id,staff_profile_id)
  where staff_profile_id is not null;

-- All new functions are invokers. They cannot bypass profiles/settings/storage RLS.
create function public.sms_can_manage_automation(p_firm_id uuid)
returns boolean language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select public.is_super_admin() or (
    p_firm_id=public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  );
$$;

create function public.sms_is_own_automation(p_firm_id uuid,p_profile_id uuid,p_staff_name text)
returns boolean language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(
    auth.uid() is not null
    and public.is_active_user()
    and public.has_permission('sms.view')
    and p_firm_id=public.current_law_firm_id()
    and p_profile_id=auth.uid()
    and nullif(btrim(p_staff_name),'') is not null
    and p_staff_name=public.current_staff_name()
    and exists(select 1 from public.profiles p
      where p.id=p_profile_id and p.law_firm_id=p_firm_id and p.is_active=true
        and coalesce(nullif(p.staff_name,''),nullif(p.display_name,''))=p_staff_name)
    and (select count(*) from public.profiles p
      where p.law_firm_id=p_firm_id
        and coalesce(nullif(p.staff_name,''),nullif(p.display_name,''))=p_staff_name)=1,
    false
  );
$$;

create function public.sms_is_own_automation_path(p_name text)
returns boolean language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(
    split_part(p_name,'/',1)=public.current_law_firm_id()::text
    and split_part(p_name,'/',2)='auto-own'
    and split_part(p_name,'/',3)=auth.uid()::text
    and split_part(p_name,'/',4) in ('new-lead','absence')
    and p_name ~* '^[0-9a-f-]{36}/auto-own/[0-9a-f-]{36}/(new-lead|absence)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[A-Za-z0-9._-]+)?\.(jpg|jpeg|png|gif)$'
    and length(p_name)<=500
    and public.sms_is_own_automation(public.current_law_firm_id(),auth.uid(),public.current_staff_name()),
    false
  );
$$;

create function public.sms_own_automation_images_valid(
  p_paths jsonb,p_previous jsonb,p_firm_id uuid,p_profile_id uuid,p_kind text
)
returns boolean language plpgsql stable security invoker
set search_path = pg_catalog, public
as $$
declare v_path text; v_value jsonb; v_seen text[] := array[]::text[];
begin
  if p_paths is null or jsonb_typeof(p_paths)<>'array' or jsonb_array_length(p_paths)>3 then return false; end if;
  for v_value in select value from jsonb_array_elements(p_paths) loop
    if jsonb_typeof(v_value)<>'string' then return false; end if;
    v_path:=v_value #>> '{}';
    if v_path=any(v_seen) or split_part(v_path,'/',1)<>p_firm_id::text then return false; end if;
    v_seen:=array_append(v_seen,v_path);
    -- Legacy files already attached to this exact field may be kept or removed.
    -- They need not be owned by the employee: managers could have uploaded them.
    if coalesce(p_previous,'[]'::jsonb) @> jsonb_build_array(v_path) then continue; end if;
    if not public.sms_is_own_automation_path(v_path)
      or split_part(v_path,'/',3)<>p_profile_id::text
      or split_part(v_path,'/',4)<>p_kind
      or not exists(select 1 from storage.objects o where o.bucket_id='sms-media' and o.name=v_path)
    then return false; end if;
  end loop;
  return true;
end;
$$;

create function public.enforce_sms_own_automation()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_profiles uuid[]; v_old_new jsonb := '[]'; v_old_absence jsonb := '[]';
begin
  -- Trusted maintenance sessions keep their existing authority; no elevated
  -- function is created and ordinary authenticated sessions cannot take this arm.
  if current_user in ('postgres','service_role') then return new; end if;
  if public.sms_can_manage_automation(new.law_firm_id) then
    if tg_op='INSERT' and new.staff_profile_id is null then
      select array_agg(p.id) into v_profiles from public.profiles p
      where p.law_firm_id=new.law_firm_id
        and coalesce(nullif(p.staff_name,''),nullif(p.display_name,''))=new.staff_name;
      if cardinality(v_profiles)=1 then new.staff_profile_id:=v_profiles[1]; end if;
    end if;
    return new;
  end if;
  if not public.sms_is_own_automation(new.law_firm_id,new.staff_profile_id,new.staff_name) then
    raise exception 'SMS_AUTOMATION_IDENTITY' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if not public.sms_is_own_automation(old.law_firm_id,old.staff_profile_id,old.staff_name) then
      raise exception 'SMS_AUTOMATION_FORBIDDEN' using errcode='42501';
    end if;
    -- Compare all other columns, so future columns are immutable by default.
    if (to_jsonb(new)-array['new_lead_template','absence_template','new_lead_enabled','absence_enabled',
        'new_lead_image_paths','absence_image_paths','updated_by','updated_at'])
      is distinct from
       (to_jsonb(old)-array['new_lead_template','absence_template','new_lead_enabled','absence_enabled',
        'new_lead_image_paths','absence_image_paths','updated_by','updated_at']) then
      raise exception 'SMS_AUTOMATION_IMMUTABLE' using errcode='42501';
    end if;
    v_old_new:=old.new_lead_image_paths; v_old_absence:=old.absence_image_paths;
  else
    if new.sender_number_id is not null then
      raise exception 'SMS_AUTOMATION_IMMUTABLE' using errcode='42501';
    end if;
    new.id:=gen_random_uuid(); new.created_at:=now();
  end if;
  if not public.sms_own_automation_images_valid(new.new_lead_image_paths,v_old_new,new.law_firm_id,new.staff_profile_id,'new-lead')
    or not public.sms_own_automation_images_valid(new.absence_image_paths,v_old_absence,new.law_firm_id,new.staff_profile_id,'absence') then
    raise exception 'SMS_AUTOMATION_IMAGE_PATH' using errcode='42501';
  end if;
  if (new.new_lead_enabled and nullif(btrim(new.new_lead_template),'') is null)
    or (new.absence_enabled and nullif(btrim(new.absence_template),'') is null) then
    raise exception 'SMS_AUTOMATION_EMPTY_TEMPLATE' using errcode='23514';
  end if;
  new.updated_by:=auth.uid(); new.updated_at:=now();
  return new;
end;
$$;

create trigger trg_sms_staff_auto_own_guard
before insert or update on public.sms_staff_automation_settings
for each row execute function public.enforce_sms_own_automation();

create policy sms_staff_auto_own_read on public.sms_staff_automation_settings
for select to authenticated
using (public.sms_is_own_automation(law_firm_id,staff_profile_id,staff_name));
create policy sms_staff_auto_own_insert on public.sms_staff_automation_settings
for insert to authenticated
with check (public.sms_is_own_automation(law_firm_id,staff_profile_id,staff_name));
create policy sms_staff_auto_own_update on public.sms_staff_automation_settings
for update to authenticated
using (public.sms_is_own_automation(law_firm_id,staff_profile_id,staff_name))
with check (public.sms_is_own_automation(law_firm_id,staff_profile_id,staff_name));

create policy sms_media_own_auto_insert on storage.objects
for insert to authenticated
with check (bucket_id='sms-media' and public.sms_is_own_automation_path(name));
-- A permissive policy alone would be ORed with sms.send's existing broad INSERT.
-- Reserve this namespace, while leaving manual/legacy paths and manager scope intact.
create policy sms_media_own_auto_namespace on storage.objects as restrictive
for insert to authenticated
with check (
  bucket_id<>'sms-media' or split_part(name,'/',2)<>'auto-own'
  or public.is_super_admin()
  or (split_part(name,'/',1)=public.current_law_firm_id()::text
      and (public.is_firm_admin() or public.has_permission('sms.manage_settings')))
  or public.sms_is_own_automation_path(name)
);
create policy sms_media_own_auto_read on storage.objects
for select to authenticated
using (
  bucket_id='sms-media' and public.is_active_user()
  and split_part(name,'/',1)=public.current_law_firm_id()::text
  and (
    public.sms_is_own_automation_path(name)
    or exists(select 1 from public.sms_staff_automation_settings s
      where s.law_firm_id=public.current_law_firm_id() and s.staff_profile_id=auth.uid()
        and public.sms_is_own_automation(s.law_firm_id,s.staff_profile_id,s.staff_name)
        and (s.new_lead_image_paths @> jsonb_build_array(name)
          or s.absence_image_paths @> jsonb_build_array(name)))
  )
);

-- Live projects may have default EXECUTE grants for anon/authenticated/service_role.
-- Revoke each explicitly; only RLS helpers need to be callable by authenticated.
revoke all on function public.sms_can_manage_automation(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sms_is_own_automation(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.sms_is_own_automation_path(text) from public,anon,authenticated,service_role;
revoke all on function public.sms_own_automation_images_valid(jsonb,jsonb,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.enforce_sms_own_automation() from public,anon,authenticated,service_role;
grant execute on function public.sms_can_manage_automation(uuid) to authenticated;
grant execute on function public.sms_is_own_automation(uuid,uuid,text) to authenticated;
grant execute on function public.sms_is_own_automation_path(text) to authenticated;
grant execute on function public.sms_own_automation_images_valid(jsonb,jsonb,uuid,uuid,text) to authenticated;

commit;
