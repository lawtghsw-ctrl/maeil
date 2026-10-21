-- Customer phone editing. Prepare/apply this migration before deploying the UI.
-- No existing data is backfilled. All writes below affect only the phone field.
BEGIN;

CREATE OR REPLACE FUNCTION public.checked_customer_phone(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  phone text := BTRIM(COALESCE(value, ''));
  digits text;
BEGIN
  digits := regexp_replace(phone, '[^0-9]', '', 'g');
  IF phone = '' OR LENGTH(phone) > 40
     OR phone !~ '^\+?[0-9][0-9 ().-]*$'
     OR LENGTH(digits) < 8 OR LENGTH(digits) > 15 THEN
    RAISE EXCEPTION '연락처는 숫자 8~15자리로 입력해주세요. 국가번호(+), 공백, 괄호, 점, 하이픈을 사용할 수 있습니다.';
  END IF;
  RETURN phone;
END;
$$;
-- Supabase can grant anon/authenticated/service_role through per-schema default
-- privileges. Revoke those explicit grants too, not only inherited PUBLIC.
REVOKE ALL ON FUNCTION public.checked_customer_phone(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_converted_lead_phone_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.sync_converted_lead_phone_to_client() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_sync_converted_lead_phone_to_client ON public.app_leads;
-- BEFORE normalizes the lead itself too. A later permission/constraint failure
-- rolls back both rows, and the existing phone_normalized trigger still runs.
CREATE TRIGGER trg_sync_converted_lead_phone_to_client
BEFORE UPDATE OF data ON public.app_leads
FOR EACH ROW
WHEN (OLD.data -> 'phone' IS DISTINCT FROM NEW.data -> 'phone')
EXECUTE FUNCTION public.sync_converted_lead_phone_to_client();

CREATE OR REPLACE FUNCTION public.update_client_phone(target_client_id text, new_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.app_clients%ROWTYPE;
  locked_target public.app_clients%ROWTYPE;
  source_lead public.app_leads%ROWTYPE;
  source_id text;
  reverse_ids text[];
  phone text;
BEGIN
  -- Preserve the existing admin-only app_clients edit rule. No caller-supplied
  -- firm or role is trusted; tenant ownership comes from the stored client row.
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_active_user() AND public.is_admin_user(), false) THEN
    RAISE EXCEPTION '고객정보 수정은 활성 관리자만 가능합니다.';
  END IF;
  SELECT * INTO target FROM public.app_clients WHERE id = target_client_id;
  IF NOT FOUND OR target.law_firm_id IS NULL
     OR NOT COALESCE(public.is_super_admin() OR target.law_firm_id = public.current_law_firm_id(), false) THEN
    RAISE EXCEPTION '수정할 고객을 찾을 수 없거나 해당 로펌에 대한 권한이 없습니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.law_firms WHERE id = target.law_firm_id AND status = 'active') THEN
    RAISE EXCEPTION '이용 중지된 로펌의 고객정보는 수정할 수 없습니다.';
  END IF;
  phone := public.checked_customer_phone(new_phone);
  source_id := NULLIF(BTRIM(target.data ->> 'fromLeadId'), '');
  SELECT array_agg(l.id ORDER BY l.id) INTO reverse_ids
    FROM public.app_leads l
   WHERE l.law_firm_id = target.law_firm_id AND l.data ->> 'convertedClientId' = target.id;
  IF COALESCE(array_length(reverse_ids, 1), 0) > 1
     OR (source_id IS NOT NULL AND reverse_ids IS NOT NULL AND source_id <> ALL(reverse_ids)) THEN
    RAISE EXCEPTION '고객과 원본 DB의 연결정보가 일치하지 않아 연락처 수정이 취소됐습니다.';
  END IF;
  source_id := COALESCE(source_id, reverse_ids[1]);
  IF source_id IS NOT NULL THEN
    -- Lock in the same lead -> client order as the lead phone trigger.
    -- Look up the exact source even across tenants, only to reject bad lineage.
    SELECT * INTO source_lead FROM public.app_leads WHERE id = source_id FOR UPDATE;
    IF NOT FOUND THEN
      -- Deleting an original DB intentionally retains its converted customer.
      -- It is safe to edit that retained customer only when no reverse link exists.
      IF reverse_ids IS NOT NULL THEN
        RAISE EXCEPTION '연결된 원본 DB를 확인할 수 없어 연락처 수정이 취소됐습니다.';
      END IF;
      source_id := NULL;
    ELSIF source_lead.law_firm_id IS DISTINCT FROM target.law_firm_id
       OR source_lead.data ->> 'convertedClientId' IS DISTINCT FROM target.id THEN
      RAISE EXCEPTION '연결된 원본 DB를 확인할 수 없어 연락처 수정이 취소됐습니다. 관리자에게 문의해주세요.';
    END IF;
  END IF;
  SELECT * INTO locked_target FROM public.app_clients WHERE id = target.id FOR UPDATE;
  IF NOT FOUND OR locked_target.law_firm_id IS DISTINCT FROM target.law_firm_id
     OR locked_target.data ->> 'fromLeadId' IS DISTINCT FROM target.data ->> 'fromLeadId' THEN
    RAISE EXCEPTION '고객 연결정보가 변경되었습니다. 새로 확인한 뒤 다시 저장해주세요.';
  END IF;
  SELECT array_agg(l.id ORDER BY l.id) INTO reverse_ids FROM public.app_leads l
   WHERE l.law_firm_id = target.law_firm_id AND l.data ->> 'convertedClientId' = target.id;
  IF COALESCE(array_length(reverse_ids, 1), 0) > 1
     OR (reverse_ids IS NOT NULL AND (source_id IS NULL OR source_id <> ALL(reverse_ids))) THEN
    RAISE EXCEPTION '고객 연결정보가 변경되었습니다. 새로 확인한 뒤 다시 저장해주세요.';
  END IF;
  IF source_id IS NOT NULL THEN
    UPDATE public.app_leads
       SET data = jsonb_set(data, '{phone}', to_jsonb(phone), true)
     WHERE id = source_lead.id AND law_firm_id = target.law_firm_id;
  END IF;
  -- Also handles standalone customers and pre-existing lead/client divergence
  -- where the lead already has this phone (and the change trigger does not fire).
  UPDATE public.app_clients
     SET data = jsonb_set(data, '{phone}', to_jsonb(phone), true)
   WHERE id = target.id AND law_firm_id = target.law_firm_id;
  RETURN jsonb_build_object('clientId', target.id, 'leadId', source_id, 'phone', phone);
END;
$$;
REVOKE ALL ON FUNCTION public.update_client_phone(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_client_phone(text, text) TO authenticated;
COMMIT;

-- Read-only deployment check. This does not touch any customer record.
SELECT to_regprocedure('public.update_client_phone(text,text)') IS NOT NULL AS customer_phone_rpc_ok,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.app_leads'::regclass
         AND tgname = 'trg_sync_converted_lead_phone_to_client' AND tgenabled <> 'D') AS lead_phone_sync_ok;
