-- LawPower v28.22 - SMS Center foundation (Aligo-ready, API not connected yet)
begin;

create table if not exists public.sms_sender_numbers (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  staff_name text not null,
  label text not null default '',
  phone text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  is_registered boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sms_sender_numbers_firm_phone_uq on public.sms_sender_numbers(law_firm_id, phone);
create unique index if not exists sms_sender_numbers_one_default on public.sms_sender_numbers(law_firm_id) where is_default = true;

create table if not exists public.sms_templates (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  name text not null,
  category text not null default '일반',
  body text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sms_automation_settings (
  law_firm_id uuid primary key references public.law_firms(id) on delete cascade,
  new_lead_enabled boolean not null default true,
  absence_enabled boolean not null default true,
  new_lead_template text not null default '[로파워] {고객명}님, 상담 접수가 확인되었습니다. 담당자 {담당자}이(가) 곧 연락드리겠습니다.',
  absence_template text not null default '[로파워] {고객명}님, 상담 관련하여 연락드렸으나 통화가 연결되지 않아 문자드립니다. 확인 후 편하실 때 연락 부탁드립니다.',
  duplicate_guard_minutes integer not null default 5 check (duplicate_guard_minutes between 0 and 60),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  source text not null default 'manual' check (source in ('manual','file','new_lead','absence')),
  auto_kind text check (auto_kind is null or auto_kind in ('new_lead','absence')),
  lead_id text references public.app_leads(id) on delete set null,
  sender_number_id uuid references public.sms_sender_numbers(id) on delete set null,
  sender_number text not null,
  receiver_number text not null,
  receiver_name text,
  title text,
  message text not null,
  msg_type text not null default 'SMS' check (msg_type in ('SMS','LMS','MMS')),
  image_paths jsonb not null default '[]'::jsonb,
  reserved_at timestamptz,
  status text not null default 'pending_api' check (status in ('pending_api','queued','sending','sent','failed','cancelled')),
  provider_message_id text,
  provider_result jsonb,
  error_message text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists sms_outbox_firm_created_idx on public.sms_outbox(law_firm_id, created_at desc);
create index if not exists sms_outbox_status_idx on public.sms_outbox(status, created_at);
create unique index if not exists sms_outbox_new_lead_once_uq on public.sms_outbox(law_firm_id, lead_id, auto_kind)
  where auto_kind = 'new_lead';

alter table public.sms_sender_numbers enable row level security;
alter table public.sms_templates enable row level security;
alter table public.sms_automation_settings enable row level security;
alter table public.sms_outbox enable row level security;

drop policy if exists sms_sender_read on public.sms_sender_numbers;
drop policy if exists sms_sender_manage on public.sms_sender_numbers;
create policy sms_sender_read on public.sms_sender_numbers for select to authenticated
using (public.is_active_user() and (public.is_super_admin() or law_firm_id = public.current_law_firm_id()));
create policy sms_sender_manage on public.sms_sender_numbers for all to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()))
with check (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()));

drop policy if exists sms_templates_read on public.sms_templates;
drop policy if exists sms_templates_manage on public.sms_templates;
create policy sms_templates_read on public.sms_templates for select to authenticated
using (public.is_active_user() and (public.is_super_admin() or law_firm_id = public.current_law_firm_id()));
create policy sms_templates_manage on public.sms_templates for all to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()))
with check (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()));

drop policy if exists sms_auto_read on public.sms_automation_settings;
drop policy if exists sms_auto_manage on public.sms_automation_settings;
create policy sms_auto_read on public.sms_automation_settings for select to authenticated
using (public.is_active_user() and (public.is_super_admin() or law_firm_id = public.current_law_firm_id()));
create policy sms_auto_manage on public.sms_automation_settings for all to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()))
with check (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()));

drop policy if exists sms_outbox_read on public.sms_outbox;
drop policy if exists sms_outbox_insert on public.sms_outbox;
drop policy if exists sms_outbox_manage on public.sms_outbox;
create policy sms_outbox_read on public.sms_outbox for select to authenticated
using (public.is_active_user() and (public.is_super_admin() or law_firm_id = public.current_law_firm_id()));
create policy sms_outbox_insert on public.sms_outbox for insert to authenticated
with check (
  public.is_active_user()
  and (public.is_super_admin() or law_firm_id = public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('db.view'))
);
create policy sms_outbox_manage on public.sms_outbox for update to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()))
with check (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()));

-- 각 로펌 기본 자동발송 설정 생성
insert into public.sms_automation_settings(law_firm_id)
select id from public.law_firms
on conflict (law_firm_id) do nothing;

-- MMS 이미지 보관 버킷. API 연결 후 image_paths를 읽어 알리고 multipart image1~3으로 전송.
insert into storage.buckets(id, name, public)
values ('sms-media','sms-media',false)
on conflict (id) do nothing;

drop policy if exists sms_media_read on storage.objects;
drop policy if exists sms_media_insert on storage.objects;
drop policy if exists sms_media_delete on storage.objects;
create policy sms_media_read on storage.objects for select to authenticated
using (
  bucket_id='sms-media'
  and public.is_active_user()
  and (public.is_super_admin() or split_part(name,'/',1)=public.current_law_firm_id()::text)
);
create policy sms_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id='sms-media'
  and public.is_active_user()
  and (public.is_super_admin() or split_part(name,'/',1)=public.current_law_firm_id()::text)
);
create policy sms_media_delete on storage.objects for delete to authenticated
using (
  bucket_id='sms-media'
  and (public.is_super_admin() or (public.is_firm_admin() and split_part(name,'/',1)=public.current_law_firm_id()::text))
);

