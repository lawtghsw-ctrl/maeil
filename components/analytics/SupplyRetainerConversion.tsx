import type { FirmSupplySummary } from "@/lib/firm-reporting";
import { LeadRetainerConversionCard } from "./LeadRetainerConversionCard";
import { StaffRetainerConversionTable } from "./StaffRetainerConversionTable";

export type SupplyConversionState = { data: FirmSupplySummary | null; loading: boolean; error: string | null };

export function supplyConversionRateLabel(supplied: number, rate: number | null | undefined) {
  return supplied === 0 ? "—" : typeof rate === "number" && Number.isFinite(rate) ? `${rate.toFixed(1)}%` : "확인 필요";
}

function CohortQuality({ quality }: { quality: FirmSupplySummary["supplyCohort"]["quality"] }) {
  const warnings = [
    ["원본 DB 연결 없는 공급", quality.unlinkedRows], ["연결 DB 확인 필요", quality.missingLeads],
    ["공급 분류 확인 필요", quality.unknownSupplyRows], ["공급일 확인 필요", quality.invalidSupplyDates],
    ["계약 연결 확인 필요", quality.unresolvedContracts],
  ].filter(([, count]) => Number(count) > 0);
  return <>{warnings.length > 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">{warnings.map(([label, count]) => `${label} ${Number(count).toLocaleString("ko-KR")}건`).join(" · ")}. 확인되지 않은 연결은 추정하지 않으며, 해당 전환율은 확인 필요로 표시합니다.</p>}{quality.duplicateSupplyRows > 0 && <p className="px-1 text-xs leading-5 text-slate-500">같은 DB의 중복 공급 기록 {quality.duplicateSupplyRows.toLocaleString("ko-KR")}건은 전환율 분모에서 중복 제거했습니다.</p>}</>;
}

export function SupplyRetainerConversion({ start, end, data, loading, error, selectedStaff }: SupplyConversionState & { start: string; end: string; selectedStaff?: string }) {
  if (loading) return <section role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">공급 원장 기준 수임 전환 성과를 불러오는 중입니다.</section>;
  if (error) return <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">공급 성과 확인 필요: {error} 공급 건수와 전환율을 0으로 표시하지 않습니다.</section>;
  if (data && (data.start !== start || data.end !== end)) return <section role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">선택 기간의 공급 성과를 확인하는 중입니다.</section>;
  if (!data?.supplyCohort || !data.matureCohort?.staff) return <section role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">공급 원장 기준 성과를 확인할 수 없습니다.</section>;
  const current = data.supplyCohort, mature = data.matureCohort;
  return <section aria-label="공급 원장 기준 수임 전환 성과" className="space-y-4">
    <LeadRetainerConversionCard start={start} end={end} basis="supply" totalDb={current.supplied} retainedDb={current.retained} conversionRate={current.conversionRate}/>
    {data.serviceMode === "crm_only" && <p className="px-1 text-xs leading-5 text-slate-500">어드민 이용 계약 · 공급 원장에 기록된 DB 성과를 집계하며, DB 구매비는 적용하지 않습니다.</p>}
    <CohortQuality quality={current.quality}/>
    <StaffRetainerConversionTable start={start} end={end} basis="supply" rows={current.staff} totalConversionRate={current.conversionRate} selectedStaff={selectedStaff}/>
    <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <summary className="cursor-pointer text-sm font-bold text-slate-800">60일 경과 공급 성과 · 별도 참고 <span className={`ml-2 ${mature.supplied < 30 ? "text-slate-400" : "text-indigo-700"}`}>{supplyConversionRateLabel(mature.supplied, mature.conversionRate)}</span><span className="ml-2 text-xs font-normal text-slate-500">{mature.retained}/{mature.supplied}{mature.supplied > 0 && mature.supplied < 30 ? " · 참고" : ""}</span></summary>
      <div className="mt-4 space-y-4"><p className="text-xs leading-5 text-slate-500">선택한 공급 기간 중 {mature.cutoff}까지 공급되어 60일이 지난 DB만 비교합니다. 위 전체 공급 성과와 별도 모집단이며, 현재 유효 수임을 기준으로 합니다.</p>
        <CohortQuality quality={mature.quality}/>
        <StaffRetainerConversionTable start={start} end={end} basis="supply" cohortLabel="60일 경과 공급 DB" rows={mature.staff} totalConversionRate={mature.conversionRate} selectedStaff={selectedStaff}/>
      </div>
    </details>
  </section>;
}
