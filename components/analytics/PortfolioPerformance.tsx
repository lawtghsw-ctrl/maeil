"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Building2, Download, RefreshCw, Search } from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { useStore } from "@/lib/store";
import type { PortfolioFirmPerformance, PortfolioPerformanceReport, PortfolioScope } from "@/lib/performance/portfolio";
import type { PerformanceQuality } from "@/lib/performance/firm";
import { STAGE_GENERIC_LABELS, type CaseStage } from "@/lib/types";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import {
  CHART_COLORS, EmptyPerformance, PerformanceBars, PerformanceDonut, PerformanceMetric,
  PerformancePanel, PerformanceTrend, moneyText, numberText, savePerformanceCsv,
} from "./PerformanceCharts";

export interface PortfolioPerformanceProps { onOpenFirm?: (firmId: string) => void }
type Sort = "contractAmount" | "cash" | "contracts" | "db" | "conversionRate" | "overdueAmount" | "name";
const averageCount = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const scopeText = (scope: PortfolioScope) => scope === "active" ? "현재 이용중인 로펌" : "현재 등록된 전체 로펌";
function todayKst() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function monthDates(offset = 0) {
  const [year, month] = todayKst().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, prefix = `${y}-${String(m).padStart(2, "0")}`;
  return { start: `${prefix}-01`, end: `${prefix}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}` };
}
function recentDays(days: number) {
  const end = todayKst(), start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: start.toISOString().slice(0, 10), end };
}
function LoadingPortfolio() {
  return <div role="status" aria-label="전체 로펌 성과 불러오는 중" className="space-y-5">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-slate-100"/>)}</div>
    <div className="h-72 animate-pulse rounded-2xl bg-slate-100"/><span className="sr-only">전체 로펌 성과를 불러오는 중입니다.</span>
  </div>;
}

export default function PortfolioPerformance({ onOpenFirm }: PortfolioPerformanceProps = {}) {
  const { profile } = useStore();
  const allowed = profile?.isActive === true && profile.platformRole === "super_admin", viewerId = profile?.id;
  const [range, setRange] = useState(() => monthDates());
  const [scope, setScope] = useState<PortfolioScope>("active");
  const [includeDemo, setIncludeDemo] = useState(false);
  const [response, setResponse] = useState<{ viewerId?: string; report: PortfolioPerformanceReport } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const serial = ++sequence.current, controller = new AbortController();
    setError(null);
    if (!allowed) { setResponse(null); setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const params = new URLSearchParams({ start: range.start, end: range.end, scope });
    if (includeDemo) params.set("includeDemo", "1");
    void authJson<PortfolioPerformanceReport>(`/api/platform/firm-performance?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(report => { if (!controller.signal.aborted && serial === sequence.current) setResponse({ viewerId, report }); })
      .catch(reason => { if (!controller.signal.aborted && serial === sequence.current) setError(reason instanceof Error ? reason.message : "전체 로펌 성과를 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted && serial === sequence.current) setLoading(false); });
    return () => controller.abort();
  }, [allowed, viewerId, range.start, range.end, scope, includeDemo, revision]);
  const current = response && response.viewerId === viewerId && response.report.start === range.start && response.report.end === range.end && response.report.scope === scope && response.report.includeDemo === includeDemo ? response.report : null;
  const presets = [{ label: "이번 달", range: monthDates() }, { label: "지난 달", range: monthDates(-1) }, { label: "최근 30일", range: recentDays(30) }, { label: "올해", range: { start: `${todayKst().slice(0, 4)}-01-01`, end: todayKst() } }];
  if (!allowed) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">전체 로펌 성과는 슈퍼관리자만 조회할 수 있습니다.</div>;
  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div><div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-wider text-indigo-600"><Building2 size={14} aria-hidden="true"/>ALL FIRMS · PERFORMANCE</div><h1 className="text-2xl font-extrabold tracking-tight text-slate-950">전체 로펌 업무성과</h1><p className="mt-2 text-sm leading-6 text-slate-500">로펌들의 DB 전환·수임·수납을 합산하고, 로펌당 평균과 각 로펌의 실적을 비교합니다.</p></div>
      <div className="flex flex-wrap items-center gap-2"><DateRangePicker start={range.start} end={range.end} onChange={(start, end) => setRange({ start, end })}/><button type="button" disabled={loading} aria-label="전체 로펌 성과 새로고침" onClick={() => setRevision(value => value + 1)} className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 disabled:opacity-40"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/></button></div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5">{presets.map(item => <button key={item.label} type="button" onClick={() => setRange(item.range)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${range.start === item.range.start && range.end === item.range.end ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500"}`}>{item.label}</button>)}</div>
      <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={includeDemo} onChange={event => setIncludeDemo(event.target.checked)} className="accent-indigo-600"/>시연 로펌 포함</label><label className="flex items-center gap-2 text-xs text-slate-500">로펌 범위<select aria-label="집계 로펌 범위" value={scope} onChange={event => setScope(event.target.value as PortfolioScope)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"><option value="active">이용중 로펌</option><option value="all">전체 로펌 · 이용중지 포함</option></select></label></div>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => setRevision(value => value + 1)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold">다시 불러오기</button></div>}
    {loading || (!current && !error) ? <LoadingPortfolio/> : current && !error ? <PortfolioPerformanceView report={current} onOpenFirm={onOpenFirm}/> : null}
  </div>;
}

