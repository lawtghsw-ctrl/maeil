# Google Sheet `Raw2` → LawPower 신규 DB 자동연동

## 현재 구조

```text
Meta 회생 광고
  ↓
인스턴트양식
  ↓
Meta 자체 Google Sheets CRM 연동
  ↓
Raw2 (원본 시트)
  ↓
Apps Script가 필요한 컬럼만 추출
  ↓
LawPower DB관리
  ↓
최초 담당자 박형원
```

`Raw2`의 광고 ID, 광고세트 ID, 캠페인 ID, 폼 ID, Meta lead id, lead_status 같은 값은 LawPower 고객정보로 보내지 않습니다.

## Raw2에서 사용하는 컬럼

열 위치가 바뀌어도 **1행의 헤더명으로 찾기 때문에 문제없이 동작**합니다.

| Raw2 헤더 | LawPower 표시 |
|---|---|
| `created_time` | 접수일 |
| `full_name` | 이름 |
| `phone` | 연락처 |
| `ad_name` | 리드정보 > 광고명 |
| `email` | 리드정보 > 이메일 |
| `청산_해야하는_총액수` | 리드정보 > 채무 총금액 |
| `월수익` | 리드정보 > 실 월소득 |
| `빚_청산을_위한_상담_가능_시간대를_알려주세요.` | 리드정보 > 상담가능시간 |

LawPower가 자체적으로 넣는 값:

- 유입경로: `메타`
- 상담후방향: 미지정
- 최초 담당자: `박형원`
- 진행단계: `신규디비`
- 예약일시: 미지정

## 사용하지 않는 Raw2 컬럼

현재 아래 값은 읽거나 LawPower 고객정보에 저장하지 않습니다.

```text
ad_id
adset_id
adset_name
campaign_id
campaign_name
form_id
form_name
is_organic
platform
lead_status
id
기타 미지정 컬럼
```

## 1. Supabase

v27.7까지 SQL을 적용했다면 **v27.8용 추가 SQL은 없습니다.**

신규 DB 최초 담당자를 박형원으로 두는 것은 `005_db_intake_owner_park.sql` 설정을 그대로 사용합니다.

## 2. Vercel 환경변수

권장값:

```env
GOOGLE_SHEETS_WEBHOOK_SECRET=기존에_사용중인_비밀키
GOOGLE_SHEETS_SHEET_NAME=Raw2
```

v27.8 API는 전환 과정에서 기존 환경변수가 `DB가공`으로 남아 있어도 `Raw2` 요청을 허용하지만, 관리상 Vercel 값도 `Raw2`로 바꾸는 것을 권장합니다.

환경변수를 수정했다면 Vercel에서 재배포하세요.

## 3. Google Apps Script

기존 Telegram 스크립트는 건드리지 않습니다.

1. `Raw2`가 들어있는 Google Spreadsheet를 엽니다.
2. `확장 프로그램 → Apps Script`로 이동합니다.
3. LawPower 연동용 `.gs` 파일을 열거나 새 파일 `LawPowerRaw2.gs`를 만듭니다.
4. 이 폴더의 `Code.gs` 내용을 **LawPower 연동 파일에만** 전체 붙여넣습니다.
5. 기존 Telegram 관련 `.gs` 파일은 그대로 둡니다.
6. 스크립트 속성은 기존 값을 그대로 사용합니다.

```text
LAWPOWER_WEBHOOK_URL = https://maeil.vercel.app/api/integrations/google-sheets/leads
LAWPOWER_WEBHOOK_SECRET = Vercel의 GOOGLE_SHEETS_WEBHOOK_SECRET과 동일값
```

## 4. 헤더 확인

Apps Script에서 먼저 아래 함수를 실행하세요.

```text
showLawPowerRaw2HeaderMap
```

정상이면 로그에 최소한 아래 3개가 실제 열로 표시되어야 합니다.

```text
intakeAt  -> created_time
name      -> full_name
phone     -> phone
```

그리고 adName/email/debt/income/consultTime도 해당 Raw2 헤더가 있으면 열 번호가 표시됩니다.

## 5. 최초 기준점 설정

헤더 확인 후 아래를 **딱 1번** 실행합니다.

```text
setupLawPowerSync
```

실행한 순간의 Raw2 마지막 행까지는 기존 DB로 보고 가져오지 않습니다.
그 다음 새로 들어오는 행부터 1분마다 LawPower로 전송합니다.

> 테스트 DB를 Raw2에 넣은 뒤 `setupLawPowerSync()`를 다시 실행하면 그 테스트 행까지 기준점으로 넘어가므로 주의하세요.

## 6. 연결 테스트

실제 고객 DB를 만들지 않고 연결만 검사하려면:

```text
testLawPowerWebhook
```

정상 로그:

```text
HTTP 200
ok:true
```

실제 신규 Raw2 행이 들어온 뒤 바로 확인하고 싶다면:

```text
syncLawPowerNewRows
```

을 수동 실행할 수 있습니다.

## DB관리에서 보이는 결과

예를 들어 Raw2 한 행이 아래라면:

```text
created_time = 2026-09-29T06:30:00+0000
ad_name = 회생 소재 A
full_name = 홍길동
phone = 01012345678
email = test@example.com
청산_해야하는_총액수 = 5천만원~1억원
월수익 = 300만원
빚_청산을_위한_상담_가능_시간대를_알려주세요. = 평일 오후
```

DB관리에는 다음처럼 들어옵니다.

```text
접수일        created_time 기준
이름          홍길동
연락처        010-1234-5678
리드정보      광고명 / 이메일 / 채무 총금액 / 실 월소득 / 상담가능시간
상담후방향    미지정
담당자        박형원
진행단계      신규디비
예약일시      미지정
유입경로      메타
```

## 운영 중 주의

- `Raw2` 1행 헤더명은 위 표의 이름을 유지하는 것이 가장 안전합니다.
- 열 순서는 바뀌어도 괜찮습니다.
- Meta가 아직 행을 쓰는 중이라 `full_name` 또는 `phone`이 비어 있으면 그 행은 넘기지 않고 다음 실행에서 다시 확인합니다.
- 이미 정상 전송한 행은 서버 중복방지로 같은 DB가 두 번 생기지 않습니다.
- 행 삭제/중간 삽입보다는 Meta가 아래쪽으로 계속 append하는 원본 형태를 유지하는 것이 안전합니다.
