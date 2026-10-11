로파워 회생 어드민 v28.27 — 로펌 광고 연동 설정 삭제

[수정]
- 로펌 설정 > Meta 광고계정, Google Sheet, 광고소스 매핑, Meta 자동전송 규칙: 삭제 버튼 추가
- 삭제 전 대상 로펌/설정명 확인 팝업
- 서버에서 로파워 슈퍼어드민 권한 + 로펌 소유권 검사
- 기존 DB, Meta 전송 기록, 공급원장, 다른 설정과 연결된 설정은 삭제 차단 (비활성화 사용)
- 이미 DB를 수신한 Google Sheet 연동 삭제 차단
- 실제 삭제 성공 여부 검사 + 플랫폼 감사 로그
- 삭제 중 중복 클릭 방지 / 실패 시 화면 오류 표시
- 고객 데이터/계약/원장/기존 연결 기록 삭제 없음

[적용: 기존 파일 전체를 오래된 버전으로 덮어쓰지 않도록 패치 방식]
1. 이 압축파일의 apply-v28.27.cjs를 프로젝트 최상위 폴더(package.json이 있는 위치)에 복사
2. 그 폴더에서 명령 실행: node apply-v28.27.cjs
3. 성공 확인 후: npm run build
4. Git commit / push / Vercel 배포

[수정 파일]
app/api/firm/integrations/route.ts
app/firm/settings/page.tsx

[주의]
- 자동 생성 백업: 각 파일 옆에 .v28.27.bak 확장자로 저장
- 버전이 달라 대상 코드가 없으면 패치가 적용되지 않으며 원본 보존
- 기존 Supabase SQL 변경 없음
- 파일은 현재 소스 기준으로 패치되며, GitHub main의 옛 파일로 되돌리지 않음
- 로컬에 설치된 프로젝트에서 실제 npm run build 및 운영 Supabase 연결 테스트는 아직 하지 못함
- 다른 로펌 설정을 삭제할 수 없도록 API에서 로펌 ID를 검증
