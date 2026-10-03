-- LawPower v28 multi-tenant platform migration
-- Apply AFTER 001~005. This preserves existing Maeil data and assigns it to the first law firm.
-- Existing app JSON payloads are kept as-is; tenant ownership is added as first-class columns + RLS.

create extension if not exists pgcrypto;

-- 1) Platform master entities -------------------------------------------------
create table if not exists public.law_firms (
  id uuid primary key default gen_random_uuid(),
  firm_code char(10) not null unique,
  name text not null,
  representative_name text,
  business_number text,
  phone text,
  status text not null default 'active' check (status in ('active','suspended')),
  is_legacy_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_law_firms_legacy_default
on public.law_firms(is_legacy_default) where is_legacy_default = true;

create or replace function public.generate_firm_code()
returns char(10)
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate char(10);
begin
  loop
    candidate := floor(1000000000 + random() * 9000000000)::bigint::text::char(10);
    exit when not exists(select 1 from public.law_firms where firm_code = candidate);
  end loop;
  return candidate;
end;
$$;

revoke all on function public.generate_firm_code() from public;
grant execute on function public.generate_firm_code() to service_role;

alter table public.profiles
  add column if not exists law_firm_id uuid references public.law_firms(id) on delete restrict,
  add column if not exists platform_role text not null default 'staff'
    check (platform_role in ('super_admin','firm_admin','staff'));

create index if not exists idx_profiles_law_firm_id on public.profiles(law_firm_id);
create index if not exists idx_profiles_platform_role on public.profiles(platform_role);

-- 2) Create Maeil as the legacy/default law firm exactly once ----------------
do $$
declare
  maeil_id uuid;
  super_id uuid;
begin
  select id into maeil_id from public.law_firms where is_legacy_default = true limit 1;
  if maeil_id is null then
    insert into public.law_firms(firm_code, name, status, is_legacy_default)
    values (public.generate_firm_code(), '매일법률사무소', 'active', true)
    returning id into maeil_id;
  end if;

  -- The oldest active admin becomes the LawPower super admin.
  select id into super_id
  from public.profiles
  where role = 'admin' and is_active = true
  order by case when display_name = '홍성원' or staff_name = '홍성원' then 0 else 1 end,
           created_at, id
  limit 1;

  if super_id is not null then
    update public.profiles
       set platform_role = 'super_admin', law_firm_id = null, updated_at = now()
     where id = super_id;
  end if;

  -- Other existing admins become Maeil firm admins; staff become Maeil staff.
  update public.profiles
     set law_firm_id = maeil_id,
         platform_role = case when role = 'admin' then 'firm_admin' else 'staff' end,
         updated_at = now()
   where id <> coalesce(super_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and law_firm_id is null;

  -- Make sure Maeil always has at least one firm administrator after the split.
  if not exists(select 1 from public.profiles where law_firm_id = maeil_id and platform_role = 'firm_admin' and is_active = true) then
    update public.profiles
       set platform_role = 'firm_admin', role = 'admin', is_active = true, updated_at = now()
     where id = (
       select id from public.profiles
       where law_firm_id = maeil_id
       order by is_active desc, created_at, id
       limit 1
     );
  end if;
end $$;

-- 3) Tenant ownership on operational tables ----------------------------------
create or replace function public.current_law_firm_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.law_firm_id
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true
  limit 1;
$$;

create or replace function public.current_platform_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.platform_role
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true
  limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_platform_role() = 'super_admin', false);
$$;

create or replace function public.is_firm_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_platform_role() in ('super_admin','firm_admin'), false);
$$;

revoke all on function public.current_law_firm_id() from public;
revoke all on function public.current_platform_role() from public;
revoke all on function public.is_super_admin() from public;
revoke all on function public.is_firm_admin() from public;
grant execute on function public.current_law_firm_id() to authenticated;
grant execute on function public.current_platform_role() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_firm_admin() to authenticated;

-- First assign existing business rows to Maeil, then add tenant indexes.
do $$
declare
  t text;
  maeil_id uuid;
begin
  select id into maeil_id from public.law_firms where is_legacy_default = true limit 1;
  foreach t in array array[
    'app_leads','app_clients','app_cases','app_installments',
    'app_schedule_items','app_board_posts','app_change_logs'
  ] loop
    execute format('alter table public.%I add column if not exists law_firm_id uuid references public.law_firms(id) on delete restrict', t);
    execute format('update public.%I set law_firm_id = $1 where law_firm_id is null', t) using maeil_id;
    execute format('create index if not exists %I on public.%I(law_firm_id)', 'idx_' || t || '_law_firm_id', t);
  end loop;
end $$;

-- Import rows also become tenant-scoped. Duplicate external keys are tenant-local.
alter table if exists public.app_lead_imports
  add column if not exists law_firm_id uuid references public.law_firms(id) on delete restrict;

do $$
declare maeil_id uuid;
begin
  select id into maeil_id from public.law_firms where is_legacy_default = true limit 1;
  if to_regclass('public.app_lead_imports') is not null then
    update public.app_lead_imports set law_firm_id = maeil_id where law_firm_id is null;
  end if;
end $$;

-- Replace old global PK so the same Google external key can exist in separate firms.
do $$
begin
  if to_regclass('public.app_lead_imports') is not null then
    begin
      alter table public.app_lead_imports drop constraint app_lead_imports_pkey;
    exception when undefined_object then null;
    end;
    begin
      alter table public.app_lead_imports add constraint app_lead_imports_pkey primary key(law_firm_id, external_key);
    exception when duplicate_object then null;
    end;
    create index if not exists idx_app_lead_imports_firm on public.app_lead_imports(law_firm_id, imported_at desc);
  end if;
end $$;

-- Auto-attach authenticated firm users to their own tenant on browser-side inserts.
create or replace function public.attach_current_firm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.law_firm_id is null and auth.role() <> 'service_role' then
    new.law_firm_id := public.current_law_firm_id();
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'app_leads','app_clients','app_cases','app_installments',
    'app_schedule_items','app_board_posts','app_change_logs'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_attach_firm', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.attach_current_firm()', 'trg_' || t || '_attach_firm', t);
  end loop;
end $$;

