# 로파워(LawPower) Admin — v27 Google Sheet 신규 DB 자동연동

v26의 **Supabase 실사용 + 직원계정/세부권한 구조**에 Google Sheet `DB가공` 신규 DB 자동수집과 실무담당자 라운드로빈 자동배정을 추가한 버전입니다.


## v27 추가 핵심

- Google Sheet 시트명 `DB가공` 자동연동
- 열 순서: `인입 시기 / 광고명 / 성함 / 휴대폰 / 이메일 / 채무규모 / 월소득 / 상담희망시간`
- 최초 설정 시점 이전의 기존 행은 가져오지 않고 **그 이후 새로 들어오는 행만 수집**
- 1분 간격 Apps Script 전송
- 동일 행 중복수집 방지
- 신규 DB를 `활성 + 실무담당 + DB자동배정 참여` 직원에게 라운드로빈으로 균등 배정
- 현재 기본 순서: **강이삭 → 박형원 → 강이삭 → 박형원...**
- 직원계정관리에서 `신규 DB 자동배정 참여`와 `배정 순서`를 직접 수정
- 홍성원은 최종관리자 권한을 유지하지만 `실무 담당 OFF`이므로 자동배정 제외
- 최종관리자는 기존처럼 DB관리에서 담당자를 언제든 수동 변경 가능

자세한 Google Sheet 설정은 `integrations/google-sheets/SETUP.md`를 확인하세요.

## 기존 v26 핵심

- 최종관리자 전용 `직원계정관리` 메뉴
- 어드민 화면에서 직원/최종관리자 계정 직접 생성
- 계정 활성/비활성, 이메일, 이름, 임시/새 비밀번호 변경
- `실무 담당자로 사용` 토글
- 메뉴/기능 단위 세부 권한을 체크박스로 직접 설정
- 권한 프리셋 적용 후 수기 재조정 가능
- 저장 즉시 Realtime 반영
- DB관리 담당자 버튼/드롭다운을 `profiles.is_work_staff=true` 계정으로 자동 생성
- 직원명 변경 시 기존 DB/고객/계약 담당자 문자열 및 정산요율 키 자동 이전
- 직원 삭제 전 남은 담당 DB/고객/계약 확인
- 직원계정 변경이력도 `기간별 변동내역 > 설정`에 기록
- 프론트 메뉴 숨김뿐 아니라 Supabase RLS/DB trigger로 조회범위와 주요 수정권한을 함께 제한

현재 운영 기준은 다음과 같습니다.

- **홍성원**: 최종관리자와 동일 권한, 개발자 계정, `실무 담당자로 사용 = OFF`
- **강이삭**: 최종관리자, 실제 상담/DB 업무 수행, `실무 담당자로 사용 = ON`
- **박형원**: 직원, 실제 상담/DB 업무 수행, `실무 담당자로 사용 = ON`

홍성원은 DB 담당자 버튼에 나오지 않고 강이삭·박형원은 표시됩니다. 이후 최종관리자가 새 사용자를 만들 때 `실무 담당자로 사용`을 켜면 같은 방식으로 자동 추가됩니다.

## 1. Supabase SQL 적용

신규 프로젝트라면 SQL Editor에서 순서대로 실행합니다.

```text
supabase/migrations/001_initial.sql
supabase/migrations/002_staff_accounts_permissions.sql
supabase/migrations/003_google_sheet_leads_round_robin.sql
```

이미 v26까지 적용된 프로젝트라면 **003만 추가 실행**하면 됩니다.

`002_staff_accounts_permissions.sql`은 다음을 추가합니다.

- `profiles.permissions jsonb`
- `profiles.is_work_staff boolean`
- 권한 확인 함수
- 담당자명 변경 RPC
- DB/계약/분납/설정/이력의 권한 기반 RLS
- JSONB 내부 주요 필드 변경을 검사하는 DB trigger
- profiles Realtime 반영

## 2. 환경변수

`.env.example`을 `.env.local`로 복사합니다.

