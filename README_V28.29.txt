LawPower 회생 ADMIN V28.29 — 계약 전환 고객 이름 수정

대상: DB관리 > 상담일지 > 기본정보 > 이름
- 상담/착수금 안내/착수/서류/법원/워크아웃 단계 및 고객전환 후에도 이름 수정 가능
- 이름 수정 저장 시 DB관리(app_leads)와 계약관리(app_clients)의 이름을 한 트랜잭션에서 동기화
- 기존 고객/계약/분납/상담내용은 유지
- 직원은 종전의 db.edit_basic + db.edit_consultation 권한 필요

설치 순서:
1) Supabase SQL Editor: supabase/migrations/020_converted_lead_name_sync.sql 실행 (검사 결과 둘 다 true)
2) app/db/page.tsx 수정분을 GitHub 연결 폴더(maeil-git)에 덮어쓰기
3) npm install 후 npm run build (가능하면 실행)
4) git add . && git commit -m "V28.29 sync converted customer names" && git push origin main
5) Vercel 배포 후 실제 계약 고객 1명 이름 변경 -> 새로고침 -> DB관리/계약관리 이름 확인

주의: SQL은 자동 적용되지 않습니다. 실행하지 않은 채 수정된 화면만 배포하면 계약관리 이름은 자동 갱신되지 않습니다.