-- 4) Invitations, integrations and source lineage -----------------------------
create table if not exists public.firm_invites (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  code_hash text not null unique,
  code_preview text not null,
  role text not null default 'staff' check(role in ('staff','firm_admin')),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_firm_invites_firm on public.firm_invites(law_firm_id, created_at desc);

create table if not exists public.firm_meta_accounts (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  name text not null,
  business_id text,
  ad_account_id text,
  page_id text,
  dataset_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_firm_meta_accounts_firm on public.firm_meta_accounts(law_firm_id, active);

create table if not exists public.firm_sheet_integrations (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  name text not null,
  spreadsheet_id text,
  sheet_name text not null default 'Raw2',
  secret_hash text not null,
  active boolean not null default true,
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_firm_sheet_integrations_firm on public.firm_sheet_integrations(law_firm_id, active);
create unique index if not exists uq_firm_sheet_integration_location on public.firm_sheet_integrations(law_firm_id,spreadsheet_id,sheet_name) where spreadsheet_id is not null;

create table if not exists public.ad_sources (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  sheet_integration_id uuid references public.firm_sheet_integrations(id) on delete set null,
  meta_account_id uuid references public.firm_meta_accounts(id) on delete set null,
  source_key text not null unique,
  name text not null,
  meta_form_id text,
  campaign_id text,
  adset_id text,
  ad_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ad_sources_firm on public.ad_sources(law_firm_id, active);
create index if not exists idx_ad_sources_form on public.ad_sources(meta_form_id) where meta_form_id is not null;
create index if not exists idx_ad_sources_firm_sheet_form on public.ad_sources(law_firm_id,sheet_integration_id,meta_form_id) where meta_form_id is not null;
create index if not exists idx_ad_sources_firm_sheet_ad on public.ad_sources(law_firm_id,sheet_integration_id,ad_id) where ad_id is not null;

create table if not exists public.meta_event_logs (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  lead_id text,
  ad_source_id uuid references public.ad_sources(id) on delete set null,
  meta_account_id uuid references public.firm_meta_accounts(id) on delete set null,
  event_name text not null,
  event_id text,
  status text not null check(status in ('pending','success','failed')),
  response_code integer,
  error_message text,
  requested_at timestamptz not null default now(),
  responded_at timestamptz
);
create index if not exists idx_meta_event_logs_firm on public.meta_event_logs(law_firm_id, requested_at desc);

create table if not exists public.firm_runtime_state (
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(law_firm_id, key)
);

alter table public.app_leads
  add column if not exists ad_source_id uuid references public.ad_sources(id) on delete set null,
  add column if not exists meta_account_id uuid references public.firm_meta_accounts(id) on delete set null,
  add column if not exists meta_lead_id text;
create index if not exists idx_app_leads_source on public.app_leads(law_firm_id, ad_source_id);
create index if not exists idx_app_leads_meta_account on public.app_leads(law_firm_id, meta_account_id);

-- 5) Atomic invite acceptance --------------------------------------------------
create or replace function public.accept_firm_invite(
  p_code_hash text,
  p_user_id uuid,
  p_display_name text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.firm_invites%rowtype;
  firm_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;

  select * into inv
  from public.firm_invites
  where code_hash = p_code_hash
  for update;

  if inv.id is null then raise exception '초대코드가 올바르지 않습니다.'; end if;
  if inv.revoked_at is not null then raise exception '취소된 초대코드입니다.'; end if;
  if inv.used_at is not null then raise exception '이미 사용된 초대코드입니다.'; end if;
  if inv.expires_at <= now() then raise exception '초대코드 유효기간이 만료되었습니다.'; end if;
  if not exists(select 1 from public.law_firms f where f.id = inv.law_firm_id and f.status = 'active') then
    raise exception '현재 이용이 중지된 로펌입니다.';
  end if;

  update public.profiles
     set law_firm_id = inv.law_firm_id,
         platform_role = inv.role,
         role = case when inv.role = 'firm_admin' then 'admin' else 'staff' end,
         display_name = nullif(trim(p_display_name), ''),
         staff_name = nullif(trim(p_display_name), ''),
         email = nullif(trim(lower(p_email)), ''),
         is_active = true,
         is_work_staff = true,
         auto_assign_leads = false,
         permissions = case when inv.role = 'firm_admin' then '{}'::jsonb else '{
           "dashboard.view":true,"dashboard.finance":true,"dashboard.installment_calendar":true,"dashboard.schedule_calendar":true,"dashboard.statistics":true,
           "db.view":true,"db.view_finance":true,"db.create":true,"db.edit_basic":true,"db.view_consultation":true,"db.edit_consultation":true,"db.change_stage":true,"db.manage_reservation":true,"db.convert":true,
           "cases.view":true,"cases.view_finance":true,"cases.create":true,"cases.manage_installments":true,"cases.econtract":true,"cases.send_docs":true,"living.view":true
         }'::jsonb end,
         updated_at = now()
   where id = p_user_id;

  update public.firm_invites
     set used_at = now(), used_by = p_user_id
   where id = inv.id;

  select name into firm_name from public.law_firms where id = inv.law_firm_id;
  return jsonb_build_object('ok', true, 'lawFirmId', inv.law_firm_id, 'firmName', firm_name, 'role', inv.role);
end;
$$;
revoke all on function public.accept_firm_invite(text,uuid,text,text) from public;
grant execute on function public.accept_firm_invite(text,uuid,text,text) to service_role;

-- 6) Tenant-aware Google Sheet import -----------------------------------------
create or replace function public.import_tenant_google_sheet_lead(
  p_law_firm_id uuid,
  p_external_key text,
  p_lead_id text,
  p_lead_data jsonb,
  p_sheet_name text,
  p_row_number integer,
  p_ad_source_id uuid default null,
  p_meta_account_id uuid default null,
  p_meta_lead_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_lead_id text;
  last_profile_id uuid;
  last_rn integer;
  target_profile_id uuid;
  target_staff_name text;
  final_data jsonb;
  change_id text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  if p_law_firm_id is null then raise exception 'law_firm_id is required'; end if;
  if not exists(select 1 from public.law_firms f where f.id = p_law_firm_id and f.status = 'active') then raise exception 'inactive law firm'; end if;
  if coalesce(trim(p_external_key), '') = '' then raise exception 'external_key is required'; end if;
  if coalesce(trim(p_lead_id), '') = '' then raise exception 'lead_id is required'; end if;
  if coalesce(trim(p_lead_data ->> 'name'), '') = '' or coalesce(trim(p_lead_data ->> 'phone'), '') = '' then raise exception 'name and phone are required'; end if;

  select lead_id into existing_lead_id
  from public.app_lead_imports
  where law_firm_id = p_law_firm_id and external_key = p_external_key;
  if existing_lead_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'leadId', existing_lead_id);
  end if;

  perform pg_advisory_xact_lock(hashtext('lawpower_firm_rr_' || p_law_firm_id::text));

  select lead_id into existing_lead_id
  from public.app_lead_imports
  where law_firm_id = p_law_firm_id and external_key = p_external_key;
  if existing_lead_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'leadId', existing_lead_id);
  end if;

  select case when jsonb_typeof(value -> 'lastProfileId') = 'string' and coalesce(value ->> 'lastProfileId','') <> ''
              then (value ->> 'lastProfileId')::uuid else null end
    into last_profile_id
  from public.firm_runtime_state
  where law_firm_id = p_law_firm_id and key = 'lead_round_robin'
  for update;

  with eligible as (
    select p.id,
           coalesce(nullif(p.staff_name,''), nullif(p.display_name,''), p.email) staff_name,
           row_number() over(order by p.lead_assignment_order, p.created_at, p.id) rn
    from public.profiles p
    where p.law_firm_id = p_law_firm_id
      and p.is_active = true and p.is_work_staff = true and p.auto_assign_leads = true
      and p.platform_role in ('firm_admin','staff')
  )
  select e.rn into last_rn from eligible e where e.id = last_profile_id;

  with eligible as (
    select p.id,
           coalesce(nullif(p.staff_name,''), nullif(p.display_name,''), p.email) staff_name,
           row_number() over(order by p.lead_assignment_order, p.created_at, p.id) rn
    from public.profiles p
    where p.law_firm_id = p_law_firm_id
      and p.is_active = true and p.is_work_staff = true and p.auto_assign_leads = true
      and p.platform_role in ('firm_admin','staff')
  )
  select e.id, e.staff_name into target_profile_id, target_staff_name
  from eligible e
  order by case when last_rn is not null and e.rn > last_rn then 0 else 1 end, e.rn
  limit 1;

  -- If a newly registered firm has not configured auto-assignment yet, assign to its active firm admin.
  if target_profile_id is null then
    select p.id, coalesce(nullif(p.staff_name,''), nullif(p.display_name,''), p.email)
      into target_profile_id, target_staff_name
    from public.profiles p
    where p.law_firm_id = p_law_firm_id and p.is_active = true and p.platform_role = 'firm_admin'
    order by p.created_at, p.id limit 1;
  end if;

  if target_profile_id is null or coalesce(target_staff_name,'') = '' then
    raise exception '해당 로펌에 활성 관리자/자동배정 담당자가 없습니다.';
  end if;

  final_data := jsonb_set(p_lead_data, '{assignedStaff}', to_jsonb(target_staff_name), true);

  insert into public.app_leads(id, data, created_by, law_firm_id, ad_source_id, meta_account_id, meta_lead_id)
  values (p_lead_id, final_data, null, p_law_firm_id, p_ad_source_id, p_meta_account_id, nullif(trim(p_meta_lead_id),''));

  insert into public.app_lead_imports(external_key, lead_id, source, sheet_name, row_number, assigned_profile_id, assigned_staff, law_firm_id)
  values (p_external_key, p_lead_id, 'google_sheets', p_sheet_name, p_row_number, target_profile_id, target_staff_name, p_law_firm_id);

  insert into public.firm_runtime_state(law_firm_id,key,value)
  values (p_law_firm_id, 'lead_round_robin', jsonb_build_object('lastProfileId',target_profile_id::text,'lastStaffName',target_staff_name,'updatedAt',now()))
  on conflict(law_firm_id,key) do update set value = excluded.value, updated_at = now();

  change_id := 'CHG-' || gen_random_uuid()::text;
  insert into public.app_change_logs(id,data,created_by,law_firm_id)
  values (change_id,
    jsonb_build_object('id',change_id,'category','DB관리','action','등록','targetName',final_data ->> 'name',
      'detail','로펌별 구글시트 자동등록 · 담당자 자동배정: ' || target_staff_name,'staff','시스템','at',now()),
    null,p_law_firm_id);

  return jsonb_build_object('ok',true,'duplicate',false,'leadId',p_lead_id,'assignedProfileId',target_profile_id,'assignedStaff',target_staff_name);
end;
$$;
revoke all on function public.import_tenant_google_sheet_lead(uuid,text,text,jsonb,text,integer,uuid,uuid,text) from public;
grant execute on function public.import_tenant_google_sheet_lead(uuid,text,text,jsonb,text,integer,uuid,uuid,text) to service_role;

-- 7) RLS: firm users only their tenant; super admin can inspect all ------------
alter table public.law_firms enable row level security;
alter table public.firm_invites enable row level security;
alter table public.firm_meta_accounts enable row level security;
alter table public.firm_sheet_integrations enable row level security;
alter table public.ad_sources enable row level security;
alter table public.meta_event_logs enable row level security;
alter table public.firm_runtime_state enable row level security;

