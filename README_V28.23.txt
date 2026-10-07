LawPower v28.23 - 영업자별 자동문자 + 자동 MMS 이미지

적용 순서
1. v28.22가 적용된 최신 프로젝트에 이 압축파일을 덮어쓰기
2. Supabase SQL Editor에서 supabase/migrations/015_sms_staff_automation_images.sql 실행
3. npm run build 또는 Vercel 배포

변경사항
- 문자발송 > 자동발송에서 영업자를 선택해 각 영업자별 설정 저장
- 영업자별 신규 DB 즉시문자 문구 별도 지정
- 영업자별 부재중 자동문자 문구 별도 지정
- 저장된 문구 템플릿을 각 자동문자에 선택 적용
- 영업자별 자동발송 발신번호 선택 가능
- 신규 DB 자동문자 이미지 최대 3장 저장
- 부재중 자동문자 이미지 최대 3장 저장
- 자동문자에 이미지가 있으면 sms_outbox에 MMS + image_paths로 등록
- 영업자별 설정이 없으면 기존 로펌 기본 자동문구로 fallback
- 부재중 중복발송 방지 시간은 로펌 공통값 유지

주의
- 알리고 API는 아직 연결하지 않았으므로 실제 발송은 하지 않고 pending_api 대기열에 저장됩니다.
- 이미지 파일은 기존 sms-media private bucket에 저장됩니다.
