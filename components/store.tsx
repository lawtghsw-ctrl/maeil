"use client";

import {createContext,useContext,useEffect,useMemo,useRef,useState} from "react";

export type MatterType="개인회생"|"개인파산"|"워크아웃/기타"|"외부이관";
export type MatterStatus="신규접수"|"상담예정"|"상담완료"|"재통화필요"|"고려중"|"서류검토중"|"계약진행중"|"수임"|"진행중"|"종결(성공)"|"거절"|"부적합"|"부재중"|"종결(중단)";
export type PaymentStatus="예정"|"완료"|"연체"|"취소";
export type DocStatus="미수령"|"요청"|"수령"|"보완필요"|"해당없음";
export type Gender="미입력"|"남"|"여";
export type Occupation="미입력"|"직장인"|"사업자"|"프리랜서"|"일용직"|"무직"|"연금소득"|"기타";
export type Manager="상담1"|"상담2"|"사건관리1"|"관리자";

export type Client={id:string;createdAt:string;name:string;phone:string;birthDate:string;gender:Gender;address:string;spouse:string;children:string;dependents:number;healthIssue:string;manager:Manager;memo:string};
export type Matter={id:string;clientId:string;createdAt:string;caseType:MatterType;status:MatterStatus;source:string;manager:Manager;consultDate:string;nextActionDate:string;nextActionType:string;occupation:Occupation;companyName:string;employmentInfo:string;monthlyIncome:number;sideIncome:number;pensionIncome:number;extraDeduction:number;repaymentMonths:number;householdSize:number;court:string;memo:string;firstContactDone:boolean;contactAttempts:number;clientRegistered:boolean;clientRegisteredAt:string};
export type Asset={id:string;matterId:string;type:string;value:number;securedAmount:number;note:string};
export type Debt={id:string;matterId:string;type:string;creditor:string;amount:number;note:string};
export type Contract={id:string;matterId:string;contractDate:string;contractAmount:number;paymentMethod:string;upfrontAmount:number;installmentCount:number;status:"미작성"|"작성중"|"계약완료"|"취소";memo:string};
export type Payment={id:string;matterId:string;dueDate:string;amount:number;paidAmount:number;paidDate:string;status:PaymentStatus;method:string;memo:string};
export type DocumentItem={id:string;matterId:string;no:number;title:string;source:string;condition:string;status:DocStatus;receivedAt:string;note:string};
export type CaseProgress={id:string;matterId:string;currentStage:string;court:string;caseNumber:string;filedAt:string;nextDueAt:string;memo:string;updatedAt:string};
export type ConsultationLog={id:string;matterId:string;createdAt:string;author:string;kind:string;body:string};
export type BoardPost={id:string;createdAt:string;title:string;body:string;author:string;pinned:boolean};
export type HistoryItem={id:string;createdAt:string;category:string;action:string;target:string;detail:string};
export type Settings={referenceYear:number;livingCostByHousehold:Record<string,number>;staffOptions:Manager[];leasePriorityByRegion:Record<string,number>};
export type DemoDB={clients:Client[];matters:Matter[];assets:Asset[];debts:Debt[];contracts:Contract[];payments:Payment[];documents:DocumentItem[];cases:CaseProgress[];logs:ConsultationLog[];board:BoardPost[];history:HistoryItem[];settings:Settings};

