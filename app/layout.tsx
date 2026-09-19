import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "회생·파산 업무관리 DEMO",
  description: "개인회생·개인파산 업무관리 기능 테스트용 데모"
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko"><body>{children}</body></html>;
}
