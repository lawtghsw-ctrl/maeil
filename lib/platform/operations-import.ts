import type { OperationFirm, OperationsConfig } from "./operations";
export interface OperationsAdPreview { rows: Array<{ line: number; firmId: string; firmName: string; amount: number; note: string }>; errors: Array<{ line: number; message: string }> }
export const OPERATIONS_AD_HEADERS = ["로펌ID", "로펌명", "광고비(원)", "메모"];
/** Parse values only. Spreadsheet formulas are rejected by the file reader. */
export function previewOperationsAds(values: unknown[][], firms: OperationFirm[]): OperationsAdPreview {
  const result: OperationsAdPreview = { rows: [], errors: [] };
  if (values.length > 1001) return { rows: [], errors: [{ line: 0, message: "한 번에 최대 1,000행까지 가져올 수 있습니다." }] };
  const headers = (values[0] ?? []).map(v => String(v ?? "").replace(/^\uFEFF/, "").trim());
  if (headers.length !== 4 || headers.some((v, i) => v !== OPERATIONS_AD_HEADERS[i])) return { rows: [], errors: [{ line: 1, message: "양식의 열 순서(로펌ID, 로펌명, 광고비(원), 메모)를 유지해주세요." }] };
  const ids = new Map(firms.map(f => [f.id, f])), seen = new Set<string>();
  for (let index = 1; index < values.length; index++) {
    const row = values[index], line = index + 1;
    if (row.every(v => v === null || v === undefined || String(v).trim() === "")) continue;
    const id = String(row[0] ?? "").trim(), name = String(row[1] ?? "").trim(), note = String(row[3] ?? "").trim();
    const matches = id ? [ids.get(id)].filter((f): f is OperationFirm => Boolean(f)) : firms.filter(f => f.name === name);
    const fail = (message: string) => result.errors.push({ line, message });
    if (row.length > 4 && row.slice(4).some(v => String(v ?? "").trim())) { fail("양식 외 열에 값이 있습니다."); continue; }
    if (matches.length !== 1) { fail("등록된 로펌ID 또는 중복되지 않는 정확한 로펌명을 입력해주세요."); continue; }
    const firm = matches[0];
    if (name && name !== firm.name) { fail("로펌ID와 로펌명이 일치하지 않습니다."); continue; }
    if (seen.has(firm.id)) { fail("동일 로펌이 중복되었습니다. 월 합계 1행으로 입력해주세요."); continue; }
    const raw = row[2], normalized = typeof raw === "string" ? raw.trim() : raw;
    const numeric = typeof normalized === "number" ? normalized : typeof normalized === "string" && /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(normalized) ? Number(normalized.replace(/,/g, "")) : NaN;
    if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 1e12) { fail("광고비는 0 이상의 정수 원 단위로 입력해주세요. 빈칸과 수식은 허용하지 않습니다."); continue; }
    if (note.length > 300 || /[\u0000-\u001f]/.test(note)) { fail("메모는 줄바꿈 없이 300자 이내로 입력해주세요."); continue; }
    seen.add(firm.id); result.rows.push({ line, firmId: firm.id, firmName: firm.name, amount: numeric, note });
  }
  if (!result.rows.length && !result.errors.length) result.errors.push({ line: 0, message: "가져올 광고비가 없습니다." });
  return result;
}
export function mergeOperationsAds(existing: OperationsConfig["adSpend"], preview: OperationsAdPreview): OperationsConfig["adSpend"] {
  if (preview.errors.length) throw new Error("검증 오류를 수정한 후 적용해주세요.");
  const rows = new Map(existing.map(r => [r.firmId, r]));
  for (const { firmId, amount, note } of preview.rows) rows.set(firmId, { firmId, amount, note });
  if (rows.size > 1000) throw new Error("광고비는 최대 1,000개 로펌까지 입력할 수 있습니다.");
  return [...rows.values()];
}
