export type MatterType = "개인회생" | "개인파산" | "워크아웃/기타" | "외부이관";
export type MatterStatus =
  | "신규접수" | "상담예정" | "상담완료" | "재통화필요" | "고려중" | "검토중" | "서류검토중"
  | "방문예정" | "대면예약완료" | "계약진행중" | "수임" | "진행중" | "종결(성공)"
  | "거절" | "부적합" | "부재중" | "종결(중단)" | "외부이관";
export type PaymentMethod = "계좌이체" | "체크카드" | "신용카드" | "단순분납" | "금융분납";
export type PaymentStatus = "예정" | "완료" | "연체" | "취소";
export type DocStatus = "미수령" | "요청" | "수령" | "보완필요" | "해당없음";
export type Gender = "미입력" | "남" | "여";
export type OccupationType = "미입력" | "직장인" | "사업자" | "프리랜서" | "일용직" | "무직" | "연금소득" | "기타";

export type Client = {
  id: string; createdAt: string; name: string; phone: string; birthDate: string; gender: Gender;
  address: string; spouse: string; children: string; dependents: number; healthIssue: string; memo: string;
};

export type Matter = {
  id: string; clientId: string; createdAt: string; caseType: MatterType; status: MatterStatus; source: string;
  assignedTo: string; consultDate: string; nextActionAt: string; nextActionType: string;
  occupationType: OccupationType; companyName: string; employmentInfo: string;
  monthlyIncome: number; sideIncome: number; pensionIncome: number; extraDeduction: number;
  repaymentMonths: number; householdSize: number; court: string; specialIssue: string; memo: string;
  firstContactDone: boolean; contactAttempts: number; intakeTimeBand: string;
};

export type AssetItem = {
  id: string; matterId: string; type: string; value: number; securedAmount: number; note: string;
};
export type DebtItem = {
  id: string; matterId: string; type: string; creditor: string; amount: number; note: string;
};
export type ConsultationLog = {
  id: string; matterId: string; createdAt: string; author: string; kind: string; body: string;
};
export type Contract = {
  id: string; matterId: string; contractDate: string; contractAmount: number; paymentMethod: PaymentMethod;
  upfrontAmount: number; installmentCount: number; eSignStatus: "미발송" | "서명대기" | "서명완료" | "취소";
  financeNoticeDone: boolean; memo: string;
};
export type Payment = {
  id: string; matterId: string; contractId: string; dueDate: string; amount: number; paidAmount: number;
  paidDate?: string; status: PaymentStatus; method: PaymentMethod; memo: string;
};
export type DocumentItem = {
  id: string; matterId: string; no: number; title: string; source: string; condition: string; status: DocStatus;
  receivedAt?: string; note: string;
};
export type CaseProgress = {
  id: string; matterId: string; currentStage: string; court: string; caseNumber: string; filedAt?: string;
  nextDueAt?: string; memo: string; updatedAt: string;
};
export type HistoryItem = { id: string; createdAt: string; category: string; action: string; target: string; detail: string; };
export type BoardPost = { id: string; createdAt: string; title: string; body: string; pinned: boolean };

export type DemoSettings = {
  referenceYear: number;
  livingCostByHousehold: Record<string, number>;
  pipelineStatuses: MatterStatus[];
  staffOptions: string[];
  leasePriorityByRegion: Record<string, number>;
};

export type DemoDB = {
  clients: Client[]; matters: Matter[]; assets: AssetItem[]; debts: DebtItem[]; logs: ConsultationLog[];
  contracts: Contract[]; payments: Payment[]; documents: DocumentItem[]; cases: CaseProgress[];
  history: HistoryItem[]; board: BoardPost[]; settings: DemoSettings;
};

