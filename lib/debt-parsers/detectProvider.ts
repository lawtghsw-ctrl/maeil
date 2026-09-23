// 채무파일 업로드 — 파일 종류/출처 판별.
// 특정 셀 주소를 하드코딩한 일회성 파서 대신, 파일 종류(엑셀/CSV/PDF)와 출처(provider)를
// 먼저 판별한 뒤 그에 맞는 adapter(./providers/*)로 라우팅하는 구조입니다. v17부터 실제
// credit4u HTML 저장본 샘플을 받아 .html/.htm은 전용 DOM 파서로 처리하고, 엑셀/CSV는
// 기존 provider 판별 로직을 유지합니다.

export type DebtFileKind = "excel" | "csv" | "pdf" | "html" | "unknown";

export function detectFileKind(fileName: string): DebtFileKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xls") return "excel";
  if (ext === "csv") return "csv";
  if (ext === "pdf") return "pdf";
  if (ext === "html" || ext === "htm") return "html";
  return "unknown";
}

export type DebtFileProvider = "credit4u" | "generic";

const CREDIT4U_NAME_HINTS = ["credit4u", "크레딧포유", "본인신용정보", "신용정보조회"];

export function detectProvider(fileName: string): DebtFileProvider {
  const n = fileName.toLowerCase();
  return CREDIT4U_NAME_HINTS.some((h) => n.includes(h.toLowerCase())) ? "credit4u" : "generic";
}
