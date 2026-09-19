export type CaseType = "미정" | "개인회생" | "개인파산" | "워크아웃/기타" | "외부이관";
export type PipelineStatus =
  | "신규접수" | "상담예정" | "상담완료" | "재통화필요" | "고려중" | "검토중" | "서류검토중"
  | "대면예약완료" | "방문예정" | "진행예정" | "계약진행중" | "수임" | "진행중"
  | "부재중" | "거절" | "부적합" | "종결(성공)" | "종결(중단)" | "외부이관";
export type PaymentMethod = "계좌이체" | "체크카드" | "신용카드" | "단순분납" | "금융분납";
export type PaymentStatus = "예정" | "완료" | "연체" | "취소";
export type DocStatus = "미수령" | "요청" | "수령" | "보완필요" | "해당없음";
export type ESignStatus = "미발송" | "서명대기" | "서명완료" | "취소";
export type ActionType = "상담" | "재통화" | "대면/방문" | "계약회신" | "서류요청" | "입금확인" | "사건기한" | "기타";
export type AssetType = "주택/토지" | "임차보증금" | "예금/적금" | "보험(해약환급금)" | "자동차" | "퇴직금" | "주식/펀드" | "사업재고/기타";
export type DebtType = "세금체납" | "건강보험체납" | "담보채무-부동산" | "담보채무-자동차" | "신용채무" | "개인채무" | "기타";

export type Lead = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  source: string;
  timeBand: string;
  status: PipelineStatus;
  attempts: number;
  assignedTo: string;
  caseType: CaseType;
  memo: string;
  consultationDate?: string;
  nextActionAt?: string;
  lastContactAt?: string;
  convertedMatterId?: string;
};

export type Client = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  birthDate: string;
  gender: string;
  address: string;
  court: string;
  spouse: string;
  children: string;
  otherDependents: string;
  healthIssue: string;
  memo: string;
};

export type Matter = {
  id: string;
  clientId: string;
  createdAt: string;
  caseType: CaseType;
  status: PipelineStatus;
  assignedTo: string;
  consultationDate?: string;
  nextActionAt?: string;
  nextActionType?: ActionType;
  leadId?: string;
  source: string;

  jobType: string;
  companyName: string;
  employmentInfo: string;
  monthlyIncome: number;
  secondaryIncome: number;
  pensionIncome: number;
  spouseIncome: number;
  householdSize: number;
  otherDeduction: number;
  repaymentMonths: number;

  securedLoanArrears: boolean;
  specialIssue: string;
  memo: string;
};

export type Asset = {
  id: string;
  matterId: string;
  type: AssetType;
  name: string;
  value: number;
  securedAmount: number;
  note: string;
};

export type Debt = {
  id: string;
  matterId: string;
  type: DebtType;
  creditor: string;
  amount: number;
  securedAmount: number;
  note: string;
};

export type Contract = {
  id: string;
  matterId: string;
  contractDate: string;
  contractAmount: number;
  paymentMethod: PaymentMethod;
  upfrontAmount: number;
  installmentCount: number;
  eSignStatus: ESignStatus;
  financeNoticeDone: boolean;
  memo: string;
};

export type Payment = {
  id: string;
  matterId: string;
  contractId: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  paidDate?: string;
  status: PaymentStatus;
  method: PaymentMethod;
  memo: string;
};

export type DocumentItem = {
  id: string;
  matterId: string;
  no: number;
  title: string;
  source: string;
  condition: string;
  status: DocStatus;
  requestedAt?: string;
  receivedAt?: string;
  note: string;
};

export type CaseProgress = {
  id: string;
  matterId: string;
  currentStage: string;
  court: string;
  caseNumber: string;
  filedAt?: string;
  nextDueAt?: string;
  memo: string;
  updatedAt: string;
};

export type ConsultationNote = {
  id: string;
  matterId: string;
  createdAt: string;
  author: string;
  type: "통화" | "문자" | "방문" | "검토" | "계약" | "서류" | "기타";
  body: string;
};

export type HistoryItem = { id: string; createdAt: string; category: string; action: string; target: string; detail: string; };
export type BoardPost = { id: string; createdAt: string; title: string; body: string; pinned: boolean };

export type DemoSettings = {
  referenceYear: number;
  livelihoodByHousehold: Record<string, number>;
  defaultRepaymentMonths: number;
  staff: string[];
  statuses: PipelineStatus[];
  rentalPrioritySamples: { region: string; protectedAmount: number; note: string }[];
};

