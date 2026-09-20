"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleDollarSign, Users, WalletCards } from "lucide-react";
import {
  computeStats,
  dayBucketsOfRange,
  isNextBlocked,
  isoStr,
  monthBucketsOfYear,
  nextAnchor,
  periodHeadline,
  prevAnchor,
  weekBucketsOfMonth,
  type PeriodMode,
} from "@/lib/period-engine";
import { dayMap } from "@/lib/mock-data";
import { useStore } from "@/lib/store";
import {
  CASE_TYPE_COLORS,
  getOverdueList,
  getStageDistribution,
  getStaffPerformance,
  getUpcomingSchedule,
  STAGE_CHART_COLORS,
} from "@/lib/dashboard";
import { STAGE_GENERIC_LABELS } from "@/lib/types";
import { fmtDate, fmtEokMan, fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { PeriodControl } from "@/components/ui/PeriodControl";
import { KpiCard } from "@/components/ui/KpiCard";
import { DonutChart } from "@/components/charts/DonutChart";
import { TrendBarChart, type TrendBucket } from "@/components/charts/TrendBarChart";
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

  const buckets: TrendBucket[] = useMemo(() => {
    const { bounds } = stats;
    if (mode === "year") {
      return monthBucketsOfYear(bounds.start.getFullYear(), dayMap).map((b) => ({
        label: b.label,
        range: b.range,
        a: b.contractAmount,
        b: b.paymentAmount,
      }));
    }
    if (mode === "month") {
      return weekBucketsOfMonth(bounds.start.getFullYear(), bounds.start.getMonth(), dayMap).map((b) => ({
        label: b.label,
        range: b.range,
        a: b.contractAmount,
        b: b.paymentAmount,
      }));
    }
    if (mode === "week") {
      return dayBucketsOfRange(bounds.start, bounds.naturalEnd, dayMap).map((b) => ({
        label: b.label,
        range: b.range,
        a: b.contractAmount,
        b: b.paymentAmount,
      }));
    }
    return [];
  }, [mode, stats]);

  const overdue = useMemo(() => getOverdueList(8), []);
  const upcoming = useMemo(() => getUpcomingSchedule(6), []);
  const stageDist = useMemo(() => getStageDistribution(), []);
  const staffPerf = useMemo(
    () => getStaffPerformance(isoStr(stats.bounds.start), isoStr(stats.bounds.end)),
    [stats]
  );
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
          <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">실시간</span>
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

      <Card className="mt-4 p-4 sm:p-5">
        <div className="mb-1 text-sm font-semibold text-slate-900">계약·결제 추이</div>
        <div className="mb-4 text-xs text-slate-500">
          {mode === "day" ? "일 단위 조회에서는 상단 스냅샷을 참고해주세요." : "선택된 기간 설정을 그대로 상속합니다."}
        </div>
        {buckets.length > 0 ? (
          <TrendBarChart buckets={buckets} labelA="계약금액" labelB="결제액" valueFmt={fmtEokMan} />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">
            일 단위에서는 추이 차트를 표시하지 않습니다.
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 text-sm font-semibold text-slate-900">미수금 추심 우선순위</div>
          {overdue.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">연체 건이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {overdue.map((row) => (
                <div key={row.installmentId} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                      row.overdueDays >= 30 ? "bg-red-50 text-red-700" : row.overdueDays >= 15 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    D+{row.overdueDays}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {row.clientName}님 · {row.caseType}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {row.caseNumber} · {row.reason}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm font-semibold text-slate-900">{fmtWon(row.amount)}</div>
                  <Link href={`/cases/${row.caseId}`} className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:text-slate-900">
                    확인
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="mb-3 text-sm font-semibold text-slate-900">다가오는 기일·제출기한</div>
          {upcoming.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">예정된 일정이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((row) => (
                <div key={row.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${row.dday <= 3 ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                    {row.dday === 0 ? "D-day" : row.dday > 0 ? `D-${row.dday}` : `D+${-row.dday}`}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {row.clientName}님 · {row.title}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {fmtDate(row.date)} · {row.type}
                    </div>
                  </div>
                  <Link href={`/cases/${row.caseId}`} className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:text-slate-900">
                    확인
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-4 sm:p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">담당자별 실적</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">담당자</th>
                <th className="px-3 py-2.5 font-medium">신규계약</th>
                <th className="px-3 py-2.5 font-medium">계약금액</th>
                <th className="px-3 py-2.5 font-medium">결제율</th>
              </tr>
            </thead>
            <tbody>
              {staffPerf.map((row) => (
                <tr key={row.staff} className="border-t border-slate-100">
                  <td className="px-3 py-2.5 font-medium text-slate-900">{row.staff}</td>
                  <td className="px-3 py-2.5 text-slate-500">{row.caseCount}건</td>
                  <td className="px-3 py-2.5 text-slate-500">{fmtEokMan(row.contractAmount)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{row.paymentRate.toFixed(0)}%</td>
                </tr>
              ))}
              {staffPerf.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    선택된 기간에 데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
