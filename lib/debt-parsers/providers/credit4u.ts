// 크레딧포유(본인신용정보 열람서비스, credit4u.or.kr) 다운로드 파일 전용 adapter.
//
// 엑셀/CSV 다운로드본은 공용 헤더 매칭 엔진(../normalizeDebt)을 재사용합니다.
// 브라우저에서 저장한 실제 HTML은 별도 credit4uHtml.ts가 #debtListTable을 직접 읽습니다.
import { normalizeRows, type ParsedDebtItem } from "../normalizeDebt";

export function parseCredit4uRows(rows: Array<Record<string, unknown>>, sourceFileName: string): ParsedDebtItem[] {
  return normalizeRows(rows, sourceFileName);
}
