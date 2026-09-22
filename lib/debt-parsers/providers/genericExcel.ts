// 출처를 알 수 없는 일반 엑셀(.xlsx/.xls) 파일용 adapter — 첫 번째 시트를 읽어 헤더
// 매칭 엔진에 넘깁니다.
import * as XLSX from "xlsx";
import { detectProvider } from "../detectProvider";
import { normalizeRows, type ParsedDebtItem } from "../normalizeDebt";
import { parseCredit4uRows } from "./credit4u";

export function parseExcelFile(buffer: ArrayBuffer, sourceFileName: string): ParsedDebtItem[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
  const provider = detectProvider(sourceFileName);
  return provider === "credit4u" ? parseCredit4uRows(rows, sourceFileName) : normalizeRows(rows, sourceFileName);
}
