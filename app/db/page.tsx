"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import {
  CONSULT_DIRECTIONS,
  CONSULT_TIME_OPTIONS,
  DB_DETAIL_STAGE_GROUPS,
  DB_DETAIL_STAGE_TRACK_COLOR,
  DB_DETAIL_STAGE_TRACKS,
  DB_LEAD_DEFAULT_STAGE_BY_STATUS,
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
        전체 [{total}건]
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
          {opt} [{counts[opt] ?? 0}건]
        </button>
      ))}
    </div>
  );
}

// ---- DB관리 통합 진행단계 보드 ----
function effectiveStage(lead: DbLead): DbDetailStage {
  return lead.detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status];
}

// 콜 관리 경고는 "부재" / "착수금 안내" 단계에서만 운영합니다.
// 상단 진행보드의 느낌표와 고객 행의 상세 경고가 서로 다른 조건을 쓰지 않도록
// 하나의 Set으로 공유합니다. 날짜별 판정은 checkCallWarning()이 KST 기준 오늘 기록만
// 집계하므로 전날의 통화완료/부재중 기록은 자동으로 무시되고 매일 00:00에 초기화됩니다.
const CALL_WARNING_STAGES = new Set<DbDetailStage>(["부재", "착수금 안내"]);

// 화면을 밤새 열어둔 경우에도 KST 00:00에 콜 경고를 즉시 새 날짜 기준으로 다시 계산합니다.
// 다음 한국시간 자정의 실제 epoch를 구해 setTimeout을 한 번 걸고, 실행 뒤 다음 자정을 다시 예약합니다.
function msUntilNextKstMidnight(now = new Date()): number {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const nextKstMidnightAsUtc = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  const nextKstMidnightEpoch = nextKstMidnightAsUtc - KST_OFFSET_MS;
  return Math.max(250, nextKstMidnightEpoch - now.getTime());
}

// 기존 status는 전환/콜경고 등 내부 호환에 계속 쓰므로, 사용자가 통합 진행단계를 바꾸면
// 가장 가까운 기존 status도 함께 갱신합니다. 화면의 실질 관리값은 detailStage입니다.
function legacyStatusForStage(stage: DbDetailStage, current: DbLeadStatus): DbLeadStatus {
  if (stage === "신규디비") return "신규접수";
  if (stage === "예약") return "상담예정";
  if (stage === "상담") return "상담완료";
  if (stage === "부재") return "부재중";
  if (stage === "착수금 안내") return "재통화필요";
  if (stage === "설득필요") return "재통화필요";
  if (stage === "장기부재") return "종결_중단";
  if (stage === "불가") return "부적합";
  if (DB_DETAIL_STAGE_GROUPS.서류.includes(stage)) return "서류검토중";
  if (DB_DETAIL_STAGE_GROUPS.착수.includes(stage) || DB_DETAIL_STAGE_GROUPS.법원.includes(stage) || DB_DETAIL_STAGE_GROUPS.워크아웃.includes(stage)) {
    return current === "수임전환" ? current : "계약진행중";
  }
  return current;
}