-- Profiles: same-firm directory only, plus super admin all.
drop policy if exists profiles_select_directory on public.profiles;
drop policy if exists profiles_select_tenant_directory on public.profiles;
create policy profiles_select_tenant_directory
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or (
    public.is_active_user()
    and law_firm_id is not null
    and law_firm_id = public.current_law_firm_id()
  )
);

-- Tenant isolation is a RESTRICTIVE guard so it is ANDed with the detailed
-- permission policies from 002~005. A permissive tenant policy here would
-- accidentally bypass db.view_all / cases.view_all / edit/delete permissions.
do $$
declare t text;
begin
  foreach t in array array[
    'app_leads','app_clients','app_cases','app_installments',
    'app_schedule_items','app_board_posts','app_change_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_active_users', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_users', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_guard', t);
    execute format($p$
      create policy %I on public.%I as restrictive for all to authenticated
      using (public.is_super_admin() or (public.is_active_user() and law_firm_id = public.current_law_firm_id()))
      with check (public.is_super_admin() or (public.is_active_user() and law_firm_id = public.current_law_firm_id()))
    $p$, t || '_tenant_guard', t);
  end loop;
end $$;

-- Lead import audit is tenant-local for firm admins and global for super admins.
drop policy if exists app_lead_imports_admin_select on public.app_lead_imports;
drop policy if exists app_lead_imports_tenant_select on public.app_lead_imports;
create policy app_lead_imports_tenant_select on public.app_lead_imports for select to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()));

drop policy if exists law_firms_read on public.law_firms;
create policy law_firms_read on public.law_firms for select to authenticated
using (public.is_super_admin() or id = public.current_law_firm_id());

-- Integration secrets are intentionally NOT exposed directly to browser clients.
-- Service-role APIs mediate all writes/reads. Only non-secret ad source metadata is browser-readable through APIs.

-- 8) Security trigger: firm suspension ----------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.law_firms f on f.id = p.law_firm_id
    where p.id = auth.uid()
      and p.is_active = true
      and (
        p.platform_role = 'super_admin'
        or (p.law_firm_id is not null and f.status = 'active')
      )
  );
$$;

-- Existing role='admin' helpers remain compatible, while tenant role is authoritative for platform separation.
create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    left join public.law_firms f on f.id = p.law_firm_id
    where p.id = auth.uid() and p.is_active = true
      and p.role = 'admin'
      and (p.platform_role = 'super_admin' or f.status = 'active')
  );
$$;

revoke all on function public.is_active_user() from public;
revoke all on function public.is_admin_user() from public;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin_user() to authenticated;