```powershell
Copy-Item .env.example .env.local
```

필수 값:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
GOOGLE_SHEETS_WEBHOOK_SECRET=충분히_긴_랜덤_문자열
GOOGLE_SHEETS_SHEET_NAME=DB가공
```

`SUPABASE_SERVICE_ROLE_KEY`는 **직원계정 생성/수정/삭제 API에서만 서버 측으로 사용**합니다. 절대 `NEXT_PUBLIC_`을 붙이지 말고 브라우저 코드, 메신저, GitHub 저장소에 노출하지 마세요.

구형 프로젝트는 Publishable key 대신 아래 값도 지원합니다.

```env
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

## 3. Vercel 환경변수

Vercel > Project > Settings > Environment Variables에 아래 3개를 등록하고 재배포합니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_SHEETS_WEBHOOK_SECRET
GOOGLE_SHEETS_SHEET_NAME
```

Service role key는 Vercel의 서버 환경변수로만 저장됩니다.

## 4. 최초 최종관리자

`001_initial.sql` 구조에서는 첫 번째 Supabase Auth 사용자가 자동으로 `admin / active`가 됩니다.

이미 최종관리자 로그인이 되는 상태라면 추가 Auth 계정을 Supabase 화면에서 직접 만들 필요가 없습니다. 로그인 후 사이드바의 **직원계정관리**에서 이후 계정을 생성하세요.

현재 첫 계정 이름이 `최종관리자`처럼 되어 있다면 직원계정관리에서 본인 계정 이름을 `홍성원` 또는 실제 사용자명으로 수정할 수 있습니다. 본인 계정의 비활성화/직원 강등/삭제는 안전상 차단됩니다.

## 5. 직원계정 생성

최종관리자 로그인 → `직원계정관리` → `직원계정 생성`

입력 항목:

- 직원명
- 로그인 이메일
- 임시 비밀번호(8자 이상)
- 계정 구분: 직원 / 최종관리자
- 계정 활성화
- 실무 담당자로 사용
- 신규 DB 자동배정 참여
- DB 자동배정 순서
- 직원일 경우 세부 권한

계정만 먼저 만들어두려면 **계정 활성화 OFF**로 생성하면 됩니다. `실무 담당자로 사용`을 ON으로 두면 비활성 상태여도 DB관리의 담당자 버튼/선택목록에 바로 나타나 사전 배정이 가능합니다.

퇴사/장기중지는 영구삭제보다 **계정 활성화 OFF + 필요 시 실무 담당자 OFF**를 권장합니다. 영구삭제는 해당 이름으로 남은 DB/고객/계약이 있으면 차단됩니다.

## 6. 세부 권한 범위

현재 어드민 기능을 기준으로 다음 영역을 개별 체크할 수 있습니다.

- 대시보드: 기본 조회, 전사 상단실적, 전사 투두, 금액정보, 분납캘린더, 기일캘린더, 기간통계/차트
- DB관리: 본인 DB 조회, 전체 DB 조회, 금액요약, 신규등록, 기본정보수정, 상담일지 조회/수정, 진행단계, 담당자변경, 예약, 고객/계약 전환
- 계약관리: 본인/전체 조회, 금액정보, 계약등록, 담당자변경, 분납관리, 전자계약서, 서류안내문
- 정산: 본인/전체 조회, CSV, 정산설정 조회/수정
- 운영기준: 최저생계비 조회/수정
- 이력/집계: 본인/전체 변경이력, 본인/전사 데이터집계, 금액통계

`최종관리자` 역할은 체크박스와 무관하게 전체 기능을 사용할 수 있습니다. `직원계정관리` 자체는 최종관리자에게만 보이며 직원에게 권한으로 부여할 수 없습니다.

서로 종속되는 권한은 저장 시 안전하게 자동 보정됩니다. 예를 들어 `분납관리`를 허용하면 계약 조회/금액 조회가 같이 켜지고, `상담일지 수정`을 허용하면 상담일지 조회도 같이 켜집니다.

## 7. 데이터 범위

일반 직원은 기본적으로 **본인 담당 데이터**만 조회합니다. `전체 담당자 DB 조회`, `전체 담당자 계약 조회`, `전체 정산`, `전사 데이터집계` 같은 권한은 별도로 켜야 합니다.

최종관리자는 전체 데이터를 봅니다.

대시보드의 개인/전체 기준도 권한에 따라 동작합니다. 직원의 기본 상단 KPI는 본인 담당 실적이고, `전사 상단 실적 조회`를 켜면 전체 실적을 볼 수 있습니다.

## 8. 동적 담당자

담당자 목록은 더 이상 코드의 고정 직원 배열을 기준으로 운영하지 않습니다.

```text
profiles.is_work_staff = true
```

인 계정을 Realtime으로 불러와 다음에 자동 반영합니다.

- DB관리 담당자 필터 버튼
- 신규 DB 담당자 선택
- 기존 DB 담당자 변경
- 계약 등록 담당자 선택
- 정산설정 담당자 목록

직원명을 바꾸면 기존 `assignedStaff` 데이터도 서버 RPC로 함께 변경됩니다.

## 9. 로컬 실행

```powershell
npm install
npm run build
npm run dev
```

## 10. 외부 API가 별도로 필요한 기능

다음 기능은 화면/권한은 준비되어 있지만 실제 외부 발송에는 각 서비스 API가 필요합니다.

- 전자계약서 실제 전송
- 카카오 알림톡/SMS 서류안내문 실제 발송

## 주요 파일

```text
app/staff-accounts/page.tsx                     직원계정관리 UI
app/api/admin/users/route.ts                    최종관리자 계정관리 서버 API
lib/permissions.ts                              권한 정의/프리셋/종속관계
lib/store.tsx                                   로그인 프로필/동적 담당자/권한 적용
lib/supabase/admin.ts                           service role 서버 클라이언트
supabase/migrations/001_initial.sql             v25 초기 DB
supabase/migrations/002_staff_accounts_permissions.sql  v26 권한/RLS
supabase/migrations/003_google_sheet_leads_round_robin.sql  v27 시트연동/라운드로빈
app/api/integrations/google-sheets/leads/route.ts  Google Sheet webhook
integrations/google-sheets/Code.gs              Google Apps Script
integrations/google-sheets/SETUP.md              연동 설정 가이드
.env.example                                    환경변수 예시
```


## 11. Google Sheet 신규 DB 자동연동

현재 시트 구조는 아래 8열을 사용합니다.

```text
인입 시기 | 광고명 | 성함 | 휴대폰 | 이메일 | 채무규모 | 월소득 | 상담희망시간
```

시트명은 `DB가공`입니다. `integrations/google-sheets/Code.gs`를 해당 스프레드시트의 Apps Script에 붙여넣고 스크립트 속성 2개를 설정한 뒤 `setupLawPowerSync()`를 1회 실행합니다.

중요: `setupLawPowerSync()`는 **실행 당시 마지막 행을 기준점으로 저장**하기 때문에 기존 DB는 가져오지 않습니다. 그 다음 추가되는 행부터 자동수집합니다.

자동배정 대상은 직원계정관리에서 다음 3조건을 모두 만족해야 합니다.

```text
계정 활성화 ON
실무 담당자로 사용 ON
신규 DB 자동배정 참여 ON
```

`배정 순서` 숫자가 작은 직원부터 순환합니다. 현재 운영 기준은 강이삭 `10`, 박형원 `20`입니다.

### v27.3 추가 적용
기존 001~003 migration을 적용한 운영 DB에서는 `supabase/migrations/004_db_lead_delete_permission.sql`을 Supabase SQL Editor에서 1회 실행하세요. DB관리의 삭제 버튼은 최종관리자에게 즉시 보이며, 직원에게는 직원계정관리에서 `DB 고객정보 삭제` 권한을 직접 체크한 경우에만 노출됩니다.
