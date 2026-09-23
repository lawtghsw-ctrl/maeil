import { redirect } from "next/navigation";

// v22: 내부 게시판 메뉴를 제거했습니다. 기존 URL은 대시보드로 안전하게 돌립니다.
export default function BoardRedirectPage() {
  redirect("/");
}
