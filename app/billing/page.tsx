import { redirect } from "next/navigation";

// v22: 별도 입금·분납 메뉴를 제거하고 계약 상세의 "분납관리"로 통합했습니다.
export default function BillingRedirectPage() {
  redirect("/cases");
}
