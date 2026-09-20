import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { AppStoreProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "로파워 · LawPower Admin",
  description: "회생/파산 사건관리 어드민 — 도원 Admin과 동일한 디자인 시스템으로 제작",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppStoreProvider>
          <Sidebar />
          <div className="min-h-screen lg:pl-[248px]">
            <Header />
            <main className="min-w-0 max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-7">{children}</main>
          </div>
        </AppStoreProvider>
      </body>
    </html>
  );
}
