import "./globals.css";

export const metadata = {
  title: "로파워 Admin Demo",
  description: "회생·파산 중심 로펌 업무·결제 통합 Admin 기능 데모",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
