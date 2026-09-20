# 로파워 (LawPower) — 회생/파산 사건관리 어드민

도원 Admin(`tg_m`, 불법사채 구제센터 통합 업무관리) 소스코드를 그대로 참고해 만든
**개인회생/개인파산 사건관리 어드민** 프로토타입입니다. **디자인 시스템(컬러 토큰, 컴포넌트,
레이아웃)은 도원 Admin과 동일**하게 맞추고, 기능만 회생/파산 도메인에 맞게 새로 설계했습니다.
현재는 전부 **가상의 샘플 데이터**로 동작하며, 실제 DB(Supabase 등)는 연결되어 있지 않습니다.

## v3 업데이트 — 도원 Admin과 동일한 디자인으로 전면 재작업

이전 버전은 로피(LawFee) PG사 자료의 디자인(네이비/골드 톤, 로피식 카드·배지)을 참고해
만들었지만, **디자인은 도원 Admin과 완전히 동일하게, 기능만 다르게** 가져가기로 방향이
바뀌어 아래와 같이 전면 재작업했습니다.

- 컬러 토큰(navy/brand/gold 등 커스텀 팔레트)을 모두 제거하고, 도원 Admin과 동일하게
  **Tailwind 기본 팔레트(slate/blue/emerald/amber/red)만** 사용
- `components/ui/Primitives.tsx`에 도원 Admin `components/ui.tsx`의 Card/Button/Badge/
  PageHeader/Input/Select/Modal/SearchBox/StatusTabs/Pagination을 **그대로 이식**
- 사이드바(`components/layout/Sidebar.tsx`)를 도원 Admin과 동일한 구조(고정 248px 사이드바
  + 모바일 슬라이드 드로어, lucide-react 아이콘)로 교체 — 메뉴/브랜딩만 로파워에 맞게 변경
- 상단 헤더(`components/layout/Header.tsx`)를 신규 추가 — 고객 검색, 알림벨(연체 분납 +
  기일·제출기한), 신규 DB 펄스 배지 등 도원 Admin 헤더 기능을 회파산 도메인에 맞게 재구성
- 대시보드를 도원 Admin과 동일한 구조로 재구성: 기간 선택(DateRangePicker) + KPI 카드 4종 +
  **분납 캘린더 / 기일·제출기한 캘린더 듀얼 월간 캘린더**(날짜 호버 미리보기, 클릭 고정 팝업)
- 고객관리/DB관리/사건관리/입금·분납 목록 화면을 도원 Admin과 동일하게 **모바일 카드 리스트 +
  데스크톱 테이블**의 반응형 이중 레이아웃으로 재구성 (`admin-responsive-table` 포함)
- 사건 상세 화면을 도원 Admin의 고객 상세 패널과 동일한 정보 그리드(`bg-slate-50` 카드) 스타일로 재구성

이전 v2에서 추가했던 기능(직원1/2/3 데모 표기, DB관리 페이지, 게시판형 고객관리, 서류
체크리스트, 결제수단 필드, 전역 상태 스토어)은 그대로 유지됩니다 — 이번 업데이트는 **디자인
전면 교체**이며 기능 목록은 바뀌지 않았습니다.

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
- Tailwind CSS 3.4 — 커스텀 토큰 없이 Tailwind 기본 팔레트만 사용(도원 Admin은 Tailwind 4를
  쓰지만, 기본 팔레트 값 자체는 동일해 시각적으로 같은 결과가 나오면서도 빌드 리스크가 낮은
  3.4를 유지했습니다. 정말 v4까지 맞추고 싶으시면 알려주세요.)
- `lucide-react` / `clsx` / `tailwind-merge` — 도원 Admin과 동일한 아이콘·클래스 병합 유틸
- 외부 차트 라이브러리 없음 — SVG 대신 순수 CSS(conic-gradient, flex 높이)로 도넛/막대 차트 구현
- 실제 백엔드 없음 — `lib/mock-data.ts`가 결정론적 시드(seed) 기반으로 의뢰인 64명·사건 78건·
  DB리드 34건·분납/일정 데이터를 생성합니다.

## 폴더 구조

