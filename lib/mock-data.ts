// 목업(샘플) 데이터 생성기 — 실제 고객 데이터가 아닌, 화면 설계 검증용 가상 데이터입니다.
// 실서비스 전환 시 이 파일의 export만 Supabase 조회 함수로 교체하면 되도록
// (types.ts에 정의된) 도메인 모델 형태 그대로 데이터를 만들어 둡니다.
//
// 결정론적 생성을 위해 seeded PRNG(mulberry32)를 사용 — 브라우저에서 새로고침해도
// 매번 같은 샘플 데이터가 나오도록 함 (서버/클라이언트 렌더 불일치 방지 목적도 겸함).

import {
  CASE_STAGES,
  DB_LEAD_STATUSES,
  STAFF_LIST,
  type BoardPost,
  type CaseRecord,
  type CaseStage,
  type CaseStatus,
  type CaseType,
  type Client,
  type ConsultationInfo,
  type DayAggregate,
  type DbLead,
  type DbLeadStatus,
  type Installment,
  type InstallmentStatus,
  type PaymentMethod,
  type ScheduleItem,
} from "./types";
import { emptyAssetRows, emptyDebtRows, emptyPlanInput, MIN_LIVING_COST_1P } from "./consultation";

function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260919);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"];
const GIVEN = [
  "민준", "서연", "도윤", "지우", "하준", "서준", "예은", "지훈", "수빈", "은서",
  "현우", "채원", "민서", "우진", "다은", "성민", "소율", "재현", "유진", "건우",
  "가은", "태윤", "나윤", "준혁", "서윤", "동현", "지민", "혜원", "승우", "아름",
];

function randomName(): string {
  return pick(SURNAMES) + pick(GIVEN);
}

function randomPhone(): string {
  return `010-${randInt(1000, 9999)}-${randInt(1000, 9999)}`;
}

const COURTS = [
  "서울회생법원",
  "서울중앙지방법원",
  "인천지방법원",
  "수원지방법원",
  "대전지방법원",
  "부산지방법원",
  "대구지방법원",
  "광주지방법원",
];

// 데모 버전에서는 실명 대신 직원1/직원2/직원3으로 표기
const STAFF = STAFF_LIST;

const PAYMENT_METHODS: PaymentMethod[] = ["단순분납", "로피분납", "신카할부완납", "캐피탈분납"];

function randomPaymentMethod(): PaymentMethod {
  const r = rand();
  if (r < 0.4) return "단순분납";
  if (r < 0.75) return "로피분납";
  if (r < 0.92) return "신카할부완납";
  return "캐피탈분납";
}

const today = new Date();
const todayIso = () =>
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function daysAgo(n: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
}

// 파이프라인 상 각 단계의 가중치 — 앞/중간 단계에 사건이 많이 몰려 있는 실무 분포를 흉내냄
const STAGE_WEIGHTS: Array<{ stage: CaseStage; weight: number }> = [
  { stage: "상담접수", weight: 6 },
  { stage: "서류준비", weight: 11 },
  { stage: "신청서작성", weight: 10 },
  { stage: "법원접수", weight: 15 },
  { stage: "보정대기", weight: 7 },
  { stage: "개시_선고", weight: 15 },
  { stage: "변제계획_면책심문", weight: 15 },
  { stage: "면책결정", weight: 11 },
  { stage: "종결", weight: 10 },
];

function weightedStage(): CaseStage {
  const total = STAGE_WEIGHTS.reduce((a, s) => a + s.weight, 0);
  let r = rand() * total;
  for (const s of STAGE_WEIGHTS) {
    if (r < s.weight) return s.stage;
    r -= s.weight;
  }
  return STAGE_WEIGHTS[STAGE_WEIGHTS.length - 1].stage;
}

const CLIENT_COUNT = 64;
const CASE_COUNT = 78;

export const clients: Client[] = Array.from({ length: CLIENT_COUNT }, (_, i) => {
  const registeredDaysAgo = randInt(0, 150);
  return {
    id: `CL-${String(i + 1).padStart(4, "0")}`,
    name: randomName(),
    phone: randomPhone(),
    registeredAt: isoOf(daysAgo(registeredDaysAgo)),
    assignedStaff: pick(STAFF),
    memo: undefined,
  };
});

function randomCaseType(): CaseType {
  return chance(0.62) ? "개인회생" : "개인파산";
}

