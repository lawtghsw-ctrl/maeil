"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Inbox, Users, Columns3, CalendarClock, FileSignature, FolderCheck, Landmark,
  CreditCard, BarChart3, History, Menu, X, RotateCcw, Plus, Search, CheckCircle2, AlertTriangle,
  ChevronRight, PhoneCall, FileText, WalletCards, CalendarDays, Save, Download, Bell,
  MessageSquareText, Calculator, Settings, Printer, Trash2, Pencil, ListTodo, ExternalLink,
  BriefcaseBusiness, Home, BadgeDollarSign, NotebookTabs, CopyPlus, CircleDollarSign
} from "lucide-react";
import {
  ActionType, Asset, AssetType, CaseProgress, CaseType, Client, Contract, Debt, DebtType, DemoDB,
  DocStatus, DocumentItem, Lead, Matter, Payment, PaymentMethod, PaymentStatus, PipelineStatus,
  actionTypes, assetTypes, calculateMatter, caseTypes, debtTypes, defaultChecklist, guideByTab,
  paymentMethods, pipelineColumns, pipelineStatuses, seedDemoDB
} from "@/lib/demo-data";

const STORAGE_KEY = "rehab-bankruptcy-admin-demo-v2";

type Section =
  | "dashboard" | "leads" | "clients" | "pipeline" | "schedule" | "contracts" | "payments"
  | "documents" | "cases" | "analytics" | "board" | "calculator" | "settings" | "history";

const sections: {id:Section; label:string; icon:React.ComponentType<{size?:number}>; group?:string}[] = [
  {id:"dashboard",label:"대시보드",icon:LayoutDashboard},
  {id:"leads",label:"신규 상담 DB",icon:Inbox},
  {id:"clients",label:"상담 / 고객 관리",icon:Users},
  {id:"pipeline",label:"파이프라인",icon:Columns3},
  {id:"schedule",label:"오늘의 일정",icon:CalendarClock},
  {id:"contracts",label:"계약 관리",icon:FileSignature},
  {id:"payments",label:"입금 / 분납",icon:CreditCard},
  {id:"documents",label:"서류 수합",icon:FolderCheck},
  {id:"cases",label:"사건 진행",icon:Landmark},
  {id:"analytics",label:"데이터 집계",icon:BarChart3},
  {id:"board",label:"내부 게시판",icon:MessageSquareText},
  {id:"calculator",label:"회생 예상계산기",icon:Calculator,group:"도구"},
  {id:"settings",label:"기준표 / 설정",icon:Settings,group:"도구"},
  {id:"history",label:"변동내역",icon:History,group:"도구"},
];

const money = (v:number) => new Intl.NumberFormat("ko-KR").format(Math.round(v || 0)) + "원";
const shortMoney = (v:number) => v >= 100000000 ? `${(v/100000000).toFixed(1)}억` : v >= 10000 ? `${Math.round(v/10000).toLocaleString()}만` : v.toLocaleString();
const today = () => new Date().toISOString().slice(0,10);
const id = (p:string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const fmtDate = (s?:string) => s ? s.slice(0,10) : "-";
const pct = (a:number,b:number) => b ? Math.round(a/b*100) : 0;

function Badge({children,tone="gray"}:{children:React.ReactNode;tone?:"gray"|"blue"|"green"|"red"|"amber"|"purple"}){
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}){
  return <label className={`field ${wide?"field-wide":""}`}><span>{label}</span>{children}</label>;
}
function Modal({title,onClose,children,wide=false,extraClass=""}:{title:string;onClose:()=>void;children:React.ReactNode;wide?:boolean;extraClass?:string}){
  return <div className="modal-backdrop" onMouseDown={onClose}><div className={`modal-card ${wide?"modal-wide":""} ${extraClass}`} onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><div><div className="eyebrow">DEMO</div><h2>{title}</h2></div><button className="icon-btn no-print" onClick={onClose}><X size={20}/></button></div>
    <div className="modal-body">{children}</div>
  </div></div>
}
function Empty({text}:{text:string}){ return <div className="empty"><FileText size={34}/><b>{text}</b><span>데모 데이터를 추가하거나 필터 조건을 변경해보세요.</span></div> }
function Progress({value}:{value:number}){ return <div className="progress"><div style={{width:`${Math.max(0,Math.min(100,value))}%`}}/></div> }
function toneForStatus(status:string){
  if(status.includes("종결(성공)")||status==="수임"||status==="진행중") return "green" as const;
  if(status.includes("거절")||status.includes("부적합")||status.includes("중단")) return "red" as const;
  if(status.includes("계약")||status.includes("서류")||status.includes("검토")||status.includes("고려")) return "amber" as const;
  if(status.includes("파산")) return "purple" as const;
  return "blue" as const;
}

export function DemoAdmin(){
  const [db,setDb] = useState<DemoDB>(seedDemoDB());
  const [ready,setReady] = useState(false);
  const [section,setSection] = useState<Section>("dashboard");
  const [mobileOpen,setMobileOpen] = useState(false);

  useEffect(()=>{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){ try{ setDb(JSON.parse(raw)); }catch{} }
    setReady(true);
  },[]);
  useEffect(()=>{ if(ready) localStorage.setItem(STORAGE_KEY,JSON.stringify(db)); },[db,ready]);

  const addHistory = (category:string, action:string, target:string, detail:string) => ({
    id:id("h"),createdAt:new Date().toISOString(),category,action,target,detail
  });
  const update = (producer:(d:DemoDB)=>DemoDB) => setDb(prev=>producer(prev));
  const resetDemo = () => { if(confirm("모든 데모 변경사항을 초기 샘플 데이터로 되돌릴까요?")){ setDb(seedDemoDB()); setSection("dashboard"); } };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`회생파산_admin_demo_v2_${today()}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const navigate=(s:Section)=>{setSection(s);setMobileOpen(false)};

  const unhandledLeads = db.leads.filter(l=>["신규접수","상담예정","부재중","재통화필요"].includes(l.status)).length;
  const dueToday = db.matters.filter(m=>m.nextActionAt && m.nextActionAt<=today() && !m.status.startsWith("종결")).length;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen?"open":""}`}>
      <div className="brand">
        <div className="brand-mark">D</div><div><b>회생·파산 Admin</b><span>FUNCTION DEMO V2</span></div>
        <button className="mobile-close" onClick={()=>setMobileOpen(false)}><X size={20}/></button>
      </div>
      <div className="demo-label"><span>DEMO MODE</span><small>실서버·실고객·실상호 연동 없음</small></div>
      <nav>{sections.map((s,idx)=>{const I=s.icon; const showGroup=s.group && sections[idx-1]?.group!==s.group; return <div key={s.id}>{showGroup&&<div className="nav-group">{s.group}</div>}<button onClick={()=>navigate(s.id)} className={section===s.id?"active":""}><I size={18}/><span>{s.label}</span>{s.id==="leads"&&unhandledLeads>0?<em>{unhandledLeads}</em>:s.id==="schedule"&&dueToday>0?<em>{dueToday}</em>:null}</button></div>})}</nav>
      <div className="sidebar-bottom">
        <button onClick={exportJson}><Download size={17}/>데모 데이터 내보내기</button>
        <button className="danger-soft" onClick={resetDemo}><RotateCcw size={17}/>데모 데이터 초기화</button>
      </div>
    </aside>
    {mobileOpen && <div className="mobile-overlay" onClick={()=>setMobileOpen(false)}/>}    
    <main className="main">
      <header className="topbar">
        <div className="topbar-left"><button className="menu-btn" onClick={()=>setMobileOpen(true)}><Menu size={21}/></button><div><strong>{sections.find(s=>s.id===section)?.label}</strong><span>개인회생·개인파산 상담·계약·서류·사건 통합관리</span></div></div>
        <div className="topbar-right"><button className="notification" onClick={()=>navigate("schedule")}><Bell size={18}/>{dueToday>0&&<i>{dueToday}</i>}</button><div className="user-chip"><span>DEMO</span><b>테스트 관리자</b></div></div>
      </header>
      <div className="page-wrap">
        {!ready ? <div className="loading">데모 데이터를 불러오는 중...</div> :
          section==="dashboard" ? <Dashboard db={db} navigate={navigate}/> :
          section==="leads" ? <Leads db={db} update={update} addHistory={addHistory}/> :
          section==="clients" ? <Clients db={db} update={update} addHistory={addHistory}/> :
          section==="pipeline" ? <Pipeline db={db} update={update} addHistory={addHistory}/> :
          section==="schedule" ? <Schedule db={db} update={update} addHistory={addHistory}/> :
          section==="contracts" ? <Contracts db={db} update={update} addHistory={addHistory}/> :
          section==="payments" ? <Payments db={db} update={update} addHistory={addHistory}/> :
          section==="documents" ? <Documents db={db} update={update} addHistory={addHistory}/> :
          section==="cases" ? <Cases db={db} update={update} addHistory={addHistory}/> :
          section==="analytics" ? <Analytics db={db}/> :
          section==="board" ? <Board db={db} update={update} addHistory={addHistory}/> :
          section==="calculator" ? <CalculatorPage db={db}/> :
          section==="settings" ? <SettingsPage db={db} update={update} addHistory={addHistory}/> :
          <HistoryPage db={db}/>
        }
      </div>
    </main>
  </div>
}

type UpdateFn=(producer:(d:DemoDB)=>DemoDB)=>void;
type HistoryFn=(category:string,action:string,target:string,detail:string)=>DemoDB["history"][number];

function getClient(db:DemoDB,matter:Pick<Matter,"clientId">){ return db.clients.find(c=>c.id===matter.clientId); }
function getMatterName(db:DemoDB,matterId:string){ const m=db.matters.find(x=>x.id===matterId); const c=m?getClient(db,m):undefined; return c?.name||"고객"; }
function matterDocProgress(db:DemoDB,matterId:string){ const ds=db.documents.filter(d=>d.matterId===matterId); const done=ds.filter(d=>d.status==="수령"||d.status==="해당없음").length; return {done,total:ds.length,pct:ds.length?pct(done,ds.length):0}; }

