-- 로파워의 B2B 영업 전용. 기존 로펌 고객/문자/공급 원장은 변경하지 않습니다.
begin;
create table public.platform_sales_leads (
 id uuid primary key default gen_random_uuid(), data jsonb not null,
 stage text not null default '신규접수' check(stage in ('신규접수','첫연락','미팅예정','제안 · 조건협의','계약서발송','서명완료','보류','실패')),
 revision integer not null default 1 check(revision>0),
 business_key text not null default '', phone_key text not null default '', domain_key text not null default '', name_key text not null,
 sources text[] not null default '{}', proposal jsonb,
 law_firm_id uuid references public.law_firms(id), signed_at timestamptz,
 last_contact_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index platform_sales_business_key on public.platform_sales_leads(business_key) where business_key<>'';
create index platform_sales_phone_key on public.platform_sales_leads(phone_key) where phone_key<>'';
create index platform_sales_domain_key on public.platform_sales_leads(domain_key) where domain_key<>'';
create index platform_sales_stage on public.platform_sales_leads(stage,updated_at);
create table public.platform_sales_events (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.platform_sales_leads(id),
 kind text not null check(kind in ('create','source','update','stage','activity','meeting','proposal')),
 data jsonb not null default '{}', actor_id uuid, actor_name text not null, created_at timestamptz not null default now()
);
create index platform_sales_events_lead on public.platform_sales_events(lead_id,created_at);
alter table public.platform_sales_leads enable row level security;
alter table public.platform_sales_events enable row level security;
revoke all on public.platform_sales_leads,public.platform_sales_events from public,anon,authenticated;
grant select,insert,update,delete on public.platform_sales_leads,public.platform_sales_events to service_role;

create function public.platform_sales_mutate(p_actor_id uuid,p_actor_name text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r jsonb; ident jsonb; d jsonb; target public.platform_sales_leads%rowtype;
 ids jsonb := '[]'; created integer:=0; merged integer:=0; old_stage text; event_id uuid; existing_event public.platform_sales_events%rowtype;
begin
 -- Serializes identity matching/imports. All changes + their history are one transaction.
 perform pg_advisory_xact_lock(530710182026::bigint);
 if p_action in ('create','import') then
  if jsonb_array_length(p_payload->'rows') not between 1 and 200 then raise exception 'INVALID_ROWS'; end if;
  for r in select value from jsonb_array_elements(p_payload->'rows') loop
   ident:=r->'identity';d:=r->'data';target:=null;
   if coalesce(ident->>'name','')='' then raise exception 'INVALID_NAME'; end if;
   select * into target from public.platform_sales_leads l where
     ((coalesce(ident->>'business','')<>'' and l.business_key=ident->>'business') or
      (coalesce(ident->>'phone','')<>'' and l.phone_key=ident->>'phone') or
      (coalesce(ident->>'domain','')<>'' and l.domain_key=ident->>'domain') or l.name_key=ident->>'name')
     and not (l.business_key<>'' and coalesce(ident->>'business','')<>'' and l.business_key<>ident->>'business')
   order by case when l.business_key<>'' and l.business_key=ident->>'business' then 0 when l.phone_key<>'' and l.phone_key=ident->>'phone' then 1 when l.domain_key<>'' and l.domain_key=ident->>'domain' then 2 else 3 end,created_at limit 1 for update;
   if target.id is null then
    insert into public.platform_sales_leads(data,business_key,phone_key,domain_key,name_key,sources)
    values(d,ident->>'business',ident->>'phone',ident->>'domain',ident->>'name',array[d->>'source']) returning * into target;
    insert into public.platform_sales_events(lead_id,kind,data,actor_id,actor_name) values(target.id,'create',jsonb_build_object('source',d->>'source'),p_actor_id,p_actor_name);created:=created+1;
   else
    if not (d->>'source'=any(target.sources)) then
      update public.platform_sales_leads set sources=array_append(sources,d->>'source'),revision=revision+1,updated_at=now() where id=target.id returning * into target;
      insert into public.platform_sales_events(lead_id,kind,data,actor_id,actor_name) values(target.id,'source',jsonb_build_object('source',d->>'source'),p_actor_id,p_actor_name);
    end if;
    merged:=merged+1;
   end if;
   ids:=ids||jsonb_build_array(target.id);
  end loop;
  return jsonb_build_object('created',created,'merged',merged,'ids',ids);
 end if;
 select * into target from public.platform_sales_leads where id=(p_payload->>'id')::uuid for update;
 if target.id is null then raise exception 'NOT_FOUND'; end if;
 if p_action in ('activity','meeting') then
  event_id:=(p_payload->>'requestId')::uuid;
  select * into existing_event from public.platform_sales_events where id=event_id;
  if existing_event.id is not null then
   if existing_event.lead_id<>target.id or existing_event.kind<>p_action or existing_event.data<>p_payload->'data' then raise exception 'REQUEST_CONFLICT'; end if;
   return jsonb_build_object('id',target.id,'reused',true);
  end if;
 end if;
 if target.revision<>(p_payload->>'revision')::integer then raise exception 'REVISION_CONFLICT'; end if;
 if p_action='update' then
  d:=p_payload->'data';ident:=p_payload->'identity';old_stage:=target.stage;
  if p_payload->>'stage' not in ('신규접수','첫연락','미팅예정','제안 · 조건협의','보류','실패') or target.stage in ('계약서발송','서명완료') then raise exception 'PROVIDER_STAGE_LOCKED';end if;
  if exists(select 1 from public.platform_sales_leads where id<>target.id and ((business_key<>'' and business_key=ident->>'business') or (phone_key<>'' and phone_key=ident->>'phone') or (domain_key<>'' and domain_key=ident->>'domain'))) then raise exception 'IDENTITY_CONFLICT';end if;
  update public.platform_sales_leads set data=d,stage=p_payload->>'stage',business_key=ident->>'business',phone_key=ident->>'phone',domain_key=ident->>'domain',name_key=ident->>'name',revision=revision+1,updated_at=now() where id=target.id;
  insert into public.platform_sales_events(lead_id,kind,data,actor_id,actor_name) values(target.id,case when old_stage<>p_payload->>'stage' then 'stage' else 'update' end,jsonb_build_object('from',old_stage,'to',p_payload->>'stage'),p_actor_id,p_actor_name);
 elsif p_action='proposal' then
  if target.stage in ('계약서발송','서명완료') then raise exception 'PROVIDER_STAGE_LOCKED';end if;
  d:=(p_payload->'proposal')||jsonb_build_object('version',coalesce((target.proposal->>'version')::integer,0)+1);
  update public.platform_sales_leads set proposal=d,data=jsonb_set(data,'{expectedMonthly}',to_jsonb((d->>'quantity')::numeric*(d->>'unitPrice')::numeric)),revision=revision+1,updated_at=now() where id=target.id;
  insert into public.platform_sales_events(lead_id,kind,data,actor_id,actor_name) values(target.id,'proposal',d,p_actor_id,p_actor_name);
 elsif p_action in ('activity','meeting') then
  insert into public.platform_sales_events(id,lead_id,kind,data,actor_id,actor_name) values(event_id,target.id,p_action,p_payload->'data',p_actor_id,p_actor_name);
  update public.platform_sales_leads set revision=revision+1,updated_at=now(),last_contact_at=case when ((p_action='activity' and (p_payload->'data'->>'type')<>'메모') or (p_action='meeting' and p_payload->'data'->>'status'='완료')) and (p_payload->'data'->>'at')::timestamptz<=now() then greatest(last_contact_at,(p_payload->'data'->>'at')::timestamptz) else last_contact_at end where id=target.id;
 else raise exception 'INVALID_ACTION';end if;
 return jsonb_build_object('id',target.id);
end;$$;
revoke all on function public.platform_sales_mutate(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.platform_sales_mutate(uuid,text,text,jsonb) to service_role;
commit;
