export function LeadRetainerConversionCard({
  start, end, totalDb, retainedDb, scopeLabel = "로펌 전체 DB",
}: {
  start: string;
  end: string;
  totalDb: number;
  retainedDb: number;
  scopeLabel?: string;
}) {
  const percent = totalDb > 0 ? `${(retainedDb / totalDb * 100).toFixed(1)}%` : "—";
  return <section aria-label="설정 기간 총 DB 대비 수임 전환율" className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-bold text-indigo-950">설정 기간 총 DB → 수임 전환율</h2>
        <p className="mt-1 text-xs text-slate-500">{start} ~ {end} · {scopeLabel} 접수일 기준</p>
      </div>
      <div className="text-right">
        <div className="text-3xl font-extrabold tracking-tight text-indigo-700">{percent}</div>
        <p className="mt-1 text-xs font-semibold text-indigo-900">{totalDb > 0 ? `수임 전환 ${retainedDb.toLocaleString("ko-KR")}건 / 총 DB ${totalDb.toLocaleString("ko-KR")}건` : "기간 DB 없음"}</p>
      </div>
    </div>
    <p className="mt-3 border-t border-indigo-100 pt-3 text-xs leading-5 text-slate-600">선택 기간에 접수된 전체 DB 중 현재 유효 수임이 연결된 비율입니다. 기간 이후 수임도 포함하며, 취하·0원 계약은 제외하고 같은 DB의 여러 계약은 1건으로 집계합니다.</p>
  </section>;
}