-- Realtime support for platform entities where useful.
do $$
declare t text;
begin
  foreach t in array array['law_firms','firm_invites','ad_sources','meta_event_logs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Tenant-safe staff rename helper used by /api/admin/users.
create or replace function public.rename_staff_assignments_for_firm(
  p_law_firm_id uuid,
  p_old_name text,
  p_new_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  if p_law_firm_id is null or coalesce(p_old_name,'')='' or coalesce(p_new_name,'')='' or p_old_name=p_new_name then return; end if;
  update public.app_leads set data=jsonb_set(data,'{assignedStaff}',to_jsonb(p_new_name),true)
   where law_firm_id=p_law_firm_id and data->>'assignedStaff'=p_old_name;
  update public.app_clients set data=jsonb_set(data,'{assignedStaff}',to_jsonb(p_new_name),true)
   where law_firm_id=p_law_firm_id and data->>'assignedStaff'=p_old_name;
  update public.app_cases set data=jsonb_set(data,'{assignedStaff}',to_jsonb(p_new_name),true)
   where law_firm_id=p_law_firm_id and data->>'assignedStaff'=p_old_name;
end;
$$;
revoke all on function public.rename_staff_assignments_for_firm(uuid,text,text) from public;
grant execute on function public.rename_staff_assignments_for_firm(uuid,text,text) to service_role;

-- Temporary compatibility policies while this one-shot migration is running.
-- They are replaced below after all three firm-facing settings are copied into firm_settings.
drop policy if exists app_settings_active_users on public.app_settings;
drop policy if exists app_settings_platform_read on public.app_settings;
drop policy if exists app_settings_maeil_write on public.app_settings;
drop policy if exists app_settings_maeil_update on public.app_settings;
create policy app_settings_platform_read
on public.app_settings for select to authenticated
using (
  public.is_super_admin()
  or key = 'min_living_cost'
  or exists(
    select 1 from public.law_firms f
    where f.id = public.current_law_firm_id() and f.is_legacy_default = true
  )
);
create policy app_settings_maeil_write
on public.app_settings for insert to authenticated
with check (
  public.is_super_admin()
  or exists(select 1 from public.law_firms f where f.id = public.current_law_firm_id() and f.is_legacy_default = true)
);
create policy app_settings_maeil_update
on public.app_settings for update to authenticated
using (
  public.is_super_admin()
  or exists(select 1 from public.law_firms f where f.id = public.current_law_firm_id() and f.is_legacy_default = true)
)
with check (
  public.is_super_admin()
  or exists(select 1 from public.law_firms f where f.id = public.current_law_firm_id() and f.is_legacy_default = true)
);

-- 9) v28.2 hardening: per-firm settings, strict lineage, duplicate controls -----
alter table public.law_firms
  add column if not exists duplicate_window_days integer not null default 30
    check (duplicate_window_days between 1 and 3650);

alter table public.firm_meta_accounts
  add column if not exists access_token_ciphertext text,
  add column if not exists test_event_code text,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_error_message text;

create table if not exists public.firm_settings (
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(law_firm_id, key)
);

-- Existing Maeil firm settings are copied once, including the current minimum-living-cost table.
do $$
declare maeil_id uuid;
begin
  select id into maeil_id from public.law_firms where is_legacy_default = true limit 1;
  if maeil_id is not null then
    insert into public.firm_settings(law_firm_id,key,value)
    select maeil_id,key,value from public.app_settings where key in ('settlement_rates','case_documents','min_living_cost')
    on conflict(law_firm_id,key) do nothing;
  end if;
end $$;

insert into public.firm_settings(law_firm_id,key,value)
select id,'settlement_rates','{}'::jsonb from public.law_firms
on conflict(law_firm_id,key) do nothing;
insert into public.firm_settings(law_firm_id,key,value)
select id,'case_documents','{}'::jsonb from public.law_firms
on conflict(law_firm_id,key) do nothing;
insert into public.firm_settings(law_firm_id,key,value)
select id,'min_living_cost',
       '{"sizes":{"1":1538543,"1.5":2029059,"2":2519575,"2.5":2867498,"3":3215422,"4":3896843},"extraPerPerson":0}'::jsonb
from public.law_firms
on conflict(law_firm_id,key) do nothing;

create table if not exists public.integration_ingest_errors (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid references public.law_firms(id) on delete cascade,
  source_key text,
  sheet_id text,
  sheet_name text,
  form_id text,
  external_key text,
  row_number integer,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_integration_ingest_errors_firm on public.integration_ingest_errors(law_firm_id, created_at desc);

alter table public.app_lead_imports
  add column if not exists classification text not null default 'new'
    check (classification in ('new','reentry','duplicate_external','duplicate_meta','duplicate_phone')),
  add column if not exists matched_lead_id text references public.app_leads(id) on delete set null,
  add column if not exists duplicate_reason text,
  add column if not exists meta_lead_id text;

alter table public.app_leads
  add column if not exists phone_normalized text;

update public.app_leads
set phone_normalized = regexp_replace(coalesce(data->>'phone',''), '[^0-9]', '', 'g')
where phone_normalized is null;

create index if not exists idx_app_leads_firm_phone on public.app_leads(law_firm_id, phone_normalized, created_at desc);
create unique index if not exists uq_app_leads_firm_meta_lead
  on public.app_leads(law_firm_id, meta_lead_id)
  where meta_lead_id is not null and length(trim(meta_lead_id)) > 0;

create or replace function public.sync_lead_search_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.phone_normalized := regexp_replace(coalesce(new.data->>'phone',''), '[^0-9]', '', 'g');
  return new;
end;
$$;
drop trigger if exists trg_app_leads_search_columns on public.app_leads;
create trigger trg_app_leads_search_columns
before insert or update of data on public.app_leads
for each row execute function public.sync_lead_search_columns();

-- Tenant references on ad_sources must never cross firms even when service_role APIs are used.
create or replace function public.enforce_ad_source_tenant_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sheet_integration_id is not null and not exists(
    select 1 from public.firm_sheet_integrations s where s.id=new.sheet_integration_id and s.law_firm_id=new.law_firm_id
  ) then raise exception 'Google Sheet integration belongs to another law firm'; end if;
  if new.meta_account_id is not null and not exists(
    select 1 from public.firm_meta_accounts m where m.id=new.meta_account_id and m.law_firm_id=new.law_firm_id
  ) then raise exception 'Meta account belongs to another law firm'; end if;
  return new;
end;
$$;
drop trigger if exists trg_ad_sources_tenant_consistency on public.ad_sources;
create trigger trg_ad_sources_tenant_consistency
before insert or update on public.ad_sources
for each row execute function public.enforce_ad_source_tenant_consistency();

-- 10) Meta feedback queue ------------------------------------------------------
create table if not exists public.firm_meta_event_rules (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  trigger_type text not null check(trigger_type in ('detail_stage','status')),
  trigger_value text not null,
  event_name text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(law_firm_id,trigger_type,trigger_value,event_name)
);

create table if not exists public.meta_event_queue (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  lead_id text not null references public.app_leads(id) on delete cascade,
  ad_source_id uuid references public.ad_sources(id) on delete set null,
  meta_account_id uuid not null references public.firm_meta_accounts(id) on delete restrict,
  event_name text not null,
  event_id text not null unique,
  status text not null default 'pending' check(status in ('pending','processing','success','failed','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meta_event_queue_due on public.meta_event_queue(status,next_attempt_at,created_at);
create index if not exists idx_meta_event_queue_firm on public.meta_event_queue(law_firm_id,created_at desc);


-- Every lineage reference must belong to the same tenant, even when a service-role API writes it.
create or replace function public.enforce_lead_lineage_tenant_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ad_source_id is not null and not exists(
    select 1 from public.ad_sources s where s.id=new.ad_source_id and s.law_firm_id=new.law_firm_id
  ) then raise exception 'Lead ad source belongs to another law firm'; end if;
  if new.meta_account_id is not null and not exists(
    select 1 from public.firm_meta_accounts m where m.id=new.meta_account_id and m.law_firm_id=new.law_firm_id
  ) then raise exception 'Lead Meta account belongs to another law firm'; end if;
  if new.ad_source_id is not null and exists(
    select 1 from public.ad_sources s
    where s.id=new.ad_source_id and s.meta_account_id is not null
      and s.meta_account_id is distinct from new.meta_account_id
  ) then raise exception 'Lead Meta account does not match its ad source'; end if;
  return new;
end;
$$;
drop trigger if exists trg_app_leads_lineage_tenant on public.app_leads;
create trigger trg_app_leads_lineage_tenant
before insert or update of law_firm_id,ad_source_id,meta_account_id on public.app_leads
for each row execute function public.enforce_lead_lineage_tenant_consistency();

create or replace function public.enforce_meta_queue_tenant_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists(select 1 from public.app_leads l where l.id=new.lead_id and l.law_firm_id=new.law_firm_id)
    then raise exception 'Meta queue lead belongs to another law firm'; end if;
  if not exists(select 1 from public.firm_meta_accounts m where m.id=new.meta_account_id and m.law_firm_id=new.law_firm_id)
    then raise exception 'Meta queue account belongs to another law firm'; end if;
  if new.ad_source_id is not null and not exists(select 1 from public.ad_sources s where s.id=new.ad_source_id and s.law_firm_id=new.law_firm_id)
    then raise exception 'Meta queue source belongs to another law firm'; end if;
  if not exists(
    select 1 from public.app_leads l
    where l.id=new.lead_id and l.law_firm_id=new.law_firm_id
      and l.meta_account_id=new.meta_account_id
      and l.ad_source_id is not distinct from new.ad_source_id
  ) then raise exception 'Meta queue lineage does not match the original lead'; end if;
  return new;
end;
$$;
drop trigger if exists trg_meta_event_queue_tenant on public.meta_event_queue;
create trigger trg_meta_event_queue_tenant
before insert or update of law_firm_id,lead_id,ad_source_id,meta_account_id on public.meta_event_queue
for each row execute function public.enforce_meta_queue_tenant_consistency();

-- Default rules are intentionally disabled. Enable only after each firm's event mapping is confirmed.
insert into public.firm_meta_event_rules(law_firm_id,trigger_type,trigger_value,event_name,enabled)
select id,'detail_stage','예약','Schedule',false from public.law_firms
on conflict do nothing;
insert into public.firm_meta_event_rules(law_firm_id,trigger_type,trigger_value,event_name,enabled)
select id,'detail_stage','상담','Contact',false from public.law_firms
on conflict do nothing;
insert into public.firm_meta_event_rules(law_firm_id,trigger_type,trigger_value,event_name,enabled)
select id,'status','수임전환','CompleteRegistration',false from public.law_firms
on conflict do nothing;

create or replace function public.initialize_firm_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.firm_settings(law_firm_id,key,value) values
    (new.id,'settlement_rates','{}'::jsonb),
    (new.id,'case_documents','{}'::jsonb),
    (new.id,'min_living_cost','{"sizes":{"1":1538543,"1.5":2029059,"2":2519575,"2.5":2867498,"3":3215422,"4":3896843},"extraPerPerson":0}'::jsonb)
  on conflict do nothing;
  insert into public.firm_meta_event_rules(law_firm_id,trigger_type,trigger_value,event_name,enabled) values
    (new.id,'detail_stage','예약','Schedule',false),
    (new.id,'detail_stage','상담','Contact',false),
    (new.id,'status','수임전환','CompleteRegistration',false)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists trg_law_firms_defaults on public.law_firms;
create trigger trg_law_firms_defaults
after insert on public.law_firms
for each row execute function public.initialize_firm_defaults();

create or replace function public.enqueue_meta_events_for_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if new.meta_account_id is null or new.law_firm_id is null then return new; end if;

  if old.data->>'detailStage' is distinct from new.data->>'detailStage' then
    for r in select id,event_name from public.firm_meta_event_rules
      where law_firm_id=new.law_firm_id and enabled=true and trigger_type='detail_stage' and trigger_value=coalesce(new.data->>'detailStage','')
    loop
      insert into public.meta_event_queue(id,law_firm_id,lead_id,ad_source_id,meta_account_id,event_name,event_id)
      values(gen_random_uuid(),new.law_firm_id,new.id,new.ad_source_id,new.meta_account_id,r.event_name,
             'LP-'||replace(gen_random_uuid()::text,'-',''));
    end loop;
  end if;

  if old.data->>'status' is distinct from new.data->>'status' then
    for r in select id,event_name from public.firm_meta_event_rules
      where law_firm_id=new.law_firm_id and enabled=true and trigger_type='status' and trigger_value=coalesce(new.data->>'status','')
    loop
      insert into public.meta_event_queue(id,law_firm_id,lead_id,ad_source_id,meta_account_id,event_name,event_id)
      values(gen_random_uuid(),new.law_firm_id,new.id,new.ad_source_id,new.meta_account_id,r.event_name,
             'LP-'||replace(gen_random_uuid()::text,'-',''));
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_meta_events_for_lead() from public;

drop trigger if exists trg_app_leads_meta_queue on public.app_leads;
create trigger trg_app_leads_meta_queue
after update of data on public.app_leads
for each row execute function public.enqueue_meta_events_for_lead();

create or replace function public.claim_meta_event_queue(p_law_firm_id uuid default null, p_limit integer default 20)
returns setof public.meta_event_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;

  -- Recover jobs left in processing if a serverless invocation died after claiming them.
  update public.meta_event_queue
     set status='failed',
         next_attempt_at=now(),
         last_error=coalesce(last_error,'') || case when coalesce(last_error,'')='' then '' else ' · ' end || 'stale processing lock recovered',
         updated_at=now()
   where status='processing'
     and updated_at < now() - interval '15 minutes'
     and (p_law_firm_id is null or law_firm_id=p_law_firm_id);

  return query
  with picked as (
    select q.id from public.meta_event_queue q
    where q.status in ('pending','failed')
      and q.next_attempt_at <= now()
      and (p_law_firm_id is null or q.law_firm_id=p_law_firm_id)
      and q.attempts < 8
    order by q.next_attempt_at,q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),50))
  )
  update public.meta_event_queue q
     set status='processing', attempts=q.attempts+1, updated_at=now()
    from picked p
   where q.id=p.id
  returning q.*;
end;
$$;
revoke all on function public.claim_meta_event_queue(uuid,integer) from public;
grant execute on function public.claim_meta_event_queue(uuid,integer) to service_role;

-- 11) Replace import RPC with firm-local duplicate/re-entry classification -----
create or replace function public.import_tenant_google_sheet_lead(
  p_law_firm_id uuid,
  p_external_key text,
  p_lead_id text,
  p_lead_data jsonb,
  p_sheet_name text,
  p_row_number integer,
  p_ad_source_id uuid default null,
  p_meta_account_id uuid default null,
  p_meta_lead_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_lead_id text;
  existing_classification text;
  last_profile_id uuid;
  last_rn integer;
  target_profile_id uuid;
  target_staff_name text;
  final_data jsonb;
  change_id text;
  normalized_phone text;
  matched_lead_id text;
  matched_created_at timestamptz;
  classification text := 'new';
  duplicate_reason text;
  duplicate_days integer := 30;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  if p_law_firm_id is null then raise exception 'law_firm_id is required'; end if;
  if not exists(select 1 from public.law_firms f where f.id=p_law_firm_id and f.status='active') then raise exception 'inactive law firm'; end if;
  if coalesce(trim(p_external_key),'')='' then raise exception 'external_key is required'; end if;
  if coalesce(trim(p_lead_id),'')='' then raise exception 'lead_id is required'; end if;
  if coalesce(trim(p_lead_data->>'name'),'')='' or coalesce(trim(p_lead_data->>'phone'),'')='' then raise exception 'name and phone are required'; end if;

  select duplicate_window_days into duplicate_days from public.law_firms where id=p_law_firm_id;
  normalized_phone := regexp_replace(coalesce(p_lead_data->>'phone',''), '[^0-9]', '', 'g');

  perform pg_advisory_xact_lock(hashtext('lawpower_firm_import_'||p_law_firm_id::text));

  select lead_id,classification into existing_lead_id,existing_classification
    from public.app_lead_imports
   where law_firm_id=p_law_firm_id and external_key=p_external_key;
  if existing_lead_id is not null then
    return jsonb_build_object('ok',true,'duplicate',true,'classification','duplicate_external','duplicateReason','동일 시트행 재전송','leadId',existing_lead_id);
  end if;

  if coalesce(trim(p_meta_lead_id),'')<>'' then
    select id into matched_lead_id from public.app_leads
     where law_firm_id=p_law_firm_id and meta_lead_id=trim(p_meta_lead_id)
     order by created_at desc limit 1;
    if matched_lead_id is not null then
      classification := 'duplicate_meta'; duplicate_reason := '동일 Meta Lead ID';
    end if;
  end if;

  if matched_lead_id is null and normalized_phone<>'' then
    select id,created_at into matched_lead_id,matched_created_at from public.app_leads
     where law_firm_id=p_law_firm_id and phone_normalized=normalized_phone
     order by created_at desc limit 1;
    if matched_lead_id is not null then
      if matched_created_at >= now() - make_interval(days=>duplicate_days) then
        classification := 'duplicate_phone'; duplicate_reason := duplicate_days||'일 이내 동일 전화번호';
      else
        classification := 'reentry';
        matched_lead_id := null;
      end if;
    end if;
  end if;

  if classification in ('duplicate_meta','duplicate_phone') then
    insert into public.app_lead_imports(external_key,lead_id,source,sheet_name,row_number,law_firm_id,classification,matched_lead_id,duplicate_reason,meta_lead_id)
    values(p_external_key,matched_lead_id,'google_sheets',p_sheet_name,p_row_number,p_law_firm_id,classification,matched_lead_id,duplicate_reason,nullif(trim(p_meta_lead_id),''));
    return jsonb_build_object('ok',true,'duplicate',true,'classification',classification,'duplicateReason',duplicate_reason,'leadId',matched_lead_id);
  end if;

  select case when jsonb_typeof(value->'lastProfileId')='string' and coalesce(value->>'lastProfileId','')<>'' then (value->>'lastProfileId')::uuid else null end
    into last_profile_id from public.firm_runtime_state where law_firm_id=p_law_firm_id and key='lead_round_robin' for update;

  with eligible as (
    select p.id,coalesce(nullif(p.staff_name,''),nullif(p.display_name,''),p.email) staff_name,
           row_number() over(order by p.lead_assignment_order,p.created_at,p.id) rn
    from public.profiles p
    where p.law_firm_id=p_law_firm_id and p.is_active=true and p.is_work_staff=true and p.auto_assign_leads=true and p.platform_role in ('firm_admin','staff')
  ) select e.rn into last_rn from eligible e where e.id=last_profile_id;

  with eligible as (
    select p.id,coalesce(nullif(p.staff_name,''),nullif(p.display_name,''),p.email) staff_name,
           row_number() over(order by p.lead_assignment_order,p.created_at,p.id) rn
    from public.profiles p
    where p.law_firm_id=p_law_firm_id and p.is_active=true and p.is_work_staff=true and p.auto_assign_leads=true and p.platform_role in ('firm_admin','staff')
  ) select e.id,e.staff_name into target_profile_id,target_staff_name from eligible e
     order by case when last_rn is not null and e.rn>last_rn then 0 else 1 end,e.rn limit 1;

  if target_profile_id is null then
    select p.id,coalesce(nullif(p.staff_name,''),nullif(p.display_name,''),p.email)
      into target_profile_id,target_staff_name from public.profiles p
     where p.law_firm_id=p_law_firm_id and p.is_active=true and p.platform_role='firm_admin'
     order by p.created_at,p.id limit 1;
  end if;
  if target_profile_id is null or coalesce(target_staff_name,'')='' then raise exception '해당 로펌에 활성 관리자/자동배정 담당자가 없습니다.'; end if;

  final_data := jsonb_set(p_lead_data,'{assignedStaff}',to_jsonb(target_staff_name),true);
  final_data := jsonb_set(final_data,'{_platform}',coalesce(final_data->'_platform','{}'::jsonb)||jsonb_build_object('leadClassification',classification),true);

  insert into public.app_leads(id,data,created_by,law_firm_id,ad_source_id,meta_account_id,meta_lead_id,phone_normalized)
  values(p_lead_id,final_data,null,p_law_firm_id,p_ad_source_id,p_meta_account_id,nullif(trim(p_meta_lead_id),''),normalized_phone);

  insert into public.app_lead_imports(external_key,lead_id,source,sheet_name,row_number,assigned_profile_id,assigned_staff,law_firm_id,classification,meta_lead_id)
  values(p_external_key,p_lead_id,'google_sheets',p_sheet_name,p_row_number,target_profile_id,target_staff_name,p_law_firm_id,classification,nullif(trim(p_meta_lead_id),''));

  insert into public.firm_runtime_state(law_firm_id,key,value)
  values(p_law_firm_id,'lead_round_robin',jsonb_build_object('lastProfileId',target_profile_id::text,'lastStaffName',target_staff_name,'updatedAt',now()))
  on conflict(law_firm_id,key) do update set value=excluded.value,updated_at=now();

  change_id := 'CHG-'||gen_random_uuid()::text;
  insert into public.app_change_logs(id,data,created_by,law_firm_id)
  values(change_id,jsonb_build_object('id',change_id,'category','DB관리','action','등록','targetName',final_data->>'name',
    'detail',case when classification='reentry' then '구글시트 재유입 등록' else '로펌별 구글시트 자동등록' end||' · 담당자 자동배정: '||target_staff_name,
    'staff','시스템','at',now()),null,p_law_firm_id);

  return jsonb_build_object('ok',true,'duplicate',false,'classification',classification,'leadId',p_lead_id,'assignedProfileId',target_profile_id,'assignedStaff',target_staff_name);
end;
$$;

-- 12) RLS hardening ------------------------------------------------------------
alter table public.firm_settings enable row level security;
alter table public.integration_ingest_errors enable row level security;
alter table public.firm_meta_event_rules enable row level security;
alter table public.meta_event_queue enable row level security;

