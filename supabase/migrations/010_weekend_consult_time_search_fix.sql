-- LawPower v28.17
-- 상담가능시간 주말 피벗 정규화/과거 데이터 복구 + 자동배정 피벗 호환
--
-- 핵심:
-- 1) Meta 인스턴트 양식의 "주말 오전 (8시 ~ 12시)", "주말 오후 (12시 ~ 19시)"를
--    각각 "주말 오전(8시~12시)", "주말 오후(12시~19시)"로 고정합니다.
-- 2) 예전 정규화 함수가 주말 값을 평일 오전/점심/오후로 잘못 매핑한 과거 DB도 복구합니다.
-- 3) 복구 시 app_leads.data의 consultTime 키 하나만 수정합니다.
--    상담 후 방향 / 담당자 / 진행단계 / 상담일지 / 메모 / 예약 / 계약전환 값은 건드리지 않습니다.
-- 4) 기존 자동배정 상세규칙에 저장된 "주말 오전/주말 오후" 값도 새 표기와 호환됩니다.
--
-- 기존 009_advanced_lead_assignment.sql 실행 후 1회 실행하세요.

begin;

create or replace function public.lawpower_normalize_consult_time(v text)
returns text
language plpgsql
immutable
as $$
declare
  s text := lower(regexp_replace(coalesce(v,''), '[\s_,·ㆍ()\[\]]', '', 'g'));
  weekend boolean;
begin
  if s = '' then return null; end if;

  weekend := position('주말' in s) > 0
    or position('토요일' in s) > 0
    or position('일요일' in s) > 0
    or position('토일' in s) > 0
    or position('토/일' in s) > 0;

  -- 주말을 평일 시간대 판정보다 먼저 처리해야 12시/오전/오후 때문에 평일로 잘못 들어가지 않습니다.
  if weekend and (
    position('오전' in s) > 0
    or position('아침' in s) > 0
    or (position('8시' in s) > 0 and position('12시' in s) > 0)
  ) then
    return '주말 오전(8시~12시)';
  end if;

  if weekend and (
    position('오후' in s) > 0
    or position('점심' in s) > 0
    or position('저녁' in s) > 0
    or (position('12시' in s) > 0 and position('19시' in s) > 0)
  ) then
    return '주말 오후(12시~19시)';
  end if;

  if position('퇴근' in s) > 0 or (position('6시' in s) > 0 and position('9시' in s) > 0) then
    return '퇴근 후(6시~9시)';
  end if;

  if position('점심' in s) > 0 or (position('12시' in s) > 0 and position('1시' in s) > 0) then
    return '평일 점심(12시~1시)';
  end if;

  if position('오전' in s) > 0 or position('아침' in s) > 0 or (position('9시' in s) > 0 and position('12시' in s) > 0) then
    return '평일 오전(9시~12시)';
  end if;

  if position('오후' in s) > 0 or (position('1시' in s) > 0 and position('6시' in s) > 0) then
    return '평일 오후(1시~6시)';
  end if;

  return null;
end;
$$;

create or replace function public.normalize_app_lead_pivot_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  debt_value text;
  income_value text;
  time_value text;
begin
  debt_value := public.lawpower_normalize_debt_range(
    coalesce(nullif(new.data->>'debtRange',''), new.data->>'debtRaw')
  );
  income_value := public.lawpower_normalize_income_range(
    coalesce(nullif(new.data->>'incomeRange',''), new.data->>'incomeRaw')
  );

  -- 원본 인스턴트 양식 값(consultTimeRaw)이 있으면 그것을 최우선 원본으로 사용합니다.
  time_value := public.lawpower_normalize_consult_time(
    coalesce(nullif(new.data->>'consultTimeRaw',''), nullif(new.data->>'consultTime',''))
  );

  if debt_value is not null then
    new.data := jsonb_set(new.data, '{debtRange}', to_jsonb(debt_value), true);
  end if;
  if income_value is not null then
    new.data := jsonb_set(new.data, '{incomeRange}', to_jsonb(income_value), true);
  end if;
  if time_value is not null then
    new.data := jsonb_set(new.data, '{consultTime}', to_jsonb(time_value), true);
  end if;

  return new;
