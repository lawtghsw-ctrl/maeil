-- LawPower v28.31 — 계약전환 고객의 상담 후 방향 / 담당자 변경 및 계약관리 연동
-- 020 미적용 상태에서도 이 SQL 1회로 기존 이름 동기화까지 함께 설정합니다.
-- 운영 데이터 일괄 수정 없음. '수정된 리드'에 연결된 고객/사건만 같은 트랜잭션에서 동기화.
-- 기존 계약금액, 분납기록, 접수일, 상담일지는 변경하지 않습니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_converted_lead_core_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- V28.29 이름만 동기화하던 트리거와 중복 실행하지 않습니다.
DROP TRIGGER IF EXISTS trg_sync_converted_lead_name_to_client ON public.app_leads;
DROP TRIGGER IF EXISTS trg_sync_converted_lead_core_fields ON public.app_leads;
CREATE TRIGGER trg_sync_converted_lead_core_fields
AFTER UPDATE OF data ON public.app_leads
FOR EACH ROW
WHEN (
  OLD.data -> 'name' IS DISTINCT FROM NEW.data -> 'name'
  OR OLD.data -> 'applicationType' IS DISTINCT FROM NEW.data -> 'applicationType'
  OR OLD.data -> 'assignedStaff' IS DISTINCT FROM NEW.data -> 'assignedStaff'
)
EXECUTE FUNCTION public.sync_converted_lead_core_fields();

REVOKE ALL ON FUNCTION public.sync_converted_lead_core_fields() FROM PUBLIC;

-- 본인 고객을 다른 직원에게 이관할 권한이 있어도, 변경 후 본인 이름과
-- 달라졌다는 이유로 UPDATE WITH CHECK에서 거절되던 문제 방지.
-- 변경 전 접근 범위(USING)와 필드별 수정 권한은 그대로 유지합니다.
DROP POLICY IF EXISTS app_leads_update_permissions ON public.app_leads;
CREATE POLICY app_leads_update_permissions ON public.app_leads
FOR UPDATE TO authenticated
USING (
  public.is_admin_user()
  OR (
    public.has_any_permission(ARRAY[
      'db.edit_basic','db.edit_consultation','db.change_stage','db.change_assignee',
      'db.manage_reservation','db.convert','cases.create'
    ])
    AND (public.has_permission('db.view_all') OR data ->> 'assignedStaff' = public.current_staff_name())
  )
)
WITH CHECK (
  public.is_active_user()
  AND (
    public.is_admin_user()
    OR public.has_permission('db.change_assignee')
    OR (
      public.has_any_permission(ARRAY[
        'db.edit_basic','db.edit_consultation','db.change_stage','db.change_assignee',
        'db.manage_reservation','db.convert','cases.create'
      ])
      AND (public.has_permission('db.view_all') OR data ->> 'assignedStaff' = public.current_staff_name())
    )
  )
);

COMMIT;

-- 확인 전용 (기존 데이터 변경 없음)
SELECT
  to_regprocedure('public.sync_converted_lead_core_fields()') IS NOT NULL AS core_sync_function_ok,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.app_leads'::regclass
      AND tgname = 'trg_sync_converted_lead_core_fields'
      AND tgenabled <> 'D'
  ) AS core_sync_trigger_ok,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_leads'
      AND policyname = 'app_leads_update_permissions'
  ) AS lead_edit_policy_ok;
