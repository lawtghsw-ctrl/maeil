-- History visibility only. Never modifies or deletes sms_outbox, delivery jobs,
-- delivery requests, provider results, relay state, delivery gates or settings.
-- Legacy and newly-created outbox rows are equally eligible for hide/restore.
-- Hiding a row does NOT cancel a queued/scheduled delivery or erase audit data.
begin;

-- Reuse the unexposed schema from sms_delivery_epoch_jobs; do not rerun it.
do $$ begin
  if to_regnamespace('sms_delivery_private') is null then
    raise exception 'SMS_DELIVERY_SCHEMA_REQUIRED';
  end if;
end $$;

create table public.sms_history_archives (
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  outbox_id uuid not null references public.sms_outbox(id) on delete restrict,
  archived boolean not null default true,
  deleted_at timestamptz not null default clock_timestamp(),
  deleted_by uuid references auth.users(id) on delete set null,
  restored_at timestamptz,
  restored_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (law_firm_id,outbox_id),
  check (archived or restored_at is not null)
);
create index sms_history_archives_active_idx on public.sms_history_archives(law_firm_id,outbox_id)
  where archived=true;
alter table public.sms_history_archives enable row level security;
revoke all on public.sms_history_archives from public,anon,authenticated,service_role;
grant select on public.sms_history_archives to authenticated,service_role;
create policy sms_history_archives_manager_read on public.sms_history_archives for select to authenticated
using (
  public.is_active_user()
  and (public.is_super_admin() or law_firm_id=public.current_law_firm_id())
  and (public.is_admin_user() or public.current_platform_role() in ('super_admin','firm_admin'))
);

create function sms_delivery_private.set_history_archived(
  p_actor_id uuid,p_law_firm_id uuid,p_outbox_ids uuid[],p_archived boolean
)
returns table(outbox_id uuid,archived boolean)
language plpgsql security definer set search_path='' as $$
declare v_count integer; v_now timestamptz:=clock_timestamp();
begin
  -- Unlike the send gate, this read-history operation is also allowed for the
  -- reserved demo firm. No message delivery is authorized by this function.
  if p_actor_id is null or p_law_firm_id is null
    or (auth.uid() is not null and auth.uid()<>p_actor_id)
    or not exists(
      select 1 from public.profiles p join public.law_firms f on f.id=p_law_firm_id
      where p.id=p_actor_id and p.is_active=true and f.status='active'
        and (p.platform_role='super_admin' or p.law_firm_id=p_law_firm_id)
        and (p.platform_role in ('super_admin','firm_admin') or p.role='admin')
    ) then raise exception using errcode='42501',message='SMS_HISTORY_MANAGER_REQUIRED'; end if;

  if p_archived is null or p_outbox_ids is null or cardinality(p_outbox_ids) not between 1 and 100
    or array_ndims(p_outbox_ids)<>1 or array_position(p_outbox_ids,null::uuid) is not null
    or (select count(distinct x.id) from unnest(p_outbox_ids) x(id))<>cardinality(p_outbox_ids) then
    raise exception using errcode='22023',message='SMS_HISTORY_BATCH_INVALID';
  end if;

  -- Lock first and validate the whole batch before any archive write. This also
  -- prevents a simultaneous delete/reassignment from passing a stale tenant check.
  perform o.id from public.sms_outbox o
    where o.law_firm_id=p_law_firm_id and o.id=any(p_outbox_ids)
    order by o.id for share;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(p_outbox_ids) then
    raise exception using errcode='42501',message='SMS_HISTORY_ROWS_UNAVAILABLE';
  end if;

  if p_archived then
    insert into public.sms_history_archives as a(law_firm_id,outbox_id,archived,deleted_at,deleted_by,created_at,updated_at)
    select p_law_firm_id,x.id,true,v_now,p_actor_id,v_now,v_now from unnest(p_outbox_ids) x(id) order by x.id
    on conflict on constraint sms_history_archives_pkey do update
      set archived=true,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,updated_at=excluded.updated_at
      where a.archived=false;
    -- Keep previous restored_at/restored_by and original created_at as evidence.
  else
    update public.sms_history_archives a set archived=false,restored_at=v_now,restored_by=p_actor_id,updated_at=v_now
      where a.law_firm_id=p_law_firm_id and a.outbox_id=any(p_outbox_ids) and a.archived=true;
    -- Restoring a never-hidden row is an idempotent no-op, not a synthetic archive.
  end if;
  return query select x.id,coalesce(a.archived,false)
    from unnest(p_outbox_ids) with ordinality x(id,position)
    left join public.sms_history_archives a on a.law_firm_id=p_law_firm_id and a.outbox_id=x.id
    order by x.position;
