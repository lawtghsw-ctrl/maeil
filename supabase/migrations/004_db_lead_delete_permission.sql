-- LawPower v27.3
-- DB관리 고객정보 삭제 권한
-- 001~003 적용 후 Supabase SQL Editor에서 1회 실행하세요.

-- permissions jsonb는 자유 키 구조이므로 컬럼 추가는 필요하지 않습니다.
-- admin은 항상 삭제 가능하고, 직원은 직원계정관리에서 db.delete 권한을 명시적으로 받은 경우에만
-- 본인 담당 DB(또는 db.view_all 권한이 있는 경우 조회 가능한 DB)를 삭제할 수 있습니다.

drop policy if exists app_leads_delete_permissions on public.app_leads;
create policy app_leads_delete_permissions on public.app_leads
for delete to authenticated
using (
  public.is_admin_user()
  or (
    public.has_permission('db.delete')
    and (
      public.has_permission('db.view_all')
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
);
