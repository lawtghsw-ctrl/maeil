-- LawPower v28.7
-- Meta CRM / Conversion Leads grouped optimization signals
--
-- 덮어쓰기용: 기존 supabase/migrations/007_meta_crm_optimization.sql 전체 교체
--
-- 운영 신호
-- ENGAGED   : 상담 / 설득필요
-- QUALIFIED : 착수금 안내 / 착수금착수 / 착수 1차안내 / 착수 추후진행
-- CONVERTED : 실제 계약관리에서 총 수임료(contractAmount)가 최초 0원 초과 등록
--
-- 동일 고객이 같은 그룹 안에서 여러 단계로 이동해도 그룹별 1회만 전송합니다.
-- 신규디비/미상담/부재/예약/장기부재/불가/취소예정은 긍정 최적화 신호로 보내지 않습니다.
-- 기존 Queue/전송로그/고객데이터는 삭제하지 않습니다.

begin;

-- ---------------------------------------------------------------------------
-- 1) Queue snapshot + grouped signal columns
-- ---------------------------------------------------------------------------

alter table public.meta_event_queue
  add column if not exists crm_status text,
  add column if not exists crm_stage text,
  add column if not exists event_time timestamptz,
  add column if not exists quality_group text;

update public.meta_event_queue
set event_time = coalesce(event_time, created_at)
where event_time is null;

alter table public.meta_event_queue
  alter column event_time set default now();

-- 고객 1명당 품질그룹별 1회만 큐 생성
create unique index if not exists uq_meta_event_queue_quality_once
  on public.meta_event_queue(law_firm_id, lead_id, quality_group)
  where quality_group is not null;

-- ---------------------------------------------------------------------------
-- 2) 기존 구형 기본규칙 정리 + canonical 3개 규칙 보장
-- ---------------------------------------------------------------------------

delete from public.firm_meta_event_rules
where enabled = false
  and (
    (trigger_type='detail_stage' and trigger_value='예약' and event_name='Schedule')
    or (trigger_type='detail_stage' and trigger_value='상담' and event_name='Contact')
    or (trigger_type='status' and trigger_value='수임전환' and event_name='CompleteRegistration')
  );

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

-- 신규 로펌도 canonical 3개 규칙을 기본 OFF로 생성
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

-- ---------------------------------------------------------------------------
-- 3) 진행단계 -> 품질그룹 매핑
-- ---------------------------------------------------------------------------

create or replace function public.meta_crm_stage_signal_group(p_stage text)
returns text
language sql
immutable
set search_path = public
as $$
  select case trim(coalesce(p_stage, ''))
    when '상담' then 'ENGAGED'
    when '설득필요' then 'ENGAGED'

    when '착수금 안내' then 'QUALIFIED'
    when '착수금착수' then 'QUALIFIED'
    when '착수 1차안내' then 'QUALIFIED'
    when '착수 추후진행' then 'QUALIFIED'

    else null
  end
$$;

revoke all on function public.meta_crm_stage_signal_group(text) from public;

-- ---------------------------------------------------------------------------
-- 4) DB 진행단계 자동전송
--
-- canonical rule UI 의미:
-- "상담"        ON = ENGAGED 그룹 전체 ON
-- "착수금 안내" ON = QUALIFIED 그룹 전체 ON
--
-- canonical 3개 외에 사용자가 직접 추가한 exact-match 규칙은 기존 방식으로 계속 지원
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_meta_events_for_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  old_stage text;
  new_stage text;
  old_status text;
  new_status text;
  old_group text;
  new_group text;
  canonical_trigger_value text;
  snapshot_time timestamptz := now();
