"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PerformanceCase } from "@/lib/performance/firm";
import { aggregateLawyerPerformance, normalizeLawyerConfig, type LawyerConfig, type LawyerConfigResponse, type LawyerDraftState } from "@/lib/performance/lawyers";
import { authJson } from "@/lib/platform/client";
import { fmtWon } from "@/lib/format";
import { PerformanceBars, PerformanceMetric, PerformancePanel, moneyText, savePerformanceCsv } from "./PerformanceCharts";

interface Props { cases: PerformanceCase[]; start: string; end: string; firmId?: string; canManage?: boolean; draftCache?: Map<string, LawyerDraftState> }
const inputClass = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-400";
const buttonClass = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold disabled:opacity-40";
const isDirty = (state: LawyerDraftState) => JSON.stringify(state.draft) !== JSON.stringify(state.value);

export function LawyerPerformance({ cases, start, end, firmId, canManage = false, draftCache }: Props) {
  const [state, setState] = useState<LawyerDraftState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [lawyerFilter, setLawyerFilter] = useState("all");
  const [page, setPage] = useState(0);
  const sequence = useRef(0);
  const saveController = useRef<AbortController | null>(null);
  const internalDrafts = useRef(new Map<string, LawyerDraftState>());
  const drafts = draftCache ?? internalDrafts.current;

  useEffect(() => {
    const serial = ++sequence.current;
    const controller = new AbortController();
    saveController.current?.abort();
    setBusy(false); setError(""); setMessage(""); setNewName(""); setSearch(""); setLawyerFilter("all"); setPage(0);
    if (!firmId) { setState(null); setLoading(false); return () => controller.abort(); }
    setLoading(true);
    authJson<LawyerConfigResponse>(`/api/admin/performance/lawyers?firmId=${encodeURIComponent(firmId)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (serial !== sequence.current || controller.signal.aborted) return;
        if (response.firmId !== firmId) throw new Error("로펌 설정 범위가 일치하지 않습니다.");
        const previous = drafts.get(firmId);
        // Keep unsaved edits when returning to a firm. Its original version token
        // is retained so a newer remote edit cannot be silently overwritten.
        const next = previous && isDirty(previous) ? previous : { ...response, draft: response.value };
        drafts.set(firmId, next); setState(next);
      })
      .catch((reason: unknown) => { if (serial === sequence.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "변호사 설정을 불러오지 못했습니다."); })
      .finally(() => { if (serial === sequence.current && !controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); saveController.current?.abort(); };
  }, [firmId, reload, drafts]);

  const current = state?.firmId === firmId ? state : null;
  const summary = useMemo(() => current ? aggregateLawyerPerformance(cases, current.value) : null, [cases, current?.value]);
  const savedTotals = useMemo(() => (summary?.rows ?? []).reduce((total, row) => ({ contractAmount: total.contractAmount + row.contractAmount, periodCash: total.periodCash + row.periodCash, contractCount: total.contractCount + row.contractCount }), { contractAmount: 0, periodCash: 0, contractCount: 0 }), [summary]);
  const contractRanking = useMemo(() => [...(summary?.rows ?? [])].sort((a, b) => b.contractAmount - a.contractAmount).slice(0, 8).map((row) => ({ name: row.name, value: row.contractAmount, secondary: `${row.contractCount}건` })), [summary]);
  const cashRanking = useMemo(() => [...(summary?.rows ?? [])].sort((a, b) => b.periodCash - a.periodCash).slice(0, 8).map((row) => ({ name: row.name, value: row.periodCash, secondary: `담당 ${row.caseCount}건` })), [summary]);
  const filteredCases = useMemo(() => {
    if (!current) return [];
    const needle = search.trim().toLocaleLowerCase("ko-KR");
    return cases.filter((record) => {
      const assigned = current.draft.assignments[record.id];
      if (lawyerFilter === "unassigned" ? !!assigned : lawyerFilter !== "all" && assigned !== lawyerFilter) return false;
      return !needle || `${record.clientName} ${record.caseNumber} ${record.assignedStaff}`.toLocaleLowerCase("ko-KR").includes(needle);
    });
  }, [cases, current?.draft, search, lawyerFilter]);
  const lastPage = Math.max(0, Math.ceil(filteredCases.length / 50) - 1);
  const safePage = Math.min(page, lastPage);
  const visibleCases = filteredCases.slice(safePage * 50, (safePage + 1) * 50);

  function edit(change: (draft: LawyerConfig) => LawyerConfig) {
    if (!canManage || busy || loading) return;
    setError(""); setMessage("");
    setState((previous) => {
      if (!previous || previous.firmId !== firmId) return previous;
      const next = { ...previous, draft: change(previous.draft) };
      drafts.set(previous.firmId, next);
      return next;
    });
  }
  function addLawyer() {
    if (!current || !newName.trim()) return;
    try {
      const next = normalizeLawyerConfig({ ...current.draft, lawyers: [...current.draft.lawyers, { id: `LAW-${crypto.randomUUID()}`, name: newName.trim(), isActive: true }] }, false);
      edit(() => next); setNewName("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "변호사를 추가하지 못했습니다."); }
  }
  function toggleLawyer(id: string, active: boolean) {
    if (!active && current && Object.values(current.draft.assignments).includes(id)) { setError("담당 사건을 먼저 배정 해제하거나 다른 변호사에게 배정한 뒤 비활성으로 변경해주세요."); return; }
    edit((draft) => ({ ...draft, lawyers: draft.lawyers.map((lawyer) => lawyer.id === id ? { ...lawyer, isActive: active } : lawyer) }));
  }
  function assign(caseId: string, lawyerId: string) {
    edit((draft) => {
      const assignments = { ...draft.assignments };
      if (lawyerId) assignments[caseId] = lawyerId;
      else delete assignments[caseId];
      return { ...draft, assignments };
    });
  }
  async function save() {
    if (!current || !canManage || busy || !isDirty(current)) return;
    let value: LawyerConfig;
    try { value = normalizeLawyerConfig(current.draft); } catch (reason) { setError(reason instanceof Error ? reason.message : "입력 내용을 확인해주세요."); return; }
    const serial = sequence.current;
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await authJson<LawyerConfigResponse>("/api/admin/performance/lawyers", { method: "PATCH", signal: controller.signal, body: JSON.stringify({ firmId: current.firmId, value, expectedUpdatedAt: current.updatedAt }) });
      if (response.firmId !== current.firmId) throw new Error("저장 결과의 로펌 범위가 일치하지 않습니다.");
      if (serial !== sequence.current || controller.signal.aborted) return;
      const next = { ...response, draft: response.value };
      drafts.set(current.firmId, next); setState(next); setMessage("변호사 명단과 담당 배정을 저장했습니다.");
    } catch (reason) { if (serial === sequence.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "저장하지 못했습니다. 수정 내용은 유지됩니다."); }
    finally { if (serial === sequence.current && !controller.signal.aborted) setBusy(false); }
  }
  function reloadSettings() {
    if (current && isDirty(current) && !window.confirm("저장하지 않은 수정사항을 취소하고 최신 설정을 불러오시겠습니까?")) return;
    if (firmId) drafts.delete(firmId);
    setReload((value) => value + 1);
  }
  function exportPerformance() {
    if (!summary) return;
    savePerformanceCsv([
      ["집계 시작", "집계 종료", "변호사", "활동 상태", "담당 사건", "기간 수임", "기간 수임액", "기간 입금", "현재 미수금", "현재 연체금"],
      ...summary.rows.map((row) => [start, end, row.name, row.isActive ? "활동" : "비활성", row.caseCount, row.contractCount, row.contractAmount, row.periodCash, row.outstanding, row.overdueAmount]),
    ], `변호사실적_${start}_${end}.csv`);
  }
  function selectRanking(name: string) {
    const lawyer = current?.value.lawyers.find((item) => item.name === name);
    if (lawyer) { setLawyerFilter(lawyer.id); setPage(0); }
  }

  if (!firmId) return <div className="rounded-xl border bg-white p-6 text-sm text-slate-500">변호사 실적을 확인할 로펌을 선택해주세요.</div>;
  if (loading || (!current && !error)) return <div role="status" className="rounded-xl border bg-white p-6 text-sm text-slate-500">변호사 설정을 불러오는 중입니다.</div>;
  if (!current) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}<button type="button" className={`${buttonClass} ml-3`} onClick={reloadSettings}>다시 불러오기</button></div>;

  return <section className="space-y-4" aria-label="변호사 관리와 실적">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <PerformanceMetric label="등록 변호사" value={`${current.value.lawyers.filter((lawyer) => lawyer.isActive).length}명`} caption={`활동 중 · 전체 ${current.value.lawyers.length}명`}/>
      <PerformanceMetric label="미배정 사건" value={`${summary?.unassignedCount ?? 0}건`} caption="현재 조회 범위에서 담당 변호사 미지정"/>
      <PerformanceMetric label="기간 수임액" value={moneyText(savedTotals.contractAmount)} caption={`변호사 배정 완료 사건 · 유효 수임 ${savedTotals.contractCount}건`} dark/>
      <PerformanceMetric label="기간 실입금" value={moneyText(savedTotals.periodCash)} caption="변호사 배정 완료 사건 · 이전 계약 입금 포함"/>
    </div>
    {!!summary?.rows.length && <div className="grid gap-4 xl:grid-cols-2">
      <PerformancePanel title="변호사별 수임액" description="선택 기간의 유효 수임액 상위 8명 · 클릭하면 아래 사건 목록을 필터링합니다."><PerformanceBars rows={contractRanking} money onSelect={selectRanking} selected={current.value.lawyers.find((lawyer) => lawyer.id === lawyerFilter)?.name}/></PerformancePanel>
      <PerformancePanel title="변호사별 실입금" description="선택 기간의 실입금 상위 8명 · 이전 계약에서 발생한 입금도 포함합니다."><PerformanceBars rows={cashRanking} money onSelect={selectRanking} selected={current.value.lawyers.find((lawyer) => lawyer.id === lawyerFilter)?.name}/></PerformancePanel>
    </div>}
    <div className="rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-black">변호사별 상세 실적</h2><p className="mt-1 text-xs text-slate-500">{start} ~ {end} · 저장된 변호사 명단과 사건 담당 배정 기준</p></div><button type="button" className={buttonClass} disabled={!summary?.rows.length} onClick={exportPerformance}>CSV 다운로드</button></div>
      {!current.value.lawyers.length ? <div className="py-8 text-center text-sm text-slate-500">등록된 변호사가 없습니다. 아래에서 실제 변호사를 등록하고 사건을 배정한 뒤 저장해주세요.</div> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["변호사", "활동 상태", "담당 사건", "기간 수임", "기간 수임액", "기간 입금", "현재 미수금", "현재 연체금"].map((label) => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead><tbody>{summary?.rows.map((row) => <tr key={row.id} className="border-t"><td className="px-3 py-3 font-bold">{row.name}</td><td className="px-3 py-3 text-xs">{row.isActive ? "활동" : "비활성"}</td><td className="px-3 py-3">{row.caseCount}건</td><td className="px-3 py-3">{row.contractCount}건</td><td className="px-3 py-3">{fmtWon(row.contractAmount)}</td><td className="px-3 py-3">{fmtWon(row.periodCash)}</td><td className="px-3 py-3">{fmtWon(row.outstanding)}</td><td className="px-3 py-3 text-red-700">{fmtWon(row.overdueAmount)}</td></tr>)}</tbody></table></div>}
      <p className="mt-3 text-[11px] leading-5 text-slate-500">기간 수임은 계약금액이 있는 취하 외 사건의 계약일 기준입니다. 기간 입금에는 이전 계약의 해당 기간 입금도 포함하며, 미수금·연체금은 현재 담당 사건 전체 기준입니다.</p>
    </div>

    <div className="rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-black">변호사 명단 · 사건 배정</h3><p className="mt-1 text-xs text-slate-500">변호사를 직접 등록하고 담당 사건을 선택해주세요. 수정한 내용은 저장 버튼을 눌러야 반영됩니다.</p></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={reloadSettings} className={buttonClass}>최신 설정 불러오기</button>{canManage && <button type="button" disabled={busy || !isDirty(current)} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{busy ? "저장 중..." : "변경사항 저장"}</button>}</div></div>
      {isDirty(current) && <p className="mt-3 text-xs font-bold text-amber-700">아직 저장하지 않은 변경사항이 있습니다.</p>}
      {error && <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}
      <fieldset disabled={busy || !canManage} className="mt-4">
        <div className="flex flex-wrap gap-2"><input aria-label="새 변호사 이름" value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} placeholder="변호사 이름" className={inputClass}/><button type="button" onClick={addLawyer} disabled={!newName.trim() || busy || !canManage} className={buttonClass}>변호사 추가</button></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{current.draft.lawyers.map((lawyer) => <div key={lawyer.id} className="flex items-center gap-2 rounded-lg border p-2"><input aria-label={`${lawyer.name} 이름 수정`} value={lawyer.name} maxLength={80} onChange={(event) => edit((draft) => ({ ...draft, lawyers: draft.lawyers.map((item) => item.id === lawyer.id ? { ...item, name: event.target.value } : item) }))} className={`${inputClass} min-w-0 flex-1`}/><label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={lawyer.isActive} onChange={(event) => toggleLawyer(lawyer.id, event.target.checked)}/>활동</label></div>)}</div>
      </fieldset>
      {!!current.missingCaseIds.filter((id) => current.draft.assignments[id]).length && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">현재 로펌에서 찾을 수 없는 사건 배정 {current.missingCaseIds.filter((id) => current.draft.assignments[id]).length}건이 남아 있습니다. {canManage && <button type="button" disabled={busy} className="font-bold underline" onClick={() => edit((draft) => ({ ...draft, assignments: Object.fromEntries(Object.entries(draft.assignments).filter(([id]) => !current.missingCaseIds.includes(id))) }))}>해당 배정 해제</button>}</div>}
      <div className="mt-5 flex flex-wrap items-center gap-2"><input aria-label="배정할 사건 검색" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="고객명 · 사건번호 · 상담 담당자 검색" className={`${inputClass} min-w-[260px] flex-1`}/><select aria-label="변호사 배정 필터" value={lawyerFilter} onChange={(event) => { setLawyerFilter(event.target.value); setPage(0); }} className={inputClass}><option value="all">전체 사건</option><option value="unassigned">미배정 사건</option>{current.draft.lawyers.map((lawyer) => <option key={lawyer.id} value={lawyer.id}>{lawyer.name}{lawyer.isActive ? "" : " (비활성)"}</option>)}</select></div>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["고객명", "사건번호", "상담 담당자", "계약일", "계약금액", "담당 변호사"].map((label) => <th key={label} className="px-3 py-3 text-left">{label}</th>)}</tr></thead><tbody>{visibleCases.map((record) => <tr key={record.id} className="border-t"><td className="px-3 py-3 font-bold">{record.clientName}</td><td className="px-3 py-3">{record.caseNumber || "-"}</td><td className="px-3 py-3 text-xs text-slate-500">{record.assignedStaff || "-"}</td><td className="px-3 py-3">{record.contractDate || "-"}</td><td className="px-3 py-3">{fmtWon(record.contractAmount)}</td><td className="px-3 py-2"><select aria-label={`${record.clientName} 사건 담당 변호사`} disabled={busy || !canManage} value={current.draft.assignments[record.id] || ""} onChange={(event) => assign(record.id, event.target.value)} className={inputClass}><option value="">미배정</option>{current.draft.lawyers.filter((lawyer) => lawyer.isActive || lawyer.id === current.draft.assignments[record.id]).map((lawyer) => <option key={lawyer.id} value={lawyer.id} disabled={!lawyer.isActive}>{lawyer.name}{lawyer.isActive ? "" : " (비활성)"}</option>)}</select></td></tr>)}{!visibleCases.length && <tr><td colSpan={6} className="py-8 text-center text-slate-400">표시할 사건이 없습니다.</td></tr>}</tbody></table></div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>검색 결과 {filteredCases.length}건 · {safePage + 1}/{lastPage + 1}페이지</span><div className="flex gap-2"><button type="button" className={buttonClass} disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>이전</button><button type="button" className={buttonClass} disabled={safePage === lastPage} onClick={() => setPage(safePage + 1)}>다음</button></div></div>
    </div>
  </section>;
}
