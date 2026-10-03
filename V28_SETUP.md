# LawPower v28.3 멀티로펌 최초 적용 가이드

이 패키지는 **v27.13 운영본에서 처음 멀티로펌으로 전환하는 경우**를 기준으로 만든 최종 통합본입니다. 이전에 받은 v28.0/v28.1/v28.2 패키지나 SQL을 먼저 적용하지 마세요.

## 목표 구조

- 로파워 `SUPER_ADMIN`
- 로펌별 `FIRM_ADMIN` / `STAFF`
- 로펌 생성 시 내부 UUID + 사용자용 랜덤 숫자 10자리 `firm_code`
- 기존 매일법률사무소 데이터는 첫 번째 로펌으로 자동 귀속
- 로펌별 Google Spreadsheet 완전 분리
- 한 로펌에 Meta 광고계정 여러 개 등록 가능
- 광고소스가 Sheet + Instant Form + Meta 광고계정을 연결
- DB 유입 당시 `law_firm_id / ad_source_id / meta_account_id / meta_lead_id` 고정
- 동일 로펌 전화번호/Meta Lead ID 중복 판정, 기간 경과 재유입 구분
- Meta 자동 피드백 queue + 실패 재시도
- DB 공급 원장 + 과금여부/단가 스냅샷
- 플랫폼 감사로그
- 24시간 1회용 직원 초대코드
- 초대가입 rate-limit
- 모든 사용자 `내 계정` 비밀번호 변경

## 적용 순서

### 1. 코드 덮어쓰기

이 ZIP의 **폴더 안 내용물 전체**를 현재 `C:\Users\PC\Desktop\maeil` 프로젝트 루트에 덮어씁니다.

### 2. Vercel 환경변수 추가

기존 Supabase 환경변수는 유지하고 아래 서버 전용 값을 추가합니다.

- `LAWPOWER_INTEGRATION_ENCRYPTION_KEY` : 32바이트 키. 권장 형식은 랜덤 64자리 HEX.
- `META_GRAPH_API_VERSION` : 실제 Meta Graph API 버전.
- `META_QUEUE_SECRET` : Meta queue 외부 실행용 긴 랜덤 문자열.
- `CRON_SECRET` : Vercel Cron 인증용 긴 랜덤 문자열. `META_QUEUE_SECRET`과 다른 값 권장.

기존 매일 Raw2 호환용 `GOOGLE_SHEETS_WEBHOOK_SECRET`, `GOOGLE_SHEETS_SHEET_NAME`은 당분간 유지합니다.

### 3. Supabase PRE-FLIGHT

`V28_PREFLIGHT.sql`을 SQL Editor에서 실행하고 기존 건수를 확인합니다. 활성 관리자 계정이 최소 1명 있어야 합니다.

### 4. 기존 데이터 스냅샷

`V28_BACKUP.sql`을 **1회만** 실행합니다. `lawpower_v27_backup` 스키마가 생성됩니다. 가능하면 Supabase 프로젝트 전체 백업/내보내기도 별도로 보관하세요.

### 5. 멀티로펌 migration

`supabase/migrations/006_multi_tenant_platform.sql` 전체를 SQL Editor에서 실행합니다.

이 SQL 하나에 v28.0~v28.3 구조가 모두 포함되어 있습니다. 별도의 007 SQL은 없습니다.

### 6. POST-CHECK

`V28_POSTCHECK.sql`을 실행합니다. 특히 다음을 확인합니다.

- `매일법률사무소` 1개가 `is_legacy_default=true`
- 최상위 관리자 1명은 `super_admin`, `law_firm_id=null`
- 기존 나머지 사용자는 매일법률사무소 소속
- 기존 업무테이블 `law_firm_id` 누락 0건
- `firm_settings` 3종 존재
- Meta 기본 자동규칙은 OFF
- `platform_audit_logs`, `lead_supply_ledger`, `public_rate_limits` 존재

### 7. 로컬 확인 후 배포

로컬에서 `npm install` 후 `npm run build`를 실행하고 오류가 없으면 Git commit/push 합니다.

## Meta queue 동작

활성화된 Meta 규칙에 맞는 DB 상태변경이 발생하면 `meta_event_queue`에 작업이 생성됩니다.

- 로펌 사용자가 어드민을 열고 있는 동안: 브라우저가 5분마다 due queue를 안전하게 flush
- Vercel: `vercel.json`의 일일 safety cron이 남은 queue를 한번 더 정리
- 수동: 로펌 연동 화면의 `대기열 전송` 버튼
- 외부 worker: `META_QUEUE_SECRET`으로 `/api/integrations/meta/flush` 호출 가능

여러 직원 브라우저가 동시에 실행해도 DB의 `FOR UPDATE SKIP LOCKED` claim 방식으로 동일 queue를 중복 처리하지 않도록 설계했습니다.

## 신규 로펌 Sheet 연결

로파워 `/platform`에서 로펌을 만들고 `/firm/settings?lawFirmId=...`에서 다음 순서로 등록합니다.

1. Google Sheet 연동 생성 → Secret은 최초 1회 복사
2. Meta 광고계정 등록 (여러 개 가능)
3. 광고소스 생성 → Sheet / Meta 계정 / Form ID / Ad ID 매핑
4. `docs/GOOGLE_APPS_SCRIPT_TEMPLATE.gs`를 해당 로펌 Spreadsheet Apps Script에 적용
5. Apps Script 설정값에 `FIRM_CODE`, `SOURCE_KEY`, `INGEST_SECRET` 입력

신규 로펌 수신은 로펌ID + Source Key + Secret + Spreadsheet ID + Sheet 이름을 검증하며, 광고소스에 Form/Ad ID가 등록되어 있으면 해당 값도 일치해야 합니다.

## 중복/공급 원장

기본 중복기간은 30일입니다.

- 같은 external row 재전송: 동일 건으로 처리
- 동일 Meta Lead ID: 중복
- 같은 로펌 + 같은 전화번호 + 중복기간 이내: 중복
- 같은 로펌 + 같은 전화번호 + 기간 경과: `reentry` 신규 DB
- 다른 로펌의 같은 전화번호: 서로 다른 DB

`lead_supply_ledger`에는 신규/재유입/중복 판정과 유입 당시 단가가 기록됩니다. 기존 v27 이력은 `backfill`로 보존되며 자동 과금대상에서 제외됩니다.

## 보안 기준

- Meta Access Token은 AES-256-GCM 암호화 후 저장
- 토큰 원문은 다시 조회하지 않음
- 로펌 정지 시 사용자/RLS/API 모두 차단
- 다른 로펌 Sheet/Meta/고객/계약 참조를 DB trigger에서 차단
- 초대코드는 24시간, 1회용
- `/join`은 IP 및 초대코드 기준 15분 rate-limit 적용
- 감사로그에는 IP 원문 대신 해시만 저장

## 복구

문제가 생기면 바로 임의로 v28 컬럼/테이블을 삭제하지 말고 `V28_ROLLBACK.md`를 확인하세요. 코드 롤백 기준 v27.13 커밋은 `385b467`입니다.
