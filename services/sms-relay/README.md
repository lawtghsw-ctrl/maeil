# 로파워 알리고 테스트 중계 서버

Node.js 22/24의 내장 모듈만 사용하는 별도 중계 서버입니다. `npm install` 없이 실행합니다. 기존 어드민 코드나 데이터베이스를 포함하지 않습니다.

**테스트 전용입니다. 실제 문자 발송 기능과 전환 옵션이 없습니다.** 알리고 요청은 항상 `https://apis.aligo.in/send/`로 보내며 `testmode_yn=Y`를 서버가 강제합니다. 문구도 `[로파워] API 연결 테스트입니다. 실제 발송되지 않습니다.`로 고정합니다. 입력·환경변수로 URL, 문구, 테스트 플래그, 예약, 수신자 목록을 바꿀 수 없습니다.

알리고 공식 문서는 테스트 모드에서 실제 문자 전송과 과금 처리를 제외한다고 설명합니다. 이 중계 응답은 API 요청 접수 결과이며 휴대폰 수신 확인이 아닙니다. [알리고 문자 API 문서](https://smartsms.aligo.in/admin/api/spec.html)

## 실행과 검증

```sh
node --test
node src/server.mjs
```

시작 전에 아래 환경변수를 설정해야 합니다. 누락된 인증 정보·빈 발신번호 허용 목록·잘못된 모드는 시작 오류로 처리합니다. 앱은 기본적으로 `127.0.0.1:8787`에만 수신하고, 외부 연결은 별도 HTTPS 프록시를 통해 받습니다. 공개 HTTP 수신 옵션은 없습니다.

현재 검증은 로컬 Node v24.19.0에서 수행했습니다. 테스트는 가짜 HTTPS 전송 계층과 로컬 HTTP 서버를 사용하며 실제 알리고를 호출하지 않습니다. 단위·통합 시험은 인증, 두 자격증명 모드, 고정 전송 필드, 4KiB 제한, 10초 기한, 동시 요청, 중복 방지, 개인정보가 없는 응답을 확인합니다.

## 환경변수

`relay.env.example`은 systemd `EnvironmentFile` 형식입니다. 실제 값은 소스 폴더 밖의 `/etc/lawpower-sms-relay/relay.env`에 저장합니다. 키나 토큰을 명령행 인수, 쉘 기록, 문서, 요청 로그에 넣지 않습니다.

| 변수 | 의미 |
| --- | --- |
| `RELAY_BEARER_TOKEN` | 필수. 서버 간 인증 토큰. URL-safe 문자 32~256자. 충분히 긴 무작위 값 사용 |
| `ALIGO_CREDENTIAL_SOURCE` | `server-env`가 기본. `request`도 허용 |
| `ALIGO_API_KEY` | `server-env`에서 필수. ASCII 비공백 1~256자 |
| `ALIGO_USER_ID` | `server-env`에서 필수. 영문·숫자·`_ . @ -` 1~128자 |
| `ALIGO_SENDER_ALLOWLIST` | 필수. 알리고에 등록된 발신번호를 숫자만 쉼표로 구분. 번호당 8~16자리, 최대 20개 |
| `RELAY_HOST` | 기본 `127.0.0.1`. `::1`만 추가 허용 |
| `RELAY_PORT` | 기본 `8787` |
| `RELAY_MAX_CONCURRENCY` | 외부 요청 동시 처리 수. 기본 `2`, 범위 `1~4` |

현재 어드민과 연결할 때는 **`ALIGO_CREDENTIAL_SOURCE=request`**를 사용합니다. Vercel에 이미 있는 알리고 자격증명을 서버 간 HTTPS 본문으로 전달하므로, 운영 키를 꺼내서 VPS에 수동 복사할 필요가 없습니다. 이 모드에서는 VPS의 `ALIGO_API_KEY`와 `ALIGO_USER_ID`를 비워 둡니다. 전달된 자격증명은 한 번의 외부 요청에만 사용하고 파일·로그·응답·중복 캐시에 저장하지 않습니다.

독립적으로 VPS 환경변수에 알리고 자격증명을 관리하는 구성은 `server-env`를 사용합니다. 이 모드는 요청 본문의 `provider` 필드를 거부합니다. 알 수 없는 자격증명 모드는 허용하지 않습니다.

## HTTP 계약

공개 `GET /health`는 인증 없이 아래 상태만 반환합니다. 자격증명·발신번호·개인정보를 포함하지 않습니다.

```json
{"status":"ok","service":"lawpower-sms-test-relay","mode":"test","testMode":true,"actualDelivery":false}
```

테스트 경로는 `POST /v1/aligo/test` 하나입니다. 쿼리 문자열과 다른 경로는 거부하며 `application/json`만 받습니다. 인증 실패는 본문을 해석하기 전에 처리합니다.

필수 헤더:

```text
Authorization: Bearer <relay-token>
Content-Type: application/json
Idempotency-Key: <16~128자의 영문·숫자·하이픈·밑줄 요청 식별자>
```

`server-env` 본문 구조:

```json
{"sender":"REGISTERED_SENDER","receiver":"TEST_MOBILE"}
```

`request` 본문 구조:

```json
{"sender":"REGISTERED_SENDER","receiver":"TEST_MOBILE","provider":{"key":"SERVER_API_KEY","userId":"SERVER_USER_ID"}}
```

위 값은 실행용 연락처나 자격증명이 아닌 구조 예시입니다. 발신번호는 허용 목록과 정확히 일치해야 합니다. 수신번호는 단일 한국 휴대폰 번호만 허용하며 정규식은 `^01[016789]\d{7,8}$`입니다. 하이픈·공백·쉼표로 구분한 여러 수신자와 추가 필드는 거부합니다.

성공 응답 예시:

```json
{"ok":true,"mode":"test","upstreamAccepted":true,"providerCode":1,"providerMessage":"알리고 테스트 요청이 접수되었습니다.","messageId":null,"testMode":true,"actualDelivery":false}
```

알리고가 명확히 거절한 경우 `502`, 숫자 `providerCode`, 고정 일반 문구를 반환합니다. 숫자와 정수 문자열 형식의 `result_code`를 지원합니다. 제공자의 원문 `message`와 `msg_id`는 반환하지 않습니다. 타임아웃은 `504`, 응답 형식·네트워크·HTTP 문제가 있으면 `502`와 `UPSTREAM_OUTCOME_UNKNOWN`을 반환합니다. 이 경우 자동 재시도하지 않습니다.

| 상태 | 조건 |
| --- | --- |
| `400` | JSON·입력·요청 식별자 형식 오류 |
| `401` | Bearer 인증 실패 |
| `403` | 허용 목록에 없는 발신번호 |
| `404` / `405` | 경로 또는 메서드 미지원 |
| `408` / `413` / `415` | 본문 시간 초과·4KiB 초과·미지원 형식 |
| `409` | 같은 요청이 진행 중이거나 동일 키에 다른 입력 사용 |
| `429` | 동시 외부 요청 수 초과 |
| `503` | 중복 방지 저장 공간이 가득 참 |
| `502` / `504` | 알리고 거절 또는 외부 요청 결과 불확실 |

## 중복과 자원 제한

- 동일 `Idempotency-Key`의 완료 응답은 10분 동안 메모리에 보관합니다. 같은 키의 재요청은 재전송 없이 안전한 기존 응답을 반환합니다. 결과가 불확실했던 요청도 다시 전송하지 않습니다.
- 같은 키에 발신번호·수신번호·자격증명이 바뀌면 `409`를 반환합니다. 캐시는 요청 키 해시, 연락처와 자격증명의 HMAC 해시, 만료 시각과 정제된 응답만 저장합니다.
- 최대 1,000건이며 가득 찼을 때 기존 항목을 밀어내지 않고 새 요청을 거부합니다. 10분 경과나 프로세스 재시작 뒤에는 중복 기록이 사라집니다. 클라이언트는 그 시점에도 불확실한 요청을 자동 재시도하지 않아야 합니다. 영구적인 정확히 한 번 실행을 보장하는 저장소는 아닙니다.
- 외부 요청 기한은 DNS·TLS·응답 본문을 모두 포함해 10초입니다. 외부 응답은 최대 16KiB입니다. 리다이렉트는 따라가지 않습니다. 백오프나 자동 재시도 코드가 없습니다.
- 앱은 요청 본문, 인증 헤더, 전화번호, 문구, 제공자 원문 응답을 로깅하지 않습니다. 시작·리스너 실패 로그도 일반 문구만 사용합니다.

## Ubuntu/systemd 배포

배포 파일은 `deploy/`에 별도로 있습니다. 설치 스크립트의 도움말과 호스트 검사부터 확인합니다. 이 문서 작성 과정에서 실서버에 접속하거나 설치·시작·발송을 수행하지 않았습니다.

```sh
sudo bash deploy/install-relay.sh --check
sudo bash deploy/install-relay.sh --help
```

서비스는 전용 사용자 `lawpower-sms-relay`와 다음 경로를 사용합니다.

- 앱: `/opt/lawpower-sms-relay/app/src/server.mjs`
- Node 실행 파일: `/opt/lawpower-sms-relay/node/bin/node`
- 환경 파일: `/etc/lawpower-sms-relay/relay.env` — root 전용, systemd가 읽음
- 유닛: `lawpower-sms-relay.service`, HTTPS용 `lawpower-sms-relay-gateway.service`

환경 파일은 `sudoedit /etc/lawpower-sms-relay/relay.env`로 설정하고, 전용 서비스의 환경·인증서·HTTPS 도메인을 검토한 뒤 운영자가 서비스를 시작합니다. Node 서비스는 읽기 전용 파일시스템과 메모리 제한을 사용합니다. 로컬 상태 확인은 `curl --fail http://127.0.0.1:8787/health`로 할 수 있으며 알리고 호출을 발생시키지 않습니다. 외부 테스트 본문은 HTTPS를 통해서만 전달합니다.

Node 앱은 런타임 패키지 설치가 필요 없습니다. HTTPS 프록시·OS 패키지·방화벽·SSH·인증서 설정은 배포 스크립트와 별도 운영 절차의 범위입니다. 기존 웹 서비스와 충돌한 경우 설치 스크립트의 중단 결과를 먼저 확인해야 합니다.
