"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import {
  CONSULT_DIRECTIONS,
  CONSULT_TIME_OPTIONS,
  DB_DETAIL_STAGE_GROUPS,
  DB_DETAIL_STAGE_TRACKS,
  DB_LEAD_STATUS_LABEL,
  DB_LEAD_STATUSES,
  DEBT_RANGE_OPTIONS,
  INCOME_RANGE_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  STAFF_LIST,
  type AssetRow,
  type AttachedFileMeta,
  type ConsultDirection,
  type ConsultTimeSlot,
  type DbDetailStage,
  type DbLead,
  type DbLeadStatus,
  type DebtRange,
  type DebtRow,
  type IncomeRange,
  type LeadSource,
  type LoanRecord,
  type MemoLogEntry,
  type RepaymentPlanInput,
  type StaffName,
} from "@/lib/types";
import { checkCallWarning, checkConsultationRequired, computeRepaymentPlan, emptyAssetRows, emptyDebtRows, emptyPlanInput, kstDateStr } from "@/lib/consultation";
import { ConsultationTabsEditor } from "@/components/ui/ConsultationTabsEditor";
import { Button, Card, Label, Modal, PageHeader, Pagination, SearchBox, Select, pageRows, useClickOutside } from "@/components/ui/Primitives";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ClipboardList, Paperclip, ShieldAlert } from "lucide-react";

// 리드정보(광고 인스턴트 양식 응답) — 예전에는 색상 카드로 가로 나열했지만, "색상카드
// 빼고 다 텍스트로, 세로로 나오게" 요청에 따라 색상 없는 일반 텍스트를 세로로 나열합니다.
function LeadTags({ lead }: { lead: DbLead }) {
  if (!lead.debtRange && !lead.incomeRange && !lead.consultTime) {
    return <span className="text-[11px] text-slate-300">인스턴트 양식 응답 없음</span>;
  }
  return (
    <div className="space-y-0.5 text-[11px] text-slate-600">
      {lead.debtRange && <div>채무 총금액 · {lead.debtRange}</div>}
      {lead.incomeRange && <div>실 월소득 · {lead.incomeRange}</div>}
      {lead.consultTime && <div>상담가능시간 · {lead.consultTime}</div>}
    </div>
  );
}

// 상담가능시간·채무총금액·실월소득 3개 카테고리를 클릭해서 해당 그룹만 걸러볼 수 있는
// 피벗 필터 바. "색상카드 빼고 텍스트카드로 선택" 요청에 따라 카테고리별 색상 없이
// 선택 여부만 진하게/연하게로 구분되는 중립 톤 칩으로 바꿨습니다.
function PivotBar<T extends string>({
  label,
  options,
  counts,
  total,
  active,
  onSelect,
}: {
  label: string;
  options: readonly T[];
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
          onClick={() => onSelect(active === opt ? "전체" : opt)}
          className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
            active === opt ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {opt} {counts[opt] ?? 0}
        </button>
      ))}
    </div>
  );
}

