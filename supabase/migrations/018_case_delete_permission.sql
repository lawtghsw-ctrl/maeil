-- LawPower v28.26
-- 계약관리 삭제 권한 + 안전한 연관 데이터 삭제
-- 001~017 적용 후 1회 실행.

begin;

-- 직원계정관리에서 cases.delete 권한을 받은 직원은 자신의 계약을 삭제할 수 있고,
-- cases.view_all까지 있으면 조회 가능한 다른 담당자 계약도 삭제할 수 있습니다.
drop policy if exists app_cases_delete_permissions on public.app_cases;
create policy app_cases_delete_permissions on public.app_cases
for delete to authenticated
using (
  public.is_admin_user()
  or (
    public.has_permission('cases.delete')
    and (
      public.has_permission('cases.view_all')
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
);

-- 계약 삭제 RPC가 원본 DB의 convertedCaseId를 비울 때만 cases.delete 권한으로 허용합니다.
-- 그 외 DB 필드 변경 권한은 기존 세부권한 검사를 그대로 유지합니다.
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
     and not (
       public.has_any_permission(array['db.convert','cases.create'])
       or (
         public.has_permission('cases.delete')
         and old.data ->> 'convertedCaseId' is not null
         and new.data ->> 'convertedCaseId' is null
       )
     ) then
    raise exception '계약 연결 변경 권한이 없습니다.';
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

-- 계약 하나를 삭제할 때 연결된 분납/계약일정까지 한 트랜잭션으로 정리합니다.
-- 고객정보와 원본 DB 자체는 보존하며, 원본 DB의 convertedCaseId만 비워 재전환이 가능하게 합니다.
create or replace function public.delete_case_with_relations(target_case_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_firm_id uuid;
  target_staff text;
begin
  if not public.is_active_user() then
    raise exception '비활성 계정은 계약을 삭제할 수 없습니다.';
  end if;

  select law_firm_id, data ->> 'assignedStaff'
    into target_firm_id, target_staff
  from public.app_cases
  where id = target_case_id;

  if target_firm_id is null then
    raise exception '삭제할 계약을 찾지 못했습니다.';
  end if;

  if not public.is_super_admin() and target_firm_id is distinct from public.current_law_firm_id() then
    raise exception '다른 로펌의 계약은 삭제할 수 없습니다.';
  end if;

  if not public.is_admin_user() and not (
    public.has_permission('cases.delete')
    and (
      public.has_permission('cases.view_all')
      or target_staff = public.current_staff_name()
    )
  ) then
    raise exception '계약 삭제 권한이 없습니다.';
  end if;

  delete from public.app_installments
   where law_firm_id = target_firm_id
     and data ->> 'caseId' = target_case_id;

  delete from public.app_schedule_items
   where law_firm_id = target_firm_id
     and data ->> 'caseId' = target_case_id;

  update public.app_leads
     set data = data - 'convertedCaseId',
         updated_at = now()
   where law_firm_id = target_firm_id
     and data ->> 'convertedCaseId' = target_case_id;

  delete from public.app_cases
   where id = target_case_id
     and law_firm_id = target_firm_id;
end;
$$;

revoke all on function public.delete_case_with_relations(text) from public;
grant execute on function public.delete_case_with_relations(text) to authenticated;

commit;

select
  to_regprocedure('public.delete_case_with_relations(text)') is not null as delete_case_rpc_ok,
  exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='app_cases' and policyname='app_cases_delete_permissions'
  ) as case_delete_policy_ok,
  to_regprocedure('public.enforce_lead_update_permissions()') is not null as lead_permission_trigger_ok;