export const matterTypes: MatterType[] = ["개인회생", "개인파산", "워크아웃/기타", "외부이관"];
export const matterStatuses: MatterStatus[] = [
  "신규접수","상담예정","상담완료","재통화필요","고려중","검토중","서류검토중","방문예정","대면예약완료",
  "계약진행중","수임","진행중","종결(성공)","거절","부적합","부재중","종결(중단)","외부이관"
];
export const occupationTypes: OccupationType[] = ["미입력","직장인","사업자","프리랜서","일용직","무직","연금소득","기타"];
export const paymentMethods: PaymentMethod[] = ["계좌이체","체크카드","신용카드","단순분납","금융분납"];
export const assetTypes = ["주택/토지","임차보증금(반환채권)","예금/적금","보험(해약환급금)","자동차","퇴직금(1/2)","주식/펀드","기타(재고자산 등)"];
export const debtTypes = ["세금체납","건강보험체납","담보채무-부동산저당","담보채무-자동차","신용채무","개인채무","기타"];

export const defaultChecklist = [
  [1,"인감증명서 20장","주민센터","원본 필수 / 인터넷·대리 발급분 제외"],
  [2,"주민등록등본 2통 / 주민등록초본 2통","주민센터","주소변동·주소내역 전체 포함"],
  [3,"가족관계증명서(상세) / 혼인관계증명서(상세)","주민센터","상세증명"],
  [4,"지방세 완납증명서 / 세목별과세·미과세증명서","주민센터","전국·전체세목"],
  [5,"국세 완납증명서","주민센터·온라인","체납 시 발급 불가 가능"],
  [6,"소득금액증명원","주민센터·온라인","최근 5년"],
  [7,"자동차등록원부 갑·을구","주민센터·온라인","배우자 소유 시 포함"],
  [8,"부동산 등기사항전부증명서","온라인","부동산 소유·무상거주 시"],
  [9,"근로소득원천징수영수증","온라인","최근 2년"],
  [10,"건강보험자격득실확인서","온라인","건강보험공단·정부24"],
  [11,"인감도장 실물","기타","실물 확인"],
  [12,"신분증 앞·뒤 사본","기타","식별정보 취급 주의"],
  [13,"재직증명서 / 사업자등록증 및 퇴직금 자료","회사·사업자료","해당 시"],
  [14,"급여명세서 / 사업자 매출·매입 장부","회사·세무자료","최근 1년"],
  [15,"급여입금내역 / 사업자 매출·매입 장부","금융·세무자료","최근 1년"],
] as const;

export const consultationGuides = {
  profile: ["초본주소·직장주소 확인 후 관할법원 확인", "자녀 인원·나이와 실제 부양가족 여부 확인", "배우자 소득 구체적으로 확인", "중대질환·희귀난치성질환·장기요양 여부 확인"],
  income: ["근로소득자는 최근 3개월 월평균급여 우선 확인", "영업소득자는 매출·매입·POS·지출내역 확보 전에는 추정치로 표시", "부업 및 연금소득이 있으면 별도 입력"],
  assets: ["부동산·토지·자동차 등 평가근거 메모", "퇴직금은 실제 반영대상 여부 별도 확인", "영업소득자는 재고자산 등 사업재산 확인"],
  debts: ["세금·건강보험 체납을 일반 신용채무와 구분", "담보채무는 담보물·우선순위·연체 여부를 함께 확인", "개인채무는 증빙자료 존재 여부 확인"],
  calc: ["자동계산 결과는 상담용 추정치", "최종 변제금·탕감률·진행가능 여부는 서류검토와 담당자 확인 필요", "기준표는 데모값이며 실제 사용 전 공식 기준으로 교체"],
};

const d = (offset:number) => { const x = new Date(); x.setDate(x.getDate()+offset); return x.toISOString().slice(0,10); };
const dt = (offset:number, hour=9) => `${d(offset)}T${String(hour).padStart(2,"0")}:30:00`;

function docsFor(matterId:string, received=0): DocumentItem[] {
  return defaultChecklist.map((x,idx)=>({
    id:`doc_${matterId}_${x[0]}`, matterId, no:x[0], title:x[1], source:x[2], condition:x[3],
    status: idx < received ? "수령" : idx === received ? "요청" : "미수령",
    receivedAt: idx < received ? d(-2-idx) : undefined, note:""
  }));
}

