# 문자 테스트 중계 서버 설치 검토

이 폴더는 **실제 발송 기능이 없는 테스트 전용 중계**의 설치 자료입니다. 설치 스크립트는 기본적으로 점검만 하며, `--install`도 서비스 시작·자동 시작 등록·인증서 발급·문자 요청을 하지 않습니다. 서버 작업은 운영자가 아래 단계를 확인한 뒤 실행합니다.

현재 확인된 대상은 **Rocky Linux 9.4 / x86_64, 1 CPU, 약 1GB RAM, 기존 swap 약 495MB**, 호스트명 `isaack87.mycafe24.com`입니다. SSH 배너로 OS를 추정하지 않고 실행 시 `/etc/os-release`를 검사합니다. 허용 OS는 Rocky 9.x 및 Ubuntu 22.04/24.04뿐입니다.

## 1. 변경 전 점검

```bash
sudo bash deploy/install-relay.sh --check
```

- 기존 80·443·8787 리스너가 다른 서비스 소유이면 중단합니다. 기존 httpd/nginx를 중지하거나 설정을 덮어쓰지 않습니다.
- SELinux, firewalld, SSH, 메모리·swap 상태를 표시합니다. iptables 등 다른 방화벽과 클라우드 방화벽은 별도 확인 대상입니다. **SSH 허용 규칙·기존 swap을 보존**합니다.
- 별도 swap을 자동으로 만들지 않습니다. 실제 메모리 압박이 관찰되면 기존 swap·디스크·백업 정책을 확인하고 별도 작업으로 판단합니다.

## 2. 명시적 설치와 비밀값 입력

```bash
sudo bash deploy/install-relay.sh --install --source /absolute/path/sms-relay
sudoedit /etc/lawpower-sms-relay/relay.env
```

`nginx`, `curl`, `ca-certificates`가 없을 때만 OS 공식 패키지 관리자로 설치합니다. Ubuntu에서는 임시 `policy-rc.d`로 패키지의 자동 서비스 시작을 차단합니다. 기존 정책 파일이 있으면 그대로 두고 중단합니다. Rocky의 기존 웹서버·DB 서비스 활성 상태와 설정은 수정하지 않습니다.

