// 일반 엑셀(.xlsx/.xls) + 크레딧포유 계열 파일 adapter.
// 실제 신용정보 파일은 첫 행이 곧 헤더가 아니라 제목/안내문/병합행 뒤에 표가 시작되는
// 경우가 많으므로, 모든 시트의 앞부분을 훑어 '금융사/대출/잔액/실행일' 계열 헤더가 가장
// 많이 잡히는 행을 찾아 그 행부터 표로 읽습니다. 특정 셀 주소는 하드코딩하지 않습니다.
import * as XLSX from "xlsx";
import { detectProvider } from "../detectProvider";
import { normalizeRows, type ParsedDebtItem } from "../normalizeDebt";
import { parseCredit4uRows } from "./credit4u";

const HEADER_HINTS = [
  "금융회사",
  "금융기관",
  "기관명",
  "대출기관",
  "채권자",
  "대출종류",
  "상품명",
  "대출구분",
  "실행일",
  "개설일",
  "대출일자",
  "대출원금",
  "원금",
  "잔액",
  "미상환금액",
  "월상환",
  "월납입",
  "금리",
];

function normalizedCell(v: unknown): string {
  return String(v ?? "").replace(/[\s()（）\-_/]/g, "").toLowerCase();
}

function scoreHeaderRow(row: unknown[]): number {
  const cells = row.map(normalizedCell).filter(Boolean);
  if (cells.length < 2) return 0;
  const hints = HEADER_HINTS.map(normalizedCell);
  let score = 0;
  for (const cell of cells) {
    if (hints.some((h) => cell.includes(h) || h.includes(cell))) score += 1;
  }
  return score;
}

function findHeaderRow(sheet: XLSX.WorkSheet): number | undefined {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  let bestIndex = -1;
  let bestScore = 0;
  const limit = Math.min(matrix.length, 50);
  for (let i = 0; i < limit; i += 1) {
    const score = scoreHeaderRow(matrix[i] ?? []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  // 금융사/잔액처럼 최소 2개 이상의 핵심 헤더가 함께 잡힐 때만 표 헤더로 인정.
  return bestScore >= 2 ? bestIndex : undefined;
}

export function parseExcelFile(buffer: ArrayBuffer, sourceFileName: string): ParsedDebtItem[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const provider = detectProvider(sourceFileName);
  const collected: ParsedDebtItem[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const headerRow = findHeaderRow(sheet);
    if (headerRow === undefined) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      range: headerRow,
      raw: true,
    });
    const parsed = provider === "credit4u" ? parseCredit4uRows(rows, sourceFileName) : normalizeRows(rows, sourceFileName);
    collected.push(...parsed);
  }

  // 동일 파일 내 여러 시트에 같은 대출이 반복되는 경우가 있어 대표 필드 조합으로 한 번 정리.
  const seen = new Set<string>();
  return collected.filter((item) => {
    const key = [item.lender ?? "", item.kind2 ?? item.kind1, item.executedAt ?? "", item.balance, item.originalAmount ?? ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
