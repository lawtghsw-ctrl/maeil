V28.38 — 로파워 회생 어드민 알리고 안전 테스트 패치
1. 현 소스에 덮어쓰기. 3개 신규 파일: API 테스트, 테스트 화면, DB 안전 가드 SQL.
2. Vercel: ALIGO_TEST_MODE=true 등록 (Production, Preview). 기존 ALIGO_USER_ID, ALIGO_API_KEY 유지.
3. Supabase SQL Editor에서 supabase/migrations/022_aligo_safe_cutover.sql 실행 (반드시 소스 배포 전!).
4. /sms > 발신번호·문구에서 승인된 3개 발신번호를 이름대로 등록 (등록된 번호 확인 체크).
5. /sms/aligo-test 접속, 담당자 발신번호 선택, 본인 테스트 수신번호 입력, 테스트.
6. API 테스트는 항상 testmode_yn=Y, 실발송/과금 없음. 고객에게 절대 발송하지 않음.
7. 자동문자는 SQL에서 모두 OFF + 컷오프 비활성 + 기존 자동 대기열 취소.
8. 실제 전송/자동발송 디스패처는 의도적으로 미구현. 향후 승인 뒤 별도 단계에서 개발.
9. 환경변수 키는 챗에 공유하지 말 것. 노출된 옛 키는 폐기할 것.
주의: DB migration은 기존 014/015/016이 적용되어 있어야 하며 기존 자동 대기열 pending_api/queued는 cancelled로 바뀝니다.
전체 npm run build 및 실제 API 시험은 미실행.
