LawPower 회생 ADMIN v28.28 — 상담일지에서 고객 이름 수정

1) DB관리 → 고객 → 상담일지 → 기본정보 > 이름 수정 → 저장
2) 저장 성공 시 app_leads.data.name을 함께 저장하여 DB관리/검색에 즉시 반영
3) db.edit_basic 및 db.edit_consultation 권한이 있는 사용자만 수정 가능
4) 고객전환 완료 DB는 계약관리 고객명과의 불일치를 막기 위해 이름 수정 잠금 유지
5) 기존 상담일지 자동 임시저장·복구·저장 실패 보호에 이름도 포함
6) 연락처, 상담기록, 계약/분납, DB ID 및 기타 데이터 변경 없음
7) SQL 불필요, 소스 교체 후 배포 필요

수정 파일
- components/ui/consultation/ConsultationModal.tsx
- components/ui/consultation/BasicInfoSection.tsx
- app/db/page.tsx

빌드 검증: 별도 확인