begin
  if new.meta_account_id is null or new.law_firm_id is null then
    return new;
  end if;

  old_stage := nullif(trim(coalesce(old.data->>'detailStage', '')), '');
  new_stage := nullif(trim(coalesce(new.data->>'detailStage', '')), '');
  old_status := nullif(trim(coalesce(old.data->>'status', '')), '');
  new_status := nullif(trim(coalesce(new.data->>'status', '')), '');

  old_group := public.meta_crm_stage_signal_group(old_stage);
  new_group := public.meta_crm_stage_signal_group(new_stage);

  -- ENGAGED / QUALIFIED 그룹 진입 시 고객 1명당 그룹별 1회
  if new_group is not null and new_group is distinct from old_group then
    canonical_trigger_value :=
      case new_group
        when 'ENGAGED' then '상담'
        when 'QUALIFIED' then '착수금 안내'
        else null
      end;

    if canonical_trigger_value is not null then
      for r in
        select rule.event_name
        from public.firm_meta_event_rules rule
        where rule.law_firm_id = new.law_firm_id
          and rule.enabled = true
          and rule.trigger_type = 'detail_stage'
          and rule.trigger_value = canonical_trigger_value
      loop
        insert into public.meta_event_queue(
          id,
          law_firm_id,
          lead_id,
          ad_source_id,
          meta_account_id,
          event_name,
          event_id,
          crm_status,
          crm_stage,
          event_time,
          quality_group
        )
        values(
          gen_random_uuid(),
          new.law_firm_id,
          new.id,
          new.ad_source_id,
          new.meta_account_id,
          r.event_name,
          'LP-CRM-' || replace(gen_random_uuid()::text, '-', ''),
          new_group,
          new_stage,
          snapshot_time,
          new_group
        )
        on conflict do nothing;
      end loop;
    end if;
  end if;

  -- 사용자가 추가한 별도 진행단계 exact-match 규칙은 그대로 지원
  if old_stage is distinct from new_stage and new_stage is not null then
    for r in
      select rule.event_name
      from public.firm_meta_event_rules rule
      where rule.law_firm_id = new.law_firm_id
        and rule.enabled = true
        and rule.trigger_type = 'detail_stage'
        and rule.trigger_value = new_stage
        and not (
          rule.event_name = 'Lead'
          and rule.trigger_value in ('상담', '착수금 안내')
        )
    loop
      insert into public.meta_event_queue(
        id,
        law_firm_id,
        lead_id,
        ad_source_id,
        meta_account_id,
        event_name,
        event_id,
        crm_status,
        crm_stage,
        event_time
      )
      values(
        gen_random_uuid(),
        new.law_firm_id,
        new.id,
        new.ad_source_id,
        new.meta_account_id,
        r.event_name,
        'LP-CRM-' || replace(gen_random_uuid()::text, '-', ''),
        new_status,
        new_stage,
        snapshot_time
      );
    end loop;
  end if;

  -- 사용자가 추가한 별도 status exact-match 규칙은 그대로 지원
  -- canonical "수임전환 -> Lead"는 실제 계약등록 트리거가 담당
  if old_status is distinct from new_status and new_status is not null then
    for r in
      select rule.event_name
      from public.firm_meta_event_rules rule
      where rule.law_firm_id = new.law_firm_id
        and rule.enabled = true
        and rule.trigger_type = 'status'
        and rule.trigger_value = new_status
        and not (
          rule.event_name = 'Lead'
          and rule.trigger_value = '수임전환'
        )
    loop
      insert into public.meta_event_queue(
        id,
        law_firm_id,
        lead_id,
        ad_source_id,
        meta_account_id,
        event_name,
        event_id,
        crm_status,
        crm_stage,
        event_time
      )
      values(
        gen_random_uuid(),
        new.law_firm_id,
        new.id,
        new.ad_source_id,
        new.meta_account_id,
        r.event_name,
        'LP-CRM-' || replace(gen_random_uuid()::text, '-', ''),
        new_status,
        new_stage,
        snapshot_time
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

-- ---------------------------------------------------------------------------
-- 5) 실제 계약등록 -> CONVERTED
--
-- 현재 고객전환 버튼은 미접수 계약을 contractAmount=0으로 자동 생성하므로 전송하지 않음.
-- 계약관리에서 총 수임료가 최초로 0원 초과가 되는 순간만 CONVERTED 1회 전송.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_meta_event_for_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_amount numeric := 0;
  old_amount numeric := 0;
  lead_id_from_case text;
  lead_row public.app_leads%rowtype;
  r record;
