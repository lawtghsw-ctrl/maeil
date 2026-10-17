-- SMS delivery v1: NEW jobs only. Never replay 022 or adopt legacy sms_outbox rows.
-- Apply this one migration after schema review. It does NOT activate delivery,
-- update prior outbox/settings/guards, call HTTP, or schedule a worker.
-- Public RPCs are service_role-only invoker wrappers. Privileged implementations
-- live in an unexposed schema with an empty search_path and explicit actor checks.
-- Relay credentials and signed media URLs are NEVER persisted here.
begin;

create schema sms_delivery_private;
revoke all on schema sms_delivery_private from public, anon, authenticated;
grant usage on schema sms_delivery_private to service_role;

create table public.sms_delivery_gates (
  law_firm_id uuid primary key references public.law_firms(id) on delete cascade,
  manual_enabled boolean not null default false,
  auto_enabled boolean not null default false,
  epoch_id uuid not null default gen_random_uuid(),
  relay_epoch uuid not null,
  activated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.sms_delivery_requests (
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  payload_hash bytea not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (law_firm_id, request_id)
);

create table public.sms_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  outbox_id uuid not null unique references public.sms_outbox(id) on delete restrict,
  epoch_id uuid not null,
  relay_epoch uuid not null,
  request_id uuid,
  recipient_index integer,
  source text not null check (source in ('manual','file','new_lead','absence')),
  lead_id text,
  sender_number_id uuid not null references public.sms_sender_numbers(id) on delete restrict,
  sender_number text not null,
  receiver_number text not null,
  receiver_name text not null default '',
  message text not null,
  title text not null default '',
  msg_type text not null check (msg_type in ('SMS','LMS','MMS')),
  image_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(image_paths)='array'),
  reserved_at timestamptz,
  available_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','claimed','accepted','failed','unknown','cancelled','expired')),
  attempt_id uuid unique,
  claimed_at timestamptz,
  lease_until timestamptz,
  provider_message_id text,
  provider_code integer,
  error_code text,
  delivery_state text not null default 'unconfirmed' check (delivery_state in ('unconfirmed','delivered','failed','unknown')),
  delivery_checked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  foreign key (law_firm_id, request_id) references public.sms_delivery_requests(law_firm_id, request_id) on delete restrict,
  unique (law_firm_id, request_id, recipient_index),
  check (expires_at > available_at),
  check ((request_id is null and recipient_index is null and source in ('new_lead','absence'))
    or (request_id is not null and recipient_index >= 1 and source in ('manual','file'))),
  check (status not in ('claimed','accepted','unknown') or attempt_id is not null),
  check (status <> 'accepted' or nullif(provider_message_id,'') is not null)
);
create index sms_delivery_jobs_due_idx on public.sms_delivery_jobs(available_at,id) where status='queued';
create index sms_delivery_jobs_lease_idx on public.sms_delivery_jobs(lease_until) where status='claimed';
create index sms_delivery_jobs_history_idx on public.sms_delivery_jobs(law_firm_id,created_at desc,id);
create index sms_delivery_jobs_absence_idx on public.sms_delivery_jobs(law_firm_id,lead_id,created_at desc) where source='absence';
create unique index sms_delivery_jobs_new_lead_once on public.sms_delivery_jobs(law_firm_id,lead_id,epoch_id) where source='new_lead';

-- INSERT-only membership: changing receivedAt/created_at on an old lead cannot
-- make it eligible. Gate rotation invalidates old membership without updating it.
create table public.sms_delivery_lead_epochs (
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  lead_id text not null references public.app_leads(id) on delete cascade,
  epoch_id uuid not null,
  relay_epoch uuid not null,
  observed_at timestamptz not null default clock_timestamp(),
  primary key (law_firm_id,lead_id)
);

