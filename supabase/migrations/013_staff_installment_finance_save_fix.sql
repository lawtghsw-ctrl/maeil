-- LawPower v28.21
-- 일반 직원 계정에서 계약관리 > 분납관리 저장값이 0으로 되돌아가는 문제 수정
--
-- 원인:
-- 기존 enforce_case_update_permissions()는 cases.manage_installments 권한이 있어도
-- paidAmount만 예외 처리하고 contractAmount/installmentCount/paymentMethod/totalDebt는
-- "이 계약 항목을 수정할 권한이 없습니다."로 차단했습니다.
-- 슈퍼/관리자 계정은 관리자 우회 때문에 정상처럼 보였습니다.
--
-- 수정:
-- 분납관리 권한(cases.manage_installments)이 있으면
-- totalDebt / contractAmount / paidAmount / installmentCount / paymentMethod를 저장할 수 있게 허용.
-- RLS with check도 분납관리 권한 + 접근 가능한 계약이면 저장되도록 보완.

begin;

create or replace function public.enforce_case_update_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  finance_changed boolean;
begin
  if auth.role() = 'service_role' or public.is_admin_user() then
    return new;
  end if;

  if old.data -> 'assignedStaff' is distinct from new.data -> 'assignedStaff'
     and not public.has_permission('cases.change_assignee') then
    raise exception '계약 담당자 변경 권한이 없습니다.';
  end if;

  finance_changed :=
       old.data -> 'totalDebt' is distinct from new.data -> 'totalDebt'
    or old.data -> 'contractAmount' is distinct from new.data -> 'contractAmount'
    or old.data -> 'paidAmount' is distinct from new.data -> 'paidAmount'
    or old.data -> 'installmentCount' is distinct from new.data -> 'installmentCount'
    or old.data -> 'paymentMethod' is distinct from new.data -> 'paymentMethod';

  if finance_changed and not public.has_permission('cases.manage_installments') then
    raise exception '분납/계약금액 수정 권한이 없습니다.';
  end if;

  if old.data -> 'docsSentAt' is distinct from new.data -> 'docsSentAt'
     and not public.has_permission('cases.send_docs') then
    raise exception '서류안내문 전송 권한이 없습니다.';
  end if;

  -- 위에서 각각 권한을 검사한 항목 외의 계약 데이터 변경은 기존대로 차단합니다.
  if (
    old.data - array[
      'assignedStaff',
      'totalDebt',
      'contractAmount',
      'paidAmount',
      'installmentCount',
      'paymentMethod',
      'docsSentAt'
    ]
  ) is distinct from (
    new.data - array[
      'assignedStaff',
      'totalDebt',
      'contractAmount',
      'paidAmount',
      'installmentCount',
      'paymentMethod',
      'docsSentAt'
    ]
  ) then
    raise exception '이 계약 항목을 수정할 권한이 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_cases_permissions on public.app_cases;
create trigger trg_app_cases_permissions
before update on public.app_cases
for each row execute function public.enforce_case_update_permissions();

drop policy if exists app_cases_update_permissions on public.app_cases;
create policy app_cases_update_permissions on public.app_cases
for update to authenticated
using (
  public.is_admin_user()
  or (
    public.has_any_permission(array[
      'cases.manage_installments',
      'cases.send_docs',
      'cases.change_assignee'
    ])
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
    or (
      public.has_permission('cases.manage_installments')
      and (
        public.has_permission('cases.view_all')
        or data ->> 'assignedStaff' = public.current_staff_name()
      )
    )
    or (
      public.has_permission('cases.send_docs')
      and (
        public.has_permission('cases.view_all')
        or data ->> 'assignedStaff' = public.current_staff_name()
      )
    )
  )
);

commit;

-- 확인용: 함수/정책이 존재하면 정상
select
  to_regprocedure('public.enforce_case_update_permissions()') is not null as case_permission_trigger_function_ok,
  exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='app_cases'
      and policyname='app_cases_update_permissions'
  ) as app_cases_update_policy_ok;