export type DemoDB = {
  leads: Lead[];
  clients: Client[];
  matters: Matter[];
  assets: Asset[];
  debts: Debt[];
  contracts: Contract[];
  payments: Payment[];
  documents: DocumentItem[];
  cases: CaseProgress[];
  notes: ConsultationNote[];
  history: HistoryItem[];
  board: BoardPost[];
  settings: DemoSettings;
};

export const pipelineStatuses: PipelineStatus[] = [
  "신규접수", "상담예정", "상담완료", "재통화필요", "고려중", "검토중", "서류검토중",
  "대면예약완료", "방문예정", "진행예정", "계약진행중", "수임", "진행중",
  "부재중", "거절", "부적합", "종결(성공)", "종결(중단)", "외부이관"
];

export const pipelineColumns: PipelineStatus[] = [
  "신규접수", "상담예정", "상담완료", "재통화필요", "고려중", "검토중", "계약진행중", "수임", "진행중", "종결(성공)"
];

export const caseTypes: CaseType[] = ["미정", "개인회생", "개인파산", "워크아웃/기타", "외부이관"];
export const paymentMethods: PaymentMethod[] = ["계좌이체", "체크카드", "신용카드", "단순분납", "금융분납"];
export const assetTypes: AssetType[] = ["주택/토지", "임차보증금", "예금/적금", "보험(해약환급금)", "자동차", "퇴직금", "주식/펀드", "사업재고/기타"];
export const debtTypes: DebtType[] = ["세금체납", "건강보험체납", "담보채무-부동산", "담보채무-자동차", "신용채무", "개인채무", "기타"];
export const actionTypes: ActionType[] = ["상담", "재통화", "대면/방문", "계약회신", "서류요청", "입금확인", "사건기한", "기타"];

export const defaultChecklist = [
  [1, "인감증명서 20장", "주민센터", "원본 필수 / 인터넷·대리 발급분 제외"],
  [2, "주민등록등본 2통 / 주민등록초본 2통", "주민센터", "주소변동·주소내역 전체 포함"],
  [3, "가족관계증명서(상세) / 혼인관계증명서(상세)", "주민센터", "상세증명"],
  [4, "지방세 완납증명서 / 세목별과세·미과세증명서", "주민센터", "전국·전체세목"],
  [5, "국세 완납증명서", "주민센터·온라인", "체납 시 발급 불가 가능"],
  [6, "소득금액증명원", "주민센터·온라인", "최근 5년"],
  [7, "자동차등록원부 갑·을구", "주민센터·온라인", "배우자 소유 시 포함"],
  [8, "부동산 등기사항전부증명서", "온라인", "부동산 소유·무상거주 시"],
  [9, "근로소득원천징수영수증", "온라인", "최근 2년"],
  [10, "건강보험자격득실확인서", "온라인", "건강보험공단·정부24"],
  [11, "인감도장 실물", "기타", "실물 확인"],
  [12, "신분증 앞·뒤 사본", "기타", "식별정보 취급 주의"],
  [13, "재직증명서 / 사업자등록증 및 퇴직금 자료", "회사·사업자료", "해당 시"],
  [14, "급여명세서 / 사업자 매출·매입 장부", "회사·세무자료", "최근 1년"],
  [15, "급여입금내역 / 사업자 매출·매입 장부", "금융·세무자료", "최근 1년"],
] as const;