begin
  if new.law_firm_id is null then
    return new;
  end if;

  if coalesce(new.data->>'contractAmount', '') ~ '^[0-9]+([.][0-9]+)?$' then
    new_amount := (new.data->>'contractAmount')::numeric;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.data->>'contractAmount', '') ~ '^[0-9]+([.][0-9]+)?$' then
      old_amount := (old.data->>'contractAmount')::numeric;
    end if;
  end if;

  if new_amount <= 0 then
    return new;
  end if;

  if tg_op = 'UPDATE' and old_amount > 0 then
    return new;
  end if;

  lead_id_from_case := nullif(trim(coalesce(new.data->>'fromLeadId', '')), '');

  if lead_id_from_case is null
     and nullif(trim(coalesce(new.data->>'clientId', '')), '') is not null then
    select nullif(trim(coalesce(c.data->>'fromLeadId', '')), '')
      into lead_id_from_case
    from public.app_clients c
    where c.id = new.data->>'clientId'
      and c.law_firm_id = new.law_firm_id
    limit 1;
  end if;

  if lead_id_from_case is null then
    return new;
  end if;

  select l.*
    into lead_row
  from public.app_leads l
  where l.id = lead_id_from_case
    and l.law_firm_id = new.law_firm_id
  limit 1;

  if lead_row.id is null
     or lead_row.meta_account_id is null
     or nullif(trim(coalesce(lead_row.meta_lead_id, '')), '') is null then
    return new;
  end if;

  for r in
    select rule.event_name
    from public.firm_meta_event_rules rule
    where rule.law_firm_id = new.law_firm_id
      and rule.enabled = true
      and rule.trigger_type = 'status'
      and rule.trigger_value = '수임전환'
  loop
    insert into public.meta_event_queue(
      id,
      law_firm_id,
      lead_id,
      ad_source_id,
      meta_account_id,
      event_name,
      event_id,
      crm_status,
      crm_stage,
      event_time,
      quality_group
    )
    values(
      gen_random_uuid(),
      lead_row.law_firm_id,
      lead_row.id,
      lead_row.ad_source_id,
      lead_row.meta_account_id,
      r.event_name,
      'LP-CRM-' || replace(gen_random_uuid()::text, '-', ''),
      'CONVERTED',
      '계약등록',
      now(),
      'CONVERTED'
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function public.enqueue_meta_event_for_contract() from public;

drop trigger if exists trg_app_cases_meta_contract_queue on public.app_cases;
create trigger trg_app_cases_meta_contract_queue
after insert or update of data on public.app_cases
for each row execute function public.enqueue_meta_event_for_contract();

-- ---------------------------------------------------------------------------
-- 6) 현재 기본 운영 로펌(매일): 3개 canonical 규칙 전부 ON
-- 다른 신규 로펌은 기본 OFF 유지
-- ---------------------------------------------------------------------------

update public.firm_meta_event_rules r
set enabled = false,
    updated_at = now()
where r.law_firm_id in (
  select f.id
  from public.law_firms f
  where f.is_legacy_default = true
);

insert into public.firm_meta_event_rules(
  law_firm_id, trigger_type, trigger_value, event_name, enabled
)
select f.id, 'detail_stage', '상담', 'Lead', true
from public.law_firms f
where f.is_legacy_default = true
on conflict(law_firm_id, trigger_type, trigger_value, event_name)
do update set enabled = true, updated_at = now();

insert into public.firm_meta_event_rules(
  law_firm_id, trigger_type, trigger_value, event_name, enabled
)
select f.id, 'detail_stage', '착수금 안내', 'Lead', true
from public.law_firms f
where f.is_legacy_default = true
on conflict(law_firm_id, trigger_type, trigger_value, event_name)
do update set enabled = true, updated_at = now();

insert into public.firm_meta_event_rules(
  law_firm_id, trigger_type, trigger_value, event_name, enabled
)
select f.id, 'status', '수임전환', 'Lead', true
from public.law_firms f
where f.is_legacy_default = true
on conflict(law_firm_id, trigger_type,trigger_value,event_name)
do update set enabled = true, updated_at = now();

-- 테스트 이벤트 코드 제거 -> 실제 운영 이벤트로 전송
update public.firm_meta_accounts m
set test_event_code = null,
    updated_at = now()
where m.law_firm_id in (
  select f.id
  from public.law_firms f
  where f.is_legacy_default = true
)
and m.test_event_code is not null;

commit;

-- 적용확인
select
  r.trigger_type,
  r.trigger_value,
  r.event_name,
  r.enabled
from public.firm_meta_event_rules r
join public.law_firms f
  on f.id = r.law_firm_id
where f.is_legacy_default = true
order by r.trigger_type, r.trigger_value, r.event_name;
