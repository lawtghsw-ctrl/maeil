-- LawPower v26
-- 직원계정관리 / 세부 권한 / 동적 담당자 / 권한 기반 RLS
-- 반드시 001_initial.sql 적용 후 Supabase SQL Editor에서 1회 실행하세요.

alter table public.profiles
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists is_work_staff boolean not null default false;

alter table public.profiles alter column is_work_staff set default false;

-- 현재 운영 기준 보정
-- 홍성원: 개발자 최종관리자(실무 담당자 목록 제외)
-- 강이삭: 최종관리자 + 실무 담당자
-- 박형원: 직원 + 실무 담당자
update public.profiles set is_work_staff = false where role = 'admin';
update public.profiles
set role = 'admin', is_active = true, is_work_staff = false,
    staff_name = coalesce(nullif(staff_name, ''), display_name), updated_at = now()
where display_name = '홍성원' or staff_name = '홍성원';
update public.profiles
set role = 'admin', is_active = true, is_work_staff = true,
    staff_name = '강이삭', updated_at = now()
where display_name = '강이삭' or staff_name = '강이삭';
update public.profiles
set role = 'staff', is_active = true, is_work_staff = true,
    staff_name = '박형원', updated_at = now()
where display_name = '박형원' or staff_name = '박형원';
update public.profiles
set staff_name = display_name, updated_at = now()
where is_work_staff = true and coalesce(staff_name, '') = '';

-- v25 초기값에 남아 있던 과거 담당자 정산요율 키를 현재 실무자 기준으로 정리합니다.
update public.app_settings
set value = (value - '홍성원' - '신홍규' - '이중호')
            || jsonb_build_object(
              '강이삭', coalesce(value -> '강이삭', '{"단순분납":100,"로피분납":90,"신카할부완납":85,"캐피탈분납":80}'::jsonb),
              '박형원', coalesce(value -> '박형원', '{"단순분납":100,"로피분납":90,"신카할부완납":85,"캐피탈분납":80}'::jsonb)
            ),
    updated_at = now()
where key = 'settlement_rates';

-- 기존 직원 중 아직 권한을 설정하지 않은 계정에 실무 기본 권한 부여
update public.profiles
set permissions = '{
  "dashboard.view": true,
  "dashboard.finance": true,
  "dashboard.installment_calendar": true,
  "dashboard.schedule_calendar": true,
  "dashboard.statistics": true,
  "db.view": true,
  "db.view_finance": true,
  "db.create": true,
  "db.edit_basic": true,
  "db.view_consultation": true,
  "db.edit_consultation": true,
  "db.change_stage": true,
  "db.manage_reservation": true,
  "db.convert": true,
  "cases.view": true,
  "cases.view_finance": true,
  "cases.create": true,
  "cases.manage_installments": true,
  "cases.econtract": true,
  "cases.send_docs": true,
  "living.view": true
}'::jsonb,
updated_at = now()
where role = 'staff' and permissions = '{}'::jsonb;

create or replace function public.current_staff_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(p.staff_name, ''), nullif(p.display_name, ''))
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.current_actor_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(p.display_name, ''), nullif(p.staff_name, ''), p.email)
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        p.role = 'admin'
        or coalesce((p.permissions ->> permission_key)::boolean, false) = true
      )
  );
$$;