drop policy if exists firm_settings_tenant on public.firm_settings;
drop policy if exists firm_settings_read on public.firm_settings;
drop policy if exists firm_settings_insert on public.firm_settings;
drop policy if exists firm_settings_update on public.firm_settings;
create policy firm_settings_read on public.firm_settings for select to authenticated
using (
  public.is_active_user()
  and law_firm_id=public.current_law_firm_id()
  and (
    public.is_admin_user()
    or (key='settlement_rates' and public.has_any_permission(array['settlements.view','settlement_settings.view']))
    or (key='min_living_cost' and public.has_any_permission(array['living.view','db.view_consultation','db.edit_consultation']))
    or (key='case_documents' and public.has_permission('cases.send_docs'))
  )
);
create policy firm_settings_insert on public.firm_settings for insert to authenticated
with check (
  public.is_active_user()
  and law_firm_id=public.current_law_firm_id()
  and (
    (key='settlement_rates' and public.has_permission('settlement_settings.edit'))
    or (key='case_documents' and public.has_permission('cases.send_docs'))
    or (key='min_living_cost' and public.has_permission('living.edit'))
  )
);
create policy firm_settings_update on public.firm_settings for update to authenticated
using (
  public.is_active_user()
  and law_firm_id=public.current_law_firm_id()
  and (
    (key='settlement_rates' and public.has_permission('settlement_settings.edit'))
    or (key='case_documents' and public.has_permission('cases.send_docs'))
    or (key='min_living_cost' and public.has_permission('living.edit'))
  )
)
with check (
  public.is_active_user()
  and law_firm_id=public.current_law_firm_id()
  and (
    (key='settlement_rates' and public.has_permission('settlement_settings.edit'))
    or (key='case_documents' and public.has_permission('cases.send_docs'))
    or (key='min_living_cost' and public.has_permission('living.edit'))
  )
);

