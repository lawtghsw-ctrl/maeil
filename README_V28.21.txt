LawPower v28.21

수정사항
- 일반 직원 계정에서 계약관리 > 분납관리 저장 후 값이 0으로 되돌아가던 권한 오류 수정
- cases.manage_installments 권한으로 총 채무액 / 총 수임료 / 납부금액 / 납부회차 / 결제방법 저장 허용
- 분납관리 팝업에 총 채무액 저장 경로도 명시적으로 연결
- 슈퍼어드민/관리자 기존 동작 유지

적용
1) v28.20까지 적용된 프로젝트에 이 ZIP 덮어쓰기
2) Supabase SQL Editor에서 supabase/migrations/013_staff_installment_finance_save_fix.sql 전체 실행
3) 배포
4) 일반 직원 계정으로 분납관리 저장 테스트

SQL 마지막 결과 두 값이 모두 true면 권한 패치 적용 완료.
