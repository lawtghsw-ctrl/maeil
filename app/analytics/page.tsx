"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { BarChart3, FileSpreadsheet } from "lucide-react";
import { useStoreSession as useStore } from "@/lib/store";
import { isManagerProfile } from "@/lib/management-analytics";
import type { LawyerDraftState } from "@/lib/performance/lawyers";
import { authJson } from "@/lib/platform/client";

const loading = () => <div role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">성과 화면을 불러오는 중입니다.</div>;
const PortfolioPerformance = dynamic(() => import("@/components/analytics/PortfolioPerformance"), { loading });
const FirmPerformance = dynamic(() => import("@/components/analytics/FirmPerformance"), { loading });
const LegacyAnalytics = dynamic(() => import("@/components/analytics/LegacyAnalytics"), { loading });

export default function AnalyticsPage() {
  const { profile } = useStore();
  if (!isManagerProfile(profile)) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">성과 데이터집계는 로펌관리자와 슈퍼관리자만 조회할 수 있습니다.</div>;
  return <AnalyticsWorkspace key={`${profile?.id}:${profile?.platformRole}:${profile?.lawFirmId}`}/>;
}

function AnalyticsWorkspace() {
  const { profile, superAdminFirmScope, firmDirectory, enterSuperAdminFirmScope } = useStore();
  const lawyerDraftCache = useRef(new Map<string, LawyerDraftState>());
  const [view, setView] = useState<"performance" | "detail">("detail");
  const [scopeError, setScopeError] = useState<string | null>(null);
  const scopeRequest = useRef(0);
  const globalSuper = profile?.platformRole === "super_admin" && !superAdminFirmScope;
  const firmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const firmName = superAdminFirmScope?.name ?? firmDirectory.find(firm => firm.id === firmId)?.name ?? "현재 로펌";
  useEffect(() => { setView("detail"); setScopeError(null); scopeRequest.current++; }, [firmId, profile?.platformRole]);
  useEffect(() => () => { scopeRequest.current++; }, []);
  async function openFirm(id: string) {
    const sequence = ++scopeRequest.current;
    setScopeError(null);
    const cached = firmDirectory.find(row => row.id === id);
    if (cached) { enterSuperAdminFirmScope(cached); return; }
    try {
      const { firm } = await authJson<{ firm: { id: string; firm_code: string; name: string; status: string } }>(`/api/platform/firms/${encodeURIComponent(id)}`);
      if (sequence !== scopeRequest.current) return;
      if (firm.id !== id || !["active", "suspended"].includes(firm.status)) throw new Error("로펌 정보를 확인하지 못했습니다.");
      enterSuperAdminFirmScope({ id: firm.id, firmCode: firm.firm_code, name: firm.name, status: firm.status as "active" | "suspended" });
    } catch (reason) { if (sequence === scopeRequest.current) setScopeError(reason instanceof Error ? reason.message : "로펌 상세 화면을 열지 못했습니다."); }
  }
  if (!isManagerProfile(profile)) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">성과 데이터집계는 로펌관리자와 슈퍼관리자만 조회할 수 있습니다.</div>;
  return <div className="space-y-5">
    {!globalSuper && <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-3" role="tablist" aria-label="데이터집계 화면"><button type="button" role="tab" aria-selected={view==="performance"} onClick={()=>setView("performance")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${view==="performance"?"bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200":"text-slate-500 hover:bg-white"}`}><BarChart3 size={14}/>{globalSuper?"로펌 성과":"직원 · 변호사 성과"}</button><button type="button" role="tab" aria-selected={view==="detail"} onClick={()=>setView("detail")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${view==="detail"?"bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200":"text-slate-500 hover:bg-white"}`}><FileSpreadsheet size={14}/>로펌 데이터집계 · 6개 탭</button></div>}
    {scopeError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{scopeError}</p>}
    {globalSuper?<PortfolioPerformance onOpenFirm={id=>void openFirm(id)}/>:view==="detail"?<LegacyAnalytics/>:firmId?<FirmPerformance key={firmId} firmId={firmId} firmName={firmName} lawyerDraftCache={lawyerDraftCache.current}/>:<div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">성과를 조회할 로펌을 선택해주세요.</div>}
  </div>;
}