function StageBoard({
  counts,
  warningCounts,
  total,
  active,
  onSelect,
}: {
  counts: Partial<Record<DbDetailStage, number>>;
  warningCounts: Partial<Record<DbDetailStage, number>>;
  total: number;
  active: DbDetailStage | "전체";
  onSelect: (stage: DbDetailStage | "전체") => void;
}) {
  return (
    <Card className="mb-3 overflow-x-auto p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSelect("전체")}
          className={`h-8 rounded-md border px-3 text-xs font-bold transition ${
            active === "전체" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          전체 {total}건
        </button>
      </div>
      <div className="grid min-w-[1080px] grid-cols-5 gap-1.5">
        {DB_DETAIL_STAGE_TRACKS.map((track) => (
          <div key={track} className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div
              className="px-2 py-1.5 text-center text-[11px] font-black text-white"
              style={{ backgroundColor: DB_DETAIL_STAGE_TRACK_COLOR[track] }}
            >
              {track}
            </div>
            <div className="space-y-0.5 p-1">
              {DB_DETAIL_STAGE_GROUPS[track].map((stage) => {
                const count = counts[stage] ?? 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                const selected = active === stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => onSelect(selected ? "전체" : stage)}
                    className={`flex h-7 w-full items-center justify-between rounded px-2 text-[10px] font-semibold transition ${
                      selected ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="truncate">{stage}</span>
                      {CALL_WARNING_STAGES.has(stage) && (warningCounts[stage] ?? 0) > 0 && (
                        <span
                          title={`오늘 콜 관리가 필요한 DB ${(warningCounts[stage] ?? 0)}건`}
                          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                            selected ? "bg-white text-red-600" : "bg-red-500 text-white"
                          }`}
                        >
                          !
                        </span>
                      )}
                    </span>
                    <span className={`ml-2 shrink-0 ${selected ? "text-white/80" : "text-slate-400"}`}>
                      {count}건{count > 0 ? ` (${pct.toFixed(pct < 1 ? 1 : 0)}%)` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
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
// v17: 진행단계는 DB관리 상단 통합 보드/리스트에서 직접 관리하므로 상담일지 팝업의
// 중복 "상세 단계" 드롭다운은 더 이상 띄우지 않습니다. 상담일지는 상담 내용 자체에 집중.
function LeadConsultationModal({ open, lead, onClose }: { open: boolean; lead: DbLead; onClose: () => void }) {
  const { updateLead } = useStore();
  const [applicationType, setApplicationType] = useState<ConsultDirection | undefined>(lead.applicationType);

  useEffect(() => {
    if (!open) return;
    setApplicationType(lead.applicationType);
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
      initialConsultation={lead.consultation}
      onSave={(consultation) => {
        updateLead(lead.id, { applicationType, consultation });
      }}
    />
  );
}


// ---- 예약일시 간편 입력 ----
// 브라우저의 datetime-local 팝업은 날짜/시/분을 한 번에 조작해야 해서 빠른 콜 예약에
// 불편했습니다. 날짜 달력 + 시간(오전/오후 표기) + 10분 단위 분 선택으로 분리해 같은
// reservationAt(YYYY-MM-DDTHH:mm) 필드에 저장합니다.
const RESERVATION_MINUTES = ["00", "10", "20", "30", "40", "50"] as const;
const RESERVATION_HOURS = Array.from({ length: 24 }, (_, hour) => {
  const period = hour < 12 ? "오전" : "오후";
  const displayHour = hour % 12 || 12;
  return { value: String(hour).padStart(2, "0"), label: `${period} ${displayHour}시` };
});

function ReservationDateTimeEditor({
  value,
  disabled,
  onChange,
  compact = false,
}: {
  value?: string;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
  compact?: boolean;
}) {
  const date = value?.slice(0, 10) ?? "";
  const time = value?.slice(11, 16) ?? "";
  const [hour = "", minute = ""] = time.split(":");

  const commit = (nextDate: string, nextHour: string, nextMinute: string) => {
    if (!nextDate) {
      onChange(undefined);
      return;
    }
    onChange(`${nextDate}T${nextHour || "10"}:${nextMinute || "00"}`);
  };

  return (
    <div className={`flex items-center gap-1 ${compact ? "min-w-[300px]" : "w-full"}`}>
      <input
        type="date"
        value={date}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => commit(e.target.value, hour || "10", minute || "00")}
        className={`${compact ? "w-[126px]" : "min-w-0 flex-1"} h-9 rounded-lg border border-amber-200 bg-amber-50 px-2 text-[11px] font-semibold text-amber-900 outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300`}
      />
      <select
        value={hour || "10"}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => commit(date || kstDateStr(), e.target.value, minute || "00")}
        className={`${compact ? "w-[92px]" : "w-[104px]"} h-9 rounded-lg border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-900 outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300`}
      >
        {RESERVATION_HOURS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <select
        value={minute || "00"}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => commit(date || kstDateStr(), hour || "10", e.target.value)}
        className={`${compact ? "w-[68px]" : "w-[76px]"} h-9 rounded-lg border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-900 outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300`}
      >
        {RESERVATION_MINUTES.map((m) => <option key={m} value={m}>{m}분</option>)}
      </select>
    </div>
  );
}

// ---- 콜 관리 경고 인라인 뱃지 ----
// v12: 별도 상단 배너 대신 고객(DB) 리스트 각 행에 직접 뜨도록 요청 반영. 이미 전환됐거나
// 거절/부적합/종결 처리된 리드는 표시하지 않고(=더 이상 관리 대상 아님), 오늘 기준으로
// checkCallWarning이 활성(=아직 오늘 몫의 통화 관리가 안 된 상태)일 때만 렌더링합니다.
function CallWarningBadge({ lead, todayIso }: { lead: DbLead; todayIso: string }) {
  const done = !!lead.convertedClientId || lead.status === "거절" || lead.status === "부적합" || lead.status === "종결_중단";
  if (done) return null;
  // 영업 콜 경고는 요청대로 진행단계가 "부재" 또는 "착수금 안내"일 때만 고객 행에 노출합니다.
  const stage = effectiveStage(lead);
  if (!CALL_WARNING_STAGES.has(stage)) return null;
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
  const { leads, cases, updateLead, convertLeadToClient } = useStore();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<DbDetailStage | "전체">("전체");
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

  // 검색어·담당자까지 적용한 전체 집합에서 진행단계 건수를 먼저 계산하고, 상단 보드에서
  // 선택한 단계만 baseRows로 내려보냅니다. 따라서 다른 광고 피벗과 조합해서 사용할 수 있습니다.
  const stageUniverse = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const compactNeedle = needle.replace(/[\s\-().]/g, "");

    return leads
      .filter((l) => staffFilter === "전체" || l.assignedStaff === staffFilter)
      .filter((l) => {
        if (!needle) return true;

        // 이름/연락처/기초메모/상담메모/사건번호를 모두 한 검색창에서 부분검색합니다.
        // 같은 문자열(예: 전화번호 중간 1111)을 가진 고객이 여러 명이면 모두 남깁니다.
        const memoLogText = (l.consultation?.memoLog ?? [])
          .map((entry) => `${entry.text} ${entry.tag} ${entry.staff}`)
          .join(" ");
        const relatedCaseNumbers = cases
          .filter(
            (c) =>
              c.fromLeadId === l.id ||
              c.id === l.convertedCaseId ||
              (!!l.convertedClientId && c.clientId === l.convertedClientId)
          )
          .map((c) => c.caseNumber)
          .join(" ");
        const searchable = [
          l.name,
          l.phone,
          l.memo ?? "",
          l.consultation?.memo ?? "",
          memoLogText,
          relatedCaseNumbers,
        ]
          .join(" ")
          .toLowerCase();

        if (searchable.includes(needle)) return true;
        if (!compactNeedle) return false;

        // 하이픈/공백을 빼고도 비교해 0101111 또는 사건번호 일부 입력도 동작하게 합니다.
        return searchable.replace(/[\s\-().]/g, "").includes(compactNeedle);
      });
  }, [leads, cases, staffFilter, query]);

  const stageCounts = useMemo(() => {
    const map: Partial<Record<DbDetailStage, number>> = {};
    for (const lead of stageUniverse) {
      const stage = effectiveStage(lead);
      map[stage] = (map[stage] ?? 0) + 1;
    }
    return map;
  }, [stageUniverse]);

  const baseRows = useMemo(
    () => stageUniverse.filter((lead) => stageFilter === "전체" || effectiveStage(lead) === stageFilter),
    [stageUniverse, stageFilter]
  );

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


  // ---- 오늘 콜 관리 경고 ----
  // 콜 경고는 KST 기준 오늘의 상담메모만 사용합니다. 과거 날짜의 통화완료/부재중 로그는
  // 판정에서 제외하며, 화면을 계속 열어둔 상태에서도 한국시간 00:00이 되면 todayIso를
  // 새 날짜로 갱신해 즉시 다시 초기 상태로 계산합니다.
  const [todayIso, setTodayIso] = useState(() => kstDateStr());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextReset = () => {
      timer = setTimeout(() => {
        setTodayIso(kstDateStr());
        scheduleNextReset();
      }, msUntilNextKstMidnight() + 50);
    };

    scheduleNextReset();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 상단 상담 진행판과 고객 행 모두 "부재" / "착수금 안내" 단계만 콜 관리 대상으로 봅니다.
  // checkCallWarning은 KST 기준 오늘 로그만 집계하므로 이전 날짜의 통화완료/부재중 기록은
  // 전부 무시되고 매일 00:00에 다시 경고 판정이 시작됩니다.
  const stageWarningCounts = useMemo(() => {
    const map: Partial<Record<DbDetailStage, number>> = {};
    for (const lead of stageUniverse) {
      if (lead.convertedClientId || lead.status === "거절" || lead.status === "부적합" || lead.status === "종결_중단") continue;
      const stage = effectiveStage(lead);
      if (!CALL_WARNING_STAGES.has(stage)) continue;
      if (!checkCallWarning(lead.consultation?.memoLog, todayIso).active) continue;
      map[stage] = (map[stage] ?? 0) + 1;
    }
    return map;
  }, [stageUniverse, todayIso]);

  return (
    <>
      <PageHeader title="DB관리" />

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
          placeholder="고객명 · 메모 · 연락처 · 사건번호 검색"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-slate-500">담당자</span>
          <button
            type="button"
            onClick={() => {
              setStaffFilter("전체");
              setPage(1);
            }}
            className={`h-8 rounded-md border px-3 text-xs font-semibold transition ${
              staffFilter === "전체"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            전체
          </button>
          {STAFF_LIST.map((staff) => (
            <button
              key={staff}
              type="button"
              onClick={() => {
                setStaffFilter(staffFilter === staff ? "전체" : staff);
                setPage(1);
              }}
              className={`h-8 rounded-md border px-3 text-xs font-semibold transition ${
                staffFilter === staff
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {staff}
            </button>
          ))}
        </div>
      </Card>

      <StageBoard
        counts={stageCounts}
        warningCounts={stageWarningCounts}
        total={stageUniverse.length}
        active={stageFilter}
        onSelect={(stage) => {
          setStageFilter(stage);
          setPage(1);
        }}
      />

      <Card className="mb-4 space-y-2.5 p-3">
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
                value={effectiveStage(lead)}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  const detailStage = e.target.value as DbDetailStage;
                  updateLead(lead.id, { detailStage, status: legacyStatusForStage(detailStage, lead.status) });
                }}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                {DB_DETAIL_STAGE_TRACKS.map((track) => (
                  <optgroup key={track} label={track}>
                    {DB_DETAIL_STAGE_GROUPS[track].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                  </optgroup>
                ))}
              </select>
              {effectiveStage(lead) === "예약" && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-amber-700">예약일시</span>
                  <ReservationDateTimeEditor
                    value={lead.reservationAt}
                    disabled={!!lead.convertedClientId}
                    onChange={(reservationAt) => updateLead(lead.id, { reservationAt })}
                  />
                </label>
              )}
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
          <table className="admin-responsive-table w-full min-w-[1680px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["접수일", "이름", "연락처", "리드정보(인스턴트양식)", "상담후방향", "담당자", "진행단계", "예약일시", "메모", ""].map((h) => (
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
                      value={effectiveStage(lead)}
                      disabled={!!lead.convertedClientId}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                        const detailStage = e.target.value as DbDetailStage;
                        updateLead(lead.id, { detailStage, status: legacyStatusForStage(detailStage, lead.status) });
                      }}
                      className="min-w-[130px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                    >
                      {DB_DETAIL_STAGE_TRACKS.map((track) => (
                        <optgroup key={track} label={track}>
                          {DB_DETAIL_STAGE_GROUPS[track].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-[320px] px-4 py-3">
                    <ReservationDateTimeEditor
                      value={lead.reservationAt}
                      disabled={!!lead.convertedClientId || effectiveStage(lead) !== "예약"}
                      onChange={(reservationAt) => updateLead(lead.id, { reservationAt })}
                      compact
                    />
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
                      <div className="flex items-center justify-end gap-1.5">
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
