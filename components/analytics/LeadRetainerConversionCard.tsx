export function conversionPeriodLabel(start: string, end: string): "월" | "기간" {
  if (!/^\d{4}-\d{2}-01$/.test(start)) return "기간";
  const [year, month] = start.split("-").map(Number);
  if (month < 1 || month > 12) return "기간";
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) === end ? "월" : "기간";
}

export function LeadRetainerConversionCard({
  start, end, totalDb, retainedDb, scopeLabel = "로펌 전체 DB", basis = "intake", conversionRate,
}: {
  start: string;
  end: string;
  totalDb: number;
  retainedDb: number;
  scopeLabel?: string;
  basis?: "intake" | "supply";
  conversionRate?: number | null;
}) {
  const rate = basis === "supply" ? conversionRate : totalDb > 0 ? retainedDb / totalDb * 100 : null;
  const percent = totalDb === 0 ? "—" : typeof rate === "number" && Number.isFinite(rate) ? `${rate.toFixed(1)}%` : "확인 필요";
  const label = `${conversionPeriodLabel(start, end)} ${basis === "supply" ? "공급" : "접수"} DB`;
  const smallSample = totalDb < 30;
  return <section aria-label={`${label} 대비 수임 전환율`} className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-bold text-indigo-950">{label} → 수임 전환율</h2>
        <p className="mt-1 text-xs text-slate-500">{start} ~ {end} · {scopeLabel} · {basis === "supply" ? "공급 원장 공급일" : "접수일"} 기준</p>
      </div>
      <div className="text-right">
        <div className={`text-3xl font-extrabold tracking-tight ${smallSample ? "text-slate-400" : "text-indigo-700"}`}>{percent}</div>
        <p className="mt-1 text-xs font-semibold text-indigo-900">수임 전환 {retainedDb.toLocaleString("ko-KR")}건 / {label} {totalDb.toLocaleString("ko-KR")}건 · {retainedDb}/{totalDb}</p>
        {totalDb === 0 ? <p className="mt-1 text-xs text-slate-500">기간 DB 없음 · 0/0</p> : smallSample ? <p className="mt-1 text-xs text-slate-500">참고 · DB 30건 미만</p> : null}
      </div>
    </div>
    <p className="mt-3 border-t border-indigo-100 pt-3 text-xs leading-5 text-slate-600">{basis === "supply" ? "선택 기간 공급 원장의 DB 중 현재 유효 수임이 연결된 비율입니다. 같은 DB의 중복 공급은 한 번만 집계하며, 연결이 불명확하면 비율은 확인 필요로 표시합니다." : "선택 기간에 접수된 전체 DB 중 현재 유효 수임이 연결된 참고 지표입니다."} 기간 이후 수임도 포함하며, 취하·0원 계약은 제외하고 같은 DB의 여러 계약은 1건으로 집계합니다.</p>
  </section>;
}