create or replace function public.enforce_firm_setting_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if new.law_firm_id is null then new.law_firm_id := public.current_law_firm_id(); end if;
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_firm_settings_owner on public.firm_settings;
create trigger trg_firm_settings_owner
before insert or update on public.firm_settings
for each row execute function public.enforce_firm_setting_owner();

drop policy if exists ingest_errors_read on public.integration_ingest_errors;
create policy ingest_errors_read on public.integration_ingest_errors for select to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id=public.current_law_firm_id()));

drop policy if exists meta_rules_read on public.firm_meta_event_rules;
create policy meta_rules_read on public.firm_meta_event_rules for select to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id=public.current_law_firm_id()));

drop policy if exists meta_queue_read on public.meta_event_queue;
create policy meta_queue_read on public.meta_event_queue for select to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id=public.current_law_firm_id()));

-- app_settings is legacy/global storage only after v28.2.
-- All firm-facing settings (settlement/document/minimum living cost) live in firm_settings.
drop policy if exists app_settings_platform_read on public.app_settings;
drop policy if exists app_settings_maeil_write on public.app_settings;
drop policy if exists app_settings_maeil_update on public.app_settings;
drop policy if exists app_settings_global_read on public.app_settings;
drop policy if exists app_settings_global_write on public.app_settings;
drop policy if exists app_settings_global_update on public.app_settings;
drop policy if exists app_settings_active_users on public.app_settings;
drop policy if exists app_settings_select_permissions on public.app_settings;
drop policy if exists app_settings_insert_permissions on public.app_settings;
drop policy if exists app_settings_update_permissions on public.app_settings;
drop policy if exists app_settings_super_admin_only on public.app_settings;
create policy app_settings_super_admin_only on public.app_settings for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

