-- LawPower v28.25
-- 직원계정 저장 신뢰성 / RLS 정합성 보강
-- 001~016 적용 후 1회 실행.
--
-- 핵심 원인
-- 1) 클라이언트가 기존 행 수정도 UPSERT로 보내면서 UPDATE 권한 외 INSERT 정책까지 검사됨.
--    (클라이언트 v28.25에서 UPDATE 우선 -> 없을 때 INSERT로 분리)
-- 2) db.view_all 직원이 다른 담당자 DB를 조회/수정할 수 있는 UI 권한을 가져도
--    app_leads UPDATE WITH CHECK가 '내 담당'만 허용해 저장이 되돌아갈 수 있었음.
-- 3) 수기 DB 추가는 UI상 초기 담당자를 별도 접수담당자로 둘 수 있는데 INSERT 정책은
--    현재 로그인 직원 본인 담당만 허용해 정상 등록이 막힐 수 있었음.

begin;

-- DB 리드 신규 등록: tenant 격리는 006의 restrictive tenant_guard가 담당합니다.
-- db.create 권한이 있으면 UI/자동배정 로직이 정한 초기 담당자로 등록 가능하게 합니다.
drop policy if exists app_leads_insert_permissions on public.app_leads;
create policy app_leads_insert_permissions on public.app_leads
for insert to authenticated
with check (
  public.is_admin_user()
  or public.has_permission('db.create')
);

-- DB 리드 수정: 화면 권한(canPatchLead)과 DB RLS를 동일하게 맞춥니다.
-- 본인 담당자는 세부 수정권한으로 수정 가능하고, db.view_all 보유자는 다른 담당자 건도
-- 본인이 가진 세부 수정권한 범위에서 저장할 수 있습니다. 실제 변경 필드 검사는
-- enforce_lead_update_permissions() 트리거가 다시 한 번 제한합니다.
drop policy if exists app_leads_update_permissions on public.app_leads;
create policy app_leads_update_permissions on public.app_leads
for update to authenticated
using (
  public.is_admin_user()
  or (
    public.has_any_permission(array[
      'db.edit_basic','db.edit_consultation','db.change_stage','db.change_assignee',
      'db.manage_reservation','db.convert','cases.create'
    ])
    and (
      public.has_permission('db.view_all')
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
)
with check (
  public.is_active_user()
  and (
    public.is_admin_user()
    or (
      public.has_any_permission(array[
        'db.edit_basic','db.edit_consultation','db.change_stage','db.change_assignee',
        'db.manage_reservation','db.convert','cases.create'
      ])
      and (
        public.has_permission('db.view_all')
        or data ->> 'assignedStaff' = public.current_staff_name()
      )
    )
  )
);

-- 고객전환/계약생성 시 '전체 담당자 조회' 권한으로 다른 담당자 DB를 처리하는 경우에도
-- 원래 담당자를 유지한 채 고객/계약을 생성할 수 있게 INSERT 범위를 UI와 맞춥니다.
drop policy if exists app_clients_insert_permissions on public.app_clients;
create policy app_clients_insert_permissions on public.app_clients
for insert to authenticated
with check (
  public.is_admin_user()
  or (
    public.has_any_permission(array['db.convert','cases.create'])
    and (
      public.has_any_permission(array['db.view_all','cases.view_all','db.change_assignee','cases.change_assignee'])
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
);

drop policy if exists app_cases_insert_permissions on public.app_cases;
create policy app_cases_insert_permissions on public.app_cases
for insert to authenticated
with check (
  public.is_admin_user()
  or (
    (
      public.has_permission('cases.create')
      or (
        public.has_permission('db.convert')
        and coalesce(data ->> 'fromLeadId', '') <> ''
        and exists (
          select 1 from public.app_leads l
          where l.id = data ->> 'fromLeadId'
            and (
              public.has_permission('db.view_all')
              or l.data ->> 'assignedStaff' = public.current_staff_name()
            )
        )
      )
    )
    and (
      public.has_any_permission(array['cases.view_all','cases.change_assignee','db.view_all'])
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
);

-- 분납 행의 caseId가 변경되는 비정상 요청도 새 대상 계약 접근권한을 다시 검사합니다.
drop policy if exists app_installments_insert_permissions on public.app_installments;
create policy app_installments_insert_permissions on public.app_installments
for insert to authenticated
with check (
  public.has_permission('cases.manage_installments')
  and public.can_access_case_id(data ->> 'caseId')
);

drop policy if exists app_installments_update_permissions on public.app_installments;
create policy app_installments_update_permissions on public.app_installments
for update to authenticated
using (
  public.has_permission('cases.manage_installments')
  and public.can_access_case_id(data ->> 'caseId')
)
with check (
  public.has_permission('cases.manage_installments')
  and public.can_access_case_id(data ->> 'caseId')
);

commit;

-- 확인용: 아래가 모두 true면 정책 반영 정상.
select
  exists(select 1 from pg_policies where schemaname='public' and tablename='app_leads' and policyname='app_leads_insert_permissions') as lead_insert_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='app_leads' and policyname='app_leads_update_permissions') as lead_update_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='app_clients' and policyname='app_clients_insert_permissions') as client_insert_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='app_cases' and policyname='app_cases_insert_permissions') as case_insert_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='app_installments' and policyname='app_installments_update_permissions') as installment_update_ok;
