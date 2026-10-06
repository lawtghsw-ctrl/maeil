LawPower v28.12 관리자 대시보드 / 정산 / 데이터집계 보강

[기준 버전]
- maeil-v28.11-manager-dashboard-settlement-analytics-overwrite.zip
- v28.11에 그대로 덮어쓰는 호환 업데이트
- DB 스키마 신규 변경 없음

[이번 v28.12 추가 변경]
1. 대시보드
- 월 계약 목표 페이스 추가
  · 오늘까지 목표 건수
  · 현재 계약 건수
  · 월말 예상 계약 건수
  · 목표 달성률
  · 남은 기간 하루 필요 계약 건수
- 오늘의 투두를 실무 단계 기준으로 세분화
  · 예약콜
  · 착수금 안내
  · 부재콜
  · 장기부재 점검
  · 상담 중
  · 설득 필요
- 기존 계약 1건당 순이익 / 회수매출 / 회수율 / 광고비 / 인건비 / 미수금 / 현금영업이익 유지

2. 데이터집계
- 요약 탭에 월 목표 페이스 추가
- DB 표본이 30건 미만이면 전환율·직원 비교 '표본 주의' 표시
- 팀·인원 표에 '상담완료→계약' 전환율 추가
- 광고·소재 탭의 CPA는 계약 10건 미만일 때 '판단 보류' 표시
- 기존 6개 탭 구조 유지
  · 요약 / 팀·인원 / 상담 운영 / 광고·소재 / 수임·매출 / 사건·수납

3. 정산
- 상단 비용을 묶어서 보여주지 않고 분리 표시
  · 실수령 매출
  · DB/광고비
  · 인건비
  · 고정 운영비
  · 현금 영업이익
- 현금 손익 브리지에 '현금 기준 계약 1건당 이익' 추가
- 기존 담당자별 보상·기여이익 및 입금 원장 유지

[덮어쓰기 파일]
- app/page.tsx
- app/analytics/page.tsx
- app/settlements/page.tsx
- app/settlement-settings/page.tsx
- components/layout/Sidebar.tsx
- lib/management-analytics.ts
- lib/permissions.ts
- supabase/migrations/008_management_analytics.sql

[적용 방법]
1) 이 ZIP을 maeil 프로젝트 루트에 압축 해제
2) 동일 파일 덮어쓰기
3) 기존 v28.11에서 008_management_analytics.sql을 이미 실행했다면 SQL 재실행 필요 없음
4) 아직 v28.11 SQL을 실행하지 않았다면 supabase/migrations/008_management_analytics.sql 1회 실행
5) npm run build
6) 빌드 성공 후 Vercel 배포

[주의]
- 기존 고객 / DB / 계약 / 분납 / 메타 연동 데이터는 삭제하거나 초기화하지 않습니다.
- 이번 v28.12는 신규 DB 컬럼을 추가하지 않습니다.
- 해지/환불 금액 전용 필드는 아직 없으므로 환불액을 영업이익에서 임의 계산하지 않습니다.
- 월 목표 페이스는 기본 월 전체 기간 필터에서 표시됩니다.

[검사]
- 포함된 TS/TSX 파일 TypeScript 구문 검사 통과
