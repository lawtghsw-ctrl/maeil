-- Restore permission guards, then remove only this feature endpoint. No customer changes.
begin;
CREATE OR REPLACE FUNCTION public.enforce_lead_update_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' or public.is_admin_user() then return new; end if;

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
      OR (public.is_active_user() AND (public.is_admin_user() OR public.has_permission('db.edit_basic'))), false) THEN
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
     AND NOT (auth.role() = 'service_role' OR public.is_admin_user() OR public.has_permission('db.edit_basic')) THEN
    RAISE EXCEPTION 'DB 기본정보 수정 권한이 없습니다.';
  END IF;
  IF assignee_changed
     AND NOT (auth.role() = 'service_role' OR public.is_admin_user() OR public.has_permission('db.change_assignee')) THEN
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
drop function if exists public.update_shared_long_absent_lead(text,jsonb,jsonb);
drop function if exists long_absent_private.update_lead(text,jsonb,jsonb);
drop function if exists long_absent_private.allowed_update(public.app_leads,public.app_leads);
drop function if exists long_absent_private.can_manage(jsonb,uuid);
drop schema if exists long_absent_private;
commit;