export const matterTypes:MatterType[]=["개인회생","개인파산","워크아웃/기타","외부이관"];
export const matterStatuses:MatterStatus[]=["신규접수","상담예정","상담완료","재통화필요","고려중","서류검토중","계약진행중","수임","진행중","종결(성공)","거절","부적합","부재중","종결(중단)"];
export const occupations:Occupation[]=["미입력","직장인","사업자","프리랜서","일용직","무직","연금소득","기타"];
export const managers:Manager[]=["상담1","상담2","사건관리1","관리자"];
export const assetTypes=["주택/토지","임차보증금","예금/적금","보험(해약환급금)","자동차","퇴직금(1/2)","주식/펀드","기타"];
export const debtTypes=["세금체납","건강보험체납","담보채무-부동산","담보채무-자동차","신용채무","개인채무","기타"];
export const documentChecklist=[
 [1,"인감증명서 20장","주민센터","원본 필수"],
 [2,"주민등록등본 / 초본","주민센터","주소변동 내역 포함"],
 [3,"가족관계증명서 / 혼인관계증명서","주민센터","상세증명"],
 [4,"지방세 완납 및 세목별 과세증명","주민센터","전국·전체세목"],
 [5,"국세 완납증명서","온라인/주민센터","체납 여부 확인"],
 [6,"소득금액증명원","온라인/주민센터","최근 5년"],
 [7,"자동차등록원부 갑·을","온라인/주민센터","해당 시"],
 [8,"부동산 등기사항전부증명서","온라인","해당 시"],
 [9,"근로소득원천징수영수증","회사/온라인","최근 2년"],
 [10,"건강보험자격득실확인서","온라인","전체 이력"],
 [11,"인감도장","기타","실물 확인"],
 [12,"신분증 앞·뒤 사본","기타","식별정보 취급 주의"],
 [13,"재직증명서 / 사업자등록증 / 퇴직금 자료","회사/사업자료","해당 시"],
 [14,"급여명세서 / 사업자 매출·매입 장부","회사/세무자료","최근 1년"],
 [15,"급여입금내역 / 사업자 매출·매입 장부","금융/세무자료","최근 1년"],
] as const;

