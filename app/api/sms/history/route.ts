import {NextRequest,NextResponse} from "next/server";
import {fail,requireSmsActor,smsErrorResponse} from "@/lib/sms/delivery";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:NextRequest){
 try{
  const actor=await requireSmsActor(request,request.nextUrl.searchParams.get("lawFirmId"),"sms.view_history");
  const {data:rows,error}=await actor.admin.from("sms_outbox").select("id,law_firm_id,source,auto_kind,receiver_name,receiver_number,sender_number,message,msg_type,status,created_at,reserved_at,provider_message_id,error_message").eq("law_firm_id",actor.firmId).order("created_at",{ascending:false}).limit(300);
  if(error)fail(503,"문자 내역을 읽지 못했습니다.");
  const ids=(rows||[]).map(row=>row.id);
  const result=ids.length?await actor.admin.from("sms_delivery_jobs").select("outbox_id,status,delivery_state,error_code,provider_message_id").eq("law_firm_id",actor.firmId).in("outbox_id",ids):{data:[],error:null};
  if(result.error)fail(503,"새 문자 발송 내역을 준비 중입니다.");
  const jobs=new Map((result.data||[]).map(row=>[row.outbox_id,row]));
  const items=(rows||[]).map(row=>{const job=jobs.get(row.id);return{id:row.id,recordKind:job?"delivery":"legacy",receiverName:row.receiver_name,receiverNumber:row.receiver_number,senderNumber:row.sender_number,message:row.message,msgType:row.msg_type,status:job?(job.status==="accepted"&&["delivered","failed","unknown"].includes(job.delivery_state)?`delivery_${job.delivery_state}`:job.status):row.status,source:row.source,autoKind:row.auto_kind,createdAt:row.created_at,reservedAt:row.reserved_at,providerMessageId:job?.provider_message_id||row.provider_message_id,errorMessage:job?.error_code||row.error_message};});
  return NextResponse.json({items},{headers});
 }catch(error){const failure=smsErrorResponse(error);return NextResponse.json({error:failure.error},{status:failure.status,headers});}
}
