-- Additive B2B sales correction history only. No existing rows are updated.
begin;
create table public.platform_sales_event_revisions (
 id uuid primary key, event_id uuid not null references public.platform_sales_events(id) on delete restrict,
 lead_id uuid not null references public.platform_sales_leads(id) on delete restrict,
 revision integer not null check(revision>0), action text not null check(action in ('event_update','event_archive','event_restore')),
 data jsonb not null check(jsonb_typeof(data)='object'), archived boolean not null,
 actor_id uuid not null, actor_name text not null, request_payload jsonb not null,
 created_at timestamptz not null default now(), unique(event_id,revision)
);
create index platform_sales_event_revisions_lead on public.platform_sales_event_revisions(lead_id,event_id,revision desc);
alter table public.platform_sales_event_revisions enable row level security;
-- Supabase projects may grant ALL to service_role through default privileges.
-- Revoke those defaults too before allowing only append/read operations.
revoke all on public.platform_sales_event_revisions from public,anon,authenticated,service_role;
grant select,insert on public.platform_sales_event_revisions to service_role;
create or replace function public.platform_sales_mutate(p_actor_id uuid,p_actor_name text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r jsonb; ident jsonb; d jsonb; target public.platform_sales_leads%rowtype;
 ids jsonb := '[]'; created integer:=0; merged integer:=0; old_stage text; event_id uuid; existing_event public.platform_sales_events%rowtype;
 current_event public.platform_sales_events%rowtype; latest public.platform_sales_event_revisions%rowtype;
 retry public.platform_sales_event_revisions%rowtype; snapshot jsonb; hidden boolean; next_revision integer; initial_stage text;
begin
 if auth.uid() is not null and auth.uid()<>p_actor_id then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.profiles p where p.id=p_actor_id and p.is_active is true and p.platform_role='super_admin') then raise exception 'FORBIDDEN'; end if;
 -- Serializes identity matching/imports. All changes + their history are one transaction.
 perform pg_advisory_xact_lock(530710182026::bigint);
 if p_action in ('create','import') then
  if jsonb_array_length(p_payload->'rows') not between 1 and 200 then raise exception 'INVALID_ROWS'; end if;
  for r in select value from jsonb_array_elements(p_payload->'rows') loop
   ident:=r->'identity';d:=r->'data';target:=null;
   initial_stage:=coalesce(nullif(r->>'stage',''),'신규접수');
   if initial_stage not in ('신규접수','첫연락','미팅예정','제안 · 조건협의','보류','실패') then raise exception 'PROVIDER_STAGE_LOCKED';end if;
   if initial_stage='실패' and coalesce(btrim(d->>'lostReason'),'')='' then raise exception 'INVALID_LOSS_REASON';end if;
   if d ? 'priority' and d->>'priority' not in ('높음','보통','낮음') then raise exception 'INVALID_PRIORITY';end if;
   if length(coalesce(d->>'note',''))>5000 then raise exception 'INVALID_NOTE';end if;
   if coalesce(ident->>'name','')='' then raise exception 'INVALID_NAME'; end if;
   select * into target from public.platform_sales_leads l where
     ((coalesce(ident->>'business','')<>'' and l.business_key=ident->>'business') or
      (coalesce(ident->>'phone','')<>'' and l.phone_key=ident->>'phone') or
      (coalesce(ident->>'domain','')<>'' and l.domain_key=ident->>'domain') or l.name_key=ident->>'name')
     and not (l.business_key<>'' and coalesce(ident->>'business','')<>'' and l.business_key<>ident->>'business')
   order by case when l.business_key<>'' and l.business_key=ident->>'business' then 0 when l.phone_key<>'' and l.phone_key=ident->>'phone' then 1 when l.domain_key<>'' and l.domain_key=ident->>'domain' then 2 else 3 end,created_at limit 1 for update;
   if target.id is null then
    insert into public.platform_sales_leads(data,stage,business_key,phone_key,domain_key,name_key,sources)
    values(d,initial_stage,ident->>'business',ident->>'phone',ident->>'domain',ident->>'name',array[d->>'source']) returning * into target;
    insert into public.platform_sales_events(lead_id,kind,data,actor_id,actor_name) values(target.id,'create',jsonb_build_object('source',d->>'source','stage',initial_stage,'note',coalesce(d->>'note',''),'priority',coalesce(d->>'priority','보통')),p_actor_id,p_actor_name);created:=created+1;
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
 if p_action in ('event_update','event_archive','event_restore') then
  select * into retry from public.platform_sales_event_revisions where id=(p_payload->>'requestId')::uuid;
  if retry.id is not null then
   if retry.lead_id<>target.id or retry.action<>p_action or retry.request_payload<>p_payload then raise exception 'REQUEST_CONFLICT';end if;
   return jsonb_build_object('id',target.id,'reused',true);
  end if;
 end if;
 if target.revision is distinct from (p_payload->>'revision')::integer then raise exception 'REVISION_CONFLICT'; end if;
 if p_action in ('event_update','event_archive','event_restore') then
  select * into current_event from public.platform_sales_events where id=(p_payload->>'eventId')::uuid and lead_id=target.id;
  if current_event.id is null or current_event.kind not in ('activity','meeting') then raise exception 'EVENT_UNAVAILABLE';end if;
  select revision_row.* into latest from public.platform_sales_event_revisions revision_row where revision_row.event_id=current_event.id order by revision_row.revision desc limit 1;
  if coalesce(latest.revision,0) is distinct from (p_payload->>'eventRevision')::integer then raise exception 'REVISION_CONFLICT';end if;
  snapshot:=coalesce(latest.data,current_event.data);hidden:=coalesce(latest.archived,false);
  if p_action='event_update' then
   if hidden or p_payload->>'kind' is distinct from current_event.kind then raise exception 'EVENT_UNAVAILABLE';end if;
   d:=p_payload->'data';
   if current_event.kind='activity' and d->>'type'='미팅' and current_event.data->>'type' is distinct from '미팅' then raise exception 'EVENT_KIND_LOCKED';end if;
   if jsonb_typeof(d)<>'object' or coalesce(btrim(d->>'note'),'')='' or length(d->>'note')>5000 or coalesce(d->>'type','') not in ('전화','문자','이메일','미팅','메모') or (current_event.kind='meeting' and d->>'type'<>'미팅') or coalesce(d->>'status','') not in ('예정','완료','취소') or coalesce(d->>'at','')='' then raise exception 'INVALID_EVENT';end if;
   perform (d->>'at')::timestamptz;
   if coalesce(d->>'nextAt','')<>'' then perform (d->>'nextAt')::timestamptz;end if;
   snapshot:=snapshot||d;
  elsif p_action='event_archive' then
   if hidden then raise exception 'EVENT_ALREADY_ARCHIVED';end if;hidden:=true;
  else
   if not hidden then raise exception 'EVENT_NOT_ARCHIVED';end if;hidden:=false;
  end if;
  next_revision:=coalesce(latest.revision,0)+1;
  insert into public.platform_sales_event_revisions(id,event_id,lead_id,revision,action,data,archived,actor_id,actor_name,request_payload)
   values((p_payload->>'requestId')::uuid,current_event.id,target.id,next_revision,p_action,snapshot,hidden,p_actor_id,p_actor_name,p_payload);
  -- Recompute only this sales lead. Original events/creation request payloads remain immutable.
  update public.platform_sales_leads set revision=revision+1,updated_at=now(),last_contact_at=(
   select max((coalesce(v.data,e.data)->>'at')::timestamptz)
   from public.platform_sales_events e left join lateral(select x.data,x.archived from public.platform_sales_event_revisions x where x.event_id=e.id order by x.revision desc limit 1)v on true
   where e.lead_id=target.id and not coalesce(v.archived,false)
    and ((e.kind='activity' and coalesce(v.data,e.data)->>'type'<>'메모') or (e.kind='meeting' and coalesce(v.data,e.data)->>'status'='완료'))
    and (coalesce(v.data,e.data)->>'at')::timestamptz<=now()
  ) where id=target.id;
  return jsonb_build_object('id',target.id,'eventId',current_event.id,'eventRevision',next_revision);
 end if;
 if p_action='update' then
  d:=p_payload->'data';ident:=p_payload->'identity';old_stage:=target.stage;
  if d ? 'priority' and d->>'priority' not in ('높음','보통','낮음') then raise exception 'INVALID_PRIORITY';end if;
  if length(coalesce(d->>'note',''))>5000 then raise exception 'INVALID_NOTE';end if;
  if p_payload->>'stage' not in ('신규접수','첫연락','미팅예정','제안 · 조건협의','보류','실패') or target.stage in ('계약서발송','서명완료') then raise exception 'PROVIDER_STAGE_LOCKED';end if;
  if exists(select 1 from public.platform_sales_leads where id<>target.id and ((business_key<>'' and business_key=ident->>'business') or (phone_key<>'' and phone_key=ident->>'phone') or (domain_key<>'' and domain_key=ident->>'domain'))) then raise exception 'IDENTITY_CONFLICT';end if;
  update public.platform_sales_leads set data=target.data||d,stage=p_payload->>'stage',business_key=ident->>'business',phone_key=ident->>'phone',domain_key=ident->>'domain',name_key=ident->>'name',revision=revision+1,updated_at=now() where id=target.id;
  insert into public.platform_sales_events(lead_id,kind,data,actor_id,actor_name) values(target.id,case when old_stage<>p_payload->>'stage' then 'stage' else 'update' end,jsonb_build_object('from',old_stage,'to',p_payload->>'stage','before',target.data,'after',target.data||d),p_actor_id,p_actor_name);
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
