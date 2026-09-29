# Supabase v27.7 빠른 설정

## 신규 설치

1. Supabase 프로젝트 생성
2. SQL Editor에서 `migrations/001_initial.sql` 실행
3. 이어서 `migrations/002_staff_accounts_permissions.sql` 실행
4. 이어서 `migrations/003_google_sheet_leads_round_robin.sql` 실행
5. 이어서 `migrations/004_db_lead_delete_permission.sql` 실행
6. 이어서 `migrations/005_db_intake_owner_park.sql` 실행
7. Authentication > Users에서 최초 최종관리자 계정 1개 생성
8. Project Settings > API에서 URL / Publishable key / Service role key 확인
9. 프로젝트 `.env.local`과 Vercel Environment Variables에 아래 값을 등록

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_SHEETS_WEBHOOK_SECRET
GOOGLE_SHEETS_SHEET_NAME=DB가공
```

10. 재배포 후 최종관리자로 로그인
11. `직원계정관리`에서 박형원이 `실무 담당자로 사용=ON`, `신규 DB 자동유입 담당=ON`인지 확인
12. Google Sheet Apps Script는 `integrations/google-sheets/SETUP.md` 안내대로 설정

## 기존 운영 프로젝트에서 업그레이드

이미 001~004가 적용되어 있으면 `005_db_intake_owner_park.sql`만 추가 실행하면 됩니다.

## 현재 운영 역할 / 신규 DB 배정

- 홍성원: admin / active / is_work_staff=false
- 강이삭: admin / active / is_work_staff=true / 신규 DB 자동유입 담당 OFF
- 박형원: staff / active / is_work_staff=true / 신규 DB 자동유입 담당 ON / 순서 10

따라서 신규 DB는 먼저 **박형원**에게 배정됩니다. 박형원은 전체 DB를 볼 수 있고 담당자를 다른 실무자에게 재지정할 수 있습니다.

직원을 새로 추가해도 `신규 DB 자동유입 담당`은 기본 OFF입니다. 총괄 담당자를 바꾸려는 경우에만 해당 직원에게 이 옵션을 켜고 배정 순서를 조정합니다.

## 중요 보안

`SUPABASE_SERVICE_ROLE_KEY`와 `GOOGLE_SHEETS_WEBHOOK_SECRET`은 서버 비밀값입니다.

- 절대 `NEXT_PUBLIC_`을 붙이지 않습니다.
- GitHub에 실제 값을 커밋하지 않습니다.
- 브라우저 JS나 클라이언트 컴포넌트에서 import하지 않습니다.
- Vercel 서버 환경변수와 로컬 `.env.local`에만 저장합니다.


## v27.7 신규 DB 총괄 배정

기존 001~004가 적용되어 있으면 `migrations/005_db_intake_owner_park.sql`을 1회 실행하세요. 이후 Google Sheet에서 들어오는 신규 DB는 박형원에게 우선 배정되고, 박형원 계정에는 전체 DB 조회 및 담당자 변경 권한이 부여됩니다.
