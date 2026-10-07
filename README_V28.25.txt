LawPower v28.25 - 상담일지 유실 방지 + 직원 저장 신뢰성 보강

[핵심 수정]
1. 상담일지 작성 중 임시저장
- 고객/DB ID별 localStorage 임시저장(250ms debounce)
- 임시본 24시간 보관 후 자동 만료
- 팝업 닫힘/새로고침 직전 최신값 즉시 저장
- 같은 고객 상담일지 재오픈 시 임시본 자동 복구
- 서버 저장 성공이 확인된 뒤에만 임시본 삭제
- 저장되지 않은 상태에서 X/바깥영역/취소로 닫을 때 경고
- 서버 저장 실패 시 모달 유지 + 입력값 유지 + 오류 표시

2. 직원계정 저장 반복 실패의 공통 원인 수정
- 기존 saveEntity가 모든 저장을 UPSERT로 수행하여 기존 행 UPDATE에도 INSERT RLS가 같이 검사되던 구조 제거
- 먼저 기존 행 존재 여부를 확인한 뒤 UPDATE / INSERT를 명확히 분리
- 저장 실패 직후 reloadData()로 전체 화면을 강제 재로딩하던 동작 제거
  (실패 입력이 즉시 서버값으로 되돌아가 '초기화'되는 현상 방지)
- 저장 실패는 상단 오류로 표시하고 현재 화면 입력을 유지

3. DB 상담일지 저장
- updateLead가 서버 성공/실패 boolean을 반환
- 상담일지 [저장]은 서버 성공 확인 후에만 닫힘
- 실패 시 로컬 임시본 유지

4. 분납관리 저장
- 분납정보 저장도 서버 성공 확인 후에만 모달 닫힘
- 직원 권한/네트워크/RLS 오류 시 입력값 유지 + 오류 표시

5. 직원 RLS 정합성 (017 SQL)
- db.view_all + 세부 수정권한 직원이 다른 담당자 DB를 실제 저장할 수 있도록 app_leads UPDATE 정책 정합화
- db.create 직원의 수기 DB 초기 담당자 배정과 INSERT 정책 충돌 수정
- 고객전환/계약생성 시 view_all 범위와 INSERT 정책 정합화
- 분납 update/insert 시 대상 case 접근권한 재검증

[적용]
1) ZIP을 프로젝트 루트에 덮어쓰기
2) Supabase SQL Editor에서 supabase/migrations/017_staff_save_reliability.sql 전체 실행
3) 마지막 SELECT 결과 5개가 모두 true인지 확인
4) npm run build 또는 npx tsc --noEmit 확인 후 커밋/배포

[검증]
- 패치 대상 4개 TS/TSX 파일 TypeScript transpile syntax 검사 통과
- 현재 GitHub main의 원본 SHA와 재구성 베이스 SHA가 정확히 일치한 상태에서 수정함
