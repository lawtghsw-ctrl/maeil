-- LawPower v28.23 - salesperson-specific SMS automation + MMS images
begin;

create table if not exists public.sms_staff_automation_settings (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  staff_name text not null,
  sender_number_id uuid references public.sms_sender_numbers(id) on delete set null,
  new_lead_enabled boolean not null default true,
  absence_enabled boolean not null default true,
  new_lead_template text not null default '[로파워] {고객명}님, 상담 접수가 확인되었습니다. 담당자 {담당자}이(가) 곧 연락드리겠습니다.',
  absence_template text not null default '[로파워] {고객명}님, 상담 관련하여 연락드렸으나 통화가 연결되지 않아 문자드립니다. 확인 후 편하실 때 연락 부탁드립니다.',
  new_lead_image_paths jsonb not null default '[]'::jsonb,
  absence_image_paths jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_staff_auto_firm_staff_uq unique (law_firm_id, staff_name),
  constraint sms_staff_auto_new_images_array check (jsonb_typeof(new_lead_image_paths) = 'array'),
  constraint sms_staff_auto_absence_images_array check (jsonb_typeof(absence_image_paths) = 'array')
);

create index if not exists sms_staff_auto_firm_staff_idx
  on public.sms_staff_automation_settings(law_firm_id, staff_name);

alter table public.sms_staff_automation_settings enable row level security;

drop policy if exists sms_staff_auto_read on public.sms_staff_automation_settings;
drop policy if exists sms_staff_auto_manage on public.sms_staff_automation_settings;
create policy sms_staff_auto_read on public.sms_staff_automation_settings for select to authenticated
using (public.is_active_user() and (public.is_super_admin() or law_firm_id = public.current_law_firm_id()));
create policy sms_staff_auto_manage on public.sms_staff_automation_settings for all to authenticated
using (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()))
with check (public.is_super_admin() or (public.is_firm_admin() and law_firm_id = public.current_law_firm_id()));

create or replace function public.enqueue_lead_auto_sms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.sms_automation_settings%rowtype;
  staff_cfg public.sms_staff_automation_settings%rowtype;
  sender public.sms_sender_numbers%rowtype;
  staff_name text;
  customer_name text;
  customer_phone text;
  old_log jsonb;
  new_log jsonb;
  old_len integer := 0;
  new_len integer := 0;
  duplicate_minutes integer;
  has_staff_cfg boolean := false;
  new_enabled boolean;
  absence_enabled boolean;
  new_template text;
  absence_template text;
  new_images jsonb := '[]'::jsonb;
  absence_images jsonb := '[]'::jsonb;
  rendered text;
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

  select * into staff_cfg
  from public.sms_staff_automation_settings
  where law_firm_id=new.law_firm_id and staff_name=staff_name
  limit 1;
  has_staff_cfg := found;

  new_enabled := case when has_staff_cfg then staff_cfg.new_lead_enabled else cfg.new_lead_enabled end;
  absence_enabled := case when has_staff_cfg then staff_cfg.absence_enabled else cfg.absence_enabled end;
  new_template := case when has_staff_cfg then staff_cfg.new_lead_template else cfg.new_lead_template end;
  absence_template := case when has_staff_cfg then staff_cfg.absence_template else cfg.absence_template end;
  new_images := case when has_staff_cfg then coalesce(staff_cfg.new_lead_image_paths,'[]'::jsonb) else '[]'::jsonb end;
  absence_images := case when has_staff_cfg then coalesce(staff_cfg.absence_image_paths,'[]'::jsonb) else '[]'::jsonb end;

  -- 영업자별 설정에서 발신번호를 직접 지정한 경우 최우선 사용.
  if has_staff_cfg and staff_cfg.sender_number_id is not null then
    select * into sender from public.sms_sender_numbers
    where id=staff_cfg.sender_number_id and law_firm_id=new.law_firm_id and is_active=true
    limit 1;
  end if;

  -- 별도 지정이 없으면 담당자 이름에 매핑된 발신번호 사용.
  if sender.id is null then
    select * into sender
    from public.sms_sender_numbers
    where law_firm_id=new.law_firm_id and is_active=true and staff_name=staff_name
    order by is_default desc, created_at asc limit 1;
  end if;

  -- 담당자 번호도 없으면 로펌 기본 발신번호 사용.
  if sender.id is null then
    select * into sender from public.sms_sender_numbers
    where law_firm_id=new.law_firm_id and is_active=true
    order by is_default desc, created_at asc limit 1;
  end if;
  if sender.id is null then return new; end if;

  if tg_op='INSERT' and new_enabled then
    rendered := public.sms_apply_vars(new_template,customer_name,staff_name);
    insert into public.sms_outbox(
      law_firm_id, source, auto_kind, lead_id, sender_number_id, sender_number,
      receiver_number, receiver_name, message, msg_type, image_paths, status
    ) values (
      new.law_firm_id, 'new_lead', 'new_lead', new.id, sender.id, sender.phone,
      customer_phone, customer_name, rendered,
      case when jsonb_array_length(new_images) > 0 then 'MMS' when length(rendered) > 45 then 'LMS' else 'SMS' end,
      new_images, 'pending_api'
    ) on conflict do nothing;
    return new;
  end if;

  if tg_op='UPDATE' and absence_enabled then
    old_log := coalesce(old.data#>'{consultation,memoLog}','[]'::jsonb);
    new_log := coalesce(new.data#>'{consultation,memoLog}','[]'::jsonb);
    if jsonb_typeof(old_log)='array' then old_len := jsonb_array_length(old_log); end if;
    if jsonb_typeof(new_log)='array' then new_len := jsonb_array_length(new_log); end if;

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
        rendered := public.sms_apply_vars(absence_template,customer_name,staff_name);
        insert into public.sms_outbox(
          law_firm_id, source, auto_kind, lead_id, sender_number_id, sender_number,
          receiver_number, receiver_name, message, msg_type, image_paths, status
        ) values (
          new.law_firm_id, 'absence', 'absence', new.id, sender.id, sender.phone,
          customer_phone, customer_name, rendered,
          case when jsonb_array_length(absence_images) > 0 then 'MMS' when length(rendered) > 45 then 'LMS' else 'SMS' end,
          absence_images, 'pending_api'
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- 함수 교체 후 트리거도 명시적으로 재연결.
drop trigger if exists trg_app_leads_auto_sms on public.app_leads;
create trigger trg_app_leads_auto_sms
after insert or update of data on public.app_leads
for each row execute function public.enqueue_lead_auto_sms();

commit;

select
  to_regclass('public.sms_staff_automation_settings') is not null as staff_auto_settings_ok,
  exists(select 1 from pg_trigger where tgname='trg_app_leads_auto_sms' and not tgisinternal) as auto_sms_trigger_ok;
