LawPower v28.20 - 고객전환 누락 계약 복구

적용 순서
1. v28.19까지 적용된 상태에서
2. Supabase SQL Editor에서 supabase/migrations/012_db_convert_orphan_repair.sql 전체 실행
3. 마지막 결과가 missing_clients = 0, missing_cases = 0 인지 확인
4. 브라우저 새로고침 후 DB관리 > 계약관리로 이동 재확인

이 패치는 기존 정상 고객/계약을 덮어쓰지 않습니다.
convertedClientId / convertedCaseId는 있는데 실제 행이 누락된 전환 건만 같은 ID로 복구합니다.
앞으로 동일 현상이 생겨도 app_leads 전환 저장 시 trigger가 자동 보정합니다.
