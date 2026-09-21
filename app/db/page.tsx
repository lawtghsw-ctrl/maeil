"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import {
  CONSULT_DIRECTIONS,
  CONSULT_TIME_COLOR,
  CONSULT_TIME_OPTIONS,
  DB_LEAD_STATUS_LABEL,
  DB_LEAD_STATUSES,
  DEBT_RANGE_COLOR,
  DEBT_RANGE_OPTIONS,
  INCOME_RANGE_COLOR,
  INCOME_RANGE_OPTIONS,
  STAFF_LIST,
  type AssetRow,
  type ConsultDirection,
  type ConsultTimeSlot,
  type DbLead,
  type DbLeadStatus,
  type DebtRange,
  type DebtRow,
  type IncomeRange,
  type RepaymentPlanInput,
  type StaffName,
} from "@/lib/types";
import { computeRepaymentPlan, emptyAssetRows, emptyDebtRows, emptyPlanInput } from "@/lib/consultation";
import { ConsultationTabsEditor, CONSULTATION_TABS, type ConsultationTabKey } from "@/components/ui/ConsultationTabsEditor";
import { Button, Card, Modal, PageHeader, Pagination, SearchBox, pageRows } from "@/components/ui/Primitives";
import { fmtDate } from "@/lib/format";
import { ClipboardList } from "lucide-react";

// 콜(통화 시도) 횟수 — 0부터 시작해 ▲▼ 버튼으로 담당자가 직접 증감시키는 단순 카운터.
function CallCounter({ value, disabled, onChange }: { value: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 ${disabled ? "opacity-60" : ""}`}>
      <span className="min-w-[18px] text-center text-sm font-semibold text-slate-700">{value}</span>
      <div className="flex flex-col leading-none">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(value + 1)}
          className="grid h-3.5 w-4 place-items-center text-[9px] text-slate-500 hover:text-blue-600 disabled:cursor-not-allowed"
          aria-label="콜횟수 증가"
        >
          ▲
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="grid h-3.5 w-4 place-items-center text-[9px] text-slate-500 hover:text-blue-600 disabled:cursor-not-allowed"
          aria-label="콜횟수 감소"
        >
          ▼
        </button>
      </div>
    </div>
  );
}

// 광고 인스턴트 양식 응답(채무총금액/실월소득/상담가능시간) 색상 태그 — 예전 매일법률사무소
// DB 구글시트 'DB가공' 탭의 색상 구분 방식을 참고해 카테고리별로 구분되는 색을 지정했습니다.
function ColorTag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: `${color}1f`, color }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function LeadTags({ lead }: { lead: DbLead }) {
  if (!lead.debtRange && !lead.incomeRange && !lead.consultTime) {
    return <span className="text-[11px] text-slate-300">인스턴트 양식 응답 없음</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {lead.debtRange && <ColorTag label={lead.debtRange} color={DEBT_RANGE_COLOR[lead.debtRange]} />}
      {lead.incomeRange && <ColorTag label={lead.incomeRange} color={INCOME_RANGE_COLOR[lead.incomeRange]} />}
      {lead.consultTime && <ColorTag label={lead.consultTime} color={CONSULT_TIME_COLOR[lead.consultTime]} />}
    </div>
  );
}

// 상담가능시간·채무총금액·실월소득 3개 카테고리를 클릭해서 해당 그룹만 걸러볼 수 있는
// 피벗 필터 바 — "특히 상담가능시간대별로 총 DB 수량과 피벗해서 보여줄 수 있게" 요청에 따라
// 만들었고, 나머지 두 카테고리도 같은 방식으로 함께 제공합니다.
function PivotBar<T extends string>({
  label,
  options,
  colors,
  counts,
  total,
  active,
  onSelect,
}: {
  label: string;
  options: readonly T[];
  colors: Record<T, string>;
  counts: Partial<Record<T, number>>;
  total: number;
  active: T | "전체";
  onSelect: (v: T | "전체") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-[104px] shrink-0 text-xs font-semibold text-slate-500">{label}</span>
      <button
        type="button"
        onClick={() => onSelect("전체")}
        className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
          active === "전체" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        }`}
      >
        전체 {total}
      </button>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(opt)}
          className="rounded-md px-2 py-1 text-[11px] font-semibold transition"
          style={
            active === opt
              ? { background: colors[opt], color: "#fff" }
              : { background: `${colors[opt]}1f`, color: colors[opt] }
          }
        >
          {opt} {counts[opt] ?? 0}
        </button>
      ))}
    </div>
  );
}

function todayIsoStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return todayIsoStr(d);
}

// 재통화 예정일 상태 — 미지정이면 "접수일+1일"을 기본 제안값으로 보여주고, 지정된 날짜가
// 오늘이거나 지났으면 눈에 띄게 경고합니다("고려중 리드를 놓치지 않도록" 요청 반영).
function NextContactCell({ lead, onSet }: { lead: DbLead; onSet: (iso: string) => void }) {
  const done = !!lead.convertedClientId || lead.status === "거절" || lead.status === "부적합" || lead.status === "종결_중단";
  const suggested = lead.nextContactAt ?? addDaysIso(lead.receivedAt.slice(0, 10), 1);
  const today = todayIsoStr();
  const isOverdue = !done && !!lead.nextContactAt && lead.nextContactAt < today;
  const isToday = !done && !!lead.nextContactAt && lead.nextContactAt === today;

  return (
    <div className="space-y-1">
      <input
        type="date"
        disabled={done}
        value={lead.nextContactAt ?? ""}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onSet(e.target.value)}
        className={`h-9 w-full rounded-lg border px-2 text-xs outline-none disabled:opacity-60 ${
          isOverdue ? "border-red-300 bg-red-50 text-red-700" : isToday ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-white"
        }`}
      />
      {!lead.nextContactAt && !done && (
        <button
          type="button"
          onClick={() => onSet(suggested)}
          className="text-[10px] font-semibold text-blue-600 hover:underline"
        >
          미지정 → {fmtDate(suggested)} 제안(클릭해서 지정)
        </button>
      )}
      {isOverdue && <div className="text-[10px] font-semibold text-red-600">재통화 예정일이 지났어요</div>}
      {isToday && <div className="text-[10px] font-semibold text-amber-600">오늘 재통화 예정</div>}
    </div>
  );
}