export const guideByTab: Record<string, string[]> = {
  "인적사항": [
    "초본주소와 실제 거주지를 구분해 기록합니다.",
    "초본주소·직장주소를 참고해 관할법원 확인이 필요한지 체크합니다.",
    "자녀 나이·부양가족 여부와 배우자 소득을 구체적으로 확인합니다.",
    "가족 중 중대질환·희귀난치성질환·장기요양 여부를 확인합니다."
  ],
  "소득": [
    "근로소득자는 최근 3개월 월평균급여를 우선 확인합니다.",
    "영업소득자는 매출·매입·지출내역 확보 전에는 대략치임을 표시합니다.",
    "부업·연금 등 2중소득이 있으면 각각 분리 입력합니다."
  ],
  "재산": [
    "부동산·토지·자동차 등은 평가 근거를 메모로 남깁니다.",
    "퇴직금·퇴직연금은 성격이 다를 수 있어 별도 확인 표시를 남깁니다.",
    "영업소득자는 재고자산 등 사업재산을 빠뜨리지 않도록 확인합니다."
  ],
  "채무": [
    "세금·건강보험 체납, 담보채무, 신용채무를 구분합니다.",
    "담보채무는 담보목적물과 채권자를 함께 확인합니다.",
    "개인채무는 계약서·이체내역·내용증명 등 증빙 여부를 메모합니다."
  ],
  "계산": [
    "자동계산 값은 상담용 추정치이며 최종 법률판단이 아닙니다.",
    "가구원수 기준값은 설정 메뉴의 DEMO 기준표를 사용합니다.",
    "청산가치와 가용소득 기준을 비교해 참고용 결과를 보여줍니다."
  ],
  "상담내역": [
    "한 칸 메모에 누적하지 말고 통화·문자·검토 내용을 시간순으로 남깁니다.",
    "다음 연락일이나 해야 할 업무가 있으면 다음액션도 함께 지정합니다."
  ]
};

const d = (offset: number) => {
  const x = new Date();
  x.setDate(x.getDate() + offset);
  return x.toISOString().slice(0, 10);
};
const dt = (offset: number, hh = "09:30") => `${d(offset)}T${hh}:00`;

function docsFor(matterId: string, received = 0): DocumentItem[] {
  return defaultChecklist.map((x, idx) => ({
    id: `doc_${matterId}_${x[0]}`,
    matterId,
    no: x[0],
    title: x[1],
    source: x[2],
    condition: x[3],
    status: idx < received ? "수령" : idx === received ? "요청" : "미수령",
    requestedAt: idx >= received ? d(-1) : undefined,
    receivedAt: idx < received ? d(-3 - idx) : undefined,
    note: ""
  }));
}

export type MatterCalculation = {
  totalIncome: number;
  livelihood: number;
  disposableIncome: number;
  assetTotal: number;
  assetSecuredTotal: number;
  liquidationValue: number;
  debtTotal: number;
  securedDebt: number;
  priorityDebt: number;
  unsecuredDebt: number;
  incomePlanTotal: number;
  finalPlanTotal: number;
  finalMonthlyPayment: number;
  forgivenessAmount: number;
  forgivenessRate: number;
  liquidationSatisfied: boolean;
  recommendation: "정보부족" | "적극추천" | "조건부가능" | "비추천";
};

export function calculateMatter(db: DemoDB, matterId: string): MatterCalculation {
  const matter = db.matters.find(m => m.id === matterId);
  if (!matter) {
    return { totalIncome:0, livelihood:0, disposableIncome:0, assetTotal:0, assetSecuredTotal:0, liquidationValue:0, debtTotal:0, securedDebt:0, priorityDebt:0, unsecuredDebt:0, incomePlanTotal:0, finalPlanTotal:0, finalMonthlyPayment:0, forgivenessAmount:0, forgivenessRate:0, liquidationSatisfied:true, recommendation:"정보부족" };
  }
  const assets = db.assets.filter(a => a.matterId === matterId);
  const debts = db.debts.filter(a => a.matterId === matterId);
  const totalIncome = matter.monthlyIncome + matter.secondaryIncome + matter.pensionIncome;
  const livelihood = db.settings.livelihoodByHousehold[String(Math.max(1, matter.householdSize))] || 0;
  const disposableIncome = Math.max(0, totalIncome - livelihood - matter.otherDeduction);
  const assetTotal = assets.reduce((s, a) => s + a.value, 0);
  const assetSecuredTotal = assets.reduce((s, a) => s + a.securedAmount, 0);
  const liquidationValue = Math.max(0, assetTotal - assetSecuredTotal);
  const debtTotal = debts.reduce((s, a) => s + a.amount, 0);
  const securedDebt = debts.filter(x => x.type === "담보채무-부동산" || x.type === "담보채무-자동차").reduce((s, a) => s + a.amount, 0);
  const priorityDebt = debts.filter(x => x.type === "세금체납" || x.type === "건강보험체납").reduce((s, a) => s + a.amount, 0);
  const unsecuredDebt = debts.filter(x => x.type === "신용채무" || x.type === "개인채무" || x.type === "기타").reduce((s, a) => s + a.amount, 0);
  const months = Math.max(1, matter.repaymentMonths || db.settings.defaultRepaymentMonths);
  const incomePlanTotal = disposableIncome * months;
  const finalPlanTotal = Math.min(unsecuredDebt || incomePlanTotal, Math.max(incomePlanTotal, liquidationValue));
  const finalMonthlyPayment = Math.ceil(finalPlanTotal / months);
  const forgivenessAmount = Math.max(0, unsecuredDebt - finalPlanTotal);
  const forgivenessRate = unsecuredDebt ? forgivenessAmount / unsecuredDebt * 100 : 0;
  const liquidationSatisfied = finalPlanTotal >= liquidationValue;
  let recommendation: MatterCalculation["recommendation"] = "정보부족";
  if (unsecuredDebt > 0 && totalIncome > 0) {
    if (disposableIncome <= 0) recommendation = "비추천";
    else if (!liquidationSatisfied || matter.securedLoanArrears) recommendation = "조건부가능";
    else recommendation = forgivenessRate >= 20 ? "적극추천" : "조건부가능";
  }
  return { totalIncome, livelihood, disposableIncome, assetTotal, assetSecuredTotal, liquidationValue, debtTotal, securedDebt, priorityDebt, unsecuredDebt, incomePlanTotal, finalPlanTotal, finalMonthlyPayment, forgivenessAmount, forgivenessRate, liquidationSatisfied, recommendation };
}

