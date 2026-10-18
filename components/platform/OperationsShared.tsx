"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { useStoreSession } from "@/lib/store";
import { useRouter } from "next/navigation";
import { opsToday, type OperationsResponse } from "@/lib/platform/operations";
export const fieldClass = "min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50";
export const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40";
export const secondaryClass = "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40";
export const won = (n: number | null) => n === null ? "확인 필요" : `${Math.round(n).toLocaleString("ko-KR")}원`;
export const count = (n: number | null) => n === null ? "미등록" : n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
export const percent = (n: number | null) => n === null ? "—" : `${n.toFixed(1)}%`;
export function useOperations() {
  const { profile, enterSuperAdminFirmScope } = useStoreSession(); const router = useRouter();
  const [month, setMonth] = useState(() => opsToday().slice(0, 7)), [includeDemo, setIncludeDemo] = useState(false);
  const [data, setData] = useState<OperationsResponse | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [openingFirm, setOpeningFirm] = useState<string | null>(null);
  const seq = useRef(0); const allowed = profile?.platformRole === "super_admin" && profile.isActive;
  useEffect(() => {
    const controller = new AbortController(), current = ++seq.current;
    setLoading(true); setError(""); setData(null);
    if (!allowed) { setLoading(false); setError("슈퍼관리자만 이용할 수 있습니다."); return () => controller.abort(); }
    void authJson<OperationsResponse>(`/api/platform/operations?month=${month}&includeDemo=${includeDemo ? "1" : "0"}&ledgerOffset=${ledgerOffset}`, { signal: controller.signal })
      .then(result => { if (seq.current === current && !controller.signal.aborted) setData(result); })
      .catch(e => { if (seq.current === current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "자료 조회에 실패했습니다."); })
      .finally(() => { if (seq.current === current && !controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); seq.current++; };
  }, [month, includeDemo, revision, allowed, profile?.id, ledgerOffset]);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const save = useCallback(async (command: Record<string, unknown>) => {
    await authJson("/api/platform/operations", { method: "POST", body: JSON.stringify(command) }); refresh();
  }, [refresh]);
  const changeMonth = (value: string) => { setLedgerOffset(0); setMonth(value); };
  const openFirm = async (id: string) => {
    const firm = data?.firms.find(f => f.id === id); if (!firm || !allowed || openingFirm) return;
    const current = seq.current; setOpeningFirm(id); setError("");
    try { await authJson("/api/platform/firm-view", { method: "POST", body: JSON.stringify({ lawFirmId: id, action: "enter" }) }); if (current === seq.current) { enterSuperAdminFirmScope({ id: firm.id, firmCode: firm.firm_code, name: firm.name, status: firm.status === "active" ? "active" : "suspended" }); router.push("/"); } }
    catch (e) { if (current === seq.current) setError(e instanceof Error ? e.message : "로펌 화면을 열 수 없습니다."); }
    finally { setOpeningFirm(null); }
  };
  return { month, setMonth: changeMonth, includeDemo, setIncludeDemo, data, loading, error, refresh, save, ledgerOffset, setLedgerOffset, allowed, openingFirm, openFirm };
}
export type OperationsController = ReturnType<typeof useOperations>;
export function OperationsFrame({ title, description, state, children, editing = false, exportRows }: { title: string; description: string; state: OperationsController; children: ReactNode; editing?: boolean; exportRows?: Array<Array<string | number | null>> }) {
  if (!state.allowed) return <div role="alert" className="p-8 text-sm text-slate-500">슈퍼관리자 전용 운영 화면입니다.</div>;
  return <div className="space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-slate-950 p-6 text-white"><div><div className="text-[11px] font-bold tracking-[.18em] text-indigo-300">LAWPOWER OPERATIONS</div><h1 className="mt-2 text-2xl font-bold">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{description}</p></div><div className="flex flex-wrap items-center gap-2 text-slate-700">
      <input aria-label="운영 조회월" type="month" className={fieldClass} value={state.month} disabled={editing} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) state.setMonth(e.target.value); }}/>
      <button type="button" className={secondaryClass} onClick={state.refresh} disabled={state.loading || editing}><RefreshCw size={15}/>새로고침</button>
      {exportRows && <button type="button" className={secondaryClass} onClick={() => downloadOperationsCsv(title, state.month, exportRows)} disabled={state.loading || !state.data}><Download size={15}/>CSV</button>}
    </div></header>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><label className="flex items-center gap-2"><input type="checkbox" checked={state.includeDemo} disabled={editing} onChange={e => state.setIncludeDemo(e.target.checked)}/>시연·TEST 로펌 포함</label><span>{state.data?.month?.closed_at ? state.includeDemo ? "TEST 포함 조회는 현재 집계 · 마감 스냅샷은 TEST 제외" : `마감 스냅샷 · ${new Date(state.data.month.closed_at).toLocaleString("ko-KR")}` : "현재 자료 기준 · 미등록 값은 확인 필요"} · 어드민 전용 로펌은 DB 판매 집계 제외</span></div>
    {state.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{state.error}</div>}
    {Boolean(state.data?.report.unregisteredFirms) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">서비스 구분 미등록 {state.data?.report.unregisteredFirms}곳은 판매 매출·마진을 확정하지 않습니다. 로파워 정산설정에서 어드민 전용 또는 DB 공급으로 구분해주세요.</div>}
    {state.loading ? <div role="status" className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">운영 자료를 불러오는 중입니다.</div> : state.data ? children : null}
  </div>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex min-w-0 flex-col gap-2 text-xs font-semibold text-slate-600">{label}{children}</label>; }
export function OperationTable({ headings, children }: { headings: string[]; children: ReactNode }) { return <div className="overflow-x-auto"><table className="w-full min-w-[760px] whitespace-nowrap text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{headings.map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{children}</tbody></table></div>; }
export const cellClass = "px-4 py-3";
export function downloadOperationsCsv(name: string, month: string, rows: Array<Array<string | number | null>>) {
  const cell = (value: string | number | null) => { let text = value === null ? "확인 필요" : String(value); if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = "'" + text; return `"${text.replace(/"/g, '""')}"`; };
  const blob = new Blob(["\ufeff", rows.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `${name}_${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
