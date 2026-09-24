# Supabase v27 빠른 설정

## 신규 설치

1. Supabase 프로젝트 생성
2. SQL Editor에서 `migrations/001_initial.sql` 실행
3. 이어서 `migrations/002_staff_accounts_permissions.sql` 실행
4. 이어서 `migrations/003_google_sheet_leads_round_robin.sql` 실행
5. Authentication > Users에서 최초 최종관리자 계정 1개 생성
6. Project Settings > API에서 URL / Publishable key / Service role key 확인
7. 프로젝트 `.env.local`과 Vercel Environment Variables에 아래 값을 등록

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_SHEETS_WEBHOOK_SECRET
GOOGLE_SHEETS_SHEET_NAME=DB가공
```

8. 재배포 후 최종관리자로 로그인
9. `직원계정관리`에서 실무담당/DB자동배정 여부와 순서를 확인
10. Google Sheet Apps Script는 `integrations/google-sheets/SETUP.md` 안내대로 설정

## v26에서 업그레이드

이미 001/002가 적용되어 있으면 `003_google_sheet_leads_round_robin.sql`만 실행하고 Google Sheet 관련 환경변수를 추가한 뒤 재배포하면 됩니다.

## 현재 운영 역할 / 자동배정

- 홍성원: admin / active / is_work_staff=false / DB자동배정 제외
- 강이삭: admin / active / is_work_staff=true / DB자동배정 참여 / 순서 10
- 박형원: staff / active / is_work_staff=true / DB자동배정 참여 / 순서 20

따라서 신규 DB는 기본적으로 `강이삭 → 박형원 → 강이삭 → 박형원...` 순서로 배정됩니다.

직원을 새로 추가한 뒤 자동배정에 넣으려면 직원계정관리에서 아래 3개를 만족시키면 됩니다.

```text
계정 활성화 = ON
실무 담당자로 사용 = ON
신규 DB 자동배정 참여 = ON
```

## 중요 보안

`SUPABASE_SERVICE_ROLE_KEY`와 `GOOGLE_SHEETS_WEBHOOK_SECRET`은 서버 비밀값입니다.

- 절대 `NEXT_PUBLIC_`을 붙이지 않습니다.
- GitHub에 실제 값을 커밋하지 않습니다.
- 브라우저 JS나 클라이언트 컴포넌트에서 import하지 않습니다.
- Vercel 서버 환경변수와 로컬 `.env.local`에만 저장합니다.