function contractAmountFor(caseType: CaseType): number {
  // 표시용 샘플 금액 — 실제 수임료 기준이 아닌 화면 설계 검증용 임의값
  return caseType === "개인회생"
    ? randInt(35, 60) * 10000 * 10 // 350만~600만
    : randInt(15, 30) * 10000 * 10; // 150만~300만
}

function totalDebtFor(caseType: CaseType): number {
  return caseType === "개인회생"
    ? randInt(3000, 15000) * 10000 // 3천만~1.5억
    : randInt(2000, 8000) * 10000; // 2천만~8천만
}

export const cases: CaseRecord[] = Array.from({ length: CASE_COUNT }, (_, i) => {
  const client = clients[i % clients.length];
  const caseType = randomCaseType();
  const contractDaysAgo = randInt(0, 130);
  const contractDate = daysAgo(contractDaysAgo);
  const stage = weightedStage();
  const stageIdx = CASE_STAGES.indexOf(stage);
  const amount = contractAmountFor(caseType);

  let status: CaseStatus = "진행중";
  if (stage === "종결") status = "종결";
  else if (chance(0.04)) status = "취하";
  else if (chance(0.05)) status = "보류";

  const filingDate =
    stageIdx >= CASE_STAGES.indexOf("법원접수")
      ? isoOf(daysAgo(Math.max(0, contractDaysAgo - randInt(7, 30))))
      : undefined;

  const nextHearingDate =
    status === "진행중" && stageIdx >= CASE_STAGES.indexOf("법원접수") && stageIdx < CASE_STAGES.indexOf("종결")
      ? isoOf(daysFromNow(randInt(-5, 45)))
      : undefined;

  // 진행 단계가 뒤일수록(=계약이 오래됐을수록) 기납부율이 높아지도록 근사
  const progressRatio = Math.min(1, (stageIdx + 1) / CASE_STAGES.length);
  const paidRatio = status === "종결" ? 1 : Math.min(1, progressRatio * (0.55 + rand() * 0.5));
  const paidAmount = Math.round((amount * paidRatio) / 10000) * 10000;

  return {
    id: `CASE-${String(i + 1).padStart(4, "0")}`,
    caseNumber:
      filingDate && chance(0.85)
        ? `${today.getFullYear() - (chance(0.3) ? 1 : 0)}개${caseType === "개인회생" ? "회" : "파"}${randInt(
            1000,
            9999
          )}`
        : `내부-${String(i + 1).padStart(4, "0")}`,
    clientId: client.id,
    caseType,
    court: pick(COURTS),
    stage,
    stageUpdatedAt: isoOf(daysAgo(randInt(0, Math.min(30, contractDaysAgo + 1)))),
    status,
    assignedStaff: pick(STAFF),
    filingDate,
    nextHearingDate,
    totalDebt: totalDebtFor(caseType),
    monthlyRepayment:
      caseType === "개인회생" && stageIdx >= CASE_STAGES.indexOf("변제계획_면책심문")
        ? randInt(20, 80) * 10000
        : undefined,
    contractAmount: amount,
    contractDate: isoOf(contractDate),
    paidAmount,
    paymentMethod: randomPaymentMethod(),
    docsSentAt:
      filingDate && chance(0.8) ? isoOf(daysAgo(Math.max(0, contractDaysAgo - randInt(3, 10)))) : undefined,
    memo: undefined,
  };
});

// 신청분류(개인회생/개인파산) — 연결된 계약이 있으면 그 사건유형을 그대로 따르고,
// 아직 계약이 없는 고객(DB관리에서 막 전환된 경우 등)은 임의로 배정합니다.
for (const c of clients) {
  const relatedCase = cases.find((cc) => cc.clientId === c.id);
  c.applicationType = relatedCase ? relatedCase.caseType : chance(0.62) ? "개인회생" : "개인파산";
}

