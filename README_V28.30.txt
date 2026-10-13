로파워 회생 어드민 V28.30 — 계약전환 고객 DB 진행단계 수정 잠금 해제

수정 범위:
- DB관리 모바일/PC 진행단계 선택: 이미 고객전환·계약생성된 리드도 수정 가능
- 계약전환 고객은 detailStage(화면 진행단계)만 변경하며 기존 status(수임전환) 유지
- 계약전환 고객도 '예약' 진행단계의 예약일시 수정 가능 (기존 db.manage_reservation 권한 필요)
- 상담일지의 예약 저장에서도 전환된 고객의 수임전환 status 유지
- v28.28 이름 수정 / v28.29 계약고객명 동기화 기능 모두 보존
- 계약정보, 납부금액, 분납일정, 기존 상담기록 수정/삭제 없음
- 기존 db.change_stage 권한을 가진 사용자만 변경할 수 있음

설치:
1. 이미 GitHub와 연결된 프로젝트 폴더(.git 존재)에 OVERWRITE ZIP 내용 덮어쓰기
2. v28.29 이름 동기화 SQL을 아직 적용 안 했다면 020_converted_lead_name_sync.sql을 별도 실행
3. npm install (최초 1회) 및 npm run build 확인
4. git add . ; git commit -m "V28.30 unlock converted lead stage editing" ; git push origin main
5. Vercel 배포 후 계약전환 고객의 진행단계를 착수 -> 서류로 변경하고 새로고침 유지 확인

V28.30 진행단계 수정 자체에는 신규 SQL이 필요하지 않습니다.
주의: 전체 ZIP에는 .git 및 .env.local 등 개발자 개인 파일이 포함되지 않습니다. 이미 연결된 폴더를 사용하세요.