const STORAGE_KEY="maeil-rehab-admin-from-dowon-v1";
function kstToday(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function dateOffset(offset:number){const x=new Date();x.setDate(x.getDate()+offset);return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(x)}
function dateTimeOffset(offset:number,hour=10){return `${dateOffset(offset)}T${String(hour).padStart(2,"0")}:30:00+09:00`}
function docsFor(matterId:string,received=0):DocumentItem[]{return documentChecklist.map((x,i)=>({id:`doc_${matterId}_${x[0]}`,matterId,no:x[0],title:x[1],source:x[2],condition:x[3],status:i<received?"수령":i===received?"요청":"미수령",receivedAt:i<received?dateOffset(-i-1):"",note:""}))}

export function seedDemoDB():DemoDB{
 const clients:Client[]=[
  {id:"c1",createdAt:dateTimeOffset(-20),name:"김민준",phone:"010-2314-7781",birthDate:"1988-04-12",gender:"남",address:"서울시 강서구 (데모)",spouse:"있음",children:"1명 / 7세",dependents:2,healthIssue:"",manager:"상담1",memo:"급여소득자"},
  {id:"c2",createdAt:dateTimeOffset(-14),name:"이서연",phone:"010-8472-1135",birthDate:"1979-09-02",gender:"여",address:"인천시 남동구 (데모)",spouse:"없음",children:"2명 / 성년",dependents:1,healthIssue:"",manager:"상담2",memo:"파산 상담"},
  {id:"c3",createdAt:dateTimeOffset(-8),name:"박지훈",phone:"010-5541-9082",birthDate:"1992-01-21",gender:"남",address:"경기도 수원시 (데모)",spouse:"있음",children:"없음",dependents:1,healthIssue:"",manager:"상담1",memo:"재통화 예정"},
  {id:"c4",createdAt:dateTimeOffset(-2),name:"최유진",phone:"010-6628-4402",birthDate:"1995-11-03",gender:"여",address:"대전시 서구 (데모)",spouse:"없음",children:"없음",dependents:1,healthIssue:"",manager:"상담2",memo:"신규 상담"},
  {id:"c5",createdAt:dateTimeOffset(-1),name:"정하늘",phone:"010-7112-3098",birthDate:"",gender:"미입력",address:"부산시 (데모)",spouse:"",children:"",dependents:1,healthIssue:"",manager:"상담1",memo:"미등록 신규 DB"},
 ];
 const matters:Matter[]=[
  {id:"m1",clientId:"c1",createdAt:dateTimeOffset(-20),caseType:"개인회생",status:"서류검토중",source:"온라인 광고",manager:"상담1",consultDate:dateOffset(-18),nextActionDate:dateOffset(2),nextActionType:"누락서류 확인",occupation:"직장인",companyName:"DEMO 주식회사",employmentInfo:"재직 2년",monthlyIncome:3200000,sideIncome:0,pensionIncome:0,extraDeduction:150000,repaymentMonths:36,householdSize:2,court:"미지정",memo:"상담 완료",firstContactDone:true,contactAttempts:2,clientRegistered:true,clientRegisteredAt:dateOffset(-18)},
  {id:"m2",clientId:"c2",createdAt:dateTimeOffset(-14),caseType:"개인파산",status:"수임",source:"소개",manager:"사건관리1",consultDate:dateOffset(-12),nextActionDate:dateOffset(1),nextActionType:"서류 보완",occupation:"무직",companyName:"",employmentInfo:"",monthlyIncome:0,sideIncome:0,pensionIncome:850000,extraDeduction:0,repaymentMonths:36,householdSize:1,court:"미지정",memo:"파산 검토",firstContactDone:true,contactAttempts:1,clientRegistered:true,clientRegisteredAt:dateOffset(-12)},
  {id:"m3",clientId:"c3",createdAt:dateTimeOffset(-8),caseType:"개인회생",status:"재통화필요",source:"검색",manager:"상담1",consultDate:dateOffset(-7),nextActionDate:kstToday(),nextActionType:"재통화",occupation:"프리랜서",companyName:"",employmentInfo:"플랫폼 소득",monthlyIncome:2850000,sideIncome:300000,pensionIncome:0,extraDeduction:0,repaymentMonths:36,householdSize:1,court:"미지정",memo:"소득증빙 추가 확인",firstContactDone:true,contactAttempts:3,clientRegistered:true,clientRegisteredAt:dateOffset(-7)},
  {id:"m4",clientId:"c4",createdAt:dateTimeOffset(-2),caseType:"개인회생",status:"상담예정",source:"온라인 광고",manager:"상담2",consultDate:kstToday(),nextActionDate:kstToday(),nextActionType:"초기상담",occupation:"직장인",companyName:"",employmentInfo:"",monthlyIncome:0,sideIncome:0,pensionIncome:0,extraDeduction:0,repaymentMonths:36,householdSize:1,court:"미지정",memo:"",firstContactDone:false,contactAttempts:1,clientRegistered:false,clientRegisteredAt:""},
  {id:"m5",clientId:"c5",createdAt:dateTimeOffset(-1),caseType:"개인회생",status:"신규접수",source:"온라인 광고",manager:"상담1",consultDate:"",nextActionDate:kstToday(),nextActionType:"첫 연락",occupation:"미입력",companyName:"",employmentInfo:"",monthlyIncome:0,sideIncome:0,pensionIncome:0,extraDeduction:0,repaymentMonths:36,householdSize:1,court:"미지정",memo:"",firstContactDone:false,contactAttempts:0,clientRegistered:false,clientRegisteredAt:""},
 ];
 const assets:Asset[]=[
  {id:"a1",matterId:"m1",type:"임차보증금",value:30000000,securedAmount:0,note:"데모"},{id:"a2",matterId:"m1",type:"자동차",value:8000000,securedAmount:3000000,note:""},
  {id:"a3",matterId:"m2",type:"예금/적금",value:1800000,securedAmount:0,note:""}
 ];
 const debts:Debt[]=[
  {id:"d1",matterId:"m1",type:"신용채무",creditor:"A카드",amount:42000000,note:""},{id:"d2",matterId:"m1",type:"신용채무",creditor:"B저축은행",amount:28000000,note:""},{id:"d3",matterId:"m1",type:"세금체납",creditor:"세무 관련",amount:2500000,note:""},{id:"d4",matterId:"m2",type:"신용채무",creditor:"C카드",amount:61000000,note:""}
 ];
 const contracts:Contract[]=[
  {id:"ct1",matterId:"m1",contractDate:dateOffset(-15),contractAmount:1800000,paymentMethod:"분납",upfrontAmount:600000,installmentCount:3,status:"계약완료",memo:""},
  {id:"ct2",matterId:"m2",contractDate:dateOffset(-10),contractAmount:2200000,paymentMethod:"분납",upfrontAmount:1000000,installmentCount:3,status:"계약완료",memo:""},
 ];
 const payments:Payment[]=[
  {id:"p1",matterId:"m1",dueDate:dateOffset(-15),amount:600000,paidAmount:600000,paidDate:dateOffset(-15),status:"완료",method:"계좌이체",memo:"선납"},
  {id:"p2",matterId:"m1",dueDate:dateOffset(5),amount:400000,paidAmount:0,paidDate:"",status:"예정",method:"계좌이체",memo:"1회차"},
  {id:"p3",matterId:"m2",dueDate:dateOffset(-10),amount:1000000,paidAmount:1000000,paidDate:dateOffset(-10),status:"완료",method:"계좌이체",memo:"선납"},
  {id:"p4",matterId:"m2",dueDate:dateOffset(1),amount:400000,paidAmount:0,paidDate:"",status:"예정",method:"계좌이체",memo:"1회차"},
 ];
 const documents=[...docsFor("m1",6),...docsFor("m2",9)];
 const cases:CaseProgress[]=[
  {id:"case1",matterId:"m1",currentStage:"서류검토",court:"미지정",caseNumber:"",filedAt:"",nextDueAt:dateOffset(7),memo:"소득자료 보완 필요",updatedAt:dateTimeOffset(-1)},
  {id:"case2",matterId:"m2",currentStage:"신청 준비",court:"미지정",caseNumber:"",filedAt:"",nextDueAt:dateOffset(4),memo:"추가 진술자료 확인",updatedAt:dateTimeOffset(-1)},
 ];
 const logs:ConsultationLog[]=[
  {id:"log1",matterId:"m1",createdAt:dateTimeOffset(-18,14),author:"상담1",kind:"상담",body:"소득·재산·채무 기본 확인. 서류 요청 안내."},
  {id:"log2",matterId:"m3",createdAt:dateTimeOffset(-7,16),author:"상담1",kind:"재통화",body:"소득증빙 준비 후 재통화 예정."}
 ];
 const board:BoardPost[]=[{id:"b1",createdAt:dateTimeOffset(-1),title:"[공지] 데모 운영 안내",body:"본 프로젝트는 회생·파산 업무흐름을 테스트하기 위한 데모입니다.",author:"관리자",pinned:true}];
 const history:HistoryItem[]=[
  {id:"h1",createdAt:dateTimeOffset(-1),category:"신규 DB",action:"등록",target:"정하늘",detail:"온라인 광고 DB가 등록되었습니다."},
  {id:"h2",createdAt:dateTimeOffset(-2),category:"의뢰인 관리",action:"상태변경",target:"최유진",detail:"신규접수 → 상담예정"},
 ];
 return {clients,matters,assets,debts,contracts,payments,documents,cases,logs,board,history,settings:{referenceYear:2026,livingCostByHousehold:{"1":1538543,"2":2500000,"3":3200000,"4":3850000,"5":4450000,"6":5050000},staffOptions:managers,leasePriorityByRegion:{"서울권(데모)":55000000,"수도권(데모)":48000000,"광역권(데모)":28000000,"기타(데모)":25000000}}};
}

function isValidDb(x:unknown):x is DemoDB{if(!x||typeof x!=="object")return false;const d=x as Partial<DemoDB>;return Array.isArray(d.clients)&&Array.isArray(d.matters)&&Array.isArray(d.documents)&&!!d.settings&&typeof d.settings==="object"}
function id(prefix:string){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`}

type Store={db:DemoDB;update:(fn:(db:DemoDB)=>DemoDB)=>void;reset:()=>void;refresh:()=>Promise<void>;addHistory:(category:string,action:string,target:string,detail:string)=>HistoryItem;};
const Ctx=createContext<Store|null>(null);

export function AdminStoreProvider({children}:{children:React.ReactNode}){
 const [db,setDb]=useState<DemoDB>(()=>seedDemoDB());
 const loadedRef=useRef(false);
 useEffect(()=>{
  const timer=window.setTimeout(()=>{
   try{const raw=window.localStorage.getItem(STORAGE_KEY);if(raw){const parsed=JSON.parse(raw);if(isValidDb(parsed))setDb(parsed)}}catch{/* use seed */}
   loadedRef.current=true;
  },0);
  return()=>window.clearTimeout(timer);
 },[]);
 useEffect(()=>{if(!loadedRef.current)return;try{window.localStorage.setItem(STORAGE_KEY,JSON.stringify(db))}catch{}},[db]);
 const value=useMemo<Store>(()=>({
  db,
  update(fn){setDb(prev=>fn(prev))},
  reset(){const fresh=seedDemoDB();setDb(fresh);try{window.localStorage.setItem(STORAGE_KEY,JSON.stringify(fresh))}catch{}},
  async refresh(){return Promise.resolve()},
  addHistory(category,action,target,detail){return{id:id("h"),createdAt:new Date().toISOString(),category,action,target,detail}},
 }),[db]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAdminStore(){const x=useContext(Ctx);if(!x)throw new Error("AdminStoreProvider missing");return x}
export function nextId(prefix:string){return id(prefix)}
export function today(){return kstToday()}