function Dashboard({db,navigate}:{db:DemoDB;navigate:(s:Section)=>void}){
  const leadCount=db.leads.length;
  const consulted=db.leads.filter(x=>!["신규접수","상담예정","부재중"].includes(x.status)).length;
  const signed=db.contracts.filter(c=>c.eSignStatus==="서명완료").length;
  const paid=db.payments.filter(p=>p.status==="완료").reduce((a,b)=>a+b.paidAmount,0);
  const contractAmount=db.contracts.reduce((a,b)=>a+b.contractAmount,0);
  const receivable=Math.max(0,contractAmount-paid);
  const consultRate=pct(consulted,leadCount);
  const contractRate=pct(signed,consulted);
  const contactSuccess=pct(db.leads.filter(l=>l.attempts>0&&l.status!=="부재중").length,leadCount);
  const todayActions=db.matters.filter(m=>m.nextActionAt && m.nextActionAt<=today() && !m.status.startsWith("종결")).sort((a,b)=>(a.nextActionAt||"").localeCompare(b.nextActionAt||"")).slice(0,6);
  const urgentDocs=db.matters.map(m=>({m,c:getClient(db,m),p:matterDocProgress(db,m.id)})).filter(x=>x.p.total&&x.p.pct<100).sort((a,b)=>a.p.pct-b.p.pct).slice(0,5);
  return <>
    <div className="page-title"><div><h1>업무 현황</h1><p>상담 CRM부터 회생 계산, 계약, 서류 수합, 사건 진행, 수납까지 한 화면에서 확인합니다.</p></div><Badge tone="purple">DEMO DATA</Badge></div>
    <div className="kpi-grid">
      <Kpi icon={<Inbox size={19}/>} label="전체 상담 DB" value={`${leadCount}건`} sub={`DB→상담 ${consultRate}%`} onClick={()=>navigate("leads")}/>
      <Kpi icon={<Users size={19}/>} label="진행 사건" value={`${db.matters.filter(m=>!["종결(성공)","종결(중단)","거절","부적합"].includes(m.status)).length}건`} sub={`수임 ${signed}건`} onClick={()=>navigate("clients")}/>
      <Kpi icon={<WalletCards size={19}/>} label="누적 실입금" value={shortMoney(paid)} sub={`미수 ${shortMoney(receivable)}`} onClick={()=>navigate("payments")}/>
      <Kpi icon={<CalendarClock size={19}/>} label="오늘/지연 액션" value={`${todayActions.length}건`} sub="재통화·서류·계약·기한" onClick={()=>navigate("schedule")}/>
    </div>
    <div className="dashboard-grid">
      <section className="panel span2">
        <div className="panel-head"><div><h3>상담 파이프라인</h3><p>기존 상담시트 상태값을 웹 파이프라인으로 통합</p></div><button className="text-btn" onClick={()=>navigate("pipeline")}>파이프라인 보기 <ChevronRight size={15}/></button></div>
        <div className="pipeline-row pipeline-wide">
          {pipelineColumns.map(x=><div className="pipeline-item" key={x}><span>{x}</span><b>{db.matters.filter(m=>m.status===x).length + db.leads.filter(l=>l.status===x&&!l.convertedMatterId).length}</b></div>)}
        </div>
        <div className="target-box"><div><b>DEMO KPI</b><span>업무매뉴얼의 관리지표를 기능 테스트용으로 표시</span></div><div className="target-values"><span>DB→상담 <b>{consultRate}%</b> / 기준 50%</span><span>상담→선임 <b>{contractRate}%</b> / 기준 20%</span><span>1차 연락 성공 <b>{contactSuccess}%</b> / 기준 70%</span></div></div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h3>오늘 할 일</h3><p>다음액션일 기준</p></div><ListTodo size={18}/></div>
        <div className="list-rows">{todayActions.length?todayActions.map(m=>{const c=getClient(db,m);return <button key={m.id} className="list-row" onClick={()=>navigate("schedule")}><div><b>{c?.name}</b><span>{m.nextActionType} · {m.status}</span></div><time className={m.nextActionAt!<today()?"late":""}>{m.nextActionAt}</time></button>}):<span className="muted">오늘 처리할 다음액션 없음</span>}</div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h3>서류 수합 주의</h3><p>계약 후 수합률이 낮은 사건</p></div><AlertTriangle size={18}/></div>
        <div className="list-rows">{urgentDocs.map(({m,c,p})=><button className="list-row doc-row" key={m.id} onClick={()=>navigate("documents")}><div><b>{c?.name}</b><span>{m.caseType} · {p.done}/{p.total} 완료</span><Progress value={p.pct}/></div><Badge tone={p.pct>=80?"green":p.pct>=40?"amber":"red"}>{p.pct}%</Badge></button>)}</div>
      </section>
      <section className="panel span2">
        <div className="panel-head"><div><h3>대시보드 상담 리스트</h3><p>기존 구글시트 핵심 컬럼을 웹 목록으로 재구성</p></div><button className="text-btn" onClick={()=>navigate("clients")}>상세관리 <ChevronRight size={15}/></button></div>
        <div className="table-scroll compact"><table><thead><tr><th>이름</th><th>사건유형</th><th>상태</th><th>다음액션</th><th>담당</th><th>월소득</th><th>월변제금(추정)</th><th>탕감률(추정)</th><th>상담판정</th></tr></thead><tbody>{db.matters.slice(0,8).map(m=>{const c=getClient(db,m); const cal=calculateMatter(db,m.id);return <tr key={m.id}><td><b>{c?.name}</b><small>{c?.phone}</small></td><td>{m.caseType}</td><td><Badge tone={toneForStatus(m.status)}>{m.status}</Badge></td><td>{m.nextActionAt||"-"}<small>{m.nextActionType||""}</small></td><td>{m.assignedTo}</td><td>{money(cal.totalIncome)}</td><td>{money(cal.finalMonthlyPayment)}</td><td>{cal.forgivenessRate.toFixed(1)}%</td><td>{cal.recommendation}</td></tr>})}</tbody></table></div>
      </section>
    </div>
  </>
}
function Kpi({icon,label,value,sub,onClick}:{icon:React.ReactNode;label:string;value:string;sub:string;onClick:()=>void}){return <button className="kpi-card" onClick={onClick}><div className="kpi-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></button>}

function Leads({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const [q,setQ]=useState(""); const [status,setStatus]=useState("전체"); const [modal,setModal]=useState(false);
  const blank={name:"",phone:"",source:"광고 DEMO",timeBand:"평오전",assignedTo:db.settings.staff[0]||"상담A",caseType:"미정" as CaseType,memo:"",nextActionAt:today()};
  const [form,setForm]=useState(blank);
  const rows=useMemo(()=>db.leads.filter(l=>(status==="전체"||l.status===status)&&(!q||`${l.name} ${l.phone} ${l.memo}`.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),[db.leads,q,status]);
  const save=()=>{
    if(!form.name||!form.phone)return alert("이름과 연락처를 입력하세요.");
    const dupPhone=db.clients.find(c=>c.phone===form.phone)||db.leads.find(l=>l.phone===form.phone);
    const dupName=db.clients.find(c=>c.name===form.name)||db.leads.find(l=>l.name===form.name);
    if((dupPhone||dupName)&&!confirm(`동일 ${dupPhone?"연락처":"이름"} 데이터가 존재합니다. 새 상담 DB로 추가할까요?`)) return;
    const lead:Lead={id:id("l"),createdAt:new Date().toISOString(),status:"신규접수",attempts:0,...form};
    update(d=>({...d,leads:[lead,...d.leads],history:[addHistory("신규 DB","등록",lead.name,"상담 DB 등록"),...d.history]}));
    setModal(false);setForm(blank)
  };
  const patch=(l:Lead,p:Partial<Lead>)=>update(d=>({...d,leads:d.leads.map(x=>x.id===l.id?{...x,...p}:x),history:[addHistory("신규 DB","수정",l.name,Object.entries(p).map(([k,v])=>`${k}:${v}`).join(", ")),...d.history]}));
  const convert=(l:Lead)=>{
    if(l.convertedMatterId) return alert("이미 고객/사건으로 전환된 DB입니다.");
    const existing=db.clients.find(c=>c.phone===l.phone);
    let clientId=existing?.id;
    if(existing && !confirm(`${existing.name} 고객과 동일 연락처입니다. 기존 고객에 새 상담사건을 추가할까요?\n취소를 누르면 전환을 중단합니다.`)) return;
    const newClient:Client|undefined=existing?undefined:{id:id("c"),createdAt:new Date().toISOString(),name:l.name,phone:l.phone,birthDate:"",gender:"",address:"",court:"",spouse:"",children:"",otherDependents:"",healthIssue:"",memo:""};
    clientId=clientId||newClient!.id;
    const matter:Matter={id:id("m"),clientId,createdAt:new Date().toISOString(),caseType:l.caseType,status:"상담완료",assignedTo:l.assignedTo,consultationDate:today(),nextActionAt:l.nextActionAt,nextActionType:"재통화",leadId:l.id,source:l.source,jobType:"",companyName:"",employmentInfo:"",monthlyIncome:0,secondaryIncome:0,pensionIncome:0,spouseIncome:0,householdSize:1,otherDeduction:0,repaymentMonths:db.settings.defaultRepaymentMonths,securedLoanArrears:false,specialIssue:"",memo:l.memo};
    update(d=>({...d,leads:d.leads.map(x=>x.id===l.id?{...x,status:"상담완료",convertedMatterId:matter.id}:x),clients:newClient?[newClient,...d.clients]:d.clients,matters:[matter,...d.matters],history:[addHistory("상담/고객 관리","등록",l.name,existing?"기존 고객에 새 상담사건 추가":"신규 고객·상담사건 전환"),...d.history]}));
    alert(existing?"기존 고객에 새 상담사건을 추가했습니다.":"고객과 상담사건을 생성했습니다.");
  };
  return <><PageHead title="신규 상담 DB" desc="기존 시트의 신규접수·부재·재통화·상담완료 상태와 누적 콜을 웹에서 관리합니다." action={<button className="primary" onClick={()=>setModal(true)}><Plus size={17}/>신규 상담 등록</button>}/>
    <div className="toolbar"><div className="search"><Search size={17}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="이름·연락처·메모 검색"/></div><select value={status} onChange={e=>setStatus(e.target.value)}><option>전체</option>{pipelineStatuses.map(s=><option key={s}>{s}</option>)}</select><span className="count">{rows.length}건</span></div>
    <div className="table-card"><div className="table-scroll"><table><thead><tr><th>접수일</th><th>상담자</th><th>사건유형</th><th>담당</th><th>상태</th><th>다음액션</th><th>콜</th><th>메모</th><th>상세전환</th></tr></thead><tbody>{rows.map(l=><tr key={l.id}><td>{fmtDate(l.createdAt)}</td><td><b>{l.name}</b><small>{l.phone}</small></td><td><select className="mini-select" value={l.caseType} onChange={e=>patch(l,{caseType:e.target.value as CaseType})}>{caseTypes.map(x=><option key={x}>{x}</option>)}</select></td><td>{l.assignedTo}</td><td><select className="mini-select" value={l.status} onChange={e=>patch(l,{status:e.target.value as PipelineStatus})}>{pipelineStatuses.map(x=><option key={x}>{x}</option>)}</select></td><td>{l.nextActionAt||"-"}</td><td><button className="attempt" disabled={l.attempts>=8} title={l.attempts>=8?"누적 재콜 상한 도달":"콜 시도 기록"} onClick={()=>patch(l,{attempts:Math.min(8,l.attempts+1),lastContactAt:new Date().toISOString(),status:l.attempts+1>=8&&!l.convertedMatterId?"부재중":l.status})}><PhoneCall size={14}/>{l.attempts}/8</button></td><td className="memo-cell">{l.memo||"-"}</td><td>{l.convertedMatterId?<Badge tone="green">전환완료</Badge>:<button className="small-btn" onClick={()=>convert(l)}>고객/사건 전환</button>}</td></tr>)}</tbody></table></div>{!rows.length&&<Empty text="검색 결과가 없습니다"/>}</div>
    {modal&&<Modal title="신규 상담 DB 등록" onClose={()=>setModal(false)}><div className="form-grid"><Field label="이름"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field><Field label="연락처"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="010-0000-0000"/></Field><Field label="사건 구분"><select value={form.caseType} onChange={e=>setForm({...form,caseType:e.target.value as CaseType})}>{caseTypes.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="담당"><select value={form.assignedTo} onChange={e=>setForm({...form,assignedTo:e.target.value})}>{db.settings.staff.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="유입 경로"><input value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></Field><Field label="신청 시간대"><select value={form.timeBand} onChange={e=>setForm({...form,timeBand:e.target.value})}>{["평오전","평점","평오후","퇴근후","주말오전","주말오후"].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="다음 액션일"><input type="date" value={form.nextActionAt} onChange={e=>setForm({...form,nextActionAt:e.target.value})}/></Field><Field label="메모" wide><textarea value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})}/></Field></div><ModalActions onCancel={()=>setModal(false)} onSave={save}/></Modal>}
  </>
}

function Clients({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const [q,setQ]=useState(""); const [selected,setSelected]=useState<string|null>(null); const [adding,setAdding]=useState(false);
  const rows=db.clients.filter(c=>!q||`${c.name} ${c.phone} ${c.address} ${c.memo}`.toLowerCase().includes(q.toLowerCase()));
  const addClient=()=>setAdding(true);
  const remove=(c:Client)=>{
    if(!confirm(`${c.name} 데모 고객을 삭제할까요? 해당 고객의 모든 DEMO 사건·계약·서류도 함께 삭제됩니다.`))return;
    const mids=db.matters.filter(m=>m.clientId===c.id).map(m=>m.id);
    const contractIds=db.contracts.filter(x=>mids.includes(x.matterId)).map(x=>x.id);
    update(d=>({...d,clients:d.clients.filter(x=>x.id!==c.id),matters:d.matters.filter(x=>x.clientId!==c.id),assets:d.assets.filter(x=>!mids.includes(x.matterId)),debts:d.debts.filter(x=>!mids.includes(x.matterId)),contracts:d.contracts.filter(x=>!mids.includes(x.matterId)),payments:d.payments.filter(x=>!contractIds.includes(x.contractId)),documents:d.documents.filter(x=>!mids.includes(x.matterId)),cases:d.cases.filter(x=>!mids.includes(x.matterId)),notes:d.notes.filter(x=>!mids.includes(x.matterId)),history:[addHistory("상담/고객 관리","삭제",c.name,"DEMO 고객 및 연계 사건 삭제"),...d.history]}));
  };
  return <><PageHead title="상담 / 고객 관리" desc="고객 1명에 여러 상담사건을 연결하고, 인적·소득·재산·채무·계산·상담내역을 통합 관리합니다." action={<button className="primary" onClick={addClient}><Plus size={17}/>고객 직접 등록</button>}/><div className="toolbar"><div className="search"><Search size={17}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="이름·연락처·주소 검색"/></div><span className="count">{rows.length}명</span></div>
    <div className="client-grid">{rows.map(c=>{const matters=db.matters.filter(m=>m.clientId===c.id); const latest=matters.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]; const calc=latest?calculateMatter(db,latest.id):null;return <article className="client-card" key={c.id}><div className="client-card-head"><div><h3>{c.name}</h3><span>{c.phone}</span></div>{latest?<Badge tone={latest.caseType==="개인파산"?"purple":"blue"}>{latest.caseType}</Badge>:<Badge>사건없음</Badge>}</div><div className="client-meta"><span><b>상담/사건</b>{matters.length}건</span><span><b>최신상태</b>{latest?.status||"-"}</span><span><b>월소득</b>{calc?money(calc.totalIncome):"-"}</span><span><b>예상변제</b>{calc?money(calc.finalMonthlyPayment):"-"}</span></div>{latest?.specialIssue&&<div className="warning-note"><AlertTriangle size={15}/>{latest.specialIssue}</div>}<div className="card-actions"><button onClick={()=>setSelected(c.id)}>상세 열기</button><button className="danger-link" onClick={()=>remove(c)}>삭제</button></div></article>})}</div>{!rows.length&&<Empty text="등록된 고객이 없습니다"/>}
    {selected&&<ClientDetail clientId={selected} db={db} update={update} addHistory={addHistory} onClose={()=>setSelected(null)}/>} 
    {adding&&<NewClientModal db={db} update={update} addHistory={addHistory} onClose={()=>setAdding(false)}/>} 
  </>
}

function NewClientModal({db,update,addHistory,onClose}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn;onClose:()=>void}){
  const [form,setForm]=useState({name:"",phone:"",caseType:"개인회생" as CaseType,assignedTo:db.settings.staff[0]||"상담A",address:"",source:"직접등록 DEMO"});
  const save=()=>{
    if(!form.name||!form.phone)return alert("이름과 연락처를 입력하세요.");
    const duplicate=db.clients.find(c=>c.phone===form.phone);
    if(duplicate)return alert("동일 연락처 고객이 이미 있습니다. 기존 고객 상세에서 '새 상담사건 추가'를 사용하세요.");
    const c:Client={id:id("c"),createdAt:new Date().toISOString(),name:form.name,phone:form.phone,birthDate:"",gender:"",address:form.address,court:"",spouse:"",children:"",otherDependents:"",healthIssue:"",memo:""};
    const m:Matter={id:id("m"),clientId:c.id,createdAt:new Date().toISOString(),caseType:form.caseType,status:"신규접수",assignedTo:form.assignedTo,source:form.source,jobType:"",companyName:"",employmentInfo:"",monthlyIncome:0,secondaryIncome:0,pensionIncome:0,spouseIncome:0,householdSize:1,otherDeduction:0,repaymentMonths:db.settings.defaultRepaymentMonths,securedLoanArrears:false,specialIssue:"",memo:""};
    update(d=>({...d,clients:[c,...d.clients],matters:[m,...d.matters],history:[addHistory("상담/고객 관리","등록",c.name,"고객·상담사건 직접 등록"),...d.history]}));onClose();
  };
  return <Modal title="고객 직접 등록" onClose={onClose}><div className="form-grid"><Field label="이름"><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field><Field label="연락처"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field><Field label="사건유형"><select value={form.caseType} onChange={e=>setForm({...form,caseType:e.target.value as CaseType})}>{caseTypes.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="담당"><select value={form.assignedTo} onChange={e=>setForm({...form,assignedTo:e.target.value})}>{db.settings.staff.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="거주지" wide><input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></Field></div><ModalActions onCancel={onClose} onSave={save}/></Modal>
}

const detailTabs=["요약","인적사항","소득","재산","채무","계산","상담내역","계약","서류","사건진행"] as const;
type DetailTab=typeof detailTabs[number];

function ClientDetail({clientId,db,update,addHistory,onClose}:{clientId:string;db:DemoDB;update:UpdateFn;addHistory:HistoryFn;onClose:()=>void}){
  const original=db.clients.find(c=>c.id===clientId)!;
  const matterOptions=db.matters.filter(m=>m.clientId===clientId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const [matterId,setMatterId]=useState(matterOptions[0]?.id||"");
  const matter=db.matters.find(m=>m.id===matterId);
  const [clientDraft,setClientDraft]=useState({...original});
  const [matterDraft,setMatterDraft]=useState<Matter|undefined>(matter?{...matter}:undefined);
  const [tab,setTab]=useState<DetailTab>("요약");
  const [addingMatter,setAddingMatter]=useState(false);
  useEffect(()=>{const m=db.matters.find(x=>x.id===matterId); setMatterDraft(m?{...m}:undefined)},[matterId,db.matters]);
  if(!matterDraft) return <Modal title={`${original.name} 상세`} onClose={onClose} wide><Empty text="상담사건이 없습니다"/></Modal>;
  const cal=calculateMatter({...db,clients:db.clients.map(c=>c.id===clientId?clientDraft:c),matters:db.matters.map(m=>m.id===matterDraft.id?matterDraft:m)},matterDraft.id);
  const docs=db.documents.filter(d=>d.matterId===matterDraft.id);
  const notes=db.notes.filter(n=>n.matterId===matterDraft.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const save=()=>{update(d=>({...d,clients:d.clients.map(c=>c.id===clientId?clientDraft:c),matters:d.matters.map(m=>m.id===matterDraft.id?matterDraft:m),history:[addHistory("상담/고객 관리","수정",clientDraft.name,`${matterDraft.caseType} 상담 상세 수정`),...d.history]}));alert("저장했습니다.")};
  const createMatter=(caseType:CaseType)=>{const m:Matter={id:id("m"),clientId,createdAt:new Date().toISOString(),caseType,status:"신규접수",assignedTo:db.settings.staff[0]||"상담A",source:"추가상담 DEMO",jobType:"",companyName:"",employmentInfo:"",monthlyIncome:0,secondaryIncome:0,pensionIncome:0,spouseIncome:0,householdSize:1,otherDeduction:0,repaymentMonths:db.settings.defaultRepaymentMonths,securedLoanArrears:false,specialIssue:"",memo:""};update(d=>({...d,matters:[m,...d.matters],history:[addHistory("상담/고객 관리","등록",clientDraft.name,`${caseType} 새 상담사건 추가`),...d.history]}));setMatterId(m.id);setAddingMatter(false)};
  const guide=guideByTab[tab]||guideByTab["상담내역"];
  return <Modal title={`${clientDraft.name} · 상담/사건 상세`} onClose={onClose} wide extraClass="client-detail-modal">
    <div className="detail-top no-print"><div className="matter-switch"><Field label="상담/사건 선택"><select value={matterId} onChange={e=>setMatterId(e.target.value)}>{matterOptions.map((m,i)=><option value={m.id} key={m.id}>{i===0?"최신 · ":""}{m.caseType} · {m.status} · {fmtDate(m.createdAt)}</option>)}</select></Field><button className="secondary" onClick={()=>setAddingMatter(v=>!v)}><CopyPlus size={16}/>새 상담사건</button></div><div className="detail-actions"><button className="secondary" onClick={()=>window.print()}><Printer size={16}/>상담카드 인쇄</button><button className="primary" onClick={save}><Save size={16}/>저장</button></div></div>
    {addingMatter&&<div className="inline-create no-print"><b>새 상담사건 유형</b>{caseTypes.filter(x=>x!=="미정").map(x=><button key={x} onClick={()=>createMatter(x)}>{x}</button>)}</div>}
    <div className="detail-tabs no-print">{detailTabs.map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t}</button>)}</div>
    <div className="detail-layout">
      <div className="detail-main">
        {tab==="요약"&&<SummaryTab db={db} client={clientDraft} matter={matterDraft} cal={cal}/>} 
        {tab==="인적사항"&&<PersonalTab client={clientDraft} setClient={setClientDraft} matter={matterDraft} setMatter={setMatterDraft}/>} 
        {tab==="소득"&&<IncomeTab matter={matterDraft} setMatter={setMatterDraft}/>} 
        {tab==="재산"&&<AssetsTab db={db} matter={matterDraft} update={update} addHistory={addHistory} clientName={clientDraft.name}/>} 
        {tab==="채무"&&<DebtsTab db={db} matter={matterDraft} update={update} addHistory={addHistory} clientName={clientDraft.name}/>} 
        {tab==="계산"&&<CalculationTab db={db} matter={matterDraft} cal={cal}/>} 
        {tab==="상담내역"&&<NotesTab db={db} matter={matterDraft} update={update} addHistory={addHistory} clientName={clientDraft.name}/>} 
        {tab==="계약"&&<MatterContractSummary db={db} matter={matterDraft}/>} 
        {tab==="서류"&&<MatterDocSummary db={db} matter={matterDraft}/>} 
        {tab==="사건진행"&&<MatterCaseSummary db={db} matter={matterDraft}/>} 
      </div>
      <aside className="guide-panel no-print"><div className="guide-title">💡 상담 가이드</div><b>{tab} 체크포인트</b><ol>{guide.map(x=><li key={x}>{x}</li>)}</ol><div className="guide-warning"><AlertTriangle size={15}/>자동계산·가이드는 DEMO 상담 참고용입니다. 최종 법률판단을 대신하지 않습니다.</div></aside>
    </div>
    <PrintConsultCard db={db} client={clientDraft} matter={matterDraft} cal={cal}/>
  </Modal>
}

function SummaryTab({db,client,matter,cal}:{db:DemoDB;client:Client;matter:Matter;cal:ReturnType<typeof calculateMatter>}){
  const docs=matterDocProgress(db,matter.id);const contract=db.contracts.find(c=>c.matterId===matter.id);const paid=db.payments.filter(p=>p.matterId===matter.id&&p.status==="완료").reduce((s,p)=>s+p.paidAmount,0);
  return <div className="summary-tab"><div className="summary-hero"><div><span>현재 상담</span><h3>{matter.caseType}</h3><Badge tone={toneForStatus(matter.status)}>{matter.status}</Badge></div><div><span>다음 액션</span><strong>{matter.nextActionAt||"미지정"}</strong><small>{matter.nextActionType||"-"}</small></div></div><div className="summary-cards"><span><b>월 총소득</b>{money(cal.totalIncome)}</span><span><b>신용채무</b>{money(cal.unsecuredDebt)}</span><span><b>청산가치</b>{money(cal.liquidationValue)}</span><span><b>예상 월변제</b>{money(cal.finalMonthlyPayment)}</span><span><b>예상 탕감률</b>{cal.forgivenessRate.toFixed(1)}%</span><span><b>서류수합</b>{docs.total?`${docs.pct}%`:"미생성"}</span><span><b>계약금액</b>{contract?money(contract.contractAmount):"미계약"}</span><span><b>실입금</b>{money(paid)}</span></div><div className="info-callout"><b>상담 참고 판정: {cal.recommendation}</b><span>법적 최종 확정치가 아닌 DEMO 자동계산 결과입니다.</span></div>{matter.specialIssue&&<div className="warning-note"><AlertTriangle size={15}/>{matter.specialIssue}</div>}<div className="memo-box"><b>상담 메모</b><p>{matter.memo||"메모 없음"}</p></div><div className="memo-box"><b>고객 기본 메모</b><p>{client.memo||"메모 없음"}</p></div></div>
}

function PersonalTab({client,setClient,matter,setMatter}:{client:Client;setClient:(c:Client)=>void;matter:Matter;setMatter:(m:Matter)=>void}){
  return <div className="form-grid form-grid-3"><Field label="이름"><input value={client.name} onChange={e=>setClient({...client,name:e.target.value})}/></Field><Field label="연락처"><input value={client.phone} onChange={e=>setClient({...client,phone:e.target.value})}/></Field><Field label="생년월일"><input type="date" value={client.birthDate} onChange={e=>setClient({...client,birthDate:e.target.value})}/></Field><Field label="성별"><input value={client.gender} onChange={e=>setClient({...client,gender:e.target.value})}/></Field><Field label="거주지(초본주소)"><input value={client.address} onChange={e=>setClient({...client,address:e.target.value})}/></Field><Field label="관할법원"><input value={client.court} onChange={e=>setClient({...client,court:e.target.value})}/></Field><Field label="배우자"><input value={client.spouse} onChange={e=>setClient({...client,spouse:e.target.value})}/></Field><Field label="자녀(인원/나이)"><input value={client.children} onChange={e=>setClient({...client,children:e.target.value})}/></Field><Field label="기타 부양가족"><input value={client.otherDependents} onChange={e=>setClient({...client,otherDependents:e.target.value})}/></Field><Field label="중대질환/장기요양" wide><input value={client.healthIssue} onChange={e=>setClient({...client,healthIssue:e.target.value})}/></Field><Field label="사건유형"><select value={matter.caseType} onChange={e=>setMatter({...matter,caseType:e.target.value as CaseType})}>{caseTypes.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="상담상태"><select value={matter.status} onChange={e=>setMatter({...matter,status:e.target.value as PipelineStatus})}>{pipelineStatuses.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="담당"><input value={matter.assignedTo} onChange={e=>setMatter({...matter,assignedTo:e.target.value})}/></Field><Field label="상담일자"><input type="date" value={matter.consultationDate||""} onChange={e=>setMatter({...matter,consultationDate:e.target.value})}/></Field><Field label="다음액션일"><input type="date" value={matter.nextActionAt||""} onChange={e=>setMatter({...matter,nextActionAt:e.target.value})}/></Field><Field label="다음액션 유형"><select value={matter.nextActionType||"기타"} onChange={e=>setMatter({...matter,nextActionType:e.target.value as ActionType})}>{actionTypes.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="에스컬레이션/특이사항" wide><input value={matter.specialIssue} onChange={e=>setMatter({...matter,specialIssue:e.target.value})} placeholder="담보대출 연체, 사기피해, 이중지위 등"/></Field><Field label="사건 메모" wide><textarea rows={4} value={matter.memo} onChange={e=>setMatter({...matter,memo:e.target.value})}/></Field></div>
}
function IncomeTab({matter,setMatter}:{matter:Matter;setMatter:(m:Matter)=>void}){
  const total=matter.monthlyIncome+matter.secondaryIncome+matter.pensionIncome;
  return <><div className="form-grid form-grid-3"><Field label="소득유형"><input value={matter.jobType} onChange={e=>setMatter({...matter,jobType:e.target.value})} placeholder="직장인/사업자/프리랜서/연금 등"/></Field><Field label="회사명/사업자명"><input value={matter.companyName} onChange={e=>setMatter({...matter,companyName:e.target.value})}/></Field><Field label="재직기간/사업장정보"><input value={matter.employmentInfo} onChange={e=>setMatter({...matter,employmentInfo:e.target.value})}/></Field><Field label="월평균소득(최근3개월)"><input type="number" value={matter.monthlyIncome} onChange={e=>setMatter({...matter,monthlyIncome:+e.target.value})}/></Field><Field label="2중소득(부업)"><input type="number" value={matter.secondaryIncome} onChange={e=>setMatter({...matter,secondaryIncome:+e.target.value})}/></Field><Field label="연금소득"><input type="number" value={matter.pensionIncome} onChange={e=>setMatter({...matter,pensionIncome:+e.target.value})}/></Field><Field label="배우자 월소득"><input type="number" value={matter.spouseIncome} onChange={e=>setMatter({...matter,spouseIncome:+e.target.value})}/></Field><Field label="가구원수"><input type="number" min={1} max={6} value={matter.householdSize} onChange={e=>setMatter({...matter,householdSize:+e.target.value})}/></Field><Field label="기타공제금"><input type="number" value={matter.otherDeduction} onChange={e=>setMatter({...matter,otherDeduction:+e.target.value})}/></Field></div><div className="auto-summary"><span><b>월 총소득(자동)</b>{money(total)}</span><span><b>연소득(자동)</b>{money(total*12)}</span></div></>
}

function AssetsTab({db,matter,update,addHistory,clientName}:{db:DemoDB;matter:Matter;update:UpdateFn;addHistory:HistoryFn;clientName:string}){
  const [form,setForm]=useState({type:"주택/토지" as AssetType,name:"",value:0,securedAmount:0,note:""});
  const [rentalRegion,setRentalRegion]=useState("");
  const rows=db.assets.filter(a=>a.matterId===matter.id);const add=()=>{if(!form.name)return alert("재산명을 입력하세요.");const a:Asset={id:id("a"),matterId:matter.id,...form};update(d=>({...d,assets:[...d.assets,a],history:[addHistory("재산현황","등록",clientName,`${a.type} ${money(a.value)}`),...d.history]}));setForm({type:"주택/토지",name:"",value:0,securedAmount:0,note:""})};
  const remove=(a:Asset)=>update(d=>({...d,assets:d.assets.filter(x=>x.id!==a.id),history:[addHistory("재산현황","삭제",clientName,a.name),...d.history]}));
  const rental=db.settings.rentalPrioritySamples.find(x=>x.region===rentalRegion);
  return <><div className="inline-grid"><select value={form.type} onChange={e=>setForm({...form,type:e.target.value as AssetType})}>{assetTypes.map(x=><option key={x}>{x}</option>)}</select><input placeholder="재산명/내용" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input type="number" placeholder="평가액" value={form.value||""} onChange={e=>setForm({...form,value:+e.target.value})}/><input type="number" placeholder="담보/대출액" value={form.securedAmount||""} onChange={e=>setForm({...form,securedAmount:+e.target.value})}/><input placeholder="비고" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/><button className="primary" onClick={add}><Plus size={15}/>추가</button></div><div className="mini-table"><table><thead><tr><th>유형</th><th>내용</th><th>평가액</th><th>담보액</th><th>순가치 참고</th><th>비고</th><th></th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td>{a.type}</td><td><b>{a.name}</b></td><td>{money(a.value)}</td><td>{money(a.securedAmount)}</td><td>{money(Math.max(0,a.value-a.securedAmount))}</td><td>{a.note||"-"}</td><td><button className="icon-btn danger-link" onClick={()=>remove(a)}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div><div className="calc-helper"><b>소액임차인 최우선변제 DEMO 조회</b><select value={rentalRegion} onChange={e=>setRentalRegion(e.target.value)}><option value="">임차 지역구분 선택</option>{db.settings.rentalPrioritySamples.map(x=><option key={x.region}>{x.region}</option>)}</select><span>{rental?`참고 가능액 ${money(rental.protectedAmount)}`:"지역을 선택하세요"}</span><small>기능 테스트용 예시 기준이며 실제 사건 적용값이 아닙니다.</small></div></>
}
function DebtsTab({db,matter,update,addHistory,clientName}:{db:DemoDB;matter:Matter;update:UpdateFn;addHistory:HistoryFn;clientName:string}){
  const [form,setForm]=useState({type:"신용채무" as DebtType,creditor:"",amount:0,securedAmount:0,note:""});
  const rows=db.debts.filter(a=>a.matterId===matter.id);const add=()=>{if(!form.creditor)return alert("채권자/내용을 입력하세요.");const a:Debt={id:id("de"),matterId:matter.id,...form};update(d=>({...d,debts:[...d.debts,a],history:[addHistory("채무현황","등록",clientName,`${a.type} ${money(a.amount)}`),...d.history]}));setForm({type:"신용채무",creditor:"",amount:0,securedAmount:0,note:""})};
  const remove=(a:Debt)=>update(d=>({...d,debts:d.debts.filter(x=>x.id!==a.id),history:[addHistory("채무현황","삭제",clientName,a.creditor),...d.history]}));
  const tax=rows.filter(x=>x.type==="세금체납"||x.type==="건강보험체납").reduce((s,x)=>s+x.amount,0);
  return <><div className="inline-grid"><select value={form.type} onChange={e=>setForm({...form,type:e.target.value as DebtType})}>{debtTypes.map(x=><option key={x}>{x}</option>)}</select><input placeholder="채권자/내용" value={form.creditor} onChange={e=>setForm({...form,creditor:e.target.value})}/><input type="number" placeholder="채무액" value={form.amount||""} onChange={e=>setForm({...form,amount:+e.target.value})}/><input type="number" placeholder="담보액" value={form.securedAmount||""} onChange={e=>setForm({...form,securedAmount:+e.target.value})}/><input placeholder="비고" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/><button className="primary" onClick={add}><Plus size={15}/>추가</button></div><div className="mini-table"><table><thead><tr><th>유형</th><th>채권자/내용</th><th>채무액</th><th>담보액</th><th>비고</th><th></th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td>{a.type}</td><td><b>{a.creditor}</b></td><td>{money(a.amount)}</td><td>{money(a.securedAmount)}</td><td>{a.note||"-"}</td><td><button className="icon-btn danger-link" onClick={()=>remove(a)}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div><div className="calc-helper"><b>세금·건보 50% 참고 계산</b><span>{money(tax)} × 50% = 약 {money(tax*.5)}</span><small>DEMO 참고도구이며 실제 우선변제 범위의 법률판단을 의미하지 않습니다.</small></div></>
}

function CalculationTab({db,matter,cal}:{db:DemoDB;matter:Matter;cal:ReturnType<typeof calculateMatter>}){
  return <div className="calc-page"><div className="disclaimer"><AlertTriangle size={16}/><b>상담용 추정 계산</b><span>최종 산정은 사건 자료와 담당 전문가 검토를 거쳐야 합니다.</span></div><div className="calc-grid"><CalcCard label="가구원수" value={`${matter.householdSize}명`}/><CalcCard label="최저생계비 (DEMO 기준)" value={money(cal.livelihood)}/><CalcCard label="월 총소득" value={money(cal.totalIncome)}/><CalcCard label="기타공제금" value={money(matter.otherDeduction)}/><CalcCard label="월 가용소득" value={money(cal.disposableIncome)}/><CalcCard label="변제개월수" value={`${matter.repaymentMonths}개월`}/><CalcCard label="가용소득 총변제액" value={money(cal.incomePlanTotal)}/><CalcCard label="청산가치" value={money(cal.liquidationValue)}/><CalcCard label="최종 월 변제금" value={money(cal.finalMonthlyPayment)} strong/><CalcCard label="최종 총변제예정액" value={money(cal.finalPlanTotal)} strong/><CalcCard label="기존 신용채무" value={money(cal.unsecuredDebt)}/><CalcCard label="탕감액" value={money(cal.forgivenessAmount)}/><CalcCard label="탕감률" value={`${cal.forgivenessRate.toFixed(1)}%`}/><CalcCard label="청산가치 보장" value={cal.liquidationSatisfied?"충족":"재검토 필요"}/><CalcCard label="진행가능여부(상담 참고)" value={cal.recommendation} strong/></div><div className="reference-note">현재 기준표: {db.settings.referenceYear} DEMO · 가구원수별 값은 [기준표 / 설정]에서 수정 가능</div></div>
}
function CalcCard({label,value,strong=false}:{label:string;value:string;strong?:boolean}){return <div className={`calc-card ${strong?"strong":""}`}><span>{label}</span><b>{value}</b></div>}

function NotesTab({db,matter,update,addHistory,clientName}:{db:DemoDB;matter:Matter;update:UpdateFn;addHistory:HistoryFn;clientName:string}){
  const [type,setType]=useState<"통화"|"문자"|"방문"|"검토"|"계약"|"서류"|"기타">("통화"); const [body,setBody]=useState("");
  const notes=db.notes.filter(n=>n.matterId===matter.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const add=()=>{if(!body.trim())return;const n={id:id("n"),matterId:matter.id,createdAt:new Date().toISOString(),author:matter.assignedTo,type,body};update(d=>({...d,notes:[n,...d.notes],history:[addHistory("상담내역","등록",clientName,`${type} 기록 추가`),...d.history]}));setBody("")};
  return <><div className="note-compose"><select value={type} onChange={e=>setType(e.target.value as typeof type)}>{["통화","문자","방문","검토","계약","서류","기타"].map(x=><option key={x}>{x}</option>)}</select><textarea rows={3} value={body} onChange={e=>setBody(e.target.value)} placeholder="상담/연락 내용을 시간순으로 기록하세요."/><button className="primary" onClick={add}><Plus size={15}/>기록 추가</button></div><div className="note-timeline">{notes.map(n=><article key={n.id}><i/><div><span>{new Date(n.createdAt).toLocaleString("ko-KR")} · {n.author} · {n.type}</span><p>{n.body}</p></div></article>)}</div></>
}
function MatterContractSummary({db,matter}:{db:DemoDB;matter:Matter}){const c=db.contracts.find(x=>x.matterId===matter.id); if(!c)return <Empty text="아직 등록된 계약이 없습니다"/>;const paid=db.payments.filter(x=>x.matterId===matter.id&&x.status==="완료").reduce((s,p)=>s+p.paidAmount,0);return <div className="summary-cards"><span><b>계약일</b>{c.contractDate}</span><span><b>수임료</b>{money(c.contractAmount)}</span><span><b>결제방식</b>{c.paymentMethod}</span><span><b>전자계약</b>{c.eSignStatus}</span><span><b>실입금</b>{money(paid)}</span><span><b>미수</b>{money(Math.max(0,c.contractAmount-paid))}</span></div>}
function MatterDocSummary({db,matter}:{db:DemoDB;matter:Matter}){const docs=db.documents.filter(x=>x.matterId===matter.id).sort((a,b)=>a.no-b.no);if(!docs.length)return <Empty text="계약 후 생성된 서류 체크리스트가 없습니다"/>;return <div className="docs-list embedded">{docs.map(doc=><div className="doc-item" key={doc.id}><div className="doc-no">{doc.no}</div><div className="doc-main"><b>{doc.title}</b><span>{doc.source} · {doc.condition}</span></div><Badge tone={doc.status==="수령"?"green":doc.status==="보완필요"?"red":doc.status==="요청"?"amber":"gray"}>{doc.status}</Badge><div className="doc-date">{doc.receivedAt||"-"}</div></div>)}</div>}
function MatterCaseSummary({db,matter}:{db:DemoDB;matter:Matter}){const c=db.cases.find(x=>x.matterId===matter.id);if(!c)return <Empty text="사건 진행 정보가 아직 없습니다"/>;return <div className="summary-cards"><span><b>현재단계</b>{c.currentStage}</span><span><b>법원</b>{c.court}</span><span><b>사건번호</b>{c.caseNumber||"미접수"}</span><span><b>다음기한</b>{c.nextDueAt||"-"}</span></div>}

function PrintConsultCard({db,client,matter,cal}:{db:DemoDB;client:Client;matter:Matter;cal:ReturnType<typeof calculateMatter>}){
  const assets=db.assets.filter(a=>a.matterId===matter.id);const debts=db.debts.filter(a=>a.matterId===matter.id);const notes=db.notes.filter(n=>n.matterId===matter.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  return <div className="print-card"><h1>개인회생·개인파산 상담일지 — DEMO</h1><div className="print-meta"><b>{client.name}</b><span>{client.phone}</span><span>{matter.caseType}</span><span>{matter.status}</span><span>{matter.assignedTo}</span></div><h2>1. 인적사항</h2><div className="print-grid"><span>생년월일: {client.birthDate||"-"}</span><span>거주지: {client.address||"-"}</span><span>관할법원: {client.court||"-"}</span><span>배우자: {client.spouse||"-"}</span><span>자녀: {client.children||"-"}</span><span>기타부양: {client.otherDependents||"-"}</span></div><h2>2. 소득현황</h2><div className="print-grid"><span>소득유형: {matter.jobType||"-"}</span><span>회사/사업: {matter.companyName||"-"}</span><span>월평균: {money(matter.monthlyIncome)}</span><span>부업: {money(matter.secondaryIncome)}</span><span>연금: {money(matter.pensionIncome)}</span><span>월 총소득: {money(cal.totalIncome)}</span></div><h2>3. 재산현황</h2><table><thead><tr><th>유형</th><th>내용</th><th>평가액</th><th>담보액</th></tr></thead><tbody>{assets.map(a=><tr key={a.id}><td>{a.type}</td><td>{a.name}</td><td>{money(a.value)}</td><td>{money(a.securedAmount)}</td></tr>)}</tbody></table><h2>4. 채무현황</h2><table><thead><tr><th>유형</th><th>채권자/내용</th><th>금액</th></tr></thead><tbody>{debts.map(a=><tr key={a.id}><td>{a.type}</td><td>{a.creditor}</td><td>{money(a.amount)}</td></tr>)}</tbody></table><h2>5. 변제계획 자동계산 (상담용 추정)</h2><div className="print-grid"><span>가구원: {matter.householdSize}명</span><span>최저생계비(DEMO): {money(cal.livelihood)}</span><span>월 가용소득: {money(cal.disposableIncome)}</span><span>청산가치: {money(cal.liquidationValue)}</span><span>예상 월변제: {money(cal.finalMonthlyPayment)}</span><span>예상 탕감률: {cal.forgivenessRate.toFixed(1)}%</span></div><h2>6. 상담내역</h2>{notes.slice(-8).map(n=><p key={n.id}><b>{fmtDate(n.createdAt)} {n.type}</b> — {n.body}</p>)}<footer>※ 본 출력물의 자동계산은 기능 테스트용 DEMO 추정치이며 최종 법률판단을 의미하지 않습니다.</footer></div>
}

function Pipeline({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const change=(m:Matter,status:PipelineStatus)=>{const c=getClient(db,m);update(d=>({...d,matters:d.matters.map(x=>x.id===m.id?{...x,status}:x),history:[addHistory("파이프라인","수정",c?.name||"고객",`${m.status} → ${status}`),...d.history]}))};
  return <><PageHead title="상담 파이프라인" desc="기존 대시보드 상태값을 칸반 형태로 확인하고 상태를 변경합니다."/><div className="kanban-scroll"><div className="kanban">{pipelineColumns.map(col=>{const rows=db.matters.filter(m=>m.status===col);return <section className="kanban-col" key={col}><header><b>{col}</b><span>{rows.length}</span></header><div>{rows.map(m=>{const c=getClient(db,m);const cal=calculateMatter(db,m.id);return <article className="kanban-card" key={m.id}><div><b>{c?.name}</b><Badge tone={m.caseType==="개인파산"?"purple":"blue"}>{m.caseType}</Badge></div><small>{m.assignedTo} · {m.nextActionAt||"다음액션 없음"}</small><p>{m.memo||"메모 없음"}</p><div className="kanban-metrics"><span>소득 {shortMoney(cal.totalIncome)}</span><span>변제 {shortMoney(cal.finalMonthlyPayment)}</span></div><select value={m.status} onChange={e=>change(m,e.target.value as PipelineStatus)}>{pipelineStatuses.map(s=><option key={s}>{s}</option>)}</select></article>})}{!rows.length&&<div className="kanban-empty">없음</div>}</div></section>})}</div></div></>
}

function Schedule({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const [range,setRange]=useState<"오늘/지연"|"7일"|"전체">("오늘/지연");
  const limit=new Date();limit.setDate(limit.getDate()+7);const limitStr=limit.toISOString().slice(0,10);
  const items=db.matters.filter(m=>m.nextActionAt).filter(m=>range==="전체" ? true : range==="오늘/지연" ? m.nextActionAt!<=today() : m.nextActionAt!<=limitStr).sort((a,b)=>mDate(a).localeCompare(mDate(b)));
  const clear=(m:Matter)=>{const c=getClient(db,m);update(d=>({...d,matters:d.matters.map(x=>x.id===m.id?{...x,nextActionAt:undefined,nextActionType:undefined}:x),history:[addHistory("오늘의 일정","수정",c?.name||"고객","다음액션 완료 처리"),...d.history]}))};
  return <><PageHead title="오늘의 일정" desc="상담예정·재통화·방문·계약회신·서류요청 등 다음액션을 날짜 기준으로 모아봅니다."/><div className="toolbar"><select value={range} onChange={e=>setRange(e.target.value as typeof range)}><option>오늘/지연</option><option>7일</option><option>전체</option></select><span className="count">{items.length}건</span></div><div className="schedule-list">{items.map(m=>{const c=getClient(db,m);return <article key={m.id} className={m.nextActionAt!<today()?"overdue":""}><div className="schedule-date"><b>{m.nextActionAt}</b><span>{m.nextActionAt!<today()?"지연":"예정"}</span></div><div className="schedule-main"><h3>{c?.name} <Badge tone={toneForStatus(m.status)}>{m.status}</Badge></h3><p>{m.nextActionType} · {m.caseType} · {m.assignedTo}</p><small>{m.memo||"메모 없음"}</small></div><button className="small-btn success" onClick={()=>clear(m)}><CheckCircle2 size={14}/>처리완료</button></article>})}{!items.length&&<Empty text="해당 일정이 없습니다"/>}</div></>
}
function mDate(m:Matter){return m.nextActionAt||"9999-12-31"}

function Contracts({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const [modal,setModal]=useState(false); const blank={matterId:"",contractAmount:0,paymentMethod:"계좌이체" as PaymentMethod,upfrontAmount:0,installmentCount:1,eSignStatus:"미발송" as Contract["eSignStatus"],financeNoticeDone:false,memo:""};const [form,setForm]=useState(blank);
  const save=()=>{const matter=db.matters.find(c=>c.id===form.matterId);if(!matter)return alert("상담사건을 선택하세요.");const c:Contract={id:id("ct"),contractDate:today(),...form};const newDocs=db.documents.some(d=>d.matterId===matter.id)?[]:defaultChecklist.map(x=>({id:id("doc"),matterId:matter.id,no:x[0],title:x[1],source:x[2],condition:x[3],status:"미수령" as DocStatus,note:""}));const caseExists=db.cases.some(x=>x.matterId===matter.id);const newCase:CaseProgress={id:id("case"),matterId:matter.id,currentStage:"수임완료",court:"미지정",caseNumber:"",nextDueAt:"",memo:"",updatedAt:new Date().toISOString()};const name=getMatterName(db,matter.id);update(d=>({...d,contracts:[c,...d.contracts],matters:d.matters.map(x=>x.id===matter.id?{...x,status:"수임"}:x),documents:[...newDocs,...d.documents],cases:caseExists?d.cases:[newCase,...d.cases],history:[addHistory("계약 관리","등록",name,`${money(c.contractAmount)} 계약 등록`),...d.history]}));setForm(blank);setModal(false)};
  const patch=(c:Contract,p:Partial<Contract>)=>update(d=>({...d,contracts:d.contracts.map(x=>x.id===c.id?{...x,...p}:x),history:[addHistory("계약 관리","수정",getMatterName(db,c.matterId),"계약정보 수정"),...d.history]}));
  return <><PageHead title="계약 관리" desc="상담사건별 전자계약 상태, 수임료, 결제방식과 필수 고지 여부를 관리합니다." action={<button className="primary" onClick={()=>setModal(true)}><Plus size={17}/>계약 등록</button>}/><div className="table-card"><div className="table-scroll"><table><thead><tr><th>계약일</th><th>고객</th><th>사건</th><th>수임료</th><th>결제방식</th><th>전자계약</th><th>금융고지</th><th>입금</th></tr></thead><tbody>{db.contracts.map(c=>{const m=db.matters.find(x=>x.id===c.matterId);const client=m?getClient(db,m):undefined;const paid=db.payments.filter(x=>x.contractId===c.id&&x.status==="완료").reduce((a,b)=>a+b.paidAmount,0);return <tr key={c.id}><td>{c.contractDate}</td><td><b>{client?.name||"-"}</b><small>{client?.phone}</small></td><td>{m?.caseType}</td><td><b>{money(c.contractAmount)}</b><small>선납 {money(c.upfrontAmount)}</small></td><td>{c.paymentMethod}</td><td><select className="mini-select" value={c.eSignStatus} onChange={e=>patch(c,{eSignStatus:e.target.value as Contract["eSignStatus"]})}>{["미발송","서명대기","서명완료","취소"].map(x=><option key={x}>{x}</option>)}</select></td><td><button className={`toggle ${c.financeNoticeDone?"on":""}`} onClick={()=>patch(c,{financeNoticeDone:!c.financeNoticeDone})}>{c.financeNoticeDone?"완료":"미완료"}</button></td><td>{money(paid)}<small>{pct(paid,c.contractAmount)}%</small></td></tr>})}</tbody></table></div></div>
    {modal&&<Modal title="계약 등록" onClose={()=>setModal(false)}><div className="form-grid"><Field label="상담사건"><select value={form.matterId} onChange={e=>setForm({...form,matterId:e.target.value})}><option value="">선택</option>{db.matters.filter(x=>!db.contracts.some(c=>c.matterId===x.id)).map(x=><option key={x.id} value={x.id}>{getMatterName(db,x.id)} · {x.caseType} · {x.status}</option>)}</select></Field><Field label="수임료"><input type="number" value={form.contractAmount} onChange={e=>setForm({...form,contractAmount:+e.target.value})}/></Field><Field label="결제 방식"><select value={form.paymentMethod} onChange={e=>setForm({...form,paymentMethod:e.target.value as PaymentMethod})}>{paymentMethods.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="선납금"><input type="number" value={form.upfrontAmount} onChange={e=>setForm({...form,upfrontAmount:+e.target.value})}/></Field><Field label="분납 횟수"><input type="number" min={1} value={form.installmentCount} onChange={e=>setForm({...form,installmentCount:+e.target.value})}/></Field><Field label="전자계약"><select value={form.eSignStatus} onChange={e=>setForm({...form,eSignStatus:e.target.value as Contract["eSignStatus"]})}>{["미발송","서명대기","서명완료"].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="금융상품 서면고지"><select value={form.financeNoticeDone?"완료":"미완료"} onChange={e=>setForm({...form,financeNoticeDone:e.target.value==="완료"})}><option>미완료</option><option>완료</option></select></Field><Field label="메모" wide><textarea value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})}/></Field></div><ModalActions onCancel={()=>setModal(false)} onSave={save}/></Modal>}
  </>
}

function Payments({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const [modal,setModal]=useState(false); const blank={contractId:"",dueDate:today(),amount:0,method:"계좌이체" as PaymentMethod,memo:""};const [form,setForm]=useState(blank);
  const totalDue=db.payments.reduce((a,b)=>a+b.amount,0), totalPaid=db.payments.filter(x=>x.status==="완료").reduce((a,b)=>a+b.paidAmount,0);
  const patch=(p:Payment,pp:Partial<Payment>)=>update(d=>({...d,payments:d.payments.map(x=>x.id===p.id?{...x,...pp}:x),history:[addHistory("입금/분납","수정",getMatterName(db,p.matterId),"납부 일정 수정"),...d.history]}));
  const complete=(p:Payment)=>patch(p,{status:"완료",paidAmount:p.amount,paidDate:today()});
  const save=()=>{const contract=db.contracts.find(c=>c.id===form.contractId);if(!contract)return alert("계약을 선택하세요.");const p:Payment={id:id("p"),matterId:contract.matterId,contractId:contract.id,dueDate:form.dueDate,amount:form.amount,paidAmount:0,status:"예정",method:form.method,memo:form.memo};update(d=>({...d,payments:[p,...d.payments],history:[addHistory("입금/분납","등록",getMatterName(db,contract.matterId),`${money(p.amount)} 납부일정 등록`),...d.history]}));setModal(false);setForm(blank)};
  return <><PageHead title="입금 / 분납" desc="계약별 납부예정, 완료, 연체 상태와 실제 입금액을 테스트합니다." action={<button className="primary" onClick={()=>setModal(true)}><Plus size={17}/>납부 일정 추가</button>}/><div className="summary-strip"><span><b>예정 총액</b>{money(totalDue)}</span><span><b>실입금</b>{money(totalPaid)}</span><span><b>미수</b>{money(Math.max(0,totalDue-totalPaid))}</span><span><b>수납률</b>{pct(totalPaid,totalDue)}%</span></div><div className="table-card"><div className="table-scroll"><table><thead><tr><th>납부일</th><th>고객</th><th>사건</th><th>금액</th><th>실입금</th><th>방식</th><th>상태</th><th>메모</th><th>작업</th></tr></thead><tbody>{db.payments.slice().sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(p=>{const m=db.matters.find(x=>x.id===p.matterId);const c=m?getClient(db,m):undefined;const autoOverdue=p.status==="예정"&&p.dueDate<today();return <tr key={p.id} className={autoOverdue?"overdue-row":""}><td>{p.dueDate}</td><td><b>{c?.name}</b></td><td>{m?.caseType}</td><td>{money(p.amount)}</td><td>{money(p.paidAmount)}</td><td>{p.method}</td><td><select className="mini-select" value={autoOverdue?"연체":p.status} onChange={e=>patch(p,{status:e.target.value as PaymentStatus})}>{["예정","완료","연체","취소"].map(x=><option key={x}>{x}</option>)}</select></td><td>{p.memo||"-"}</td><td>{p.status!=="완료"?<button className="small-btn success" onClick={()=>complete(p)}><CheckCircle2 size={14}/>입금완료</button>:<Badge tone="green">{p.paidDate}</Badge>}</td></tr>})}</tbody></table></div></div>
    {modal&&<Modal title="납부 일정 추가" onClose={()=>setModal(false)}><div className="form-grid"><Field label="계약"><select value={form.contractId} onChange={e=>setForm({...form,contractId:e.target.value})}><option value="">선택</option>{db.contracts.map(c=><option key={c.id} value={c.id}>{getMatterName(db,c.matterId)} · {money(c.contractAmount)}</option>)}</select></Field><Field label="납부예정일"><input type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})}/></Field><Field label="금액"><input type="number" value={form.amount} onChange={e=>setForm({...form,amount:+e.target.value})}/></Field><Field label="결제방식"><select value={form.method} onChange={e=>setForm({...form,method:e.target.value as PaymentMethod})}>{paymentMethods.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="메모" wide><input value={form.memo} onChange={e=>setForm({...form,memo:e.target.value})}/></Field></div><ModalActions onCancel={()=>setModal(false)} onSave={save}/></Modal>}
  </>
}

function Documents({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const matters=db.matters.filter(m=>db.documents.some(d=>d.matterId===m.id)); const [matterId,setMatterId]=useState(matters[0]?.id||""); const docs=db.documents.filter(d=>d.matterId===matterId).sort((a,b)=>a.no-b.no); const matter=db.matters.find(m=>m.id===matterId); const done=docs.filter(d=>d.status==="수령"||d.status==="해당없음").length; const progress=docs.length?pct(done,docs.length):0;
  useEffect(()=>{if(!matterId&&matters[0])setMatterId(matters[0].id)},[matterId,matters]);
  const patch=(docId:string,status:DocStatus)=>update(d=>({...d,documents:d.documents.map(x=>x.id===docId?{...x,status,requestedAt:status==="요청"?today():x.requestedAt,receivedAt:status==="수령"?today():x.receivedAt}:x),history:[addHistory("서류수합","수정",getMatterName(db,matterId),`서류 상태 → ${status}`),...d.history]}));
  const markRequested=()=>update(d=>({...d,documents:d.documents.map(x=>x.matterId===matterId&&x.status==="미수령"?{...x,status:"요청",requestedAt:today()}:x),history:[addHistory("서류수합","수정",getMatterName(db,matterId),"미수령 서류 일괄 요청 처리"),...d.history]}));
  return <><PageHead title="서류 수합" desc="고객별 15개 기본 서류 체크리스트를 수령·요청·보완·해당없음 상태로 관리합니다." action={<button className="secondary" onClick={markRequested}><Bell size={16}/>미수령 일괄 요청</button>}/><div className="document-top"><Field label="상담사건 선택"><select value={matterId} onChange={e=>setMatterId(e.target.value)}>{matters.map(m=><option key={m.id} value={m.id}>{getMatterName(db,m.id)} · {m.caseType}</option>)}</select></Field><div className="document-progress"><div><b>{matter?getMatterName(db,matter.id):"고객"} 서류수합</b><span>{done}/{docs.length} 완료</span></div><Progress value={progress}/><strong>{progress}%</strong></div></div>
    <div className="docs-list">{docs.map(doc=><div className="doc-item" key={doc.id}><div className="doc-no">{doc.no}</div><div className="doc-main"><b>{doc.title}</b><span>{doc.source} · {doc.condition}</span></div><select value={doc.status} onChange={e=>patch(doc.id,e.target.value as DocStatus)} className={`doc-status s-${doc.status}`}>{["미수령","요청","수령","보완필요","해당없음"].map(x=><option key={x}>{x}</option>)}</select><div className="doc-date">{doc.receivedAt||doc.requestedAt||"-"}</div></div>)}</div>{!docs.length&&<Empty text="계약 후 생성된 서류 체크리스트가 없습니다"/>}
  </>
}

const rehabilitationStages=["수임완료","서류수합","신청서작성","법원접수","보정","개시결정","채권자절차","인가결정","종결"];
const bankruptcyStages=["수임완료","서류수합","신청서작성","법원접수","보정/심문","파산선고","면책절차","면책결정","종결"];
function Cases({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const patch=(c:CaseProgress,p:Partial<CaseProgress>)=>{const m=db.matters.find(x=>x.id===c.matterId);const name=getMatterName(db,c.matterId);update(d=>({...d,cases:d.cases.map(x=>x.id===c.id?{...x,...p,updatedAt:new Date().toISOString()}:x),matters:p.currentStage==="종결"?d.matters.map(x=>x.id===c.matterId?{...x,status:"종결(성공)"}:x):d.matters,history:[addHistory("사건진행","수정",name,p.currentStage?`단계 → ${p.currentStage}`:"사건정보 수정"),...d.history]}))};
  return <><PageHead title="사건 진행" desc="계약 후 서류 수합부터 법원 단계와 다음 기한을 관리하는 데모 보드입니다."/><div className="case-board">{db.cases.map(c=>{const matter=db.matters.find(x=>x.id===c.matterId);const client=matter?getClient(db,matter):undefined;const stages=matter?.caseType==="개인파산"?bankruptcyStages:rehabilitationStages;const idx=Math.max(0,stages.indexOf(c.currentStage));return <article className="case-card" key={c.id}><div className="case-head"><div><h3>{client?.name}</h3><span>{matter?.caseType} · {matter?.assignedTo}</span></div><Badge tone={matter?.caseType==="개인파산"?"purple":"blue"}>{c.currentStage}</Badge></div><div className="stage-track">{stages.map((s,i)=><div key={s} className={i<=idx?"done":""} title={s}><i/><span>{s}</span></div>)}</div><div className="case-fields"><Field label="현재 단계"><select value={c.currentStage} onChange={e=>patch(c,{currentStage:e.target.value})}>{stages.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="관할 법원"><input value={c.court} onChange={e=>patch(c,{court:e.target.value})}/></Field><Field label="사건번호"><input value={c.caseNumber} onChange={e=>patch(c,{caseNumber:e.target.value})} placeholder="미접수 시 공란"/></Field><Field label="다음 기한"><input type="date" value={c.nextDueAt||""} onChange={e=>patch(c,{nextDueAt:e.target.value})}/></Field><Field label="진행 메모" wide><input value={c.memo} onChange={e=>patch(c,{memo:e.target.value})}/></Field></div></article>})}</div></>
}

function CalculatorPage({db}:{db:DemoDB}){
  const [matterId,setMatterId]=useState(db.matters[0]?.id||"");const matter=db.matters.find(x=>x.id===matterId);const cal=calculateMatter(db,matterId);
  return <><PageHead title="회생 예상계산기" desc="기존 상담시트의 가용소득·청산가치·예상 월변제·탕감률 계산을 웹으로 옮긴 DEMO 도구입니다."/><div className="document-top"><Field label="상담사건 선택"><select value={matterId} onChange={e=>setMatterId(e.target.value)}>{db.matters.map(m=><option key={m.id} value={m.id}>{getMatterName(db,m.id)} · {m.caseType}</option>)}</select></Field><div><Badge tone="amber">법적 최종 확정치 아님</Badge></div></div>{matter?<CalculationTab db={db} matter={matter} cal={cal}/>:<Empty text="상담사건이 없습니다"/>}</>
}

function SettingsPage({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){
  const [staffName,setStaffName]=useState("");
  const patchLivelihood=(key:string,value:number)=>update(d=>({...d,settings:{...d.settings,livelihoodByHousehold:{...d.settings.livelihoodByHousehold,[key]:value}},history:[addHistory("기준표/설정","수정","DEMO 기준표",`${key}인가구 기준금액 변경`),...d.history]}));
  const addStaff=()=>{if(!staffName.trim()||db.settings.staff.includes(staffName.trim()))return;update(d=>({...d,settings:{...d.settings,staff:[...d.settings.staff,staffName.trim()]},history:[addHistory("기준표/설정","등록",staffName.trim(),"담당자 옵션 추가"),...d.history]}));setStaffName("")};
  return <><PageHead title="기준표 / 설정" desc="매년 바뀔 수 있는 계산 기준을 코드에 고정하지 않고 DEMO 설정값으로 관리합니다."/><div className="settings-grid"><section className="panel"><h3>변제계산 기준표</h3><div className="form-grid"><Field label="기준 연도"><input type="number" value={db.settings.referenceYear} onChange={e=>update(d=>({...d,settings:{...d.settings,referenceYear:+e.target.value}}))}/></Field><Field label="기본 변제개월"><input type="number" value={db.settings.defaultRepaymentMonths} onChange={e=>update(d=>({...d,settings:{...d.settings,defaultRepaymentMonths:+e.target.value}}))}/></Field></div><div className="livelihood-table">{Object.entries(db.settings.livelihoodByHousehold).map(([k,v])=><label key={k}><span>{k}인 가구</span><input type="number" value={v} onChange={e=>patchLivelihood(k,+e.target.value)}/></label>)}</div><div className="reference-note">현재 값은 기능 테스트용 DEMO 기준값입니다. 실제 운영 시 조직이 확정한 최신 기준표로 교체하세요.</div></section><section className="panel"><h3>담당자 옵션</h3><div className="chip-list">{db.settings.staff.map(s=><span key={s}>{s}</span>)}</div><div className="inline-add"><input value={staffName} onChange={e=>setStaffName(e.target.value)} placeholder="담당자명"/><button className="primary" onClick={addStaff}><Plus size={15}/>추가</button></div><h3 className="subhead">소액임차 참고도구 DEMO</h3>{db.settings.rentalPrioritySamples.map(x=><div className="setting-row" key={x.region}><b>{x.region}</b><span>{money(x.protectedAmount)}</span><small>{x.note}</small></div>)}</section></div></>
}

function Analytics({db}:{db:DemoDB}){
  const leads=db.leads.length; const consulted=db.leads.filter(l=>!["신규접수","상담예정","부재중"].includes(l.status)).length; const signed=db.contracts.filter(c=>c.eSignStatus==="서명완료").length; const contact=db.leads.filter(l=>l.attempts>0&&l.status!=="부재중").length; const contractAmount=db.contracts.reduce((a,b)=>a+b.contractAmount,0); const paid=db.payments.filter(p=>p.status==="완료").reduce((a,b)=>a+b.paidAmount,0); const docsMatters=new Set(db.documents.map(d=>d.matterId)).size; const completedDocs=db.matters.filter(m=>{const ds=db.documents.filter(d=>d.matterId===m.id);return ds.length&&ds.every(d=>d.status==="수령"||d.status==="해당없음")}).length;
  const metrics=[["DB → 상담 전환율",pct(consulted,leads),50],["상담 → 선임 전환율",pct(signed,consulted),20],["1차 연락 성공률",pct(contact,leads),70],["서류수합 완료율",pct(completedDocs,docsMatters),80]] as const;
  const typeCounts=caseTypes.filter(x=>x!=="미정").map(s=>[s,db.matters.filter(m=>m.caseType===s).length] as const);
  return <><PageHead title="데이터 집계" desc="상담 퍼널·사건유형·매출·수금·서류수합 현황을 DEMO 데이터로 실시간 계산합니다."/><div className="analytics-grid"><section className="panel"><h3>핵심 KPI</h3><div className="metric-list">{metrics.map(([name,value,target])=><div className="metric" key={name}><div><b>{name}</b><span>현재 {value}% · DEMO 기준 {target}%</span></div><div className="metric-bar"><i style={{width:`${Math.min(100,value)}%`}}/><u style={{left:`${target}%`}}/></div></div>)}</div></section><section className="panel"><h3>재무 요약</h3><div className="finance-big"><span><b>계약 매출</b><strong>{money(contractAmount)}</strong></span><span><b>실입금</b><strong>{money(paid)}</strong></span><span><b>미수금</b><strong>{money(Math.max(0,contractAmount-paid))}</strong></span><span><b>수금률</b><strong>{pct(paid,contractAmount)}%</strong></span></div></section><section className="panel span2"><h3>사건유형 분포</h3><div className="bars">{typeCounts.map(([s,n])=><div key={s}><span>{s}</span><div><i style={{width:`${Math.max(3,n/Math.max(1,db.matters.length)*100)}%`}}/></div><b>{n}</b></div>)}</div></section></div></>
}

function HistoryPage({db}:{db:DemoDB}){const [q,setQ]=useState("");const rows=db.history.filter(h=>!q||`${h.category} ${h.target} ${h.detail}`.toLowerCase().includes(q.toLowerCase()));return <><PageHead title="기간별 변동내역" desc="DEMO에서 수행한 등록·수정·삭제 작업을 자동 기록합니다."/><div className="toolbar"><div className="search"><Search size={17}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="변동내역 검색"/></div><span className="count">{rows.length}건</span></div><div className="timeline">{rows.map(h=><div className="timeline-item" key={h.id}><div className="time-dot"/><div><span>{new Date(h.createdAt).toLocaleString("ko-KR")}</span><h4>{h.target} <Badge tone={h.action==="삭제"?"red":h.action==="등록"?"green":"blue"}>{h.action}</Badge></h4><p>{h.category} · {h.detail}</p></div></div>)}</div></>}

function Board({db,update,addHistory}:{db:DemoDB;update:UpdateFn;addHistory:HistoryFn}){const [modal,setModal]=useState(false);const [title,setTitle]=useState("");const [body,setBody]=useState("");const save=()=>{if(!title)return;const post={id:id("b"),createdAt:new Date().toISOString(),title,body,pinned:false};update(d=>({...d,board:[post,...d.board],history:[addHistory("내부게시판","등록",title,"게시글 작성"),...d.history]}));setModal(false);setTitle("");setBody("")};return <><PageHead title="내부 게시판" desc="DEMO 운영 공지와 업무 메모를 등록할 수 있습니다." action={<button className="primary" onClick={()=>setModal(true)}><Plus size={17}/>글쓰기</button>}/><div className="board-list">{db.board.slice().sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.createdAt.localeCompare(a.createdAt)).map(p=><article key={p.id}><div>{p.pinned&&<Badge tone="purple">공지</Badge>}<h3>{p.title}</h3><p>{p.body}</p></div><time>{fmtDate(p.createdAt)}</time></article>)}</div>{modal&&<Modal title="게시글 작성" onClose={()=>setModal(false)}><div className="form-grid"><Field label="제목" wide><input value={title} onChange={e=>setTitle(e.target.value)}/></Field><Field label="내용" wide><textarea rows={6} value={body} onChange={e=>setBody(e.target.value)}/></Field></div><ModalActions onCancel={()=>setModal(false)} onSave={save}/></Modal>}</>}

function PageHead({title,desc,action}:{title:string;desc:string;action?:React.ReactNode}){return <div className="page-title"><div><h1>{title}</h1><p>{desc}</p></div>{action}</div>}
function ModalActions({onCancel,onSave}:{onCancel:()=>void;onSave:()=>void}){return <div className="modal-actions"><button className="secondary" onClick={onCancel}>취소</button><button className="primary" onClick={onSave}><Save size={16}/>저장</button></div>}
