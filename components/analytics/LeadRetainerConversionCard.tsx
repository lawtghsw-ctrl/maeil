import { InfoHelp } from "@/components/ui/InfoHelp";

export function conversionPeriodLabel(start: string, end: string): "월" | "기간" {
  if (!/^\d{4}-\d{2}-01$/.test(start)) return "기간";
  const [year, month] = start.split("-").map(Number);
  if (month < 1 || month > 12) return "기간";
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) === end ? "월" : "기간";
}

export function LeadRetainerConversionCard({
  start, end, totalDb, retainedDb, scopeLabel = "로펌 전체 DB", basis = "intake", conversionRate, excludedSupplyRows = 0,
}: {
  start: string;
  end: string;
  totalDb: number;
  retainedDb: number;
  scopeLabel?: string;
  basis?: "intake" | "supply";
  conversionRate?: number | null;
  excludedSupplyRows?: number;
}) {
  const rate = basis === "supply" ? conversionRate : totalDb > 0 ? retainedDb / totalDb * 100 : null;
  const percent = totalDb === 0 ? "—" : typeof rate === "number" && Number.isFinite(rate) ? `${rate.toFixed(1)}%` : "확인 필요";
  const label = `${conversionPeriodLabel(start, end)} ${basis === "supply" ? "공급" : "접수"} DB`;
  const smallSample = totalDb < 30;
  return <section aria-label={`${label} 대비 수임 전환율`} className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5">
    <p className="text-xs font-semibold text-indigo-900">{start} ~ {end} · {scopeLabel} · {basis === "supply" ? "공급일" : "접수일"} 기준</p>
    <h2 className={`mt-2 text-xl font-extrabold leading-relaxed tracking-tight sm:text-2xl ${smallSample ? "text-slate-400" : "text-indigo-700"}`}>
      수임 {retainedDb.toLocaleString("ko-KR")}건 / {basis === "supply" ? "공급" : "접수"} DB {totalDb.toLocaleString("ko-KR")}건 · 수임전환율 {percent}
    </h2>
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
      {excludedSupplyRows > 0 && <span className="text-amber-700">연결 누락 {excludedSupplyRows.toLocaleString("ko-KR")}건 제외</span>}
      {totalDb === 0 ? <span>기간 DB 없음 · 0/0</span> : smallSample ? <span>참고 · DB 30건 미만</span> : null}
    </div>
    <InfoHelp className="mt-3" summary={basis === "supply" ? "공급 DB 기준 · 중복 제외" : "접수 DB 기준 · 별도 참고"}>{basis === "supply" ? "선택 기간에 공급되고 원본 DB 연결이 확인된 DB 중 현재 유효 수임이 연결된 비율입니다. 연결 누락 공급은 제외하고, 공급 분류·공급일 또는 계약 연결 자체가 불명확하면 확인 필요로 표시합니다." : "선택 기간에 접수된 전체 DB 중 현재 유효 수임이 연결된 참고 지표입니다."} 기간 이후 수임도 포함하며, 취하·0원 계약은 제외하고 같은 DB의 중복 공급과 여러 계약은 1건으로 집계합니다.</InfoHelp>
  </section>;
}