const QUALITY_LABELS: Record<keyof PerformanceQuality, string> = {
  orphanPayments: "사건 연결이 없는 입금", orphanCases: "고객 연결이 없는 사건", unlinkedConvertedLeads: "고객·사건 연결 확인이 필요한 전환 DB",
  undatedCompletedPayments: "입금일 없는 완료 회차", invalidLeadDates: "유입일 확인이 필요한 DB", invalidCaseDates: "계약일 확인이 필요한 사건",
  duplicateLeads: "중복 DB ID", duplicateCases: "중복 사건 ID", duplicateClients: "중복 고객 ID", duplicateInstallments: "중복 분납 ID",
  legacyPaidCases: "기존 누적 납부액을 참조한 사건", paidTotalMismatches: "분납과 누적 납부액이 다른 사건",
};

export function PortfolioPerformanceView({ report, onOpenFirm }: { report: PortfolioPerformanceReport } & PortfolioPerformanceProps) {
  const [search, setSearch] = useState(""), [sort, setSort] = useState<Sort>("contractAmount"), [page, setPage] = useState(1);
  const [chartMode, setChartMode] = useState<"total" | "average">("total");
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ko-KR");
    return report.firms.filter(firm => firm.firmName.toLocaleLowerCase("ko-KR").includes(needle)).sort((a, b) => sort === "name"
      ? a.firmName.localeCompare(b.firmName, "ko") || a.firmId.localeCompare(b.firmId)
      : b.summary[sort] - a.summary[sort] || a.firmName.localeCompare(b.firmName, "ko") || a.firmId.localeCompare(b.firmId));
  }, [report.firms, search, sort]);
  const ranking = useMemo(() => {
    const names = new Map<string, number>();
    for (const firm of report.firms) names.set(firm.firmName, (names.get(firm.firmName) ?? 0) + 1);
    return [...report.firms].sort((a, b) => b.summary.contractAmount - a.summary.contractAmount || a.firmName.localeCompare(b.firmName, "ko")).slice(0, 8)
      .map(firm => ({ id: firm.firmId, name: (names.get(firm.firmName) ?? 0) > 1 ? `${firm.firmName} (${firm.firmId})` : firm.firmName, value: firm.summary.contractAmount, secondary: `${firm.summary.contracts}건` }));
  }, [report.firms]);
  const s = report.summary, previous = report.previous, avg = report.average, previousAvg = report.previousAverage;
  const actualPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 20))), pageRows = rows.slice((actualPage - 1) * 20, actualPage * 20);
  const chart = chartMode === "total" ? report.trend : report.averageTrend;
  const averageNote = `${report.firmCount}개 로펌 기준 · 0건 로펌 포함`;
  const qualityRows = (Object.keys(QUALITY_LABELS) as Array<keyof PerformanceQuality>).filter(key => report.quality[key] > 0);
  function exportFirms() {
    savePerformanceCsv([
      ["기간", `${report.start} ~ ${report.end}`], ["집계 범위", scopeText(report.scope)], ["시연 로펌", report.includeDemo ? "포함" : "제외", report.excludedDemoCount], ["평균 분모", report.firmCount, "현재 선택된 로펌 전체 · 실적 0건 포함 · 이전 기간도 동일 분모"],
      ["합산", "유입 DB", "고객전환 DB", "가중 전환율(%)", "유효 수임", "수임액", "기간 실입금", "현재 미수", "현재 연체"],
      ["전체 합산", s.db, s.converted, s.conversionRate, s.contracts, s.contractAmount, s.cash, s.outstanding, s.overdueAmount],
      ["로펌당 평균", "유입 DB", "유효 수임", "수임액", "기간 실입금", "로펌 평균 전환율(%)", "유입 DB가 있는 표본 로펌 수"], ["전체 평균", avg.db, avg.contracts, avg.contractAmount, avg.cash, avg.conversionRate ?? "유입 DB 없음", avg.conversionFirmCount], [],
      ["아래 비교표만 이름 검색 적용", search || "전체"], ["로펌", "상태", "유입 DB", "고객전환 DB", "전환율(%)", "유효 수임", "수임액", "기간 실입금", "현재 미수", "현재 연체"],
      ...rows.map(firm => [firm.firmName, firm.status === "active" ? "이용중" : "이용중지", firm.summary.db, firm.summary.converted, firm.summary.conversionRate, firm.summary.contracts, firm.summary.contractAmount, firm.summary.cash, firm.summary.outstanding, firm.summary.overdueAmount]),
    ], `전체로펌_업무성과_${report.start}_${report.end}.csv`);
  }
  if (!report.firmCount) return <div className="rounded-2xl border border-slate-200 bg-white"><EmptyPerformance title="선택한 범위에 집계할 로펌이 없습니다." description={report.excludedDemoCount ? `시연 로펌 ${report.excludedDemoCount}개는 기본 통계에서 제외했습니다. 시연 로펌 포함을 선택하면 확인할 수 있습니다.` : "이용중 로펌 또는 전체 로펌 범위를 선택해 확인해주세요."}/></div>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-800"><span><b>{scopeText(report.scope)} {numberText(report.firmCount)}개</b> · 합산 실적과 로펌당 평균을 구분해 표시합니다.</span><span className="text-indigo-600">기간 실적이 0건인 로펌도 평균에 포함</span></div>
    {report.includeDemo && report.firms.some(firm => firm.isDemo) ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">시연용 TEST 로펌의 가상 실적이 포함된 통계입니다.</div> : report.excludedDemoCount > 0 ? <p className="px-1 text-xs text-slate-500">시연 로펌 {report.excludedDemoCount}개를 합산·평균에서 제외했습니다.</p> : null}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">
      <PerformanceMetric label="합산 유입 DB" value={`${numberText(s.db)}건`} current={s.db} previous={previous.db} caption={`${report.start} ~ ${report.end}`}/>
      <PerformanceMetric label="전체 DB 고객전환율" value={s.db ? `${s.conversionRate.toFixed(1)}%` : "—"} current={s.db ? s.conversionRate : undefined} previous={previous.db ? previous.conversionRate : undefined} points caption={`합산 전환 ${numberText(s.converted)} / 유입 ${numberText(s.db)}건`}/>
      <PerformanceMetric label="합산 유효 수임" value={`${numberText(s.contracts)}건`} current={s.contracts} previous={previous.contracts} caption="수임액이 있는 계약 · 취하 제외"/>
      <PerformanceMetric label="합산 수임 계약금액" value={moneyText(s.contractAmount)} current={s.contractAmount} previous={previous.contractAmount} dark/>
      <PerformanceMetric label="합산 기간 실입금" value={moneyText(s.cash)} current={s.cash} previous={previous.cash} caption="입금일 기준 · 이전 수임의 입금 포함"/>
      <PerformanceMetric label="합산 현재 연체잔액" value={moneyText(s.overdueAmount)} caption={`현재 미수 ${moneyText(s.outstanding)}`}/>
    </div>
    <section className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 sm:p-5" aria-label="로펌당 평균 성과"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold text-indigo-950">로펌당 평균</h2><p className="text-xs text-indigo-600">{averageNote}</p></div><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <PerformanceMetric label="평균 유입 DB" value={`${averageCount(avg.db)}건`} current={avg.db} previous={previousAvg.db} caption="합산 유입 DB ÷ 로펌 수"/>
      <PerformanceMetric label="평균 유효 수임" value={`${averageCount(avg.contracts)}건`} current={avg.contracts} previous={previousAvg.contracts} caption="합산 유효 수임 ÷ 로펌 수"/>
      <PerformanceMetric label="평균 수임 계약금액" value={moneyText(avg.contractAmount)} current={avg.contractAmount} previous={previousAvg.contractAmount} caption="합산 수임액 ÷ 로펌 수"/>
      <PerformanceMetric label="평균 기간 실입금" value={moneyText(avg.cash)} current={avg.cash} previous={previousAvg.cash} caption="합산 실입금 ÷ 로펌 수"/>
    </div><div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-indigo-100 bg-white/70 px-4 py-3"><span className="text-xs font-semibold text-indigo-950">로펌 평균 고객전환율</span><b className="text-lg text-indigo-700">{avg.conversionRate === null ? "—" : `${avg.conversionRate.toFixed(1)}%`}</b><span className="text-[11px] leading-5 text-indigo-600">유입 DB가 있는 {avg.conversionFirmCount}개 로펌의 전환율을 같은 비중으로 평균 · 유입 0건 로펌 제외</span></div></section>
    <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
      <PerformancePanel title={chartMode === "total" ? "전체 로펌 수임·실입금 합산 추이" : "로펌당 평균 수임·실입금 추이"} description={chartMode === "total" ? "각 로펌의 일별 수임 계약금액과 실제 입금액을 합산합니다." : `각 날짜의 합산 금액 ÷ ${report.firmCount}개 로펌 · 0건 로펌 포함`} action={<div className="flex gap-1 rounded-lg bg-slate-100 p-1">{[{ id: "total", label: "합산" }, { id: "average", label: "로펌당 평균" }].map(item => <button key={item.id} type="button" aria-pressed={chartMode === item.id} onClick={() => setChartMode(item.id as "total" | "average")} className={`rounded-md px-2.5 py-1.5 text-[11px] font-bold ${chartMode === item.id ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`}>{item.label}</button>)}</div>}>
        <PerformanceTrend labels={chart.map(day => day.date)} series={[{ name: "수임 계약금액", color: CHART_COLORS[0], values: chart.map(day => day.contractAmount) }, { name: "실입금", color: CHART_COLORS[1], values: chart.map(day => day.cash) }]} money/>
      </PerformancePanel>
      <PerformancePanel title="로펌별 수임 성과" description="수임 계약금액 상위 8개 로펌 · 로펌을 선택하면 상세 성과로 이동"><PerformanceBars rows={ranking} money onSelect={onOpenFirm ? name => { const firm = ranking.find(item => item.name === name); if (firm) onOpenFirm(firm.id); } : undefined}/></PerformancePanel>
    </div>
    <div className="grid gap-5 xl:grid-cols-3">
      <PerformancePanel title="전체 유입 DB·고객전환 합산" description="유입일별 DB 중 현재 고객으로 전환된 수입니다."><PerformanceTrend labels={report.trend.map(day => day.date)} series={[{ name: "유입 DB", color: CHART_COLORS[0], values: report.trend.map(day => day.db) }, { name: "고객전환", color: CHART_COLORS[1], values: report.trend.map(day => day.converted) }]}/></PerformancePanel>
      <PerformancePanel title="전체 DB 상담 단계" description="선택 기간 유입 DB의 현재 단계 · 전체 로펌 합산"><PerformanceDonut rows={report.funnel.map(row => ({ name: row.name, value: row.count }))} label="합산 유입 DB"/></PerformancePanel>
      <PerformancePanel title="전체 수임 사건 유형" description="선택 기간의 유효 수임 · 전체 로펌 합산"><PerformanceDonut rows={report.caseTypes.map(row => ({ name: row.name, value: row.contracts }))} label="합산 유효 수임"/></PerformancePanel>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1fr_1.45fr]">
      <PerformancePanel title="현재 사건 단계 합산" description="현재 유효 수임 사건의 단계 · 종결 사건 포함"><PerformanceBars rows={report.stages.map(row => ({ name: STAGE_GENERIC_LABELS[row.name as CaseStage] ?? row.name, value: row.count }))}/></PerformancePanel>
      <PerformancePanel title="현재 업무·수납 현황" description="현재 잔액·진행 건수와 선택 기간 실적을 구분합니다."><div className="grid gap-3 p-5 sm:grid-cols-2">{[
        { label: "현재 진행 중인 유효 수임", value: `${numberText(s.activeCases)}건`, note: "현재 담당 로펌의 진행 사건 합산" },
        { label: "현재 진행 중인 DB", value: `${numberText(s.activeDb)}건`, note: "고객전환·종결 전 DB 합산" },
        { label: "기간 취하 사건", value: `${numberText(s.cancelled)}건`, note: "계약일이 선택 기간에 포함" },
        { label: "기간 금액 미등록 계약", value: `${numberText(s.zeroFeeCases)}건`, note: "유효 수임 실적에서 제외" },
      ].map(item => <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4"><div className="text-xs text-slate-500">{item.label}</div><div className="mt-2 text-xl font-extrabold text-slate-900">{item.value}</div><div className="mt-1 text-[11px] text-slate-400">{item.note}</div></div>)}</div></PerformancePanel>
    </div>
    <PerformancePanel title="로펌별 업무성과 비교" description="검색은 아래 표에만 적용됩니다. 직원·변호사 성과와 담당 배정은 로펌 상세에서 확인하세요." action={<button type="button" onClick={exportFirms} className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700"><Download size={14}/>성과 CSV</button>}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><label className="relative"><Search size={14} aria-hidden="true" className="absolute left-3 top-2.5 text-slate-400"/><input aria-label="로펌 이름 검색" placeholder="로펌 이름 검색" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="h-9 w-56 rounded-lg border border-slate-200 pl-9 pr-3 text-xs"/></label><label className="flex items-center gap-2 text-xs text-slate-500">정렬<select aria-label="로펌 성과 정렬" value={sort} onChange={event => { setSort(event.target.value as Sort); setPage(1); }} className="h-9 rounded-lg border border-slate-200 px-3 text-xs"><option value="contractAmount">수임금액 높은순</option><option value="cash">실입금 높은순</option><option value="contracts">수임 건수 많은순</option><option value="db">유입 DB 많은순</option><option value="conversionRate">전환율 높은순</option><option value="overdueAmount">연체잔액 높은순</option><option value="name">로펌 이름순</option></select></label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["로펌", "유입 DB", "고객전환율", "유효 수임", "수임 계약금액", "기간 실입금", "현재 미수", "현재 연체", "직원·변호사"].map((label, index) => <th key={label} scope="col" className={`whitespace-nowrap px-4 py-3 ${index === 0 || index === 8 ? "text-left" : "text-right"}`}>{label}</th>)}</tr></thead><tbody>{pageRows.map(firm => <PortfolioFirmRow key={firm.firmId} firm={firm} onOpenFirm={onOpenFirm}/>)}</tbody></table>{!rows.length && <EmptyPerformance title="검색한 로펌이 없습니다."/>}</div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500"><span>검색 결과 {numberText(rows.length)} / {numberText(report.firmCount)}개 로펌</span><div className="flex items-center gap-3"><button type="button" disabled={actualPage <= 1} onClick={() => setPage(actualPage - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-30">이전</button><span>{actualPage} / {Math.max(1, Math.ceil(rows.length / 20))}</span><button type="button" disabled={actualPage >= Math.ceil(rows.length / 20)} onClick={() => setPage(actualPage + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-30">다음</button></div></div>
    </PerformancePanel>
    <details className="rounded-xl border border-slate-200 bg-slate-50/70 text-xs text-slate-500"><summary className="cursor-pointer px-4 py-3 font-semibold text-slate-600">합산·평균 집계 기준{qualityRows.length > 0 && <span className="ml-2 text-amber-700">원본 데이터 확인 항목 있음</span>}</summary><div className="space-y-2 border-t border-slate-200 px-4 py-4 leading-6">
      <p>현재 선택된 {scopeText(report.scope)} {report.firmCount}개를 각각 집계한 뒤 합산합니다. 같은 사건 ID·직원 이름이 다른 로펌에 있어도 서로 합쳐 연결하지 않습니다. 직원과 변호사 상세 관리는 각 로펌에서 진행합니다.</p>
      <p>로펌당 평균은 합산 유입·수임·수임액·실입금을 각각 {report.firmCount}로 나눈 값입니다. 기간 실적이 없는 로펌과 해당 기간 이후 등록된 로펌도 현재 선택 범위에 속하면 포함합니다. 이전 기간({report.previousStart} ~ {report.previousEnd})에도 동일한 현재 로펌 집합을 사용합니다. 평균 건수는 소수 첫째 자리, 금액은 원 단위로 표시합니다.</p>
      <p>전체 DB 전환율은 <b>합산 고객전환 DB ÷ 합산 유입 DB</b>입니다. 별도의 로펌 평균 고객전환율은 유입 DB가 있는 {avg.conversionFirmCount}개 로펌의 전환율을 같은 비중으로 평균하며, 유입 0건 로펌은 이 비율의 분모에서 제외합니다. 전환은 유입일 기준 DB의 현재 고객전환 상태이며, 유효 수임은 선택 기간 계약일·양수 수임액·취하 제외 기준입니다.</p>
      <p>기간 실입금은 완료 분납의 실제 납부액을 우선 사용하고, 없는 과거 회차만 예정금액을 사용합니다. 입금일 없는 완료 회차는 기간 입금에서 제외합니다. 현재 미수·연체·진행 현황은 과거 시점 비교 대상이 아닙니다. 이 화면의 수임·수납은 로펌 업무성과이며 플랫폼의 DB 판매금액과 구분됩니다.</p>
      {qualityRows.length > 0 && <p className="text-amber-800">{qualityRows.map(key => `${QUALITY_LABELS[key]} ${numberText(report.quality[key])}건`).join(" · ")}. 로펌 상세와 원본 데이터를 확인해주세요.</p>}
    </div></details>
  </div>;
}

function PortfolioFirmRow({ firm, onOpenFirm }: { firm: PortfolioFirmPerformance } & PortfolioPerformanceProps) {
  const s = firm.summary;
  return <tr className="border-t border-slate-100 hover:bg-slate-50/60"><td className="px-4 py-4"><div className="font-bold text-slate-800">{firm.firmName}</div><span className={`mt-1 inline-block text-[10px] ${firm.status === "active" ? "text-emerald-600" : "text-slate-400"}`}>{firm.status === "active" ? "이용중" : "이용중지"}</span></td><td className="px-4 py-4 text-right">{numberText(s.db)}</td><td className="px-4 py-4 text-right"><b className="text-indigo-700">{s.db ? `${s.conversionRate.toFixed(1)}%` : "—"}</b><div className="mt-1 text-[10px] text-slate-400">{numberText(s.converted)}건 전환</div></td><td className="px-4 py-4 text-right font-bold">{numberText(s.contracts)}건</td><td className="px-4 py-4 text-right font-bold">{moneyText(s.contractAmount)}</td><td className="px-4 py-4 text-right font-semibold text-emerald-700">{moneyText(s.cash)}</td><td className="px-4 py-4 text-right">{moneyText(s.outstanding)}</td><td className={`px-4 py-4 text-right ${s.overdueAmount ? "font-bold text-rose-600" : "text-slate-400"}`}>{moneyText(s.overdueAmount)}</td><td className="px-4 py-4">{onOpenFirm ? <button type="button" onClick={() => onOpenFirm(firm.firmId)} aria-label={`${firm.firmName} 직원·변호사 성과 상세`} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-700">로펌 상세<ArrowRight size={12}/></button> : <span className="text-slate-400">로펌 상세에서 확인</span>}</td></tr>;
}
