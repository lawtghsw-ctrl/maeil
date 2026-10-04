LawPower v28.8 - 매일법률사무소 개인회생 eformsign 실제 발송

덮어쓰기/추가 파일
- components/cases/CaseActionModals.tsx
- lib/eformsign.ts
- app/api/integrations/eformsign/send/route.ts
- app/api/integrations/eformsign/status/route.ts

필수 Vercel 환경변수
- EFORMSIGN_API_KEY
- EFORMSIGN_PRIVATE_KEY
- EFORMSIGN_MEMBER_ID
- EFORMSIGN_SENDER_MEMBER_ID
- EFORMSIGN_TEMPLATE_ID

선택 환경변수
- EFORMSIGN_LAW_FIRM_CODE=8199226054
  미설정 시 현재 legacy 기본 로펌(매일법률사무소)만 허용합니다.

템플릿 필드 ID 매핑
- 이름 -> 영업자 입력 이름
- 주소 -> 영업자 입력 주소
- 주민번호 -> 영업자 입력 주민번호
- 전화번호 -> 영업자 입력 전화번호
- 채권자 -> 영업자 입력 채권자 수
- 보수 -> 영업자 입력 보수
- 월 -> 계약일 월
- 일 -> 계약일 일
- 갑_이름 -> 영업자 입력 갑 이름
- 갑_서명란 -> API에서 값을 넣지 않음. 의뢰인이 직접 서명

중요
- 주민번호는 로파워 DB에 저장하지 않고 eformsign 발송 요청에만 사용합니다.
- 같은 계약은 eformsignDocumentId가 저장되면 중복 발송이 차단됩니다.
- 발송 후 '서명상태 확인' 버튼으로 eformsign 문서 상태를 직접 조회합니다.
- 결제수단 항목은 전자계약 팝업에서 제거했습니다.
- 현재 템플릿의 연도 2026은 문서 본문에 고정되어 있으므로 2027년부터는 템플릿 수정이 필요합니다.