create or replace function public.has_any_permission(permission_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_user() or exists (
    select 1 from unnest(permission_keys) as k
    where public.has_permission(k)
  );
$$;

revoke all on function public.current_staff_name() from public;
revoke all on function public.current_actor_name() from public;
revoke all on function public.has_permission(text) from public;
revoke all on function public.has_any_permission(text[]) from public;
grant execute on function public.current_staff_name() to authenticated;
grant execute on function public.current_actor_name() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_any_permission(text[]) to authenticated;

-- 직원 이름 변경 시 기존 담당자 문자열과 정산설정 키도 함께 이전합니다.
-- 브라우저에서 직접 실행할 수 없고 service_role 전용 API만 호출할 수 있습니다.
create or replace function public.rename_staff_assignments(old_name text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_rates jsonb;
begin
  if coalesce(old_name, '') = '' or coalesce(new_name, '') = '' or old_name = new_name then
    return;
  end if;

  update public.app_leads
     set data = jsonb_set(data, '{assignedStaff}', to_jsonb(new_name), true)
   where data ->> 'assignedStaff' = old_name;
  update public.app_clients
     set data = jsonb_set(data, '{assignedStaff}', to_jsonb(new_name), true)
   where data ->> 'assignedStaff' = old_name;
  update public.app_cases
     set data = jsonb_set(data, '{assignedStaff}', to_jsonb(new_name), true)
   where data ->> 'assignedStaff' = old_name;

  select value -> old_name into old_rates
  from public.app_settings where key = 'settlement_rates';

  if old_rates is not null then
    update public.app_settings
       set value = (value - old_name) || jsonb_build_object(new_name, old_rates),
           updated_at = now()
     where key = 'settlement_rates';
  end if;
end;
$$;
revoke all on function public.rename_staff_assignments(text, text) from public;
grant execute on function public.rename_staff_assignments(text, text) to service_role;

-- 프로필: 본인, 최종관리자, 그리고 활성 사용자가 보는 '실무 담당자 이름 디렉터리'.
-- 실무 담당자는 계정 활성 전에도 사전 배정할 수 있도록 is_active 조건을 걸지 않습니다.
drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_select_directory on public.profiles;
create policy profiles_select_directory
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_admin_user()
  or (public.is_active_user() and is_work_staff = true)
);
-- 프로필 수정은 service_role을 사용하는 /api/admin/users 에서만 수행합니다.
drop policy if exists profiles_update_admin on public.profiles;

-- JSONB 업데이트를 세부 권한까지 검증하는 트리거
create or replace function public.enforce_lead_update_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_admin_user() then return new; end if;

  if old.data -> 'consultation' is distinct from new.data -> 'consultation'
     and not public.has_permission('db.edit_consultation') then
    raise exception '상담일지 수정 권한이 없습니다.';
  end if;

  if ((old.data -> 'detailStage' is distinct from new.data -> 'detailStage')
      or (old.data -> 'status' is distinct from new.data -> 'status'))
     and not (
       public.has_permission('db.change_stage')
       or (
         public.has_permission('db.convert')
         and new.data ->> 'convertedClientId' is not null
         and new.data ->> 'status' = '수임전환'
       )
     ) then
    raise exception 'DB 진행단계 변경 권한이 없습니다.';
  end if;

  if old.data -> 'assignedStaff' is distinct from new.data -> 'assignedStaff'
     and not public.has_permission('db.change_assignee') then
    raise exception 'DB 담당자 변경 권한이 없습니다.';
  end if;

  if old.data -> 'reservationAt' is distinct from new.data -> 'reservationAt'
     and not public.has_permission('db.manage_reservation') then
    raise exception '예약일정 변경 권한이 없습니다.';
  end if;

  if old.data -> 'convertedClientId' is distinct from new.data -> 'convertedClientId'
     and not public.has_permission('db.convert') then
    raise exception '고객전환 권한이 없습니다.';
  end if;

  if old.data -> 'convertedCaseId' is distinct from new.data -> 'convertedCaseId'
     and not public.has_any_permission(array['db.convert','cases.create']) then
    raise exception '계약 연결 권한이 없습니다.';
  end if;

  if (old.data - array['consultation','detailStage','status','assignedStaff','reservationAt','convertedClientId','convertedCaseId'])
      is distinct from
     (new.data - array['consultation','detailStage','status','assignedStaff','reservationAt','convertedClientId','convertedCaseId'])
     and not public.has_permission('db.edit_basic') then
    raise exception 'DB 기본정보 수정 권한이 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_leads_permissions on public.app_leads;
create trigger trg_app_leads_permissions
before update on public.app_leads
for each row execute function public.enforce_lead_update_permissions();

create or replace function public.enforce_case_update_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_admin_user() then return new; end if;

  if old.data -> 'assignedStaff' is distinct from new.data -> 'assignedStaff'
     and not public.has_permission('cases.change_assignee') then
    raise exception '계약 담당자 변경 권한이 없습니다.';
  end if;

  if old.data -> 'paidAmount' is distinct from new.data -> 'paidAmount'
     and not public.has_permission('cases.manage_installments') then
    raise exception '분납/납부금 수정 권한이 없습니다.';
  end if;

  if old.data -> 'docsSentAt' is distinct from new.data -> 'docsSentAt'
     and not public.has_permission('cases.send_docs') then
    raise exception '서류안내문 전송 권한이 없습니다.';
  end if;

  if (old.data - array['assignedStaff','paidAmount','docsSentAt'])
      is distinct from
     (new.data - array['assignedStaff','paidAmount','docsSentAt']) then
    raise exception '이 계약 항목을 수정할 권한이 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_cases_permissions on public.app_cases;
create trigger trg_app_cases_permissions
before update on public.app_cases
for each row execute function public.enforce_case_update_permissions();

-- DB 리드: 조회범위 + 기능권한
drop policy if exists app_leads_active_users on public.app_leads;
drop policy if exists app_leads_select_permissions on public.app_leads;
drop policy if exists app_leads_insert_permissions on public.app_leads;
drop policy if exists app_leads_update_permissions on public.app_leads;
drop policy if exists app_leads_delete_permissions on public.app_leads;
create policy app_leads_select_permissions on public.app_leads for select to authenticated
using (
  public.is_admin_user()
  or (
    public.has_any_permission(array['db.view','dashboard.view','analytics.view'])
    and (
      public.has_any_permission(array['db.view_all','dashboard.company_metrics','dashboard.company_todo','analytics.view_all'])
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
);
create policy app_leads_insert_permissions on public.app_leads for insert to authenticated
with check (
  public.has_permission('db.create')
  and (public.has_permission('db.change_assignee') or data ->> 'assignedStaff' = public.current_staff_name())
);
create policy app_leads_update_permissions on public.app_leads for update to authenticated
using (
  public.is_admin_user()
  or (
    public.has_any_permission(array['db.edit_basic','db.edit_consultation','db.change_stage','db.change_assignee','db.manage_reservation','db.convert','cases.create'])
    and (public.has_permission('db.view_all') or data ->> 'assignedStaff' = public.current_staff_name())
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin_user()
    or public.has_permission('db.change_assignee')
    or data ->> 'assignedStaff' = public.current_staff_name()
  )
);
create policy app_leads_delete_permissions on public.app_leads for delete to authenticated
using (public.is_admin_user());

-- 고객정보
create or replace function public.can_access_client_id(target_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_user() or exists (
    select 1 from public.app_clients c
    where c.id = target_client_id
      and public.has_any_permission(array['db.view','cases.view','dashboard.view','settlements.view','analytics.view'])
      and (
        public.has_any_permission(array['db.view_all','cases.view_all','dashboard.company_metrics','settlements.view_all','analytics.view_all'])
        or c.data ->> 'assignedStaff' = public.current_staff_name()
      )
  );
$$;
revoke all on function public.can_access_client_id(text) from public;
grant execute on function public.can_access_client_id(text) to authenticated;

drop policy if exists app_clients_active_users on public.app_clients;
drop policy if exists app_clients_select_permissions on public.app_clients;
drop policy if exists app_clients_insert_permissions on public.app_clients;
drop policy if exists app_clients_update_permissions on public.app_clients;
drop policy if exists app_clients_delete_permissions on public.app_clients;
create policy app_clients_select_permissions on public.app_clients for select to authenticated
using (
  public.is_admin_user()
  or (
    public.has_any_permission(array['db.view','cases.view','dashboard.view','settlements.view','analytics.view'])
    and (
      public.has_any_permission(array['db.view_all','cases.view_all','dashboard.company_metrics','settlements.view_all','analytics.view_all'])
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
);
create policy app_clients_insert_permissions on public.app_clients for insert to authenticated
with check (
  public.has_any_permission(array['db.convert','cases.create'])
  and (
    public.has_any_permission(array['db.change_assignee','cases.change_assignee'])
    or data ->> 'assignedStaff' = public.current_staff_name()
  )
);
create policy app_clients_update_permissions on public.app_clients for update to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());
create policy app_clients_delete_permissions on public.app_clients for delete to authenticated
using (public.is_admin_user());

-- 계약
create or replace function public.can_access_case_id(target_case_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_user() or exists (
    select 1 from public.app_cases c
    where c.id = target_case_id
      and public.has_any_permission(array['cases.view','db.view_finance','dashboard.finance','dashboard.installment_calendar','dashboard.schedule_calendar','settlements.view','analytics.view'])
      and (
        public.has_any_permission(array['cases.view_all','db.view_all','dashboard.company_metrics','settlements.view_all','analytics.view_all'])
        or c.data ->> 'assignedStaff' = public.current_staff_name()
      )
  );
$$;
revoke all on function public.can_access_case_id(text) from public;
grant execute on function public.can_access_case_id(text) to authenticated;

drop policy if exists app_cases_active_users on public.app_cases;
drop policy if exists app_cases_select_permissions on public.app_cases;
drop policy if exists app_cases_insert_permissions on public.app_cases;
drop policy if exists app_cases_update_permissions on public.app_cases;
drop policy if exists app_cases_delete_permissions on public.app_cases;
create policy app_cases_select_permissions on public.app_cases for select to authenticated
using (
  public.is_admin_user()
  or (
    public.has_any_permission(array['cases.view','db.view_finance','dashboard.view','settlements.view','analytics.view'])
    and (
      public.has_any_permission(array['cases.view_all','db.view_all','dashboard.company_metrics','settlements.view_all','analytics.view_all'])
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
);
create policy app_cases_insert_permissions on public.app_cases for insert to authenticated
with check (
  public.has_permission('cases.create')
  and (public.has_permission('cases.change_assignee') or data ->> 'assignedStaff' = public.current_staff_name())
);
create policy app_cases_update_permissions on public.app_cases for update to authenticated
using (
  public.is_admin_user()
  or (
    public.has_any_permission(array['cases.manage_installments','cases.send_docs','cases.change_assignee'])
    and (
      public.has_permission('cases.view_all')
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin_user()
    or public.has_permission('cases.change_assignee')
    or data ->> 'assignedStaff' = public.current_staff_name()
  )
);
create policy app_cases_delete_permissions on public.app_cases for delete to authenticated
using (public.is_admin_user());

-- 분납
drop policy if exists app_installments_active_users on public.app_installments;
drop policy if exists app_installments_select_permissions on public.app_installments;
drop policy if exists app_installments_insert_permissions on public.app_installments;
drop policy if exists app_installments_update_permissions on public.app_installments;
drop policy if exists app_installments_delete_permissions on public.app_installments;
create policy app_installments_select_permissions on public.app_installments for select to authenticated
using (public.can_access_case_id(data ->> 'caseId'));
create policy app_installments_insert_permissions on public.app_installments for insert to authenticated
with check (public.has_permission('cases.manage_installments') and public.can_access_case_id(data ->> 'caseId'));
create policy app_installments_update_permissions on public.app_installments for update to authenticated
using (public.has_permission('cases.manage_installments') and public.can_access_case_id(data ->> 'caseId'))
with check (public.has_permission('cases.manage_installments'));
create policy app_installments_delete_permissions on public.app_installments for delete to authenticated
using (public.has_permission('cases.manage_installments') and public.can_access_case_id(data ->> 'caseId'));

-- 법원 일정: 대시보드 일정 권한 + 담당범위
drop policy if exists app_schedule_items_active_users on public.app_schedule_items;
drop policy if exists app_schedule_items_select_permissions on public.app_schedule_items;
create policy app_schedule_items_select_permissions on public.app_schedule_items for select to authenticated
using (
  public.is_admin_user()
  or (
    public.has_permission('dashboard.schedule_calendar')
    and (
      public.has_permission('dashboard.company_metrics')
      or (coalesce(data ->> 'caseId', '') <> '' and public.can_access_case_id(data ->> 'caseId'))
      or (coalesce(data ->> 'clientId', '') <> '' and public.can_access_client_id(data ->> 'clientId'))
    )
  )
);

-- 변경이력: 본인 이력 / 전체 이력 분리
drop policy if exists app_change_logs_active_users on public.app_change_logs;
drop policy if exists app_change_logs_select_permissions on public.app_change_logs;
drop policy if exists app_change_logs_insert_permissions on public.app_change_logs;
create policy app_change_logs_select_permissions on public.app_change_logs for select to authenticated
using (
  public.is_admin_user()
  or (
    public.has_permission('changes.view')
    and (
      public.has_permission('changes.view_all')
      or data ->> 'staff' = public.current_actor_name()
      or data ->> 'staff' = public.current_staff_name()
    )
  )
);
create policy app_change_logs_insert_permissions on public.app_change_logs for insert to authenticated
with check (public.is_active_user());

-- 내부게시판 메뉴는 제거된 상태이므로 일반 직원의 직접 접근도 차단합니다.
drop policy if exists app_board_posts_active_users on public.app_board_posts;
drop policy if exists app_board_posts_select_admin on public.app_board_posts;
drop policy if exists app_board_posts_insert_admin on public.app_board_posts;
drop policy if exists app_board_posts_update_admin on public.app_board_posts;
drop policy if exists app_board_posts_delete_admin on public.app_board_posts;
create policy app_board_posts_select_admin on public.app_board_posts for select to authenticated using (public.is_admin_user());
create policy app_board_posts_insert_admin on public.app_board_posts for insert to authenticated with check (public.is_admin_user());
create policy app_board_posts_update_admin on public.app_board_posts for update to authenticated using (public.is_admin_user()) with check (public.is_admin_user());
create policy app_board_posts_delete_admin on public.app_board_posts for delete to authenticated using (public.is_admin_user());

-- 설정값은 필요한 기능을 가진 계정에만 노출
drop policy if exists app_settings_active_users on public.app_settings;
drop policy if exists app_settings_select_permissions on public.app_settings;
drop policy if exists app_settings_insert_permissions on public.app_settings;
drop policy if exists app_settings_update_permissions on public.app_settings;
create policy app_settings_select_permissions on public.app_settings for select to authenticated
using (
  public.is_admin_user()
  or (
    key = 'settlement_rates'
    and public.has_any_permission(array['settlements.view','settlement_settings.view'])
  )
  or (
    key = 'min_living_cost'
    and public.has_any_permission(array['living.view','db.view_consultation','db.edit_consultation'])
  )
  or (
    key = 'case_documents'
    and public.has_permission('cases.send_docs')
  )
);
create policy app_settings_insert_permissions on public.app_settings for insert to authenticated
with check (
  public.is_admin_user()
  or (key = 'settlement_rates' and public.has_permission('settlement_settings.edit'))
  or (key = 'min_living_cost' and public.has_permission('living.edit'))
  or (key = 'case_documents' and public.has_permission('cases.send_docs'))
);
create policy app_settings_update_permissions on public.app_settings for update to authenticated
using (
  public.is_admin_user()
  or (key = 'settlement_rates' and public.has_permission('settlement_settings.edit'))
  or (key = 'min_living_cost' and public.has_permission('living.edit'))
  or (key = 'case_documents' and public.has_permission('cases.send_docs'))
)
with check (public.is_active_user());

-- profiles 변경을 다른 브라우저의 담당자 버튼/권한에 즉시 반영
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then
  null;
end $$;
