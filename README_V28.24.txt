LawPower v28.24 - 문자발송 권한 분리/보강

적용 순서
1) v28.23 적용 및 SQL 014, 015 실행 상태에서 이 ZIP을 프로젝트 루트에 덮어쓰기
2) Supabase SQL Editor에서 supabase/migrations/016_sms_permissions.sql 전체 실행
3) 직원계정관리 > 직원 편집 > 문자발송 권한 확인
4) npm run build 또는 npx tsc --noEmit 확인 후 Git commit/push

추가 권한
- sms.view: 문자발송 메뉴 접근
- sms.send: 수기/주소록/MMS 발송대기 등록
- sms.view_history: 발송내역 조회
- sms.manage_settings: 담당자별 자동발송, 이미지, 발신번호, 문구 템플릿 관리

기존 계정 호환
- v28.24 이전에 DB관리(db.view) 권한을 갖고 있던 활성 직원 중 SMS 권한키가 없던 계정에는
  sms.view / sms.send / sms.view_history 를 1회 자동 부여합니다.
- sms.manage_settings 는 자동 부여하지 않습니다. 관리자 또는 권한을 받은 직원만 설정할 수 있습니다.

보안/RLS
- 화면 숨김뿐 아니라 Supabase RLS에서도 동일 권한을 검사합니다.
- sms.send가 없으면 outbox insert 및 MMS 이미지 업로드 불가
- sms.view_history가 없으면 발송내역 조회 불가
- sms.manage_settings가 없으면 발신번호/템플릿/자동발송 설정 수정 불가
- 로펌 간 데이터는 law_firm_id 기준으로 계속 분리