end;
$$;

-- 과거 DB 복구: consultTime 하나만 교정합니다.
-- consultTimeRaw가 남아 있는 리드는 원본 양식 응답을 우선하여 재판정합니다.
--
-- SQL Editor에서 실행할 때 auth.uid()/auth.role() 문맥이 일반 사용자 요청과 달라
-- DB 수정권한 검증 트리거가 이 관리용 백필을 차단할 수 있습니다.
-- 또한 기존 pivot 정규화 트리거가 함께 돌면 debtRange/incomeRange까지 재정규화될 수 있으므로
-- 이번 백필 동안에는 두 트리거만 잠시 중지하고 consultTime 키만 수정한 뒤 즉시 복구합니다.
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.app_leads'::regclass
      and tgname = 'trg_app_leads_permissions'
      and not tgisinternal
  ) then
    execute 'alter table public.app_leads disable trigger trg_app_leads_permissions';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.app_leads'::regclass
      and tgname = 'trg_app_leads_normalize_pivot'
      and not tgisinternal
  ) then
    execute 'alter table public.app_leads disable trigger trg_app_leads_normalize_pivot';
  end if;
end $$;

with fixed as (
  select
    id,
    public.lawpower_normalize_consult_time(
      coalesce(nullif(data->>'consultTimeRaw',''), nullif(data->>'consultTime',''))
    ) as normalized_time
  from public.app_leads
)
update public.app_leads l
set data = jsonb_set(l.data, '{consultTime}', to_jsonb(f.normalized_time), true)
from fixed f
where l.id = f.id
  and f.normalized_time is not null
  and coalesce(l.data->>'consultTime','') is distinct from f.normalized_time;

-- 관리용 백필이 끝났으므로 기존 권한/정규화 트리거를 즉시 원복합니다.
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.app_leads'::regclass
      and tgname = 'trg_app_leads_permissions'
      and not tgisinternal
  ) then
    execute 'alter table public.app_leads enable trigger trg_app_leads_permissions';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.app_leads'::regclass
      and tgname = 'trg_app_leads_normalize_pivot'
      and not tgisinternal
  ) then
    execute 'alter table public.app_leads enable trigger trg_app_leads_normalize_pivot';
  end if;
end $$;

