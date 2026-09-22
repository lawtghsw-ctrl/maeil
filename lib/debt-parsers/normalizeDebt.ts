// 채무파일 업로드 — 헤더(컬럼명) 기반 정규화 엔진.
// 원본 파일마다 컬럼명이 달라도(예: "금융기관명" vs "금융회사" vs "대출기관") 내부에서는
// 동일한 ParsedDebtItem 형태로 맞춰줍니다. 특정 셀 주소를 하드코딩하지 않고, 헤더 텍스트를
// 느슨하게(공백/괄호 제거 후 부분일치) 매칭하는 방식이라 provider마다 컬럼 순서/이름이
// 달라도 재사용할 수 있습니다.
import type { LoanKind1 } from "../types";

export type ParsedDebtField =
  | "lender"
  | "kind1"
  | "kind2"
  | "executedAt"
  | "originalAmount"
  | "balance"
  | "monthlyPayment"
  | "interestRate"
  | "securedAmount"
  | "note";

export interface ParsedDebtItem {
  id: string;
  kind1: LoanKind1; // 매칭 실패 시 "기타"로 표시(사용자가 Preview에서 직접 수정 가능)
  kind2?: string;
  lender?: string;
  executedAt?: string;
  originalAmount?: number;
  balance: number;
  monthlyPayment?: number;
  interestRate?: number;
  securedAmount?: number;
  note?: string;
  source: "file";
  sourceFileName: string;
}

const HEADER_ALIASES: Record<ParsedDebtField, string[]> = {
  lender: ["금융회사", "금융기관명", "금융기관", "기관명", "은행", "대출기관", "채권자", "카드사"],
  kind1: ["구분", "대출구분", "채무구분", "담보구분"],
  kind2: ["대출종류", "상품명", "대출상품", "상품종류", "종류", "대출유형"],
  executedAt: ["실행일", "대출실행일", "개설일", "대출일자", "계약일", "발급일"],
  originalAmount: ["대출원금", "원금", "대출금액", "실행금액", "약정금액"],
  balance: ["대출잔액", "잔액", "현재잔액", "잔여원금", "잔여금액", "미상환금액"],
  monthlyPayment: ["월상환액", "월납입금", "월상환금액", "월불입금", "월납입액"],
  interestRate: ["금리", "대출금리", "이자율", "적용금리"],
  securedAmount: ["담보금액", "담보설정액", "채권최고액", "근저당설정액"],
  note: ["비고", "메모", "특이사항"],
};

function normalizeHeader(h: string): string {
  return h.replace(/[\s()（）\-_/]/g, "").toLowerCase();
}

function findColumn(headers: string[], field: ParsedDebtField): string | undefined {
  const aliases = HEADER_ALIASES[field].map(normalizeHeader);
  return headers.find((h) => {
    const nh = normalizeHeader(h);
    if (!nh) return false;
    return aliases.some((a) => nh.includes(a) || a.includes(nh));
  });
}

// "1,234,567" / "1234567원" / "123만원" 등 다양한 표기를 원(₩) 단위 숫자로 변환.
// "만원"이 포함된 셀은 ×10000, 그 외에는 숫자만 추출합니다.
function parseAmount(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "number") return Math.round(raw);
  const text = String(raw).trim();
  if (!text) return undefined;
  const isManwon = /만\s*원/.test(text);
  const digits = text.replace(/[^0-9.\-]/g, "");
  if (!digits) return undefined;
  const n = Number(digits);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(isManwon ? n * 10000 : n);
}

function parsePercent(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "number") return raw;
  const digits = String(raw).replace(/[^0-9.\-]/g, "");
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Excel 날짜 셀(XLSX.read cellDates:true 옵션 사용 시 JS Date로 들어옴) 또는
// "2024-05-28"/"2024.05.28"/"2024/05/28" 형태의 문자열을 ISO(YYYY-MM-DD)로 정규화.
function parseDateCell(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
  }
  const text = String(raw).trim();
  const m = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
  return undefined;
}

function guessKind1(kind2: string | undefined, kind1Raw: string | undefined): LoanKind1 {
  const text = `${kind1Raw ?? ""} ${kind2 ?? ""}`;
  if (text.includes("담보")) return "담보";
  if (text.includes("보증")) return "보증";
  if (text.includes("신용")) return "신용";
  return "기타";
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `PARSED-${Date.now()}-${seq}`;
}

// rows: XLSX.utils.sheet_to_json(sheet, { defval: "" })의 결과처럼 "헤더문자열 → 셀값"
// 객체 배열. lender/balance 둘 다 비어있는 행(빈 줄, 합계 줄 등)은 건너뜁니다.
export function normalizeRows(rows: Array<Record<string, unknown>>, sourceFileName: string): ParsedDebtItem[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const col = {
    lender: findColumn(headers, "lender"),
    kind1: findColumn(headers, "kind1"),
    kind2: findColumn(headers, "kind2"),
    executedAt: findColumn(headers, "executedAt"),
    originalAmount: findColumn(headers, "originalAmount"),
    balance: findColumn(headers, "balance"),
    monthlyPayment: findColumn(headers, "monthlyPayment"),
    interestRate: findColumn(headers, "interestRate"),
    securedAmount: findColumn(headers, "securedAmount"),
    note: findColumn(headers, "note"),
  };

  const items: ParsedDebtItem[] = [];
  for (const row of rows) {
    const lender = col.lender ? String(row[col.lender] ?? "").trim() : "";
    const balance = col.balance ? parseAmount(row[col.balance]) : undefined;
    const originalAmount = col.originalAmount ? parseAmount(row[col.originalAmount]) : undefined;
    if (!lender && !balance && !originalAmount) continue; // 빈 줄/합계 줄 등으로 추정 — 건너뜀

    const kind2 = col.kind2 ? String(row[col.kind2] ?? "").trim() || undefined : undefined;
    items.push({
      id: nextId(),
      kind1: guessKind1(kind2, col.kind1 ? String(row[col.kind1] ?? "") : undefined),
      kind2,
      lender: lender || undefined,
      executedAt: col.executedAt ? parseDateCell(row[col.executedAt]) : undefined,
      originalAmount,
      balance: balance ?? 0,
      monthlyPayment: col.monthlyPayment ? parseAmount(row[col.monthlyPayment]) : undefined,
      interestRate: col.interestRate ? parsePercent(row[col.interestRate]) : undefined,
      securedAmount: col.securedAmount ? parseAmount(row[col.securedAmount]) : undefined,
      note: col.note ? String(row[col.note] ?? "").trim() || undefined : undefined,
      source: "file",
      sourceFileName,
    });
  }
  return items;
}
