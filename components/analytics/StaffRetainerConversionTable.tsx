export interface StaffRetainerConversionRow {
  key: string;
  name: string;
  db: number;
  contractedDb: number;
}

export function StaffRetainerConversionTable({ start, end, rows, selectedStaff }: {
  start: string;
  end: string;
  rows: readonly StaffRetainerConversionRow[];
  selectedStaff?: string;
}) {
  const sorted = [...rows].sort((a, b) => b.db - a.db || b.contractedDb - a.contractedDb || a.name.localeCompare(b.name, "ko"));
  const totals = rows.reduce((sum, row) => ({ db: sum.db + row.db, contractedDb: sum.contractedDb + row.contractedDb }), { db: 0, contractedDb: 0 });
  const count = (value: number) => `${value.toLocaleString("ko-KR")}건`;
  const rate = (row: { db: number; contractedDb: number }) => row.db > 0 ? `${(row.contractedDb / row.db * 100).toFixed(1)}%` : "—";
  return <section aria-label="직원별 DB 수임 전환 비교" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
      <h2 className="text-sm font-bold text-slate-900">직원별 DB · 수임 전환 비교</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">{start} ~ {end} 접수 DB · 현재 DB 담당자 기준 · 전체 직원 비교</p>
    </div>
    <div className="overflow-x-auto">
      <table aria-label="직원별 기간 배정 DB와 수임 전환율" className="w-full min-w-[520px] text-sm tabular-nums">
        <thead className="bg-slate-50 text-xs text-slate-500"><tr>
          <th scope="col" className="px-4 py-3 text-left sm:px-5">직원</th>
          <th scope="col" className="px-4 py-3 text-right">기간 배정 DB</th>
          <th scope="col" className="px-4 py-3 text-right">수임 전환 건수</th>
          <th scope="col" className="px-4 py-3 text-right sm:px-5">수임 전환율</th>
        </tr></thead>
        <tbody>{sorted.map(row => <tr key={row.key} className={`border-t border-slate-100 ${selectedStaff === row.name ? "bg-indigo-50/70" : "hover:bg-slate-50/70"}`}>
          <th scope="row" className="px-4 py-3 text-left font-semibold text-slate-800 sm:px-5">{row.name}</th>
          <td className="px-4 py-3 text-right text-slate-700">{count(row.db)}</td>
          <td className="px-4 py-3 text-right font-semibold text-slate-800">{count(row.contractedDb)}</td>
          <td className={`px-4 py-3 text-right font-bold sm:px-5 ${row.db > 0 ? "text-indigo-700" : "text-slate-400"}`}>{rate(row)}</td>
        </tr>)}{!rows.length && <tr><td colSpan={4} className="px-5 py-6 text-center text-xs text-slate-400">비교할 직원·배정 DB가 없습니다.</td></tr>}</tbody>
        <tfoot className="border-t border-indigo-100 bg-indigo-50/60 font-bold text-indigo-950"><tr>
          <th scope="row" className="px-4 py-3 text-left sm:px-5">전체 합계</th>
          <td className="px-4 py-3 text-right">{count(totals.db)}</td>
          <td className="px-4 py-3 text-right">{count(totals.contractedDb)}</td>
          <td className="px-4 py-3 text-right sm:px-5">{rate(totals)}</td>
        </tr></tfoot>
      </table>
    </div>
    <p className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-500 sm:px-5">수임 전환율 = 수임 전환 DB ÷ 기간 배정 DB × 100. 취하·0원 계약 제외, 같은 DB의 여러 계약은 1건으로 집계합니다. DB가 없으면 —로 표시하며, 과거 배정 시점·담당자 변경 이력은 추정하지 않습니다.</p>
  </section>;
}
