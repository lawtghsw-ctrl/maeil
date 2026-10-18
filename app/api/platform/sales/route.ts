import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser } from "@/lib/platform/server";
import { EDITABLE_SALES_STAGES, normalizeProposal, normalizeSalesLead, salesIdentity } from "@/lib/platform/sales";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
async function readBody(request: NextRequest): Promise<Record<string, any>> {
  const reader = request.body?.getReader(); if (!reader) throw Error("입력 내용을 확인해주세요.");
  let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 2_000_000) { await reader.cancel(); throw Error("파일을 200행 이하로 나눠 등록해주세요."); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const value = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(Buffer.concat(chunks)));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("입력 내용을 확인해주세요.");
  return value;
}
async function allRows(admin: Awaited<ReturnType<typeof requirePlatformUser>>["admin"], table:string, signal:AbortSignal) {
  const rows: Record<string, unknown>[] = []; let offset=0;
  for (;;) { const {data,error}=await admin.from(table).select("*").order("id").range(offset,offset+499).abortSignal(signal); if(error)throw Error("영업자료를 불러오지 못했습니다. 데이터베이스 연결을 확인해주세요."); if(!data?.length)return rows; rows.push(...data); offset+=data.length; if(offset>50_000)throw Error("조회 범위가 너무 큽니다. 조회 조건을 줄여주세요."); }
}
export async function GET(request:NextRequest) {
  try {const {admin}=await requirePlatformUser(request,["super_admin"]); const [leads,events]=await Promise.all([allRows(admin,"platform_sales_leads",request.signal),allRows(admin,"platform_sales_events",request.signal)]);return NextResponse.json({leads,events,esignReady:false,esignNotice:"로파워 DB 판매계약용 이폼사인 계정·템플릿 준비 후 연결합니다. 로펌 고객 수임계약 연결은 로펌 설정에서 관리합니다."},{headers});} catch(error){const e=platformError(error);return NextResponse.json({error:e.message},{status:e.status,headers});}
}
export async function POST(request:NextRequest) {
  try {
    const {admin,profile}=await requirePlatformUser(request,["super_admin"]);
    if(Number(request.headers.get("content-length")??0)>2_000_000)throw Error("파일을 200행 이하로 나눠 등록해주세요.");
    const body=await readBody(request);const action=String(body.action??""); const payload:Record<string,unknown>={};
    if(action==="import"||action==="create") {
      const values=action==="create"?[body.data]:body.rows;
      if(!Array.isArray(values)||!values.length||values.length>200)throw Error("한 번에 1~200개 로펌을 등록할 수 있습니다.");
      payload.rows=values.map((row:Record<string,unknown>)=>{if(!row||typeof row!=="object")throw Error("로펌 정보를 확인해주세요.");const data=normalizeSalesLead(row);return {data,identity:salesIdentity(data)};});
    } else {
      if(!uuid(body.id)||!Number.isSafeInteger(body.revision)||body.revision<1)throw Error("최신 영업자료를 다시 조회해주세요.");
      payload.id=body.id;payload.revision=body.revision;
      if(action==="update") {const data=normalizeSalesLead(body.data??{});if(!EDITABLE_SALES_STAGES.includes(body.stage))throw Error("계약서 발송·서명완료는 전자서명 결과로만 변경할 수 있습니다.");if(body.stage==="실패"&&!data.lostReason)throw Error("실패 사유를 입력해주세요.");payload.data=data;payload.identity=salesIdentity(data);payload.stage=body.stage;}
      else if(action==="proposal") payload.proposal=normalizeProposal(body.proposal??{});
      else if(action==="activity"||action==="meeting") {
        const data=body.data??{};if(!uuid(body.requestId))throw Error("기록 요청 ID를 확인해주세요.");payload.requestId=body.requestId;
        const at=String(data.at??new Date().toISOString());if(!Number.isFinite(Date.parse(at)))throw Error("일시를 확인해주세요.");
        if(action==="activity"&&!['전화','문자','이메일','미팅','메모'].includes(data.type))throw Error("기록 종류를 확인해주세요.");
        const note=String(data.note??"").trim().slice(0,5000);if(!note)throw Error("기록 내용을 입력해주세요.");
        const nextAt=String(data.nextAt??"");if(nextAt&&!Number.isFinite(Date.parse(nextAt)))throw Error("다음 업무 기한을 확인해주세요.");
        payload.data={type:action==="meeting"?"미팅":data.type,at,note,nextTask:String(data.nextTask??"").slice(0,1000),nextAt,location:String(data.location??"").slice(0,300),attendees:String(data.attendees??"").slice(0,500),status:['예정','완료','취소'].includes(data.status)?data.status:'예정'};
      } else throw Error("지원하지 않는 영업 작업입니다.");
    }
    const {data,error}=await admin.rpc("platform_sales_mutate",{p_actor_id:profile.id,p_actor_name:profile.display_name||profile.staff_name||"운영자",p_action:action,p_payload:payload});
    if(error)throw Error(error.message.includes("REVISION_CONFLICT")?"다른 관리자가 수정했습니다. 새로고침 후 다시 확인해주세요.":error.message.includes("IDENTITY_CONFLICT")?"동일한 사업자번호·전화·홈페이지로 등록된 다른 로펌이 있습니다.":"영업자료 저장에 실패했습니다. 입력은 유지됩니다.");
    return NextResponse.json({ok:true,...data},{headers});
  }catch(error){const e=platformError(error);return NextResponse.json({error:e.message},{status:e.status,headers});}
}
