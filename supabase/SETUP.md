# Supabase v26 빠른 설정

## 신규 설치

1. Supabase 프로젝트 생성
2. SQL Editor에서 `migrations/001_initial.sql` 실행
3. 이어서 `migrations/002_staff_accounts_permissions.sql` 실행
4. Authentication > Users에서 최초 최종관리자 계정 1개 생성
5. Project Settings > API에서 URL / Publishable key / Service role key 확인
6. 프로젝트 `.env.local`과 Vercel Environment Variables에 아래 3개 등록

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

7. 재배포 후 최종관리자로 로그인
8. `직원계정관리` 메뉴에서 강이삭/박형원 및 이후 직원계정을 생성/수정

## v25에서 업그레이드

이미 `001_initial.sql`이 적용되어 있으면 `002_staff_accounts_permissions.sql`만 실행하고 `SUPABASE_SERVICE_ROLE_KEY`를 추가한 뒤 재배포하면 됩니다.

## 현재 운영 역할

- 홍성원: admin / active / is_work_staff=false
- 강이삭: admin / active / is_work_staff=true
- 박형원: staff / active / is_work_staff=true

해당 이름의 기존 profile이 있으면 002 SQL이 위 기준으로 보정합니다. 계정 자체가 아직 없으면 직원계정관리에서 생성하면 됩니다.

## 중요 보안

`SUPABASE_SERVICE_ROLE_KEY`는 Auth 사용자를 생성/변경/삭제할 수 있는 강한 서버 키입니다.

- 절대 `NEXT_PUBLIC_`을 붙이지 않습니다.
- GitHub에 실제 값을 커밋하지 않습니다.
- 브라우저 JS나 클라이언트 컴포넌트에서 import하지 않습니다.
- Vercel 서버 환경변수와 로컬 `.env.local`에만 저장합니다.
