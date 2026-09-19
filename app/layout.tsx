import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"회생·파산 Admin Demo",description:"개인회생·파산 상담 및 사건관리 데모"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
