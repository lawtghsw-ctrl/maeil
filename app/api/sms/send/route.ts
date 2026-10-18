import { NextRequest,NextResponse } from "next/server";
import { APPROVED_SENDERS,assertRelayReady,assertRpc,fail,isDemoFirm,MOBILE,readJson,requireSmsActor,requireUuid,smsErrorResponse } from "@/lib/sms/delivery";
import { imagePaths,loadImages } from "@/lib/sms/media";
import { countEucKrBytes,validateMessage } from "@/services/sms-relay/src/validation.mjs";
import { renderSmsTemplate } from "@/lib/sms/template-variables";

export const dynamic="force-dynamic";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:NextRequest){
  try{
    if(!request.headers.get("authorization")?.startsWith("Bearer "))fail(401,"로그인이 필요합니다.");
    const body=await readJson(request,["lawFirmId","epochId","requestId","senderNumberId","recipients","message","title","imagePaths","reservedAt"]);
    const actor=await requireSmsActor(request,body.lawFirmId,"sms.send");
    if(await isDemoFirm(actor.admin,actor.firmId))fail(403,"TEST 로펌은 시연용이므로 실제 문자를 발송할 수 없습니다.");
    const requestId=requireUuid(body.requestId,"요청 번호"),epochId=requireUuid(body.epochId,"활성 상태"),senderId=requireUuid(body.senderNumberId,"발신번호");
    if(!Array.isArray(body.recipients)||!body.recipients.length||body.recipients.length>1000)fail(400,"수신자는 1명 이상 1,000명 이하로 입력해주세요.");
    const numbers=new Set<string>();
    const recipients=body.recipients.map(item=>{
      if(!item||typeof item!=="object"||Array.isArray(item)||Object.keys(item).some(key=>!["phone","name","consultTime"].includes(key)))fail(400,"수신자 형식을 확인해주세요.");
      const value=item as Record<string,unknown>;
      if(typeof value.phone!=="string" || (value.name!==undefined&&typeof value.name!=="string"))fail(400,"수신자 형식을 확인해주세요.");
      const phone=value.phone.replace(/\D/g,""); const name=String(value.name||"").trim();
      if(!MOBILE.test(phone)||name.length>100||/[\x00-\x1f\x7f]/.test(name))fail(400,"수신번호와 고객명을 확인해주세요.");
      if(value.consultTime!==undefined&&(typeof value.consultTime!=="string"||value.consultTime.length>200||/[\x00-\x1f\x7f]/.test(value.consultTime)))fail(400,"상담 신청 시간대를 확인해주세요.");
      if(numbers.has(phone))fail(400,"수신번호가 중복되었습니다.");numbers.add(phone);return {phone,name,...(typeof value.consultTime==="string"?{consultTime:value.consultTime}:{})};
    });
    if(typeof body.message!=="string"||!body.message.trim()||body.message.length>2000)fail(400,"문구는 1자 이상 2,000자 이하로 입력해주세요.");
    const title=body.title==null?"":body.title;
    if(typeof title!=="string")fail(400,"문자 제목을 확인해주세요.");
    const paths=imagePaths(body.imagePaths??[],actor.firmId);
    const {data:sender,error:senderError}=await actor.admin.from("sms_sender_numbers").select("id,phone,staff_name").eq("id",senderId).eq("law_firm_id",actor.firmId).eq("is_active",true).eq("is_registered",true).maybeSingle();
    if(senderError||!sender||!APPROVED_SENDERS.has(sender.phone))fail(400,"활성 상태이며 알리고에 등록된 발신번호를 선택해주세요.");
    let longest=0;
    try{
      for(const recipient of recipients){const rendered=renderSmsTemplate(body.message,recipient,String(sender.staff_name||"담당자"));
        const bytes=countEucKrBytes(rendered);longest=Math.max(longest,bytes);const type=paths.length?"MMS":bytes>90?"LMS":"SMS";validateMessage(rendered,type,type==="SMS"?"":title);}
    }catch{fail(400,"치환 후 문구는 최대 2,000바이트, 제목은 44바이트입니다. 지원하지 않는 이모지·문자가 있는지도 확인해주세요.");}
    const msgType=paths.length?"MMS":longest>90?"LMS":"SMS";
    let reservedAt:string|null=null;
    if(body.reservedAt!=null&&body.reservedAt!==""){
      if(typeof body.reservedAt!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(body.reservedAt)||!Number.isFinite(Date.parse(body.reservedAt)))fail(400,"예약 시간을 확인해주세요.");
      reservedAt=new Date(body.reservedAt).toISOString();
    }
    const {data:previous,error:previousError}=await actor.admin.from("sms_delivery_jobs").select("id,relay_epoch").eq("law_firm_id",actor.firmId).eq("request_id",requestId).limit(1);
    if(previousError)fail(503,"새 문자 발송 대기열을 준비 중입니다.");
    const reused=!!previous?.length;
    let relayEpoch:string;
    if(reused)relayEpoch=previous![0].relay_epoch;
    else{
      relayEpoch=(await assertRelayReady()).epoch;
      if(reservedAt&&Date.parse(reservedAt)<Date.now()+10*60_000)fail(400,"예약 시간은 현재 시각보다 10분 이상 뒤여야 합니다.");
      if(paths.length)await loadImages(actor.admin,paths,actor.firmId);
    }
    const {data:jobs,error}=await actor.admin.rpc("sms_delivery_enqueue",{p_actor_id:actor.actorId,p_law_firm_id:actor.firmId,p_epoch_id:epochId,p_relay_epoch:relayEpoch,p_request_id:requestId,p_sender_number_id:senderId,p_recipients:recipients,p_message:body.message,p_title:msgType==="SMS"?"":title,p_image_paths:paths,p_reserved_at:reservedAt,p_source:"manual",p_msg_type:msgType});
    assertRpc(error);
    if(!Array.isArray(jobs)||!jobs.length)fail(503,"접수 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.");
    return NextResponse.json({ok:true,batchId:requestId,createdCount:jobs.length,reused,status:reservedAt?"scheduled":"queued"},{headers});
  }catch(error){const failure=smsErrorResponse(error);return NextResponse.json({error:failure.error},{status:failure.status,headers});}
}
