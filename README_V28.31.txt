LawPower v28.31 — 계약전환 고객 상담 후 방향 / 담당자 변경

기준: V28.30 전체 소스 + 이번 수정

수정:
- DB관리 모바일/PC에서 계약전환된 고객도 상담 후 방향, 담당자 선택 가능
- 상담일지의 상담 후 방향을 변경해도 전환 고객에게 연동
- SQL 021 실행 시 이름(기존 020 기능 포함), 상담 후 방향, 담당자를 연결 고객/계약에 동기화
- 담당자 변경 -> 연결 Client/Case assignedStaff 자동 변경, 상담 후 방향 -> Client applicationType 및 Case caseType 변경
- 상담 방향을 '미지정'으로 되돌리면 기존 계약의 사건유형은 보존
- 기존 계약 수임료/분납/진행단계/상담메모는 변경하지 않음
- 직원 계정은 db.edit_basic / db.change_assignee 권한에 따름

적용:
1) Supabase SQL Editor에서 supabase/migrations/021_converted_lead_direction_assignee_sync.sql 전체 실행
   이 SQL에 V28.29 이름 연동 트리거 기능이 포함되어 있으므로 020 별도 재실행 불필요.
2) 수정 파일 ZIP을 현재 GitHub 연결된 maeil 폴더에 덮어쓰기
3) npm install && npm run build (권장)
4) git add app/db/page.tsx supabase/migrations/021_converted_lead_direction_assignee_sync.sql
   git commit -m "V28.31 enable converted lead direction and assignee editing"
   git push origin main
5) 테스트: 계약 전환된 테스트 고객 1명에서 방향/담당자 변경 후 DB관리 및 계약관리 양쪽 확인

주의: 계약관리의 사건유형 변경은 기존 서명 완료 전자계약서 문구를 소급 수정하지 않습니다.