Node.js는 [공식 v24.22.0 LTS 릴리스](https://nodejs.org/en/blog/release/v24.22.0)의 Linux `tar.gz`를 고정 SHA-256으로 검증한 뒤 설치합니다. x64와 arm64만 지원하며 `curl | sh`, npm 설치, 기존 시스템 Node 교체를 하지 않습니다. 공개 해시 원본은 [공식 SHASUMS256.txt](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt)입니다.

| 항목 | 경로 / 동작 |
|---|---|
| Node | `/opt/lawpower-sms-relay/node-v24.22.0`, `node` 심볼릭 링크 |
| 앱 | `/opt/lawpower-sms-relay/app/src/server.mjs` |
| 비밀값 | `/etc/lawpower-sms-relay/relay.env`, root 소유 `0600` |
| 실행 계정 | `lawpower-sms-relay`, 시스템 계정, nologin, 홈 생성 없음 |
| 중계 unit | `lawpower-sms-relay.service`, 반드시 `127.0.0.1:8787` |
| HTTPS unit | `lawpower-sms-relay-gateway.service`, 기존 `nginx.service`와 독립 |

환경 파일의 `RELAY_BEARER_TOKEN`은 충분히 긴 임의 토큰, `ALIGO_SENDER_ALLOWLIST`는 알리고에 등록된 발신번호 목록이어야 합니다. 통합이 `ALIGO_CREDENTIAL_SOURCE=request`를 사용하면 `ALIGO_API_KEY`와 `ALIGO_USER_ID`는 비워 두고 인증된 호출의 일회성 provider 필드로 받습니다. `server-env` 모드에서는 두 값을 서버에 입력합니다. 실비밀값을 명령 인자·메신저·Git·로그에 넣지 않습니다. 빈 예제 파일은 서버 시작에 실패하도록 되어 있습니다. 테스트 모드·고정 메시지·알리고 목적지는 환경변수로 실발송 모드로 바꿀 수 없습니다.

기존 앱·unit·nginx 설정이 파일 내용과 다르면 스크립트가 중단합니다. 재실행은 동일 자료에 한해 안전하며, 업데이트·롤백은 차이를 검토하는 별도 작업입니다. 중단 전 설치된 패키지나 파일을 자동 삭제하지 않습니다.

## 3. 인증서가 준비된 뒤 HTTPS 구성

DNS A 레코드와 외부 접근 가능한 TCP 80/443을 운영자가 먼저 확인합니다. Let's Encrypt 발급·갱신은 별도 작업이며, 기존 SSH 규칙은 유지합니다. 스크립트에는 HTTP 80 리스너가 없습니다. standalone 인증서 발급 시 80 포트가 다른 프로세스에 점유되지 않아야 합니다.

```bash
sudo bash deploy/install-relay.sh --configure-https \
  --server-name isaack87.mycafe24.com \
  --cert /etc/letsencrypt/live/isaack87.mycafe24.com/fullchain.pem \
  --key /etc/letsencrypt/live/isaack87.mycafe24.com/privkey.pem
```

실재 파일, 신뢰 가능한 인증서 체인, 호스트명/IP 일치, 24시간 이상 유효기간, 키 일치, 개인키 root `0600`을 확인합니다. 실패하면 외부 중계 설정을 만들지 않습니다. 별도 설정 `/etc/lawpower-sms-relay/nginx.conf`만 사용하며 `/etc/nginx`의 기존 설정을 포함하거나 변경하지 않습니다. HTTPS는 정확한 `/v1/aligo/test` POST와 비밀값 없는 `/health` GET만 중계하고 나머지는 차단합니다. 공개 HTTP 리스너는 없습니다. NGINX 접근 로그와 요청 URI가 포함될 수 있는 오류 로그는 저장하지 않으며, 설정 오류는 `nginx -t`와 서비스 종료 상태로 확인합니다.

SELinux가 Enforcing이면 프록시 네트워크 허용 정책이 준비되지 않은 상태에서 중단합니다. 설치 스크립트는 SELinux를 끄거나 전역 boolean을 바꾸지 않습니다. 필요 시 [RHEL 9 공식 NGINX 프록시 문서](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/deploying_web_servers_and_reverse_proxies/setting-up-and-configuring-nginx_deploying-web-servers-and-reverse-proxies)를 기준으로 기존 서비스에 미치는 영향을 별도 검토합니다. 현재 대상은 SELinux Disabled로 확인됐습니다.

## 4. 운영자가 시작·건강 상태·갱신 확인

```bash
sudo systemd-analyze verify /etc/systemd/system/lawpower-sms-relay.service /etc/systemd/system/lawpower-sms-relay-gateway.service
sudo systemctl start lawpower-sms-relay.service
curl --fail http://127.0.0.1:8787/health
sudo systemctl start lawpower-sms-relay-gateway.service
sudo systemctl status lawpower-sms-relay.service lawpower-sms-relay-gateway.service --no-pager
```

`/health`는 상태 조회이며 알리고를 호출하지 않습니다. HTTPS에서도 GET만 허용하므로 외부 점검에 사용할 수 있습니다. 이 문서에는 알리고 테스트 요청을 자동 실행하는 명령도 넣지 않았습니다. 외부 점검은 HTTPS 인증서·health와 인증 없는 POST의 `401`, 잘못된 경로의 `404`를 확인하면 됩니다. Bearer 없이 요청하면 알리고까지 전달되지 않습니다.

재부팅 후 유지가 필요하면 검증 이후 운영자가 두 unit을 `systemctl enable`합니다. 인증서 자동 갱신 타이머를 확인하고, **갱신 성공 후 전용 `lawpower-sms-relay-gateway.service`에만 reload하는 deploy hook**을 설치해야 합니다. 배포판 기본 `nginx.service` reload로 대체하지 않습니다. `certbot renew --dry-run`은 별도 운영 검증이며 이 스크립트가 실행하지 않습니다. 갱신 hook 파일도 기존 파일을 덮어쓰지 않습니다.

## 로컬 오프라인 검증

```bash
node deploy/check-install.cjs
```

Bash 문법, OS/아키텍처 허용 목록, 기본 점검 모드, 충돌 시 중단, 인증서/호스트명 입력 차단, 고정 해시와 unit/프록시 제한을 확인합니다. 패키지 설치·서비스 실행·네트워크·실제 DB·알리고 호출을 하지 않습니다. Windows에서는 Git Bash를 사용합니다. 실제 systemd·NGINX·인증서 체인 검증은 Linux 서버에서 위 점검으로 마무리해야 합니다.
