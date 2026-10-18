"use client";
import { useEffect, useState } from "react";
import type { OperationFirm, OperationsConfig } from "@/lib/platform/operations";
import { OPERATIONS_AD_HEADERS, mergeOperationsAds, previewOperationsAds, type OperationsAdPreview } from "@/lib/platform/operations-import";
import { OperationTable, cellClass, secondaryClass, buttonClass, downloadOperationsCsv, won } from "./OperationsShared";
export function OperationsAdImport({ month, firms, existing, disabled, onApply, onBusy }: { month: string; firms: OperationFirm[]; existing: OperationsConfig["adSpend"]; disabled: boolean; onApply: (rows: OperationsConfig["adSpend"]) => void; onBusy: (busy: boolean) => void }) {
  const [preview, setPreview] = useState<OperationsAdPreview | null>(null), [error, setError] = useState("");
  useEffect(() => { setPreview(null); setError(""); }, [month]);
  async function read(file: File) {
    setError(""); setPreview(null); onBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024 || !/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error("2MiB 이하의 XLSX/XLS/CSV 파일을 선택해주세요.");
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array", sheetRows: 1002, cellFormula: true });
      const sheet = book.Sheets[book.SheetNames[0]]; if (!sheet) throw new Error("첫 번째 시트에 광고비 입력 자료가 필요합니다.");
      if (Object.values(sheet).some(cell => cell && typeof cell === "object" && "f" in cell)) throw new Error("수식 셀은 값으로 붙여넣은 후 다시 가져와주세요.");
      setPreview(previewOperationsAds(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true }), firms));
    } catch (e) { setError(e instanceof Error ? e.message : "파일을 읽지 못했습니다."); } finally { onBusy(false); }
  }
  return <div className="space-y-3 border-b border-slate-100 p-5"><div className="flex flex-wrap items-center gap-3"><button type="button" className={secondaryClass} disabled={disabled} onClick={() => downloadOperationsCsv("광고비_입력양식", month, [OPERATIONS_AD_HEADERS, ...firms.map(f => [f.id, f.name, "", ""])])}>엑셀 입력양식 (CSV)</button><label className={secondaryClass + " cursor-pointer"}>광고비 엑셀 가져오기<input aria-label="광고비 엑셀 파일" className="sr-only" type="file" accept=".xlsx,.xls,.csv" disabled={disabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void read(file); }}/></label><span className="text-xs text-slate-400">{month} 월 합계 · 첫 시트 · 최대 1,000행 · 2MiB</span></div>
    <p className="text-xs leading-5 text-slate-500">로펌ID 또는 정확한 로펌명으로 검증합니다. 적용하면 해당 로펌의 수동 광고비를 교체하며, 마지막에 ‘월 설정 저장’을 눌러야 서버에 반영됩니다. 미입력 로펌 행은 삭제해서 가져오세요.</p>
    {error && <div role="alert" className="text-sm text-rose-700">{error}</div>}
    {preview && <div className="space-y-3 rounded-xl border border-slate-200 p-3"><div className="text-sm font-semibold text-slate-700">미리보기 · 정상 {preview.rows.length}행 / 오류 {preview.errors.length}행</div>{preview.errors.length > 0 && <ul className="max-h-40 overflow-auto text-xs text-rose-700">{preview.errors.map((e, i) => <li key={i}>{e.line ? `${e.line}행: ` : ""}{e.message}</li>)}</ul>}<OperationTable headings={["원본 행", "로펌", "광고비", "메모"]}>{preview.rows.slice(0, 20).map(row => <tr key={row.firmId}><td className={cellClass}>{row.line}</td><td className={cellClass}>{row.firmName}</td><td className={cellClass}>{won(row.amount)}</td><td className={cellClass}>{row.note}</td></tr>)}</OperationTable>{preview.rows.length > 20 && <p className="text-xs text-slate-400">화면은 처음 20행, 적용 대상은 검증된 전체 {preview.rows.length}행입니다.</p>}<div className="flex gap-2"><button type="button" className={buttonClass} disabled={disabled || preview.errors.length > 0 || !preview.rows.length} onClick={() => { try { onApply(mergeOperationsAds(existing, preview)); setPreview(null); } catch (e) { setError(e instanceof Error ? e.message : "적용할 수 없습니다."); } }}>미리보기 적용 · 저장 전</button><button type="button" className={secondaryClass} onClick={() => setPreview(null)}>닫기</button></div></div>}
  </div>;
}
