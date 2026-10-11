로파워 회생 어드민 v28.27 — 로펌 광고연동 삭제 버튼 (기존 방식: 덮어쓰기 ZIP)

[수정 파일]
app/firm/settings/page.tsx
app/api/firm/integrations/route.ts

[기능]
슈퍼어드민 로펌 설정의 Meta 광고계정 / Google Sheet / 광고소스 매핑 / Meta 전송 규칙에 삭제 버튼 추가.
삭제 확인 후 서버가 로펌 소속·권한·기존 연결 이력을 검증합니다.
기존 고객/광고 귀속·전송 기록이 연결된 설정은 삭제하지 않고 비활성화를 안내합니다.
삭제 이력은 platform_audit_logs에 기록됩니다.

[적용]
1. 프로젝트 원본을 백업합니다.
2. ZIP 안의 app 폴더를 프로젝트 최상위에 복사하여 기존 파일에 덮어씁니다.
3. npm run build
4. 정상이라면 Git commit/push 후 Vercel 배포 확인

[SQL] 추가 SQL 없음
[검증] 현재 GitHub main의 두 파일 SHA와 원본 파일 SHA 일치 확인. TypeScript TSX 구문 검사 통과.
[주의] npm run build 전체 빌드 및 운영 DB 삭제 테스트는 수행하지 않았습니다.
