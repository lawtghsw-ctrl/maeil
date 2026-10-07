-- LawPower v28.19
-- DB관리 고객전환 안정화
--
-- 원인:
-- 브라우저 고객전환은 app_clients / app_cases / app_leads를 거의 동시에 저장합니다.
-- app_cases의 tenant-link 검증이 app_clients INSERT 커밋보다 먼저 실행되면
-- 같은 전환 작업인데도 "case client belongs to a different law firm" 계열 오류가 날 수 있습니다.
--
-- 해결:
-- 1) clientId가 이미 존재하면 반드시 같은 로펌인지 엄격히 확인합니다.
-- 2) 아직 clientId가 존재하지 않는 아주 짧은 동시 저장 구간에는 fromLeadId가 같은 로펌 DB인지 확인 후 허용합니다.
--    다른 로펌에 실제 존재하는 clientId를 가리키는 경우는 계속 차단됩니다.
-- 3) db.convert 권한만 있는 직원도 자기 담당 DB 전환으로 생성하는 미접수 계약은 생성 가능하게 합니다.
--
-- 기존 고객/계약/상담일지/담당자/진행단계 데이터를 UPDATE 하지 않습니다.

begin;

create or replace function public.enforce_operational_link_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_id text;
  source_lead_id text;
begin
  if new.law_firm_id is null then
    raise exception 'law_firm_id is required';
  end if;

  if tg_table_name = 'app_cases' then
    ref_id := nullif(new.data ->> 'clientId','');
    if ref_id is not null then
      -- clientId가 이미 DB 어딘가에 존재한다면 반드시 같은 로펌이어야 합니다.
      if exists(select 1 from public.app_clients c where c.id = ref_id) then
        if not exists(
          select 1 from public.app_clients c
          where c.id = ref_id and c.law_firm_id = new.law_firm_id
        ) then
          raise exception 'case client belongs to a different law firm';
        end if;
      else
        -- 고객전환의 병렬 저장 구간: client INSERT가 아직 커밋 전일 수 있습니다.
        -- 이 경우 원본 fromLeadId가 반드시 같은 로펌 DB여야만 임시 허용합니다.
        source_lead_id := nullif(new.data ->> 'fromLeadId','');
        if source_lead_id is null or not exists(
          select 1 from public.app_leads l
          where l.id = source_lead_id and l.law_firm_id = new.law_firm_id
        ) then
          raise exception 'case client is missing and source lead is invalid';
        end if;
      end if;
    end if;

  elsif tg_table_name = 'app_installments' then
    ref_id := nullif(new.data ->> 'caseId','');
    if ref_id is not null and not exists(
      select 1 from public.app_cases c
      where c.id = ref_id and c.law_firm_id = new.law_firm_id
    ) then
      raise exception 'installment case belongs to a different law firm';
    end if;

  elsif tg_table_name = 'app_schedule_items' then
    ref_id := nullif(new.data ->> 'caseId','');
    if ref_id is not null and not exists(
      select 1 from public.app_cases c
      where c.id = ref_id and c.law_firm_id = new.law_firm_id
    ) then
      raise exception 'schedule case belongs to a different law firm';
    end if;

    ref_id := nullif(new.data ->> 'clientId','');
    if ref_id is not null and not exists(
      select 1 from public.app_clients c
      where c.id = ref_id and c.law_firm_id = new.law_firm_id
    ) then
      raise exception 'schedule client belongs to a different law firm';
    end if;
  end if;

  return new;
end;
$$;

-- 기존 트리거는 위 함수 교체만으로 새 로직을 사용하지만,
-- 누락/이전 버전을 대비해 트리거 연결도 다시 보장합니다.
do $$
declare t text;
begin
  foreach t in array array['app_cases','app_installments','app_schedule_items'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_'||t||'_tenant_links', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.enforce_operational_link_tenant()',
      'trg_'||t||'_tenant_links', t
    );
  end loop;
end $$;

-- 고객전환 workflow는 DB관리의 db.convert 권한으로 시작됩니다.
-- 기존 cases.create 경로는 그대로 유지하면서, 자기 담당 원본 DB에서 파생된 미접수 계약만 추가 허용합니다.
drop policy if exists app_cases_insert_permissions on public.app_cases;
create policy app_cases_insert_permissions
on public.app_cases for insert to authenticated
with check (
  public.is_admin_user()
  or (
    public.has_permission('cases.create')
    and (
      public.has_permission('cases.change_assignee')
      or data ->> 'assignedStaff' = public.current_staff_name()
    )
  )
  or (
    public.has_permission('db.convert')
    and coalesce(data ->> 'fromLeadId','') <> ''
    and exists (
      select 1
      from public.app_leads l
      where l.id = data ->> 'fromLeadId'
        and l.law_firm_id = public.current_law_firm_id()
        and l.law_firm_id = app_cases.law_firm_id
        and l.data ->> 'assignedStaff' = data ->> 'assignedStaff'
        and (
          public.has_permission('db.view_all')
          or l.data ->> 'assignedStaff' = public.current_staff_name()
        )
    )
  )
);

commit;

-- 확인용: 다른 로펌 clientId를 참조한 계약이 없는지 점검합니다.
select count(*) as cross_firm_case_client_links
from public.app_cases c
join public.app_clients cl on cl.id = c.data ->> 'clientId'
where c.law_firm_id is distinct from cl.law_firm_id;
