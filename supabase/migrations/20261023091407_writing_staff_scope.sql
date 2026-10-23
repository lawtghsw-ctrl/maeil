begin;

-- No profile/data backfill. The designation is applied only by an explicit
-- staff-management save. Existing permissive policies remain tenant guarded.
create or replace function public.is_writing_staff()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.is_active_user() and exists (
  select 1 from public.profiles p where p.id=auth.uid() and p.role='staff'
   and coalesce(p.platform_role,'staff') not in ('firm_admin','super_admin')
   and p.permissions->'staff.writer'='true'::jsonb
 );
$$;
revoke all on function public.is_writing_staff() from public,anon;
grant execute on function public.is_writing_staff() to authenticated;

-- Mirrors detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS. Explicit malformed,
-- empty or unknown stages must never fall back to a more permissive status.
create or replace function public.is_writing_lead_data(lead_data jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce((case
  when lead_data->'detailStage' is null or lead_data->'detailStage'='null'::jsonb then
   case lead_data->>'status'
    when '서류검토중' then '1차 서류미비'
    when '계약진행중' then '착수금착수'
    when '수임전환' then '법원접수(대기)'
    else null end
  when jsonb_typeof(lead_data->'detailStage')='string' then lead_data->>'detailStage'
  else null end) = any(array[
   '착수금착수','착수 1차안내','착수 추후진행','취소예정',
   '1차 서류미비','1차 서류완료','2차서류안내','2차서류미비','2차서류완료','접수보류',
   '법원접수(대기)','법원접수','금지명령','금지기각','개시결정','인가결정','종결',
   '워크아웃','새출발','워크아웃 신청','새출발 신청','워크아웃 완료','새출발 완료','파산'
  ]),false);
$$;
revoke all on function public.is_writing_lead_data(jsonb) from public,anon;
grant execute on function public.is_writing_lead_data(jsonb) to authenticated;

-- Old extra permission bits cannot expand this role. Non-writers use the
-- original permission expression, and no stored permission JSON is rewritten.
create or replace function public.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.is_active_user() and exists (
  select 1 from public.profiles p where p.id=auth.uid() and
   case when p.role='staff' and coalesce(p.platform_role,'staff') not in ('firm_admin','super_admin')
     and p.permissions->'staff.writer'='true'::jsonb
   then permission_key=any(array[
    'db.view','db.view_all','db.view_finance','db.view_consultation','db.edit_consultation',
    'db.edit_basic','db.change_stage','db.change_assignee','db.manage_reservation','db.convert',
    'cases.view','cases.view_all','cases.view_finance','cases.edit_basic','cases.change_assignee','cases.manage_installments'
   ])
   else p.role='admin' or coalesce((p.permissions->>permission_key)::boolean,false)=true end
 );
$$;

-- Not an exposed PostgREST schema. Every row lookup independently checks the
-- authenticated writer and their tenant, even when called from a definer helper.
create schema if not exists writing_staff_private;
revoke all on schema writing_staff_private from public,anon;
grant usage on schema writing_staff_private to authenticated;

create index if not exists app_leads_writer_reverse_case_idx on public.app_leads (law_firm_id,(data->>'convertedCaseId'));
create index if not exists app_leads_writer_reverse_client_idx on public.app_leads (law_firm_id,(data->>'convertedClientId'));
create index if not exists app_cases_writer_client_idx on public.app_cases (law_firm_id,(data->>'clientId'));

create function writing_staff_private.lead_allowed(target_id text, firm_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.is_writing_staff() and firm_id=public.current_law_firm_id() and exists (
  select 1 from public.app_leads l where l.id=target_id and l.law_firm_id=firm_id
   and public.is_writing_lead_data(l.data)
 );
$$;

-- Core case resolver intentionally does not invoke client_allowed (which can
-- use a case as its final fallback). All reverse counts use unfiltered rows.
create function writing_staff_private.case_link_allowed(target_id text, case_data jsonb, firm_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare client_data jsonb; direct_id text; client_direct text; reverse_ids text[];
begin
 if not public.is_writing_staff() or firm_id is distinct from public.current_law_firm_id() then return false; end if;
 select c.data into client_data from public.app_clients c
  where c.id=case_data->>'clientId' and c.law_firm_id=firm_id;
 if not found then return false; end if;
 direct_id:=nullif(case_data->>'fromLeadId','');
 client_direct:=nullif(client_data->>'fromLeadId','');
 if direct_id is not null and client_direct is not null and direct_id<>client_direct then return false; end if;
 direct_id:=coalesce(direct_id,client_direct);
 if direct_id is not null then return writing_staff_private.lead_allowed(direct_id,firm_id); end if;
 select array_agg(l.id) into reverse_ids from public.app_leads l
  where l.law_firm_id=firm_id and l.data->>'convertedCaseId'=target_id;
 return coalesce(cardinality(reverse_ids)=1 and writing_staff_private.lead_allowed(reverse_ids[1],firm_id),false);
end;
$$;

create function writing_staff_private.client_allowed(target_id text, client_data jsonb, firm_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare direct_id text; reverse_ids text[];
begin
 if not public.is_writing_staff() or firm_id is distinct from public.current_law_firm_id() then return false; end if;
 direct_id:=nullif(client_data->>'fromLeadId','');
 if direct_id is not null then return writing_staff_private.lead_allowed(direct_id,firm_id); end if;
 select array_agg(l.id) into reverse_ids from public.app_leads l
  where l.law_firm_id=firm_id and l.data->>'convertedClientId'=target_id;
 if coalesce(cardinality(reverse_ids),0)>0 then
  return cardinality(reverse_ids)=1 and writing_staff_private.lead_allowed(reverse_ids[1],firm_id);
 end if;
 return exists(select 1 from public.app_cases c where c.law_firm_id=firm_id
  and c.data->>'clientId'=target_id and writing_staff_private.case_link_allowed(c.id,c.data,firm_id));
end;
$$;

create function writing_staff_private.case_allowed(target_id text, case_data jsonb, firm_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select writing_staff_private.case_link_allowed(target_id,case_data,firm_id) and exists (
  select 1 from public.app_clients c where c.law_firm_id=firm_id and c.id=case_data->>'clientId'
   and writing_staff_private.client_allowed(c.id,c.data,firm_id)
 );
$$;

create function writing_staff_private.case_id_allowed(target_id text, firm_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.is_writing_staff() and firm_id=public.current_law_firm_id() and exists (
  select 1 from public.app_cases c where c.id=target_id and c.law_firm_id=firm_id
   and writing_staff_private.case_allowed(c.id,c.data,firm_id)
 );
$$;

-- A conversion may create new linked rows, but may not reattach an unrelated
-- existing client/case and cause the existing definer sync trigger to edit it.
create function writing_staff_private.lead_links_safe(target_id text, lead_data jsonb, firm_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare prior_data jsonb; linked_data jsonb; linked_firm uuid; ref_id text; reverse_count integer;
begin
 if not public.is_writing_staff() or firm_id is distinct from public.current_law_firm_id() then return false; end if;
 select l.data into prior_data from public.app_leads l where l.id=target_id and l.law_firm_id=firm_id;
 if not found then return false; end if;
 ref_id:=nullif(lead_data->>'convertedClientId','');
 if ref_id is not null then
  select c.data,c.law_firm_id into linked_data,linked_firm from public.app_clients c where c.id=ref_id;
  if found then
   if linked_firm<>firm_id then return false; end if;
   if nullif(linked_data->>'fromLeadId','') is not null then
    if linked_data->>'fromLeadId'<>target_id then return false; end if;
   else
    select count(*) into reverse_count from public.app_leads l where l.law_firm_id=firm_id and l.data->>'convertedClientId'=ref_id;
    if prior_data->>'convertedClientId' is distinct from ref_id or reverse_count<>1 then return false; end if;
   end if;
  end if;
 end if;
 ref_id:=nullif(lead_data->>'convertedCaseId','');
 if ref_id is not null then
  select c.data,c.law_firm_id into linked_data,linked_firm from public.app_cases c where c.id=ref_id;
  if found then
   if linked_firm<>firm_id or linked_data->>'clientId' is distinct from lead_data->>'convertedClientId' then return false; end if;
   if nullif(linked_data->>'fromLeadId','') is not null then
    if linked_data->>'fromLeadId'<>target_id then return false; end if;
   else
    select count(*) into reverse_count from public.app_leads l where l.law_firm_id=firm_id and l.data->>'convertedCaseId'=ref_id;
    if prior_data->>'convertedCaseId' is distinct from ref_id or reverse_count<>1 then return false; end if;
   end if;
  end if;
 end if;
 return true;
end;
$$;

revoke all on all functions in schema writing_staff_private from public,anon;
grant execute on all functions in schema writing_staff_private to authenticated;

-- Existing child policies also call these public helpers. Preserve every
-- non-writer branch exactly; restrict writer ID checks at the helper boundary.
create or replace function public.can_access_client_id(target_client_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.is_writing_staff() then exists (
  select 1 from public.app_clients c where c.id=target_client_id and c.law_firm_id=public.current_law_firm_id()
   and writing_staff_private.client_allowed(c.id,c.data,c.law_firm_id)
 ) else public.is_admin_user() or exists (
  select 1 from public.app_clients c where c.id=target_client_id
   and public.has_any_permission(array['db.view','cases.view','dashboard.view','settlements.view','analytics.view'])
   and (public.has_any_permission(array['db.view_all','cases.view_all','dashboard.company_metrics','settlements.view_all','analytics.view_all'])
    or c.data->>'assignedStaff'=public.current_staff_name())
 ) end;
$$;
create or replace function public.can_access_case_id(target_case_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.is_writing_staff() then writing_staff_private.case_id_allowed(target_case_id,public.current_law_firm_id())
 else public.is_admin_user() or exists (
  select 1 from public.app_cases c where c.id=target_case_id
   and public.has_any_permission(array['cases.view','db.view_finance','dashboard.finance','dashboard.installment_calendar','dashboard.schedule_calendar','settlements.view','analytics.view'])
   and (public.has_any_permission(array['cases.view_all','db.view_all','dashboard.company_metrics','settlements.view_all','analytics.view_all'])
    or c.data->>'assignedStaff'=public.current_staff_name())
 ) end;
$$;

create policy writing_staff_leads_scope on public.app_leads as restrictive for all to authenticated
 using (not (select public.is_writing_staff()) or public.is_writing_lead_data(data))
 with check (not (select public.is_writing_staff()) or (
  public.is_writing_lead_data(data) and writing_staff_private.lead_links_safe(id,data,law_firm_id)));
create policy writing_staff_clients_scope on public.app_clients as restrictive for all to authenticated
 using (not (select public.is_writing_staff()) or writing_staff_private.client_allowed(id,data,law_firm_id))
 with check (not (select public.is_writing_staff()) or (
  nullif(data->>'fromLeadId','') is not null and writing_staff_private.lead_allowed(data->>'fromLeadId',law_firm_id)));
create policy writing_staff_cases_scope on public.app_cases as restrictive for all to authenticated
 using (not (select public.is_writing_staff()) or writing_staff_private.case_allowed(id,data,law_firm_id))
 with check (not (select public.is_writing_staff()) or writing_staff_private.case_allowed(id,data,law_firm_id));
-- Explicit outer-row references avoid the legacy db.convert subquery's
-- unqualified `data` resolving to the inner lead instead of the new case.
create policy writing_staff_case_conversion_insert on public.app_cases for insert to authenticated
 with check ((select public.is_writing_staff()) and public.has_permission('db.convert')
  and writing_staff_private.lead_allowed(data->>'fromLeadId',law_firm_id)
  and writing_staff_private.case_allowed(id,data,law_firm_id));
create policy writing_staff_installments_scope on public.app_installments as restrictive for all to authenticated
 using (not (select public.is_writing_staff()) or writing_staff_private.case_id_allowed(data->>'caseId',law_firm_id))
 with check (not (select public.is_writing_staff()) or writing_staff_private.case_id_allowed(data->>'caseId',law_firm_id));
create policy writing_staff_schedule_deny on public.app_schedule_items as restrictive for all to authenticated
 using (not (select public.is_writing_staff())) with check (not (select public.is_writing_staff()));
create policy writing_staff_board_deny on public.app_board_posts as restrictive for all to authenticated
 using (not (select public.is_writing_staff())) with check (not (select public.is_writing_staff()));
create policy writing_staff_settings_scope on public.firm_settings as restrictive for select to authenticated
 using (not (select public.is_writing_staff()) or key='min_living_cost');

-- Identity cannot be rewritten through the writer's db.edit_basic permission.
create function public.enforce_writing_lead_identity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()='service_role' or not public.is_writing_staff() then return new; end if;
 if old.id is distinct from new.id or old.law_firm_id is distinct from new.law_firm_id
  or old.data->'id' is distinct from new.data->'id' then raise exception 'WRITING_LEAD_IDENTITY_IMMUTABLE'; end if;
 return new;
end;
$$;
revoke all on function public.enforce_writing_lead_identity() from public,anon,authenticated;
create trigger writing_lead_identity before update on public.app_leads
 for each row execute function public.enforce_writing_lead_identity();

-- Add only the new general-edit capability to the existing case update scope.
drop policy if exists app_cases_update_permissions on public.app_cases;
create policy app_cases_update_permissions on public.app_cases for update to authenticated
 using (public.is_admin_user() or (
  public.has_any_permission(array['cases.manage_installments','cases.send_docs','cases.change_assignee','cases.edit_basic'])
  and (public.has_permission('cases.view_all') or data->>'assignedStaff'=public.current_staff_name())
 ))
 with check (public.is_active_user() and (
  public.is_admin_user() or public.has_permission('cases.change_assignee') or (
   public.has_any_permission(array['cases.manage_installments','cases.send_docs','cases.edit_basic'])
   and (public.has_permission('cases.view_all') or data->>'assignedStaff'=public.current_staff_name())
  )
 ));

create or replace function public.enforce_case_update_permissions()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 finance_keys text[]:=array['totalDebt','contractAmount','paidAmount','installmentCount','paymentMethod'];
 basic_keys text[]:=array['caseNumber','caseType','court','stage','stageUpdatedAt','status','filingDate','nextHearingDate','monthlyRepayment','contractDate','memo'];
 permitted_keys text[]:=array['assignedStaff','totalDebt','contractAmount','paidAmount','installmentCount','paymentMethod','docsSentAt'];
 field_name text;
begin
 if auth.role()='service_role' or public.is_admin_user() then return new; end if;
 if old.id is distinct from new.id or old.law_firm_id is distinct from new.law_firm_id then raise exception 'CASE_IDENTITY_IMMUTABLE'; end if;
 if old.data->'assignedStaff' is distinct from new.data->'assignedStaff' and not public.has_permission('cases.change_assignee') then
  raise exception '계약 담당자 변경 권한이 없습니다.';
 end if;
 foreach field_name in array finance_keys loop
  if old.data->field_name is distinct from new.data->field_name and not public.has_permission('cases.manage_installments') then
   raise exception '분납/계약금액 수정 권한이 없습니다.';
  end if;
 end loop;
 if old.data->'docsSentAt' is distinct from new.data->'docsSentAt' and not public.has_permission('cases.send_docs') then
  raise exception '서류안내문 전송 권한이 없습니다.';
 end if;
 if public.has_permission('cases.edit_basic') then permitted_keys:=permitted_keys||basic_keys; end if;
 if (old.data-permitted_keys) is distinct from (new.data-permitted_keys) then
  raise exception '이 계약 항목을 수정할 권한이 없습니다.';
 end if;
 return new;
end;
$$;

-- Keep round-robin order, routing, ingestion and duplicate handling unchanged.
-- Only current writing-staff profiles are removed from every candidate path.
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
      and not coalesce(p.role='staff' and coalesce(p.platform_role,'staff') not in ('firm_admin','super_admin')
        and p.permissions->'staff.writer'='true'::jsonb,false)
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
      and not coalesce(p.role='staff' and coalesce(p.platform_role,'staff') not in ('firm_admin','super_admin')
        and p.permissions->'staff.writer'='true'::jsonb,false)
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
      and not coalesce(p.role='staff' and coalesce(p.platform_role,'staff') not in ('firm_admin','super_admin')
        and p.permissions->'staff.writer'='true'::jsonb,false)
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
      and not coalesce(p.role='staff' and coalesce(p.platform_role,'staff') not in ('firm_admin','super_admin')
        and p.permissions->'staff.writer'='true'::jsonb,false)
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
      and not coalesce(p.role='staff' and coalesce(p.platform_role,'staff') not in ('firm_admin','super_admin')
        and p.permissions->'staff.writer'='true'::jsonb,false)
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

-- CREATE OR REPLACE preserves the deployed ACL; its service_role-only body
-- guard above is unchanged.

commit;
