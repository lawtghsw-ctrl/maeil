-- 로파워 실사용 전환용 초기 스키마
-- 현재 단계에서는 활성화된 계정이 공통 업무권한을 갖습니다.
-- 첫 번째 계정은 최종관리자이며, 직원별 세부 권한은 추후 profiles.role / permission 정책으로 확장합니다.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '사용자',
  role text not null default 'staff' check (role in ('admin', 'staff')),
  staff_name text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  first_user boolean;
begin
  select not exists(select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, display_name, role, staff_name, is_active)
  values (
    new.id,
    new.email,
    case when first_user then '최종관리자' else coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, '사용자'), '@', 1)) end,
    case when first_user then 'admin' else 'staff' end,
    nullif(new.raw_user_meta_data ->> 'staff_name', ''),
    first_user
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 마이그레이션 전에 이미 Auth 사용자를 만든 경우도 profiles에 동기화합니다.
with ranked_users as (
  select id, email, raw_user_meta_data, row_number() over (order by created_at, id) as rn
  from auth.users
)
insert into public.profiles (id, email, display_name, role, staff_name, is_active)
select
  id,
  email,
  case when rn = 1 then '최종관리자' else coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(email, '사용자'), '@', 1)) end,
  case when rn = 1 then 'admin' else 'staff' end,
  nullif(raw_user_meta_data ->> 'staff_name', ''),
  rn = 1
from ranked_users
on conflict (id) do nothing;

-- 이미 Auth 사용자가 있던 프로젝트에 적용해도 가장 오래된 계정 1개는 반드시 최종관리자로 보정합니다.
with first_user as (
  select id from auth.users order by created_at, id limit 1
)
update public.profiles p
set role = 'admin', display_name = '최종관리자', is_active = true, updated_at = now()
from first_user f
where p.id = f.id;

-- 기존 프론트 타입을 손실 없이 저장하기 위해 최상위 업무 엔티티는 data JSONB를 사용합니다.
-- 검색/통계 성능이 필요한 필드는 추후 generated column 또는 정규 컬럼으로 단계적으로 분리할 수 있습니다.
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_leads',
    'app_clients',
    'app_cases',
    'app_installments',
    'app_schedule_items',
    'app_board_posts',
    'app_change_logs'
  ] loop
    execute format($f$
      create table if not exists public.%I (
        id text primary key,
        data jsonb not null,
        created_by uuid default auth.uid() references auth.users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $f$, t);

    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', 'trg_' || t || '_updated_at', t);
  end loop;
end $$;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row execute function public.touch_updated_at();

-- 인증된 사용자만 접근 가능. 직원별 세부 권한은 추후 여기의 policy를 역할 기반으로 교체합니다.
alter table public.profiles enable row level security;
alter table public.app_leads enable row level security;
alter table public.app_clients enable row level security;
alter table public.app_cases enable row level security;
alter table public.app_installments enable row level security;
alter table public.app_schedule_items enable row level security;
alter table public.app_board_posts enable row level security;
alter table public.app_change_logs enable row level security;
alter table public.app_settings enable row level security;

-- 현재는 직원별 세부 권한을 나누지 않지만, "활성화된 계정"만 업무 데이터에 접근하게 합니다.
-- 첫 번째 Auth 사용자는 최종관리자 + 활성 계정으로 자동 생성되고, 이후 계정은 기본 비활성입니다.
-- 직원계정/권한 화면을 만들기 전까지는 Supabase Table Editor에서 profiles.is_active=true로 직접 승인할 수 있습니다.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.is_active = true
  );
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.is_active = true and p.role = 'admin'
  );
$$;

revoke all on function public.is_active_user() from public;
revoke all on function public.is_admin_user() from public;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin_user() to authenticated;

-- 본인 프로필은 로그인만 되어도 읽을 수 있어 비활성 여부를 화면에서 판별할 수 있습니다.
-- 최종관리자는 추후 직원계정 관리 화면을 붙일 수 있도록 전체 프로필 조회가 가능합니다.
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin_user());
drop policy if exists profiles_update_self on public.profiles;

-- 업무 테이블은 직원별 세부 권한 도입 전까지 "활성 사용자 공통 CRUD"입니다.
-- 따라서 직원 계정을 만들기 전 현재는 최종관리자 1계정만 활성화해서 쓰는 것이 안전합니다.
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_leads',
    'app_clients',
    'app_cases',
    'app_installments',
    'app_schedule_items',
    'app_board_posts',
    'app_change_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_all_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_active_users', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_active_user()) with check (public.is_active_user())', t || '_active_users', t);
  end loop;
end $$;

drop policy if exists app_settings_all_authenticated on public.app_settings;
drop policy if exists app_settings_active_users on public.app_settings;
create policy app_settings_active_users on public.app_settings for all to authenticated using (public.is_active_user()) with check (public.is_active_user());

-- 기본 운영 설정값. 고객/DB/계약 더미데이터는 삽입하지 않습니다.
insert into public.app_settings (key, value)
values
  (
    'min_living_cost',
    '{"sizes":{"1":1538543,"1.5":2029059,"2":2519575,"2.5":2867498,"3":3215422,"4":3896843},"extraPerPerson":0}'::jsonb
  ),
  (
    'settlement_rates',
    '{
      "박형원":{"단순분납":100,"로피분납":90,"신카할부완납":85,"캐피탈분납":80},
      "강이삭":{"단순분납":100,"로피분납":90,"신카할부완납":85,"캐피탈분납":80},
      "신홍규":{"단순분납":100,"로피분납":90,"신카할부완납":85,"캐피탈분납":80},
      "이중호":{"단순분납":100,"로피분납":90,"신카할부완납":85,"캐피탈분납":80}
    }'::jsonb
  ),
  ('case_documents', '{}'::jsonb)
on conflict (key) do nothing;

-- Realtime: 여러 직원이 동시에 사용할 때 변경사항을 자동 반영합니다.
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_leads',
    'app_clients',
    'app_cases',
    'app_installments',
    'app_schedule_items',
    'app_board_posts',
    'app_change_logs',
    'app_settings'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;