// 상담일지 데모 샘플 — 고객이 전달한 상담일지 서식이 실제로 어떻게 채워지는지 보여주기
// 위한 예시 1건. 나머지 고객은 상담일지가 비어있는 상태(고객관리 수정 팝업에서 처음
// 작성하는 흐름)를 그대로 보여줍니다.
const SAMPLE_CONSULTATION: ConsultationInfo = {
  personal: {
    birthDate: "1985-04-12",
    gender: "남",
    address: "서울특별시 관악구 신림로 123",
    jurisdictionCourt: "서울회생법원",
    occupationType: "직장인",
    spouse: true,
    childrenCount: 1,
    childrenAges: "7세",
    otherDependents: "",
    seriousIllness: false,
    dependentNote: "배우자 소득 없음",
  },
  income: {
    incomeType: "근로소득",
    workplaceName: "㈜한빛물류",
    tenureInfo: "재직 4년차",
    monthlyAvgIncome: 2800000,
    secondaryIncome: 0,
    pensionIncome: 0,
    note: "급여명세서 3개월분 수령 예정",
  },
  assets: emptyAssetRows().map((a) =>
    a.category === "예금/적금" ? { ...a, value: 1200000 } : a.category === "자동차" ? { ...a, value: 3000000 } : a
  ),
  debts: emptyDebtRows().map((d) =>
    d.category === "신용채무(카드/캐피탈/저축은행 등)" ? { ...d, creditor: "OO카드 외 3곳", amount: 42000000 } : d
  ),
  plan: { ...emptyPlanInput(), householdSize: 1, minLivingCost: MIN_LIVING_COST_1P, otherDeduction: 0, repaymentMonths: 36 },
  memo: "최초 상담 — 개인회생 진행 희망, 서류 준비 안내 완료.",
};
if (clients[0]) clients[0].consultation = SAMPLE_CONSULTATION;

// 계약금액을 계약금(30~50%) + 분납 2~5회로 나눠 입금 스케줄 생성
export const installments: Installment[] = cases.flatMap((c) => {
  const upfrontRatio = 0.3 + rand() * 0.2;
  const upfront = Math.round((c.contractAmount * upfrontRatio) / 10000) * 10000;
  const remaining = c.contractAmount - upfront;
  const installCount = randInt(2, 5);
  const perInstall = Math.round(remaining / installCount / 10000) * 10000;

  const contractD = new Date(c.contractDate + "T00:00:00");
  const rows: Installment[] = [];

  // 1회차: 계약금 (계약일 당일)
  const seq1PaidChance = 0.97;
  rows.push({
    id: `${c.id}-INS-1`,
    caseId: c.id,
    seq: 1,
    dueDate: isoOf(contractD),
    amount: upfront,
    status: chance(seq1PaidChance) ? "완료" : "연체",
    paidDate: chance(seq1PaidChance) ? isoOf(contractD) : undefined,
  });

  let allocated = upfront;
  for (let k = 0; k < installCount; k++) {
    const due = new Date(contractD);
    due.setMonth(due.getMonth() + k + 1);
    const isLast = k === installCount - 1;
    // 마지막 회차는 반올림 잔액을 흡수해 합계가 contractAmount와 최대한 일치하도록 함
    const amount = isLast ? Math.max(10000, c.contractAmount - allocated) : Math.max(10000, perInstall);
    allocated += amount;

    let status: InstallmentStatus;
    let paidDate: string | undefined;
    if (due < today) {
      // 과거 도래한 분납 — 대부분 완료, 일부 연체/실패
      const r = rand();
      if (r < 0.82) {
        status = "완료";
        const paid = new Date(due.getTime() + randInt(-2, 3) * 86400000);
        paidDate = paid > today ? todayIso() : isoOf(paid);
      } else if (r < 0.93) {
        status = "연체";
      } else {
        status = "실패";
      }
    } else {
      status = "예정";
    }

    rows.push({
      id: `${c.id}-INS-${k + 2}`,
      caseId: c.id,
      seq: k + 2,
      dueDate: isoOf(due),
      amount,
      status,
      paidDate,
    });
  }

  return rows;
});

// 법원기일 / 서류제출기한 등 일정
export const scheduleItems: ScheduleItem[] = cases
  .filter((c) => c.nextHearingDate)
  .map((c, i) => ({
    id: `SCH-${String(i + 1).padStart(4, "0")}`,
    caseId: c.id,
    clientId: c.clientId,
    type: chance(0.6) ? "법원기일" : "서류제출기한",
    date: c.nextHearingDate as string,
    title:
      c.stage === "법원접수"
        ? "심문기일"
        : c.stage === "보정대기"
        ? "보정서 제출기한"
        : c.stage === "개시_선고"
        ? "채권자집회"
        : "정기 서류 제출",
    done: false,
  }));

// ---- DB(상담 리드) 관리 ----
// 회파산 업무매뉴얼 5장(상담 파이프라인) 기준 목업 데이터. 모든 리드는 메타광고 단일
// 채널로만 유입되는 것으로 가정해 별도의 유입경로 구분은 두지 않습니다.

const LEAD_STATUS_WEIGHT: Record<DbLeadStatus, number> = {
  신규접수: 20,
  상담예정: 12,
  상담완료: 10,
  재통화필요: 10,
  고려중: 8,
  서류검토중: 6,
  계약진행중: 6,
  수임전환: 8,
  부재중: 12,
  거절: 5,
  부적합: 2,
  종결_중단: 1,
};