-- After backfill, operational rows must always belong to a law firm.
do $$
declare t text;
begin
  foreach t in array array['app_leads','app_clients','app_cases','app_installments','app_schedule_items','app_board_posts','app_change_logs'] loop
    if not exists(select 1 from pg_attribute where attrelid=('public.'||t)::regclass and attname='law_firm_id' and attnotnull) then
      execute format('alter table public.%I alter column law_firm_id set not null',t);
    end if;
  end loop;
  if to_regclass('public.app_lead_imports') is not null then
    alter table public.app_lead_imports alter column law_firm_id set not null;
  end if;
end $$;

-- Keep existing fine-grained permission helper compatible with firm suspension.
create or replace function public.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_user() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or coalesce((p.permissions ->> permission_key)::boolean, false) = true)
  );
$$;

-- Cross-entity tenant consistency for JSON-linked operational rows.
-- This prevents a malicious/manual request from creating an own-firm child row
-- that points at a case/client belonging to another firm.
create or replace function public.enforce_operational_link_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_id text;
begin
  if new.law_firm_id is null then raise exception 'law_firm_id is required'; end if;

  if tg_table_name = 'app_cases' then
    ref_id := nullif(new.data ->> 'clientId','');
    if ref_id is not null and not exists(select 1 from public.app_clients c where c.id=ref_id and c.law_firm_id=new.law_firm_id) then
      raise exception 'case client belongs to a different law firm';
    end if;
  elsif tg_table_name = 'app_installments' then
    ref_id := nullif(new.data ->> 'caseId','');
    if ref_id is not null and not exists(select 1 from public.app_cases c where c.id=ref_id and c.law_firm_id=new.law_firm_id) then
      raise exception 'installment case belongs to a different law firm';
    end if;
  elsif tg_table_name = 'app_schedule_items' then
    ref_id := nullif(new.data ->> 'caseId','');
    if ref_id is not null and not exists(select 1 from public.app_cases c where c.id=ref_id and c.law_firm_id=new.law_firm_id) then
      raise exception 'schedule case belongs to a different law firm';
    end if;
    ref_id := nullif(new.data ->> 'clientId','');
    if ref_id is not null and not exists(select 1 from public.app_clients c where c.id=ref_id and c.law_firm_id=new.law_firm_id) then
      raise exception 'schedule client belongs to a different law firm';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['app_cases','app_installments','app_schedule_items'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_'||t||'_tenant_links', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.enforce_operational_link_tenant()', 'trg_'||t||'_tenant_links', t);
  end loop;
