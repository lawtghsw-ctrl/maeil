"use client";

import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, Plus, Save, Trash2, UnlockKeyhole } from "lucide-react";
import { useStore } from "@/lib/store";
import { CASE_TYPE_OPTIONS, PAYMENT_METHOD_NOTE, type CaseType, type PaymentMethod } from "@/lib/types";
import {
  ensureStaffCompensations,
  makeFinancialSnapshot,
  type AdSpendEntry,
  type FeePayer,
  type IncentiveMode,
  type ManagementSettings,
  type StandardFeeRule,
  useManagementSettings,
} from "@/lib/management-analytics";
import { fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_NOTE) as PaymentMethod[];
const INCENTIVE_MODES: IncentiveMode[] = ["회수매출%", "수임액%", "건당고정"];
const FEE_PAYERS: FeePayer[] = ["사무소 부담", "고객 부담", "해당 없음"];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonth() {
  return todayIso().slice(0, 7);
}

function n(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function MoneyInput({ value, onChange, disabled = false }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return <input disabled={disabled} value={value ? value.toLocaleString("ko-KR") : ""} onChange={(e) => onChange(n(e.target.value))} inputMode="numeric" placeholder="0" className="h-9 w-full min-w-[120px] rounded-lg border border-slate-200 bg-white px-3 text-right text-sm disabled:bg-slate-50 disabled:text-slate-400" />;
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return <div className="border-b border-slate-100 px-5 py-4"><div className="text-sm font-black text-slate-900">{title}</div><div className="mt-1 text-xs text-slate-500">{sub}</div></div>;
}

export default function SettlementSettingsPage() {
  const { profile, superAdminFirmScope, workStaffNames, leads } = useStore();
  const { manager, globalSuperView, activeSettings, loading, error, save } = useManagementSettings(profile, superAdminFirmScope, workStaffNames);
  const [draft, setDraft] = useState<ManagementSettings>(() => ensureStaffCompensations(activeSettings, workStaffNames));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [adForm, setAdForm] = useState({ date: todayIso(), creative: "", amount: 0, memo: "" });

  useEffect(() => {
    setDraft(ensureStaffCompensations(activeSettings, workStaffNames));
  }, [activeSettings, workStaffNames]);

  const month = currentMonth();
  const monthClosing = draft.monthClosings?.[month];
  const creativeOptions = useMemo(() => Array.from(new Set(leads.map((lead) => lead.adName || String(lead.source || "")).filter(Boolean))).sort(), [leads]);

  if (!manager) {
    return <><PageHeader title="정산설정" description="최고 관리자 전용 설정입니다." /><Card className="p-6 text-sm text-slate-600">정산설정은 로펌 관리자 또는 슈퍼관리자만 사용할 수 있습니다.</Card></>;
  }
  if (globalSuperView) {
    return <><PageHeader title="정산설정" description="로펌별 손익 기준은 각 로펌에 독립 저장됩니다." /><Card className="border-violet-200 bg-violet-50 p-6 text-sm text-violet-900"><div className="font-black">먼저 관리할 로펌을 선택해주세요.</div><div className="mt-2 text-xs leading-5 text-violet-700">슈퍼관리자 전체보기에서는 로펌별 기준 수임료·보상·광고비·운영비를 섞어서 저장하지 않습니다.</div></Card></>;
  }
  if (loading) return <div className="p-8 text-sm text-slate-500">정산설정을 불러오는 중...</div>;

  function patch<K extends keyof ManagementSettings>(key: K, value: ManagementSettings[K]) {
    setSaved(false);
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function patchFee(id: string, values: Partial<StandardFeeRule>) {
    patch("feeRules", draft.feeRules.map((row) => row.id === id ? { ...row, ...values } : row));
  }

  function addFeeVersion(caseType: CaseType) {
    const latest = draft.feeRules.filter((row) => row.caseType === caseType).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    const row: StandardFeeRule = {
      id: crypto.randomUUID(), caseType, effectiveFrom: todayIso(),
      baseFee: latest?.baseFee ?? 0, minFee: latest?.minFee ?? 0, approvalDiscountAmount: latest?.approvalDiscountAmount ?? 0,
    };
    patch("feeRules", [...draft.feeRules, row]);
  }

  function addAdSpend() {
    if (!adForm.date || !adForm.creative.trim() || adForm.amount <= 0) return;
    const entry: AdSpendEntry = { id: crypto.randomUUID(), date: adForm.date, creative: adForm.creative.trim(), amount: adForm.amount, memo: adForm.memo.trim() || undefined };
    patch("adSpendEntries", [entry, ...draft.adSpendEntries]);
    setAdForm({ date: todayIso(), creative: adForm.creative, amount: 0, memo: "" });
  }

  async function handleSave(next = draft) {
    setSaving(true); setSaved(false);
    try { const normalized = await save(next); setDraft(normalized); setSaved(true); }
    catch (e) { alert(e instanceof Error ? e.message : "저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  async function toggleMonthClose() {
    const next = { ...draft, monthClosings: { ...(draft.monthClosings ?? {}) } };
    if (next.monthClosings[month]) delete next.monthClosings[month];
    else next.monthClosings[month] = { closedAt: new Date().toISOString(), snapshot: makeFinancialSnapshot(draft) };
    setDraft(next);
    await handleSave(next);
  }

  const basePayroll = draft.staffCompensations.reduce((sum, row) => sum + row.baseSalary, 0);
  const fixedTotal = draft.fixedCosts.reduce((sum, row) => sum + row.monthlyAmount, 0);
  const monthAd = draft.adSpendEntries.filter((row) => row.date.startsWith(month)).reduce((sum, row) => sum + row.amount, 0);

  return (
    <>
      <PageHeader title="정산설정" description="관리자 입력은 이 메뉴 한 곳에서 관리하고, 대시보드·정산·데이터집계는 같은 값을 읽어 계산합니다." action={<div className="flex items-center gap-2"><button onClick={() => void toggleMonthClose()} className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold ${monthClosing ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-white text-slate-700"}`}>{monthClosing ? <LockKeyhole size={14}/> : <UnlockKeyhole size={14}/>} {monthClosing ? `${month} 마감됨 · 마감 해제` : `${month} 월마감`}</button><button onClick={() => void handleSave()} disabled={saving || !!monthClosing} className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50"><Save size={15}/>{monthClosing ? "마감 해제 후 수정" : saving ? "저장 중" : saved ? "저장됨" : "설정 저장"}</button></div>} />
      {error && <Card className="mb-4 border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">설정 불러오기 오류: {error}</Card>}
      {monthClosing && <Card className="mb-4 border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800"><b>{month}</b>은 마감되어 데이터집계에서 마감 당시의 기준 수임료·광고비·인건비·납부수수료·운영비를 고정해서 사용합니다. 수정하려면 먼저 마감을 해제하세요.</Card>}

      <fieldset disabled={!!monthClosing} className="m-0 min-w-0 border-0 p-0 disabled:opacity-70">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-5"><div className="text-xs font-bold text-slate-500">DB 비용 방식</div><div className="mt-3 flex gap-2">{(["direct_ads", "db_purchase"] as const).map((mode) => <button key={mode} onClick={() => patch("acquisitionMode", mode)} className={`rounded-lg px-3 py-2 text-xs font-bold ${draft.acquisitionMode === mode ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{mode === "direct_ads" ? "광고 직접 운영" : "로파워 DB 구매"}</button>)}</div>{draft.acquisitionMode === "db_purchase" && <div className="mt-3"><div className="mb-1 text-[11px] font-semibold text-slate-500">DB 구매 단가</div><MoneyInput value={draft.dbPurchaseUnitCost} onChange={(v) => patch("dbPurchaseUnitCost", v)} /></div>}</Card>
        <Card className="p-5"><div className="text-xs font-bold text-slate-500">운영 목표</div><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-[11px] text-slate-500">월 계약 목표<input type="number" value={draft.monthlyContractTarget} onChange={(e) => patch("monthlyContractTarget", n(e.target.value))} className="mt-1 h-9 w-full rounded-lg border px-3 text-sm" /></label><label className="text-[11px] text-slate-500">활성 DB 상한<input type="number" value={draft.activeDbCap} onChange={(e) => patch("activeDbCap", n(e.target.value))} className="mt-1 h-9 w-full rounded-lg border px-3 text-sm" /></label><label className="text-[11px] text-slate-500">방치 회수 기준(일)<input type="number" value={draft.neglectedDays} onChange={(e) => patch("neglectedDays", n(e.target.value))} className="mt-1 h-9 w-full rounded-lg border px-3 text-sm" /></label><label className="text-[11px] text-slate-500">최소 컨택 횟수<input type="number" value={draft.minimumContactAttempts} onChange={(e) => patch("minimumContactAttempts", n(e.target.value))} className="mt-1 h-9 w-full rounded-lg border px-3 text-sm" /></label></div></Card>
        <Card className="p-5"><div className="text-xs font-bold text-slate-500">이번 달 입력 요약</div><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span className="text-slate-500">광고비 입력</span><b>{fmtWon(monthAd)}</b></div><div className="flex justify-between"><span className="text-slate-500">기본급 합계</span><b>{fmtWon(basePayroll)}</b></div><div className="flex justify-between"><span className="text-slate-500">월 고정 운영비</span><b>{fmtWon(fixedTotal)}</b></div></div></Card>
      </div>

      <Card className="mt-4 overflow-hidden"><SectionTitle title="사무소 기준 수임료" sub="같은 사건유형이라도 적용 시작일별 버전을 남깁니다. 과거 계약의 할인율은 계약일 당시 기준으로 계산됩니다." /><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["사건유형","적용 시작일","기준 수임료","최저 허용 수임료","관리자 승인 할인액","관리"].map((h)=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{[...draft.feeRules].sort((a,b)=>a.caseType.localeCompare(b.caseType,"ko")||b.effectiveFrom.localeCompare(a.effectiveFrom)).map((row)=><tr key={row.id} className="border-t"><td className="px-4 py-3 font-bold">{row.caseType}</td><td className="px-4 py-3"><input type="date" value={row.effectiveFrom} onChange={(e)=>patchFee(row.id,{effectiveFrom:e.target.value})} className="h-9 rounded-lg border px-2"/></td><td className="px-4 py-3"><MoneyInput value={row.baseFee} onChange={(v)=>patchFee(row.id,{baseFee:v})}/></td><td className="px-4 py-3"><MoneyInput value={row.minFee} onChange={(v)=>patchFee(row.id,{minFee:v})}/></td><td className="px-4 py-3"><MoneyInput value={row.approvalDiscountAmount} onChange={(v)=>patchFee(row.id,{approvalDiscountAmount:v})}/></td><td className="px-4 py-3"><button onClick={()=>patch("feeRules",draft.feeRules.filter((x)=>x.id!==row.id))} className="rounded-lg border p-2 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button></td></tr>)}</tbody></table></div><div className="flex flex-wrap gap-2 border-t p-4">{CASE_TYPE_OPTIONS.map((type)=><button key={type} onClick={()=>addFeeVersion(type)} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><Plus size={12} className="mr-1 inline"/>{type} 새 기준</button>)}</div></Card>

      <Card className="mt-4 overflow-hidden"><SectionTitle title="상담사별 보상 조건" sub="기본급 + 성과급 기준을 입력합니다. 데이터집계의 총 인건비·계약당 순이익·상담사별 기여이익에 반영됩니다." /><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["상담사","계약 형태","월 기본급","성과급 기준","비율/금액","해지 시 환수"].map((h)=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{draft.staffCompensations.map((row)=><tr key={row.staff} className="border-t"><td className="px-4 py-3 font-bold">{row.staff}</td><td className="px-4 py-3"><select value={row.employmentType} onChange={(e)=>patch("staffCompensations",draft.staffCompensations.map((x)=>x.staff===row.staff?{...x,employmentType:e.target.value as "정규직"|"프리랜서"}:x))} className="h-9 rounded-lg border px-2"><option>정규직</option><option>프리랜서</option></select></td><td className="px-4 py-3"><MoneyInput value={row.baseSalary} onChange={(v)=>patch("staffCompensations",draft.staffCompensations.map((x)=>x.staff===row.staff?{...x,baseSalary:v}:x))}/></td><td className="px-4 py-3"><select value={row.incentiveMode} onChange={(e)=>patch("staffCompensations",draft.staffCompensations.map((x)=>x.staff===row.staff?{...x,incentiveMode:e.target.value as IncentiveMode}:x))} className="h-9 rounded-lg border px-2">{INCENTIVE_MODES.map((m)=><option key={m}>{m}</option>)}</select></td><td className="px-4 py-3"><div className="flex items-center gap-1"><input type="number" step="0.1" value={row.incentiveValue} onChange={(e)=>patch("staffCompensations",draft.staffCompensations.map((x)=>x.staff===row.staff?{...x,incentiveValue:n(e.target.value)}:x))} className="h-9 w-28 rounded-lg border px-3 text-right"/><span className="text-xs text-slate-400">{row.incentiveMode==="건당고정"?"원":"%"}</span></div></td><td className="px-4 py-3"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={row.clawbackOnCancel} onChange={(e)=>patch("staffCompensations",draft.staffCompensations.map((x)=>x.staff===row.staff?{...x,clawbackOnCancel:e.target.checked}:x))}/> 적용</label></td></tr>)}</tbody></table></div></Card>

      {draft.acquisitionMode === "direct_ads" && <Card className="mt-4 overflow-hidden"><SectionTitle title="광고비 입력" sub="기간·소재별 실제 집행금액을 입력합니다. 소재명은 DB의 광고명과 동일하게 맞추면 소재별 CPL·CPA가 자동 연결됩니다." /><div className="grid gap-2 border-b bg-slate-50 p-4 md:grid-cols-[150px_1fr_180px_1fr_auto]"><input type="date" value={adForm.date} onChange={(e)=>setAdForm(v=>({...v,date:e.target.value}))} className="h-10 rounded-lg border px-3 text-sm"/><div><input list="creative-list" value={adForm.creative} onChange={(e)=>setAdForm(v=>({...v,creative:e.target.value}))} placeholder="소재/광고명" className="h-10 w-full rounded-lg border px-3 text-sm"/><datalist id="creative-list">{creativeOptions.map((c)=><option key={c} value={c}/>)}</datalist></div><MoneyInput value={adForm.amount} onChange={(v)=>setAdForm(x=>({...x,amount:v}))}/><input value={adForm.memo} onChange={(e)=>setAdForm(v=>({...v,memo:e.target.value}))} placeholder="메모" className="h-10 rounded-lg border px-3 text-sm"/><button onClick={addAdSpend} className="h-10 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white">추가</button></div><div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead className="sticky top-0 bg-white text-xs text-slate-500"><tr>{["날짜","소재","금액","메모","관리"].map((h)=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr></thead><tbody>{draft.adSpendEntries.map((row)=><tr key={row.id} className="border-t"><td className="px-4 py-3">{row.date}</td><td className="px-4 py-3 font-semibold">{row.creative}</td><td className="px-4 py-3">{fmtWon(row.amount)}</td><td className="px-4 py-3 text-slate-500">{row.memo||"-"}</td><td className="px-4 py-3"><button onClick={()=>patch("adSpendEntries",draft.adSpendEntries.filter((x)=>x.id!==row.id))} className="rounded-lg border p-2 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button></td></tr>)}</tbody></table></div></Card>}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden"><SectionTitle title="납부 방식별 수수료" sub="사무소 부담분만 실수령 매출과 영업이익에서 비용으로 차감합니다." /><div className="divide-y">{draft.paymentFees.map((row)=><div key={row.paymentMethod} className="grid grid-cols-[1fr_110px_150px] items-center gap-3 px-5 py-3 text-sm"><div><b>{row.paymentMethod}</b><div className="mt-0.5 text-[11px] text-slate-400">{PAYMENT_METHOD_NOTE[row.paymentMethod]}</div></div><div className="flex items-center gap-1"><input type="number" step="0.1" value={row.rate} onChange={(e)=>patch("paymentFees",draft.paymentFees.map((x)=>x.paymentMethod===row.paymentMethod?{...x,rate:n(e.target.value)}:x))} className="h-9 w-20 rounded-lg border px-2 text-right"/><span className="text-xs text-slate-400">%</span></div><select value={row.payer} onChange={(e)=>patch("paymentFees",draft.paymentFees.map((x)=>x.paymentMethod===row.paymentMethod?{...x,payer:e.target.value as FeePayer}:x))} className="h-9 rounded-lg border px-2">{FEE_PAYERS.map((p)=><option key={p}>{p}</option>)}</select></div>)}</div></Card>
        <Card className="overflow-hidden"><SectionTitle title="월 고정 운영비" sub="임대료·통신·CRM 등 현금 기준 영업이익에 포함할 비용입니다." /><div className="divide-y">{draft.fixedCosts.map((row)=><div key={row.id} className="grid grid-cols-[1fr_180px_auto] items-center gap-3 px-5 py-3"><input value={row.label} onChange={(e)=>patch("fixedCosts",draft.fixedCosts.map((x)=>x.id===row.id?{...x,label:e.target.value}:x))} className="h-9 rounded-lg border px-3 text-sm"/><MoneyInput value={row.monthlyAmount} onChange={(v)=>patch("fixedCosts",draft.fixedCosts.map((x)=>x.id===row.id?{...x,monthlyAmount:v}:x))}/><button onClick={()=>patch("fixedCosts",draft.fixedCosts.filter((x)=>x.id!==row.id))} className="rounded-lg border p-2 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button></div>)}</div><div className="border-t p-4"><button onClick={()=>patch("fixedCosts",[...draft.fixedCosts,{id:crypto.randomUUID(),label:"기타 운영비",monthlyAmount:0}])} className="rounded-lg border px-3 py-2 text-xs font-bold"><Plus size={12} className="mr-1 inline"/>운영비 항목 추가</button></div></Card>
      </div>
      </fieldset>
    </>
  );
}