-- 고도화 자동배정 함수도 상담가능시간 값을 같은 정규화 기준으로 비교합니다.
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
  config jsonb;
  rr_state jsonb;
  selected_members jsonb;
  base_members jsonb;
  rule_item jsonb;
  route_key text := 'default';
  route_name text := '기본 자동배정';
  config_enabled boolean := true;
  local_ts timestamp;
  local_day integer;
  local_clock time;
  start_clock time;
  end_clock time;
  local_minute integer;
  start_minute integer;
  end_minute integer;
  day_type text;
  weekdays jsonb;
  consult_slots jsonb;
  consult_value text;
  day_match boolean;
  time_match boolean;
  consult_match boolean;
  last_cursor integer := 0;
  target_cursor integer := 0;
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

  -- 같은 로펌의 동시 유입은 한 줄로 세워 중복/배정 커서를 원자적으로 처리합니다.
  perform pg_advisory_xact_lock(hashtext('lawpower_firm_rr_' || p_law_firm_id::text));

  select lead_id into existing_lead_id
  from public.app_lead_imports
  where law_firm_id = p_law_firm_id and external_key = p_external_key;
  if existing_lead_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'leadId', existing_lead_id);
  end if;

  select value into config
  from public.firm_runtime_state
  where law_firm_id = p_law_firm_id and key = 'lead_auto_assignment_config';

  config_enabled := coalesce((config ->> 'enabled')::boolean, true);
  base_members := coalesce(config -> 'members', '[]'::jsonb);
  selected_members := base_members;

  -- DB 원본 receivedAt 기준으로 평일/주말/퇴근후를 판정합니다.
  -- 과거 시트행을 재수집하는 경우에도 현재 처리시각이 아니라 실제 유입시각을 사용합니다.
  begin
    if coalesce(trim(p_lead_data ->> 'receivedAt'), '') <> '' then
      local_ts := (p_lead_data ->> 'receivedAt')::timestamptz at time zone 'Asia/Seoul';
    else
      local_ts := timezone('Asia/Seoul', now());
    end if;
  exception when others then
    local_ts := timezone('Asia/Seoul', now());
  end;
  local_day := extract(isodow from local_ts)::integer;
  local_clock := local_ts::time;
  local_minute := extract(hour from local_clock)::integer * 60 + extract(minute from local_clock)::integer;
  consult_value := public.lawpower_normalize_consult_time(coalesce(nullif(trim(p_lead_data ->> 'consultTimeRaw'), ''), nullif(trim(p_lead_data ->> 'consultTime'), '')));

  -- 자동배정 전체 OFF일 때는 상세규칙도 적용하지 않고 아래 관리자 fallback으로 보냅니다.
  if config_enabled then
    -- priority가 작은 규칙부터 첫 번째 매칭 규칙 1개만 적용합니다.
    for rule_item in
      select elem
      from jsonb_array_elements(coalesce(config -> 'rules', '[]'::jsonb)) with ordinality as r(elem, ord)
      where coalesce((elem ->> 'enabled')::boolean, true) = true
      order by coalesce(nullif(elem ->> 'priority','')::integer, ord::integer), ord
    loop
      day_type := coalesce(nullif(rule_item ->> 'dayType',''), 'all');
      weekdays := coalesce(rule_item -> 'weekdays', '[]'::jsonb);
      start_clock := coalesce(nullif(rule_item ->> 'startTime','')::time, '00:00'::time);
      end_clock := coalesce(nullif(rule_item ->> 'endTime','')::time, '23:59'::time);
      consult_slots := coalesce(rule_item -> 'consultTimeSlots', '[]'::jsonb);
      start_minute := extract(hour from start_clock)::integer * 60 + extract(minute from start_clock)::integer;
      end_minute := extract(hour from end_clock)::integer * 60 + extract(minute from end_clock)::integer;

      day_match := case day_type
        when 'weekday' then local_day between 1 and 5
        when 'weekend' then local_day in (6,7)
        when 'custom' then exists (
          select 1 from jsonb_array_elements_text(weekdays) d where d::integer = local_day
        )
        else true
      end;

      -- 종료가 시작보다 이르면 18:00~09:00 같은 자정 넘김 규칙으로 처리합니다.
      time_match := case
        when start_minute <= end_minute then local_minute between start_minute and end_minute
        else local_minute >= start_minute or local_minute <= end_minute
      end;

      consult_match := jsonb_array_length(consult_slots) = 0
        or exists (
          select 1
          from jsonb_array_elements_text(consult_slots) s
          where public.lawpower_normalize_consult_time(s) = consult_value
        );

      if day_match and time_match and consult_match then
        selected_members := coalesce(rule_item -> 'members', '[]'::jsonb);
        route_key := 'rule:' || coalesce(nullif(rule_item ->> 'id',''), md5(rule_item::text));
        route_name := coalesce(nullif(rule_item ->> 'name',''), '상세 자동배정');
        exit;
      end if;
    end loop;
  else
    selected_members := '[]'::jsonb;
    route_key := 'disabled';
    route_name := '자동배정 OFF';
  end if;

  -- 상세규칙은 매칭됐지만 유효한 대상이 하나도 없으면 기본 자동배정 풀로 fallback합니다.
  if config_enabled and route_key <> 'default' and not exists (
    select 1
    from jsonb_array_elements(coalesce(selected_members, '[]'::jsonb)) m
    join public.profiles p on p.id::text = m ->> 'profileId'
    where coalesce((m ->> 'enabled')::boolean, false) = true
      and p.law_firm_id = p_law_firm_id
      and p.is_active = true
      and p.is_work_staff = true
      and p.platform_role in ('firm_admin','staff')
  ) then
    selected_members := base_members;
    route_key := 'default';
    route_name := '기본 자동배정';
  end if;

  -- 설정 JSON이 아직 없는 구버전 로펌은 기존 profiles 자동배정 설정을 그대로 사용합니다.
  if config_enabled and not exists (
    select 1
    from jsonb_array_elements(coalesce(selected_members, '[]'::jsonb)) m
    join public.profiles p on p.id::text = m ->> 'profileId'
    where coalesce((m ->> 'enabled')::boolean, false) = true
      and p.law_firm_id = p_law_firm_id
      and p.is_active = true
      and p.is_work_staff = true
      and p.platform_role in ('firm_admin','staff')
  ) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'profileId', p.id::text,
      'enabled', true,
      'order', coalesce(p.lead_assignment_order,1000),
      'weight', 1
    ) order by coalesce(p.lead_assignment_order,1000), p.created_at, p.id), '[]'::jsonb)
    into selected_members
    from public.profiles p
    where p.law_firm_id = p_law_firm_id
      and p.is_active = true
      and p.is_work_staff = true
      and p.auto_assign_leads = true
      and p.platform_role in ('firm_admin','staff');
    route_key := 'legacy';
    route_name := '기존 자동배정';
  end if;

  -- 커서 상태 행을 보장하고 잠급니다.
  insert into public.firm_runtime_state(law_firm_id,key,value)
  values (p_law_firm_id, 'lead_round_robin_v2', '{"cursors":{},"updatedAt":null}'::jsonb)
  on conflict(law_firm_id,key) do nothing;

  select value into rr_state
  from public.firm_runtime_state
  where law_firm_id = p_law_firm_id and key = 'lead_round_robin_v2'
  for update;

  begin
    last_cursor := coalesce((rr_state -> 'cursors' ->> route_key)::integer, 0);
  exception when others then
    last_cursor := 0;
  end;

  if config_enabled then
    -- 가중 라운드로빈.
    -- 각 직원 weight만큼 슬롯을 만들되 gs/weight 순으로 섞어서 7:3 같은 비율도 한쪽에 연속으로 몰리지 않게 배치합니다.
    with raw_members as (
      select
        (m ->> 'profileId')::uuid as profile_id,
        greatest(1, least(9999, coalesce(nullif(m ->> 'order','')::integer, 1000))) as assignment_order,
        greatest(1, least(100, coalesce(nullif(m ->> 'weight','')::integer, 1))) as weight
      from jsonb_array_elements(coalesce(selected_members, '[]'::jsonb)) m
      where coalesce((m ->> 'enabled')::boolean, false) = true
        and coalesce(m ->> 'profileId','') ~* '^[0-9a-f-]{36}$'
    ), eligible as (
      select
        p.id,
        coalesce(nullif(p.staff_name,''), nullif(p.display_name,''), p.email) as staff_name,
        r.assignment_order,
        r.weight,
        p.created_at
      from raw_members r
      join public.profiles p on p.id = r.profile_id
      where p.law_firm_id = p_law_firm_id
        and p.is_active = true
        and p.is_work_staff = true
        and p.platform_role in ('firm_admin','staff')
        and coalesce(nullif(p.staff_name,''), nullif(p.display_name,''), p.email) is not null
    ), slots as (
      select
        e.id,
        e.staff_name,
        row_number() over(
          order by (gs::numeric / e.weight::numeric), e.assignment_order, e.created_at, e.id, gs
        ) as rn,
        count(*) over() as total_slots
      from eligible e
      cross join lateral generate_series(1, e.weight) gs
    )
    select s.id, s.staff_name, s.rn::integer
      into target_profile_id, target_staff_name, target_cursor
    from slots s
    where s.rn = ((last_cursor % s.total_slots) + 1)
    limit 1;
  end if;

  -- 자동배정 OFF 또는 유효한 배정대상이 없을 때 DB 유실을 막기 위해 활성 로펌관리자에게 fallback합니다.
  if target_profile_id is null then
    select p.id, coalesce(nullif(p.staff_name,''), nullif(p.display_name,''), p.email)
      into target_profile_id, target_staff_name
    from public.profiles p
    where p.law_firm_id = p_law_firm_id
      and p.is_active = true
      and p.platform_role = 'firm_admin'
    order by p.created_at, p.id
    limit 1;
    target_cursor := 0;
    route_name := case when config_enabled then '관리자 fallback' else '자동배정 OFF · 관리자 fallback' end;
  end if;

  if target_profile_id is null or coalesce(target_staff_name,'') = '' then
    raise exception '해당 로펌에 활성 관리자/자동배정 담당자가 없습니다.';
  end if;

  final_data := jsonb_set(p_lead_data, '{assignedStaff}', to_jsonb(target_staff_name), true);

  insert into public.app_leads(id, data, created_by, law_firm_id, ad_source_id, meta_account_id, meta_lead_id)
  values (p_lead_id, final_data, null, p_law_firm_id, p_ad_source_id, p_meta_account_id, nullif(trim(p_meta_lead_id),''));

  insert into public.app_lead_imports(external_key, lead_id, source, sheet_name, row_number, assigned_profile_id, assigned_staff, law_firm_id)
  values (p_external_key, p_lead_id, 'google_sheets', p_sheet_name, p_row_number, target_profile_id, target_staff_name, p_law_firm_id);

  if target_cursor > 0 then
    rr_state := coalesce(rr_state, '{}'::jsonb);
    rr_state := jsonb_set(rr_state, '{cursors}', coalesce(rr_state -> 'cursors', '{}'::jsonb), true);
    rr_state := jsonb_set(rr_state, array['cursors', route_key], to_jsonb(target_cursor), true);
    rr_state := jsonb_set(rr_state, '{lastProfileId}', to_jsonb(target_profile_id::text), true);
    rr_state := jsonb_set(rr_state, '{lastStaffName}', to_jsonb(target_staff_name), true);
    rr_state := jsonb_set(rr_state, '{lastRouteKey}', to_jsonb(route_key), true);
    rr_state := jsonb_set(rr_state, '{lastRouteName}', to_jsonb(route_name), true);
    rr_state := jsonb_set(rr_state, '{updatedAt}', to_jsonb(now()::text), true);

    update public.firm_runtime_state
    set value = rr_state, updated_at = now()
    where law_firm_id = p_law_firm_id and key = 'lead_round_robin_v2';
  end if;

  change_id := 'CHG-' || gen_random_uuid()::text;
  insert into public.app_change_logs(id,data,created_by,law_firm_id)
  values (
    change_id,
    jsonb_build_object(
      'id',change_id,
      'category','DB관리',
      'action','등록',
      'targetName',final_data ->> 'name',
      'detail','로펌별 구글시트 자동등록 · 담당자 자동배정: ' || target_staff_name || ' · ' || route_name,
      'staff','시스템',
      'at',now()
    ),
    null,
    p_law_firm_id
  );

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'leadId',p_lead_id,
    'assignedProfileId',target_profile_id,
    'assignedStaff',target_staff_name,
    'assignmentRoute',route_name,
    'assignmentRouteKey',route_key
  );
end;
$$;

revoke all on function public.import_tenant_google_sheet_lead(uuid,text,text,jsonb,text,integer,uuid,uuid,text) from public;
grant execute on function public.import_tenant_google_sheet_lead(uuid,text,text,jsonb,text,integer,uuid,uuid,text) to service_role;

commit;

-- 확인용: 주말 원본이 더 이상 평일 슬롯으로 남아 있지 않은지 확인합니다.
select
  count(*) filter (where coalesce(data->>'consultTimeRaw','') ~ '주말|토요일|일요일|토일') as weekend_source_count,
  count(*) filter (where data->>'consultTime' = '주말 오전(8시~12시)') as weekend_morning_count,
  count(*) filter (where data->>'consultTime' = '주말 오후(12시~19시)') as weekend_afternoon_count,
  count(*) filter (
    where coalesce(data->>'consultTimeRaw','') ~ '주말|토요일|일요일|토일'
      and data->>'consultTime' like '평일%'
  ) as weekend_still_mapped_to_weekday
from public.app_leads;
