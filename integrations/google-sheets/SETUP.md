# Google Sheet `DB가공` → LawPower 신규 DB 자동연동

## 고정 열 순서

| 열 | 시트 헤더 | LawPower 저장값 |
|---|---|---|
| A | 인입 시기 | DB 접수시각(receivedAt) |
| B | 광고명 | 광고명(adName) |
| C | 성함 | 고객명(name) |
| D | 휴대폰 | 연락처(phone) |
| E | 이메일 | 이메일(email) |
| F | 채무규모 | 채무규모(debtRange / 원본값) |
| G | 월소득 | 월소득(incomeRange / 원본값) |
| H | 상담희망시간 | 상담희망시간(consultTime / 원본값) |

시트명은 반드시 `DB가공`으로 유지합니다.

## 특징

- `setupLawPowerSync()`를 실행하는 순간의 마지막 행까지는 **기존 DB로 간주하여 가져오지 않습니다.**
- 그 다음 추가되는 행부터 1분 간격으로 자동 전송합니다.
- 동일 시트 행은 `스프레드시트ID + 시트명 + 행번호`로 중복방지됩니다.
- 신규 DB는 Supabase에서 **활성 + 실무담당 + DB 자동배정 참여** 직원에게 라운드로빈으로 배정됩니다.
- 현재 기본 순서는 `강이삭 → 박형원 → 강이삭 → 박형원...` 입니다.
- 최종관리자는 DB관리에서 기존처럼 담당자를 수동 변경할 수 있습니다.

## 1. Supabase

`supabase/migrations/003_google_sheet_leads_round_robin.sql`을 SQL Editor에서 1회 실행합니다.

## 2. Vercel 환경변수

다음을 추가하고 재배포합니다.

```env
GOOGLE_SHEETS_WEBHOOK_SECRET=충분히_긴_랜덤_문자열
GOOGLE_SHEETS_SHEET_NAME=DB가공
```

`GOOGLE_SHEETS_WEBHOOK_SECRET`은 외부에 공개하지 마세요.

## 3. Google Apps Script

1. 대상 Google Sheet를 엽니다.
2. `확장 프로그램 → Apps Script`로 이동합니다.
3. 프로젝트의 `Code.gs` 내용을 이 폴더의 `Code.gs` 전체로 교체합니다.
4. Apps Script의 `프로젝트 설정 → 스크립트 속성`에 아래 두 값을 추가합니다.

```text
LAWPOWER_WEBHOOK_URL = https://실제-어드민-도메인/api/integrations/google-sheets/leads
LAWPOWER_WEBHOOK_SECRET = Vercel에 넣은 값과 동일한 비밀키
```

5. Apps Script 편집기에서 `setupLawPowerSync`를 선택하여 **딱 1번 실행**하고 Google 권한을 승인합니다.
6. 실행 로그에 `기존 N행까지는 건너뛰고 N+1행부터` 문구가 뜨면 완료입니다.

> `setupLawPowerSync()`를 실행하기 전 시트에 이미 있던 DB는 가져오지 않습니다.


## 연결 진단

배포 후 Apps Script에서 `testLawPowerWebhook()`을 수동 실행하면 실제 DB를 만들지 않고 webhook 경로/비밀키만 점검합니다.
정상 로그는 `HTTP 200`과 `ok:true`입니다. `307/308`과 `/login`이 보이면 운영 배포가 아직 v27.1 이전 코드라 로그인 middleware가 webhook을 가로채고 있는 상태입니다.

## 4. 테스트

설정 완료 후 `DB가공`의 가장 아래에 실제 신규 DB 한 줄을 추가합니다. 최대 약 1분 뒤 LawPower `DB관리`에 나타나며, 담당자는 현재 라운드로빈 순서에 따라 자동 지정됩니다.

### 자동배정 대상 변경

`직원계정관리`에서 각 계정의 다음 조건을 확인합니다.

- 계정 활성화 = ON
- 실무 담당자로 사용 = ON
- 신규 DB 자동배정 참여 = ON
- 배정 순서 = 숫자가 작은 직원부터 순환

예: 강이삭 10 / 박형원 20 → 강이삭 → 박형원 → 강이삭 → 박형원 ...

## 운영 중 주의

- 중간 행을 삽입/삭제해서 이미 처리된 행번호가 바뀌는 방식은 피해주세요. 신규 DB는 항상 아래쪽에 추가하는 형태가 안전합니다.
- 웹훅이 실패하면 Apps Script의 마지막 처리 행은 앞으로 이동하지 않습니다. 다음 실행 때 다시 시도하며, 서버 중복방지 때문에 성공했던 행은 이중 등록되지 않습니다.
- `resetLawPowerSyncToCurrentRow()`는 누락된 행까지 의도적으로 버리고 현재 행 다음부터 다시 시작할 때만 사용합니다.
