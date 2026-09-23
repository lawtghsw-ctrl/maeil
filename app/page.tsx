"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  FileSignature,
  PhoneCall,
  PhoneMissed,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import {
  computeStats,
  isNextBlocked,
  nextAnchor,
  periodHeadline,
  prevAnchor,
  type PeriodMode,
} from "@/lib/period-engine";
import { dayMap } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import {
  CASE_TYPE_COLORS,
  getOverdueList,
  getStageDistribution,
  STAGE_CHART_COLORS,
} from "@/lib/dashboard";
import { DB_LEAD_DEFAULT_STAGE_BY_STATUS, STAGE_GENERIC_LABELS, type DbLead } from "@/lib/types";
import { checkCallWarning, kstDateStr } from "@/lib/consultation";
import { fmtEokMan, fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { PeriodControl } from "@/components/ui/PeriodControl";
import { KpiCard } from "@/components/ui/KpiCard";
import { DonutChart } from "@/components/charts/DonutChart";
import { StackedRatioBar } from "@/components/charts/StackedRatioBar";
import { MonthCalendar, type CalendarItem } from "@/components/charts/MonthCalendar";

type ContractPeriod = "일" | "주" | "월" | "기간설정";
type TodoKind = "재통화약속" | "상담 중" | "고려중";

function todayLocal(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function monthRange() {
  const t = todayLocal();
  const [y, m] = t.split("-").map(Number);
  return {
    start: `${y}-${String(m).padStart(2, "0")}-01`,
    end: `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`,
  };
}

function inRange(date: string, start: string, end: string): boolean {
  const d = date.slice(0, 10);
  return (!start || d >= start) && (!end || d <= end);
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function weekBounds(today: string): { start: string; end: string } {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const fromMonday = weekday === 0 ? 6 : weekday - 1;
  const start = addDays(today, -fromMonday);
  return { start, end: addDays(start, 6) };
}

function monthBounds(today: string): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${y}-${String(m).padStart(2, "0")}-01`,
    end: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

function leadStage(lead: DbLead) {
  return lead.detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status];
}

function greetingCompletedToday(lead: DbLead, today: string): boolean {
  const received = new Date(lead.receivedAt);
  if (!Number.isFinite(received.getTime()) || kstDateStr(received) !== today) return false;
  const entries = lead.consultation?.memoLog ?? [];
  return entries.some((entry) => {
    const at = new Date(entry.at);
    if (!Number.isFinite(at.getTime()) || kstDateStr(at) !== today) return false;
    const text = entry.text.replace(/\s+/g, " ");
    return /(문자|인사)/.test(text) && /(완료|발송|안내)/.test(text);
  });
}

function TodoBoard({
  groups,
}: {
  groups: Array<{ kind: TodoKind; rows: DbLead[] }>;
}) {
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="text-sm font-bold text-slate-900">투두리스트</div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">총 {total}건</span>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-4 py-2.5">구분</th>
              <th className="px-4 py-2.5">고객명</th>
              <th className="px-4 py-2.5">연락처</th>
              <th className="px-4 py-2.5">담당자</th>
              <th className="px-4 py-2.5">일정 / 상태</th>
              <th className="px-4 py-2.5">메모</th>
              <th className="px-4 py-2.5 text-right">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.flatMap(({ kind, rows }) =>
              rows.slice(0, 12).map((lead) => (
                <tr key={`${kind}-${lead.id}`} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-1 text-[11px] font-bold ${
                        kind === "재통화약속"
                          ? "bg-amber-50 text-amber-700"
                          : kind === "상담 중"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-violet-50 text-violet-700"
                      }`}
                    >
                      {kind} DB
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{lead.name}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.phone}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.assignedStaff}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {kind === "재통화약속" && lead.reservationAt
                      ? `예약 ${lead.reservationAt.replace("T", " ")}`
                      : kind === "상담 중"
                        ? "상담 진행 중"
                        : "고려중 · 재컨택 필요"}
                  </td>
                  <td className="max-w-[360px] truncate px-4 py-3 text-slate-500">{lead.memo || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href="/db"
                      className="inline-flex rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      DB 열기
                    </Link>
                  </td>
                </tr>
              ))
            )}
            {total === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                  현재 표시할 투두 DB가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-slate-100 md:hidden">
        {groups.flatMap(({ kind, rows }) =>
          rows.slice(0, 12).map((lead) => (
            <div key={`${kind}-${lead.id}`} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-blue-600">{kind} DB</span>
                  <div className="mt-1 font-semibold text-slate-900">{lead.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{lead.phone} · 담당 {lead.assignedStaff}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {kind === "재통화약속" && lead.reservationAt
                      ? `예약 ${lead.reservationAt.replace("T", " ")}`
                      : kind === "상담 중"
                        ? "상담 진행 중"
                        : "고려중 · 재컨택 필요"}
                    {lead.memo ? ` · ${lead.memo}` : ""}
                  </div>
                </div>
                <Link href="/db" className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                  DB 열기
                </Link>
              </div>
            </div>
          ))
        )}
        {total === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">현재 표시할 투두 DB가 없습니다.</div>}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { clients, cases, installments, scheduleItems, leads } = useStore();
  const today = kstDateStr();
  const initialRange = monthRange();
  const currentMonth = todayLocal().slice(0, 7);

  // 현재 제작 기준은 "최종관리자" 계정입니다. 따라서 상단 영업 KPI는 전 직원 데이터를 합산합니다.
  // 실제 로그인 기능을 붙일 때 개인계정인 경우에만 아래 topLeads/topCases를 로그인 담당자 기준으로 필터링하면 됩니다.
  const topLeads = leads;
  const topCases = cases;

  const [contractPeriod, setContractPeriod] = useState<ContractPeriod>("월");
  const month = monthBounds(today);
  const [customStart, setCustomStart] = useState(month.start);
  const [customEnd, setCustomEnd] = useState(today);
  const [rangeStart, setRangeStart] = useState(initialRange.start);
  const [rangeEnd, setRangeEnd] = useState(initialRange.end);
  const [paymentMonth, setPaymentMonth] = useState(currentMonth);
  const [hearingMonth, setHearingMonth] = useState(currentMonth);

  const topDashboard = useMemo(() => {
    const newGreetingDone = topLeads.filter((lead) => greetingCompletedToday(lead, today));
    const noAnswerNeed = topLeads.filter(
      (lead) =>
        leadStage(lead) === "부재" &&
        checkCallWarning(lead.consultation?.memoLog, today).active &&
        !lead.convertedClientId
    );
    const recall = topLeads
      .filter((lead) => leadStage(lead) === "예약" && !lead.convertedClientId)
      .sort((a, b) => (a.reservationAt ?? a.receivedAt).localeCompare(b.reservationAt ?? b.receivedAt));
    const consulting = topLeads
      .filter((lead) => leadStage(lead) === "상담" && !lead.convertedClientId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const completed = topLeads.filter((lead) => {
      const stage = leadStage(lead);
      return !!lead.convertedClientId || stage === "착수금 안내" || stage === "설득필요";
    });
    return { newGreetingDone, noAnswerNeed, recall, consulting, completed };
  }, [topLeads, today]);

  // 투두리스트는 개인계정의 상단 실적 필터와 별개입니다. 현재 전체 업무 대상 DB를 게시판 형식으로 보여줍니다.
  const todoGroups = useMemo(() => {
    const recall = leads
      .filter((lead) => leadStage(lead) === "예약" && !lead.convertedClientId)
      .sort((a, b) => (a.reservationAt ?? a.receivedAt).localeCompare(b.reservationAt ?? b.receivedAt));
    const consulting = leads
      .filter((lead) => leadStage(lead) === "상담" && !lead.convertedClientId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const consideration = leads
      .filter((lead) => (lead.status === "고려중" || leadStage(lead) === "설득필요") && !lead.convertedClientId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return [
      { kind: "재통화약속" as const, rows: recall },
      { kind: "상담 중" as const, rows: consulting },
      { kind: "고려중" as const, rows: consideration },
    ];
  }, [leads]);

  const contractBounds = useMemo(() => {
    if (contractPeriod === "일") return { start: today, end: today };
    if (contractPeriod === "주") return weekBounds(today);
    if (contractPeriod === "월") return monthBounds(today);
    return { start: customStart, end: customEnd };
  }, [contractPeriod, today, customStart, customEnd]);

  const contractSummary = useMemo(() => {
    const rows = topCases.filter(
      (record) => record.contractDate >= contractBounds.start && record.contractDate <= contractBounds.end
    );
    return {
      count: rows.length,
      amount: rows.reduce((sum, record) => sum + record.contractAmount, 0),
    };
  }, [topCases, contractBounds]);

  const kpi = useMemo(() => {
    const newClients = clients.filter((c) => inRange(c.registeredAt, rangeStart, rangeEnd));
    const contractSales = cases
      .filter((c) => inRange(c.contractDate, rangeStart, rangeEnd))
      .reduce((a, c) => a + c.contractAmount, 0);
    const realSales = installments
      .filter((i) => i.status === "완료" && i.paidDate && inRange(i.paidDate, rangeStart, rangeEnd))
      .reduce((a, i) => a + i.amount, 0);
    const receivable = cases.reduce((a, c) => a + Math.max(0, c.contractAmount - c.paidAmount), 0);
    return { newClients: newClients.length, contractSales, realSales, receivable };
  }, [clients, cases, installments, rangeStart, rangeEnd]);

  const paymentItems: CalendarItem[] = useMemo(
    () =>
      installments
        .filter((i) => i.dueDate.startsWith(paymentMonth))
        .map((i) => {
          const c = cases.find((x) => x.id === i.caseId);
          const client = c ? clients.find((x) => x.id === c.clientId) : undefined;
          return {
            id: i.id,
            date: i.dueDate,
            label: client?.name ?? "-",
            sub: `${i.seq === 1 ? "계약금" : `${i.seq - 1}회차`} · ${fmtWon(i.amount)}`,
            done: i.status === "완료",
            status: i.status,
            amount: i.amount,
          };
        }),
    [installments, cases, clients, paymentMonth]
  );

  const paymentSummary = useMemo(() => {
    const monthRows = installments.filter((i) => i.dueDate.startsWith(paymentMonth));
    const paid = monthRows.filter((i) => i.status === "완료").reduce((a, i) => a + i.amount, 0);
    const expected = monthRows.filter((i) => i.status !== "완료").reduce((a, i) => a + i.amount, 0);
    return { paid, expected, total: paid + expected };
  }, [installments, paymentMonth]);

  const hearingItems: CalendarItem[] = useMemo(
    () =>
      scheduleItems
        .filter((s) => s.date.startsWith(hearingMonth))
        .map((s) => {
          const c = s.caseId ? cases.find((x) => x.id === s.caseId) : undefined;
          const client = c ? clients.find((x) => x.id === c.clientId) : undefined;
          return {
            id: s.id,
            date: s.date,
            label: client?.name ?? "-",
            sub: `${s.type} · ${s.title}`,
            done: s.done,
            amount: 0,
          };
        }),
    [scheduleItems, cases, clients, hearingMonth]
  );

  const [mode, setMode] = useState<PeriodMode>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const stats = useMemo(() => computeStats(mode, anchor, dayMap), [mode, anchor]);
  const headline = useMemo(() => periodHeadline(mode, stats.bounds), [mode, stats.bounds]);

  const overdue = useMemo(() => getOverdueList(8), []);
  const stageDist = useMemo(() => getStageDistribution(), []);
  const overdueTotal = overdue.reduce((a, r) => a + r.amount, 0);

  function handleShift(delta: 1 | -1) {
    setAnchor((prev) => {
      if (delta > 0) {
        if (isNextBlocked(mode, prev)) return prev;
        return nextAnchor(mode, prev);
      }
      return prevAnchor(mode, prev);
    });
  }

  const topCards = [
    { icon: UserPlus, label: "당일신규 DB", value: topDashboard.newGreetingDone.length, sub: "문자인사 완료건", tone: "blue" },
    { icon: PhoneMissed, label: "부재컨택 필요 DB", value: topDashboard.noAnswerNeed.length, sub: "오늘 콜 관리 대상", tone: "red" },
    { icon: CalendarClock, label: "재통화약속 DB", value: topDashboard.recall.length, sub: "예약 일정 등록", tone: "amber" },
    { icon: PhoneCall, label: "상담중인 DB", value: topDashboard.consulting.length, sub: "현재 상담 단계", tone: "blue" },
    { icon: CheckCircle2, label: "상담완료 DB", value: topDashboard.completed.length, sub: "상담 후속 단계 포함", tone: "emerald" },
  ] as const;

  return (
    <>
      <PageHeader
        title="대시보드"
        description="최종관리자 기준으로 전체 영업 현황을 확인하고, 기존 분납·기일·기간별 통계도 함께 관리합니다."
        action={
          <DateRangePicker
            start={rangeStart}
            end={rangeEnd}
            onChange={(s, e) => {
              setRangeStart(s);
              setRangeEnd(e);
            }}
          />
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {topCards.map(({ icon: Icon, label, value, sub, tone }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{label}</span>
              <Icon
                size={16}
                className={
                  tone === "red"
                    ? "text-red-500"
                    : tone === "amber"
                      ? "text-amber-500"
                      : tone === "emerald"
                        ? "text-emerald-500"
                        : "text-blue-500"
                }
              />
            </div>
            <div className={`mt-3 text-2xl font-bold ${tone === "red" ? "text-red-600" : "text-slate-900"}`}>{value}건</div>
            <div className="mt-1 text-[11px] text-slate-400">{sub}</div>
          </Card>
        ))}

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">계약건</span>
            <FileSignature size={16} className="text-blue-500" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {(["일", "주", "월", "기간설정"] as ContractPeriod[]).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setContractPeriod(period)}
                className={`rounded-md px-1.5 py-1 text-[10px] font-semibold ${
                  contractPeriod === period ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {period}
              </button>
            ))}
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{contractSummary.count}건</div>
          <div className="mt-1 truncate text-[11px] text-slate-400">계약금액 {fmtWon(contractSummary.amount)}</div>
        </Card>
      </div>

      {contractPeriod === "기간설정" && (
        <Card className="mt-3 flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-semibold text-slate-500">계약기간</span>
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-400"
          />
          <span className="text-slate-300">~</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-400"
          />
        </Card>
      )}

      <TodoBoard groups={todoGroups} />

      {overdue.length > 0 && (
        <Card className="mt-4 flex flex-wrap items-center gap-3 border-red-100 bg-red-50/60 px-4 py-3">
          <span className="text-sm text-slate-900">
            연체·결제실패 <b>{overdue.length}건</b> (총 {fmtEokMan(overdueTotal)}) — 분납 확인이 필요해요.
          </span>
          <Link href="/cases" className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            계약관리로 이동
          </Link>
        </Card>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            [Users, "신규 의뢰인", `${kpi.newClients}명`, "normal"],
            [CircleDollarSign, "계약금액", fmtWon(kpi.contractSales), "normal"],
            [WalletCards, "결제완료액", fmtWon(kpi.realSales), "normal"],
            [CircleDollarSign, "미수금", fmtWon(kpi.receivable), "red"],
          ] as const
        ).map(([Icon, label, value, tone]) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{label}</span>
              <Icon size={16} className="text-slate-400" />
            </div>
            <div className={`mt-3 text-xl font-bold ${tone === "red" ? "text-red-600" : "text-slate-900"}`}>{value}</div>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <MonthCalendar
          title="분납 캘린더"
          month={paymentMonth}
          onMonthChange={setPaymentMonth}
          items={paymentItems}
          tone="blue"
          summary={paymentSummary}
        />
        <MonthCalendar
          title="기일·제출기한 캘린더"
          month={hearingMonth}
          onMonthChange={setHearingMonth}
          items={hearingItems}
          tone="amber"
        />
      </div>

      <Card className="mt-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-900">기간별 통계</div>
          <PeriodControl mode={mode} anchor={anchor} bounds={stats.bounds} onModeChange={setMode} onShift={handleShift} />
        </div>

        <p className="mb-4 text-base font-semibold text-slate-900 sm:text-lg">
          {headline.periodLabel}, 결제완료액 <span className="text-blue-600">{fmtEokMan(stats.current.paymentAmount)}</span>을{" "}
          {headline.isOngoing ? "기록하고 있어요" : "기록했어요"}
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label={`${headline.periodLabel} 신규 상담`} value={`${stats.current.newConsultCount}건`} />
          <KpiCard
            label={`${headline.periodLabel} 신규 계약`}
            value={`${stats.current.newContractCount}건`}
            deltaPct={stats.deltas.newContractCount}
          />
          <KpiCard label="계약금액" value={fmtEokMan(stats.current.contractAmount)} deltaPct={stats.deltas.contractAmount} />
          <KpiCard label="미수금" value={fmtEokMan(stats.receivableTotal)} deltaPct={stats.deltas.receivable} invert />
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="mb-4 text-sm font-semibold text-slate-900">사건유형별 결제 구성</div>
          <DonutChart
            centerLabel={fmtEokMan(stats.current.paymentAmount)}
            segments={[
              { label: "개인회생", value: stats.current.caseTypeSplit.개인회생, color: CASE_TYPE_COLORS.개인회생 },
              { label: "개인파산", value: stats.current.caseTypeSplit.개인파산, color: CASE_TYPE_COLORS.개인파산 },
            ]}
          />
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="mb-4 text-sm font-semibold text-slate-900">절차단계별 사건 현황</div>
          <StackedRatioBar
            segments={stageDist.map((s) => ({
              label: STAGE_GENERIC_LABELS[s.stage],
              count: s.count,
              color: STAGE_CHART_COLORS[s.stage],
            }))}
          />
        </Card>
      </div>
    </>
  );
}
