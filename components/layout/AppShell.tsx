"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppStoreProvider, useStore } from "@/lib/store";
import { permissionForPath } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { authJson } from "@/lib/platform/client";

function ProtectedApp({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, can, profile } = useStore();
  const role = profile?.platformRole ?? "staff";
  const rule = permissionForPath(pathname);
  const permissionAllowed = !rule || (rule.adminOnly ? isAdmin : !rule.permission || can(rule.permission));
  const platformAllowed = role === "super_admin"
    ? (pathname === "/platform" || pathname.startsWith("/platform/") || pathname === "/firm/settings" || pathname === "/account")
    : !(pathname === "/platform" || pathname.startsWith("/platform/"));
  const firmSettingsAllowed = pathname !== "/firm/settings" || role === "firm_admin" || role === "super_admin";
  const allowed = permissionAllowed && platformAllowed && firmSettingsAllowed;

  // While a firm user is actively using LawPower, process due Meta feedback jobs every 5 minutes.
  // Database claim locking prevents duplicate sends when several staff browsers are open.
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

  return (
    <>
      <Sidebar />
      <div className="min-h-screen lg:pl-[248px]">
        <Header />
        <main className="min-w-0 max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-7">
          {allowed ? children : (
            <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="text-lg font-black text-slate-900">접근 권한이 없습니다.</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">현재 계정의 로파워/로펌 역할 또는 세부 권한으로는 이 메뉴를 사용할 수 없습니다.</p>
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
