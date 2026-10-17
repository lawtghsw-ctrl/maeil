"use client";
import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
export default function AligoTestPage(){
  const {profile,superAdminFirmScope}=useStore();
  const lawFirmId=profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const [sender,setSender]=useState("01026492494");
  const [receiver,setReceiver]=useState("");
  const [result,setResult]=useState("");
  const [busy,setBusy]=useState(false);
  async function test(){setBusy(true);setResult("확인 중...");try{
    const r=await fetch("/api/aligo/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sender,receiver,lawFirmId})});
    const j=await r.json();setResult(j.ok?`테스트 성공 · 실제 문자 발송 없음 (Aligo ${j.providerCode})`:`테스트 실패 · ${j.error||j.providerMessage||r.status}`);
  }catch{setResult("네트워크 오류");}finally{setBusy(false);}}
  return <div className="mx-auto max-w-xl space-y-4 p-6"><Link href="/sms" className="text-sm text-blue-600">← 문자발송</Link><h1 className="text-2xl font-bold">알리고 API 안전 테스트</h1><p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">테스트 전용입니다. API 호출에 항상 testmode_yn=Y를 넣으므로 실제 문자가 발송되지 않습니다. 기존 DB 및 자동발송 대기열을 사용하지 않습니다.</p><label className="block text-sm">발신번호<select className="mt-1 w-full rounded border p-2" value={sender} onChange={e=>setSender(e.target.value)}><option value="01026492494">박형원 · 010-2649-2494</option><option value="01096191379">강훈 · 010-9619-1379</option><option value="01059156310">강이삭 · 010-5915-6310</option></select></label><label className="block text-sm">테스트 수신번호<input className="mt-1 w-full rounded border p-2" placeholder="010-0000-0000" value={receiver} onChange={e=>setReceiver(e.target.value)}/></label><button disabled={busy||!receiver} onClick={()=>void test()} className="rounded bg-blue-700 px-5 py-2 text-white disabled:opacity-40">{busy?"API 확인 중":"실발송 없는 테스트 실행"}</button><p role="status" className="text-sm">{result}</p></div>;
}