create or replace function public.sms_apply_vars(p_template text, p_name text, p_staff text)
returns text
language sql immutable
as $$
  select replace(replace(coalesce(p_template,''), '{고객명}', coalesce(nullif(p_name,''),'고객')), '{담당자}', coalesce(nullif(p_staff,''),'담당자'));
$$;

create or replace function public.enqueue_lead_auto_sms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.sms_automation_settings%rowtype;
  sender public.sms_sender_numbers%rowtype;
  staff_name text;
  customer_name text;
  customer_phone text;
  old_log jsonb;
  new_log jsonb;
  old_len integer := 0;
  new_len integer := 0;
  last_entry jsonb;
  duplicate_minutes integer;
begin
  if new.law_firm_id is null then return new; end if;

  select * into cfg from public.sms_automation_settings where law_firm_id=new.law_firm_id;
  if not found then
    insert into public.sms_automation_settings(law_firm_id) values(new.law_firm_id)
    on conflict do nothing;
    select * into cfg from public.sms_automation_settings where law_firm_id=new.law_firm_id;
  end if;

  staff_name := coalesce(nullif(new.data->>'assignedStaff',''),'담당자');
  customer_name := coalesce(nullif(new.data->>'name',''),'고객');
  customer_phone := regexp_replace(coalesce(new.data->>'phone',''), '\D','','g');
  if length(customer_phone) < 9 then return new; end if;

  select * into sender
  from public.sms_sender_numbers
  where law_firm_id=new.law_firm_id and is_active=true and staff_name=staff_name
  order by is_default desc, created_at asc limit 1;

  if not found then
    select * into sender from public.sms_sender_numbers
    where law_firm_id=new.law_firm_id and is_active=true
    order by is_default desc, created_at asc limit 1;
  end if;
  if not found then return new; end if;

  -- 신규 DB: INSERT 시 1회. import 경로와 수기등록 모두 동일하게 적용.
  if tg_op='INSERT' and cfg.new_lead_enabled then
    insert into public.sms_outbox(
      law_firm_id, source, auto_kind, lead_id, sender_number_id, sender_number,
      receiver_number, receiver_name, message, msg_type, status
    ) values (
      new.law_firm_id, 'new_lead', 'new_lead', new.id, sender.id, sender.phone,
      customer_phone, customer_name, public.sms_apply_vars(cfg.new_lead_template,customer_name,staff_name),
      case when length(public.sms_apply_vars(cfg.new_lead_template,customer_name,staff_name)) > 45 then 'LMS' else 'SMS' end,
      'pending_api'
    ) on conflict do nothing;
    return new;
  end if;

  -- 부재중: 상담일지 memoLog에 새 "부재중" 태그가 추가될 때 감지.
  if tg_op='UPDATE' and cfg.absence_enabled then
    old_log := coalesce(old.data#>'{consultation,memoLog}','[]'::jsonb);
    new_log := coalesce(new.data#>'{consultation,memoLog}','[]'::jsonb);
    if jsonb_typeof(old_log)='array' then old_len := jsonb_array_length(old_log); end if;
    if jsonb_typeof(new_log)='array' then new_len := jsonb_array_length(new_log); end if;

    -- 상담일지의 [부재중] 버튼 또는 진행단계를 [부재]로 변경한 경우 모두 감지합니다.
    if (
      (new_len > old_len and new_len > 0 and coalesce((new_log -> (new_len - 1))->>'tag','')='부재중')
      or (
        coalesce(new.data->>'detailStage','')='부재'
        and coalesce(old.data->>'detailStage','') is distinct from '부재'
      )
      or (
        coalesce(new.data->>'status','')='부재중'
        and coalesce(old.data->>'status','') is distinct from '부재중'
      )
    ) then
      duplicate_minutes := greatest(0, least(60, coalesce(cfg.duplicate_guard_minutes,5)));
      if duplicate_minutes = 0 or not exists(
        select 1 from public.sms_outbox o
        where o.law_firm_id=new.law_firm_id and o.lead_id=new.id and o.auto_kind='absence'
          and o.created_at >= now() - make_interval(mins => duplicate_minutes)
      ) then
        insert into public.sms_outbox(
          law_firm_id, source, auto_kind, lead_id, sender_number_id, sender_number,
          receiver_number, receiver_name, message, msg_type, status
        ) values (
          new.law_firm_id, 'absence', 'absence', new.id, sender.id, sender.phone,
          customer_phone, customer_name, public.sms_apply_vars(cfg.absence_template,customer_name,staff_name),
          case when length(public.sms_apply_vars(cfg.absence_template,customer_name,staff_name)) > 45 then 'LMS' else 'SMS' end,
          'pending_api'
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_leads_auto_sms on public.app_leads;
create trigger trg_app_leads_auto_sms
after insert or update of data on public.app_leads
for each row execute function public.enqueue_lead_auto_sms();

commit;

select
  to_regclass('public.sms_outbox') is not null as sms_outbox_ok,
  to_regclass('public.sms_sender_numbers') is not null as sms_sender_numbers_ok,
  exists(select 1 from storage.buckets where id='sms-media') as sms_media_bucket_ok,
  exists(select 1 from pg_trigger where tgname='trg_app_leads_auto_sms' and not tgisinternal) as auto_sms_trigger_ok;
