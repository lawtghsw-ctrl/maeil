-- LawPower v28.24 - SMS permission model + RLS alignment
begin;

-- v28.24 도입 전 문자 권한 키가 없던 기존 실무계정은
-- DB관리 권한이 있던 경우 기본 문자 사용(조회/발송/내역) 권한을 이어받습니다.
-- 자동발송/발신번호/문구 설정 권한은 자동 부여하지 않습니다.
update public.profiles
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
  'sms.view', true,
  'sms.send', true,
  'sms.view_history', true
)
where coalesce(is_active, true) = true
  and coalesce(platform_role, 'staff') = 'staff'
  and coalesce((permissions ->> 'db.view')::boolean, false) = true
  and not (coalesce(permissions, '{}'::jsonb) ? 'sms.view');

-- 발신번호: 문자 메뉴 사용자는 조회, 설정관리 권한 보유자만 변경.
drop policy if exists sms_sender_read on public.sms_sender_numbers;
drop policy if exists sms_sender_manage on public.sms_sender_numbers;
create policy sms_sender_read on public.sms_sender_numbers for select to authenticated
using (
  public.is_active_user()
  and (public.is_super_admin() or law_firm_id = public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('sms.view'))
);
create policy sms_sender_manage on public.sms_sender_numbers for all to authenticated
using (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
)
with check (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
);

-- 문구 템플릿: 메뉴 사용자는 발송용으로 조회 가능, 설정관리 권한만 편집.
drop policy if exists sms_templates_read on public.sms_templates;
drop policy if exists sms_templates_manage on public.sms_templates;
create policy sms_templates_read on public.sms_templates for select to authenticated
using (
  public.is_active_user()
  and (public.is_super_admin() or law_firm_id = public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('sms.view'))
);
create policy sms_templates_manage on public.sms_templates for all to authenticated
using (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
)
with check (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
);

-- 로펌 공통 자동발송 설정: 설정관리 권한만 조회/변경.
drop policy if exists sms_auto_read on public.sms_automation_settings;
drop policy if exists sms_auto_manage on public.sms_automation_settings;
create policy sms_auto_read on public.sms_automation_settings for select to authenticated
using (
  public.is_active_user()
  and (public.is_super_admin() or law_firm_id = public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('sms.manage_settings'))
);
create policy sms_auto_manage on public.sms_automation_settings for all to authenticated
using (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
)
with check (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
);

-- 담당자별 자동발송 설정도 동일한 설정관리 권한 적용.
drop policy if exists sms_staff_auto_read on public.sms_staff_automation_settings;
drop policy if exists sms_staff_auto_manage on public.sms_staff_automation_settings;
create policy sms_staff_auto_read on public.sms_staff_automation_settings for select to authenticated
using (
  public.is_active_user()
  and (public.is_super_admin() or law_firm_id = public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('sms.manage_settings'))
);
create policy sms_staff_auto_manage on public.sms_staff_automation_settings for all to authenticated
using (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
)
with check (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
);

-- 발송대기열: 발송내역 권한은 조회, 발송 권한은 신규 등록.
drop policy if exists sms_outbox_read on public.sms_outbox;
drop policy if exists sms_outbox_insert on public.sms_outbox;
drop policy if exists sms_outbox_manage on public.sms_outbox;
create policy sms_outbox_read on public.sms_outbox for select to authenticated
using (
  public.is_active_user()
  and (public.is_super_admin() or law_firm_id = public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('sms.view_history'))
);
create policy sms_outbox_insert on public.sms_outbox for insert to authenticated
with check (
  public.is_active_user()
  and (public.is_super_admin() or law_firm_id = public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('sms.send'))
);
create policy sms_outbox_manage on public.sms_outbox for update to authenticated
using (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
)
with check (
  public.is_super_admin()
  or (
    law_firm_id = public.current_law_firm_id()
    and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
  )
);

-- MMS 이미지: 수기발송 권한 또는 설정관리 권한이 있을 때만 업로드.
drop policy if exists sms_media_read on storage.objects;
drop policy if exists sms_media_insert on storage.objects;
drop policy if exists sms_media_delete on storage.objects;
create policy sms_media_read on storage.objects for select to authenticated
using (
  bucket_id = 'sms-media'
  and public.is_active_user()
  and (public.is_super_admin() or split_part(name,'/',1) = public.current_law_firm_id()::text)
  and (
    public.is_admin_user()
    or public.has_permission('sms.send')
    or public.has_permission('sms.view_history')
    or public.has_permission('sms.manage_settings')
  )
);
create policy sms_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'sms-media'
  and public.is_active_user()
  and (public.is_super_admin() or split_part(name,'/',1) = public.current_law_firm_id()::text)
  and (
    public.is_admin_user()
    or public.has_permission('sms.send')
    or public.has_permission('sms.manage_settings')
  )
);
create policy sms_media_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'sms-media'
  and (
    public.is_super_admin()
    or (
      split_part(name,'/',1) = public.current_law_firm_id()::text
      and (public.is_firm_admin() or public.has_permission('sms.manage_settings'))
    )
  )
);

commit;

select
  count(*) filter (where coalesce((permissions ->> 'sms.view')::boolean, false)) as sms_view_users,
  count(*) filter (where coalesce((permissions ->> 'sms.send')::boolean, false)) as sms_send_users,
  count(*) filter (where coalesce((permissions ->> 'sms.view_history')::boolean, false)) as sms_history_users
from public.profiles
where coalesce(is_active, true) = true;
