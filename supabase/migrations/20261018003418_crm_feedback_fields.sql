begin;
-- Add metadata only when a user next performs the related action. No historical backfill.
create function public.crm_feedback_lead_metadata() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor text; entries jsonb; entry jsonb; recorded_at timestamptz;
begin
 if tg_op='UPDATE' and new.data->>'detailStage' is distinct from old.data->>'detailStage' then
  new.data:=new.data||jsonb_build_object('stageUpdatedAt',now());
 elsif tg_op='INSERT' then
  new.data:=new.data||jsonb_build_object('stageUpdatedAt',now());
 end if;
 if tg_op='UPDATE' and old.data ? 'contactLog' and not (new.data ? 'contactLog') then
  new.data:=jsonb_set(new.data,'{contactLog}',old.data->'contactLog');
 end if;
 if new.data ? 'contactLog' and (tg_op='INSERT' or new.data->'contactLog' is distinct from old.data->'contactLog') then
  if jsonb_typeof(new.data->'contactLog')<>'array' or jsonb_array_length(new.data->'contactLog')>5000 then raise exception 'INVALID_CONTACT_LOG';end if;
  for entry in select value from jsonb_array_elements(new.data->'contactLog') loop
   if jsonb_typeof(entry)<>'object' or coalesce(entry->>'id','')='' or coalesce(entry->>'type','') not in ('phone','sms') or coalesce(entry->>'at','')='' then raise exception 'INVALID_CONTACT_LOG';end if;
   recorded_at:=(entry->>'at')::timestamptz;
   if not isfinite(recorded_at) or (entry ? 'connected' and jsonb_typeof(entry->'connected')<>'boolean') then raise exception 'INVALID_CONTACT_LOG';end if;
   if entry ? 'durationSeconds' then
    if jsonb_typeof(entry->'durationSeconds')<>'number' or (entry->>'durationSeconds')::numeric not between 0 and 86400 or trunc((entry->>'durationSeconds')::numeric)<>(entry->>'durationSeconds')::numeric then raise exception 'INVALID_CONTACT_LOG';end if;
   end if;
  end loop;
  select coalesce(nullif(display_name,''),nullif(staff_name,''),'사용자') into actor from profiles where id=auth.uid();
  -- Existing records are append-only; concurrent contact additions cannot erase each other.
  select coalesce(jsonb_agg(item order by item->>'at',item->>'id'),'[]') into entries from (
   select distinct on (item->>'id') item from (
    select x item,0 priority from jsonb_array_elements(case when tg_op='UPDATE' then coalesce(old.data->'contactLog','[]') else '[]'::jsonb end) x
    union all select case when actor is not null then x||jsonb_build_object('staff',actor) else x end,1 from jsonb_array_elements(new.data->'contactLog') x
   ) q order by item->>'id',priority
  ) merged;
  new.data:=jsonb_set(new.data,'{contactLog}',entries);
 end if;
 return new;
end;$$;
revoke all on function public.crm_feedback_lead_metadata() from public,anon,authenticated;
create trigger crm_feedback_lead_metadata before insert or update of data on public.app_leads for each row execute function public.crm_feedback_lead_metadata();

create function public.crm_feedback_case_metadata() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare rule jsonb; role_name text; actor_name text;
begin
 if tg_op='INSERT' then
  select r into rule from public.firm_settings s cross join lateral jsonb_array_elements(coalesce(s.value->'feeRules','[]')) r
  where s.law_firm_id=new.law_firm_id and s.key='management_analytics_v1' and r->>'caseType'=new.data->>'caseType'
   and r->>'effectiveFrom'<=new.data->>'contractDate'
  order by r->>'effectiveFrom' desc,r->>'id' desc limit 1;
  if rule is not null then new.data:=new.data||jsonb_build_object('feeStandardSnapshot',jsonb_build_object('baseFee',rule->'baseFee','minFee',rule->'minFee','approvalDiscountAmount',rule->'approvalDiscountAmount','effectiveFrom',rule->'effectiveFrom','capturedAt',now()));
  else new.data:=new.data-'feeStandardSnapshot';end if;
 elsif old.data ? 'feeStandardSnapshot' then
  new.data:=jsonb_set(new.data,'{feeStandardSnapshot}',old.data->'feeStandardSnapshot');
 else
  -- Do not fabricate a contract-time fee for an older contract.
  new.data:=new.data-'feeStandardSnapshot';
 end if;
 if tg_op='UPDATE' and new.data->>'stage' is distinct from old.data->>'stage' then
  new.data:=new.data||jsonb_build_object('stageUpdatedAt',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'));
 end if;
 if tg_op='UPDATE' and new.data->>'contractAmount' is distinct from old.data->>'contractAmount' then
  -- An approval is for the reviewed amount, not any future discount.
  new.data:=new.data-'discountApprovedBy';
 elsif (tg_op='INSERT' and new.data ? 'discountApprovedBy') or (tg_op='UPDATE' and new.data->>'discountApprovedBy' is distinct from old.data->>'discountApprovedBy') then
  select platform_role,coalesce(nullif(display_name,''),nullif(staff_name,''),'관리자') into role_name,actor_name from profiles where id=auth.uid();
  if role_name not in ('super_admin','firm_admin') or role_name is null then raise exception 'DISCOUNT_APPROVAL_MANAGER_REQUIRED';end if;
  new.data:=new.data||jsonb_build_object('discountApprovedBy',actor_name);
 end if;
 return new;
end;$$;
revoke all on function public.crm_feedback_case_metadata() from public,anon,authenticated;
create trigger crm_feedback_case_metadata before insert or update of data on public.app_cases for each row execute function public.crm_feedback_case_metadata();
commit;
