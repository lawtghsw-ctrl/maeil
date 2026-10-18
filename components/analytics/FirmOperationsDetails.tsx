"use client";
import { useMemo } from "react";
import type { DbLead, CaseRecord } from "@/lib/types";
import { isValidRetainer, ratioLabel, structuredContacts } from "@/lib/firm-reporting";
import { Card } from "@/components/ui/Primitives";
import { InfoHelp } from "@/components/ui/InfoHelp";

export function FirmOperationsDetails({ leads, cases }: { leads: DbLead[]; cases: CaseRecord[] }) {
  const data = useMemo(() => {
    const retained = new Set(cases.filter(isValidRetainer).map(row => row.fromLeadId).filter(Boolean));
    const reasons = new Map<string, number>();
    const buckets = [{ label: "0회", db: 0, retained: 0 }, { label: "1–2회", db: 0, retained: 0 }, { label: "3–4회", db: 0, retained: 0 }, { label: "5회 이상", db: 0, retained: 0 }];
    let known = 0, complete = 0, recontact = 0, reconnected = 0;
    for (const lead of leads) {
      if (!lead.convertedClientId && ["거절", "부적합", "종결_중단"].includes(lead.status)) {
        const reason = lead.invalidReason || lead.nonContractReason || "사유 미입력";
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      if (String(lead.name||"").trim() && String(lead.phone||"").trim() && lead.assignedStaff && lead.source && (!["거절", "부적합", "종결_중단"].includes(lead.status) || lead.invalidReason || lead.nonContractReason)) complete++;
      const contacts = structuredContacts(lead);
      if (!contacts) continue;
      known++;
      const bucket = buckets[contacts.length === 0 ? 0 : contacts.length <= 2 ? 1 : contacts.length <= 4 ? 2 : 3];
      bucket.db++; if (retained.has(lead.id)) bucket.retained++;
      const calls = contacts.filter(row => row.type === "phone").sort((a,b)=>a.at.localeCompare(b.at));
      if (calls.length > 1 && calls[0].connected === false) { recontact++; if (calls.slice(1).some(row => row.connected === true)) reconnected++; }
    }
    return { reasons: [...reasons].sort((a,b)=>b[1]-a[1]), buckets, known, complete, recontact, reconnected };
  }, [leads, cases]);
  return <div className="grid gap-4 xl:grid-cols-2">
    <Card className="p-5"><h3 className="text-sm font-black">미수임 · 불가 사유</h3><div className="mt-3 space-y-2">{data.reasons.map(([reason,count])=><div key={reason} className="flex justify-between text-sm"><span>{reason}</span><b>{count}건</b></div>)}{!data.reasons.length&&<p className="text-sm text-slate-500">선택 기간 종료 DB가 없습니다.</p>}</div></Card>
    <Card className="p-5"><h3 className="text-sm font-black">컨택 횟수별 수임 전환</h3><InfoHelp className="mt-1" summary={`컨택 기록 ${data.known}/${leads.length}건`}>접수일 기준 DB의 구조화 컨택 기록만 집계합니다. 과거 미기록은 제외하고 분모 30건 미만은 회색 참고값으로 표시합니다.</InfoHelp><div className="mt-3 space-y-2">{data.buckets.map(row=><div key={row.label} className={`flex justify-between text-sm ${row.db<30?"text-slate-400":""}`}><span>{row.label}</span><b>{ratioLabel(row.retained,row.db)}</b></div>)}</div></Card>
    <Card className="p-5"><h3 className="text-sm font-black">재접촉 연결</h3><p className={`mt-3 font-black ${data.recontact<30?"text-slate-400":""}`}>{ratioLabel(data.reconnected,data.recontact)}</p><InfoHelp className="mt-1" summary="재통화 DB 중 연결 비율">첫 전화 미연결 후 두 번째 이상 전화한 DB 중 이후 연결 기록이 있는 비율입니다.</InfoHelp></Card>
    <Card className="p-5"><h3 className="text-sm font-black">입력 완결성</h3><p className={`mt-3 font-black ${leads.length<30?"text-slate-400":""}`}>{ratioLabel(data.complete,leads.length)}</p><InfoHelp className="mt-1" summary="기본 정보 · 종료 사유 기준">이름·연락처·담당자·유입경로, 종료 DB의 선택 사유 기준입니다. 신입 적응기간은 입사일 자료가 없어 자동 추정하지 않습니다.</InfoHelp></Card>
  </div>;
}