export function seedDemoDB(): DemoDB {
  const settings: DemoSettings = {
    referenceYear: 2026,
    livelihoodByHousehold: {
      "1": 1538543,
      "2": 2510000,
      "3": 3210000,
      "4": 3890000,
      "5": 4570000,
      "6": 5230000,
    },
    defaultRepaymentMonths: 36,
    staff: ["상담A", "상담B", "사건관리A", "관리자"],
    statuses: [...pipelineStatuses],
    rentalPrioritySamples: [
      { region:"서울권 DEMO", protectedAmount:55000000, note:"기능 테스트용 예시값" },
      { region:"수도권 일부 DEMO", protectedAmount:48000000, note:"기능 테스트용 예시값" },
      { region:"기타지역 DEMO", protectedAmount:28000000, note:"기능 테스트용 예시값" },
    ]
  };

  const clients: Client[] = [
    { id:"c1", createdAt:dt(-28), name:"김데모", phone:"010-1000-1001", birthDate:"1987-04-12", gender:"남", address:"서울시 강서구 (DEMO)", court:"서울권 법원 검토", spouse:"배우자 있음", children:"1명 / 8세", otherDependents:"", healthIssue:"", memo:"기능 테스트용 고객" },
    { id:"c2", createdAt:dt(-20), name:"이샘플", phone:"010-1000-1002", birthDate:"1978-11-03", gender:"여", address:"인천시 남동구 (DEMO)", court:"인천권 법원 검토", spouse:"이혼", children:"2명 / 성인", otherDependents:"모친", healthIssue:"장기 치료 관련 자료 확인", memo:"기능 테스트용 고객" },
    { id:"c3", createdAt:dt(-12), name:"박테스트", phone:"010-1000-1003", birthDate:"1991-02-19", gender:"남", address:"경기도 수원시 (DEMO)", court:"수원권 법원 검토", spouse:"배우자 있음", children:"없음", otherDependents:"", healthIssue:"", memo:"동일 고객에 복수 사건 생성 테스트 가능" },
    { id:"c4", createdAt:dt(-5), name:"최예시", phone:"010-1000-1004", birthDate:"1984-07-21", gender:"여", address:"대전시 서구 (DEMO)", court:"대전권 법원 검토", spouse:"배우자 있음", children:"2명 / 5세, 11세", otherDependents:"", healthIssue:"", memo:"사기피해 관련 특이사항 데모" },
    { id:"c5", createdAt:dt(-3), name:"정가상", phone:"010-1000-1005", birthDate:"1965-10-02", gender:"남", address:"부산시 (DEMO)", court:"부산권 법원 검토", spouse:"사실혼", children:"성인 1명", otherDependents:"", healthIssue:"수술이력 확인 필요", memo:"파산 상담 데모" },
  ];

  const matters: Matter[] = [
    { id:"m1", clientId:"c1", createdAt:dt(-27), caseType:"개인회생", status:"서류검토중", assignedTo:"상담A", consultationDate:d(-26), nextActionAt:d(2), nextActionType:"서류요청", leadId:"l1", source:"광고 DEMO", jobType:"직장인", companyName:"DEMO 제조사", employmentInfo:"재직 3년", monthlyIncome:3200000, secondaryIncome:0, pensionIncome:0, spouseIncome:2200000, householdSize:2, otherDeduction:200000, repaymentMonths:36, securedLoanArrears:false, specialIssue:"", memo:"계약 후 서류 수합 중" },
    { id:"m2", clientId:"c2", createdAt:dt(-19), caseType:"개인파산", status:"진행중", assignedTo:"사건관리A", consultationDate:d(-19), nextActionAt:d(4), nextActionType:"사건기한", leadId:"l2", source:"검색광고 DEMO", jobType:"무직/기타", companyName:"", employmentInfo:"장기 실직", monthlyIncome:900000, secondaryIncome:0, pensionIncome:450000, spouseIncome:0, householdSize:2, otherDeduction:0, repaymentMonths:36, securedLoanArrears:false, specialIssue:"장기 실직 및 건강 관련 검토", memo:"파산 절차 진행 데모" },
    { id:"m3", clientId:"c3", createdAt:dt(-11), caseType:"개인회생", status:"계약진행중", assignedTo:"상담B", consultationDate:d(-10), nextActionAt:d(1), nextActionType:"계약회신", leadId:"l3", source:"광고 DEMO", jobType:"프리랜서", companyName:"", employmentInfo:"3.3% 소득", monthlyIncome:4100000, secondaryIncome:350000, pensionIncome:0, spouseIncome:0, householdSize:1, otherDeduction:300000, repaymentMonths:36, securedLoanArrears:true, specialIssue:"담보대출 연체 여부 상급자 검토", memo:"전자계약 회신대기" },
    { id:"m4", clientId:"c4", createdAt:dt(-4), caseType:"개인회생", status:"재통화필요", assignedTo:"상담A", consultationDate:d(-3), nextActionAt:d(0), nextActionType:"재통화", leadId:"l4", source:"소개 DEMO", jobType:"사업자", companyName:"DEMO 온라인몰", employmentInfo:"사업 2년", monthlyIncome:2800000, secondaryIncome:0, pensionIncome:0, spouseIncome:2600000, householdSize:3, otherDeduction:0, repaymentMonths:36, securedLoanArrears:false, specialIssue:"사기피해로 발생한 채무 일부 포함", memo:"특수사정 검토 후 재통화" },
    { id:"m5", clientId:"c5", createdAt:dt(-2), caseType:"개인파산", status:"상담완료", assignedTo:"상담B", consultationDate:d(-1), nextActionAt:d(3), nextActionType:"기타", source:"검색 DEMO", jobType:"일용직", companyName:"", employmentInfo:"불규칙 소득", monthlyIncome:1200000, secondaryIncome:0, pensionIncome:500000, spouseIncome:0, householdSize:1, otherDeduction:0, repaymentMonths:36, securedLoanArrears:false, specialIssue:"과거 절차이력 확인 필요", memo:"자료 확인 후 방향 결정" },
    { id:"m6", clientId:"c3", createdAt:dt(-1), caseType:"워크아웃/기타", status:"고려중", assignedTo:"상담B", consultationDate:d(0), nextActionAt:d(5), nextActionType:"재통화", source:"재상담 DEMO", jobType:"프리랜서", companyName:"", employmentInfo:"동일 고객의 별도 상담건", monthlyIncome:4100000, secondaryIncome:350000, pensionIncome:0, spouseIncome:0, householdSize:1, otherDeduction:0, repaymentMonths:36, securedLoanArrears:false, specialIssue:"동일 고객 복수 상담/사건 구조 테스트", memo:"기존 회생건과 별도 상담" },
  ];

  const leads: Lead[] = [
    { id:"l1", createdAt:dt(-28), name:"김데모", phone:"010-1000-1001", source:"광고 DEMO", timeBand:"평오전", status:"수임", attempts:2, assignedTo:"상담A", caseType:"개인회생", memo:"고객/사건 전환 완료", consultationDate:d(-26), lastContactAt:dt(-26), convertedMatterId:"m1" },
    { id:"l2", createdAt:dt(-21), name:"이샘플", phone:"010-1000-1002", source:"검색광고 DEMO", timeBand:"평오후", status:"수임", attempts:1, assignedTo:"상담B", caseType:"개인파산", memo:"고객/사건 전환 완료", consultationDate:d(-19), lastContactAt:dt(-19), convertedMatterId:"m2" },
    { id:"l3", createdAt:dt(-13), name:"박테스트", phone:"010-1000-1003", source:"광고 DEMO", timeBand:"퇴근후", status:"계약진행중", attempts:4, assignedTo:"상담B", caseType:"개인회생", memo:"담보 연체 이슈", consultationDate:d(-10), nextActionAt:d(1), lastContactAt:dt(-10), convertedMatterId:"m3" },
    { id:"l4", createdAt:dt(-5), name:"최예시", phone:"010-1000-1004", source:"소개 DEMO", timeBand:"평점", status:"재통화필요", attempts:1, assignedTo:"상담A", caseType:"개인회생", memo:"특수사정 검토", consultationDate:d(-3), nextActionAt:d(0), lastContactAt:dt(-3), convertedMatterId:"m4" },
    { id:"l5", createdAt:dt(-1), name:"한신규", phone:"010-1000-1006", source:"광고 DEMO", timeBand:"평오전", status:"상담예정", attempts:0, assignedTo:"상담A", caseType:"미정", memo:"", nextActionAt:d(0) },
    { id:"l6", createdAt:dt(0), name:"윤문의", phone:"010-1000-1007", source:"검색광고 DEMO", timeBand:"평오후", status:"신규접수", attempts:0, assignedTo:"상담B", caseType:"미정", memo:"" },
    { id:"l7", createdAt:dt(-3), name:"송부재", phone:"010-1000-1008", source:"광고 DEMO", timeBand:"주말오전", status:"부재중", attempts:3, assignedTo:"상담B", caseType:"개인회생", memo:"재콜 예정", nextActionAt:d(1), lastContactAt:dt(-1) },
  ];

  const assets: Asset[] = [
    {id:"a1",matterId:"m1",type:"임차보증금",name:"전세보증금 DEMO",value:50000000,securedAmount:20000000,note:"평가 근거 메모"},
    {id:"a2",matterId:"m1",type:"자동차",name:"중고차 DEMO",value:12000000,securedAmount:3000000,note:"시세 참고"},
    {id:"a3",matterId:"m2",type:"예금/적금",name:"예금",value:1500000,securedAmount:0,note:""},
    {id:"a4",matterId:"m3",type:"주택/토지",name:"아파트 DEMO",value:240000000,securedAmount:205000000,note:"담보비율 높음"},
    {id:"a5",matterId:"m4",type:"사업재고/기타",name:"사업 재고",value:6000000,securedAmount:0,note:"대략치"},
  ];

  const debts: Debt[] = [
    {id:"de1",matterId:"m1",type:"신용채무",creditor:"카드/캐피탈 합계 DEMO",amount:78000000,securedAmount:0,note:""},
    {id:"de2",matterId:"m1",type:"건강보험체납",creditor:"공단 DEMO",amount:1200000,securedAmount:0,note:""},
    {id:"de3",matterId:"m2",type:"신용채무",creditor:"금융권 합계 DEMO",amount:146000000,securedAmount:0,note:"장기 연체"},
    {id:"de4",matterId:"m3",type:"담보채무-부동산",creditor:"은행 DEMO",amount:205000000,securedAmount:205000000,note:"연체 여부 확인"},
    {id:"de5",matterId:"m3",type:"신용채무",creditor:"신용대출 DEMO",amount:52000000,securedAmount:0,note:""},
    {id:"de6",matterId:"m4",type:"신용채무",creditor:"카드/대출 DEMO",amount:63000000,securedAmount:0,note:"사기피해 관련 일부"},
    {id:"de7",matterId:"m5",type:"신용채무",creditor:"장기연체 DEMO",amount:95000000,securedAmount:0,note:""},
  ];

  const contracts: Contract[] = [
    {id:"ct1",matterId:"m1",contractDate:d(-25),contractAmount:3300000,paymentMethod:"단순분납",upfrontAmount:300000,installmentCount:5,eSignStatus:"서명완료",financeNoticeDone:true,memo:""},
    {id:"ct2",matterId:"m2",contractDate:d(-18),contractAmount:2800000,paymentMethod:"신용카드",upfrontAmount:2800000,installmentCount:1,eSignStatus:"서명완료",financeNoticeDone:true,memo:""},
    {id:"ct3",matterId:"m3",contractDate:d(-8),contractAmount:3500000,paymentMethod:"금융분납",upfrontAmount:400000,installmentCount:6,eSignStatus:"서명대기",financeNoticeDone:true,memo:"데모 고지 완료"},
  ];

  const payments: Payment[] = [
    {id:"p1",matterId:"m1",contractId:"ct1",dueDate:d(-25),amount:300000,paidAmount:300000,paidDate:d(-25),status:"완료",method:"단순분납",memo:"계약금"},
    {id:"p2",matterId:"m1",contractId:"ct1",dueDate:d(-5),amount:600000,paidAmount:600000,paidDate:d(-5),status:"완료",method:"단순분납",memo:"1회차"},
    {id:"p3",matterId:"m1",contractId:"ct1",dueDate:d(25),amount:600000,paidAmount:0,status:"예정",method:"단순분납",memo:"2회차"},
    {id:"p4",matterId:"m2",contractId:"ct2",dueDate:d(-18),amount:2800000,paidAmount:2800000,paidDate:d(-18),status:"완료",method:"신용카드",memo:"일괄"},
    {id:"p5",matterId:"m3",contractId:"ct3",dueDate:d(-8),amount:400000,paidAmount:400000,paidDate:d(-8),status:"완료",method:"금융분납",memo:"선납"},
    {id:"p6",matterId:"m3",contractId:"ct3",dueDate:d(3),amount:516667,paidAmount:0,status:"예정",method:"금융분납",memo:"1회차"},
  ];

  const documents = [...docsFor("m1",6), ...docsFor("m2",12), ...docsFor("m3",2)];

  const cases: CaseProgress[] = [
    {id:"case1",matterId:"m1",currentStage:"서류수합",court:"미지정",caseNumber:"",nextDueAt:d(3),memo:"미수령 서류 확인",updatedAt:dt(-1)},
    {id:"case2",matterId:"m2",currentStage:"법원접수",court:"DEMO 지방법원",caseNumber:"2026DEMO1234",filedAt:d(-5),nextDueAt:d(8),memo:"보정 여부 확인",updatedAt:dt(0)},
    {id:"case3",matterId:"m3",currentStage:"수임완료",court:"미지정",caseNumber:"",nextDueAt:d(5),memo:"전자계약 회신 후 서류안내",updatedAt:dt(-1)},
  ];

  const notes: ConsultationNote[] = [
    {id:"n1",matterId:"m1",createdAt:dt(-26,"11:10"),author:"상담A",type:"통화",body:"1차 상담 완료. 직장·채무·재산 기본정보 확인."},
    {id:"n2",matterId:"m1",createdAt:dt(-25,"15:20"),author:"상담A",type:"계약",body:"전자계약 완료 및 서류 안내."},
    {id:"n3",matterId:"m1",createdAt:dt(-4,"10:00"),author:"사건관리A",type:"서류",body:"소득 관련 일부 서류 수령. 미수령 항목 재요청 예정."},
    {id:"n4",matterId:"m3",createdAt:dt(-10,"19:10"),author:"상담B",type:"검토",body:"담보대출 연체 여부 확인 필요. 상급자 검토 표시."},
    {id:"n5",matterId:"m4",createdAt:dt(-3,"14:30"),author:"상담A",type:"통화",body:"사기피해 관련 채무 포함 여부 자료 추가 확인 요청."},
  ];

  const history: HistoryItem[] = [
    {id:"h1",createdAt:dt(0),category:"신규 DB",action:"등록",target:"윤문의",detail:"DEMO 신규상담 등록"},
    {id:"h2",createdAt:dt(-1),category:"사건진행",action:"수정",target:"이샘플",detail:"진행단계 → 법원접수"},
    {id:"h3",createdAt:dt(-2),category:"서류수합",action:"수정",target:"김데모",detail:"소득금액증명원 수령 처리"},
  ];

  const board: BoardPost[] = [
    {id:"b1",createdAt:dt(-1),title:"[DEMO] 업무 공지 샘플",body:"이 화면은 기능 테스트용 공지입니다. 실제 상호·고객·계좌 정보는 포함하지 않습니다.",pinned:true},
    {id:"b2",createdAt:dt(-4),title:"서류 수합 체크 안내",body:"누락 서류는 사건 상세 또는 서류수합 메뉴에서 확인하세요.",pinned:false},
  ];

  return { leads, clients, matters, assets, debts, contracts, payments, documents, cases, notes, history, board, settings };
}
