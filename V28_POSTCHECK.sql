-- LawPower v28.3 POST-CHECK (READ ONLY)
-- 006_multi_tenant_platform.sql 실행 직후 확인용입니다.

-- 1) 매일법률사무소 + 10자리 firm_code 확인
select id, firm_code, name, status, is_legacy_default, duplicate_window_days, created_at
from public.law_firms
order by is_legacy_default desc, created_at;

-- 2) 역할/소속 확인: super_admin 1명, 기존 나머지는 매일 소속이어야 합니다.
select p.id, p.email, p.display_name, p.staff_name, p.role, p.platform_role,
       p.law_firm_id, f.name as law_firm_name, p.is_active
from public.profiles p
left join public.law_firms f on f.id=p.law_firm_id
order by case when p.platform_role='super_admin' then 0 else 1 end, p.created_at;

-- 3) 기존 업무 데이터에 law_firm_id 누락이 없어야 합니다.
select 'app_leads' item, count(*) filter(where law_firm_id is null) missing_firm from public.app_leads
union all select 'app_clients', count(*) filter(where law_firm_id is null) from public.app_clients
union all select 'app_cases', count(*) filter(where law_firm_id is null) from public.app_cases
union all select 'app_installments', count(*) filter(where law_firm_id is null) from public.app_installments
union all select 'app_schedule_items', count(*) filter(where law_firm_id is null) from public.app_schedule_items
union all select 'app_board_posts', count(*) filter(where law_firm_id is null) from public.app_board_posts
union all select 'app_change_logs', count(*) filter(where law_firm_id is null) from public.app_change_logs;

-- 4) 매일 기존 데이터가 모두 기본 로펌으로 귀속됐는지 확인
select f.name,
       (select count(*) from public.app_leads l where l.law_firm_id=f.id) lead_count,
       (select count(*) from public.app_clients c where c.law_firm_id=f.id) client_count,
       (select count(*) from public.app_cases c where c.law_firm_id=f.id) case_count,
       (select count(*) from public.app_installments i where i.law_firm_id=f.id) installment_count
from public.law_firms f
where f.is_legacy_default=true;

-- 5) 로펌별 설정 3종이 생성되어 있어야 합니다.
select f.name, s.key
from public.law_firms f
left join public.firm_settings s on s.law_firm_id=f.id
order by f.name, s.key;

-- 6) 자동 Meta 규칙은 기본 OFF여야 합니다.
select f.name, r.trigger_type, r.trigger_value, r.event_name, r.enabled
from public.firm_meta_event_rules r
join public.law_firms f on f.id=r.law_firm_id
order by f.name, r.created_at;


-- 7) v28.3 운영보강 테이블 확인
select
  to_regclass('public.platform_audit_logs') as platform_audit_logs,
  to_regclass('public.public_rate_limits') as public_rate_limits,
  to_regclass('public.lead_supply_ledger') as lead_supply_ledger,
  to_regclass('public.meta_event_queue') as meta_event_queue;

-- 8) 공급원장: 기존 migration backfill은 과금 제외여야 합니다.
select origin, billable, count(*)
from public.lead_supply_ledger
group by origin, billable
order by origin, billable;

-- 9) 로펌 과금/중복 기본값 확인
select firm_code, name, duplicate_window_days, billing_type, lead_unit_price
from public.law_firms
order by is_legacy_default desc, created_at;

-- 10) 적용 전 스냅샷 존재 확인
select to_regnamespace('lawpower_v27_backup') as backup_schema;
