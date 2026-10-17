"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, BarChart3, Building2, CalendarDays, Download, Info, RefreshCw, Search, TrendingUp, WalletCards, X } from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { useStoreSession as useStore } from "@/lib/store";
import {
  performanceMonthNow,
  summarizePlatformMonth,
  type PlatformFirmPerformance,
  type PlatformMonthSummary,
  type PlatformPerformanceResponse,
} from "@/lib/performance/platform";

export interface PlatformPerformanceProps { onDetailedAnalysis?: () => void; embedded?: boolean; refreshKey?: number }
type SortKey = "revenue" | "supply" | "conversion" | "name";
const count = (value: number) => value.toLocaleString("ko-KR");
const money = (value: number | null) => value === null ? "확인 필요" : `${Math.round(value).toLocaleString("ko-KR")}원`;
const rate = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
const billingLabel = (value: string) => ({ per_lead: "건별 과금", monthly: "월정액", manual: "수기 청구" }[value] ?? "과금 확인 필요");
const compact = (value: number) => Math.abs(value) >= 100000000 ? `${(value / 100000000).toFixed(1)}억` : Math.abs(value) >= 10000 ? `${Math.round(value / 10000)}만` : count(Math.round(value));

function Metric({ label, value, note, icon: Icon, dark = false }: { label: string; value: string; note: string; icon: typeof Building2; dark?: boolean }) {
  return <div className={`min-w-0 rounded-2xl border p-5 ${dark ? "border-indigo-700 bg-indigo-700 text-white shadow-lg shadow-indigo-100" : "border-slate-200 bg-white shadow-sm"}`}>
    <div className={`flex items-center justify-between text-xs font-semibold ${dark ? "text-indigo-100" : "text-slate-500"}`}><span>{label}</span><Icon size={17} aria-hidden="true"/></div>
    <div className="mt-4 break-words text-2xl font-bold tracking-tight xl:text-3xl">{value}</div>
    <div className={`mt-3 text-[11px] leading-5 ${dark ? "text-indigo-100" : "text-slate-500"}`}>{note}</div>
  </div>;
}

