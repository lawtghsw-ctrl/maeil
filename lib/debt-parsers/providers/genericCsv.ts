// CSV 파일용 adapter — xlsx 패키지가 CSV 텍스트도 워크시트로 파싱할 수 있어 동일한
// 헤더 매칭 엔진을 그대로 재사용합니다.
import * as XLSX from "xlsx";
import { detectProvider } from "../detectProvider";
import { normalizeRows, type ParsedDebtItem } from "../normalizeDebt";
import { parseCredit4uRows } from "./credit4u";

export function parseCsvText(text: string, sourceFileName: string): ParsedDebtItem[] {
  const wb = XLSX.read(text, { type: "string" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
  const provider = detectProvider(sourceFileName);
  return provider === "credit4u" ? parseCredit4uRows(rows, sourceFileName) : normalizeRows(rows, sourceFileName);
}
