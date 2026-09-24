# Supabase 빠른 설정

1. 새 Supabase 프로젝트 생성
2. SQL Editor에서 `migrations/001_initial.sql` 전체 실행
3. Authentication > Users에서 최종관리자 이메일/비밀번호 계정 1개 생성
4. Project Settings/API에서 URL + Publishable key 확인
5. 프로젝트 루트에 `.env.local` 생성
6. `npm install && npm run build && npm run dev`

첫 번째 Auth 계정은 SQL trigger에 의해 `최종관리자 / admin / 활성`으로 자동 등록됩니다.
직원계정 기능 구현 전에는 추가 사용자를 활성화하지 않는 것을 권장합니다.
