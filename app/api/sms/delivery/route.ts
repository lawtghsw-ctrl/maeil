import { NextRequest, NextResponse } from "next/server";
import { assertRelayReady, assertRpc, CAPABILITIES, DeliveryGate, fail, gateView, isDemoFirm, readGate, readJson, readLiveConfiguration, requireSmsActor, requireUuid, smsErrorResponse } from "@/lib/sms/delivery";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
const headers = { "Cache-Control": "private, no-store" };
async function view(actor: Awaited<ReturnType<typeof requireSmsActor>>, gate: DeliveryGate | null) {
  const demo = await isDemoFirm(actor.admin,actor.firmId);
  let globalReady = false;
  let disabledReason = demo ? "TEST 로펌은 시연용이므로 실제 문자 발송이 제한됩니다." : "";
  if (!demo) { try { const configuration=await assertRelayReady(); globalReady = true;
    if(gate && gate.relay_epoch!==configuration.epoch) {globalReady=false;disabledReason="문자 연결이 변경되었습니다. 발송을 껐다가 다시 활성화해주세요.";}
  } catch { disabledReason = "문자 발송 연결이 준비되지 않았습니다."; } }
  // Stored switches must remain visible during an outage so a stop is possible.
  return { gate: gateView(gate,gate?.relay_epoch || null), capabilities: CAPABILITIES, globalReady, disabledReason, serverTime: new Date().toISOString(), canManageGate: actor.canManage && !demo };
}
export async function GET(request: NextRequest) {
  try {
    const actor = await requireSmsActor(request,request.nextUrl.searchParams.get("lawFirmId"),"sms.view");
    return NextResponse.json(await view(actor,await readGate(actor.admin,actor.firmId)),{headers});
  } catch (error) { const failure=smsErrorResponse(error); return NextResponse.json({error:failure.error},{status:failure.status,headers}); }
}
export async function PATCH(request: NextRequest) {
  try {
    if (!request.headers.get("authorization")?.startsWith("Bearer ")) fail(401,"로그인이 필요합니다.");
    const body=await readJson(request,["lawFirmId","expectedEpochId","liveEnabled","autoEnabled","acknowledgeNewOnly"],4096);
    const actor=await requireSmsActor(request,body.lawFirmId,"sms.manage_settings");
    if (!actor.canManage) fail(403,"문자 활성 상태를 관리할 권한이 없습니다.");
    if (await isDemoFirm(actor.admin,actor.firmId)) fail(403,"TEST 로펌에서는 실제 문자를 활성화할 수 없습니다.");
    if (typeof body.liveEnabled!=="boolean" || typeof body.autoEnabled!=="boolean" || body.acknowledgeNewOnly!==true) fail(400,"신규 문자만 처리하는 활성화 조건을 확인해주세요.");
    const expected=body.expectedEpochId===null?null:requireUuid(body.expectedEpochId,"현재 활성 상태");
    const previous=await readGate(actor.admin,actor.firmId);
    let epoch:string;
    if (body.liveEnabled || body.autoEnabled) epoch=(await assertRelayReady()).epoch;
    else {
      // A stop operation must still work when the relay or global transport is unavailable.
      if (!previous) return NextResponse.json(await view(actor,null),{headers});
      epoch=previous.relay_epoch;
      try { epoch=readLiveConfiguration().epoch; } catch { /* retain the existing epoch while stopping */ }
    }
    const {data,error}=await actor.admin.rpc("sms_delivery_set_gate",{p_actor_id:actor.actorId,p_law_firm_id:actor.firmId,p_expected_epoch_id:expected,p_manual_enabled:body.liveEnabled,p_auto_enabled:body.autoEnabled,p_relay_epoch:epoch});
    assertRpc(error);
    const gate=(Array.isArray(data)?data[0]:data) as DeliveryGate|undefined;
    if (!gate) fail(503,"활성화 결과를 확인할 수 없습니다. 새로고침해주세요.");
    return NextResponse.json(await view(actor,gate),{headers});
  } catch(error) {const failure=smsErrorResponse(error);return NextResponse.json({error:failure.error},{status:failure.status,headers});}
}
