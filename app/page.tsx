"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleDollarSign, Users, WalletCards } from "lucide-react";
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
import { CASE_TYPE_COLORS, getOverdueList, getStageDistribution, STAGE_CHART_COLORS } from "@/lib/dashboard";
import { STAGE_GENERIC_LABELS } from "@/lib/types";
import { fmtEokMan, fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { PeriodControl } from "@/components/ui/PeriodControl";
import { KpiCard } from "@/components/ui/KpiCard";
import { DonutChart } from "@/components/charts/DonutChart";
import { StackedRatioBar } from "@/components/charts/StackedRatioBar";
import { MonthCalendar, type CalendarItem } from "@/components/charts/MonthCalendar";

function today(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function monthRange() {
  const t = today();
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

export default function DashboardPage() {
  const { clients, cases, installments, scheduleItems } = useStore();
  const initialRange = monthRange();
  const currentMonth = today().slice(0, 7);
  const [rangeStart, setRangeStart] = useState(initialRange.start);
  const [rangeEnd, setRangeEnd] = useState(initialRange.end);
  const [paymentMonth, setPaymentMonth] = useState(currentMonth);
  const [hearingMonth, setHearingMonth] = useState(currentMonth);

  // ---- 상단 KPI (도원 Admin 대시보드와 동일하게 DateRangePicker로 선택한 기간 기준) ----
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

  // ---- 분납 캘린더 / 기일·제출기한 캘린더 (도원 Admin의 분납·상환 캘린더 UI 이식) ----
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

  // ---- 기간별 통계(년/월/주/일) — 기존 로피 기간엔진 이식분을 그대로 유지, 톤만 재적용 ----
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

  return (
    <>
      <PageHeader
        title="대시보드"
        description="선택한 기간의 신규 의뢰인·계약·결제 현황과 월별 분납·기일 일정을 확인합니다."
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

      {overdue.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 border-red-100 bg-red-50/60 px-4 py-3">
          <span className="text-sm text-slate-900">
            연체·결제실패 <b>{overdue.length}건</b> (총 {fmtEokMan(overdueTotal)}) — 추심 우선순위 확인이 필요해요.
          </span>
          <Link href="/billing" className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            입금·분납 관리로 이동
          </Link>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            <div className={`mt-3 text-xl font-bold ${tone === "red" ? "text-red-600" : "text-slate-900"}`}>
              {value}
            </div>
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
