-- LawPower v28.20
-- DB관리 고객전환 후 "계약을 찾을 수 없습니다" 복구
--
-- 문제:
-- app_leads.data.convertedCaseId 는 저장됐지만 app_cases 행이 저장되지 않은 경우,
-- DB관리에는 "계약관리로 이동"이 보이지만 상세 페이지에서는 계약을 찾지 못합니다.
-- Promise.all/Realtime 타이밍이나 이전 실패 건에서도 이 상태가 남을 수 있습니다.
--
-- 처리:
-- 1) 이미 깨져 있는 전환 건의 누락 client/case를 즉시 복구
-- 2) 앞으로 app_leads에 convertedClientId/convertedCaseId가 기록될 때
--    누락 client/case가 있으면 DB trigger가 같은 ID로 자동 보정
-- 3) 기존 정상 고객/계약은 건드리지 않음 (ON CONFLICT DO NOTHING)

begin;

create or replace function public.ensure_converted_lead_records()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id text;
  v_case_id text;
  v_today text := to_char(current_date, 'YYYY-MM-DD');
  v_case_number text;
begin
  v_client_id := nullif(new.data ->> 'convertedClientId', '');
  v_case_id := nullif(new.data ->> 'convertedCaseId', '');

  -- 아직 고객전환 상태가 아니면 아무 작업도 하지 않습니다.
  if v_client_id is null or v_case_id is null then
    return new;
  end if;

  -- convertedClientId는 있는데 실제 app_clients 행이 빠진 경우 같은 ID로 복구합니다.
  insert into public.app_clients(id, data, law_firm_id, created_by)
  values (
    v_client_id,
    jsonb_strip_nulls(jsonb_build_object(
      'id', v_client_id,
      'name', new.data ->> 'name',
      'phone', new.data ->> 'phone',
      'registeredAt', v_today,
      'assignedStaff', new.data ->> 'assignedStaff',
      'memo', new.data ->> 'memo',
      'fromLeadId', new.id,
      'applicationType', new.data ->> 'applicationType',
      'consultation', new.data -> 'consultation'
    )),
    new.law_firm_id,
    new.created_by
  )
  on conflict (id) do nothing;

  -- convertedCaseId는 있는데 실제 app_cases 행이 빠진 경우 같은 ID로 복구합니다.
  v_case_number := '미접수-' || upper(substr(md5(v_case_id), 1, 6));

  insert into public.app_cases(id, data, law_firm_id, created_by)
  values (
    v_case_id,
    jsonb_strip_nulls(jsonb_build_object(
      'id', v_case_id,
      'caseNumber', v_case_number,
      'clientId', v_client_id,
      'caseType', coalesce(nullif(new.data ->> 'applicationType', ''), '개인회생'),
      'court', '미지정',
      'stage', '상담접수',
      'stageUpdatedAt', v_today,
      'status', '진행중',
      'assignedStaff', new.data ->> 'assignedStaff',
      'totalDebt', 0,
      'contractAmount', 0,
      'contractDate', v_today,
      'paidAmount', 0,
      'paymentMethod', '단순분납',
      'memo', new.data ->> 'memo',
      'fromLeadId', new.id
    )),
    new.law_firm_id,
    new.created_by
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_app_leads_ensure_converted_records on public.app_leads;
create trigger trg_app_leads_ensure_converted_records
after insert or update of data on public.app_leads
for each row
when (
  nullif(new.data ->> 'convertedClientId', '') is not null
  and nullif(new.data ->> 'convertedCaseId', '') is not null
)
execute function public.ensure_converted_lead_records();

-- 기존에 이미 converted ID만 남고 client/case가 빠진 데이터도 즉시 복구합니다.
do $$
declare
  r record;
begin
  for r in
    select *
    from public.app_leads
    where nullif(data ->> 'convertedClientId', '') is not null
      and nullif(data ->> 'convertedCaseId', '') is not null
  loop
    insert into public.app_clients(id, data, law_firm_id, created_by)
    values (
      r.data ->> 'convertedClientId',
      jsonb_strip_nulls(jsonb_build_object(
        'id', r.data ->> 'convertedClientId',
        'name', r.data ->> 'name',
        'phone', r.data ->> 'phone',
        'registeredAt', to_char(current_date, 'YYYY-MM-DD'),
        'assignedStaff', r.data ->> 'assignedStaff',
        'memo', r.data ->> 'memo',
        'fromLeadId', r.id,
        'applicationType', r.data ->> 'applicationType',
        'consultation', r.data -> 'consultation'
      )),
      r.law_firm_id,
      r.created_by
    )
    on conflict (id) do nothing;

    insert into public.app_cases(id, data, law_firm_id, created_by)
    values (
      r.data ->> 'convertedCaseId',
      jsonb_strip_nulls(jsonb_build_object(
        'id', r.data ->> 'convertedCaseId',
        'caseNumber', '미접수-' || upper(substr(md5(r.data ->> 'convertedCaseId'), 1, 6)),
        'clientId', r.data ->> 'convertedClientId',
        'caseType', coalesce(nullif(r.data ->> 'applicationType', ''), '개인회생'),
        'court', '미지정',
        'stage', '상담접수',
        'stageUpdatedAt', to_char(current_date, 'YYYY-MM-DD'),
        'status', '진행중',
        'assignedStaff', r.data ->> 'assignedStaff',
        'totalDebt', 0,
        'contractAmount', 0,
        'contractDate', to_char(current_date, 'YYYY-MM-DD'),
        'paidAmount', 0,
        'paymentMethod', '단순분납',
        'memo', r.data ->> 'memo',
        'fromLeadId', r.id
      )),
      r.law_firm_id,
      r.created_by
    )
    on conflict (id) do nothing;
  end loop;
end $$;

commit;

-- 결과 확인
select
  count(*) filter (
    where nullif(l.data ->> 'convertedClientId','') is not null
      and not exists (
        select 1 from public.app_clients c
        where c.id = l.data ->> 'convertedClientId'
          and c.law_firm_id = l.law_firm_id
      )
  ) as missing_clients,
  count(*) filter (
    where nullif(l.data ->> 'convertedCaseId','') is not null
      and not exists (
        select 1 from public.app_cases c
        where c.id = l.data ->> 'convertedCaseId'
          and c.law_firm_id = l.law_firm_id
      )
  ) as missing_cases
from public.app_leads l;
