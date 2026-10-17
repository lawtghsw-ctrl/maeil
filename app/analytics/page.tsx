"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { BarChart3, FileSpreadsheet } from "lucide-react";
import { useStore } from "@/lib/store";
import { isManagerProfile } from "@/lib/management-analytics";
import type { LawyerDraftState } from "@/lib/performance/lawyers";

const loading = () => <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">성과 화면을 불러오는 중입니다.</div>;
const PlatformPerformance = dynamic(() => import("@/components/analytics/PlatformPerformance"), { loading });
const FirmPerformance = dynamic(() => import("@/components/analytics/FirmPerformance"), { loading });
const LegacyAnalytics = dynamic(() => import("@/components/analytics/LegacyAnalytics"), { loading });

export default function AnalyticsPage() {
  const { profile } = useStore();
  if (!isManagerProfile(profile)) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">성과 데이터집계는 로펌관리자와 슈퍼관리자만 조회할 수 있습니다.</div>;
  return <AnalyticsWorkspace key={`${profile?.id}:${profile?.platformRole}:${profile?.lawFirmId}`}/>;
}

function AnalyticsWorkspace() {
  const { profile, superAdminFirmScope, firmDirectory } = useStore();
  const lawyerDraftCache = useRef(new Map<string, LawyerDraftState>());
  const [view, setView] = useState<"performance" | "detail">("performance");
  const globalSuper = profile?.platformRole === "super_admin" && !superAdminFirmScope;
  const firmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const firmName = superAdminFirmScope?.name ?? firmDirectory.find(firm => firm.id === firmId)?.name ?? "현재 로펌";
  useEffect(() => setView("performance"), [firmId, profile?.platformRole]);
  if (!isManagerProfile(profile)) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">성과 데이터집계는 로펌관리자와 슈퍼관리자만 조회할 수 있습니다.</div>;
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-3" role="tablist" aria-label="데이터집계 화면"><button type="button" role="tab" aria-selected={view==="performance"} onClick={()=>setView("performance")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${view==="performance"?"bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200":"text-slate-500 hover:bg-white"}`}><BarChart3 size={14}/>{globalSuper?"로펌 성과":"직원 · 변호사 성과"}</button><button type="button" role="tab" aria-selected={view==="detail"} onClick={()=>setView("detail")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${view==="detail"?"bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200":"text-slate-500 hover:bg-white"}`}><FileSpreadsheet size={14}/>상담 · 광고 · 원장</button></div>
    {view==="detail"?<LegacyAnalytics/>:globalSuper?<PlatformPerformance onDetailedAnalysis={()=>setView("detail")}/>:firmId?<FirmPerformance key={firmId} firmId={firmId} firmName={firmName} lawyerDraftCache={lawyerDraftCache.current}/>:<div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">성과를 조회할 로펌을 선택해주세요.</div>}
  </div>;
}
