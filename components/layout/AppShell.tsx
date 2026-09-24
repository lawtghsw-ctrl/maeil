"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppStoreProvider } from "@/lib/store";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <AppStoreProvider>
      <Sidebar />
      <div className="min-h-screen lg:pl-[248px]">
        <Header />
        <main className="min-w-0 max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-7">{children}</main>
      </div>
    </AppStoreProvider>
  );
}
