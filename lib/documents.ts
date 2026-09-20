// 서류 체크리스트 템플릿 — 첨부해주신 "매일법률사무소_서류제출안내문" 양식을 그대로 반영.
// 색깔 구분(파란=주민센터, 보라=온라인전용, 초록=직장요청, 주황=세무사요청)을 태그로 표현.

export type DocumentSourceTag = "주민센터" | "온라인전용" | "직장요청" | "세무사요청" | "기타";

export const DOCUMENT_SOURCE_COLOR: Record<DocumentSourceTag, string> = {
  주민센터: "#2944AF",
  온라인전용: "#7C5CD6",
  직장요청: "#2C7A3F",
  세무사요청: "#B06A1A",
  기타: "#6B7280",
};

export interface DocumentItem {
  id: string;
  no: number;
  label: string;
  note?: string;
  source: DocumentSourceTag;
}

// 원본 안내문의 "주민센터 발급 서류(1~7) / 온라인 전용 발급(8~10) / 기타 준비 서류(11~15)" 구성을 그대로 유지
export const DOCUMENT_CHECKLIST_TEMPLATE: DocumentItem[] = [
  { id: "d1", no: 1, source: "주민센터", label: "인감증명서 20장", note: "주민센터발급 원본 필수 · 인터넷발급/대리인발급 불가" },
  { id: "d2", no: 2, source: "주민센터", label: "주민등록등본(주소변동포함) 2통 · 초본(주소내역전부) 2통" },
  { id: "d3", no: 3, source: "주민센터", label: "가족관계증명서(상세) · 혼인관계증명서(상세)" },
  {
    id: "d4",
    no: 4,
    source: "주민센터",
    label: "지방세 완납증명서 · 세목별과세증명서 · 세목별미과세증명서",
    note: "체납 시 완납증명서는 발급 불가(생략)",
  },
  { id: "d5", no: 5, source: "주민센터", label: "국세 완납증명서", note: "온라인 가능: 홈택스 hometax.go.kr" },
  { id: "d6", no: 6, source: "주민센터", label: "소득금액증명원(최근 5년치)", note: "온라인 가능: 홈택스" },
  { id: "d7", no: 7, source: "주민센터", label: "자동차등록원부(갑·을구, 배우자소유 포함)", note: "온라인 가능: 정부24" },
  { id: "d8", no: 8, source: "온라인전용", label: "부동산 등기사항전부증명서", note: "대법원 인터넷등기소 iros.go.kr (부동산소유·무상거주 시)" },
  { id: "d9", no: 9, source: "온라인전용", label: "근로소득원천징수영수증(최근 2년치)", note: "국세청 홈택스" },
  { id: "d10", no: 10, source: "온라인전용", label: "건강보험자격득실확인서", note: "국민건강보험공단 / 정부24" },
  { id: "d11", no: 11, source: "기타", label: "인감도장 실물", note: "매우 중요" },
  { id: "d12", no: 12, source: "기타", label: "신분증 앞·뒤 사본" },
  {
    id: "d13",
    no: 13,
    source: "직장요청",
    label: "재직증명서(사업자는 사업자등록증) · 퇴직금확인서 등",
    note: "퇴직금 관련 시에만 해당",
  },
  { id: "d14", no: 14, source: "세무사요청", label: "급여명세서(최근 1년) / 사업자 매출·매입 장부 1년치" },
  { id: "d15", no: 15, source: "세무사요청", label: "급여입금내역(최근 1년) / 사업자 매출·매입 장부 1년치" },
];

// 서류 독촉 기준일 — 매뉴얼 14장 부록C 제안(D+3, D+7)을 반영
export const DOC_REMINDER_THRESHOLDS = [3, 7] as const;