```
app/
  page.tsx              대시보드 (기간선택 KPI + 분납/기일 듀얼 캘린더 + 기간별 통계)
  db/page.tsx             DB관리 (상담 리드 → 고객 전환)
  clients/page.tsx        고객관리 (게시판형, 인라인 수정, 모바일 카드뷰)
  cases/page.tsx           사건 목록 (검색/필터, 모바일 카드뷰)
  cases/[id]/page.tsx      사건 상세 (정보 그리드, 절차 타임라인, 입금내역, 서류 체크리스트)
  billing/page.tsx        입금·분납 관리
  schedule/page.tsx       일정(법원기일/제출기한) 관리
components/
  layout/Sidebar.tsx      고정 사이드바 + 모바일 드로어 (도원 Admin 구조 그대로)
  layout/Header.tsx       검색 + 알림벨 + 신규DB 배지 (신규)
  ui/Primitives.tsx       Card/Button/Badge/PageHeader/Input/Select/Modal/SearchBox/
                          StatusTabs/Pagination — 도원 Admin ui.tsx 이식
  ui/DateRangePicker.tsx  기간 선택 캘린더 — 도원 Admin 이식
  ui/Badge.tsx            도메인 전용 배지(사건유형/상태/DB상태/시간대칩)
  charts/MonthCalendar.tsx 월간 일정 캘린더(호버 미리보기 + 클릭 고정) — 도원 Admin 이식
  charts/                 도넛/막대/스택바 차트(색상만 slate/blue 팔레트로 조정)
lib/
  utils.ts                cn() 클래스 병합 유틸 (도원 Admin과 동일)
  types.ts                도메인 모델 (Client, CaseRecord, DbLead, Installment, ScheduleItem …)
  mock-data.ts            시드 기반 샘플 데이터 생성 + 조회 헬퍼
  documents.ts            서류 체크리스트 템플릿 (서류제출안내문 15개 항목)
  store.tsx               전역 상태(Context) — DB 전환/고객정보 수정 등 상호작용용
  period-engine.ts         년/월/주/일 기간 이동·집계 엔진
  dashboard.ts             대시보드 전용 집계 (미수금 우선순위, 담당자 실적 등)
  format.ts                금액/날짜/증감률 포맷 유틸
```

## 도원 Admin에서 그대로 가져온 것 / 로파워에 맞게 새로 설계한 것

**그대로 이식 (디자인)**
- 컬러 팔레트(slate/blue/emerald/amber/red), Card/Button/Badge 등 UI 프리미티브, 사이드바·
  헤더 레이아웃 구조, 모바일 카드/데스크톱 테이블 반응형 패턴, 월간 캘린더(호버+핀 팝업) UI

**회생/파산 도메인에 맞게 새로 설계 (기능)**
- 사건유형(개인회생/개인파산)과 9단계 절차 파이프라인(상담접수→…→종결)
- DB관리(상담 리드) → 고객 전환 흐름, 서류 체크리스트, 결제수단(단순분납/카드할부/로펌금융조합분납)
- 도원 Admin의 PG 정산·이폼사인 계약서·사채업체 조율 등 본업(불법사채) 전용 기능은 제외 —
  요청하신 대로 "회생/파산 사건 관리" 범위에만 집중

## 다음 단계 (실서비스 연동 가이드)

1. **DB 연동**: `lib/mock-data.ts`의 export들과 `lib/store.tsx`의 `setState` 호출부를
   Supabase 쿼리/뮤테이션으로 교체하세요. `lib/types.ts`의 인터페이스가 그대로 테이블 스키마
   초안으로 쓸 수 있게 필드명을 설계해뒀습니다.
2. **기존 도원 Admin과의 통합**: 디자인 시스템이 이제 동일하므로, 이 프로젝트를 도원 Admin
   저장소의 라우트 그룹(예: `app/(lawpower)/...`)으로 옮기면 `components/ui/Primitives.tsx`를
   도원 Admin의 `components/ui.tsx`로 그대로 바꿔치기할 수 있습니다 — 두 프로젝트가 같은
   컴포넌트 계약을 쓰기 때문에 병합 리스크가 낮습니다.
3. **인증/권한**: 현재 로그인·권한 분리가 없습니다(도원 Admin은 Supabase Auth 사용). 실사용
   전 담당자별 접근 제어가 필요합니다.
4. **민형사/사채 확장**: 이후 민형사·불법사채구제 사건까지 확장할 경우 `CaseType`에 유형을
   추가하고 유형별 절차 단계(`STAGE_LABELS`)만 새로 정의하면 대시보드/목록/상세 화면 구조는
   대부분 재사용 가능하도록 설계했습니다.

## 참고용 정적 미리보기

npm 없이 디자인만 빠르게 보고 싶다면 별도로 전달된 `dashboard-preview.html`
(빌드 불필요, 브라우저로 바로 열람 가능)을 확인해주세요. 실제 데이터 연동 로직은
포함되어 있지 않은 순수 시각적 목업입니다.
