"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppStoreProvider, useStore } from "@/lib/store";
import { permissionForPath } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

function ProtectedApp({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, can } = useStore();
  const rule = permissionForPath(pathname);
  const allowed = !rule || (rule.adminOnly ? isAdmin : !rule.permission || can(rule.permission));

  return (
    <>
      <Sidebar />
      <div className="min-h-screen lg:pl-[248px]">
        <Header />
        <main className="min-w-0 max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-7">
          {allowed ? (
            children
          ) : (
            <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <div className="text-lg font-black text-slate-900">접근 권한이 없습니다.</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                이 메뉴는 현재 계정에 허용되지 않았습니다. 최종관리자에게 직원계정 권한을 요청해주세요.
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

  if (pathname === "/login") return <>{children}</>;

  return (
    <AppStoreProvider>
      <ProtectedApp>{children}</ProtectedApp>
    </AppStoreProvider>
  );
}
