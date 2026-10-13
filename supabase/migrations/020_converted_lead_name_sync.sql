-- LawPower v28.29: 상담일지의 이름 수정이 계약 전환된 고객에게도 반영되도록 연동
-- 기존 데이터는 일괄 수정하지 않습니다. 이름이 실제 변경된 리드만 동기화합니다.
-- 직원은 기존 app_leads UPDATE 권한 검사(db.edit_basic)를 그대로 받으며,
-- 연결된 app_clients 이름은 트리거 소유자 권한으로 같은 트랜잭션 안에서 변경합니다.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_converted_lead_name_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  linked_client_id text;
  corrected_name text;
BEGIN
  IF OLD.data ->> 'name' IS NOT DISTINCT FROM NEW.data ->> 'name' THEN
    RETURN NEW;
  END IF;

  linked_client_id := NULLIF(BTRIM(NEW.data ->> 'convertedClientId'), '');
  -- 아직 고객전환이 안 된 DB는 app_leads의 이름만 바꿉니다.
  IF linked_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  corrected_name := BTRIM(COALESCE(NEW.data ->> 'name', ''));
  IF corrected_name = '' OR LENGTH(corrected_name) > 100 THEN
    RAISE EXCEPTION '고객 이름은 1~100자로 입력해주세요.';
  END IF;

  -- 이름만 수정: 계약, 분납, 고객 전화번호와 기타 고객정보는 유지합니다.
  -- 동일 로펌 + 현재 리드에 연결된 고객만 수정할 수 있어 다른 로펌에는 영향이 없습니다.
  UPDATE public.app_clients AS c
     SET data = jsonb_set(c.data, '{name}', to_jsonb(corrected_name), true)
   WHERE c.id = linked_client_id
     AND c.law_firm_id = NEW.law_firm_id
     AND (
       NULLIF(c.data ->> 'fromLeadId', '') IS NULL
       OR c.data ->> 'fromLeadId' = NEW.id
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION '연결된 계약 고객을 확인할 수 없어 이름 수정이 취소됐습니다. 관리자에게 문의해주세요.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_converted_lead_name_to_client ON public.app_leads;
CREATE TRIGGER trg_sync_converted_lead_name_to_client
AFTER UPDATE OF data ON public.app_leads
FOR EACH ROW
WHEN (OLD.data ->> 'name' IS DISTINCT FROM NEW.data ->> 'name')
EXECUTE FUNCTION public.sync_converted_lead_name_to_client();

REVOKE ALL ON FUNCTION public.sync_converted_lead_name_to_client() FROM PUBLIC;

COMMIT;

-- 확인용 (실제 운영 고객 데이터는 변경되지 않습니다)
SELECT
  to_regprocedure('public.sync_converted_lead_name_to_client()') IS NOT NULL AS name_sync_function_ok,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.app_leads'::regclass
      AND tgname = 'trg_sync_converted_lead_name_to_client'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
  ) AS name_sync_trigger_ok;
