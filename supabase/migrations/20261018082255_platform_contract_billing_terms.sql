-- Add explicit commercial billing terms only. Existing rows stay NULL, and
-- customer data, delivery ledger, receipts, SMS and saved closing snapshots are
-- never rewritten. Apply only after reviewing the target project.
alter table public.platform_supply_contracts add column billing_terms jsonb;

create function public.platform_contract_billing_terms_valid(p_terms jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_terms is null then return true; end if;
  if jsonb_typeof(p_terms)<>'object' or not (p_terms ?& array['version','quantityBasis','totalQuantity','cycleBasis','paymentTiming','lastPartial'])
    or (select count(*) from jsonb_object_keys(p_terms))<>6 then return false; end if;
  if p_terms->'version' is distinct from '1'::jsonb
    or p_terms->>'quantityBasis' not in ('monthly','total')
    or p_terms->>'cycleBasis' not in ('calendar_month','contract_month')
    or p_terms->>'paymentTiming' not in ('unspecified','prepaid','postpaid')
    or p_terms->>'lastPartial' not in ('prorate','full','included') then return false; end if;
  if jsonb_typeof(p_terms->'quantityBasis')<>'string' or jsonb_typeof(p_terms->'cycleBasis')<>'string'
    or jsonb_typeof(p_terms->'paymentTiming')<>'string' or jsonb_typeof(p_terms->'lastPartial')<>'string' then return false; end if;
  if p_terms->>'quantityBasis'='monthly' then return p_terms->'totalQuantity'='null'::jsonb; end if;
  return jsonb_typeof(p_terms->'totalQuantity')='number' and
    (p_terms->>'totalQuantity')::numeric between 1 and 10000000 and
    trunc((p_terms->>'totalQuantity')::numeric)=(p_terms->>'totalQuantity')::numeric;
exception when others then return false;
end $$;
revoke all on function public.platform_contract_billing_terms_valid(jsonb) from public,anon,authenticated;
grant execute on function public.platform_contract_billing_terms_valid(jsonb) to service_role;

alter table public.platform_supply_contracts add constraint platform_supply_contracts_billing_terms_valid
check (public.platform_contract_billing_terms_valid(billing_terms) and
  (billing_terms is null or billing_terms->>'quantityBasis'<>'total' or monthly_quantity is null));

-- Extend just the existing active-contract requirement. Do not rename or
-- recreate the table, change grants/RLS, or alter the future-only ledger trigger.
do $$
declare v_name text; v_count integer;
begin
  select count(*),min(conname::text) into v_count,v_name from pg_constraint
    where conrelid='public.platform_supply_contracts'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%status%'
      and pg_get_constraintdef(oid) like '%monthly_quantity%'
      and pg_get_constraintdef(oid) like '%unit_price%'
      and pg_get_constraintdef(oid) like '%confirmed_at%';
  if v_count<>1 then raise exception '활성 공급계약 제약을 확인할 수 없습니다.'; end if;
  execute format('alter table public.platform_supply_contracts drop constraint %I',v_name);
end $$;
alter table public.platform_supply_contracts add constraint platform_supply_contracts_active_quantity
check (status<>'active' or (unit_price>0 and confirmed_at is not null and
  (monthly_quantity>0 or (billing_terms->>'quantityBasis'='total' and (billing_terms->>'totalQuantity')::numeric>0))));

create or replace function public.platform_operations_command(p_actor uuid,p_command jsonb,p_snapshot jsonb default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_action text := p_command->>'action'; v_id uuid; v_firm uuid; v_month text;
  v_old public.platform_supply_contracts; v_contract public.platform_supply_contracts;
  v_row public.platform_operations_months; v_adjust public.platform_supply_adjustments;
  v_expected integer := coalesce((p_command->>'expectedRevision')::integer,0); v_config jsonb; v_revision integer; v_terms jsonb;
begin
  if not exists(select 1 from public.profiles where id=p_actor and is_active=true and platform_role='super_admin') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if v_action='commercial' then
    v_firm:=(p_command->>'law_firm_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('operations-contract:'||v_firm::text,0));
    select revision into v_revision from public.platform_firm_commercial_profiles where law_firm_id=v_firm for update;
    if coalesce(v_revision,0)<>v_expected then raise exception 'CONFLICT' using errcode='40001'; end if;
    if p_command->>'service_mode'='crm_only' and exists(select 1 from public.platform_supply_contracts where law_firm_id=v_firm and status='active') then raise exception '활성 DB 공급계약을 먼저 종료 또는 일시중지해주세요.'; end if;
    insert into public.platform_firm_commercial_profiles(law_firm_id,service_mode) values(v_firm,p_command->>'service_mode')
    on conflict(law_firm_id) do update set service_mode=excluded.service_mode,revision=platform_firm_commercial_profiles.revision+1,updated_at=clock_timestamp();
    return (select to_jsonb(p) from public.platform_firm_commercial_profiles p where law_firm_id=v_firm);
  elsif v_action='contract' then
    v_firm:=(p_command->>'law_firm_id')::uuid; v_id:=(p_command->>'id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('operations-contract:'||v_firm::text,0));
    if not exists(select 1 from public.law_firms where id=v_firm) then raise exception '로펌을 찾을 수 없습니다.'; end if;
    if p_command->>'status'='active' and exists(select 1 from public.platform_firm_commercial_profiles where law_firm_id=v_firm and service_mode='crm_only') then raise exception '어드민 전용 로펌은 DB 공급계약을 활성화할 수 없습니다.'; end if;
    if v_id is not null then
      select * into v_old from public.platform_supply_contracts where id=v_id for update;
      if not found or v_old.revision<>v_expected then raise exception 'CONFLICT' using errcode='40001'; end if;
      if v_old.law_firm_id<>v_firm then raise exception '계약의 로펌은 변경할 수 없습니다.'; end if;
    elsif v_expected<>0 then raise exception 'CONFLICT' using errcode='40001'; end if;
    -- Omitted field preserves existing metadata for older deployed callers.
    -- An explicit JSON null clears conditions only on the user's explicit save.
    v_terms:=case when p_command ? 'billing_terms' then nullif(p_command->'billing_terms','null'::jsonb) else v_old.billing_terms end;
    if not public.platform_contract_billing_terms_valid(v_terms) then raise exception '계약 결제 조건을 확인해주세요.'; end if;
    if v_terms->>'quantityBasis'='total' and p_command->>'monthly_quantity' is not null then raise exception '총 수량 계약은 월 약정량을 비워주세요.'; end if;
    if p_command->>'status'='active' and
      (coalesce((p_command->>'unit_price')::numeric,0)<=0 or
       coalesce(case when v_terms->>'quantityBasis'='total' then (v_terms->>'totalQuantity')::numeric else (p_command->>'monthly_quantity')::numeric end,0)<=0) then
      raise exception '확정 활성 계약은 양수 단가와 약정 수량을 입력해야 합니다.';
    end if;
    if coalesce((p_command->>'unit_price')::numeric,0) *
       coalesce(case when v_terms->>'quantityBasis'='total' then (v_terms->>'totalQuantity')::numeric else (p_command->>'monthly_quantity')::numeric end,0) > 9007199254740991 then
      raise exception '약정금액이 계산 범위를 초과했습니다.';
    end if;
    if p_command->>'status'='active' and exists(select 1 from public.platform_supply_contracts c
      where c.law_firm_id=v_firm and c.status='active' and (v_id is null or c.id<>v_id)
        and c.start_date<=(p_command->>'end_date')::date and c.end_date>=(p_command->>'start_date')::date) then
      raise exception '기간이 겹치는 활성 공급계약이 있습니다. 먼저 기존 계약 상태를 확인해주세요.';
    end if;
    if v_id is null then
      insert into public.platform_supply_contracts(law_firm_id,product,category,unit_price,monthly_quantity,start_date,end_date,status,confirmed_at,billing_terms)
      values(v_firm,p_command->>'product',p_command->>'category',(p_command->>'unit_price')::bigint,(p_command->>'monthly_quantity')::integer,
        (p_command->>'start_date')::date,(p_command->>'end_date')::date,p_command->>'status',case when p_command->>'status'='active' then now() end,v_terms)
      returning * into v_contract;
    else
      update public.platform_supply_contracts set product=p_command->>'product',category=p_command->>'category',unit_price=(p_command->>'unit_price')::bigint,
        monthly_quantity=(p_command->>'monthly_quantity')::integer,start_date=(p_command->>'start_date')::date,end_date=(p_command->>'end_date')::date,
        status=p_command->>'status',confirmed_at=case when p_command->>'status'='active' then coalesce(confirmed_at,now()) else confirmed_at end,
        billing_terms=v_terms,revision=revision+1,updated_at=clock_timestamp() where id=v_id returning * into v_contract;
    end if;
    insert into public.platform_supply_contract_versions(contract_id,revision,value,actor_id) values(v_contract.id,v_contract.revision,to_jsonb(v_contract),p_actor);
    -- An explicit activation confirms the commercial mode; drafts do not classify a firm.
    if v_contract.status='active' then
      insert into public.platform_firm_commercial_profiles(law_firm_id,service_mode) values(v_firm,'db_supply') on conflict(law_firm_id) do nothing;
    end if;
    return to_jsonb(v_contract);
  elsif v_action='adjustment' then
    v_id:=(p_command->>'id')::uuid; v_firm:=(p_command->>'law_firm_id')::uuid;
    v_month:=substring(p_command->>'event_date',1,7);
    perform pg_advisory_xact_lock(hashtextextended('operations-month:'||v_month,0));
    if exists(select 1 from public.platform_operations_months where month=v_month and closed_at is not null) then raise exception '마감된 월입니다. 먼저 마감을 해제해주세요.'; end if;
    if p_command->>'contract_id' is not null and not exists(select 1 from public.platform_supply_contracts where id=(p_command->>'contract_id')::uuid and law_firm_id=v_firm) then raise exception '계약의 로펌이 일치하지 않습니다.'; end if;
    if p_command->>'ledger_id' is not null and not exists(select 1 from public.lead_supply_ledger where id=(p_command->>'ledger_id')::uuid and law_firm_id=v_firm
      and ((p_command->>'contract_id') is null or supply_contract_id=(p_command->>'contract_id')::uuid)) then raise exception '공급 원장의 로펌 또는 계약이 일치하지 않습니다.'; end if;
    insert into public.platform_supply_adjustments(id,law_firm_id,contract_id,ledger_id,event_date,kind,quantity,amount,reason,actor_id)
    values(v_id,v_firm,(p_command->>'contract_id')::uuid,(p_command->>'ledger_id')::uuid,(p_command->>'event_date')::date,p_command->>'kind',
      (p_command->>'quantity')::integer,(p_command->>'amount')::bigint,p_command->>'reason',p_actor)
    on conflict(id) do nothing returning * into v_adjust;
    if not found then
      select * into v_adjust from public.platform_supply_adjustments where id=v_id;
      if v_adjust.law_firm_id<>v_firm or v_adjust.kind<>p_command->>'kind' or v_adjust.event_date<>(p_command->>'event_date')::date
        or v_adjust.quantity<>(p_command->>'quantity')::integer or v_adjust.amount<>(p_command->>'amount')::bigint or v_adjust.reason<>p_command->>'reason'
        or v_adjust.contract_id is distinct from (p_command->>'contract_id')::uuid or v_adjust.ledger_id is distinct from (p_command->>'ledger_id')::uuid then
        raise exception 'CONFLICT' using errcode='40001';
      end if;
    end if;
    return to_jsonb(v_adjust);
  elsif v_action in ('settings','close','reopen') then
    v_month:=p_command->>'month';
    perform pg_advisory_xact_lock(hashtextextended('operations-month:'||v_month,0));
    select * into v_row from public.platform_operations_months where month=v_month for update;
    if coalesce(v_row.revision,0)<>v_expected then raise exception 'CONFLICT' using errcode='40001'; end if;
    if v_action='settings' then
      if v_row.closed_at is not null then raise exception '마감된 월입니다. 먼저 마감을 해제해주세요.'; end if;
      v_config:=p_command->'config';
      if exists(select 1 from jsonb_array_elements(v_config->'adSpend') a where not exists(select 1 from public.law_firms f where f.id=(a->>'firmId')::uuid)) then raise exception '광고비 입력 로펌을 찾을 수 없습니다.'; end if;
      insert into public.platform_operations_months(month,config) values(v_month,v_config)
      on conflict(month) do update set config=excluded.config,revision=platform_operations_months.revision+1,updated_at=clock_timestamp()
      returning * into v_row;
    elsif v_action='close' then
      if v_row.month is null or v_row.closed_at is not null then raise exception '설정을 저장한 미마감 월만 마감할 수 있습니다.'; end if;
      if p_snapshot is null or p_snapshot->>'month'<>v_month or p_snapshot->>'includeDemo'<>'false' then raise exception '마감 집계가 올바르지 않습니다.'; end if;
      if coalesce((p_snapshot->>'adjustmentCount')::integer,-1)<>(select count(*) from public.platform_supply_adjustments where to_char(event_date,'YYYY-MM')=v_month) then
        raise exception 'CONFLICT' using errcode='40001';
      end if;
      update public.platform_operations_months set closed_at=clock_timestamp(),snapshot=p_snapshot,revision=revision+1,updated_at=clock_timestamp() where month=v_month returning * into v_row;
      insert into public.platform_operations_closings(month,action,snapshot,config,actor_id) values(v_month,'close',p_snapshot,v_row.config,p_actor);
    else
      if v_row.closed_at is null then raise exception '마감된 월만 해제할 수 있습니다.'; end if;
      insert into public.platform_operations_closings(month,action,snapshot,config,actor_id) values(v_month,'reopen',v_row.snapshot,v_row.config,p_actor);
      update public.platform_operations_months set closed_at=null,revision=revision+1,updated_at=clock_timestamp() where month=v_month returning * into v_row;
    end if;
    return to_jsonb(v_row);
  end if;
  raise exception '지원하지 않는 작업입니다.';
end $$;
revoke all on function public.platform_operations_command(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.platform_operations_command(uuid,jsonb,jsonb) to service_role;