function TrendChart({ rows }: { rows: PlatformMonthSummary[] }) {
  const titleId = useId();
  const values = rows.flatMap(row => [row.perLeadBillingRevenue, row.adSpend ?? 0, row.contribution ?? 0]);
  const high = Math.max(1, ...values), low = Math.min(0, ...values);
  const width = 680, left = 55, top = 18, plotHeight = 190, plotWidth = 600;
  const y = (value: number) => top + (high - value) / (high - low) * plotHeight;
  const zero = y(0);
  const step = plotWidth / Math.max(1, rows.length);
  const ticks = [...new Set([high, high / 2, 0, ...(low < 0 ? [low] : [])])];
  return <div>
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
      <span><i className="mr-1.5 inline-block size-2 rounded-sm bg-indigo-600"/>건별 청구매출</span>
      <span><i className="mr-1.5 inline-block size-2 rounded-sm bg-slate-300"/>등록 광고비</span>
      <span><i className="mr-1.5 inline-block size-2 rounded-sm bg-emerald-500"/>광고비 차감이익</span>
    </div>
    <svg className="h-auto w-full" viewBox={`0 0 ${width} 250`} role="img" aria-labelledby={titleId}>
      <title id={titleId}>최근 6개월 건별 청구매출·등록 광고비·광고비 차감이익. 미확정 금액은 표시하지 않습니다.</title>
      {ticks.map(tick => <g key={tick}><line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#cbd5e1" : "#f1f5f9"}/><text x={left - 8} y={y(tick) + 4} textAnchor="end" fill="#94a3b8" fontSize="10">{compact(tick)}</text></g>)}
      {rows.map((row, index) => {
        const center = left + step * (index + 0.5);
        const series = [{ value: row.perLeadBillingRevenue, color: "#4f46e5", label: "건별 청구매출" }, { value: row.adSpend, color: "#cbd5e1", label: "등록 광고비" }, { value: row.contribution, color: (row.contribution ?? 0) < 0 ? "#f43f5e" : "#10b981", label: "광고비 차감이익" }];
        return <g key={row.month}>{series.map((item, seriesIndex) => item.value === null ? null : <rect key={item.label} x={center - 24 + seriesIndex * 17} y={Math.min(zero, y(item.value))} width="13" height={Math.abs(y(item.value) - zero)} rx="2" fill={item.color}><title>{row.month} {item.label} {money(item.value)}</title></rect>)}<text x={center} y="233" textAnchor="middle" fill="#64748b" fontSize="11">{row.month.slice(2).replace("-", ".")}</text></g>;
      })}
    </svg>
    <div className="text-[11px] leading-5 text-slate-400">미등록 광고비·미확정 이익은 막대를 표시하지 않습니다. 음수 이익은 기준선 아래에 표시합니다.</div>
  </div>;
}

function csvCell(value: string | number | null) {
  const raw = value === null ? "확인 필요" : String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportPerformance(data: PlatformPerformanceResponse, firms: PlatformFirmPerformance[], trend: PlatformMonthSummary[]) {
  const rows: Array<Array<string | number | null>> = [
    ["로파워 로펌 성과", data.month],
    ["집계시각", data.generatedAt],
    ["로펌", "상태", "현재 과금방식", "현재 단가", "공급 당시 건별 평균판매가", "원장 유입", "신규", "재유입", "중복", "공급 고유리드", "현재 전환 고유리드", "공급월 전환율(%)", "건별 청구매출", "전체 청구액 확인", "광고비", "광고비 등록상태", "광고비 기준", "광고비 차감이익"],
    ...firms.map(firm => [firm.firmName, firm.firmStatus === "active" ? "이용중" : "이용중지", billingLabel(firm.currentBillingType), firm.currentUnitPrice, firm.avgSoldUnitPrice, firm.rawEvents, firm.newEvents, firm.reentryEvents, firm.duplicateEvents, firm.suppliedLeads, firm.convertedLeads, firm.conversionRate, firm.perLeadBillingRevenue, firm.billingNeedsConfirmation ? "확인 필요" : "건별 원장 기준", firm.adSpend, firm.adSpendStatus === "registered" ? "등록" : firm.adSpendStatus === "invalid" ? "입력 확인 필요" : "미등록", firm.adSpendSource === "month_closing" ? "월마감 스냅샷" : "현재 정산설정", firm.contribution]),
    [], ["최근 6개월", "공급 고유리드", "현재 전환 고유리드", "건별 청구매출", "광고비", "광고비 차감이익", "청구 확인 필요 로펌", "광고비 미등록 로펌"],
    ...trend.map(row => [row.month, row.suppliedLeads, row.convertedLeads, row.perLeadBillingRevenue, row.adSpend, row.contribution, row.pendingBillingFirmCount, row.unregisteredCostFirmCount]),
    [], ["지표", "집계 기준"], ...data.definitions.map(item => [item.label, item.description]),
  ];
  const blob = new Blob(["\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `로파워_로펌성과_${data.month}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportPerformanceXlsx(data: PlatformPerformanceResponse, firms: PlatformFirmPerformance[], trend: PlatformMonthSummary[]) {
  const XLSX = await import("xlsx");
  const totals = trend[trend.length - 1] ?? summarizePlatformMonth(firms, data.month);
  const value = (amount: number | null) => amount === null ? "확인 필요" : amount;
  const workbook = XLSX.utils.book_new();
  const sheets: Array<{ name: string; rows: Array<Array<string | number>> }> = [
    { name: "플랫폼요약", rows: [["로파워 로펌별 판매 성과"], ["조회월", data.month], ["조회시각", data.generatedAt], ["집계 범위", "선택한 로펌 범위 · 검색은 로펌별 목록에만 적용"], ["고유 공급 DB", totals.suppliedLeads], ["현재 전환 고유 리드", totals.convertedLeads], ["공급월 전환율(%)", value(totals.conversionRate)], ["건별 청구매출", totals.perLeadBillingRevenue], ["청구 확인 필요 로펌", totals.pendingBillingFirmCount], ["등록 광고비", value(totals.adSpend)], ["광고비 확인 필요 로펌", totals.unregisteredCostFirmCount + totals.invalidCostFirmCount], ["광고비 차감이익", value(totals.contribution)], ["연결 ID 없는 공급", totals.unlinkedSupplyEvents], ["현재 상태 미확인 리드", totals.missingConversionLeads]] },
    { name: "로펌별손익", rows: [["로펌", "현재 과금방식", "현재 단가", "공급 당시 건별 평균판매가", "신규", "재유입", "중복", "고유 공급 DB", "현재 전환 고유 리드", "공급월 전환율(%)", "건별 청구매출", "전체 청구액", "등록 광고비", "광고비 기준", "광고비 차감이익"], ...firms.map(firm => [firm.firmName, billingLabel(firm.currentBillingType), value(firm.currentUnitPrice), value(firm.avgSoldUnitPrice), firm.newEvents, firm.reentryEvents, firm.duplicateEvents, firm.suppliedLeads, firm.convertedLeads, value(firm.conversionRate), firm.perLeadBillingRevenue, value(firm.billingRevenue), value(firm.adSpend), firm.adSpendSource === "month_closing" ? "월마감 스냅샷" : "현재 정산설정", value(firm.contribution)])] },
    { name: "월별추이", rows: [["월", "고유 공급 DB", "현재 전환 고유 리드", "공급월 전환율(%)", "건별 청구매출", "등록 광고비", "광고비 차감이익", "청구 확인 필요 로펌", "광고비 확인 필요 로펌"], ...trend.map(row => [row.month, row.suppliedLeads, row.convertedLeads, value(row.conversionRate), row.perLeadBillingRevenue, value(row.adSpend), value(row.contribution), row.pendingBillingFirmCount, row.unregisteredCostFirmCount + row.invalidCostFirmCount])] },
    { name: "산식기준", rows: [["지표", "집계 기준"], ...data.definitions.map(item => [item.label, item.description])] },
  ];
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    worksheet["!cols"] = sheet.name === "산식기준" ? [{ wch: 24 }, { wch: 100 }] : sheet.rows[0].map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  XLSX.writeFile(workbook, `로파워_플랫폼손익_${data.month}.xlsx`);
}

export default function PlatformPerformance({ onDetailedAnalysis, embedded = false, refreshKey = 0 }: PlatformPerformanceProps = {}) {
  const { profile } = useStore();
  const allowed = profile?.isActive === true && profile.platformRole === "super_admin";
  const viewerId = profile?.id;
  const [month, setMonth] = useState(performanceMonthNow);
  const [firmId, setFirmId] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [data, setData] = useState<PlatformPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    setError(null);
    setDetailId(null);
    if (!allowed) { setData(null); setLoading(false); return () => controller.abort(); }
    setLoading(true);
    void authJson<PlatformPerformanceResponse>(`/api/platform/performance?month=${encodeURIComponent(month)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && sequence === requestSequence.current) setData(result); })
      .catch(reason => { if (!controller.signal.aborted && sequence === requestSequence.current) { setData(null); setError(reason instanceof Error ? reason.message : "성과 데이터를 불러오지 못했습니다."); } })
      .finally(() => { if (!controller.signal.aborted && sequence === requestSequence.current) setLoading(false); });
    return () => controller.abort();
  }, [allowed, viewerId, month, revision, refreshKey]);

  const current = data?.month === month ? data : null;
  const scope = useMemo(() => (current?.firms ?? []).filter(firm => !firmId || firm.lawFirmId === firmId), [current, firmId]);
  const totals = useMemo(() => summarizePlatformMonth(scope, month), [scope, month]);
  const trend = useMemo(() => (current?.months ?? []).map((key, index) => summarizePlatformMonth(scope.map(firm => firm.history[index]), key)), [current, scope]);
  const ranked = useMemo(() => scope.filter(firm => firm.conversionRate !== null).sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0) || b.suppliedLeads - a.suppliedLeads).slice(0, 6), [scope]);
  const visible = useMemo(() => {
    const filtered = scope.filter(firm => firm.firmName.toLocaleLowerCase("ko-KR").includes(search.trim().toLocaleLowerCase("ko-KR")));
    return filtered.sort((a, b) => sort === "name" ? a.firmName.localeCompare(b.firmName, "ko") : sort === "supply" ? b.suppliedLeads - a.suppliedLeads : sort === "conversion" ? (b.conversionRate ?? -1) - (a.conversionRate ?? -1) : b.perLeadBillingRevenue - a.perLeadBillingRevenue);
  }, [scope, search, sort]);
  const detail = scope.find(firm => firm.lawFirmId === detailId);
  const pendingCosts = totals.unregisteredCostFirmCount + totals.invalidCostFirmCount;
  const Heading = embedded ? "h2" : "h1";

  async function downloadXlsx() {
    if (!current || exporting) return;
    setExporting(true);
    try { await exportPerformanceXlsx(current, visible, trend); }
    catch (reason) { window.alert(reason instanceof Error ? reason.message : "엑셀 파일을 생성하지 못했습니다. 다시 시도해주세요."); }
    finally { setExporting(false); }
  }

  if (!allowed) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">로펌 성과는 로파워 최고관리자에게 제공됩니다.</div>;

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-indigo-600"><Building2 size={14} aria-hidden="true"/>LAWPOWER · FIRM PERFORMANCE</div><Heading className="text-2xl font-bold tracking-tight text-slate-950">{embedded ? "로펌별 판매 성과" : "로펌 성과"}</Heading><p className="mt-2 text-sm leading-6 text-slate-500">로펌별 DB 공급부터 청구매출, 광고비, 계약 전환까지 한눈에 확인합니다.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm"><CalendarDays size={16} className="text-slate-400" aria-hidden="true"/><span className="sr-only">조회월</span><input aria-label="조회월" type="month" min="1901-01" max="2199-12" value={month} onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value); }} className="min-w-0 bg-transparent text-sm font-semibold outline-none"/></label>
        <label><span className="sr-only">로펌 선택</span><select value={firmId} onChange={event => { setFirmId(event.target.value); setDetailId(null); }} className="h-10 max-w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">전체 로펌</option>{(current?.firms ?? []).map(firm => <option value={firm.lawFirmId} key={firm.lawFirmId}>{firm.firmName}</option>)}</select></label>
        <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} title="새로고침" aria-label="성과 새로고침" className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 disabled:opacity-40"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/></button>
        <button type="button" disabled={loading || !current} onClick={() => current && exportPerformance(current, visible, trend)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"><Download size={15} aria-hidden="true"/>CSV 내보내기</button>
        <button type="button" disabled={loading || !current || exporting} onClick={() => void downloadXlsx()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"><Download size={15} aria-hidden="true"/>{exporting ? "엑셀 생성 중..." : "엑셀 다운로드"}</button>
      </div>
    </header>

    {loading ? <div role="status" aria-live="polite" className="space-y-5"><span className="sr-only">로펌 성과를 불러오는 중입니다.</span><div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map(index => <div key={index} className="h-40 animate-pulse rounded-2xl bg-slate-100"/>)}</div><div className="h-80 animate-pulse rounded-2xl bg-slate-100"/></div> : error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6"><p className="font-semibold text-rose-800">성과 데이터를 불러오지 못했습니다.</p><p className="mt-2 text-sm text-rose-700">{error}</p><button type="button" onClick={() => setRevision(value => value + 1)} className="mt-4 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700">다시 불러오기</button></div> : current ? <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="공급 DB" value={`${count(totals.suppliedLeads)}건`} note={`신규 ${count(totals.newEvents)} · 재유입 ${count(totals.reentryEvents)}`} icon={Building2}/>
        <Metric label="건별 청구매출" value={money(totals.perLeadBillingRevenue)} note={totals.pendingBillingFirmCount ? `월정액·수기 등 ${totals.pendingBillingFirmCount}개 로펌 별도 확인 필요` : `공급 당시 단가 기준 · 과금 ${count(totals.perLeadBillableEvents)}건`} icon={WalletCards} dark/>
        <Metric label="광고비 차감이익" value={money(totals.contribution)} note={totals.contribution === null ? `청구 확인 ${totals.pendingBillingFirmCount}곳 · 광고비 확인 ${pendingCosts}곳` : `등록 광고비 ${money(totals.adSpend)} 차감`} icon={TrendingUp}/>
        <Metric label="공급월 전환율" value={rate(totals.conversionRate)} note={`고유 공급 ${count(totals.suppliedLeads)}건 중 현재 전환 ${count(totals.convertedLeads)}건`} icon={BarChart3}/>
      </div>

      {(totals.pendingBillingFirmCount > 0 || pendingCosts > 0 || totals.unlinkedSupplyEvents > 0 || totals.missingConversionLeads > 0) && <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900"><Info size={16} className="mt-1 shrink-0" aria-hidden="true"/><p>{totals.pendingBillingFirmCount > 0 && `월정액·수기 청구 또는 단가 확인이 필요한 로펌 ${totals.pendingBillingFirmCount}곳이 있습니다. `}{pendingCosts > 0 && `활동 로펌 중 광고비 미등록·입력 확인 ${pendingCosts}곳은 이익을 계산하지 않습니다. `}{totals.unlinkedSupplyEvents > 0 && `리드 ID가 없는 공급 ${totals.unlinkedSupplyEvents}건이 있어 고유 공급 수가 불완전하며 전환율을 표시하지 않습니다. `}{totals.missingConversionLeads > 0 && `현재 상태를 확인할 수 없는 리드 ${totals.missingConversionLeads}건이 있어 전환율을 표시하지 않습니다.`}</p></div>}

      {totals.activeFirmCount === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">선택한 월에 확인되는 공급 원장이나 광고비 입력 내역이 없습니다. 과거 이관 데이터는 이 화면의 집계에서 제외됩니다.</div>}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5"><h2 className="font-bold text-slate-900">최근 6개월 흐름</h2><p className="mt-1 text-xs text-slate-400">선택한 로펌 범위 · 공급월 기준</p></div><TrendChart rows={trend}/></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5 flex items-start justify-between"><div><h2 className="font-bold text-slate-900">전환율 상위 로펌</h2><p className="mt-1 text-xs text-slate-400">선택 월 공급의 현재 전환 · 표본 수 함께 표시</p></div><TrendingUp size={18} className="text-emerald-500" aria-hidden="true"/></div>
          {ranked.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-slate-400">비교할 공급·전환 데이터가 없습니다.</div> : <div className="space-y-4">{ranked.map((firm, index) => <button type="button" key={firm.lawFirmId} onClick={() => setDetailId(firm.lawFirmId)} className="group block w-full text-left"><div className="mb-2 flex items-center gap-2 text-xs"><span className="w-4 font-bold text-slate-300">{index + 1}</span><span className="min-w-0 flex-1 truncate font-semibold text-slate-700 group-hover:text-indigo-600">{firm.firmName}</span><span className="font-bold text-indigo-600">{rate(firm.conversionRate)}</span><span className="text-slate-400">{firm.convertedLeads}/{firm.suppliedLeads}</span></div><div className="ml-6 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${firm.conversionRate ?? 0}%` }}/></div></button>)}</div>}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="font-bold text-slate-900">로펌별 성과 <span className="ml-1 text-sm font-normal text-slate-400">{visible.length}곳</span></h2><p className="mt-1 text-xs text-slate-400">현재 단가와 공급 당시 단가를 구분합니다. 검색은 아래 목록에 적용됩니다.</p></div><div className="flex flex-wrap gap-2"><label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3"><Search size={14} className="text-slate-400" aria-hidden="true"/><span className="sr-only">로펌명 검색</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="로펌명 검색" className="w-36 text-xs outline-none"/></label><label><span className="sr-only">성과 정렬</span><select value={sort} onChange={event => setSort(event.target.value as SortKey)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs"><option value="revenue">건별 청구매출 높은순</option><option value="supply">공급 DB 많은순</option><option value="conversion">전환율 높은순</option><option value="name">로펌명순</option></select></label></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1080px] whitespace-nowrap text-right text-xs"><thead className="bg-slate-50 text-[11px] text-slate-500"><tr>{["로펌", "공급 DB", "신규 / 재유입", "현재 단가", "건별 평균판매가", "건별 청구매출", "등록 광고비", "광고비 차감이익", "전환율"].map((heading, index) => <th key={heading} className={`px-4 py-3 font-semibold ${index === 0 ? "text-left" : ""}`}>{heading}</th>)}</tr></thead><tbody>{visible.map(firm => <tr key={firm.lawFirmId} className="border-t border-slate-100 hover:bg-indigo-50/30"><td className="px-4 py-4 text-left"><button type="button" onClick={() => setDetailId(firm.lawFirmId)} className="inline-flex items-center gap-1.5 font-bold text-slate-800 hover:text-indigo-600">{firm.firmName}<ArrowUpRight size={12}/></button><div className="mt-1 text-[10px] text-slate-400">{billingLabel(firm.currentBillingType)}{firm.firmStatus !== "active" ? " · 이용중지" : ""}</div></td><td className="px-4 py-4 font-bold">{count(firm.suppliedLeads)}</td><td className="px-4 py-4 text-slate-500">{count(firm.newEvents)} / {count(firm.reentryEvents)}</td><td className="px-4 py-4">{money(firm.currentUnitPrice)}</td><td className="px-4 py-4">{firm.avgSoldUnitPrice === null ? "—" : money(firm.avgSoldUnitPrice)}</td><td className="px-4 py-4 font-bold text-indigo-700">{money(firm.perLeadBillingRevenue)}{firm.billingNeedsConfirmation && <div className="mt-1 text-[10px] font-medium text-amber-700">전체 청구 확인 필요</div>}</td><td className="px-4 py-4">{firm.adSpend === null ? <span className="text-amber-700">{firm.adSpendStatus === "invalid" ? "입력 확인" : "미등록"}</span> : money(firm.adSpend)}{firm.adSpendSource === "month_closing" && <div className="mt-1 text-[10px] text-slate-400">월마감 기준</div>}</td><td className={`px-4 py-4 font-semibold ${firm.contribution === null ? "text-slate-400" : firm.contribution < 0 ? "text-rose-600" : "text-emerald-700"}`}>{firm.contribution === null ? "확인 필요" : money(firm.contribution)}</td><td className="px-4 py-4"><span className="font-bold text-slate-800">{rate(firm.conversionRate)}</span><div className="mt-1 text-[10px] text-slate-400">{firm.convertedLeads}/{firm.suppliedLeads}건</div></td></tr>)}{visible.length === 0 && <tr><td colSpan={9} className="px-6 py-14 text-center text-sm text-slate-400">{search ? "검색한 로펌이 없습니다." : "표시할 로펌이 없습니다."}</td></tr>}</tbody></table></div>
      </section>

      {detail && <section aria-label={`${detail.firmName} 성과 상세`} className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">{detail.firmName} · {month}</h2><p className="mt-1 text-xs text-slate-500">원장과 설정에서 확인되는 집계 상세</p></div><button type="button" aria-label="성과 상세 닫기" onClick={() => setDetailId(null)} className="rounded-lg p-2 text-slate-500 hover:bg-white"><X size={18}/></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["원장 유입", `${detail.rawEvents}건 (신규 ${detail.newEvents} · 재유입 ${detail.reentryEvents})`], ["과금 원장", `${detail.billableEvents}건 · 건별 ${detail.perLeadBillableEvents}건 · 미확정 ${detail.unconfirmedBillingEvents}건`], ["광고비 기준", detail.adSpendSource === "month_closing" ? `월마감 스냅샷${detail.closedAt ? ` · ${new Date(detail.closedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}` : "현재 정산설정의 해당 월 입력값"], ["전환 확인", `고유 리드 ${detail.suppliedLeads}건 · 상태 미확인 ${detail.missingConversionLeads}건 · 연결 ID 없음 ${detail.unlinkedSupplyEvents}건`]].map(([label, value]) => <div key={label}><div className="text-[11px] font-semibold text-indigo-600">{label}</div><div className="mt-2 text-xs leading-6 text-slate-600">{value}</div></div>)}</div></section>}

      <details className="rounded-xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold text-slate-700">집계 기준과 금액 확인</summary><div className="mt-5 grid gap-5 lg:grid-cols-2">{current.definitions.map(item => <div key={item.label}><h3 className="text-xs font-bold text-slate-700">{item.label}</h3><p className="mt-1 text-xs leading-6 text-slate-500">{item.description}</p></div>)}</div></details>
      <footer className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400"><span>조회 기준 {new Date(current.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · KST</span>{onDetailedAnalysis && <button type="button" onClick={onDetailedAnalysis} className="inline-flex items-center gap-1 font-semibold text-indigo-600">기존 상세 분석 보기<ArrowUpRight size={13}/></button>}</footer>
    </> : null}
  </div>;
}
