LawPower v28.9.1 빌드 오류 수정 덮어쓰기

수정:
- lib/mock-data.ts의 applicationType 타입 오류 수정
- CaseType 6종 확장에 맞게 caseTypeSplit 6종 반영
- mock dayMap의 사건유형 비율 계산도 6종 전체 기준으로 수정

사용:
압축을 풀고 lib 폴더를 기존 maeil 프로젝트에 그대로 덮어쓰기한 뒤 npm run build 실행.

SQL 실행 필요 없음.
