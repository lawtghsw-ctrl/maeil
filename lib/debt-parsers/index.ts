// 채무파일 업로드 — 공개 진입점. DebtUploader 컴포넌트는 이 파일의 parseDebtFile()만
// 호출하면 되고, 파일 종류/출처 판별과 provider 선택은 내부에서 처리합니다.
//
// 실패해도 상담일지 전체가 오류나지 않도록 항상 { ok, items, message } 형태로 결과를
// 돌려주고, 확신할 수 없는 값은 추측해서 채우지 않습니다(파서가 못 찾은 값은 undefined로
// 남겨 Preview에서 사용자가 직접 채우도록 함).
import { detectFileKind } from "./detectProvider";
import type { ParsedDebtItem } from "./normalizeDebt";
import { parseCsvText } from "./providers/genericCsv";
import { parseExcelFile } from "./providers/genericExcel";
import { parseCredit4uHtml } from "./providers/credit4uHtml";

export type { ParsedDebtItem } from "./normalizeDebt";

export interface DebtParseResult {
  ok: boolean;
  items: ParsedDebtItem[];
  message?: string; // 실패/미지원 시 사용자에게 그대로 보여줄 안내 문구
}

const UNRECOGNIZED_MESSAGE = "파일에서 채무정보를 자동으로 확인하지 못했습니다. 파일 형식을 확인하거나 직접 입력해주세요.";

export async function parseDebtFile(file: File): Promise<DebtParseResult> {
  const kind = detectFileKind(file.name);
  try {
    if (kind === "pdf") {
      // PDF는 서식이 제각각이라 신뢰할 수 있는 자동 분석기가 아직 없어, 추측으로 값을
      // 채우는 대신 정직하게 미지원으로 안내하고 수기 입력을 권합니다(파일 자체는 첨부 가능).
      return {
        ok: false,
        items: [],
        message: "PDF 자동 분석은 아직 지원하지 않습니다. 파일은 첨부되며, 채무 항목은 아래에서 직접 입력해주세요.",
      };
    }
    if (kind === "excel") {
      const buffer = await file.arrayBuffer();
      const items = parseExcelFile(buffer, file.name);
      if (items.length === 0) return { ok: false, items: [], message: UNRECOGNIZED_MESSAGE };
      return { ok: true, items };
    }
    if (kind === "csv") {
      const text = await file.text();
      const items = parseCsvText(text, file.name);
      if (items.length === 0) return { ok: false, items: [], message: UNRECOGNIZED_MESSAGE };
      return { ok: true, items };
    }
    if (kind === "html") {
      const text = await file.text();
      const items = parseCredit4uHtml(text, file.name);
      if (items.length === 0) {
        return { ok: false, items: [], message: "HTML에서 credit4u 채무현황 표를 찾지 못했습니다. 본인신용정보 열람서비스의 채무현황 화면을 HTML로 저장한 파일인지 확인해주세요." };
      }
      return { ok: true, items };
    }
    return { ok: false, items: [], message: "지원하지 않는 파일 형식입니다 (.html/.htm, .xlsx, .xls, .csv, .pdf만 지원합니다)." };
  } catch {
    return { ok: false, items: [], message: UNRECOGNIZED_MESSAGE };
  }
}

// ---- 채무 중복 검사 ----
// 금융사·대출종류·실행일·원금·잔액이 비슷한 기존 채무가 있으면 "가능성 있는 중복"으로
// 보고 사용자에게 확인시킵니다(자동으로 걸러내지 않음 — 최종 판단은 사용자).
export function findLikelyDuplicate<T extends { lender?: string; kind2?: string; executedAt?: string; balance: number; originalAmount?: number }>(
  candidate: ParsedDebtItem,
  existing: T[]
): T | undefined {
  return existing.find((e) => {
    const sameLender = !!candidate.lender && !!e.lender && candidate.lender.trim() === e.lender.trim();
    if (!sameLender) return false;
    const sameKind2 = (candidate.kind2 ?? "").trim() === (e.kind2 ?? "").trim();
    const sameDate = !candidate.executedAt || !e.executedAt || candidate.executedAt === e.executedAt;
    const closeBalance = Math.abs((e.balance || 0) - (candidate.balance || 0)) <= Math.max(1000, (candidate.balance || 0) * 0.02);
    return sameKind2 && sameDate && closeBalance;
  });
}
