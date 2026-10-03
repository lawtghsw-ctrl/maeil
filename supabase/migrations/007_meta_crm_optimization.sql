-- LawPower v28.6
-- Meta Conversions API for CRM / Conversion Leads optimization hardening
--
-- 목적
-- 1) Meta Queue가 생성된 "그 순간"의 CRM 상태/진행단계를 스냅샷으로 보존
-- 2) 전송 지연 중 DB 상태가 바뀌어도 이전 이벤트 의미가 변하지 않도록 함
-- 3) 신규 로펌의 기본 Meta 규칙을 CRM Lead 이벤트 구조에 맞춰 준비
--
-- 기존 데이터 삭제 없음 / 기존 Queue 이벤트 유지

begin;

alter table public.meta_event_queue
  add column if not exists crm_status text,
  add column if not exists crm_stage text,
  add column if not exists event_time timestamptz;

update public.meta_event_queue
set event_time = coalesce(event_time, created_at)
where event_time is null;

alter table public.meta_event_queue
  alter column event_time set default now();

-- 기존 v28 기본규칙 중 아직 활성화하지 않은 3개만 새 CRM 방식으로 정리합니다.
-- 사용자가 직접 활성화/수정한 규칙은 건드리지 않습니다.
delete from public.firm_meta_event_rules
where enabled = false
  and (
    (trigger_type='detail_stage' and trigger_value='예약' and event_name='Schedule')
    or (trigger_type='detail_stage' and trigger_value='상담' and event_name='Contact')
    or (trigger_type='status' and trigger_value='수임전환' and event_name='CompleteRegistration')
  );

-- 추천 규칙. 처음에는 모두 OFF.
-- 실제 Meta Test Events 확인 후 필요한 단계만 켭니다.
insert into public.firm_meta_event_rules(
  law_firm_id, trigger_type, trigger_value, event_name, enabled
)
select id, 'detail_stage', '상담', 'Lead', false
from public.law_firms
on conflict do nothing;

insert into public.firm_meta_event_rules(
  law_firm_id, trigger_type, trigger_value, event_name, enabled
)
select id, 'detail_stage', '착수금 안내', 'Lead', false
from public.law_firms
on conflict do nothing;

insert into public.firm_meta_event_rules(
  law_firm_id, trigger_type, trigger_value, event_name, enabled
)
select id, 'status', '수임전환', 'Lead', false
from public.law_firms
on conflict do nothing;

-- 앞으로 새로 생성하는 로펌도 동일한 기본 규칙을 가집니다.
create or replace function public.initialize_firm_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.firm_settings(law_firm_id,key,value) values
    (new.id,'settlement_rates','{}'::jsonb),
    (new.id,'case_documents','{}'::jsonb),
    (new.id,'min_living_cost','{"sizes":{"1":1538543,"1.5":2029059,"2":2519575,"2.5":2867498,"3":3215422,"4":3896843},"extraPerPerson":0}'::jsonb)
  on conflict do nothing;

  insert into public.firm_meta_event_rules(
    law_firm_id, trigger_type, trigger_value, event_name, enabled
  ) values
    (new.id,'detail_stage','상담','Lead',false),
    (new.id,'detail_stage','착수금 안내','Lead',false),
    (new.id,'status','수임전환','Lead',false)
  on conflict do nothing;

  return new;
end;
$$;

-- Queue 생성 시점 상태/단계/시간을 보존합니다.
create or replace function public.enqueue_meta_events_for_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  snapshot_status text;
  snapshot_stage text;
  snapshot_time timestamptz := now();
begin
  if new.meta_account_id is null or new.law_firm_id is null then
    return new;
  end if;

  snapshot_status := nullif(trim(coalesce(new.data->>'status','')), '');
  snapshot_stage := nullif(trim(coalesce(new.data->>'detailStage','')), '');

  if old.data->>'detailStage' is distinct from new.data->>'detailStage' then
    for r in
      select id,event_name
      from public.firm_meta_event_rules
      where law_firm_id=new.law_firm_id
        and enabled=true
        and trigger_type='detail_stage'
        and trigger_value=coalesce(new.data->>'detailStage','')
    loop
      insert into public.meta_event_queue(
        id,law_firm_id,lead_id,ad_source_id,meta_account_id,
        event_name,event_id,crm_status,crm_stage,event_time
      )
      values(
        gen_random_uuid(),new.law_firm_id,new.id,new.ad_source_id,new.meta_account_id,
        r.event_name,
        'LP-CRM-'||replace(gen_random_uuid()::text,'-',''),
        snapshot_status,snapshot_stage,snapshot_time
      );
    end loop;
  end if;

  if old.data->>'status' is distinct from new.data->>'status' then
    for r in
      select id,event_name
      from public.firm_meta_event_rules
      where law_firm_id=new.law_firm_id
        and enabled=true
        and trigger_type='status'
        and trigger_value=coalesce(new.data->>'status','')
    loop
      insert into public.meta_event_queue(
        id,law_firm_id,lead_id,ad_source_id,meta_account_id,
        event_name,event_id,crm_status,crm_stage,event_time
      )
      values(
        gen_random_uuid(),new.law_firm_id,new.id,new.ad_source_id,new.meta_account_id,
        r.event_name,
        'LP-CRM-'||replace(gen_random_uuid()::text,'-',''),
        snapshot_status,snapshot_stage,snapshot_time
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.enqueue_meta_events_for_lead() from public;

drop trigger if exists trg_app_leads_meta_queue on public.app_leads;
create trigger trg_app_leads_meta_queue
after update of data on public.app_leads
for each row execute function public.enqueue_meta_events_for_lead();

commit;
