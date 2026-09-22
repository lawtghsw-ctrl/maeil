// 채무파일 업로드 — 파일 종류/출처 판별.
// 특정 셀 주소를 하드코딩한 일회성 파서 대신, 파일 종류(엑셀/CSV/PDF)와 출처(provider)를
// 먼저 판별한 뒤 그에 맞는 adapter(./providers/*)로 라우팅하는 구조입니다. 아직 실제
// 크레딧포유(본인신용정보 열람서비스) 샘플 파일을 받지 못해 credit4u 판별은 파일명
// 힌트(다운로드 시 기본 파일명에 흔히 포함되는 문구) 기준의 best-effort 추정이며,
// 실제 샘플을 받으면 이 판별 로직과 providers/credit4u.ts의 헤더 별칭만 보강하면 됩니다.

export type DebtFileKind = "excel" | "csv" | "pdf" | "unknown";

export function detectFileKind(fileName: string): DebtFileKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xls") return "excel";
  if (ext === "csv") return "csv";
  if (ext === "pdf") return "pdf";
  return "unknown";
}

export type DebtFileProvider = "credit4u" | "generic";

const CREDIT4U_NAME_HINTS = ["credit4u", "크레딧포유", "본인신용정보", "신용정보조회"];

export function detectProvider(fileName: string): DebtFileProvider {
  const n = fileName.toLowerCase();
  return CREDIT4U_NAME_HINTS.some((h) => n.includes(h.toLowerCase())) ? "credit4u" : "generic";
}
