-- Platform-only commercial operations. No existing customer or supply rows are rewritten.
create table public.platform_firm_commercial_profiles (
  law_firm_id uuid primary key references public.law_firms(id), service_mode text not null check(service_mode in ('crm_only','db_supply')),
  revision integer not null default 1, updated_at timestamptz not null default now()
);
create table public.platform_supply_contracts (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id),
  product text not null check (length(product) between 1 and 100),
  category text not null check (length(category) between 1 and 100),
  unit_price bigint check (unit_price between 0 and 1000000000000),
  monthly_quantity integer check (monthly_quantity between 0 and 10000000),
  start_date date not null, end_date date not null,
  status text not null default 'draft' check (status in ('draft','active','paused','ended')),
  confirmed_at timestamptz,
  revision integer not null default 1 check(revision > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 3660),
  check (status <> 'active' or (unit_price > 0 and monthly_quantity > 0 and confirmed_at is not null))
);
create index platform_supply_contracts_firm_dates on public.platform_supply_contracts(law_firm_id,start_date,end_date);
create table public.platform_supply_contract_versions (
  id bigint generated always as identity primary key, contract_id uuid not null references public.platform_supply_contracts(id),
  revision integer not null, value jsonb not null, actor_id uuid not null, created_at timestamptz not null default now(),
  unique(contract_id,revision)
);
create table public.platform_supply_adjustments (
  id uuid primary key, law_firm_id uuid not null references public.law_firms(id),
  contract_id uuid references public.platform_supply_contracts(id), ledger_id uuid references public.lead_supply_ledger(id),
  event_date date not null, kind text not null check(kind in ('replacement','receipt')),
  quantity integer not null default 0 check(quantity between 0 and 10000000),
  amount bigint not null default 0 check(amount between 0 and 1000000000000),
  reason text not null check(length(reason) between 1 and 500), actor_id uuid not null,
  created_at timestamptz not null default now(),
  check ((kind='receipt' and quantity=0) or (kind='replacement' and quantity>0 and amount=0))
);
create index platform_supply_adjustments_firm_date on public.platform_supply_adjustments(law_firm_id,event_date);
create table public.platform_operations_months (
  month text primary key check(month ~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),
  revision integer not null default 1, config jsonb not null,
  closed_at timestamptz, snapshot jsonb, updated_at timestamptz not null default now(),
  check(jsonb_typeof(config)='object'), check((closed_at is null) or snapshot is not null)
);
create table public.platform_operations_closings (
  id uuid primary key default gen_random_uuid(), month text not null references public.platform_operations_months(month),
  action text not null check(action in ('close','reopen')), snapshot jsonb, config jsonb not null,
  actor_id uuid not null, created_at timestamptz not null default now()
);
-- Link only a newly inserted ledger row; prior snapshots and classifications are untouched.
alter table public.lead_supply_ledger add column supply_contract_id uuid references public.platform_supply_contracts(id);
alter table public.lead_supply_ledger add column supply_contract_revision integer;
create index lead_supply_ledger_contract on public.lead_supply_ledger(supply_contract_id) where supply_contract_id is not null;

create function public.platform_match_future_supply_contract() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contract public.platform_supply_contracts; v_count integer := 0;
begin
  -- Import/backfill timestamps before the last explicit contract save never acquire a new price.
  new.supply_contract_id := null; new.supply_contract_revision := null;
  if new.origin <> 'ingest' or not new.billable or new.classification not in ('new','reentry')
     or new.supplied_at > now() + interval '5 minutes' then return new; end if;
  if exists(select 1 from public.platform_firm_commercial_profiles where law_firm_id=new.law_firm_id and service_mode='crm_only') then return new; end if;
  for v_contract in select * from public.platform_supply_contracts c
    where c.law_firm_id=new.law_firm_id and c.status='active' and c.confirmed_at is not null
      and new.supplied_at >= c.confirmed_at and new.supplied_at >= c.updated_at
      and (new.supplied_at at time zone 'Asia/Seoul')::date between c.start_date and c.end_date
    order by c.id for share
  loop
    v_count := v_count + 1;
    if v_count=1 then new.supply_contract_id:=v_contract.id; new.supply_contract_revision:=v_contract.revision; end if;
  end loop;
  if v_count=1 then
    select * into v_contract from public.platform_supply_contracts where id=new.supply_contract_id;
    new.unit_price_snapshot:=v_contract.unit_price; new.billing_type:='per_lead';
  else
    new.supply_contract_id:=null; new.supply_contract_revision:=null;
  end if;
  return new;
end $$;
revoke all on function public.platform_match_future_supply_contract() from public,anon,authenticated;
create trigger platform_match_future_supply_contract before insert on public.lead_supply_ledger
for each row execute function public.platform_match_future_supply_contract();

-- One transactional command endpoint. Optimistic revision prevents lost updates;
-- advisory transaction locks serialize first-create and month closing races.
create function public.platform_operations_command(p_actor uuid,p_command jsonb,p_snapshot jsonb default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_action text := p_command->>'action'; v_id uuid; v_firm uuid; v_month text;
  v_old public.platform_supply_contracts; v_contract public.platform_supply_contracts;
  v_row public.platform_operations_months; v_adjust public.platform_supply_adjustments;
  v_expected integer := coalesce((p_command->>'expectedRevision')::integer,0); v_config jsonb; v_revision integer;
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
    if p_command->>'status'='active' and exists(select 1 from public.platform_supply_contracts c
      where c.law_firm_id=v_firm and c.status='active' and (v_id is null or c.id<>v_id)
        and c.start_date<=(p_command->>'end_date')::date and c.end_date>=(p_command->>'start_date')::date) then
      raise exception '기간이 겹치는 활성 공급계약이 있습니다. 먼저 기존 계약 상태를 확인해주세요.';
    end if;
    if v_id is null then
      insert into public.platform_supply_contracts(law_firm_id,product,category,unit_price,monthly_quantity,start_date,end_date,status,confirmed_at)
      values(v_firm,p_command->>'product',p_command->>'category',(p_command->>'unit_price')::bigint,(p_command->>'monthly_quantity')::integer,
        (p_command->>'start_date')::date,(p_command->>'end_date')::date,p_command->>'status',case when p_command->>'status'='active' then now() end)
      returning * into v_contract;
    else
      update public.platform_supply_contracts set product=p_command->>'product',category=p_command->>'category',unit_price=(p_command->>'unit_price')::bigint,
        monthly_quantity=(p_command->>'monthly_quantity')::integer,start_date=(p_command->>'start_date')::date,end_date=(p_command->>'end_date')::date,
        status=p_command->>'status',confirmed_at=case when p_command->>'status'='active' then coalesce(confirmed_at,now()) else confirmed_at end,
        revision=revision+1,updated_at=clock_timestamp() where id=v_id returning * into v_contract;
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
do $$ declare t text; begin
  foreach t in array array['platform_firm_commercial_profiles','platform_supply_contracts','platform_supply_contract_versions','platform_supply_adjustments','platform_operations_months','platform_operations_closings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update on public.%I to service_role',t);
  end loop;
end $$;
grant usage,select on sequence public.platform_supply_contract_versions_id_seq to service_role;
