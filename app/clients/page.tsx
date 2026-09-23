import { redirect } from "next/navigation";

// v22: 고객관리 기능을 계약관리 상세로 통합했습니다.
// 과거 북마크/직접 URL 접근은 깨뜨리지 않고 계약관리로 보내 호환성을 유지합니다.
export default function ClientsRedirectPage() {
  redirect("/cases");
}
