import type { Metadata } from "next";
import "./globals.css";
import { Sidebar, MobileTabBar } from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "로파워 · LawPower Admin",
  description: "회생/파산 사건관리 어드민 — 로피(LawFee) 디자인 시스템 참고 제작",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <div className="flex min-h-screen bg-bg">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col pb-14 lg:pb-0">
            <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
              {children}
            </main>
          </div>
        </div>
        <MobileTabBar />
      </body>
    </html>
  );
}