end;
$$;

create function public.sms_history_set_archived(
  p_actor_id uuid,p_law_firm_id uuid,p_outbox_ids uuid[],p_archived boolean
)
returns table(outbox_id uuid,archived boolean)
language sql security invoker set search_path='' as $$
  select * from sms_delivery_private.set_history_archived(p_actor_id,p_law_firm_id,p_outbox_ids,p_archived);
$$;
revoke all on function sms_delivery_private.set_history_archived(uuid,uuid,uuid[],boolean) from public,anon,authenticated,service_role;
grant execute on function sms_delivery_private.set_history_archived(uuid,uuid,uuid[],boolean) to service_role;
revoke all on function public.sms_history_set_archived(uuid,uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.sms_history_set_archived(uuid,uuid,uuid[],boolean) to service_role;

-- Filter visibility before limiting, so hiding recent rows cannot hide older
-- visible history or require a large client-generated UUID exclusion list.
create function sms_delivery_private.read_history(
  p_actor_id uuid,p_law_firm_id uuid,p_view text,p_limit integer
)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_manager boolean; v_result jsonb;
begin
  if p_actor_id is null or p_law_firm_id is null
    or (auth.uid() is not null and auth.uid()<>p_actor_id) then
    raise exception using errcode='42501',message='SMS_HISTORY_READ_FORBIDDEN';
  end if;
  select (p.platform_role in ('super_admin','firm_admin') or p.role='admin') into v_manager
    from public.profiles p join public.law_firms f on f.id=p_law_firm_id
    where p.id=p_actor_id and p.is_active=true and f.status='active'
      and (p.platform_role='super_admin' or p.law_firm_id=p_law_firm_id)
      and (p.platform_role in ('super_admin','firm_admin') or p.role='admin'
        or p.permissions->'sms.view_history'='true'::jsonb);
  if not found then raise exception using errcode='42501',message='SMS_HISTORY_READ_FORBIDDEN'; end if;
  if p_view is null or p_view not in ('active','deleted') or p_limit is null or p_limit not between 1 and 300 then
    raise exception using errcode='22023',message='SMS_HISTORY_QUERY_INVALID';
  end if;
  if p_view='deleted' and not coalesce(v_manager,false) then
    raise exception using errcode='42501',message='SMS_HISTORY_MANAGER_REQUIRED';
  end if;

  select jsonb_build_object('items',coalesce(jsonb_agg(q.item order by q.created_at desc,q.id desc),'[]'::jsonb)) into v_result
  from (
    select o.id,o.created_at,jsonb_build_object(
      'id',o.id,'recordKind',case when j.id is null then 'legacy' else 'delivery' end,
      'receiverName',o.receiver_name,'receiverNumber',o.receiver_number,'senderNumber',o.sender_number,
      'message',o.message,'msgType',o.msg_type,
      'status',case when j.id is null then o.status
        when j.status='accepted' and j.delivery_state in ('delivered','failed','unknown') then 'delivery_'||j.delivery_state
        else j.status end,
      'source',o.source,'autoKind',o.auto_kind,'createdAt',o.created_at,'reservedAt',o.reserved_at,
      'providerMessageId',coalesce(nullif(j.provider_message_id,''),o.provider_message_id),
      'errorMessage',coalesce(nullif(j.error_code,''),o.error_message),
      'deletedAt',case when a.archived then a.deleted_at else null end
    ) item
    from public.sms_outbox o
    left join public.sms_delivery_jobs j on j.outbox_id=o.id and j.law_firm_id=o.law_firm_id
    left join public.sms_history_archives a on a.outbox_id=o.id and a.law_firm_id=o.law_firm_id
    where o.law_firm_id=p_law_firm_id
      and coalesce(a.archived,false)=(p_view='deleted')
    order by o.created_at desc,o.id desc limit p_limit
  ) q;
  return v_result;
end;
$$;

create function public.sms_history_read(
  p_actor_id uuid,p_law_firm_id uuid,p_view text default 'active',p_limit integer default 300
)
returns jsonb
language sql stable security invoker set search_path='' as $$
  select sms_delivery_private.read_history(p_actor_id,p_law_firm_id,p_view,p_limit);
$$;
revoke all on function sms_delivery_private.read_history(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function sms_delivery_private.read_history(uuid,uuid,text,integer) to service_role;
revoke all on function public.sms_history_read(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.sms_history_read(uuid,uuid,text,integer) to service_role;

commit;
