-- LawPower v27.7
-- 신규 Google Sheet DB는 우선 박형원에게 전부 배정하고,
-- 박형원이 전체 DB를 조회/관리하며 실제 담당자를 다시 지정할 수 있도록 구성합니다.
-- 반드시 001~004 적용 후 1회 실행하세요.

-- 1) 자동유입 담당자는 박형원 1명만 사용합니다.
--    향후 운영자가 바꾸고 싶다면 직원계정관리에서 auto_assign_leads를 다른 1명에게 켜고
--    배정순서를 가장 낮게 지정하면 됩니다.
update public.profiles
set auto_assign_leads = false,
    updated_at = now()
where auto_assign_leads = true;

update public.profiles
set is_active = true,
    is_work_staff = true,
    auto_assign_leads = true,
    lead_assignment_order = 10,
    permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
      'db.view', true,
      'db.view_all', true,
      'db.view_finance', true,
      'db.create', true,
      'db.edit_basic', true,
      'db.view_consultation', true,
      'db.edit_consultation', true,
      'db.change_stage', true,
      'db.change_assignee', true,
      'db.manage_reservation', true,
      'db.convert', true
    ),
    updated_at = now()
where staff_name = '박형원' or display_name = '박형원';

-- 2) 현재 신규 DB 총괄 담당자 이름을 반환합니다.
--    수기등록 RLS에서도 같은 기준을 사용해 일반 직원이 DB를 등록해도 박형원에게 먼저 들어갈 수 있게 합니다.
create or replace function public.primary_db_intake_staff()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(p.staff_name, ''), nullif(p.display_name, ''), p.email)
  from public.profiles p
  where p.is_active = true
    and p.is_work_staff = true
    and p.auto_assign_leads = true
  order by p.lead_assignment_order, p.created_at, p.id
  limit 1;
$$;

revoke all on function public.primary_db_intake_staff() from public;
grant execute on function public.primary_db_intake_staff() to authenticated;
grant execute on function public.primary_db_intake_staff() to service_role;

-- 기존 직원이 수기로 DB를 추가할 때도 신규 DB 총괄 담당자에게 최초 배정할 수 있게 허용합니다.
drop policy if exists app_leads_insert_permissions on public.app_leads;
create policy app_leads_insert_permissions
on public.app_leads for insert to authenticated
with check (
  public.has_permission('db.create')
  and (
    public.has_permission('db.change_assignee')
    or data ->> 'assignedStaff' = public.current_staff_name()
    or data ->> 'assignedStaff' = public.primary_db_intake_staff()
  )
);

-- 3) Google Sheet 신규 DB 저장 함수:
--    라운드로빈 대신 '자동유입 담당' 중 배정순서가 가장 낮은 1명에게 항상 배정합니다.
--    위 설정 때문에 현재는 모든 신규 DB가 박형원에게 들어옵니다.
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
  if coalesce(trim(p_lead_data ->> 'name'), '') = ''
     or coalesce(trim(p_lead_data ->> 'phone'), '') = '' then
    raise exception 'name and phone are required';
  end if;

  -- 동일 시트 행의 중복 호출 방지
  select lead_id into existing_lead_id
  from public.app_lead_imports
  where external_key = p_external_key;

  if existing_lead_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'leadId', existing_lead_id);
  end if;

  -- 동시에 여러 행이 들어오더라도 중복 저장되지 않게 직렬화합니다.
  perform pg_advisory_xact_lock(hashtext('lawpower_google_sheet_lead_primary_owner'));

  select lead_id into existing_lead_id
  from public.app_lead_imports
  where external_key = p_external_key;

  if existing_lead_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'leadId', existing_lead_id);
  end if;

  -- 현재 운영방식: 자동유입 담당 중 배정순서가 가장 낮은 한 명이 신규 DB를 모두 받습니다.
  select
    p.id,
    coalesce(nullif(p.staff_name, ''), nullif(p.display_name, ''), p.email)
  into target_profile_id, target_staff_name
  from public.profiles p
  where p.is_active = true
    and p.is_work_staff = true
    and p.auto_assign_leads = true
    and coalesce(nullif(p.staff_name, ''), nullif(p.display_name, ''), p.email) is not null
  order by p.lead_assignment_order, p.created_at, p.id
  limit 1;

  if target_profile_id is null or coalesce(target_staff_name, '') = '' then
    raise exception '신규 DB 자동유입 담당자가 없습니다. 직원계정관리에서 박형원 계정의 신규 DB 자동유입 담당을 켜주세요.';
  end if;

  final_data := jsonb_set(p_lead_data, '{assignedStaff}', to_jsonb(target_staff_name), true);

  insert into public.app_leads(id, data, created_by)
  values (p_lead_id, final_data, null);

  insert into public.app_lead_imports(
    external_key, lead_id, source, sheet_name, row_number, assigned_profile_id, assigned_staff
  ) values (
    p_external_key, p_lead_id, 'google_sheets', p_sheet_name, p_row_number, target_profile_id, target_staff_name
  );

  change_id := 'CHG-' || gen_random_uuid()::text;
  insert into public.app_change_logs(id, data, created_by)
  values (
    change_id,
    jsonb_build_object(
      'id', change_id,
      'category', 'DB관리',
      'action', '등록',
      'targetName', final_data ->> 'name',
      'detail', '구글시트 자동등록 · 최초 담당자: ' || target_staff_name,
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