function weightedLeadStatus(): DbLeadStatus {
  const total = DB_LEAD_STATUSES.reduce((a, s) => a + LEAD_STATUS_WEIGHT[s], 0);
  let r = rand() * total;
  for (const s of DB_LEAD_STATUSES) {
    if (r < LEAD_STATUS_WEIGHT[s]) return s;
    r -= LEAD_STATUS_WEIGHT[s];
  }
  return "신규접수";
}

const LEAD_MEMO_SAMPLES = [
  "담보대출 연체 여부 확인 필요 — 개인회생/워크아웃 판단 대기",
  "사업소득 있음, 매출·매입 장부 요청 예정",
  "월세 거주, 임대차계약서 추가 수령 필요",
  "재통화 요청 — 저녁 8시 이후 연락 가능",
  "배우자 명의 자동차 있음, 자동차등록원부 안내함",
  "탕감 예상액 문의 — 서류 검토 후 재안내 예정",
];

const LEAD_COUNT = 34;

// 콜(통화 시도) 횟수 — 진행 단계가 깊을수록/부재중일수록 콜 시도가 누적됐다고 가정한
// 데모용 근사치입니다. DB관리 리스트에서 ▲▼ 버튼으로 담당자가 직접 조정할 수 있습니다.
function randomCallCount(status: DbLeadStatus): number {
  if (status === "신규접수") return randInt(0, 1);
  if (status === "부재중") return randInt(2, 6);
  if (status === "수임전환" || status === "계약진행중" || status === "서류검토중") return randInt(3, 8);
  return randInt(1, 4);
}

export const leads: DbLead[] = Array.from({ length: LEAD_COUNT }, (_, i) => {
  const status = weightedLeadStatus();
  const receivedDaysAgo = randInt(0, 12);

  let convertedClientId: string | undefined;
  let convertedCaseId: string | undefined;
  if (status === "수임전환") {
    const client = clients[i % clients.length];
    convertedClientId = client.id;
    convertedCaseId = cases.find((c) => c.clientId === client.id)?.id;
  }

  return {
    id: `LEAD-${String(i + 1).padStart(4, "0")}`,
    name: randomName(),
    phone: randomPhone(),
    applicationType: chance(0.8) ? randomCaseType() : undefined,
    receivedAt: isoOf(daysAgo(receivedDaysAgo)),
    status,
    assignedStaff: pick(STAFF),
    memo: chance(0.5) ? pick(LEAD_MEMO_SAMPLES) : undefined,
    callCount: randomCallCount(status),
    convertedClientId,
    convertedCaseId,
  };
}).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));

// ---- 기간 엔진용 일 단위 집계(dayMap) 생성 ----
// 계약(청구 개념) = cases.contractDate 기준 / 결제(입금) = installments 완료건의 paidDate 기준
// newConsultCount는 실제 상담 레코드 없이, 계약 건수 대비 유입 배수로 근사 산출(데모 목적)
const DAY_RANGE = 150;

function emptyDay(dateIso: string): DayAggregate {
  return {
    date: dateIso,
    newConsultCount: 0,
    newContractCount: 0,
    contractAmount: 0,
    paymentAmount: 0,
    caseTypeSplit: { 개인회생: 0, 개인파산: 0 },
  };
}

// cases/installments를 받아 dayMap을 새로 계산 — store의 실시간 데이터(DB관리에서 전환된
// 신규 사건 포함)로도 재사용할 수 있도록 순수 함수로 분리함.
export function buildDayMap(
  casesArr: CaseRecord[],
  installmentsArr: Installment[]
): Map<string, DayAggregate> {
  const map: Map<string, DayAggregate> = new Map();
  for (let i = 0; i <= DAY_RANGE; i++) {
    const iso = isoOf(daysAgo(DAY_RANGE - i));
    map.set(iso, emptyDay(iso));
  }
  // 미래 일정 일부(예정 분납일)도 맵에 포함되도록 여유분 생성
  for (let i = 1; i <= 60; i++) {
    const iso = isoOf(daysFromNow(i));
    if (!map.has(iso)) map.set(iso, emptyDay(iso));
  }

  for (const c of casesArr) {
    let day = map.get(c.contractDate);
    if (!day) {
      // seed 범위 밖(오늘 이후 등) 계약도 놓치지 않도록 동적으로 추가
      day = emptyDay(c.contractDate);
      map.set(c.contractDate, day);
    }
    day.newContractCount += 1;
    day.contractAmount += c.contractAmount;
    day.newConsultCount += randInt(2, 4); // 계약 1건당 상담 유입 근사치
  }

  for (const ins of installmentsArr) {
    if (ins.status === "완료" && ins.paidDate) {
      let day = map.get(ins.paidDate);
      const c = casesArr.find((cc) => cc.id === ins.caseId);
      if (!day && c) {
        day = emptyDay(ins.paidDate);
        map.set(ins.paidDate, day);
      }
      if (day && c) {
        day.paymentAmount += ins.amount;
        day.caseTypeSplit[c.caseType] += ins.amount;
      }
    }
  }

  // caseTypeSplit을 절대금액 → 비율로 정규화
  for (const day of map.values()) {
    const total = day.caseTypeSplit["개인회생"] + day.caseTypeSplit["개인파산"];
    if (total > 0) {
      day.caseTypeSplit["개인회생"] = day.caseTypeSplit["개인회생"] / total;
      day.caseTypeSplit["개인파산"] = day.caseTypeSplit["개인파산"] / total;
    }
  }
  return map;
}

