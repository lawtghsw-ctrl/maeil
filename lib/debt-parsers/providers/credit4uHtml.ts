// 본인신용정보 열람서비스(credit4u)에서 브라우저로 저장한 HTML 전용 파서.
// 사용자가 전달한 실제 샘플은 #debtListTable 안에
// "순번 / 구분 / 대출종류 / 기관명 / 발생일자 / 금액" 컬럼이 있고 금액 단위가 천원입니다.
// 이 표를 1순위로 사용하며, 해당 표가 없는 구형 저장본은 #grid2ListTable의 연체채권
// 변동현황을 fallback으로 읽습니다. DOMParser로 inert document만 생성해 스크립트는 실행하지 않습니다.
import type { LoanKind1 } from "../../types";
import type { ParsedDebtItem } from "../normalizeDebt";

let htmlSeq = 0;
function nextId(): string {
  htmlSeq += 1;
  return `CREDIT4U-HTML-${Date.now()}-${htmlSeq}`;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseKoreanDate(raw: string): string | undefined {
  const text = cleanText(raw).replace(/^'/, "");
  const m = text.match(/(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return undefined;
  const year = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const month = String(Number(m[2])).padStart(2, "0");
  const day = String(Number(m[3])).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 샘플 HTML은 금액 단위가 "천원"이므로 내부 LoanRecord 원 단위로 ×1000 정규화합니다.
function parseThousandWon(raw: string): number {
  const digits = cleanText(raw).replace(/[^0-9.-]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 1000)) : 0;
}

function guessKind1(kind2: string, rawKind?: string): LoanKind1 {
  const text = `${rawKind ?? ""} ${kind2}`;
  if (/담보|근저당|주택|자동차담보/.test(text)) return "담보";
  if (/보증|대위변제|대지급/.test(text)) return "보증";
  // credit4u의 "개인대출정보"는 사인 간 개인채무라는 뜻이 아니라 개인 신용정보 구분이므로
  // "개인"으로 오분류하지 않고, 담보/보증이 아니면 기본적으로 신용으로 분류합니다.
  return "신용";
}

function primaryRows(doc: Document, sourceFileName: string): ParsedDebtItem[] {
  const table = doc.querySelector<HTMLTableElement>("#debtListTable");
  if (!table) return [];
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  const items: ParsedDebtItem[] = [];

  for (const tr of rows) {
    const td = Array.from(tr.querySelectorAll<HTMLTableCellElement>("td"));
    if (td.length < 6) continue;
    const rawKind = cleanText(td[1]?.textContent);
    const kind2 = cleanText(td[2]?.textContent);
    const lender = cleanText(td[3]?.textContent);
    const executedAt = parseKoreanDate(cleanText(td[4]?.textContent));
    const balance = parseThousandWon(cleanText(td[5]?.textContent));
    if (!lender && !kind2 && balance <= 0) continue;

    items.push({
      id: nextId(),
      kind1: guessKind1(kind2, rawKind),
      kind2: kind2 || undefined,
      lender: lender || undefined,
      executedAt,
      balance,
      originalAmount: balance || undefined,
      note: rawKind || undefined,
      source: "file",
      sourceFileName,
    });
  }
  return items;
}

function stripPhone(raw: string): string {
  return cleanText(raw).replace(/\s*\(\s*[0-9-]{3,}\s*\)\s*$/, "").trim();
}

function fallbackCreditorChangeRows(doc: Document, sourceFileName: string): ParsedDebtItem[] {
  const table = doc.querySelector<HTMLTableElement>("#grid2ListTable");
  if (!table) return [];
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  const items: ParsedDebtItem[] = [];

  for (const tr of rows) {
    const td = Array.from(tr.querySelectorAll<HTMLTableCellElement>("td"));
    if (td.length < 6) continue;
    const lender = stripPhone(cleanText(td[1]?.textContent));
    const kind2 = cleanText(td[2]?.textContent);
    const executedAt = parseKoreanDate(cleanText(td[3]?.textContent));
    const principal = parseThousandWon(cleanText(td[4]?.textContent));
    const interest = parseThousandWon(cleanText(td[5]?.textContent));
    const balance = principal + interest;
    if (!lender && !kind2 && balance <= 0) continue;

    items.push({
      id: nextId(),
      kind1: guessKind1(kind2),
      kind2: kind2 || undefined,
      lender: lender || undefined,
      executedAt,
      balance,
      originalAmount: principal || undefined,
      note: "연체채권의 채권자 변동 현황에서 추출",
      source: "file",
      sourceFileName,
    });
  }
  return items;
}

export function parseCredit4uHtml(html: string, sourceFileName: string): ParsedDebtItem[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const primary = primaryRows(doc, sourceFileName);
  if (primary.length > 0) return primary;
  return fallbackCreditorChangeRows(doc, sourceFileName);
}