export function seedDemoDB(): DemoDB {
  const settings: DemoSettings = {
    referenceYear: 2026,
    livingCostByHousehold: {"1":1538543,"2":2500000,"3":3200000,"4":3850000,"5":4450000,"6":5050000},
    pipelineStatuses: matterStatuses,
    staffOptions: ["상담1","상담2","사건관리1","관리자"],
    leasePriorityByRegion: {"DEMO-서울권":55000000,"DEMO-수도권":48000000,"DEMO-광역권":28000000,"DEMO-기타":25000000},
  };

  const clients: Client[] = [
    {id:"c1",createdAt:dt(-18),name:"김민준",phone:"010-2314-7781",birthDate:"1988-04-12",gender:"남",address:"서울시 강서구 (데모)",spouse:"있음",children:"1명 / 7세",dependents:2,healthIssue:"",memo:"데모 고객"},
    {id:"c2",createdAt:dt(-13),name:"이서연",phone:"010-8472-1135",birthDate:"1979-09-02",gender:"여",address:"인천시 남동구 (데모)",spouse:"없음",children:"2명 / 성년",dependents:1,healthIssue:"",memo:"데모 고객"},
    {id:"c3",createdAt:dt(-7),name:"박지훈",phone:"010-5541-9082",birthDate:"1992-01-21",gender:"남",address:"경기도 수원시 (데모)",spouse:"있음",children:"없음",dependents:1,healthIssue:"",memo:"데모 고객"},
    {id:"c4",createdAt:dt(-2),name:"최유진",phone:"010-6628-4402",birthDate:"1995-11-03",gender:"여",address:"대전시 서구 (데모)",spouse:"없음",children:"없음",dependents:1,healthIssue:"",memo:"특수사정 검토"},
    {id:"c5",createdAt:dt(-1),name:"정하늘",phone:"010-7112-3098",birthDate:"",gender:"미입력",address:"부산시 (데모)",spouse:"",children:"",dependents:1,healthIssue:"",memo:"신규 상담"},
  ];

  const matters: Matter[] = [
    {id:"m1",clientId:"c1",createdAt:dt(-20),caseType:"개인회생",status:"서류검토중",source:"Meta 데모",assignedTo:"상담1",consultDate:d(-18),nextActionAt:d(2),nextActionType:"누락서류 확인",occupationType:"직장인",companyName:"DEMO 주식회사",employmentInfo:"재직 2년",monthlyIncome:3200000,sideIncome:0,pensionIncome:0,extraDeduction:150000,repaymentMonths:36,householdSize:2,court:"미지정",specialIssue:"",memo:"급여소득자 / 상담 완료",firstContactDone:true,contactAttempts:2,intakeTimeBand:"평오전"},
    {id:"m2",clientId:"c2",createdAt:dt(-16),caseType:"개인파산",status:"진행중",source:"검색광고 데모",assignedTo:"사건관리1",consultDate:d(-13),nextActionAt:d(5),nextActionType:"법원 진행 확인",occupationType:"무직",companyName:"",employmentInfo:"장기실직",monthlyIncome:900000,sideIncome:0,pensionIncome:0,extraDeduction:0,repaymentMonths:36,householdSize:2,court:"DEMO 지방법원",specialIssue:"장기 실직",memo:"서류 대부분 수합 완료",firstContactDone:true,contactAttempts:1,intakeTimeBand:"평오후"},
    {id:"m3",clientId:"c3",createdAt:dt(-9),caseType:"개인회생",status:"수임",source:"Meta 데모",assignedTo:"상담2",consultDate:d(-7),nextActionAt:d(3),nextActionType:"계약 후 서류안내",occupationType:"직장인",companyName:"DEMO 물류",employmentInfo:"재직 4년",monthlyIncome:4100000,sideIncome:0,pensionIncome:0,extraDeduction:0,repaymentMonths:36,householdSize:1,court:"미지정",specialIssue:"담보대출 연체 확인 필요",memo:"상급자 검토 표시",firstContactDone:true,contactAttempts:4,intakeTimeBand:"퇴근후"},
    {id:"m4",clientId:"c4",createdAt:dt(-2),caseType:"개인회생",status:"검토중",source:"소개 데모",assignedTo:"상담1",consultDate:d(-1),nextActionAt:d(1),nextActionType:"재통화",occupationType:"프리랜서",companyName:"",employmentInfo:"",monthlyIncome:2500000,sideIncome:300000,pensionIncome:0,extraDeduction:0,repaymentMonths:36,householdSize:1,court:"미지정",specialIssue:"사기 피해로 발생한 채무 일부 포함",memo:"절차 적합성 확인 필요",firstContactDone:true,contactAttempts:1,intakeTimeBand:"평점"},
    {id:"m5",clientId:"c5",createdAt:dt(-1),caseType:"워크아웃/기타",status:"신규접수",source:"검색광고 데모",assignedTo:"상담2",consultDate:"",nextActionAt:d(0),nextActionType:"문자인사",occupationType:"미입력",companyName:"",employmentInfo:"",monthlyIncome:0,sideIncome:0,pensionIncome:0,extraDeduction:0,repaymentMonths:36,householdSize:1,court:"미지정",specialIssue:"",memo:"",firstContactDone:false,contactAttempts:0,intakeTimeBand:"평오전"},
    {id:"m6",clientId:"c1",createdAt:dt(-120),caseType:"워크아웃/기타",status:"종결(중단)",source:"재문의 데모",assignedTo:"상담1",consultDate:d(-118),nextActionAt:"",nextActionType:"",occupationType:"직장인",companyName:"",employmentInfo:"",monthlyIncome:3000000,sideIncome:0,pensionIncome:0,extraDeduction:0,repaymentMonths:36,householdSize:2,court:"",specialIssue:"",memo:"과거 별도 상담 이력 예시",firstContactDone:true,contactAttempts:2,intakeTimeBand:"평오후"},
  ];

  const assets: AssetItem[] = [
    {id:"a1",matterId:"m1",type:"임차보증금(반환채권)",value:30000000,securedAmount:0,note:"월세 거주"},
    {id:"a2",matterId:"m1",type:"자동차",value:9000000,securedAmount:2000000,note:"DEMO 차량"},
    {id:"a3",matterId:"m2",type:"예금/적금",value:1200000,securedAmount:0,note:""},
    {id:"a4",matterId:"m3",type:"주택/토지",value:180000000,securedAmount:145000000,note:"담보 연체 검토"},
    {id:"a5",matterId:"m4",type:"예금/적금",value:3000000,securedAmount:0,note:""},
  ];

  const debts: DebtItem[] = [
    {id:"d1",matterId:"m1",type:"신용채무",creditor:"DEMO 카드",amount:42000000,note:""},
    {id:"d2",matterId:"m1",type:"신용채무",creditor:"DEMO 캐피탈",amount:36000000,note:""},
    {id:"d3",matterId:"m2",type:"신용채무",creditor:"다수 금융기관",amount:146000000,note:"장기연체 데모"},
    {id:"d4",matterId:"m3",type:"담보채무-부동산저당",creditor:"DEMO 은행",amount:145000000,note:"연체 여부 확인"},
    {id:"d5",matterId:"m3",type:"신용채무",creditor:"DEMO 카드",amount:52000000,note:""},
    {id:"d6",matterId:"m4",type:"신용채무",creditor:"DEMO 금융",amount:28000000,note:""},
    {id:"d7",matterId:"m4",type:"세금체납",creditor:"세금",amount:8000000,note:"상담 참고"},
  ];

  const logs: ConsultationLog[] = [
    {id:"log1",matterId:"m1",createdAt:dt(-18,10),author:"상담1",kind:"통화",body:"기초상담 완료. 소득·채무·재산 기본정보 확인."},
    {id:"log2",matterId:"m1",createdAt:dt(-10,15),author:"상담1",kind:"서류",body:"서류 안내 발송. 일부 서류 수령 대기."},
    {id:"log3",matterId:"m3",createdAt:dt(-7,13),author:"상담2",kind:"계약",body:"전자계약 완료. 담보대출 관련 사항은 사건관리 검토 필요."},
    {id:"log4",matterId:"m4",createdAt:dt(-1,16),author:"상담1",kind:"상담",body:"사기피해 관련 특수사정이 있어 검토중으로 전환."},
  ];

  const contracts: Contract[] = [
    {id:"ct1",matterId:"m1",contractDate:d(-18),contractAmount:3300000,paymentMethod:"단순분납",upfrontAmount:300000,installmentCount:5,eSignStatus:"서명완료",financeNoticeDone:true,memo:""},
    {id:"ct2",matterId:"m2",contractDate:d(-13),contractAmount:2800000,paymentMethod:"신용카드",upfrontAmount:2800000,installmentCount:1,eSignStatus:"서명완료",financeNoticeDone:true,memo:""},
    {id:"ct3",matterId:"m3",contractDate:d(-7),contractAmount:3500000,paymentMethod:"금융분납",upfrontAmount:400000,installmentCount:6,eSignStatus:"서명완료",financeNoticeDone:true,memo:"금융상품 안내 완료 데모"},
  ];

  const payments: Payment[] = [
    {id:"p1",matterId:"m1",contractId:"ct1",dueDate:d(-18),amount:300000,paidAmount:300000,paidDate:d(-18),status:"완료",method:"단순분납",memo:"계약금"},
    {id:"p2",matterId:"m1",contractId:"ct1",dueDate:d(-3),amount:600000,paidAmount:600000,paidDate:d(-3),status:"완료",method:"단순분납",memo:"1회차"},
    {id:"p3",matterId:"m1",contractId:"ct1",dueDate:d(27),amount:600000,paidAmount:0,status:"예정",method:"단순분납",memo:"2회차"},
    {id:"p4",matterId:"m2",contractId:"ct2",dueDate:d(-13),amount:2800000,paidAmount:2800000,paidDate:d(-13),status:"완료",method:"신용카드",memo:"일괄"},
    {id:"p5",matterId:"m3",contractId:"ct3",dueDate:d(-7),amount:400000,paidAmount:400000,paidDate:d(-7),status:"완료",method:"금융분납",memo:"계약금"},
    {id:"p6",matterId:"m3",contractId:"ct3",dueDate:d(3),amount:516667,paidAmount:0,status:"예정",method:"금융분납",memo:"1회차"},
  ];

  const documents = [...docsFor("m1",6),...docsFor("m2",12),...docsFor("m3",2)];
  const cases: CaseProgress[] = [
    {id:"case1",matterId:"m1",currentStage:"서류수합",court:"미지정",caseNumber:"",nextDueAt:d(3),memo:"미수령 서류 확인",updatedAt:dt(-1)},
    {id:"case2",matterId:"m2",currentStage:"법원접수",court:"DEMO 지방법원",caseNumber:"2026데모1234",filedAt:d(-5),nextDueAt:d(8),memo:"보정 여부 확인",updatedAt:dt(0)},
    {id:"case3",matterId:"m3",currentStage:"수임완료",court:"미지정",caseNumber:"",nextDueAt:d(5),memo:"서류안내 발송",updatedAt:dt(-1)},
  ];

  const history: HistoryItem[] = [
    {id:"h1",createdAt:dt(0),category:"신규상담",action:"등록",target:"정하늘",detail:"데모 신규 상담 생성"},
    {id:"h2",createdAt:dt(-1),category:"사건진행",action:"수정",target:"이서연",detail:"진행단계 → 법원접수"},
    {id:"h3",createdAt:dt(-2),category:"서류수합",action:"수정",target:"김민준",detail:"소득금액증명원 수령 처리"},
  ];
  const board: BoardPost[] = [
    {id:"b1",createdAt:dt(-1),title:"[DEMO] 업무 공지 샘플",body:"이 화면은 기능 테스트용 공지입니다.",pinned:true},
    {id:"b2",createdAt:dt(-4),title:"서류 수합 체크 안내",body:"누락 서류는 고객 상세의 서류관리에서 확인하세요.",pinned:false},
  ];

  return {clients,matters,assets,debts,logs,contracts,payments,documents,cases,history,board,settings};
}
