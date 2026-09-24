-- LawPower v27
-- Google Sheet(DB가공) 신규 DB 자동수집 + 실무담당자 라운드로빈 자동배정
-- 반드시 001_initial.sql, 002_staff_accounts_permissions.sql 적용 후 1회 실행하세요.

alter table public.profiles
  add column if not exists auto_assign_leads boolean not null default false,
  add column if not exists lead_assignment_order integer not null default 1000;

-- 현재 실무 기준: 강이삭 -> 박형원 순서로 자동배정.
-- 홍성원은 is_work_staff=false이므로 자동배정 대상에서 제외됩니다.
update public.profiles
set auto_assign_leads = true,
    lead_assignment_order = case
      when coalesce(nullif(staff_name, ''), display_name) = '강이삭' then 10
      when coalesce(nullif(staff_name, ''), display_name) = '박형원' then 20
      else lead_assignment_order
    end,
    updated_at = now()
where is_active = true and is_work_staff = true;

update public.profiles
set auto_assign_leads = false, updated_at = now()
where is_work_staff = false;

create table if not exists public.app_lead_imports (
  external_key text primary key,
  lead_id text not null references public.app_leads(id) on delete cascade,
  source text not null default 'google_sheets',
  sheet_name text,
  row_number integer,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  assigned_staff text,
  imported_at timestamptz not null default now()
);

create index if not exists idx_app_lead_imports_lead_id on public.app_lead_imports(lead_id);
create index if not exists idx_app_lead_imports_imported_at on public.app_lead_imports(imported_at desc);

alter table public.app_lead_imports enable row level security;
drop policy if exists app_lead_imports_admin_select on public.app_lead_imports;
create policy app_lead_imports_admin_select
on public.app_lead_imports for select to authenticated
using (public.is_admin_user());

insert into public.app_settings(key, value)
values ('lead_round_robin', '{"lastProfileId":null,"lastStaffName":null,"updatedAt":null}'::jsonb)
on conflict (key) do nothing;

-- Google Sheet에서 들어온 DB 1건을 중복 없이 저장하고,
-- 활성 + 실무담당 + 자동배정 참여 직원에게 순서대로 1건씩 배정합니다.
-- advisory lock + app_settings FOR UPDATE를 사용해 동시에 여러 DB가 들어와도 배정 순서가 꼬이지 않게 합니다.
create or replace function public.import_google_sheet_lead(
  p_external_key text,
  p_lead_id text,
  p_lead_data jsonb,
  p_sheet_name text,
  p_row_number integer
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
  if auth.role() <> 'service_role' then
    raise exception 'service_role only';
  end if;

  if coalesce(trim(p_external_key), '') = '' then
    raise exception 'external_key is required';
  end if;
  if coalesce(trim(p_lead_id), '') = '' then
    raise exception 'lead_id is required';
  end if;
  if coalesce(trim(p_lead_data ->> 'name'), '') = '' or coalesce(trim(p_lead_data ->> 'phone'), '') = '' then
    raise exception 'name and phone are required';
  end if;

  -- 동일 시트 행의 중복 호출 방지
  select lead_id into existing_lead_id
  from public.app_lead_imports
  where external_key = p_external_key;

  if existing_lead_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'leadId', existing_lead_id);
  end if;

  -- 자동배정 커서를 한 트랜잭션에서 순차 처리
  perform pg_advisory_xact_lock(hashtext('lawpower_google_sheet_lead_round_robin'));

  -- lock을 잡은 뒤 다시 중복 확인(동시 요청 대비)
  select lead_id into existing_lead_id
  from public.app_lead_imports
  where external_key = p_external_key;

  if existing_lead_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'leadId', existing_lead_id);
  end if;

  select case
           when jsonb_typeof(value -> 'lastProfileId') = 'string'
                and coalesce(value ->> 'lastProfileId', '') <> ''
             then (value ->> 'lastProfileId')::uuid
           else null
         end
    into last_profile_id
  from public.app_settings
  where key = 'lead_round_robin'
  for update;

  -- 현재 마지막 담당자가 아직 자동배정 대상이면 그 다음 순번을 찾습니다.
  with eligible as (
    select
      p.id,
      coalesce(nullif(p.staff_name, ''), nullif(p.display_name, ''), p.email) as staff_name,
      row_number() over(order by p.lead_assignment_order, p.created_at, p.id) as rn
    from public.profiles p
    where p.is_active = true
      and p.is_work_staff = true
      and p.auto_assign_leads = true
      and coalesce(nullif(p.staff_name, ''), nullif(p.display_name, ''), p.email) is not null
  )
  select e.rn into last_rn
  from eligible e
  where e.id = last_profile_id;

  with eligible as (
    select
      p.id,
      coalesce(nullif(p.staff_name, ''), nullif(p.display_name, ''), p.email) as staff_name,
      row_number() over(order by p.lead_assignment_order, p.created_at, p.id) as rn
    from public.profiles p
    where p.is_active = true
      and p.is_work_staff = true
      and p.auto_assign_leads = true
      and coalesce(nullif(p.staff_name, ''), nullif(p.display_name, ''), p.email) is not null
  )
  select e.id, e.staff_name
    into target_profile_id, target_staff_name
  from eligible e
  order by
    case when last_rn is not null and e.rn > last_rn then 0 else 1 end,
    e.rn
  limit 1;

  if target_profile_id is null or coalesce(target_staff_name, '') = '' then
    raise exception '자동배정 가능한 활성 실무담당자가 없습니다. 직원계정관리에서 자동배정 참여 직원을 설정해주세요.';
  end if;

  final_data := jsonb_set(p_lead_data, '{assignedStaff}', to_jsonb(target_staff_name), true);

  insert into public.app_leads(id, data, created_by)
  values (p_lead_id, final_data, null);

  insert into public.app_lead_imports(
    external_key, lead_id, source, sheet_name, row_number, assigned_profile_id, assigned_staff
  ) values (
    p_external_key, p_lead_id, 'google_sheets', p_sheet_name, p_row_number, target_profile_id, target_staff_name
  );

  insert into public.app_settings(key, value)
  values (
    'lead_round_robin',
    jsonb_build_object(
      'lastProfileId', target_profile_id::text,
      'lastStaffName', target_staff_name,
      'updatedAt', now()
    )
  )
  on conflict (key) do update
  set value = excluded.value,
      updated_by = null,
      updated_at = now();

  change_id := 'CHG-' || gen_random_uuid()::text;
  insert into public.app_change_logs(id, data, created_by)
  values (
    change_id,
    jsonb_build_object(
      'id', change_id,
      'category', 'DB관리',
      'action', '등록',
      'targetName', final_data ->> 'name',
      'detail', '구글시트 자동등록 · 담당자 자동배정: ' || target_staff_name,
      'staff', '시스템',
      'at', now()
    ),
    null
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'leadId', p_lead_id,
    'assignedProfileId', target_profile_id,
    'assignedStaff', target_staff_name
  );
end;
$$;

revoke all on function public.import_google_sheet_lead(text, text, jsonb, text, integer) from public;
grant execute on function public.import_google_sheet_lead(text, text, jsonb, text, integer) to service_role;
