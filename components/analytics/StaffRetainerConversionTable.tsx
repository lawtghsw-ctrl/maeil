import { conversionPeriodLabel } from "./LeadRetainerConversionCard";
import { InfoHelp } from "@/components/ui/InfoHelp";

export interface StaffRetainerConversionRow {
  key: string;
  name: string;
  db: number;
  contractedDb: number;
  conversionRate?: number | null;
  kind?: "staff" | "unlinked";
}

export function StaffRetainerConversionTable({ start, end, rows, selectedStaff, basis = "intake", totalConversionRate, cohortLabel }: {
  start: string;
  end: string;
  rows: readonly StaffRetainerConversionRow[];
  selectedStaff?: string;
  basis?: "intake" | "supply";
  totalConversionRate?: number | null;
  cohortLabel?: string;
}) {
  const sorted = [...rows].sort((a, b) => b.db - a.db || b.contractedDb - a.contractedDb || a.name.localeCompare(b.name, "ko"));
  const totals = rows.reduce((sum, row) => ({ db: sum.db + row.db, contractedDb: sum.contractedDb + row.contractedDb }), { db: 0, contractedDb: 0 });
  const count = (value: number) => `${value.toLocaleString("ko-KR")}건`;
  const rate = (row: { db: number; contractedDb: number; conversionRate?: number | null }) => {
    if (row.db === 0) return "—";
    const value = basis === "supply" ? row.conversionRate : row.contractedDb / row.db * 100;
    return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "확인 필요";
  };
  const rateCell = (row: { db: number; contractedDb: number; conversionRate?: number | null }) => <span>{row.contractedDb}/{row.db} · {rate(row)}{row.db > 0 && row.db < 30 ? " · 참고" : ""}</span>;
  const label = cohortLabel ?? `${conversionPeriodLabel(start, end)} ${basis === "supply" ? "공급" : "접수"} DB`;
  return <section aria-label="직원별 DB 수임 전환 비교" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
      <h2 className="text-sm font-bold text-slate-900">직원별 {label} · 수임 전환 비교</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">{start} ~ {end} · {basis === "supply" ? "공급 원장 공급일" : "접수일"} 기준 · 현재 DB 담당자 기준 · 전체 직원 비교</p>
    </div>
    <div className="overflow-x-auto">
      <table aria-label={`직원별 ${label}와 수임 전환율`} className="w-full min-w-[520px] text-sm tabular-nums">
        <thead className="bg-slate-50 text-xs text-slate-500"><tr>
          <th scope="col" className="px-4 py-3 text-left sm:px-5">직원</th>
          <th scope="col" className="px-4 py-3 text-right">{label}</th>
          <th scope="col" className="px-4 py-3 text-right">수임 전환 건수</th>
          <th scope="col" className="px-4 py-3 text-right sm:px-5">수임 전환율</th>
        </tr></thead>
        <tbody>{sorted.map(row => <tr key={row.key} className={`border-t border-slate-100 ${selectedStaff === row.name ? "bg-indigo-50/70" : "hover:bg-slate-50/70"}`}>
          <th scope="row" className="px-4 py-3 text-left font-semibold text-slate-800 sm:px-5">{row.name}{row.kind === "unlinked" && <span className="mt-1 block text-[11px] font-normal text-amber-700">직원 성과에 배분하지 않은 공급</span>}</th>
          <td className="px-4 py-3 text-right text-slate-700">{count(row.db)}</td>
          <td className="px-4 py-3 text-right font-semibold text-slate-800">{count(row.contractedDb)}</td>
          <td className={`px-4 py-3 text-right font-bold sm:px-5 ${row.db >= 30 ? "text-indigo-700" : "text-slate-400"}`}>{rateCell(row)}</td>
        </tr>)}{!rows.length && <tr><td colSpan={4} className="px-5 py-6 text-center text-xs text-slate-400">비교할 직원·배정 DB가 없습니다.</td></tr>}</tbody>
        <tfoot className="border-t border-indigo-100 bg-indigo-50/60 font-bold text-indigo-950"><tr>
          <th scope="row" className="px-4 py-3 text-left sm:px-5">전체 합계</th>
          <td className="px-4 py-3 text-right">{count(totals.db)}</td>
          <td className="px-4 py-3 text-right">{count(totals.contractedDb)}</td>
          <td className={`px-4 py-3 text-right sm:px-5 ${totals.db < 30 ? "text-slate-400" : ""}`}>{rateCell({ ...totals, conversionRate: totalConversionRate })}</td>
        </tr></tfoot>
      </table>
    </div>
    <div className="border-t border-slate-100 px-4 py-3 sm:px-5"><InfoHelp summary="수임 / DB · 전환율 · 현재 담당자 기준">수임 전환율 = 수임 전환 DB ÷ {label} × 100. 합계는 전체 건수로 계산합니다. 취하·0원 계약 제외, 같은 DB의 여러 계약은 1건으로 집계합니다. DB 30건 미만은 회색 참고값, DB가 없으면 —, 계약 연결이 불명확하면 확인 필요로 표시합니다. 연결 누락 공급은 제외하며 과거 담당자 변경 이력은 추정하지 않습니다.</InfoHelp></div>
  </section>;
}
