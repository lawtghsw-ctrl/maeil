-- Add the new commencement stage without rewriting records or permissions.
-- CREATE OR REPLACE preserves each existing function owner and EXECUTE grants.
-- Keep the shared long-absence RPC body and all row/field guards unchanged.
begin;

create or replace function public.is_writing_lead_data(lead_data jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce((case
  when lead_data->'detailStage' is null or lead_data->'detailStage'='null'::jsonb then
   case lead_data->>'status'
    when '서류검토중' then '1차 서류미비'
    when '계약진행중' then '착수금착수'
    when '수임전환' then '법원접수(대기)'
    else null end
  when jsonb_typeof(lead_data->'detailStage')='string' then lead_data->>'detailStage'
  else null end) = any(array[
   '착수금착수','착수 1차안내','착수 추후진행','사채연결','취소예정',
   '1차 서류미비','1차 서류완료','2차서류안내','2차서류미비','2차서류완료','접수보류',
   '법원접수(대기)','법원접수','금지명령','금지기각','개시결정','인가결정','종결',
   '워크아웃','새출발','워크아웃 신청','새출발 신청','워크아웃 완료','새출발 완료','파산'
  ]),false);
$$;

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
 if patch ? 'detailStage' and (jsonb_typeof(patch->'detailStage') is distinct from 'string' or not (patch->>'detailStage'=any(array['미상담','신규디비','문자발송완료','부재','착수금 안내','설득필요','예약','상담','장기부재','불가','본인취소','착수금착수','착수 1차안내','착수 추후진행','사채연결','취소예정','1차 서류미비','1차 서류완료','2차서류안내','2차서류미비','2차서류완료','접수보류','법원접수(대기)','법원접수','금지명령','금지기각','개시결정','인가결정','종결','워크아웃','새출발','워크아웃 신청','새출발 신청','워크아웃 완료','새출발 완료','파산']))) then raise exception '진행 단계를 확인해주세요.'; end if;
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

commit;
