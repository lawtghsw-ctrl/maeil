"use client";
import { DateInput } from "@/components/ui/DateInput";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Download, Info, KeyRound, RefreshCw, Search, TrendingUp, Wallet } from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { useStoreSession } from "@/lib/store";
import type { MetaInsightsResponse } from "@/lib/platform/meta-insights";

const rate = (v: number | null) => v === null ? "확인 필요" : `${v.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
const money = (v: number | null, currency: string | null = "KRW") => v === null || !currency ? "확인 필요" : new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2 }).format(v);
function initialRange() { const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); return { start: `${today.slice(0, 7)}-01`, end: today }; }
function Card({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Wallet }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between text-xs font-semibold text-slate-500"><span>{label}</span><Icon size={17} className="text-indigo-500" aria-hidden="true"/></div><div className="mt-4 text-2xl font-bold tracking-tight text-slate-950">{value}</div><p className="mt-3 text-[11px] leading-5 text-slate-500">{note}</p></div>;
}

export default function MetaInsights() {
  const { currentUser, profile } = useStoreSession();
  const allowed = profile?.isActive === true && profile.platformRole === "super_admin";
  const [range, setRange] = useState(initialRange), [data, setData] = useState<MetaInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const [account, setAccount] = useState(""), [search, setSearch] = useState("");
  const [tokenConnection, setTokenConnection] = useState(""), [token, setToken] = useState(""), [saving, setSaving] = useState(false), [tokenMessage, setTokenMessage] = useState("");
  const generation = useRef(0), controller = useRef<AbortController | null>(null), refreshController = useRef<AbortController | null>(null);
  const start = range.start, end = range.end;
  const load = useCallback(async () => {
    const id = ++generation.current; controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    if (!allowed || !start || !end) { setData(null); setLoading(false); return; }
    setLoading(true); setError("");
    try { const result = await authJson<MetaInsightsResponse>(`/api/platform/meta-insights?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { signal: request.signal, cache: "no-store" }); if (id === generation.current) setData(result); }
    catch (e) { if (id === generation.current && !request.signal.aborted) { setData(null); setError(e instanceof Error ? e.message : "광고 성과를 읽지 못했습니다."); } }
    finally { if (id === generation.current) setLoading(false); }
  }, [allowed, currentUser?.id, start, end]);
  useEffect(() => { refreshController.current?.abort(); setRefreshing(false); setData(null); void load(); return () => { generation.current++; controller.current?.abort(); refreshController.current?.abort(); }; }, [load]);
  useEffect(() => { setToken(""); setTokenConnection(""); }, [allowed, currentUser?.id]);

  async function refresh() {
    if (!data || refreshing) return;
    const request = new AbortController(); refreshController.current?.abort(); refreshController.current = request;
    const selected = data.accounts.filter(a => !account || a.accountId === account);
    setRefreshing(true); setError(""); const failures: string[] = [];
    try {
      for (const item of selected) {
        if (request.signal.aborted) return;
        const result = await authJson<{ ok: boolean; error?: string }>("/api/platform/meta-insights", { method: "POST", signal: request.signal, body: JSON.stringify({ action: "refresh", accountId: item.accountId, start, end }) });
        if (!result.ok) failures.push(`${item.accountId}: ${result.error || "조회 실패"}`);
      }
      if (!request.signal.aborted) { await load(); if (failures.length) setError(failures.join(" / ")); }
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : "광고 조회를 완료하지 못했습니다."); }
    finally { if (refreshController.current === request) setRefreshing(false); }
  }
  async function saveToken(remove = false) {
    if (!tokenConnection || saving) return;
    setSaving(true); setTokenMessage("");
    try { await authJson("/api/platform/meta-insights", { method: "PATCH", body: JSON.stringify({ metaAccountId: tokenConnection, accessToken: remove ? null : token.trim() }) }); setToken(""); setTokenMessage(remove ? "조회 전용 토큰을 해제했습니다. 기존 전환 연동 토큰을 사용합니다." : "조회 전용 토큰을 암호화 저장했습니다. 광고비 새로고침으로 접근 권한을 확인해주세요."); await load(); }
    catch (e) { setTokenMessage(e instanceof Error ? e.message : "토큰 저장 실패"); }
    finally { setSaving(false); }
  }
  const rows = useMemo(() => (data?.ads || []).filter(r => (!account || r.accountId === account) && `${r.adName} ${r.adId} ${r.campaignName} ${r.firmNames.join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [data, account, search]);
  const connections = data ? [...data.accounts.flatMap(a => a.connections), ...data.unconfigured] : [];
  const trends = useMemo(() => {
    const values = new Map<string, number>();
    const snapshots = data?.accounts.filter(a => (!account || a.accountId === account) && a.snapshot) || [];
    if (new Set(snapshots.map(a => a.snapshot!.currency)).size !== 1) return [];
    for (const a of snapshots) for (const row of a.snapshot!.rows) values.set(row.date, (values.get(row.date) || 0) + row.spend);
    return [...values].sort(([a], [b]) => a.localeCompare(b));
  }, [data, account]);
  async function exportXlsx() {
    if (!data) return;
    try {
      const XLSX = await import("xlsx"), workbook = XLSX.utils.book_new();
      const safe = (v: unknown) => typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v;
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ["집계 범위", "광고명에 ‘회생’이 포함된 광고"], ["조회 시작", data.start, "조회 끝", data.end], ["계정", "광고 ID", "광고명", "통화", "Meta 지출", "노출", "클릭", "Meta lead", "Meta CPL", "CRM DB", "유효 계약", "계약 전환율(%)", "CRM DB당 원가", "건별 공급매출(KRW)", "광고비 차감이익(KRW)", "마진율(%)", "확인 사항"],
        ...rows.map(r => [r.accountId, r.adId, safe(r.adName), r.currency, r.spend, r.impressions, r.clicks, r.metaLeads, r.metaCpl ?? "확인 필요", r.crmLeads, r.contracts, r.conversionRate ?? "확인 필요", r.crmCpl ?? "확인 필요", r.supplyRevenue ?? "확인 필요", r.contribution ?? "확인 필요", r.marginRate ?? "확인 필요", r.attributionNote || ""]),
      ]), "광고성과");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["정의"], ["광고명에 ‘회생’이 포함된 광고만 집계합니다."], ...data.quality.notes.map(n => [n]), [], ["계정", "캐시 범위", "최종 완료조회", "상태", "시간대"], ...data.accounts.map(a => [a.accountId, `${data.start} ~ ${data.end}`, a.snapshot?.fetchedAt || "없음", a.status, a.snapshot?.timezone || "미확인"])]), "집계기준");
      XLSX.writeFile(workbook, `로파워_Meta광고성과_${data.start}_${data.end}.xlsx`);
    } catch { setError("엑셀 파일을 만들지 못했습니다. 다시 시도해주세요."); }
  }
  if (!allowed) return <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500">로파워 슈퍼관리자 전용 화면입니다.</div>;
  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div><div className="mb-2 text-[11px] font-bold tracking-[.16em] text-indigo-600">LAWPOWER · ADVERTISING</div><h1 className="text-2xl font-bold tracking-tight text-slate-950">광고 운영 성과</h1><p className="mt-2 text-sm text-slate-500">광고명에 ‘회생’이 포함된 광고의 Meta 지출과 CRM 유입·계약·공급매출을 확인합니다.</p></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs text-slate-500">시작<DateInput aria-label="광고 조회 시작일" value={start} onValueChange={value => setRange(r => ({ ...r, start: value }))} className="ml-2 h-10 rounded-lg border bg-white px-2 text-sm"/></label><label className="text-xs text-slate-500">종료<DateInput aria-label="광고 조회 종료일" value={end} onValueChange={value => setRange(r => ({ ...r, end: value }))} className="ml-2 h-10 rounded-lg border bg-white px-2 text-sm"/></label><button onClick={() => void refresh()} disabled={loading || refreshing || !data?.accounts.length} className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50"><RefreshCw size={15} className={refreshing ? "animate-spin" : ""}/>{refreshing ? "Meta 조회 중" : "광고비 새로고침"}</button><button onClick={() => void exportXlsx()} disabled={!data || loading} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm disabled:opacity-50"><Download size={15}/>엑셀</button></div></header>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
    {loading && <div role="status" className="rounded-xl border bg-white p-6 text-sm text-slate-500">저장된 광고 성과와 현재 CRM 정보를 읽고 있습니다.</div>}
    {data && !loading && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card label="Meta 실제 광고비" value={money(data.totals.spend, data.totals.currency)} note="전체 연결 계정의 회생 광고 · 외부 계정 ID 중복 제외" icon={Wallet}/><Card label="Meta 리드당 비용" value={money(data.totals.metaCpl, data.totals.currency)} note={`Meta 보고 lead ${data.totals.metaLeads.toLocaleString()}건 · 계정 귀속 설정 기준`} icon={BarChart3}/><Card label="CRM 계약 전환율" value={rate(data.totals.conversionRate)} note={`광고 ID 확인 DB ${data.totals.crmLeads}건 → 현재 유효 계약 ${data.totals.contracts}건`} icon={TrendingUp}/><Card label="광고비 차감마진율" value={rate(data.totals.marginRate)} note={`공급 대상 계정 · 매출 ${money(data.totals.supplyRevenue)} · 대상 광고비 ${money(data.totals.supplyAdSpend)} · 이익 ${money(data.totals.contribution)}`} icon={TrendingUp}/></div>
      {(data.quality.incompleteAccounts > 0 || data.quality.unattributedLeads > 0 || data.quality.unattributedSupply > 0 || data.quality.pendingBillingFirms > 0) && <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900"><Info size={16} className="mt-1 shrink-0"/><p>조회 확인 필요 {data.quality.incompleteAccounts}개 · 광고 귀속 미확인 DB {data.quality.unattributedLeads}건 · 귀속 미확인 공급 {data.quality.unattributedSupply}건 · 청구 확인 로펌 {data.quality.pendingBillingFirms}곳. 불완전한 계정이 있으면 전체 광고비·마진을 확정하지 않습니다. 아래 이전 완료 캐시는 조회시각과 함께 표시합니다.</p></div>}
      <section className="rounded-2xl border bg-white p-5"><h2 className="text-sm font-bold text-slate-900">연결 계정과 조회 상태</h2><div className="mt-4 grid gap-3 lg:grid-cols-2">{data.accounts.map(a => <div key={a.accountId} className="rounded-xl bg-slate-50 p-4"><div className="flex items-center justify-between gap-2"><b className="text-sm">{a.snapshot?.accountName || a.connections[0]?.name} <span className="text-[11px] font-normal text-slate-500">act_{a.accountId}</span></b><span className={`text-xs font-semibold ${a.status === "cached" ? "text-emerald-700" : "text-amber-700"}`}>{a.status === "cached" ? "완료 캐시" : a.status === "error" ? "최근 조회 실패" : "조회 전"}</span></div><p className="mt-2 text-xs text-slate-500">{a.connections.map(c => c.firmName).join(" · ")}{a.connections.length > 1 ? " · 중복 연결 1회 집계" : ""}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">범위 {data.start} ~ {data.end} · {a.snapshot?.currency || "통화 미확인"} / {a.snapshot?.timezone || "시간대 미확인"}<br/>최종 완료 {a.snapshot ? new Date(a.snapshot.fetchedAt).toLocaleString("ko-KR") : "없음"}</p>{a.error && <p className="mt-2 text-xs text-rose-700">{a.error}</p>}</div>)}{data.unconfigured.map(c => <div key={c.id} className="rounded-xl border border-amber-200 p-4 text-xs text-amber-800">{c.firmName} · {c.name}: 광고계정 ID가 없거나 올바르지 않습니다. 로펌 광고연동 설정에서 확인해주세요.</div>)}</div>{connections.length === 0 && <p className="mt-4 text-sm text-slate-500">등록된 활성 Meta 연결이 없습니다. 로펌 광고연동 설정에서 계정을 등록해주세요.</p>}</section>
      <section className="overflow-hidden rounded-2xl border bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="font-bold text-slate-900">광고별 성과</h2><p className="mt-1 text-xs text-slate-500">광고명에 ‘회생’ 포함 기준입니다. 계정 필터는 차트·표·엑셀, 검색은 표·엑셀에 적용됩니다. 상단 KPI는 전체 연결 계정의 회생 광고입니다.</p></div><div className="flex flex-wrap gap-2"><select aria-label="광고계정 필터" value={account} onChange={e => setAccount(e.target.value)} className="h-10 max-w-56 rounded-lg border px-3 text-xs"><option value="">전체 광고계정</option>{data.accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.snapshot?.accountName || a.connections[0]?.name} ({a.accountId})</option>)}</select><label className="flex items-center gap-2 rounded-lg border px-3"><Search size={14} className="text-slate-400"/><input aria-label="광고 검색" value={search} onChange={e => setSearch(e.target.value)} placeholder="광고명·ID·로펌 검색" className="h-10 w-40 text-xs outline-none"/></label></div></div>
      {trends.length > 0 && <div className="border-b p-5"><div className="mb-4 text-xs font-semibold text-slate-500">일별 Meta 지출 · 회생 광고 · 계정 필터 기준</div><div className="flex h-28 items-end gap-1" role="img" aria-label="선택한 계정의 회생 광고 일별 지출"><span className="sr-only">일별 지출은 막대에 마우스를 올리면 표시됩니다.</span>{trends.map(([date, spend]) => <div key={date} className="flex min-w-0 flex-1 flex-col justify-end self-stretch" title={`${date}: ${spend.toLocaleString()}`}><div className="min-h-[2px] rounded-t bg-indigo-400" style={{ height: `${Math.max(2, spend / Math.max(1, ...trends.map(([, v]) => v)) * 100)}%` }}/></div>)}</div><div className="mt-2 flex justify-between text-[10px] text-slate-400"><span>{trends[0][0]}</span><span>{trends[trends.length - 1][0]}</span></div></div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[1350px] text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["광고 / 연결 로펌", "광고비", "노출 / 클릭", "Meta 리드", "Meta CPL", "CRM DB", "계약 / 전환율", "CRM DB당 원가", "공급매출(KRW)", "광고비 차감이익", "마진율"].map(s => <th key={s} className="whitespace-nowrap px-4 py-3 text-left font-semibold">{s}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={`${r.accountId}:${r.adId}`} className="border-t hover:bg-slate-50"><td className="max-w-64 px-4 py-4"><div className="font-semibold text-slate-900">{r.adName}</div><div className="mt-1 break-words text-[10px] text-slate-400">{r.adId} · {r.firmNames.join(" / ") || "CRM 연결 없음"}</div>{r.attributionNote && <div className="mt-1 text-[10px] text-amber-700">{r.attributionNote}</div>}</td><td className="px-4 py-4 font-bold">{money(r.spend, r.currency)}</td><td className="px-4 py-4">{r.impressions.toLocaleString()} / {r.clicks.toLocaleString()}</td><td className="px-4 py-4">{r.metaLeads.toLocaleString()}</td><td className="px-4 py-4">{money(r.metaCpl, r.currency)}</td><td className="px-4 py-4">{r.crmLeads}</td><td className="px-4 py-4">{r.contracts} / {rate(r.conversionRate)}</td><td className="px-4 py-4">{money(r.crmCpl, r.currency)}</td><td className="px-4 py-4">{r.supplyScope === "not_applicable" ? "공급 비대상" : money(r.supplyRevenue)}</td><td className="px-4 py-4">{r.supplyScope === "not_applicable" ? "—" : money(r.contribution)}</td><td className="px-4 py-4">{r.supplyScope === "not_applicable" ? "—" : rate(r.marginRate)}</td></tr>)}{rows.length === 0 && <tr><td colSpan={11} className="p-10 text-center text-slate-400">표시할 광고가 없습니다. 조회 상태와 선택 기간을 확인해주세요.</td></tr>}</tbody></table></div></section>
      <details className="rounded-2xl border bg-white p-5"><summary className="cursor-pointer text-sm font-bold text-slate-700"><KeyRound size={15} className="mr-2 inline"/>광고 조회 전용 토큰 설정</summary><p className="mt-3 text-xs leading-6 text-slate-500">기본값은 기존에 암호화 저장한 연결 토큰입니다. 조회 권한이 부족하면 ads_read와 해당 광고계정 접근 권한이 있는 별도 토큰을 저장하세요. 기존 전환 이벤트 토큰은 변경하지 않습니다.</p><div className="mt-3 flex flex-wrap gap-2"><select aria-label="조회 토큰 연결 계정" value={tokenConnection} onChange={e => { setTokenConnection(e.target.value); setToken(""); setTokenMessage(""); }} className="h-10 max-w-xs rounded-lg border px-3 text-xs"><option value="">연결 선택</option>{connections.map(c => <option key={c.id} value={c.id}>{c.firmName} · {c.name} {c.hasReadToken ? "(별도 조회 토큰)" : ""}</option>)}</select><input aria-label="광고 조회 전용 토큰" type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} placeholder="조회 전용 토큰" className="h-10 min-w-48 flex-1 rounded-lg border px-3 text-sm"/><button onClick={() => void saveToken()} disabled={!tokenConnection || !token.trim() || saving} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">암호화 저장</button><button onClick={() => void saveToken(true)} disabled={!tokenConnection || saving} className="rounded-lg border px-4 py-2 text-xs disabled:opacity-40">전용 토큰 해제</button></div>{tokenMessage && <p role="status" className="mt-3 text-xs text-slate-600">{tokenMessage}</p>}</details>
      <details className="rounded-2xl border bg-white p-5"><summary className="cursor-pointer text-sm font-bold text-slate-700">집계 기준과 데이터 범위</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-6 text-slate-500">{data.quality.notes.map(n => <li key={n}>{n}</li>)}</ul></details>
    </>}
  </div>;
}
