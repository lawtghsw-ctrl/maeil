import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const permittedSenders: Record<string,string> = {
  "01026492494":"박형원",
  "01096191379":"강훈",
  "01059156310":"강이삭",
};
function digits(v:unknown) { return String(v??"").replace(/\D/g,""); }

export async function POST(req: NextRequest) {
  // FAIL CLOSED: this route *never* supports live sends, bulk recipients or queue processing.
  if(process.env.ALIGO_TEST_MODE !== "true") return NextResponse.json({error:"테스트 모드가 비활성화되어 있습니다."},{status:403});
  const supabase = await createClient();
  const {data:{user},error:authError} = await supabase.auth.getUser();
  if(authError || !user) return NextResponse.json({error:"로그인이 필요합니다."},{status:401});
  const {data:profile,error:profileError} = await supabase.from("profiles")
    .select("is_active,platform_role,role,permissions,law_firm_id").eq("id",user.id).maybeSingle();
  if(profileError || !profile || !profile.is_active) return NextResponse.json({error:"사용자 확인 실패"},{status:403});
  const p=profile as {platform_role?:string;role?:string;permissions?:Record<string,boolean>;law_firm_id?:string};
  const allowed=p.platform_role==="super_admin" || p.role==="admin" || p.role==="firm_admin" || p.permissions?.["sms.manage_settings"] === true;
  if(!allowed) return NextResponse.json({error:"문자 설정 권한이 없습니다."},{status:403});
  let body:{sender?:unknown;receiver?:unknown;lawFirmId?:unknown}|null=null;
  try {body=await req.json();}catch{return NextResponse.json({error:"JSON 요청이 필요합니다."},{status:400});}
  const sender=digits(body?.sender),receiver=digits(body?.receiver);
  if(!permittedSenders[sender] || !/^01[016789]\d{7,8}$/.test(receiver)) return NextResponse.json({error:"승인된 발신번호와 올바른 단일 수신번호만 사용할 수 있습니다."},{status:400});
  // 슈퍼어드민은 프로필에 로펌 ID가 없을 수 있으므로 화면에서 선택한 로펌을 사용합니다.
  // 일반 로펌 관리자는 브라우저가 전달한 로펌 ID를 신뢰하지 않고 자기 로펌만 조회합니다.
  const requestedFirmId = typeof body?.lawFirmId === "string" ? body.lawFirmId.trim() : "";
  const firmId = p.platform_role === "super_admin" ? requestedFirmId : (p.law_firm_id ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firmId)) {
    return NextResponse.json({error:"문자발송 대상 로펌을 먼저 선택해주세요."},{status:400});
  }
  const {data:registered,error:senderError}=await supabase.from("sms_sender_numbers").select("id,staff_name")
    .eq("law_firm_id",firmId).eq("phone",sender).eq("is_active",true).eq("is_registered",true).maybeSingle();
  if (senderError) return NextResponse.json({error:`발신번호 조회 오류: ${senderError.message}`},{status:403});
  if (!registered || registered.staff_name.trim() !== permittedSenders[sender]) return NextResponse.json({error:"선택한 로펌에서 이 담당자 발신번호를 찾지 못했습니다. 로펌 선택 상태를 확인해주세요."},{status:403});
  const key=process.env.ALIGO_API_KEY,userId=process.env.ALIGO_USER_ID;
  if(!key || !userId) return NextResponse.json({error:"알리고 환경변수가 없습니다."},{status:503});
  const form=new URLSearchParams({key,user_id:userId,sender,receiver,msg:"[로파워] API 연결 테스트입니다. 실제 발송되지 않습니다.",testmode_yn:"Y"});
  try {
    const response=await fetch("https://apis.aligo.in/send/",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form.toString(),cache:"no-store",signal:AbortSignal.timeout(12000)});
    const data=await response.json() as {result_code?:number;message?:string;msg_id?:number|string};
    const ok=response.ok && Number(data.result_code)>0;
    return NextResponse.json({ok,testMode:true,actualDelivery:false,providerCode:data.result_code??null,providerMessage:data.message??"",messageId:data.msg_id??null},{status:ok?200:502});
  }catch{return NextResponse.json({error:"알리고 연결에 실패했습니다.",actualDelivery:false},{status:502});}
}
