-- Same-firm ordinary collaborative edits, never a blanket UPDATE policy.
-- Prepared from read-only live metadata, 2026-10-28. No customer/profile backfill.
begin;
create schema if not exists long_absent_private;
revoke all on schema long_absent_private from public, anon, authenticated, service_role;
grant usage on schema long_absent_private to authenticated;

create or replace function long_absent_private.can_manage(lead_data jsonb, firm_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(auth.uid() is not null and public.is_active_user()
  and firm_id=public.current_law_firm_id() and public.has_permission('db.view')
  and not public.is_writing_staff() and (
   lead_data->>'detailStage'='장기부재'
   or ((lead_data->'detailStage' is null or lead_data->'detailStage'='null'::jsonb)
    and lead_data->>'status'='종결_중단')),false);
$$;

-- Only used inside existing definer triggers. All non-shared permission paths
-- remain unchanged. Derived fields below are maintained by existing triggers;
-- the RPC does not accept them as user-supplied patch keys.
create or replace function long_absent_private.allowed_update(old_row public.app_leads, new_row public.app_leads)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select long_absent_private.can_manage(old_row.data,old_row.law_firm_id)
  and old_row.id=new_row.id and old_row.law_firm_id=new_row.law_firm_id
  -- A raw status alias must not grant conversion through an existing owner's
  -- direct PATCH either. The original conversion-permission branch still works.
  and (new_row.data->>'status' is distinct from '수임전환' or old_row.data->>'status' is not distinct from '수임전환')
  and (old_row.data-array['name','phone','email','applicationType','memo','consultation','contactLog','invalidReason','nonContractReason','replacementRequestedAt','detailStage','status','assignedStaff','reservationAt','stageUpdatedAt','debtRange','incomeRange','consultTime'])
      is not distinct from (new_row.data-array['name','phone','email','applicationType','memo','consultation','contactLog','invalidReason','nonContractReason','replacementRequestedAt','detailStage','status','assignedStaff','reservationAt','stageUpdatedAt','debtRange','incomeRange','consultTime'])
  and new_row.data->'stageUpdatedAt' is not distinct from
   (case when new_row.data->>'detailStage' is distinct from old_row.data->>'detailStage'
    then to_jsonb(now()) else old_row.data->'stageUpdatedAt' end)
  and new_row.data->'debtRange' is not distinct from coalesce(to_jsonb(public.lawpower_normalize_debt_range(
   coalesce(nullif(old_row.data->>'debtRange',''),old_row.data->>'debtRaw'))),old_row.data->'debtRange')
  and new_row.data->'incomeRange' is not distinct from coalesce(to_jsonb(public.lawpower_normalize_income_range(
   coalesce(nullif(old_row.data->>'incomeRange',''),old_row.data->>'incomeRaw'))),old_row.data->'incomeRange')
  and new_row.data->'consultTime' is not distinct from coalesce(to_jsonb(public.lawpower_normalize_consult_time(
   coalesce(nullif(old_row.data->>'consultTimeRaw',''),nullif(old_row.data->>'consultTime','')))),old_row.data->'consultTime')
  and (old_row.data->'assignedStaff' is not distinct from new_row.data->'assignedStaff' or (
   jsonb_typeof(new_row.data->'assignedStaff')='string' and
   (select count(*) from public.profiles p where p.law_firm_id=old_row.law_firm_id
    and p.is_active and p.is_work_staff and p.staff_name=new_row.data->>'assignedStaff')=1));
$$;
revoke all on function long_absent_private.can_manage(jsonb,uuid),
 long_absent_private.allowed_update(public.app_leads,public.app_leads) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enforce_lead_update_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' or public.is_admin_user() then return new; end if;
  if long_absent_private.allowed_update(old, new) then return new; end if;

  if old.data -> 'consultation' is distinct from new.data -> 'consultation'
     and not public.has_permission('db.edit_consultation') then
    raise exception '상담일지 수정 권한이 없습니다.';
  end if;

  if ((old.data -> 'detailStage' is distinct from new.data -> 'detailStage')
      or (old.data -> 'status' is distinct from new.data -> 'status'))
     and not (
       public.has_permission('db.change_stage')
       or (
         public.has_permission('db.convert')
         and new.data ->> 'convertedClientId' is not null
         and new.data ->> 'status' = '수임전환'
       )
     ) then
    raise exception 'DB 진행단계 변경 권한이 없습니다.';
  end if;

  if old.data -> 'assignedStaff' is distinct from new.data -> 'assignedStaff'
     and not public.has_permission('db.change_assignee') then
    raise exception 'DB 담당자 변경 권한이 없습니다.';
  end if;

  if old.data -> 'reservationAt' is distinct from new.data -> 'reservationAt'
     and not public.has_permission('db.manage_reservation') then
    raise exception '예약일정 변경 권한이 없습니다.';
  end if;

  if old.data -> 'convertedClientId' is distinct from new.data -> 'convertedClientId'
     and not public.has_permission('db.convert') then
    raise exception '고객전환 권한이 없습니다.';
  end if;

  if old.data -> 'convertedCaseId' is distinct from new.data -> 'convertedCaseId'
     and not (
       public.has_any_permission(array['db.convert','cases.create'])
       or (
         public.has_permission('cases.delete')
         and old.data ->> 'convertedCaseId' is not null
         and new.data ->> 'convertedCaseId' is null
       )
     ) then
    raise exception '계약 연결 변경 권한이 없습니다.';
  end if;

  if (old.data - array['consultation','detailStage','status','assignedStaff','reservationAt','convertedClientId','convertedCaseId'])
      is distinct from
     (new.data - array['consultation','detailStage','status','assignedStaff','reservationAt','convertedClientId','convertedCaseId'])
     and not public.has_permission('db.edit_basic') then
    raise exception 'DB 기본정보 수정 권한이 없습니다.';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_converted_lead_phone_to_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  linked_client_id text;
  phone text;
BEGIN
  IF OLD.data -> 'phone' IS NOT DISTINCT FROM NEW.data -> 'phone' THEN RETURN NEW; END IF;
  -- Existing lead UPDATE RLS and detailed field guards remain in place. This
  -- additional check also protects the SECURITY DEFINER client write.
  IF NOT COALESCE(auth.role() = 'service_role'
      OR (public.is_active_user() AND (public.is_admin_user() OR public.has_permission('db.edit_basic')))
      OR long_absent_private.allowed_update(old, new), false) THEN
    RAISE EXCEPTION 'DB 기본정보 수정 권한이 없습니다.';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.law_firm_id IS DISTINCT FROM NEW.law_firm_id
     OR OLD.data ->> 'convertedClientId' IS DISTINCT FROM NEW.data ->> 'convertedClientId' THEN
    RAISE EXCEPTION '연락처와 고객 연결정보를 동시에 변경할 수 없습니다.';
  END IF;
  phone := public.checked_customer_phone(NEW.data ->> 'phone');
  NEW.data := jsonb_set(NEW.data, '{phone}', to_jsonb(phone), true);
  linked_client_id := NULLIF(BTRIM(OLD.data ->> 'convertedClientId'), '');
  IF linked_client_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.app_clients c
     SET data = jsonb_set(c.data, '{phone}', to_jsonb(phone), true)
   WHERE c.id = linked_client_id
     AND c.law_firm_id = NEW.law_firm_id
     AND (NULLIF(c.data ->> 'fromLeadId', '') IS NULL OR c.data ->> 'fromLeadId' = NEW.id)
     -- A pointer/backlink alone is not proof of customer access: conversion
     -- permissions allow pointer changes in earlier requests. Enforce the
     -- caller's DB assignment scope independently on the target customer.
     AND (auth.role() = 'service_role' OR public.is_admin_user()
       OR public.has_permission('db.view_all')
       OR c.data ->> 'assignedStaff' = public.current_staff_name())
     AND NOT EXISTS (
       SELECT 1 FROM public.app_leads other_lead
        WHERE other_lead.law_firm_id = NEW.law_firm_id
          AND other_lead.data ->> 'convertedClientId' = linked_client_id
          AND other_lead.id <> NEW.id
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION '연결된 계약 고객을 확인할 수 없어 연락처 수정이 취소됐습니다. 관리자에게 문의해주세요.';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_converted_lead_core_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  linked_client_id text;
  name_changed boolean;
  direction_changed boolean;
  assignee_changed boolean;
  corrected_name text;
  corrected_direction text;
  corrected_assignee text;
  client_patch jsonb := '{}'::jsonb;
  case_patch jsonb := '{}'::jsonb;
  previous_role_claim text;
BEGIN
  name_changed := OLD.data -> 'name' IS DISTINCT FROM NEW.data -> 'name';
  direction_changed := OLD.data -> 'applicationType' IS DISTINCT FROM NEW.data -> 'applicationType';
  assignee_changed := OLD.data -> 'assignedStaff' IS DISTINCT FROM NEW.data -> 'assignedStaff';

  IF NOT (name_changed OR direction_changed OR assignee_changed) THEN
    RETURN NEW;
  END IF;

  linked_client_id := NULLIF(BTRIM(NEW.data ->> 'convertedClientId'), '');
  IF linked_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 기존 app_leads 행의 UPDATE RLS / 세부 권한 트리거를 먼저 통과한 요청만 이곳에 도달합니다.
  -- 방어 심층화: 연결 고객에게 전달하는 필드 각각의 권한을 재확인합니다.
  IF (name_changed OR direction_changed)
     AND NOT (auth.role() = 'service_role' OR public.is_admin_user() OR public.has_permission('db.edit_basic') OR (long_absent_private.allowed_update(old, new)
       AND EXISTS (SELECT 1 FROM public.app_clients shared_client
        WHERE shared_client.id=OLD.data->>'convertedClientId' AND shared_client.law_firm_id=OLD.law_firm_id
         AND shared_client.data->>'fromLeadId'=OLD.id
         AND (public.has_permission('db.view_all') OR shared_client.data->>'assignedStaff'=public.current_staff_name()))
       AND NOT EXISTS (SELECT 1 FROM public.app_leads other_lead
        WHERE other_lead.law_firm_id=OLD.law_firm_id AND other_lead.id<>OLD.id
         AND other_lead.data->>'convertedClientId'=OLD.data->>'convertedClientId')
       AND NOT EXISTS (SELECT 1 FROM public.app_cases shared_case WHERE shared_case.law_firm_id=OLD.law_firm_id
        AND (shared_case.data->>'fromLeadId'=OLD.id OR shared_case.data->>'clientId'=OLD.data->>'convertedClientId')
        AND (shared_case.data->>'fromLeadId' IS DISTINCT FROM OLD.id
         OR shared_case.data->>'clientId' IS DISTINCT FROM OLD.data->>'convertedClientId')))) THEN
    RAISE EXCEPTION 'DB 기본정보 수정 권한이 없습니다.';
  END IF;
  IF assignee_changed
     AND NOT (auth.role() = 'service_role' OR public.is_admin_user() OR public.has_permission('db.change_assignee') OR (long_absent_private.allowed_update(old, new)
       AND EXISTS (SELECT 1 FROM public.app_clients shared_client
        WHERE shared_client.id=OLD.data->>'convertedClientId' AND shared_client.law_firm_id=OLD.law_firm_id
         AND shared_client.data->>'fromLeadId'=OLD.id
         AND (public.has_permission('db.view_all') OR shared_client.data->>'assignedStaff'=public.current_staff_name()))
       AND NOT EXISTS (SELECT 1 FROM public.app_leads other_lead
        WHERE other_lead.law_firm_id=OLD.law_firm_id AND other_lead.id<>OLD.id
         AND other_lead.data->>'convertedClientId'=OLD.data->>'convertedClientId')
       AND NOT EXISTS (SELECT 1 FROM public.app_cases shared_case WHERE shared_case.law_firm_id=OLD.law_firm_id
        AND (shared_case.data->>'fromLeadId'=OLD.id OR shared_case.data->>'clientId'=OLD.data->>'convertedClientId')
        AND (shared_case.data->>'fromLeadId' IS DISTINCT FROM OLD.id
         OR shared_case.data->>'clientId' IS DISTINCT FROM OLD.data->>'convertedClientId')))) THEN
    RAISE EXCEPTION 'DB 담당자 변경 권한이 없습니다.';
  END IF;

  IF name_changed THEN
    corrected_name := BTRIM(COALESCE(NEW.data ->> 'name', ''));
    IF corrected_name = '' OR LENGTH(corrected_name) > 100 THEN
      RAISE EXCEPTION '고객 이름은 1~100자로 입력해주세요.';
    END IF;
    client_patch := client_patch || jsonb_build_object('name', corrected_name);
  END IF;

  IF direction_changed THEN
    corrected_direction := NULLIF(BTRIM(COALESCE(NEW.data ->> 'applicationType', '')), '');
    IF corrected_direction IS NOT NULL AND corrected_direction NOT IN (
      '개인회생', '개인파산', '워크아웃', '법인회생', '일반회생', '기타사건'
    ) THEN
      RAISE EXCEPTION '선택할 수 없는 상담 후 방향입니다.';
    END IF;
    -- '미지정'으로 바꾸는 경우 고객 상담 방향만 미지정 처리하고,
    -- 이미 생성된 계약의 사건유형은 공란으로 변경하지 않습니다.
    client_patch := client_patch || jsonb_build_object('applicationType', corrected_direction);
    IF corrected_direction IS NOT NULL THEN
      case_patch := case_patch || jsonb_build_object('caseType', corrected_direction);
    END IF;
  END IF;

  IF assignee_changed THEN
    corrected_assignee := BTRIM(COALESCE(NEW.data ->> 'assignedStaff', ''));
    IF corrected_assignee = '' OR LENGTH(corrected_assignee) > 100 THEN
      RAISE EXCEPTION '담당자를 선택해주세요.';
    END IF;
    client_patch := client_patch || jsonb_build_object('assignedStaff', corrected_assignee);
    case_patch := case_patch || jsonb_build_object('assignedStaff', corrected_assignee);
  END IF;

  -- 동일 로펌 / 연결된 원본 리드만 처리하므로 다른 로펌이나 다른 고객은 변경되지 않습니다.
  UPDATE public.app_clients c
     SET data = c.data || client_patch
   WHERE c.id = linked_client_id
     AND c.law_firm_id = NEW.law_firm_id
     AND (NULLIF(c.data ->> 'fromLeadId', '') IS NULL OR c.data ->> 'fromLeadId' = NEW.id);

  IF NOT FOUND THEN
    RAISE EXCEPTION '연결된 계약 고객을 찾지 못해 수정이 취소됐습니다. 관리자에게 문의해주세요.';
  END IF;

  IF case_patch <> '{}'::jsonb THEN
    -- app_cases는 직접 직원 수정 시 별도의 계약 권한 트리거가 적용됩니다.
    -- 이 구간만 서비스 역할로 수행하여, 이미 app_leads에서 권한을 검증한
    -- 동일 로펌·동일 리드에 연결된 사건의 두 표시 필드만 안전하게 동기화합니다.
    -- 원래 JWT 역할 설정은 UPDATE 직후 반드시 복구합니다.
    previous_role_claim := current_setting('request.jwt.claim.role', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);

    UPDATE public.app_cases c
       SET data = c.data || case_patch
     WHERE c.law_firm_id = NEW.law_firm_id
       AND (
         c.data ->> 'fromLeadId' = NEW.id
         OR (c.data ->> 'clientId' = linked_client_id
             AND NULLIF(c.data ->> 'fromLeadId', '') IS NULL)
       );

    PERFORM set_config('request.jwt.claim.role', COALESCE(previous_role_claim, ''), true);
  END IF;

  RETURN NEW;
END;
$function$
;
-- Deliberately narrow capability boundary: callers cannot choose a tenant,
-- write a complete row, create/convert/delete, alter identity or lineage, or
-- continue editing once the stored lead is no longer in the shared state.
create or replace function long_absent_private.update_lead(target_lead_id text, patch jsonb, expected_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 target public.app_leads%rowtype;
 saved public.app_leads%rowtype;
 linked_client public.app_clients%rowtype;
 linked_case public.app_cases%rowtype;
 next_data jsonb;
 key text;
 value jsonb;
 actor_name text;
 audit_id text;
 client_id text;
 case_id text;
begin
 if auth.uid() is null or not coalesce(public.is_active_user() and public.has_permission('db.view') and not public.is_writing_staff(),false) then
  raise exception using errcode='42501',message='장기부재 공동관리 권한이 없습니다.';
 end if;
 if jsonb_typeof(patch) is distinct from 'object' or patch='{}'::jsonb
  or jsonb_typeof(expected_data) is distinct from 'object' then
  raise exception using errcode='22023',message='수정할 항목과 원본 정보가 필요합니다.';
 end if;
 if exists(select 1 from jsonb_object_keys(patch) k where not (k=any(array['name','phone','email','applicationType','memo','consultation','contactLog','invalidReason','nonContractReason','replacementRequestedAt','detailStage','status','assignedStaff','reservationAt']))) then
  raise exception using errcode='42501',message='공동관리에서 변경할 수 없는 항목입니다.';
 end if;
 select * into target from public.app_leads l
  where l.id=target_lead_id and l.law_firm_id=public.current_law_firm_id() for update;
 if not found or not long_absent_private.can_manage(target.data,target.law_firm_id) then
  raise exception using errcode='42501',message='현재 같은 로펌의 장기부재 DB만 공동관리할 수 있습니다. 목록을 다시 확인해주세요.';
 end if;
 if (target.data||jsonb_build_object('id',target.id)) is distinct from expected_data then
  raise exception using errcode='40001',message='다른 담당자가 먼저 변경했습니다. 입력을 보관한 뒤 최신 상담일지를 다시 열어주세요.';
 end if;
 next_data:=target.data;
 for key,value in select * from jsonb_each(patch) loop
  if value='null'::jsonb then next_data:=next_data-key;
  else next_data:=jsonb_set(next_data,array[key],value,true); end if;
 end loop;
 if patch ? 'assignedStaff' and (
  jsonb_typeof(patch->'assignedStaff') is distinct from 'string' or
  (select count(*) from public.profiles p where p.law_firm_id=target.law_firm_id
   and p.is_active and p.is_work_staff and p.staff_name=patch->>'assignedStaff')<>1) then
  raise exception using errcode='22023',message='같은 로펌의 활성 실무 담당자를 선택해주세요. 중복 이름은 관리자 확인이 필요합니다.';
 end if;
 if patch ? 'name' and (jsonb_typeof(patch->'name') is distinct from 'string'
  or length(btrim(patch->>'name')) not between 1 and 100) then
  raise exception using errcode='22023',message='고객 이름은 1~100자로 입력해주세요.';
 end if;
 if patch ? 'phone' then
  if jsonb_typeof(patch->'phone') is distinct from 'string' then raise exception '연락처를 입력해주세요.'; end if;
  next_data:=jsonb_set(next_data,'{phone}',to_jsonb(public.checked_customer_phone(patch->>'phone')));
 end if;
 if patch ? 'applicationType' and patch->'applicationType'<>'null'::jsonb
  and (jsonb_typeof(patch->'applicationType')<>'string' or not (patch->>'applicationType'=any(array['개인회생','개인파산','워크아웃','법인회생','일반회생','기타사건']))) then
  raise exception '선택할 수 없는 상담 후 방향입니다.';
 end if;
 if patch ? 'consultation' and jsonb_typeof(patch->'consultation') is distinct from 'object' then raise exception '상담일지 형식이 올바르지 않습니다.'; end if;
 if patch ? 'contactLog' and jsonb_typeof(patch->'contactLog') is distinct from 'array' then raise exception '컨택 기록 형식이 올바르지 않습니다.'; end if;
 for key in select unnest(array['email','memo','reservationAt','invalidReason','nonContractReason','replacementRequestedAt']) loop
  if patch ? key and patch->key<>'null'::jsonb and jsonb_typeof(patch->key) is distinct from 'string' then
   raise exception using errcode='22023',message='문자 입력 항목의 형식을 확인해주세요.';
  end if;
 end loop;
 if length(patch->>'email')>320 or length(patch->>'memo')>20000 then raise exception '입력 내용이 너무 깁니다.'; end if;
 if patch->>'reservationAt' is not null and (
  patch->>'reservationAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$'
  or not isfinite((patch->>'reservationAt')::timestamptz)) then raise exception '예약 일시를 확인해주세요.'; end if;
 if patch->>'replacementRequestedAt' is not null and not isfinite((patch->>'replacementRequestedAt')::timestamptz) then raise exception '교체 요청 일시를 확인해주세요.'; end if;
 if patch->>'invalidReason' is not null and not (patch->>'invalidReason'=any(array['대상 아님','연락처 오류','중복','본인 아님','기타'])) then raise exception '불가 사유를 확인해주세요.'; end if;
 if patch->>'nonContractReason' is not null and not (patch->>'nonContractReason'=any(array['비용 부담','타사 계약','상담 거절','연락 두절','진행 보류','기타'])) then raise exception '미수임 사유를 확인해주세요.'; end if;
 if patch->>'status'='수임전환' and target.data->>'status' is distinct from '수임전환' then raise exception using errcode='42501',message='고객 전환은 별도 권한이 필요합니다.'; end if;
 if patch ? 'status' and (jsonb_typeof(patch->'status') is distinct from 'string' or not (patch->>'status'=any(array['신규접수','상담예정','상담완료','재통화필요','고려중','서류검토중','계약진행중','수임전환','부재중','거절','부적합','종결_중단']))) then raise exception '진행 상태를 확인해주세요.'; end if;
 if patch ? 'detailStage' and (jsonb_typeof(patch->'detailStage') is distinct from 'string' or not (patch->>'detailStage'=any(array['미상담','신규디비','문자발송완료','부재','착수금 안내','설득필요','예약','상담','장기부재','불가','본인취소','착수금착수','착수 1차안내','착수 추후진행','취소예정','1차 서류미비','1차 서류완료','2차서류안내','2차서류미비','2차서류완료','접수보류','법원접수(대기)','법원접수','금지명령','금지기각','개시결정','인가결정','종결','워크아웃','새출발','워크아웃 신청','새출발 신청','워크아웃 완료','새출발 완료','파산']))) then raise exception '진행 단계를 확인해주세요.'; end if;
 -- Existing conversion repair runs on any lead update. Do not let shared
 -- editing create missing clients/cases or propagate into ambiguous lineage.
 client_id:=nullif(btrim(target.data->>'convertedClientId'),'');
 case_id:=nullif(btrim(target.data->>'convertedCaseId'),'');
 if case_id is not null and client_id is null then raise exception '고객 연결정보를 관리자에게 확인해주세요.'; end if;
 if client_id is not null then
  select * into linked_client from public.app_clients where id=client_id and law_firm_id=target.law_firm_id for update;
  if not found or (nullif(linked_client.data->>'fromLeadId','') is not null and linked_client.data->>'fromLeadId'<>target.id)
   or exists(select 1 from public.app_leads l where l.id<>target.id and l.law_firm_id=target.law_firm_id and l.data->>'convertedClientId'=client_id) then
   raise exception '연결 고객이 없거나 중복 연결되어 저장하지 않았습니다. 관리자에게 문의해주세요.';
  end if;
 end if;
 if case_id is not null then
  select * into linked_case from public.app_cases where id=case_id and law_firm_id=target.law_firm_id for update;
  if not found or linked_case.data->>'clientId' is distinct from client_id
   or (nullif(linked_case.data->>'fromLeadId','') is not null and linked_case.data->>'fromLeadId'<>target.id)
   or exists(select 1 from public.app_leads l where l.id<>target.id and l.law_firm_id=target.law_firm_id and l.data->>'convertedCaseId'=case_id) then
   raise exception '연결 계약이 없거나 중복 연결되어 저장하지 않았습니다. 관리자에게 문의해주세요.';
  end if;
 end if;
 -- Existing IDs/converted pointers are editable by older, separate permissions.
 -- Never treat them alone as new authority over a retained/legacy customer.
 -- Consultation-only edits have no linked-field propagation and remain shared.
 if client_id is not null and exists(select 1 from unnest(array['name','phone','applicationType','assignedStaff']) k
  where target.data->k is distinct from next_data->k) then
  if linked_client.data->>'fromLeadId' is distinct from target.id
   or not coalesce(public.is_admin_user() or public.has_permission('db.view_all')
    or linked_client.data->>'assignedStaff'=public.current_staff_name(),false)
   or exists(select 1 from public.app_cases c where c.law_firm_id=target.law_firm_id
     and (c.data->>'fromLeadId'=target.id or c.data->>'clientId'=client_id)
     and (c.data->>'fromLeadId' is distinct from target.id or c.data->>'clientId' is distinct from client_id)) then
   raise exception using errcode='42501',message='연결된 계약 고객의 정보·담당자 변경은 기존 고객 담당자 또는 전체조회 관리자에게 요청해주세요. 상담일지·메모는 공동관리할 수 있습니다.';
  end if;
 end if;
 if next_data is not distinct from target.data then
  return jsonb_build_object('id',target.id,'law_firm_id',target.law_firm_id,'data',target.data);
 end if;
 update public.app_leads set data=next_data where id=target.id and law_firm_id=target.law_firm_id returning * into saved;
 select coalesce(nullif(p.display_name,''),nullif(p.staff_name,''),'사용자') into actor_name from public.profiles p where p.id=auth.uid();
 audit_id:='CHG-'||gen_random_uuid()::text;
 insert into public.app_change_logs(id,law_firm_id,data,created_by)
 values(audit_id,target.law_firm_id,jsonb_build_object('id',audit_id,'category','DB관리','action','수정',
  'targetName',target.data->>'name','detail','장기부재 공동관리 수정','staff',actor_name,'at',clock_timestamp()),auth.uid());
 return jsonb_build_object('id',saved.id,'law_firm_id',saved.law_firm_id,'data',saved.data);
end;
$$;
revoke all on function long_absent_private.update_lead(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function long_absent_private.update_lead(text,jsonb,jsonb) to authenticated;

create or replace function public.update_shared_long_absent_lead(target_lead_id text, patch jsonb, expected_data jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select long_absent_private.update_lead(target_lead_id,patch,expected_data);
$$;
revoke all on function public.update_shared_long_absent_lead(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.update_shared_long_absent_lead(text,jsonb,jsonb) to authenticated;
commit;
