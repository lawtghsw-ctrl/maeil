-- Adds application-slot variables for future requests/events only.
-- No replay, no data rewrite, and no changes to gates, epochs or claim rules.
begin;
create function public.sms_apply_consult_time(p_message text,p_consult_time text)
returns text language sql immutable security invoker set search_path='' as $$
  select replace(replace(coalesce(p_message,''),'{상담시간대}',
    coalesce(nullif(left(btrim(regexp_replace(coalesce(p_consult_time,''),'[[:cntrl:]]',' ','g')),200),''),'미지정')),
    '{상담시간}',coalesce(nullif(left(btrim(regexp_replace(coalesce(p_consult_time,''),'[[:cntrl:]]',' ','g')),200),''),'미지정'));
$$;
revoke all on function public.sms_apply_consult_time(text,text) from public,anon,authenticated;
grant execute on function public.sms_apply_consult_time(text,text) to service_role;

create or replace function sms_delivery_private.enqueue(p_actor_id uuid,p_law_firm_id uuid,p_epoch_id uuid,p_relay_epoch uuid,
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
      or length(coalesce(r->>'name',''))>100
      or (r ? 'consultTime' and (jsonb_typeof(r->'consultTime')<>'string' or length(r->>'consultTime')>200 or (r->>'consultTime') ~ '[[:cntrl:]]'))) then
    raise exception using errcode='22023',message='SMS_RECIPIENT_INVALID';
  end if;
  if (select count(distinct r->>'phone') from jsonb_array_elements(p_recipients) r)<>jsonb_array_length(p_recipients) then
    raise exception using errcode='22023',message='SMS_RECIPIENT_DUPLICATE';
  end if;
  insert into public.sms_delivery_requests(law_firm_id,request_id,actor_id,payload_hash)
  values(p_law_firm_id,p_request_id,p_actor_id,v_hash);
  for v_recipient in select value from jsonb_array_elements(p_recipients) loop
    v_index:=v_index+1;
    v_rendered:=public.sms_apply_consult_time(public.sms_apply_vars(p_message,v_recipient->>'name',v_sender.staff_name),v_recipient->>'consultTime');
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
  v_rendered:=public.sms_apply_consult_time(public.sms_apply_vars(v_template,v_name,v_staff_name),coalesce(nullif(btrim(new.data->>'consultTime'),''),new.data->>'consultTimeRaw'));
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
commit;
