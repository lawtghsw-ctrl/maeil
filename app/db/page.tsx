"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import {
  CONSULT_DIRECTIONS,
  CONSULT_TIME_OPTIONS,
  DB_LEAD_STATUS_LABEL,
  DB_LEAD_STATUSES,
  DEBT_RANGE_OPTIONS,
  INCOME_RANGE_OPTIONS,
  STAFF_LIST,
  type ConsultDirection,
  type ConsultTimeSlot,
  type DbDetailStage,
  type DbLead,
  type DbLeadStatus,
  type DebtRange,
  type IncomeRange,
  type StaffName,
} from "@/lib/types";
import { checkCallWarning, checkConsultationRequired, kstDateStr } from "@/lib/consultation";
import { ConsultationModal } from "@/components/ui/consultation/ConsultationModal";
import { Button, Card, PageHeader, Pagination, SearchBox, pageRows, useClickOutside } from "@/components/ui/Primitives";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ClipboardList, ShieldAlert } from "lucide-react";

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
// v12: 여러 탭을 오가며 입력하던 기존 방식(ConsultationTabsEditor)을 걷어내고, 정보는
// 많지만 한 화면에서 훑어볼 수 있는 대형 단일 팝업(components/ui/consultation/
// ConsultationModal)으로 교체했습니다. 이 컴포넌트는 그 공용 팝업을 얇게 감싸서
// DB관리 화면에만 있는 "상담 후 방향(applicationType)"·"상세 단계(detailStage)" 선택을
// 로컬 상태로 들고 있다가 저장 시 상담일지 내용과 함께 updateLead 한 번에 반영합니다
// (고객 전환 시 lead.consultation이 그대로 Client.consultation으로 승계되는 기존 동작은
// store.tsx의 convertLeadToClient에서 전혀 바뀌지 않았습니다).
function LeadConsultationModal({ open, lead, onClose }: { open: boolean; lead: DbLead; onClose: () => void }) {
  const { updateLead } = useStore();
  const [applicationType, setApplicationType] = useState<ConsultDirection | undefined>(lead.applicationType);
  const [detailStage, setDetailStage] = useState<DbDetailStage | undefined>(lead.detailStage);

  useEffect(() => {
    if (!open) return;
    setApplicationType(lead.applicationType);
    setDetailStage(lead.detailStage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead.id]);

  return (
    <ConsultationModal
      open={open}
      resetKey={lead.id}
      onClose={onClose}
      displayName={lead.name}
      displayPhone={lead.phone}
      joinedAtLabel={fmtDate(lead.receivedAt)}
      caseNumberLabel="- (법원 접수 전)"
      applicationType={applicationType}
      onApplicationTypeChange={setApplicationType}
      showDetailStage
      detailStage={detailStage}
      onDetailStageChange={setDetailStage}
      initialConsultation={lead.consultation}
      onSave={(consultation) => {
        updateLead(lead.id, { applicationType, detailStage, consultation });
      }}
    />
  );
}

// ---- 콜 관리 경고 인라인 뱃지 ----
// v12: 별도 상단 배너 대신 고객(DB) 리스트 각 행에 직접 뜨도록 요청 반영. 이미 전환됐거나
// 거절/부적합/종결 처리된 리드는 표시하지 않고(=더 이상 관리 대상 아님), 오늘 기준으로
// checkCallWarning이 활성(=아직 오늘 몫의 통화 관리가 안 된 상태)일 때만 렌더링합니다.
function CallWarningBadge({ lead, todayIso }: { lead: DbLead; todayIso: string }) {
  const done = !!lead.convertedClientId || lead.status === "거절" || lead.status === "부적합" || lead.status === "종결_중단";
  if (done) return null;
  const warning = checkCallWarning(lead.consultation?.memoLog, todayIso);
  if (!warning.active) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
      <ShieldAlert size={11} className="shrink-0" />
      콜 관리 경고 · 부재중 {warning.noAnswerCountToday}/3
    </span>
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

  // ---- 오늘 콜 관리 경고 ----
  // v12: "콜 관리 경고는 상단에 따로 띄우는게 아니라 고객리스트 자체에 뜨게끔 해달라"는
  // 요청 반영 — 별도 상단 배너 Card는 없애고, 아래 리스트(모바일 카드/데스크톱 표) 각 행에
  // CallWarningBadge로 인라인 표시합니다. 판정 로직(lib/consultation.ts의
  // checkCallWarning) 자체는 그대로이며, "오늘" 기준 날짜(todayIso)만 여기서 한 번 계산해
  // 각 행에 내려줍니다.
  const todayIso = kstDateStr();

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
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-base font-bold text-slate-900">{lead.name}</span>
                    <CallWarningBadge lead={lead} todayIso={todayIso} />
                  </div>
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
                {["접수일", "이름", "연락처", "리드정보(인스턴트양식)", "상담후방향", "담당자", "상태", "메모", ""].map((h) => (
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900">{lead.name}</span>
                      <CallWarningBadge lead={lead} todayIso={todayIso} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{lead.phone}</td>
                  <td className="min-w-[200px] max-w-[240px] px-4 py-3">
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
                    <LeadMemoCell lead={lead} onOpenConsultation={() => setConsultTarget(lead)} />
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
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
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