// ---- 상담일지 작성 팝업 (DB 단계) ----
// 고객관리로 전환하기 전, DB 상담 단계에서부터 상담일지(인적사항~상담메모)를 작성할 수
// 있게 해달라는 요청 반영. 고객관리 CustomerEditModal과 동일한 ConsultationTabsEditor를
// 재사용하며, 여기서 작성한 내용은 고객 전환 시 그대로 승계됩니다(store.tsx 참고).
function LeadConsultationModal({ open, lead, onClose }: { open: boolean; lead: DbLead; onClose: () => void }) {
  const { updateLead } = useStore();
  const [tab, setTab] = useState<ConsultationTabKey>("인적사항");
  const [personal, setPersonal] = useState(lead.consultation?.personal ?? {});
  const [income, setIncome] = useState(lead.consultation?.income ?? {});
  const [assets, setAssets] = useState<AssetRow[]>(lead.consultation?.assets ?? emptyAssetRows());
  const [debts, setDebts] = useState<DebtRow[]>(lead.consultation?.debts ?? emptyDebtRows());
  const [plan, setPlan] = useState<RepaymentPlanInput>(lead.consultation?.plan ?? emptyPlanInput());
  const [consultMemo, setConsultMemo] = useState(lead.consultation?.memo ?? "");

  useEffect(() => {
    if (!open) return;
    setTab("인적사항");
    setPersonal(lead.consultation?.personal ?? {});
    setIncome(lead.consultation?.income ?? {});
    setAssets(lead.consultation?.assets ?? emptyAssetRows());
    setDebts(lead.consultation?.debts ?? emptyDebtRows());
    setPlan(lead.consultation?.plan ?? emptyPlanInput());
    setConsultMemo(lead.consultation?.memo ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead.id]);

  const result = useMemo(
    () => computeRepaymentPlan(income.monthlyAvgIncome ?? 0, income.secondaryIncome ?? 0, income.pensionIncome ?? 0, assets, debts, plan),
    [income, assets, debts, plan]
  );

  function save() {
    updateLead(lead.id, {
      consultation: { personal, income, assets, debts, plan, memo: consultMemo.trim() || undefined },
    });
    onClose();
  }

  return (
    <Modal open={open} title={`${lead.name} · 상담일지 작성 (DB 단계)`} onClose={onClose} size="xl">
      <div className="mb-4 rounded-xl bg-blue-50 px-4 py-3 text-xs text-blue-700">
        고객 전환 전이라도 상담 중 확인한 내용을 미리 기록해두면, 나중에 고객관리로 전환할 때 그대로 이어집니다.
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
        {CONSULTATION_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
              tab === t ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <ConsultationTabsEditor
        activeTab={tab}
        personal={personal}
        setPersonal={setPersonal}
        income={income}
        setIncome={setIncome}
        assets={assets}
        setAssets={setAssets}
        debts={debts}
        setDebts={setDebts}
        plan={plan}
        setPlan={setPlan}
        consultMemo={consultMemo}
        setConsultMemo={setConsultMemo}
        result={result}
      />

      <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onClose}>
          취소
        </Button>
        <Button onClick={save}>저장</Button>
      </div>
    </Modal>
  );
}

export default function DbManagementPage() {
  const { leads, updateLead, convertLeadToClient } = useStore();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DbLeadStatus | "전체">("전체");
  const [staffFilter, setStaffFilter] = useState<StaffName | "전체">("전체");
  const [timeFilter, setTimeFilter] = useState<ConsultTimeSlot | "전체">("전체");
  const [debtFilter, setDebtFilter] = useState<DebtRange | "전체">("전체");
  const [incomeFilter, setIncomeFilter] = useState<IncomeRange | "전체">("전체");
  const [page, setPage] = useState(1);
  const [justConverted, setJustConverted] = useState<string | null>(null);
  const [consultTarget, setConsultTarget] = useState<DbLead | null>(null);

  // 검색어·상태·담당자로 먼저 걸러낸 기준 집합 — 피벗 바의 그룹별 건수는 이 집합을
  // 기준으로 계산해, "지금 보고 있는 조건 안에서" 시간대/금액대별 분포가 보이도록 합니다.
  const baseRows = useMemo(() => {
    return leads
      .filter((l) => statusFilter === "전체" || l.status === statusFilter)
      .filter((l) => staffFilter === "전체" || l.assignedStaff === staffFilter)
      .filter((l) => {
        if (!query.trim()) return true;
        return l.name.includes(query) || l.phone.includes(query);
      });
  }, [leads, statusFilter, staffFilter, query]);

  const timeCounts = useMemo(() => {
    const map: Partial<Record<ConsultTimeSlot, number>> = {};
    for (const l of baseRows) if (l.consultTime) map[l.consultTime] = (map[l.consultTime] ?? 0) + 1;
    return map;
  }, [baseRows]);
  const debtCounts = useMemo(() => {
    const map: Partial<Record<DebtRange, number>> = {};
    for (const l of baseRows) if (l.debtRange) map[l.debtRange] = (map[l.debtRange] ?? 0) + 1;
    return map;
  }, [baseRows]);
  const incomeCounts = useMemo(() => {
    const map: Partial<Record<IncomeRange, number>> = {};
    for (const l of baseRows) if (l.incomeRange) map[l.incomeRange] = (map[l.incomeRange] ?? 0) + 1;
    return map;
  }, [baseRows]);

  const rows = useMemo(() => {
    return baseRows
      .filter((l) => timeFilter === "전체" || l.consultTime === timeFilter)
      .filter((l) => debtFilter === "전체" || l.debtRange === debtFilter)
      .filter((l) => incomeFilter === "전체" || l.incomeRange === incomeFilter)
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [baseRows, timeFilter, debtFilter, incomeFilter]);

  const newTodayCount = leads.filter((l) => l.status === "신규접수").length;

  return (
    <>
      <PageHeader
        title="DB관리"
        description={`광고 등으로 접수된 상담 신청 ${leads.length}건 · 미확인 신규 ${newTodayCount}건 — 기초정보를 메모하고 상태를 정리한 뒤 '고객 전환'으로 고객관리에 등록하세요.`}
      />

      <Card className="mb-4 space-y-3 p-3">
        <SearchBox
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          onReset={() => {
            setQuery("");
            setPage(1);
          }}
          placeholder="이름 · 연락처 검색"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setStatusFilter(e.target.value as DbLeadStatus | "전체");
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
          >
            <option value="전체">상태 전체</option>
            {DB_LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DB_LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            value={staffFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setStaffFilter(e.target.value as StaffName | "전체");
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
          >
            <option value="전체">담당자 전체</option>
            {STAFF_LIST.map((s) => (
              <option key={s} value={s}>
                담당 {s}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="mb-4 space-y-2.5 p-3">
        <div className="mb-1 text-xs font-semibold text-slate-400">
          광고 인스턴트 양식 피벗 — 그룹을 클릭하면 해당 리드만 걸러볼 수 있어요.
        </div>
        <PivotBar
          label="상담가능시간"
          options={CONSULT_TIME_OPTIONS}
          colors={CONSULT_TIME_COLOR}
          counts={timeCounts}
          total={baseRows.length}
          active={timeFilter}
          onSelect={(v) => {
            setTimeFilter(v);
            setPage(1);
          }}
        />
        <PivotBar
          label="채무 총금액"
          options={DEBT_RANGE_OPTIONS}
          colors={DEBT_RANGE_COLOR}
          counts={debtCounts}
          total={baseRows.length}
          active={debtFilter}
          onSelect={(v) => {
            setDebtFilter(v);
            setPage(1);
          }}
        />
        <PivotBar
          label="실 월소득"
          options={INCOME_RANGE_OPTIONS}
          colors={INCOME_RANGE_COLOR}
          counts={incomeCounts}
          total={baseRows.length}
          active={incomeFilter}
          onSelect={(v) => {
            setIncomeFilter(v);
            setPage(1);
          }}
        />
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 DB가 없습니다.</div>}
          {pageRows(rows, page, 10).map((lead) => (
            <div key={lead.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-base font-bold text-slate-900">{lead.name}</span>
                  <a href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`} className="mt-1 inline-block text-sm font-semibold text-blue-700">
                    {lead.phone}
                  </a>
                  <div className="mt-1 text-[11px] text-slate-400">{fmtDate(lead.receivedAt)}</div>
                </div>
              </div>
              <LeadTags lead={lead} />
              <select
                value={lead.applicationType ?? ""}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  updateLead(lead.id, { applicationType: (e.target.value || undefined) as ConsultDirection | undefined })
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                <option value="">상담 후 방향 미지정</option>
                {CONSULT_DIRECTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-sm text-slate-500">콜횟수</span>
                <CallCounter
                  value={lead.callCount ?? 0}
                  disabled={!!lead.convertedClientId}
                  onChange={(v) => updateLead(lead.id, { callCount: v })}
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">재통화 예정일</div>
                <NextContactCell lead={lead} onSet={(v) => updateLead(lead.id, { nextContactAt: v || undefined })} />
              </div>
              <select
                value={lead.assignedStaff}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { assignedStaff: e.target.value as StaffName })}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                {STAFF_LIST.map((s) => (
                  <option key={s} value={s}>
                    담당 {s}
                  </option>
                ))}
              </select>
              <select
                value={lead.status}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { status: e.target.value as DbLeadStatus })}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                {DB_LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DB_LEAD_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <input
                defaultValue={lead.memo ?? ""}
                placeholder="기초정보 메모 (부채원인, 특이사항 등)"
                onBlur={(e: FocusEvent<HTMLInputElement>) => updateLead(lead.id, { memo: e.target.value })}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setConsultTarget(lead)}>
                  <ClipboardList size={14} />
                  상담일지 작성
                </Button>
                {lead.convertedClientId ? (
                  <Link href="/clients" className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                    고객관리로 이동
                  </Link>
                ) : (
                  <Button
                    className="px-2.5 py-1.5"
                    onClick={() => {
                      convertLeadToClient(lead.id);
                      setJustConverted(lead.id);
                    }}
                  >
                    고객 전환
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[1420px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["접수일", "이름", "연락처", "리드정보(인스턴트양식)", "상담후방향", "콜횟수", "재통화 예정일", "담당자", "상태", "메모", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, 10).map((lead) => (
                <tr key={lead.id} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(lead.receivedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{lead.name}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{lead.phone}</td>
                  <td className="min-w-[160px] px-4 py-3">
                    <LeadTags lead={lead} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <select
                      value={lead.applicationType ?? ""}
                      disabled={!!lead.convertedClientId}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        updateLead(lead.id, { applicationType: (e.target.value || undefined) as ConsultDirection | undefined })
                      }
                      className="min-w-[100px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                    >
                      <option value="">미지정</option>
                      {CONSULT_DIRECTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <CallCounter
                      value={lead.callCount ?? 0}
                      disabled={!!lead.convertedClientId}
                      onChange={(v) => updateLead(lead.id, { callCount: v })}
                    />
                  </td>
                  <td className="min-w-[170px] px-4 py-3">
                    <NextContactCell lead={lead} onSet={(v) => updateLead(lead.id, { nextContactAt: v || undefined })} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <select
                      value={lead.assignedStaff}
                      disabled={!!lead.convertedClientId}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { assignedStaff: e.target.value as StaffName })}
                      className="min-w-[90px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                    >
                      {STAFF_LIST.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={lead.status}
                      disabled={!!lead.convertedClientId}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { status: e.target.value as DbLeadStatus })}
                      className="min-w-[110px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                    >
                      {DB_LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {DB_LEAD_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-[220px] px-4 py-3">
                    <input
                      defaultValue={lead.memo ?? ""}
                      placeholder="기초정보 메모 (부채원인, 특이사항 등)"
                      onBlur={(e: FocusEvent<HTMLInputElement>) => updateLead(lead.id, { memo: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setConsultTarget(lead)}>
                        <ClipboardList size={14} />
                        상담일지
                      </Button>
                      {lead.convertedClientId ? (
                        <Link href="/clients" className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                          고객관리로 이동
                        </Link>
                      ) : (
                        <Button
                          className="px-2.5 py-1.5"
                          onClick={() => {
                            convertLeadToClient(lead.id);
                            setJustConverted(lead.id);
                          }}
                        >
                          고객 전환
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                    조건에 맞는 DB가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={rows.length} onChange={setPage} pageSize={10} />
      </Card>

      {justConverted && (
        <Card className="mt-4 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          고객관리로 전환되었습니다.{" "}
          <Link href="/clients" className="font-semibold underline">
            고객관리에서 확인하기
          </Link>
        </Card>
      )}

      {consultTarget && (
        <LeadConsultationModal
          key={consultTarget.id}
          open={!!consultTarget}
          lead={consultTarget}
          onClose={() => setConsultTarget(null)}
        />
      )}
    </>
  );
}