// ---- 메모 게시판 미리보기 셀 ----
// "리스트 맨 우측 메모부분 텍스트란을 누르면 여태 했던 메모들이 보이게" 요청 반영.
// 상담일지에서 작성한 메모 게시판(memoLog)의 최신 항목을 미리 보여주고, 클릭하면
// 지금까지 쌓인 메모 전체를 팝오버로 펼쳐 보여줍니다. 새 메모 작성은 상담일지 팝업에서.
function LeadMemoCell({ lead, onOpenConsultation }: { lead: DbLead; onOpenConsultation: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const log = lead.consultation?.memoLog ?? [];
  const latest = log[0];

  return (
    <div ref={ref} className="relative w-full min-w-[180px] max-w-[220px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs whitespace-normal hover:bg-slate-50"
      >
        {latest ? (
          <>
            <span className="line-clamp-2 text-slate-700">{latest.text || `[${latest.tag}]`}</span>
            <span className="mt-0.5 block text-[10px] text-slate-400">메모 {log.length}건 · 최근 {fmtDateTime(latest.at)}</span>
          </>
        ) : (
          <span className="text-slate-300">메모 없음</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          {log.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-slate-400">작성된 메모가 없습니다.</div>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {log.map((entry) => (
                <li key={entry.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-semibold text-slate-900">{entry.staff}</span>
                    <span className="text-[10px] text-slate-400">{fmtDateTime(entry.at)}</span>
                    {entry.tag !== "일반" && (
                      <span
                        className={`rounded px-1 py-0.5 text-[9px] font-bold text-white ${
                          entry.tag === "재통화" ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      >
                        {entry.tag}
                      </span>
                    )}
                  </div>
                  {entry.text && <div className="mt-0.5 whitespace-pre-wrap text-slate-600">{entry.text}</div>}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenConsultation();
            }}
            className="mt-2 w-full rounded-lg bg-blue-50 px-2 py-1.5 text-center text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
          >
            상담일지에서 메모 작성 →
          </button>
        </div>
      )}
    </div>
  );
}

// ---- 상담일지 작성 팝업 (DB 단계) ----
// 고객관리로 전환하기 전, DB 상담 단계에서부터 상담일지를 작성할 수 있게 해달라는 요청
// 반영. 고객관리 CustomerEditModal과 동일한 ConsultationTabsEditor를 재사용하며, 여기서
// 작성한 내용은 고객 전환 시 그대로 승계됩니다(store.tsx 참고).
//
// "팝업을 확 키우고 한눈에 모든 작성칸이 보이도록, 아래로 스크롤하는 형식이 아니라
// 웹 창을 넘지 않는 선에서 크게" 요청 반영 — Modal을 최대한 넓은 size="full"로 키우고,
// 6개 섹션을 세로 1단이 아니라 2단 그리드로 배치해 한 화면에서 훨씬 많은 내용이 동시에
// 보이도록 했습니다(내용량이 많은 채무현황·상담메모 섹션만 2칸을 모두 차지).
function LeadConsultationModal({ open, lead, onClose }: { open: boolean; lead: DbLead; onClose: () => void }) {
  const { updateLead } = useStore();
  const [applicationType, setApplicationType] = useState<ConsultDirection | undefined>(lead.applicationType);
  const [detailStage, setDetailStage] = useState<DbDetailStage | undefined>(lead.detailStage);
  const [personal, setPersonal] = useState(lead.consultation?.personal ?? {});
  const [income, setIncome] = useState(lead.consultation?.income ?? {});
  const [assets, setAssets] = useState<AssetRow[]>(lead.consultation?.assets ?? emptyAssetRows());
  const [debts, setDebts] = useState<DebtRow[]>(lead.consultation?.debts ?? emptyDebtRows());
  const [plan, setPlan] = useState<RepaymentPlanInput>(lead.consultation?.plan ?? emptyPlanInput());
  const [memoLog, setMemoLog] = useState<MemoLogEntry[]>(lead.consultation?.memoLog ?? []);
  const [loanRecords, setLoanRecords] = useState<LoanRecord[]>(lead.consultation?.loanRecords ?? []);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileMeta[]>(lead.consultation?.attachedFiles ?? []);

  useEffect(() => {
    if (!open) return;
    setApplicationType(lead.applicationType);
    setDetailStage(lead.detailStage);
    setPersonal(lead.consultation?.personal ?? {});
    setIncome(lead.consultation?.income ?? {});
    setAssets(lead.consultation?.assets ?? emptyAssetRows());
    setDebts(lead.consultation?.debts ?? emptyDebtRows());
    setPlan(lead.consultation?.plan ?? emptyPlanInput());
    setMemoLog(lead.consultation?.memoLog ?? []);
    setLoanRecords(lead.consultation?.loanRecords ?? []);
    setAttachedFiles(lead.consultation?.attachedFiles ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead.id]);

  const result = useMemo(
    () => computeRepaymentPlan(income.monthlyAvgIncome ?? 0, income.secondaryIncome ?? 0, income.pensionIncome ?? 0, assets, debts, plan),
    [income, assets, debts, plan]
  );

  const completeness = useMemo(
    () =>
      checkConsultationRequired(applicationType, {
        personal,
        income,
        assets,
        debts,
        plan,
        loanRecords,
        attachedFiles,
      }),
    [applicationType, personal, income, assets, debts, plan, loanRecords, attachedFiles]
  );

  function save() {
    updateLead(lead.id, {
      applicationType,
      detailStage,
      consultation: {
        personal,
        income,
        assets,
        debts,
        plan,
        memoLog,
        loanRecords,
        attachedFiles,
      },
    });
    onClose();
  }

  const editorProps = {
    personal,
    setPersonal,
    income,
    setIncome,
    assets,
    setAssets,
    debts,
    setDebts,
    plan,
    setPlan,
    memoLog,
    setMemoLog,
    loanRecords,
    setLoanRecords,
    attachedFiles,
    setAttachedFiles,
    result,
  };

  return (
    <Modal open={open} title={`${lead.name} · 상담일지`} onClose={onClose} size="full">
      <div
        className={`mb-4 rounded-xl border-2 px-4 py-3 text-xs font-semibold ${
          completeness.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-300 bg-sky-50 text-sky-700"
        }`}
      >
        {completeness.ok ? (
          "필수 항목이 모두 입력되었습니다 — 고객 전환이 가능합니다."
        ) : (
          <div className="space-y-1">
            <div>아래 하늘색으로 표시된 필수 항목을 모두 입력해야 '고객 전환'이 가능합니다. (미입력 {completeness.missing.length}건)</div>
            <ul className="list-disc space-y-0.5 pl-4 font-normal">
              {completeness.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
        <Label text="상담 후 방향 (개인회생/개인파산/워크아웃)" required missing={!applicationType}>
          <Select
            value={applicationType ?? ""}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setApplicationType((e.target.value || undefined) as ConsultDirection | undefined)}
            className="w-full"
          >
            <option value="">미지정</option>
            {CONSULT_DIRECTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Label>
        <Label text="상세 단계 (상세 DB관리 분류)">
          <Select
            value={detailStage ?? ""}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setDetailStage((e.target.value || undefined) as DbDetailStage | undefined)}
            className="w-full"
          >
            <option value="">미지정</option>
            {DB_DETAIL_STAGE_TRACKS.map((track) => (
              <optgroup key={track} label={track}>
                {DB_DETAIL_STAGE_GROUPS[track].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Label>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 text-sm font-bold text-slate-900">인적사항</div>
          <ConsultationTabsEditor activeTab="인적사항" {...editorProps} />
        </Card>
        <Card className="p-4">
          <div className="mb-3 text-sm font-bold text-slate-900">소득현황</div>
          <ConsultationTabsEditor activeTab="소득현황" {...editorProps} />
        </Card>
        <Card className="p-4">
          <div className="mb-3 text-sm font-bold text-slate-900">재산현황</div>
          <ConsultationTabsEditor activeTab="재산현황" {...editorProps} />
        </Card>
        <Card className="p-4">
          <div className="mb-3 text-sm font-bold text-slate-900">변제계획</div>
          <ConsultationTabsEditor activeTab="변제계획" {...editorProps} />
        </Card>
        <Card className="p-4 xl:col-span-2">
          <div className="mb-3 text-sm font-bold text-slate-900">채무현황</div>
          <ConsultationTabsEditor activeTab="채무현황" {...editorProps} />
        </Card>
        <Card className="p-4 xl:col-span-2">
          <div className="mb-3 text-sm font-bold text-slate-900">상담메모</div>
          <ConsultationTabsEditor activeTab="상담메모" {...editorProps} />
        </Card>
      </div>

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
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "전체">("전체");
  const [timeFilter, setTimeFilter] = useState<ConsultTimeSlot | "전체">("전체");
  const [debtFilter, setDebtFilter] = useState<DebtRange | "전체">("전체");
  const [incomeFilter, setIncomeFilter] = useState<IncomeRange | "전체">("전체");
  const [page, setPage] = useState(1);
  const [justConverted, setJustConverted] = useState<string | null>(null);
  const [blockedNotice, setBlockedNotice] = useState<string[] | null>(null);
  const [consultTarget, setConsultTarget] = useState<DbLead | null>(null);

  // "실제 계약(=완결된 상담기록지)을 하지 않는 이상 고객관리로 넘기지 않도록" 요청 반영 —
  // 필수 항목이 다 채워졌는지 여기서 먼저 확인한 뒤에만 실제 전환을 실행합니다.
  function tryConvert(lead: DbLead) {
    const completeness = checkConsultationRequired(lead.applicationType, lead.consultation);
    if (!completeness.ok) {
      setBlockedNotice(completeness.missing);
      setConsultTarget(lead);
      return;
    }
    convertLeadToClient(lead.id);
    setJustConverted(lead.id);
  }

  // 검색어·상태·담당자로 먼저 걸러낸 기준 집합 — 피벗 바의 그룹별 건수는 이 집합을
  // 기준으로 계산해, "지금 보고 있는 조건 안에서" 시간대/금액대별 분포가 보이도록 합니다.
  const baseRows = useMemo(() => {
    return leads
      .filter((l) => statusFilter === "전체" || l.status === statusFilter)
      .filter((l) => staffFilter === "전체" || l.assignedStaff === staffFilter)
      .filter((l) => sourceFilter === "전체" || l.source === sourceFilter)
      .filter((l) => {
        if (!query.trim()) return true;
        return l.name.includes(query) || l.phone.includes(query);
      });
  }, [leads, statusFilter, staffFilter, sourceFilter, query]);

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

  // ---- 오늘 콜 관리 경고 — "전환되지 않은 디비는 하루 3번 이상 통화하도록, 3번 이내
  // 한번이라도 받으면 사라지는 경고표시"를 만들어달라는 요청 반영. 콜카운터(▲▼)와
  // 재통화 예정일은 삭제하고, 대신 상담일지 메모 게시판의 [재통화]/[부재중] 태그를
  // 오늘 날짜 기준으로 집계해 판정합니다(lib/consultation.ts의 checkCallWarning).
  const todayIso = kstDateStr();
  const warningLeads = useMemo(() => {
    return leads
      .filter((l) => {
        const done = !!l.convertedClientId || l.status === "거절" || l.status === "부적합" || l.status === "종결_중단";
        if (done) return false;
        return checkCallWarning(l.consultation?.memoLog, todayIso).active;
      })
      .map((l) => ({ lead: l, warning: checkCallWarning(l.consultation?.memoLog, todayIso) }))
      .sort((a, b) => b.warning.noAnswerCountToday - a.warning.noAnswerCountToday);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, todayIso]);

  return (
    <>
      <PageHeader
        title="DB관리"
        description={`광고 등으로 접수된 상담 신청 ${leads.length}건 · 미확인 신규 ${newTodayCount}건 — 기초정보를 메모하고 상태를 정리한 뒤 '고객 전환'으로 고객관리에 등록하세요.`}
      />

      <Card className="mb-4 overflow-hidden border-red-100">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ShieldAlert size={16} className="text-red-500" />
            오늘 콜 관리 경고 (부재중 3회 미만 &amp; 재통화 성공 없음)
          </div>
          <span className="text-xs text-slate-400">{warningLeads.length}건</span>
        </div>
        {warningLeads.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">오늘 콜 관리 경고가 필요한 DB가 없습니다.</div>
        ) : (
          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {warningLeads.map(({ lead: l, warning: w }) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setQuery(l.name);
                  setPage(1);
                }}
                className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-red-50/50 px-4 py-2.5 text-left text-xs transition hover:bg-red-50"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-slate-900">{l.name}</span>
                  <span className="ml-2 text-slate-400">{l.phone}</span>
                  <span className="ml-2 text-slate-400">담당 {l.assignedStaff}</span>
                </div>
                <span className="shrink-0 font-semibold text-red-600">오늘 부재중 {w.noAnswerCountToday}/3회</span>
              </button>
            ))}
          </div>
        )}
      </Card>

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
          <select
            value={sourceFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setSourceFilter(e.target.value as LeadSource | "전체");
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
          >
            <option value="전체">유입경로 전체</option>
            {LEAD_SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
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
              <select
                value={lead.source ?? ""}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  updateLead(lead.id, { source: (e.target.value || undefined) as LeadSource | undefined })
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                <option value="">유입경로 미지정</option>
                {LEAD_SOURCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">상담일지 메모</div>
                <LeadMemoCell lead={lead} onOpenConsultation={() => setConsultTarget(lead)} />
              </div>
              {!lead.convertedClientId && !checkConsultationRequired(lead.applicationType, lead.consultation).ok && (
                <div className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-semibold text-sky-700">
                  <ShieldAlert size={13} className="shrink-0" />
                  상담일지 필수 항목 미입력 — 고객 전환 불가
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  className="px-2.5 py-1.5"
                  onClick={() => {
                    setBlockedNotice(null);
                    setConsultTarget(lead);
                  }}
                >
                  <ClipboardList size={14} />
                  상담일지 작성
                </Button>
                {lead.convertedClientId ? (
                  <Link href="/clients" className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                    고객관리로 이동
                  </Link>
                ) : (
                  <Button className="px-2.5 py-1.5" onClick={() => tryConvert(lead)}>
                    고객 전환
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[1320px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["접수일", "이름", "연락처", "리드정보(인스턴트양식)", "유입경로", "상담후방향", "담당자", "상태", "메모", ""].map((h) => (
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
                  <td className="min-w-[200px] max-w-[240px] px-4 py-3">
                    <LeadTags lead={lead} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <select
                      value={lead.source ?? ""}
                      disabled={!!lead.convertedClientId}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        updateLead(lead.id, { source: (e.target.value || undefined) as LeadSource | undefined })
                      }
                      className="min-w-[130px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                    >
                      <option value="">미지정</option>
                      {LEAD_SOURCE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
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
                    <div className="space-y-1.5">
                      <input
                        defaultValue={lead.memo ?? ""}
                        placeholder="기초정보 메모"
                        onBlur={(e: FocusEvent<HTMLInputElement>) => updateLead(lead.id, { memo: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                      />
                      <LeadMemoCell lead={lead} onOpenConsultation={() => setConsultTarget(lead)} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      {!lead.convertedClientId && !checkConsultationRequired(lead.applicationType, lead.consultation).ok && (
                        <span className="flex items-center gap-1 whitespace-normal rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                          <ShieldAlert size={11} className="shrink-0" />
                          필수항목 미입력
                        </span>
                      )}
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1.5"
                        onClick={() => {
                          setBlockedNotice(null);
                          setConsultTarget(lead);
                        }}
                      >
                        <ClipboardList size={14} />
                        상담일지
                      </Button>
                      {lead.convertedClientId ? (
                        <Link href="/clients" className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                          고객관리로 이동
                        </Link>
                      ) : (
                        <Button className="px-2.5 py-1.5" onClick={() => tryConvert(lead)}>
                          고객 전환
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
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

      {blockedNotice && (
        <Card className="mt-4 border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldAlert size={15} />
                상담일지 필수 항목이 비어있어 고객 전환할 수 없습니다.
              </div>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs font-normal">
                {blockedNotice.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <div className="mt-1.5 text-xs font-normal">아래 상담일지 팝업에서 하늘색으로 표시된 항목을 입력한 뒤 저장하고 다시 시도하세요.</div>
            </div>
            <button type="button" onClick={() => setBlockedNotice(null)} className="shrink-0 text-sky-400 hover:text-sky-700">
              ✕
            </button>
          </div>
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
