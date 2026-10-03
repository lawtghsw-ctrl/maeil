# v28.6.1 바로 덮어쓰기 파일

이번 ZIP은 실행 스크립트가 아니라 실제 수정 파일입니다.

## 덮어쓸 파일
프로젝트 루트 기준 그대로 덮어쓰기:
- `components/cases/CaseActionModals.tsx`
- `app/cases/[id]/page.tsx`

## Supabase
DB관리 피벗 복구를 위해:
- `supabase/V28_6_1_PIVOT_FIX.sql`

을 Supabase SQL Editor에서 1회 실행합니다.

### 반영 내용
- 계약 상세 우측 상단 `최우선변제 안내표` 버튼 제거
- 분납 현황 바로 아래 안내표 상시 노출
- 기존 Raw2 데이터의 상담시간/채무/소득 피벗값 복구
- 앞으로 들어오는 app_leads도 DB trigger에서 자동 정규화

SQL은 기존 DB 삭제 없이 피벗용 JSON 필드만 채웁니다.
