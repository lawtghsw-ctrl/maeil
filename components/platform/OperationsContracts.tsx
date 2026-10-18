"use client";
import { useState } from "react";
import { PerformancePanel } from "@/components/analytics/PerformanceCharts";
import { opsToday, operationSupplyLabel, type SupplyContract, type SupplyContractStatus } from "@/lib/platform/operations";
import { OperationsFrame, OperationTable, Field, buttonClass, secondaryClass, fieldClass, cellClass, count, won, useOperations } from "./OperationsShared";

type Draft = { id: string | null; expectedRevision: number; law_firm_id: string; product: string; category: string; unit_price: string; monthly_quantity: string; start_date: string; end_date: string; status: SupplyContractStatus };
const blank = (): Draft => ({ id: null, expectedRevision: 0, law_firm_id: "", product: "", category: "", unit_price: "", monthly_quantity: "", start_date: "", end_date: "", status: "draft" });
const statusLabel = { draft: "미확정", active: "확정 · 활성", paused: "일시중지", ended: "종료" };
const blankRecord = () => ({ id: crypto.randomUUID(), law_firm_id: "", contract_id: "", ledger_id: "", event_date: opsToday(), kind: "receipt" as "receipt" | "replacement", quantity: "", amount: "", reason: "" });
export function OperationsContracts() {
  const state = useOperations(), data = state.data;
  const [draft, setDraft] = useState<Draft>(blank), [record, setRecord] = useState<ReturnType<typeof blankRecord> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const update = (key: keyof Draft, value: string) => setDraft(d => ({ ...d, [key]: value }));
  function edit(c: SupplyContract) { setError(""); setDraft({ id: c.id, expectedRevision: c.revision, law_firm_id: c.law_firm_id, product: c.product, category: c.category, unit_price: c.unit_price === null ? "" : String(c.unit_price), monthly_quantity: c.monthly_quantity === null ? "" : String(c.monthly_quantity), start_date: c.start_date, end_date: c.end_date, status: c.status }); }
  async function saveContract(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await state.save({ action: "contract", ...draft, unit_price: draft.unit_price === "" ? null : Number(draft.unit_price), monthly_quantity: draft.monthly_quantity === "" ? null : Number(draft.monthly_quantity) }); setDraft(blank()); setNotice("계약을 저장했습니다. 기존 공급 원장의 단가와 고객 자료는 변경되지 않았습니다."); }
    catch (e) { setError(e instanceof Error ? e.message : "저장에 실패했습니다."); } finally { setBusy(false); }
  }
  async function saveRecord(e: React.FormEvent) {
    e.preventDefault(); if (!record) return; setBusy(true); setError(""); setNotice("");
    try {
      if (record.kind === "receipt" ? record.amount === "" : record.quantity === "") throw new Error("수납금액 또는 교체수량을 입력해주세요. 0원 수납도 직접 입력해 등록할 수 있습니다.");
      await state.save({ action: "adjustment", ...record, contract_id: record.contract_id || null, ledger_id: record.ledger_id || null, quantity: record.kind === "replacement" ? Number(record.quantity) : 0, amount: record.kind === "receipt" ? Number(record.amount) : 0 });
      setRecord(null); setNotice("보조 원장에 기록했습니다. 기존 공급 과금액은 변경되지 않았습니다.");
    } catch (e) { setError(e instanceof Error ? e.message : "저장에 실패했습니다."); } finally { setBusy(false); }
  }
  const firmName = (id: string) => data?.firms.find(f => f.id === id)?.name ?? id;
  const visible = (data?.contracts ?? []).filter(c => `${firmName(c.law_firm_id)} ${c.product} ${c.category}`.toLowerCase().includes(search.toLowerCase()));
  return <OperationsFrame title="공급 계약 · 이행" description="단가와 기간을 확인한 후 활성화하세요. 저장 이후 새 공급만 확정 계약에 연결되며 기존 원장은 소급 변경하지 않습니다." state={state} editing={busy} exportRows={[["로펌", "상품", "구분", "단가", "월 약정", "시작", "종료", "상태"], ...visible.map(c => [firmName(c.law_firm_id), c.product, c.category, c.unit_price, c.monthly_quantity, c.start_date, c.end_date, statusLabel[c.status]])]}>
    {error && <div role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}{notice && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</div>}
    <PerformancePanel title={draft.id ? "공급 계약 수정" : "새 공급 계약"} description="미확정 계약은 단가·월 약정량을 비워둘 수 있습니다. 확정 활성 계약은 양수 단가·수량이 필요하며 같은 로펌의 활성 계약 기간은 중복될 수 없습니다.">
      <form onSubmit={saveContract} className="space-y-5 p-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="로펌"><select className={fieldClass} required disabled={busy || Boolean(draft.id)} value={draft.law_firm_id} onChange={e => update("law_firm_id", e.target.value)}><option value="">로펌 선택</option>{data?.firms.map(f => <option key={f.id} value={f.id}>{f.name}{data.commercialProfiles.find(p => p.law_firm_id === f.id)?.service_mode === "crm_only" ? " · 어드민 전용" : ""}</option>)}</select></Field>
        <Field label="상품명"><input className={fieldClass} required maxLength={100} value={draft.product} onChange={e => update("product", e.target.value)}/></Field>
        <Field label="사건 / 상품 구분"><input className={fieldClass} required maxLength={100} placeholder="예: 회생 · 3Q" value={draft.category} onChange={e => update("category", e.target.value)}/></Field>
        <Field label="상태"><select className={fieldClass} value={draft.status} onChange={e => update("status", e.target.value)}>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label="공급 단가 (원 · VAT 제외)"><input className={fieldClass} type="number" min="0" step="1" max="1000000000000" value={draft.unit_price} onChange={e => update("unit_price", e.target.value)}/></Field>
        <Field label="월 공급 약정량 (건)"><input className={fieldClass} type="number" min="0" step="1" max="10000000" value={draft.monthly_quantity} onChange={e => update("monthly_quantity", e.target.value)}/></Field>
        <Field label="시작일"><input className={fieldClass} type="date" required value={draft.start_date} onChange={e => update("start_date", e.target.value)}/></Field>
        <Field label="종료일"><input className={fieldClass} type="date" required value={draft.end_date} onChange={e => update("end_date", e.target.value)}/></Field>
      </div><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy}>{busy ? "저장 중..." : "계약 저장"}</button><button type="button" className={secondaryClass} disabled={busy} onClick={() => setDraft(blank())}>새 입력으로 초기화</button></div></form>
    </PerformancePanel>
    <PerformancePanel title="등록 계약" action={<input aria-label="계약 검색" className={fieldClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="로펌 · 상품 검색"/>}><OperationTable headings={["로펌", "상품 / 구분", "단가 / 월 약정", "기간", "상태", "수정"]}>{visible.map(c => <tr key={c.id}><td className={cellClass + " font-semibold"}>{firmName(c.law_firm_id)}</td><td className={cellClass}>{c.product}<div className="mt-1 text-slate-400">{c.category}</div></td><td className={cellClass}>{won(c.unit_price)} / {count(c.monthly_quantity)}건</td><td className={cellClass}>{c.start_date} ~ {c.end_date}</td><td className={cellClass}>{statusLabel[c.status]}</td><td className={cellClass}><button type="button" className={secondaryClass} disabled={busy} onClick={() => edit(c)}>수정</button></td></tr>)}{!visible.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">등록된 계약이 없습니다.</td></tr>}</OperationTable></PerformancePanel>
    <PerformancePanel title="수납 · 무상 교체 보조 원장" description="수납은 로파워가 로펌으로부터 받은 금액입니다. 교체는 추가 무상 공급을 별도로 기록하며 원본 과금액을 자동 차감하지 않습니다." action={<button type="button" className={buttonClass} disabled={busy} onClick={() => setRecord(blankRecord())}>기록 추가</button>}>
      {record && <form onSubmit={saveRecord} className="space-y-4 border-b border-slate-100 p-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="로펌"><select required className={fieldClass} value={record.law_firm_id} onChange={e => setRecord({ ...record, law_firm_id: e.target.value, contract_id: "", ledger_id: "" })}><option value="">선택</option>{data?.firms.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></Field>
        <Field label="구분"><select className={fieldClass} value={record.kind} onChange={e => setRecord({ ...record, kind: e.target.value as "receipt" | "replacement" })}><option value="receipt">수납</option><option value="replacement">무상 교체</option></select></Field>
        <Field label="기록일"><input required type="date" className={fieldClass} value={record.event_date} onChange={e => setRecord({ ...record, event_date: e.target.value })}/></Field>
        <Field label={record.kind === "receipt" ? "수납금액 (원)" : "교체수량 (건)"}><input required className={fieldClass} type="number" min={record.kind === "receipt" ? 0 : 1} step="1" value={record.kind === "receipt" ? record.amount : record.quantity} onChange={e => setRecord({ ...record, [record.kind === "receipt" ? "amount" : "quantity"]: e.target.value })}/></Field>
        <Field label="연결 계약 (선택)"><select className={fieldClass} value={record.contract_id} onChange={e => setRecord({ ...record, contract_id: e.target.value, ledger_id: "" })}><option value="">미연결</option>{data?.contracts.filter(c => c.law_firm_id === record.law_firm_id).map(c => <option key={c.id} value={c.id}>{c.product} · {c.start_date}</option>)}</select></Field>
        <Field label="공급 원장 (선택 · 현재 원장 페이지)"><select className={fieldClass} value={record.ledger_id} onChange={e => setRecord({ ...record, ledger_id: e.target.value })}><option value="">미연결</option>{data?.ledger.filter(l => l.law_firm_id === record.law_firm_id && (!record.contract_id || l.supply_contract_id === record.contract_id)).map(l => <option key={l.id} value={l.id}>{l.supplied_at.slice(0, 10)} · {l.id.slice(0, 8)}</option>)}</select></Field>
        <Field label="내역 / 교체 사유"><input required maxLength={500} className={fieldClass} value={record.reason} onChange={e => setRecord({ ...record, reason: e.target.value })}/></Field>
      </div><div className="flex gap-2"><button className={buttonClass} disabled={busy}>보조 원장에 기록</button><button type="button" className={secondaryClass} onClick={() => setRecord(null)} disabled={busy}>닫기</button></div></form>}
      <OperationTable headings={["일자", "로펌", "구분", "수량", "금액", "내역"]}>{data?.adjustments.map(a => <tr key={a.id}><td className={cellClass}>{a.event_date}</td><td className={cellClass}>{firmName(a.law_firm_id)}</td><td className={cellClass}>{a.kind === "receipt" ? "수납" : "무상 교체"}</td><td className={cellClass}>{a.quantity}</td><td className={cellClass}>{won(a.amount)}</td><td className={cellClass}>{a.reason}</td></tr>)}{!data?.adjustments.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">선택한 월의 등록 기록이 없습니다.</td></tr>}</OperationTable>
    </PerformancePanel>
    <PerformancePanel title="기존 공급 원장 · 읽기 전용" description={`전체 ${count(data?.ledgerCount ?? 0)}건 · 500건씩 표시합니다. 합계·분석은 전체 원장을 집계합니다.`} action={<div className="flex gap-2"><button type="button" className={secondaryClass} disabled={busy || state.ledgerOffset === 0 || Boolean(record)} onClick={() => state.setLedgerOffset(Math.max(0, state.ledgerOffset - 500))}>이전</button><button type="button" className={secondaryClass} disabled={busy || !data?.ledgerTruncated || Boolean(record)} onClick={() => state.setLedgerOffset(state.ledgerOffset + 500)}>다음</button></div>}><OperationTable headings={["공급일", "로펌", "구분", "당시 단가", "과금", "계약 연결", "원장 ID"]}>{data?.ledger.map(l => <tr key={l.id}><td className={cellClass}>{new Date(l.supplied_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td><td className={cellClass}>{firmName(l.law_firm_id)}</td><td className={cellClass}>{operationSupplyLabel(l.classification)}</td><td className={cellClass}>{won(l.unit_price_snapshot === null ? null : Number(l.unit_price_snapshot))}</td><td className={cellClass}>{l.billable ? "과금" : "비과금"}</td><td className={cellClass}>{l.supply_contract_id ? `연결 · v${l.supply_contract_revision}` : "미연결"}</td><td className={cellClass}>{l.id.slice(0, 8)}</td></tr>)}</OperationTable></PerformancePanel>
  </OperationsFrame>;
}
