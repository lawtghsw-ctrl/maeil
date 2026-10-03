-- LawPower v28.3 BEFORE-MIGRATION DATA SNAPSHOT
-- 006_multi_tenant_platform.sql 실행 전에 1회만 실행하세요.
-- 이 스냅샷은 public 업무데이터 확인/수동복구용입니다. Supabase 프로젝트 전체 백업을 대체하지 않습니다.

create schema if not exists lawpower_v27_backup;

do $$
begin
  if to_regclass('lawpower_v27_backup.profiles') is not null then
    raise exception 'lawpower_v27_backup 스냅샷이 이미 존재합니다. 기존 백업을 확인한 뒤 진행하세요.';
  end if;
end $$;

create table lawpower_v27_backup.profiles as table public.profiles;
create table lawpower_v27_backup.app_leads as table public.app_leads;
create table lawpower_v27_backup.app_clients as table public.app_clients;
create table lawpower_v27_backup.app_cases as table public.app_cases;
create table lawpower_v27_backup.app_installments as table public.app_installments;
create table lawpower_v27_backup.app_schedule_items as table public.app_schedule_items;
create table lawpower_v27_backup.app_board_posts as table public.app_board_posts;
create table lawpower_v27_backup.app_change_logs as table public.app_change_logs;
create table lawpower_v27_backup.app_settings as table public.app_settings;

do $$
begin
  if to_regclass('public.app_lead_imports') is not null then
    execute 'create table lawpower_v27_backup.app_lead_imports as table public.app_lead_imports';
  end if;
end $$;

create table lawpower_v27_backup.snapshot_meta (
  created_at timestamptz not null default now(),
  note text not null
);
insert into lawpower_v27_backup.snapshot_meta(note)
values ('LawPower v27.13 -> v28.3 migration pre-snapshot');

select 'profiles' item, count(*) count from lawpower_v27_backup.profiles
union all select 'app_leads', count(*) from lawpower_v27_backup.app_leads
union all select 'app_clients', count(*) from lawpower_v27_backup.app_clients
union all select 'app_cases', count(*) from lawpower_v27_backup.app_cases
union all select 'app_installments', count(*) from lawpower_v27_backup.app_installments
union all select 'app_schedule_items', count(*) from lawpower_v27_backup.app_schedule_items
union all select 'app_board_posts', count(*) from lawpower_v27_backup.app_board_posts
union all select 'app_change_logs', count(*) from lawpower_v27_backup.app_change_logs
union all select 'app_settings', count(*) from lawpower_v27_backup.app_settings
order by item;
