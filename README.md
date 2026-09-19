# 로파워 (LawPower) — 회생/파산 사건관리 어드민

로피(LawFee) 고객사 대시보드 · 운영사 어드민의 디자인 시스템(컬러 토큰, 기간 엔진,
카드/배지 스타일)을 참고해 제작한 **개인회생/개인파산 사건관리 어드민** 프로토타입입니다.
현재는 전부 **가상의 샘플 데이터**로 동작하며, 실제 DB(Supabase 등)는 연결되어 있지 않습니다.

## 중요 — 로컬에서 처음 실행하기 전에

이 코드는 npm 레지스트리 접근이 차단된 클라우드 샌드박스에서 **`npm install`/빌드를 한 번도
실행하지 못한 상태로** 작성되었습니다. TypeScript 컴파일러(strict 모드)로 문법·타입 오류는
자체 검증했지만, 실제 Next.js 빌드 파이프라인으로는 검증되지 않았으니 로컬에서 아래 순서로
실행하면서 혹시 나오는 사소한 오류(패키지 버전 궁합 등)는 확인해주세요.

```bash
npm install
npm run dev
# http://localhost:3000
```

Node.js 18.18 이상을 권장합니다.

## 기술 스택

- Next.js 14.2 (App Router) + React 18 + TypeScript (strict)
- Tailwind CSS 3.4 — 로피 스펙의 컬러 토큰을 `tailwind.config.ts` / `app/globals.css`에 이식
- 외부 차트 라이브러리 없음 — SVG 대신 순수 CSS(conic-gradient, flex 높이)로 도넛/막대 차트 구현
  (SVG 곡선·경로 연산은 빌드 검증 없이 작성 시 오류 위험이 커서 의도적으로 배제했습니다)
- 실제 백엔드 없음 — `lib/mock-data.ts`가 결정론적 시드(seed) 기반으로 의뢰인 64명·사건 78건·
  분납/일정 데이터를 생성합니다.

## 폴더 구조

```
app/
  page.tsx              대시보드 홈
  cases/page.tsx         사건 목록 (검색/필터)
  cases/[id]/page.tsx     사건 상세 (절차 타임라인, 입금내역, 일정)
  clients/page.tsx        고객(의뢰인) 목록
  billing/page.tsx        청구·결제(분납) 관리
  schedule/page.tsx       일정(법원기일/제출기한) 관리
components/
  layout/Sidebar.tsx      사이드바 + 모바일 하단 탭
  ui/                     KPI카드, 배지, 기간엔진 컨트롤
  charts/                 도넛/막대/스택바 차트
lib/
  types.ts                도메인 모델 (Client, CaseRecord, Installment, ScheduleItem …)
  mock-data.ts            시드 기반 샘플 데이터 생성 + 조회 헬퍼
  period-engine.ts         년/월/주/일 기간 이동·집계 엔진 (로피 스펙 4번 시트 이식)
  dashboard.ts             대시보드 전용 집계 (미수금 우선순위, 담당자 실적 등)
  format.ts                금액/날짜/증감률 포맷 유틸
```

## 로피 디자인 시스템에서 가져온 것 / 다르게 만든 것

**그대로 이식**
- 컬러 토큰(`--navy`, `--blue #2944AF`, `--gold`, `--green`, `--red` 등), 라운딩/섀도 값
- 기간 엔진 로직(`periodBounds`, `sumRange`, `computeStats`, `isNextBlocked`) — 로피
  "4.기간엔진 로직·코드" 시트의 JS를 TypeScript로 그대로 포팅
- 헤드라인 문장 패턴("{기간}, {지표}을 기록하고 있어요/했어요"), KPI 카드 4종 + 전기간 대비
  증감 배지, 미수금 추심 우선순위(D+연체일 정렬), 청구·결제 스냅샷(실시간/기간독립) 구조

**회생/파산 도메인에 맞게 새로 설계**
- 사건유형(개인회생/개인파산)과 9단계 절차 파이프라인(상담접수→…→종결)
- 사건 상세의 절차 타임라인 UI, 법원/담당자/총채무액/월변제금 등 도메인 필드
- 로피의 PG 정산(로펌별 지급, Toss 잔액 제로화 등)은 이번 범위에서 제외 — 요청하신 대로
  "회생/파산 사건 관리" 범위에만 집중

## 다음 단계 (실서비스 연동 가이드)

1. **DB 연동**: `lib/mock-data.ts`의 `clients`/`cases`/`installments`/`scheduleItems`
   export와 `getXxxById` 계열 함수들을 Supabase 쿼리로 교체하세요. `lib/types.ts`의 인터페이스가
   그대로 테이블 스키마 초안으로 쓸 수 있게 필드명을 설계해뒀습니다.
2. **기존 도원 사채 Admin과의 통합**: 이 프로젝트는 독립 프로젝트로 만들어졌습니다. 기존
   Next.js 프로젝트(GitHub `lawtghsw-ctrl/tg_m`)에 흡수시키려면 `app/`, `components/`,
   `lib/`를 해당 저장소의 라우트 그룹(예: `app/(lawpower)/...`)으로 옮기고, 두 프로젝트의
   Tailwind 토큰/전역 CSS를 하나로 합치면 됩니다.
3. **인증/권한**: 현재 로그인·권한 분리가 없습니다. 실사용 전 담당자별 접근 제어가 필요합니다.
4. **AI 브리핑**: 대시보드의 "AI 브리핑" 카드는 로피 스펙처럼 실제 LLM 연동 전 자리표시자입니다.
5. **민형사/사채 확장**: 말씀하신 대로 이후 민형사·불법사채구제 사건까지 확장할 경우
   `CaseType`에 유형을 추가하고 유형별 절차 단계(`STAGE_LABELS`)만 새로 정의하면
   대시보드/목록/상세 화면 구조는 대부분 재사용 가능하도록 설계했습니다.

## 참고용 정적 미리보기

npm 없이 디자인만 빠르게 보고 싶다면 별도로 전달된 `dashboard-preview.html`
(빌드 불필요, 브라우저로 바로 열람 가능)을 확인해주세요. 실제 데이터 연동 로직은
포함되어 있지 않은 순수 시각적 목업입니다.
