import type { FirmSupplySummary } from "@/lib/firm-reporting";
import { LeadRetainerConversionCard } from "./LeadRetainerConversionCard";
import { StaffRetainerConversionTable } from "./StaffRetainerConversionTable";
import { InfoHelp } from "@/components/ui/InfoHelp";

export type SupplyConversionState = { data: FirmSupplySummary | null; loading: boolean; error: string | null };

export function supplyConversionRateLabel(supplied: number, rate: number | null | undefined) {
  return supplied === 0 ? "—" : typeof rate === "number" && Number.isFinite(rate) ? `${rate.toFixed(1)}%` : "확인 필요";
}

function CohortQuality({ quality }: { quality: FirmSupplySummary["supplyCohort"]["quality"] }) {
  const warnings = [
    ["공급 분류 확인 필요", quality.unknownSupplyRows], ["공급일 확인 필요", quality.invalidSupplyDates],
    ["계약 연결 확인 필요", quality.unresolvedContracts],
  ].filter(([, count]) => Number(count) > 0);
  return <>{warnings.length > 0 && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><InfoHelp summary={warnings.map(([label, count]) => `${label} ${Number(count).toLocaleString("ko-KR")}건`).join(" · ")}>연결이 확인된 공급 DB만 계산합니다. 공급일·분류 또는 계약 연결 자체가 불명확한 비율은 확인 필요로 남기며, 다른 직원의 정상 연결 성과는 그대로 표시합니다.</InfoHelp></div>}{quality.duplicateSupplyRows > 0 && <InfoHelp className="px-1" summary={`중복 공급 ${quality.duplicateSupplyRows.toLocaleString("ko-KR")}건 제외`}>같은 DB의 중복 공급 기록은 전환율의 분모에서 한 번만 집계합니다. 원장 기록은 변경하지 않습니다.</InfoHelp>}</>;
}

export function PeriodContractBreakdown({ data }: { data: FirmSupplySummary }) {
  const period = data.periodContracts;
  if (!period) return null;
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span>계약일 기준 전체 수임 <b>{period.total}건</b></span><span>공급 연결 수임 <b>{period.fromSupply}건</b></span><span>공급 외 수임 <b>{period.outsideSupply}건</b>{period.referrals > 0 && <span> · 소개 {period.referrals}건 포함</span>}</span>{period.unlinked > 0 && <span className="text-amber-700">연결 확인 {period.unlinked}건</span>}</div>
    <InfoHelp className="mt-2" summary="계약일 기준 · 공급 전환율과 별도 집계">선택 기간에 계약한 현재 유효 사건 수입니다. 공급 연결 수임은 시점에 관계없이 신규·재유입 공급 원장에 연결된 DB의 계약이며, 공급 외 수임은 해당 공급 연결이 없는 명시적 DB의 계약입니다. 소개는 유입경로가 ‘지인소개’로 확인된 경우만 표시합니다. 같은 DB의 복수 계약은 각각의 사건으로 집계하므로 위 공급일 기준 고유 DB 수임 전환 건수와 다를 수 있습니다.{period.undated > 0 ? ` 계약일 확인이 필요한 ${period.undated}건은 기간 수임에서 제외했습니다.` : ""}</InfoHelp>
  </div>;
}

export function SupplyRetainerConversion({ start, end, data, loading, error, selectedStaff, compact = false }: SupplyConversionState & { start: string; end: string; selectedStaff?: string; compact?: boolean }) {
  if (loading) return <section role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">공급 원장 기준 수임 전환 성과를 불러오는 중입니다.</section>;
  if (error) return <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">공급 성과 확인 필요: {error} 공급 건수와 전환율을 0으로 표시하지 않습니다.</section>;
  if (data && (data.start !== start || data.end !== end)) return <section role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">선택 기간의 공급 성과를 확인하는 중입니다.</section>;
  if (!data?.supplyCohort || !data.matureCohort?.staff) return <section role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">공급 원장 기준 성과를 확인할 수 없습니다.</section>;
  const current = data.supplyCohort, mature = data.matureCohort;
  return <section aria-label="공급 원장 기준 수임 전환 성과" className="space-y-4">
    <LeadRetainerConversionCard start={start} end={end} basis="supply" totalDb={current.supplied} retainedDb={current.retained} conversionRate={current.conversionRate} excludedSupplyRows={current.excludedSupplyRows}/>
    <PeriodContractBreakdown data={data}/>
    {data.serviceMode === "crm_only" && <InfoHelp className="px-1" summary="어드민 이용 계약 · DB 구매비 미적용">공급 원장에 기록된 DB 성과를 집계하며, DB 구매비는 적용하지 않습니다.</InfoHelp>}
    <CohortQuality quality={current.quality}/>
    {!compact && <StaffRetainerConversionTable start={start} end={end} basis="supply" rows={current.staff} totalConversionRate={current.conversionRate} selectedStaff={selectedStaff}/>}
    {!compact && <details className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <summary className="cursor-pointer text-sm font-bold text-slate-800">60일 경과 공급 성과 · 별도 참고 <span className={`ml-2 ${mature.supplied < 30 ? "text-slate-400" : "text-indigo-700"}`}>{supplyConversionRateLabel(mature.supplied, mature.conversionRate)}</span><span className="ml-2 text-xs font-normal text-slate-500">{mature.retained}/{mature.supplied}{mature.supplied > 0 && mature.supplied < 30 ? " · 참고" : ""}</span></summary>
      <div className="mt-4 space-y-4"><p className="text-xs leading-5 text-slate-500">선택한 공급 기간 중 {mature.cutoff}까지 공급되어 60일이 지난 DB만 비교합니다. 위 전체 공급 성과와 별도 모집단이며, 현재 유효 수임을 기준으로 합니다.</p>
        {mature.excludedSupplyRows > 0 && <p className="text-xs text-amber-700">연결 누락 {mature.excludedSupplyRows}건 제외</p>}<CohortQuality quality={mature.quality}/>
        <StaffRetainerConversionTable start={start} end={end} basis="supply" cohortLabel="60일 경과 공급 DB" rows={mature.staff} totalConversionRate={mature.conversionRate} selectedStaff={selectedStaff}/>
      </div>
    </details>}
  </section>;
}