end $$;

-- Realtime for tenant settings / integration status views.
do $$
declare t text;
begin
  foreach t in array array['firm_settings','integration_ingest_errors','firm_meta_event_rules','meta_event_queue'] loop
    begin execute format('alter publication supabase_realtime add table public.%I',t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- Disable legacy service-role helpers that are not tenant-aware. All v28 code uses the firm-scoped replacements above.
revoke execute on function public.import_google_sheet_lead(text,text,jsonb,text,integer) from service_role;
revoke execute on function public.rename_staff_assignments(text,text) from service_role;

-- 13) v28.3 operational hardening: audit, public rate limits, supply ledger ------
alter table public.law_firms
  add column if not exists billing_type text not null default 'per_lead'
    check (billing_type in ('per_lead','monthly','manual')),
  add column if not exists lead_unit_price bigint not null default 0
    check (lead_unit_price >= 0);

create table if not exists public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_role text,
  law_firm_id uuid references public.law_firms(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_platform_audit_logs_created on public.platform_audit_logs(created_at desc);
create index if not exists idx_platform_audit_logs_firm on public.platform_audit_logs(law_firm_id, created_at desc);

create table if not exists public.public_rate_limits (
  scope text not null,
  key_hash text not null,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(scope,key_hash)
);

create or replace function public.consume_public_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_window_started_at timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role only'; end if;
  if coalesce(trim(p_scope),'')='' or coalesce(trim(p_key_hash),'')='' then raise exception 'rate-limit key is required'; end if;
  if p_limit < 1 or p_window_seconds < 1 then raise exception 'invalid rate-limit config'; end if;

  insert into public.public_rate_limits(scope,key_hash,attempts,window_started_at,updated_at)
  values(p_scope,p_key_hash,1,now(),now())
  on conflict(scope,key_hash) do update
  set attempts = case
      when public.public_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now() then 1
      else public.public_rate_limits.attempts + 1
    end,
    window_started_at = case
      when public.public_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now() then now()
      else public.public_rate_limits.window_started_at
    end,
    updated_at = now()
  returning attempts, window_started_at into v_attempts, v_window_started_at;

  return v_attempts <= p_limit;
end;
$$;
revoke all on function public.consume_public_rate_limit(text,text,integer,integer) from public;
grant execute on function public.consume_public_rate_limit(text,text,integer,integer) to service_role;

create table if not exists public.lead_supply_ledger (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  external_key text not null,
  lead_id text references public.app_leads(id) on delete set null,
  classification text not null,
  billable boolean not null default false,
  billing_type text not null default 'per_lead',
  unit_price_snapshot bigint not null default 0,
  ad_source_id uuid references public.ad_sources(id) on delete set null,
  meta_account_id uuid references public.firm_meta_accounts(id) on delete set null,
  origin text not null default 'ingest' check(origin in ('ingest','backfill','manual')),
  supplied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(law_firm_id, external_key)
);
create index if not exists idx_lead_supply_ledger_firm_date on public.lead_supply_ledger(law_firm_id, supplied_at desc);
create index if not exists idx_lead_supply_ledger_billable on public.lead_supply_ledger(law_firm_id, billable, supplied_at desc);

create or replace function public.record_lead_supply_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_price bigint := 0;
  v_billing_type text := 'per_lead';
  v_ad_source_id uuid;
  v_meta_account_id uuid;
begin
  select f.lead_unit_price, f.billing_type
    into v_unit_price, v_billing_type
  from public.law_firms f where f.id = new.law_firm_id;

  if new.lead_id is not null then
    select l.ad_source_id, l.meta_account_id
      into v_ad_source_id, v_meta_account_id
    from public.app_leads l
    where l.id = new.lead_id and l.law_firm_id = new.law_firm_id;
  end if;

  insert into public.lead_supply_ledger(
    law_firm_id, external_key, lead_id, classification, billable,
    billing_type, unit_price_snapshot, ad_source_id, meta_account_id,
    origin, supplied_at
  ) values (
    new.law_firm_id,
    new.external_key,
    new.lead_id,
    new.classification,
    new.classification in ('new','reentry'),
    coalesce(v_billing_type,'per_lead'),
    coalesce(v_unit_price,0),
    v_ad_source_id,
    v_meta_account_id,
    'ingest',
    coalesce(new.imported_at, now())
  )
  on conflict(law_firm_id, external_key) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_app_lead_imports_supply_ledger on public.app_lead_imports;
create trigger trg_app_lead_imports_supply_ledger
after insert on public.app_lead_imports
for each row execute function public.record_lead_supply_ledger();

-- Historical imports are retained for reference but are deliberately non-billable.
insert into public.lead_supply_ledger(
  law_firm_id, external_key, lead_id, classification, billable,
  billing_type, unit_price_snapshot, ad_source_id, meta_account_id,
  origin, supplied_at
)
select i.law_firm_id, i.external_key, i.lead_id, i.classification, false,
       coalesce(f.billing_type,'per_lead'), 0, l.ad_source_id, l.meta_account_id,
       'backfill', i.imported_at
from public.app_lead_imports i
join public.law_firms f on f.id=i.law_firm_id
left join public.app_leads l on l.id=i.lead_id and l.law_firm_id=i.law_firm_id
on conflict(law_firm_id, external_key) do nothing;

alter table public.platform_audit_logs enable row level security;
alter table public.public_rate_limits enable row level security;
alter table public.lead_supply_ledger enable row level security;

drop policy if exists platform_audit_super_admin on public.platform_audit_logs;
create policy platform_audit_super_admin on public.platform_audit_logs for select to authenticated
using (public.is_super_admin());

drop policy if exists supply_ledger_read on public.lead_supply_ledger;
create policy supply_ledger_read on public.lead_supply_ledger for select to authenticated
using (
  public.is_super_admin()
  or (public.is_firm_admin() and law_firm_id=public.current_law_firm_id())
);

-- No authenticated RLS policy is intentionally created for public_rate_limits.
-- It is only touched through the service-role RPC above.

do $$
declare t text;
begin
  foreach t in array array['platform_audit_logs','lead_supply_ledger'] loop
    begin execute format('alter publication supabase_realtime add table public.%I',t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
