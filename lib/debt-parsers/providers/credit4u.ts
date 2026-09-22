// 크레딧포유(본인신용정보 열람서비스, credit4u.or.kr) 다운로드 파일 전용 adapter.
//
// 아직 실제 샘플 파일을 전달받지 못해, 셀 주소를 하드코딩하는 대신 공용 헤더 매칭
// 엔진(../normalizeDebt)을 그대로 재사용합니다. 실제 샘플을 받으면 credit4u가 실제로
// 쓰는 컬럼명을 ../normalizeDebt.ts의 HEADER_ALIASES에 별칭으로 추가하거나, 이 파일에
// credit4u 전용 헤더 매핑을 별도로 추가하면 됩니다 — 다른 provider(genericExcel 등)에는
// 영향을 주지 않습니다.
import { normalizeRows, type ParsedDebtItem } from "../normalizeDebt";

export function parseCredit4uRows(rows: Array<Record<string, unknown>>, sourceFileName: string): ParsedDebtItem[] {
  return normalizeRows(rows, sourceFileName);
}