create table public.sms_delivery_trigger_errors (
  id bigint generated always as identity primary key,
  law_firm_id uuid,
  lead_id text,
  sql_state text not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.sms_delivery_gates enable row level security;
alter table public.sms_delivery_requests enable row level security;
alter table public.sms_delivery_jobs enable row level security;
alter table public.sms_delivery_lead_epochs enable row level security;
alter table public.sms_delivery_trigger_errors enable row level security;
-- No browser writes and no direct service_role DML: all changes use RPCs.
revoke all on public.sms_delivery_gates, public.sms_delivery_requests, public.sms_delivery_jobs,
  public.sms_delivery_lead_epochs, public.sms_delivery_trigger_errors from public, anon, authenticated, service_role;
revoke all on sequence public.sms_delivery_trigger_errors_id_seq from public, anon, authenticated, service_role;
grant select on public.sms_delivery_gates, public.sms_delivery_jobs, public.sms_delivery_trigger_errors to service_role;
grant select on public.sms_delivery_gates, public.sms_delivery_jobs to authenticated;
create policy sms_delivery_gate_read on public.sms_delivery_gates for select to authenticated using (
  public.is_active_user() and (public.is_super_admin() or law_firm_id=public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('sms.view') or public.has_permission('sms.manage_settings'))
);
create policy sms_delivery_job_read on public.sms_delivery_jobs for select to authenticated using (
  public.is_active_user() and (public.is_super_admin() or law_firm_id=public.current_law_firm_id())
  and (public.is_admin_user() or public.has_permission('sms.view_history'))
);

create function sms_delivery_private.assert_actor(p_actor_id uuid,p_law_firm_id uuid,p_permission text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_actor_id is null or (auth.uid() is not null and auth.uid()<>p_actor_id) or not exists (
    select 1 from public.profiles p join public.law_firms f on f.id=p_law_firm_id
    where p.id=p_actor_id and p.is_active=true and f.status='active'
      and not (f.firm_code='0000000000' and f.name='TEST')
      and (p.platform_role='super_admin' or p.law_firm_id=p_law_firm_id)
      and (p.platform_role in ('super_admin','firm_admin') or p.role='admin' or p.permissions->>p_permission='true')
  ) then raise exception using errcode='42501', message='SMS_ACTOR_FORBIDDEN'; end if;
end;
$$;

create function sms_delivery_private.validate_images(p_law_firm_id uuid,p_images jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v_item jsonb; v_path text;
begin
  if p_images is null or jsonb_typeof(p_images)<>'array' or jsonb_array_length(p_images)>3 then
    raise exception using errcode='22023',message='SMS_IMAGES_INVALID';
  end if;
  for v_item in select value from jsonb_array_elements(p_images) loop
    if jsonb_typeof(v_item)<>'string' then raise exception using errcode='22023',message='SMS_IMAGE_PATH_INVALID'; end if;
    v_path:=v_item#>>'{}';
    if left(v_path,37)<>p_law_firm_id::text||'/' or length(v_path)>1024 or v_path like '%..%'
      or v_path like '%://%' or position(chr(92) in v_path)>0 or v_path ~ '[[:cntrl:]]'
      or v_path !~* '\.(jpe?g|png|gif)$' then
      raise exception using errcode='22023',message='SMS_IMAGE_PATH_INVALID';
    end if;
  end loop;
end;
$$;

create function sms_delivery_private.set_gate(p_actor_id uuid,p_law_firm_id uuid,p_expected_epoch_id uuid,
  p_manual_enabled boolean,p_auto_enabled boolean,p_relay_epoch uuid)
returns setof public.sms_delivery_gates language plpgsql security definer set search_path='' as $$
declare v_gate public.sms_delivery_gates%rowtype;
begin
  perform sms_delivery_private.assert_actor(p_actor_id,p_law_firm_id,'sms.manage_settings');
  if not exists(select 1 from public.profiles p where p.id=p_actor_id
    and (p.platform_role in ('super_admin','firm_admin') or p.role='admin')) then
    raise exception using errcode='42501',message='SMS_GATE_MANAGER_REQUIRED';
  end if;
  if p_manual_enabled is null or p_auto_enabled is null or p_relay_epoch is null then
    raise exception using errcode='22023',message='SMS_GATE_ARGUMENT_INVALID';
  end if;
  select g.* into v_gate from public.sms_delivery_gates g where g.law_firm_id=p_law_firm_id for update;
  if not found then
    if p_expected_epoch_id is not null then raise exception using errcode='40001',message='SMS_GATE_CHANGED'; end if;
    insert into public.sms_delivery_gates(law_firm_id,manual_enabled,auto_enabled,relay_epoch,updated_by)
    values(p_law_firm_id,p_manual_enabled,p_auto_enabled,p_relay_epoch,p_actor_id)
    on conflict do nothing returning * into v_gate;
    if not found then raise exception using errcode='40001',message='SMS_GATE_CHANGED'; end if;
  else
    if p_expected_epoch_id is null or v_gate.epoch_id<>p_expected_epoch_id then
      raise exception using errcode='40001',message='SMS_GATE_CHANGED';
    end if;
    if (v_gate.manual_enabled,v_gate.auto_enabled,v_gate.relay_epoch) is distinct from
       (p_manual_enabled,p_auto_enabled,p_relay_epoch) then
      update public.sms_delivery_gates g set manual_enabled=p_manual_enabled,auto_enabled=p_auto_enabled,
        epoch_id=gen_random_uuid(),relay_epoch=p_relay_epoch,activated_at=clock_timestamp(),
        updated_by=p_actor_id,updated_at=clock_timestamp()
      where g.law_firm_id=p_law_firm_id returning g.* into v_gate;
    end if;
  end if;
  return next v_gate;
end;
$$;

-- Internal constructor ALWAYS creates a new outbox row and a new job together.
-- No API accepts a prior outbox ID, status, creation time, attempt, or signed URL.
create function sms_delivery_private.create_job(p_gate public.sms_delivery_gates,p_actor_id uuid,
  p_request_id uuid,p_recipient_index integer,p_source text,p_lead_id text,p_sender public.sms_sender_numbers,
  p_receiver_number text,p_receiver_name text,p_message text,p_title text,p_msg_type text,p_images jsonb,
  p_reserved_at timestamptz)
returns public.sms_delivery_jobs language plpgsql security invoker set search_path='' as $$
declare v_outbox_id uuid; v_job public.sms_delivery_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  insert into public.sms_outbox(law_firm_id,source,auto_kind,lead_id,sender_number_id,sender_number,
    receiver_number,receiver_name,title,message,msg_type,image_paths,reserved_at,status,created_by,created_at)
  values(p_gate.law_firm_id,p_source,case when p_source in ('new_lead','absence') then p_source else null end,
    p_lead_id,p_sender.id,p_sender.phone,p_receiver_number,coalesce(p_receiver_name,''),coalesce(p_title,''),
    p_message,p_msg_type,p_images,p_reserved_at,'queued',p_actor_id,v_now)
  returning id into v_outbox_id;
  insert into public.sms_delivery_jobs(law_firm_id,outbox_id,epoch_id,relay_epoch,request_id,recipient_index,
    source,lead_id,sender_number_id,sender_number,receiver_number,receiver_name,message,title,msg_type,
    image_paths,reserved_at,available_at,expires_at,created_at)
  values(p_gate.law_firm_id,v_outbox_id,p_gate.epoch_id,p_gate.relay_epoch,p_request_id,p_recipient_index,
    p_source,p_lead_id,p_sender.id,p_sender.phone,p_receiver_number,coalesce(p_receiver_name,''),p_message,
    coalesce(p_title,''),p_msg_type,p_images,p_reserved_at,coalesce(p_reserved_at,v_now),
    coalesce(p_reserved_at,v_now)+case when p_source in ('new_lead','absence') then interval '1 hour' else interval '24 hours' end,v_now)
  returning * into v_job;
  return v_job;
end;
$$;

create function sms_delivery_private.enqueue(p_actor_id uuid,p_law_firm_id uuid,p_epoch_id uuid,p_relay_epoch uuid,
  p_request_id uuid,p_sender_number_id uuid,p_recipients jsonb,p_message text,p_title text,p_image_paths jsonb,
  p_reserved_at timestamptz,p_source text,p_msg_type text)
returns setof public.sms_delivery_jobs language plpgsql security definer set search_path='' as $$
declare v_gate public.sms_delivery_gates%rowtype; v_sender public.sms_sender_numbers%rowtype;
  v_request public.sms_delivery_requests%rowtype; v_hash bytea; v_recipient jsonb; v_index integer:=0;
  v_rendered text; v_bytes integer; v_title text; v_msg_type text;
begin
  perform sms_delivery_private.assert_actor(p_actor_id,p_law_firm_id,'sms.send');
  if p_request_id is null or p_epoch_id is null or p_relay_epoch is null or p_sender_number_id is null
    or p_source not in ('manual','file') or p_source is null or p_message is null or length(btrim(p_message))=0
    or length(p_message)>2000 or length(coalesce(p_title,''))>100 or p_msg_type not in ('SMS','LMS','MMS') or p_msg_type is null
    or p_recipients is null or jsonb_typeof(p_recipients)<>'array' or jsonb_array_length(p_recipients) not between 1 and 1000 then
    raise exception using errcode='22023',message='SMS_REQUEST_INVALID';
  end if;
  perform sms_delivery_private.validate_images(p_law_firm_id,p_image_paths);
  v_hash:=sha256(convert_to(jsonb_build_object('actor',p_actor_id,'epoch',p_epoch_id,'relay',p_relay_epoch,
    'sender',p_sender_number_id,'recipients',p_recipients,'message',p_message,'title',coalesce(p_title,''),
    'images',p_image_paths,'reservedAt',p_reserved_at,'source',p_source,'msgType',p_msg_type)::text,'UTF8'));
  -- Serialize identical request IDs. Collision only causes extra waiting, never a reused job.
  perform pg_advisory_xact_lock(hashtextextended(p_law_firm_id::text||':'||p_request_id::text,0));
  select r.* into v_request from public.sms_delivery_requests r
    where r.law_firm_id=p_law_firm_id and r.request_id=p_request_id;
  if found then
    if v_request.actor_id<>p_actor_id or v_request.payload_hash<>v_hash then
      raise exception using errcode='22023',message='SMS_IDEMPOTENCY_CONFLICT';
    end if;
    return query select j.* from public.sms_delivery_jobs j where j.law_firm_id=p_law_firm_id
      and j.request_id=p_request_id order by j.recipient_index;
    return;
  end if;
  select g.* into v_gate from public.sms_delivery_gates g where g.law_firm_id=p_law_firm_id for share;
  if not found or not v_gate.manual_enabled or v_gate.epoch_id<>p_epoch_id or v_gate.relay_epoch<>p_relay_epoch then
    raise exception using errcode='42501',message='SMS_GATE_CLOSED_OR_CHANGED';
  end if;
  if p_reserved_at is not null and (p_reserved_at<clock_timestamp()+interval '10 minutes'
    or p_reserved_at>clock_timestamp()+interval '1 year') then
    raise exception using errcode='22023',message='SMS_RESERVATION_INVALID';
  end if;
  select s.* into v_sender from public.sms_sender_numbers s
    where s.id=p_sender_number_id and s.law_firm_id=p_law_firm_id and s.is_active=true and s.is_registered=true for share;
  if not found or regexp_replace(v_sender.phone,'\D','','g')<>v_sender.phone or v_sender.phone !~ '^[0-9]{8,11}$' then
    raise exception using errcode='42501',message='SMS_SENDER_UNAVAILABLE';
  end if;
  if exists(select 1 from jsonb_array_elements(p_recipients) r
    where jsonb_typeof(r)<>'object' or jsonb_typeof(r->'phone')<>'string' or coalesce(r->>'phone','') !~ '^[0-9]{9,11}$'
      or length(coalesce(r->>'name',''))>100) then
    raise exception using errcode='22023',message='SMS_RECIPIENT_INVALID';
  end if;
  if (select count(distinct r->>'phone') from jsonb_array_elements(p_recipients) r)<>jsonb_array_length(p_recipients) then
    raise exception using errcode='22023',message='SMS_RECIPIENT_DUPLICATE';
  end if;
  insert into public.sms_delivery_requests(law_firm_id,request_id,actor_id,payload_hash)
  values(p_law_firm_id,p_request_id,p_actor_id,v_hash);
  for v_recipient in select value from jsonb_array_elements(p_recipients) loop
    v_index:=v_index+1;
    v_rendered:=public.sms_apply_vars(p_message,v_recipient->>'name',v_sender.staff_name);
    v_bytes:=octet_length(convert_to(v_rendered,'EUC_KR'));
    if v_bytes not between 1 and 2000 then raise exception using errcode='22023',message='SMS_MESSAGE_BYTES_INVALID'; end if;
    v_msg_type:=case when jsonb_array_length(p_image_paths)>0 then 'MMS' when v_bytes>90 then 'LMS' else 'SMS' end;
    v_title:=case when v_msg_type='SMS' then '' else coalesce(p_title,'') end;
    if octet_length(convert_to(v_title,'EUC_KR'))>44 then raise exception using errcode='22023',message='SMS_TITLE_BYTES_INVALID'; end if;
    return next sms_delivery_private.create_job(v_gate,p_actor_id,p_request_id,v_index,p_source,null,v_sender,
      v_recipient->>'phone',v_recipient->>'name',v_rendered,v_title,v_msg_type,p_image_paths,p_reserved_at);
  end loop;
end;
$$;

create function sms_delivery_private.claim(p_relay_epoch uuid,p_limit integer,p_lease_seconds integer)
returns setof public.sms_delivery_jobs language plpgsql security definer set search_path='' as $$
declare v_job public.sms_delivery_jobs%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_relay_epoch is null or p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then
    raise exception using errcode='22023',message='SMS_CLAIM_ARGUMENT_INVALID';
  end if;
  -- A lost response is not evidence that the provider did not send. Never reclaim.
  for v_job in update public.sms_delivery_jobs j set status='unknown',error_code='CLAIM_LEASE_EXPIRED',
    delivery_state='unknown',completed_at=v_now where j.status='claimed' and j.lease_until<v_now returning j.* loop
    update public.sms_outbox o set status='sending',error_message='발송 결과 확인 필요',
      provider_result=jsonb_build_object('deliveryState','unknown','jobId',v_job.id)
    where o.id=v_job.outbox_id;
  end loop;
  -- Only our newly-created job mirrors are touched. Legacy pending rows are absent from this join.
  for v_job in update public.sms_delivery_jobs j set
      status=case when j.expires_at<=v_now then 'expired' else 'cancelled' end,
      error_code=case when j.expires_at<=v_now then 'DELIVERY_WINDOW_EXPIRED' else 'GATE_CHANGED_OR_DISABLED' end,
      completed_at=v_now
    where j.status='queued' and (j.expires_at<=v_now or j.relay_epoch<>p_relay_epoch or not exists(
      select 1 from public.sms_delivery_gates g join public.law_firms f on f.id=g.law_firm_id
      where g.law_firm_id=j.law_firm_id and g.epoch_id=j.epoch_id and g.relay_epoch=j.relay_epoch and f.status='active'
        and not (f.firm_code='0000000000' and f.name='TEST')
        and case when j.source in ('new_lead','absence') then g.auto_enabled else g.manual_enabled end
        and (j.source in ('new_lead','absence') or exists(
          select 1 from public.sms_delivery_requests r join public.profiles p on p.id=r.actor_id
          where r.law_firm_id=j.law_firm_id and r.request_id=j.request_id and p.is_active=true
            and (p.platform_role='super_admin' or p.law_firm_id=j.law_firm_id)
            and (p.platform_role in ('super_admin','firm_admin') or p.role='admin' or p.permissions->>'sms.send'='true')
        ))
    )) returning j.* loop
    update public.sms_outbox o set status='cancelled',error_message=v_job.error_code,
      provider_result=jsonb_build_object('deliveryState',v_job.status,'jobId',v_job.id)
    where o.id=v_job.outbox_id;
  end loop;
  for v_job in
    with candidates as (
      select j.id from public.sms_delivery_jobs j join public.sms_delivery_gates g on g.law_firm_id=j.law_firm_id
      join public.law_firms f on f.id=j.law_firm_id
      join public.sms_sender_numbers s on s.id=j.sender_number_id and s.law_firm_id=j.law_firm_id
      where j.status='queued' and j.available_at<=v_now and j.expires_at>v_now and j.relay_epoch=p_relay_epoch
        and g.epoch_id=j.epoch_id and g.relay_epoch=j.relay_epoch and f.status='active'
        and not (f.firm_code='0000000000' and f.name='TEST')
        and s.is_active=true and s.is_registered=true and s.phone=j.sender_number
        and case when j.source in ('new_lead','absence') then g.auto_enabled else g.manual_enabled end
        and (j.source in ('new_lead','absence') or exists(
          select 1 from public.sms_delivery_requests r join public.profiles p on p.id=r.actor_id
          where r.law_firm_id=j.law_firm_id and r.request_id=j.request_id and p.is_active=true
            and (p.platform_role='super_admin' or p.law_firm_id=j.law_firm_id)
            and (p.platform_role in ('super_admin','firm_admin') or p.role='admin' or p.permissions->>'sms.send'='true')
        ))
      order by j.available_at,j.id limit p_limit for update of j skip locked for share of g skip locked
    )
    update public.sms_delivery_jobs j set status='claimed',attempt_id=gen_random_uuid(),claimed_at=v_now,
      lease_until=v_now+make_interval(secs=>p_lease_seconds)
    from candidates c where j.id=c.id returning j.*
  loop
    update public.sms_outbox o set status='sending',error_message=null,
      provider_result=jsonb_build_object('deliveryState','claimed','jobId',v_job.id) where o.id=v_job.outbox_id;
    return next v_job;
  end loop;
end;
$$;

create function sms_delivery_private.finish(p_job_id uuid,p_attempt_id uuid,p_outcome text,
  p_provider_message_id text,p_provider_code integer,p_error_code text)
returns setof public.sms_delivery_jobs language plpgsql security definer set search_path='' as $$
declare v_job public.sms_delivery_jobs%rowtype;
begin
  if p_outcome is null or p_outcome not in ('accepted','failed','unknown') or length(coalesce(p_error_code,''))>100
    or coalesce(p_error_code,'') !~ '^[A-Z0-9_]*$' or length(coalesce(p_provider_message_id,''))>100
    or (p_outcome='accepted' and nullif(btrim(p_provider_message_id),'') is null) then
    raise exception using errcode='22023',message='SMS_FINISH_ARGUMENT_INVALID';
  end if;
  select j.* into v_job from public.sms_delivery_jobs j where j.id=p_job_id for update;
  if not found or p_attempt_id is null or v_job.attempt_id is distinct from p_attempt_id then
    raise exception using errcode='22023',message='SMS_ATTEMPT_NOT_FOUND';
  end if;
  if v_job.status<>'claimed' then
    -- Repeating a committed finish is safe; never overwrite unknown with a retry.
    if v_job.status=p_outcome and v_job.provider_message_id is not distinct from p_provider_message_id then return next v_job; return; end if;
    raise exception using errcode='40001',message='SMS_ATTEMPT_ALREADY_FINISHED';
  end if;
  update public.sms_delivery_jobs j set status=p_outcome,provider_message_id=p_provider_message_id,
    provider_code=p_provider_code,error_code=p_error_code,completed_at=clock_timestamp(),
    delivery_state=case when p_outcome='unknown' then 'unknown' else 'unconfirmed' end
  where j.id=p_job_id returning j.* into v_job;
  update public.sms_outbox o set status=case when p_outcome='failed' then 'failed' else 'sending' end,
    provider_message_id=p_provider_message_id,
    provider_result=jsonb_build_object('deliveryState',p_outcome,'jobId',v_job.id,'providerCode',p_provider_code),
    error_message=case when p_outcome='unknown' then '발송 결과 확인 필요' else p_error_code end
  where o.id=v_job.outbox_id;
  return next v_job;
end;
$$;

create function sms_delivery_private.reconcile(p_job_id uuid,p_attempt_id uuid,p_delivery_state text,p_provider_code integer)
returns setof public.sms_delivery_jobs language plpgsql security definer set search_path='' as $$
declare v_job public.sms_delivery_jobs%rowtype;
begin
  if p_delivery_state is null or p_delivery_state not in ('delivered','failed','unknown','pending') then
    raise exception using errcode='22023',message='SMS_RECEIPT_ARGUMENT_INVALID';
  end if;
  select j.* into v_job from public.sms_delivery_jobs j where j.id=p_job_id for update;
  if not found or v_job.status<>'accepted' or p_attempt_id is null or v_job.attempt_id is distinct from p_attempt_id then
    raise exception using errcode='22023',message='SMS_ACCEPTED_ATTEMPT_NOT_FOUND';
  end if;
  if v_job.delivery_state in ('delivered','failed') then
    if v_job.delivery_state=p_delivery_state then return next v_job; return; end if;
    raise exception using errcode='40001',message='SMS_RECEIPT_ALREADY_FINAL';
  end if;
  if p_delivery_state='pending' then
    update public.sms_delivery_jobs j set delivery_checked_at=clock_timestamp()
    where j.id=p_job_id returning j.* into v_job;
    return next v_job;
    return;
  end if;
  update public.sms_delivery_jobs j set delivery_state=p_delivery_state,delivery_checked_at=clock_timestamp(),
    provider_code=coalesce(p_provider_code,j.provider_code) where j.id=p_job_id returning j.* into v_job;
  update public.sms_outbox o set status=case p_delivery_state when 'delivered' then 'sent' when 'failed' then 'failed' else 'sending' end,
    sent_at=case when p_delivery_state='delivered' then clock_timestamp() else null end,
    provider_result=jsonb_build_object('deliveryState',p_delivery_state,'jobId',v_job.id,'providerCode',p_provider_code),
    error_message=case when p_delivery_state='unknown' then '발송 결과 확인 필요' when p_delivery_state='failed' then '배달 실패' else null end
  where o.id=v_job.outbox_id;
  return next v_job;
end;
$$;

-- Service RPC signatures consumed by /api/sms/*. Parameters never contain API secrets.
create function public.sms_delivery_set_gate(p_actor_id uuid,p_law_firm_id uuid,p_expected_epoch_id uuid,
  p_manual_enabled boolean,p_auto_enabled boolean,p_relay_epoch uuid)
returns setof public.sms_delivery_gates language sql security invoker set search_path='' as $$
  select * from sms_delivery_private.set_gate(p_actor_id,p_law_firm_id,p_expected_epoch_id,p_manual_enabled,p_auto_enabled,p_relay_epoch);
$$;
create function public.sms_delivery_enqueue(p_actor_id uuid,p_law_firm_id uuid,p_epoch_id uuid,p_relay_epoch uuid,
  p_request_id uuid,p_sender_number_id uuid,p_recipients jsonb,p_message text,p_title text default '',
  p_image_paths jsonb default '[]',p_reserved_at timestamptz default null,p_source text default 'manual',p_msg_type text default 'SMS')
returns setof public.sms_delivery_jobs language sql security invoker set search_path='' as $$
  select * from sms_delivery_private.enqueue(p_actor_id,p_law_firm_id,p_epoch_id,p_relay_epoch,p_request_id,p_sender_number_id,
    p_recipients,p_message,p_title,p_image_paths,p_reserved_at,p_source,p_msg_type);
$$;
create function public.sms_delivery_claim(p_relay_epoch uuid,p_limit integer default 20,p_lease_seconds integer default 120)
returns setof public.sms_delivery_jobs language sql security invoker set search_path='' as $$
  select * from sms_delivery_private.claim(p_relay_epoch,p_limit,p_lease_seconds);
$$;
create function public.sms_delivery_finish(p_job_id uuid,p_attempt_id uuid,p_outcome text,
  p_provider_message_id text default null,p_provider_code integer default null,p_error_code text default null)
returns setof public.sms_delivery_jobs language sql security invoker set search_path='' as $$
  select * from sms_delivery_private.finish(p_job_id,p_attempt_id,p_outcome,p_provider_message_id,p_provider_code,p_error_code);
$$;
create function public.sms_delivery_reconcile(p_job_id uuid,p_attempt_id uuid,p_delivery_state text,p_provider_code integer default null)
returns setof public.sms_delivery_jobs language sql security invoker set search_path='' as $$
  select * from sms_delivery_private.reconcile(p_job_id,p_attempt_id,p_delivery_state,p_provider_code);
$$;

-- Replaces the old trigger function without running 022's destructive data updates.
-- All auto delivery is new-event/new-membership-only; old data timestamps are irrelevant.
create or replace function public.enqueue_lead_auto_sms()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_gate public.sms_delivery_gates%rowtype; v_cfg public.sms_automation_settings%rowtype;
  v_staff_cfg public.sms_staff_automation_settings%rowtype; v_sender public.sms_sender_numbers%rowtype;
  v_staff_name text; v_name text; v_phone text; v_kind text; v_template text; v_images jsonb;
  v_has_staff boolean; v_enabled boolean; v_rendered text; v_msg_type text; v_duplicate_minutes integer;
  v_old_log jsonb; v_new_log jsonb; v_old_len integer:=0; v_new_len integer:=0; v_now timestamptz:=clock_timestamp();
begin
  if new.law_firm_id is null then return new; end if;
  select g.* into v_gate from public.sms_delivery_gates g join public.law_firms f on f.id=g.law_firm_id
    where g.law_firm_id=new.law_firm_id and g.auto_enabled=true and f.status='active'
      and not (f.firm_code='0000000000' and f.name='TEST') for share of g;
  if not found then return new; end if;
  if auth.uid() is not null and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active=true
    and (p.platform_role='super_admin' or p.law_firm_id=new.law_firm_id)) then return new; end if;
  if tg_op='INSERT' then
    insert into public.sms_delivery_lead_epochs(law_firm_id,lead_id,epoch_id,relay_epoch,observed_at)
    values(new.law_firm_id,new.id,v_gate.epoch_id,v_gate.relay_epoch,v_now) on conflict do nothing;
    v_kind:='new_lead';
  elsif tg_op='UPDATE' then
    if new.law_firm_id is distinct from old.law_firm_id then return new; end if;
    v_old_log:=old.data#>'{consultation,memoLog}'; v_new_log:=new.data#>'{consultation,memoLog}';
    if jsonb_typeof(v_old_log)='array' then v_old_len:=jsonb_array_length(v_old_log); end if;
    if jsonb_typeof(v_new_log)='array' then v_new_len:=jsonb_array_length(v_new_log); end if;
    if not ((v_new_len>v_old_len and coalesce((v_new_log->(v_new_len-1))->>'tag','')='부재중')
      or (coalesce(new.data->>'detailStage','')='부재' and coalesce(old.data->>'detailStage','') is distinct from '부재')
      or (coalesce(new.data->>'status','')='부재중' and coalesce(old.data->>'status','') is distinct from '부재중')) then return new; end if;
    v_kind:='absence';
  else return new;
  end if;
  if not exists(select 1 from public.sms_delivery_lead_epochs m where m.law_firm_id=new.law_firm_id and m.lead_id=new.id
    and m.epoch_id=v_gate.epoch_id and m.relay_epoch=v_gate.relay_epoch and m.observed_at>=v_gate.activated_at) then return new; end if;
  select c.* into v_cfg from public.sms_automation_settings c where c.law_firm_id=new.law_firm_id;
  -- Missing settings do not create defaults or silently opt a firm into automation.
  v_staff_name:=coalesce(nullif(new.data->>'assignedStaff',''),'담당자');
  v_name:=coalesce(nullif(new.data->>'name',''),'고객');
  v_phone:=regexp_replace(coalesce(new.data->>'phone',''),'\D','','g');
  if v_phone !~ '^[0-9]{9,11}$' then return new; end if;
  select s.* into v_staff_cfg from public.sms_staff_automation_settings s
    where s.law_firm_id=new.law_firm_id and s.staff_name=v_staff_name limit 1;
  v_has_staff:=found;
  if v_kind='new_lead' then
    v_enabled:=case when v_has_staff then v_staff_cfg.new_lead_enabled else coalesce(v_cfg.new_lead_enabled,false) end;
    v_template:=case when v_has_staff then v_staff_cfg.new_lead_template else v_cfg.new_lead_template end;
    v_images:=case when v_has_staff then v_staff_cfg.new_lead_image_paths else '[]'::jsonb end;
  else
    v_enabled:=case when v_has_staff then v_staff_cfg.absence_enabled else coalesce(v_cfg.absence_enabled,false) end;
    v_template:=case when v_has_staff then v_staff_cfg.absence_template else v_cfg.absence_template end;
    v_images:=case when v_has_staff then v_staff_cfg.absence_image_paths else '[]'::jsonb end;
  end if;
  if not coalesce(v_enabled,false) then return new; end if;
  perform sms_delivery_private.validate_images(new.law_firm_id,v_images);
  if v_has_staff and v_staff_cfg.sender_number_id is not null then
    select s.* into v_sender from public.sms_sender_numbers s where s.id=v_staff_cfg.sender_number_id
      and s.law_firm_id=new.law_firm_id and s.is_active=true and s.is_registered=true;
    -- Explicit invalid selection must not silently fall back to another employee's number.
    if not found then return new; end if;
  else
    select s.* into v_sender from public.sms_sender_numbers s where s.law_firm_id=new.law_firm_id
      and s.is_active=true and s.is_registered=true and s.staff_name=v_staff_name
      order by s.is_default desc,s.created_at,s.id limit 1;
    if not found then
      select s.* into v_sender from public.sms_sender_numbers s where s.law_firm_id=new.law_firm_id
        and s.is_active=true and s.is_registered=true and s.is_default=true order by s.created_at,s.id limit 1;
    end if;
  end if;
  if v_sender.id is null or v_sender.phone !~ '^[0-9]{8,11}$' then return new; end if;
  v_rendered:=public.sms_apply_vars(v_template,v_name,v_staff_name);
  if coalesce(length(btrim(v_rendered)),0)=0 or length(v_rendered)>2000
    or octet_length(convert_to(v_rendered,'EUC_KR'))>2000 then return new; end if;
  v_msg_type:=case when jsonb_array_length(v_images)>0 then 'MMS'
    when octet_length(convert_to(v_rendered,'EUC_KR'))>90 then 'LMS' else 'SMS' end;
  v_duplicate_minutes:=greatest(0,least(60,coalesce(v_cfg.duplicate_guard_minutes,5)));
  if v_kind='absence' and v_duplicate_minutes>0 and exists(select 1 from public.sms_delivery_jobs j
    where j.law_firm_id=new.law_firm_id and j.lead_id=new.id and j.epoch_id=v_gate.epoch_id and j.source='absence'
      and j.created_at>=v_now-make_interval(mins=>v_duplicate_minutes)) then return new; end if;
  perform sms_delivery_private.create_job(v_gate,auth.uid(),null,null,v_kind,new.id,v_sender,v_phone,v_name,
    v_rendered,'',v_msg_type,v_images,null);
  return new;
exception when others then
  -- The exception rolls back only this trigger's SMS writes, not the lead save.
  -- No message/phone/API secrets or raw SQLERRM are logged.
  begin
    insert into public.sms_delivery_trigger_errors(law_firm_id,lead_id,sql_state)
    values(new.law_firm_id,new.id,sqlstate);
  exception when others then null;
  end;
  return new;
end;
$$;

revoke all on all functions in schema sms_delivery_private from public, anon, authenticated, service_role;
grant execute on function sms_delivery_private.set_gate(uuid,uuid,uuid,boolean,boolean,uuid),
  sms_delivery_private.enqueue(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text,jsonb,timestamptz,text,text),
  sms_delivery_private.claim(uuid,integer,integer),sms_delivery_private.finish(uuid,uuid,text,text,integer,text),
  sms_delivery_private.reconcile(uuid,uuid,text,integer) to service_role;
revoke all on function public.enqueue_lead_auto_sms() from public, anon, authenticated, service_role;
revoke all on function public.sms_delivery_set_gate(uuid,uuid,uuid,boolean,boolean,uuid),
  public.sms_delivery_enqueue(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text,jsonb,timestamptz,text,text),
  public.sms_delivery_claim(uuid,integer,integer),public.sms_delivery_finish(uuid,uuid,text,text,integer,text),
  public.sms_delivery_reconcile(uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.sms_delivery_set_gate(uuid,uuid,uuid,boolean,boolean,uuid),
  public.sms_delivery_enqueue(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text,jsonb,timestamptz,text,text),
  public.sms_delivery_claim(uuid,integer,integer),public.sms_delivery_finish(uuid,uuid,text,text,integer,text),
  public.sms_delivery_reconcile(uuid,uuid,text,integer) to service_role;

-- The old trigger already invokes this function OID. Fail closed if the expected
-- trigger is absent rather than deploying a partially functioning integration.
do $$ begin
  if not exists(select 1 from pg_trigger t where t.tgname='trg_app_leads_auto_sms'
    and t.tgrelid='public.app_leads'::regclass and not t.tgisinternal and t.tgenabled in ('O','A')) then
    raise exception 'SMS_EXISTING_TRIGGER_MISSING';
  end if;
end $$;
commit;
