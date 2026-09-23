import { redirect } from "next/navigation";

// v17: 상세 DB관리의 단계별 현황/필터를 DB관리 상단에 통합했습니다.
// 예전 북마크나 직접 URL 접근은 깨뜨리지 않고 DB관리로 보내기 위해 route만 남깁니다.
export default function LegacyDbDetailRedirectPage() {
  redirect("/db");
}
