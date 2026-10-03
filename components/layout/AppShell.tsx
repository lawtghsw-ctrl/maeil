"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Building2, ChevronLeft, Eye, ShieldCheck } from "lucide-react";
import { AppStoreProvider, useStore } from "@/lib/store";
import { permissionForPath } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { authJson } from "@/lib/platform/client";

function ProtectedApp({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, can, profile, superAdminFirmScope, exitSuperAdminFirmScope } = useStore();
  const role = profile?.platformRole ?? "staff";
  const rule = permissionForPath(pathname);
  const permissionAllowed = !rule || (rule.adminOnly ? isAdmin : !rule.permission || can(rule.permission));
  const superAdminScoped = role === "super_admin" && !!superAdminFirmScope;
  const platformAllowed = role === "super_admin"
    ? (superAdminScoped || pathname === "/platform" || pathname.startsWith("/platform/") || pathname === "/firm/settings" || pathname === "/account")
    : !(pathname === "/platform" || pathname.startsWith("/platform/"));
  const firmSettingsAllowed = pathname !== "/firm/settings" || role === "firm_admin" || role === "super_admin";
  const allowed = permissionAllowed && platformAllowed && firmSettingsAllowed;

  useEffect(() => {
    if (!profile || role === "super_admin") return;
    let cancelled = false;
    const flush = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        await authJson("/api/integrations/meta/flush", { method: "POST", body: JSON.stringify({ limit: 20 }) });
      } catch {
        // Queue state/logs retain the failure; normal page usage must not be interrupted.
      }
    };
    const first = window.setTimeout(() => void flush(), 4000);
    const timer = window.setInterval(() => void flush(), 5 * 60 * 1000);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [profile, role]);

  async function leaveFirmView() {
    const firmId = superAdminFirmScope?.id;
    if (firmId) {
      try { await authJson("/api/platform/firm-view", { method: "POST", body: JSON.stringify({ lawFirmId: firmId, action: "exit" }) }); } catch {}
    }
    exitSuperAdminFirmScope();
    router.push("/platform");
    router.refresh();
  }

  return (
    <>
      <Sidebar />
      <div className="min-h-screen lg:pl-[248px]">
        <Header />
        {superAdminScoped && superAdminFirmScope && pathname !== "/platform" && !pathname.startsWith("/platform/") && (
          <div className="border-b border-blue-200 bg-blue-50 px-3 py-2.5 sm:px-4 lg:px-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-white"><Eye size={16} /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-black text-blue-900">
                    <span className="inline-flex items-center gap-1"><ShieldCheck size={13}/> SUPER ADMIN</span>
                    <span className="text-blue-300">·</span>
                    <span className="truncate">{superAdminFirmScope.name} 어드민 직접 관리 중</span>
                    <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-blue-700">{superAdminFirmScope.firmCode}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-blue-700">이 상태에서는 해당 로펌의 DB·계약·정산·직원권한·설정을 최상위 권한으로 직접 조회/수정합니다.</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => router.push(`/platform/firms/${superAdminFirmScope.id}`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"><Building2 size={13}/> 로펌 상세</button>
                <button type="button" onClick={leaveFirmView} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white hover:bg-blue-800"><ChevronLeft size={13}/> 플랫폼으로 복귀</button>
              </div>
            </div>
          </div>
        )}
        <main className="min-w-0 max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-7">
          {allowed ? children : (
            <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="text-lg font-black text-slate-900">접근 권한이 없습니다.</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {role === "super_admin" && !superAdminFirmScope
                  ? "로파워 플랫폼에서 관리할 로펌의 ‘어드민 보기’를 먼저 선택해주세요."
                  : "현재 계정의 로파워/로펌 역할 또는 세부 권한으로는 이 메뉴를 사용할 수 없습니다."}
              </p>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/join") return <>{children}</>;
  return <AppStoreProvider><ProtectedApp>{children}</ProtectedApp></AppStoreProvider>;
}