export const dayMap: Map<string, DayAggregate> = buildDayMap(cases, installments);

// ---- 조회 헬퍼 (추후 Supabase 쿼리로 교체될 지점) ----

export function getClientById(id: string): Client | undefined {
  return clients.find((c) => c.id === id);
}

export function getCaseById(id: string): CaseRecord | undefined {
  return cases.find((c) => c.id === id);
}

export function getCasesByClient(clientId: string): CaseRecord[] {
  return cases.filter((c) => c.clientId === clientId);
}

export function getInstallmentsByCase(caseId: string): Installment[] {
  return installments
    .filter((i) => i.caseId === caseId)
    .sort((a, b) => a.seq - b.seq);
}

export function getScheduleByCase(caseId: string): ScheduleItem[] {
  return scheduleItems.filter((s) => s.caseId === caseId);
}

export function receivableOf(c: CaseRecord): number {
  return Math.max(0, c.contractAmount - c.paidAmount);
}

export function getLeadById(id: string): DbLead | undefined {
  return leads.find((l) => l.id === id);
}

export function overdueDaysOf(ins: Installment, refDate: Date = today): number {
  if (ins.status !== "연체" && ins.status !== "실패") return 0;
  const due = new Date(ins.dueDate + "T00:00:00");
  const t0 = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  return Math.max(0, Math.round((t0.getTime() - due.getTime()) / 86400000));
}

export const TODAY_ISO = todayIso();

// ---- 내부 게시판 (도원 Admin '내부 게시판'과 동일 기능) ----
const BOARD_SEED: Array<Omit<BoardPost, "id" | "attachments" | "date">> = [
  {
    title: "서류제출안내문 최신본 안내",
    body: "매일법률사무소 서류제출안내문 양식이 갱신되었습니다. 사건 상세 화면의 서류 체크리스트에 그대로 반영되어 있으니, 신규 계약 건은 최신본 기준으로 안내 부탁드립니다.",
    writer: "직원1",
    isNotice: true,
    noticeOrder: 1,
  },
  {
    title: "이번 주 법원기일 공유",
    body: "이번 주 개인회생 심문기일 2건, 개인파산 채권자집회 1건이 예정되어 있습니다. 대시보드의 기일·제출기한 캘린더에서 날짜를 다시 확인해주세요.",
    writer: "직원2",
    isNotice: true,
    noticeOrder: 2,
  },
  {
    title: "신규 DB 응대 시 유의사항",
    body: "DB관리에서 신규 접수 건은 당일 중 상태를 업데이트해주세요. 상담 후 진행 의사가 없는 경우 '거절' 또는 '부적합'으로 정리하면 대시보드 집계에서 자동 제외됩니다.",
    writer: "직원1",
    isNotice: false,
    noticeOrder: 1,
  },
  {
    title: "분납 연체 고객 응대 가이드",
    body: "입금·분납 관리에서 연체·실패 건은 대시보드 상단 배너에 실시간으로 집계됩니다. 고객관리에서 해당 고객을 선택해 분납관리 화면으로 바로 이동할 수 있습니다.",
    writer: "직원3",
    isNotice: false,
    noticeOrder: 1,
  },
];

export const posts: BoardPost[] = BOARD_SEED.map((p, i) => ({
  id: `POST-${String(i + 1).padStart(4, "0")}`,
  attachments: [],
  date: isoOf(daysAgo(i * 3)),
  ...p,
}));
