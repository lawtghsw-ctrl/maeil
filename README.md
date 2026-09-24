# 로파워(LawPower) Admin — v25 실사용 전환

기존 in-memory/더미데이터 구조를 제거하고 **Supabase Auth + Postgres + Realtime** 기반의 실제 저장 구조로 전환한 버전입니다.

## 현재 실제로 동작하는 범위

- 최종관리자 이메일/비밀번호 로그인
- DB관리 신규 DB 직접 등록/수정/상담일지/고객전환
- 상담일지 전체 데이터 영구 저장
- Credit4U HTML/XLSX/XLS/CSV 파싱 결과 영구 저장
- 계약 등록/계약 상세
- 분납 일정 등록 및 실제 납부 상태 저장
- 계약금/납부금/미수금 자동 집계
- 예약콜/콜 경고/상담메모 저장
- 대시보드/정산/데이터집계가 실제 저장 데이터 기준으로 계산
- 최저생계비/정산요율 설정 저장
- 변경이력 저장
- 여러 브라우저/직원 동시 사용 시 Supabase Realtime 재동기화

고객/DB/계약 더미데이터는 더 이상 생성하지 않습니다. 최초 로그인 후 빈 화면에서 실제 데이터를 등록해 사용합니다.

## 1. Supabase 프로젝트 생성

Supabase에서 새 프로젝트를 하나 생성합니다.

그 다음 SQL Editor에서 아래 파일을 **전체 실행**합니다.

```text
supabase/migrations/001_initial.sql
```

이 SQL이 다음을 생성합니다.

- profiles
- app_leads
- app_clients
- app_cases
- app_installments
- app_schedule_items
- app_board_posts
- app_change_logs
- app_settings
- RLS 정책
- Realtime publication
- 기본 최저생계비/정산요율 설정

## 2. 최종관리자 계정 생성

Supabase Authentication의 Users 화면에서 이메일/비밀번호 계정 하나를 생성합니다.

**첫 번째 Auth 계정은 자동으로**

- role = `admin`
- display_name = `최종관리자`
- is_active = `true`

로 등록됩니다.

직원계정 생성/세부 권한은 다음 단계에서 구현할 예정입니다. 보안을 위해 두 번째 이후 Auth 계정은 기본 `is_active=false`로 생성되어 업무 데이터에 접근하지 못합니다.

가능하면 직원계정 기능을 붙이기 전까지 Supabase의 공개 회원가입 기능도 비활성 상태로 운영하세요.

## 3. 환경변수

`.env.example`을 복사해서 `.env.local`을 만듭니다.

```powershell
Copy-Item .env.example .env.local
```

`.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

구형 Supabase 프로젝트의 anon key를 쓰는 경우에는 아래 키도 지원합니다.

```env
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Publishable key와 anon key 둘 다 넣을 필요는 없습니다.

## 4. 로컬 실행

```powershell
npm install
npm run build
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속하면 `/login`으로 이동합니다.

## 5. Vercel 배포

Vercel 프로젝트의 Environment Variables에도 동일하게 등록합니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

환경변수 등록 후 다시 배포합니다.

## 데이터 저장 방식

기존 프론트 TypeScript 타입을 그대로 유지하면서 실사용 전환하기 위해 주요 업무 엔티티는 Supabase에서 다음 형태로 저장합니다.

```text
id   text primary key
data jsonb
created_by
created_at
updated_at
```

즉 기존 UI 기능을 대규모로 다시 만들지 않고도 모든 상담/계약/분납 데이터를 실제 DB에 영구 저장합니다. 향후 데이터가 많이 쌓이면 검색/통계에 자주 쓰는 값부터 일반 컬럼으로 분리하면 됩니다.

## 인증/보안

- 로그인하지 않은 사용자는 middleware에서 `/login`으로 이동합니다.
- Supabase RLS가 켜져 있습니다.
- 활성화된 계정만 업무 테이블을 읽고 수정할 수 있습니다.
- 현재는 직원별 세부 권한을 아직 나누지 않았으므로 **최종관리자 계정만 활성화해서 사용하는 상태**가 권장됩니다.
- 직원계정/권한 기능을 만들 때 `profiles.role`, `profiles.staff_name`, `profiles.is_active`를 기반으로 정책을 확장하면 됩니다.

## 현재 별도 외부 연동이 필요한 기능

아래 기능은 Supabase 전환과 별개로 외부 서비스의 API 계정/키가 있어야 실제 전송이 가능합니다.

1. 전자계약서 실제 전송 — 현재 계약정보 미리보기까지 동작
2. 카카오 알림톡/SMS 서류안내문 실제 발송 — 현재 미리보기까지 동작

Credit4U 파일은 브라우저에서 실제로 파싱하고 **추출된 채무정보와 파일 메타정보는 Supabase에 저장**됩니다. 다만 원본 HTML/XLSX 파일 자체는 현재 Supabase Storage에 보관하지 않습니다.

## 직원계정 기능을 나중에 붙일 때

현재 DB 구조는 이미 준비되어 있습니다.

```text
profiles.role       admin / staff
profiles.staff_name 박형원 / 강이삭 / 신홍규 / 이중호
profiles.is_active  true / false
```

다음 단계에서 직원 생성 UI, 메뉴별 권한, 담당자별 데이터 범위, 관리자 승인 기능만 추가하면 됩니다.

## 주요 파일

```text
lib/store.tsx                        Supabase 실DB store
lib/supabase/client.ts               브라우저 Supabase client
lib/supabase/server.ts               서버 Supabase client
middleware.ts                        로그인 세션 보호
app/login/page.tsx                   실제 로그인 화면
supabase/migrations/001_initial.sql  초기 DB/RLS/Realtime SQL
.env.example                         환경변수 예시
```

`PROJECT_HISTORY.md`에는 v24 이전 프로젝트 인계/변경 기록을 보존해두었습니다.
