LawPower v28.22 - 문자발송 센터 / 알리고 연동 준비

이번 버전은 "API 연결 전 단계"입니다.
실제 알리고 API 호출은 하지 않으며, 수기/자동 문자 모두 sms_outbox에 status=pending_api 로 저장됩니다.

구현
- 좌측 메뉴: 문자발송
- 문자사이트 형태의 문자 보내기 UI
- 담당자별 발신번호 선택
- CSV/XLS/XLSX 주소록 드래그앤드롭
- 연락처 수기 입력 / 여러 줄 붙여넣기
- 문구 작성 + 저장 문구
- SMS/LMS 예상 바이트/유형 표시
- 이미지 최대 3장 업로드 (Supabase sms-media 비공개 버킷)
- 예약발송 입력
- 발송대기 등록 버튼
- 발송내역 / 상태 / 알리고 msg_id 자리
- 담당자별 발신번호 관리 + 기본번호
- 문구 템플릿 관리
- 신규 DB 입고 시 담당자 번호로 자동문자 대기열 생성
- 상담일지에서 "부재중" 기록 추가 시 자동문자 대기열 생성
- 부재중 중복클릭 방지 시간 설정
- 자동문자 ON/OFF + 문구 수정

자동문자 기본 문구
신규DB:
[로파워] {고객명}님, 상담 접수가 확인되었습니다. 담당자 {담당자}이(가) 곧 연락드리겠습니다.

부재중:
[로파워] {고객명}님, 상담 관련하여 연락드렸으나 통화가 연결되지 않아 문자드립니다. 확인 후 편하실 때 연락 부탁드립니다.

적용
1. v28.21.2 위에 ZIP 덮어쓰기
2. Supabase SQL Editor에서 supabase/migrations/014_sms_center_foundation.sql 전체 실행
3. 마지막 4개 결과가 모두 true인지 확인
4. 배포
5. 문자발송 > 발신번호·문구에서 담당자별 발신번호 등록
6. API 연동 전까지는 "API 연동대기"로만 쌓이는 것이 정상

알리고 API 연결 때 추가할 서버 작업
- ALIGO_API_KEY / ALIGO_USER_ID 환경변수
- /send 또는 /send_mass 서버 라우트
- sms-media image_paths를 multipart image1~3로 첨부
- 예약 rdate/rtime 변환
- testmode_yn=Y 검증
- 응답 msg_id / success_cnt / error_cnt 저장
- /sms_list 결과 동기화로 sent/failed 갱신
- 잔여건수(remain) 카드
