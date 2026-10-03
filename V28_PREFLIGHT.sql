-- LawPower v28.3 PRE-FLIGHT (READ ONLY)
-- 006_multi_tenant_platform.sql 실행 전에 Supabase SQL Editor에서 먼저 실행하세요.
-- 이 파일은 데이터를 수정하지 않습니다.

select 'auth_users' as item, count(*)::bigint as count from auth.users
union all select 'profiles', count(*) from public.profiles
union all select 'app_leads', count(*) from public.app_leads
union all select 'app_clients', count(*) from public.app_clients
union all select 'app_cases', count(*) from public.app_cases
union all select 'app_installments', count(*) from public.app_installments
union all select 'app_schedule_items', count(*) from public.app_schedule_items
union all select 'app_board_posts', count(*) from public.app_board_posts
union all select 'app_change_logs', count(*) from public.app_change_logs
order by item;

-- 기존 관리자/직원 확인
select id, email, display_name, staff_name, role, is_active, is_work_staff, created_at
from public.profiles
order by created_at, id;

-- v28 적용 전 필요한 기존 테이블 존재 여부
select
  to_regclass('public.profiles') as profiles,
  to_regclass('public.app_leads') as app_leads,
  to_regclass('public.app_clients') as app_clients,
  to_regclass('public.app_cases') as app_cases,
  to_regclass('public.app_installments') as app_installments,
  to_regclass('public.app_lead_imports') as app_lead_imports;

-- 기존 DB 중 ID/JSON 필수값 이상 여부
select
  count(*) filter (where id is null or trim(id)='') as bad_id,
  count(*) filter (where data is null) as bad_data,
  count(*) filter (where coalesce(trim(data->>'name'),'')='') as missing_name,
  count(*) filter (where coalesce(trim(data->>'phone'),'')='') as missing_phone
from public.app_leads;

-- 반드시 최소 1개의 활성 관리자 계정이 있어야 합니다.
select count(*) as active_admin_count
from public.profiles
where role='admin' and is_active=true;


-- v28.3 적용 전 백업 스키마가 아직 없어야 정상입니다. 이미 있다면 이전 시도 여부를 먼저 확인하세요.
select to_regnamespace('lawpower_v27_backup') as existing_backup_schema;
