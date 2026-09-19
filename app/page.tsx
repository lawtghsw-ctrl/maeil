"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import {
  activeCaseCount,
  CASE_TYPE_COLORS,
  clientCount,
  getOverdueList,
  getStageDistribution,
  getStaffPerformance,
  getTodaySnapshot,
  getUpcomingSchedule,
  getWeekCompare,
  STAGE_CHART_COLORS,
} from "@/lib/dashboard";
import { STAGE_GENERIC_LABELS } from "@/lib/types";
import { deltaClass, fmtDate, fmtDeltaPct, fmtEokMan, fmtWon } from "@/lib/format";
import { PeriodControl } from "@/components/ui/PeriodControl";
import { KpiCard } from "@/components/ui/KpiCard";
import { DonutChart } from "@/components/charts/DonutChart";
import { TrendBarChart, type TrendBucket } from "@/components/charts/TrendBarChart";
import { StackedRatioBar } from "@/components/charts/StackedRatioBar";

export default function DashboardPage() {
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
      return weekBucketsOfMonth(bounds.start.getFullYear(), bounds.start.getMonth(), dayMap).map(
        (b) => ({ label: b.label, range: b.range, a: b.contractAmount, b: b.paymentAmount })
      );
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
  const todaySnap = useMemo(() => getTodaySnapshot(), []);
  const weekCompare = useMemo(() => getWeekCompare(), []);
  const staffPerf = useMemo(
    () => getStaffPerformance(isoStr(stats.bounds.start), isoStr(stats.bounds.end)),
    [stats]
  );

  const overdueTotal = overdue.reduce((a, r) => a + r.amount, 0);
  const weekDeltaPct =
    weekCompare.lastWeek > 0
      ? ((weekCompare.thisWeek - weekCompare.lastWeek) / weekCompare.lastWeek) * 100
      : 0;
  const maxSpark = Math.max(1, ...weekCompare.sparkline);

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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">대시보드</h1>
          <p className="mt-0.5 text-sm text-muted">
            의뢰인 {clientCount}명 · 진행중 사건 {activeCaseCount}건
          </p>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 bg-danger-tint/60 px-4 py-3">
          <span className="rounded-sm2 bg-danger px-2 py-0.5 text-xs font-semibold text-white">
            실시간
          </span>
          <span className="text-sm text-ink">
            연체·결제실패 <b>{overdue.length}건</b> (총 {fmtEokMan(overdueTotal)}) — 추심 우선순위
            확인이 필요해요.
          </span>
          <Link
            href="/billing"
            className="ml-auto rounded-md2 bg-navy px-3 py-1.5 text-xs font-medium text-white"
          >
            청구·결제 관리로 이동
          </Link>
        </div>
      )}

      <div className="card bg-navy-2 px-5 py-4 text-white">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-sm2 bg-gold px-2 py-0.5 text-[11px] font-semibold">
            AI 브리핑 (프로토타입)
          </span>
          <span className="text-[11px] text-white/40">
            실서비스 전환 시 LLM 파이프라인으로 자동 생성될 영역
          </span>
        </div>
        <ul className="space-y-1 text-sm text-white/85">
          <li>
            · 연체·결제실패 {overdue.length}건, 총 {fmtEokMan(overdueTotal)} 미수 — 우선 추심이
            필요해요.
          </li>
          <li>
            · 이번주 결제액이 저번주 대비 {weekDeltaPct >= 0 ? "▲" : "▼"}{" "}
            {Math.abs(weekDeltaPct).toFixed(1)}% {weekDeltaPct >= 0 ? "증가" : "감소"}했어요.
          </li>
          <li>
            · 임박한 기일·제출기한 {upcoming.length}건
            {upcoming[0]
              ? ` — 가장 빠른 건: ${fmtDate(upcoming[0].date)} ${upcoming[0].clientName}님(${upcoming[0].title})`
              : ""}
          </li>
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <div className="mb-2 text-xs font-medium text-gold">청구·결제 스냅샷 · 오늘</div>
          <div className="text-lg font-semibold text-ink">
            {fmtWon(todaySnap.today.paymentAmount)}
          </div>
          <div className="mt-1 text-xs text-muted">
            어제 {fmtWon(todaySnap.yesterday.paymentAmount)} · 신규계약{" "}
            {todaySnap.today.newContractCount}건
          </div>
        </div>
        <div className="card p-4 sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-gold">이번주 vs 저번주 결제액</div>
            <div className={`text-xs font-medium ${deltaClass(weekDeltaPct)}`}>
              {fmtDeltaPct(weekDeltaPct)}
            </div>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-lg font-semibold text-ink">
                {fmtEokMan(weekCompare.thisWeek)}
              </div>
              <div className="text-xs text-muted">저번주 {fmtEokMan(weekCompare.lastWeek)}</div>
            </div>
            <div className="flex h-10 items-end gap-1">
              {weekCompare.sparkline.map((v, i) => (
                <div
                  key={i}
                  className="w-2.5 rounded-t-sm2 bg-gold/70"
                  style={{ height: `${Math.max(6, (v / maxSpark) * 100)}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-ink">기간별 통계</div>
          <PeriodControl
            mode={mode}
            anchor={anchor}
            bounds={stats.bounds}
            onModeChange={setMode}
            onShift={handleShift}
          />
        </div>

        <p className="mb-4 text-base font-semibold text-ink sm:text-lg">
          {headline.periodLabel}, 결제완료액{" "}
          <span className="text-brand">{fmtEokMan(stats.current.paymentAmount)}</span>을{" "}
          {headline.isOngoing ? "기록하고 있어요" : "기록했어요"}
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label={`${headline.periodLabel} 신규 상담`}
            value={`${stats.current.newConsultCount}건`}
          />
          <KpiCard
            label={`${headline.periodLabel} 신규 계약`}
            value={`${stats.current.newContractCount}건`}
            deltaPct={stats.deltas.newContractCount}
          />
          <KpiCard
            label="계약금액"
            value={fmtEokMan(stats.current.contractAmount)}
            deltaPct={stats.deltas.contractAmount}
          />
          <KpiCard
            label="미수금"
            value={fmtEokMan(stats.receivableTotal)}
            deltaPct={stats.deltas.receivable}
            invert
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4 sm:p-5">
          <div className="mb-4 text-sm font-semibold text-ink">사건유형별 결제 구성</div>
          <DonutChart
            centerLabel={fmtEokMan(stats.current.paymentAmount)}
            segments={[
              {
                label: "개인회생",
                value: stats.current.caseTypeSplit.개인회생,
                color: CASE_TYPE_COLORS.개인회생,
              },
              {
                label: "개인파산",
                value: stats.current.caseTypeSplit.개인파산,
                color: CASE_TYPE_COLORS.개인파산,
              },
            ]}
          />
        </div>
        <div className="card p-4 sm:p-5">
          <div className="mb-4 text-sm font-semibold text-ink">절차단계별 사건 현황</div>
          <StackedRatioBar
            segments={stageDist.map((s) => ({
              label: STAGE_GENERIC_LABELS[s.stage],
              count: s.count,
              color: STAGE_CHART_COLORS[s.stage],
            }))}
          />
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <div className="mb-1 text-sm font-semibold text-ink">계약·결제 추이</div>
        <div className="mb-4 text-xs text-muted">
          {mode === "day"
            ? "일 단위 조회에서는 상단 스냅샷을 참고해주세요."
            : "선택된 기간 설정을 그대로 상속합니다."}
        </div>
        {buckets.length > 0 ? (
          <TrendBarChart
            buckets={buckets}
            labelA="계약금액"
            labelB="결제액"
            colorA="#B06A1A"
            colorB="#2944AF"
            valueFmt={fmtEokMan}
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted">
            일 단위에서는 추이 차트를 표시하지 않습니다.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4 sm:p-5">
          <div className="mb-3 text-sm font-semibold text-ink">미수금 추심 우선순위</div>
          {overdue.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted">연체 건이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {overdue.map((row) => (
                <div
                  key={row.installmentId}
                  className="flex items-center gap-3 rounded-md2 border border-line px-3 py-2.5"
                >
                  <span
                    className={`shrink-0 rounded-sm2 px-1.5 py-0.5 text-[11px] font-semibold ${
                      row.overdueDays >= 30
                        ? "bg-danger-tint text-danger"
                        : row.overdueDays >= 15
                        ? "bg-gold-tint text-gold"
                        : "bg-line text-muted"
                    }`}
                  >
                    D+{row.overdueDays}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {row.clientName}님 · {row.caseType}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {row.caseNumber} · {row.reason}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm font-semibold text-ink">
                    {fmtWon(row.amount)}
                  </div>
                  <Link
                    href={`/cases/${row.caseId}`}
                    className="shrink-0 rounded-md2 border border-line px-2.5 py-1 text-xs text-muted hover:text-ink"
                  >
                    확인
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4 sm:p-5">
          <div className="mb-3 text-sm font-semibold text-ink">다가오는 기일·제출기한</div>
          {upcoming.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted">예정된 일정이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-md2 border border-line px-3 py-2.5"
                >
                  <span
                    className={`shrink-0 rounded-sm2 px-1.5 py-0.5 text-[11px] font-semibold ${
                      row.dday <= 3 ? "bg-danger-tint text-danger" : "bg-brand-pale text-brand"
                    }`}
                  >
                    {row.dday === 0 ? "D-day" : row.dday > 0 ? `D-${row.dday}` : `D+${-row.dday}`}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {row.clientName}님 · {row.title}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {fmtDate(row.date)} · {row.type}
                    </div>
                  </div>
                  <Link
                    href={`/cases/${row.caseId}`}
                    className="shrink-0 rounded-md2 border border-line px-2.5 py-1 text-xs text-muted hover:text-ink"
                  >
                    확인
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <div className="mb-3 text-sm font-semibold text-ink">담당자별 실적</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-medium">담당자</th>
                <th className="py-2 font-medium">신규계약</th>
                <th className="py-2 font-medium">계약금액</th>
                <th className="py-2 font-medium">결제율</th>
              </tr>
            </thead>
            <tbody>
              {staffPerf.map((row) => (
                <tr key={row.staff} className="border-b border-line last:border-0">
                  <td className="py-2.5 font-medium text-ink">{row.staff}</td>
                  <td className="py-2.5 text-muted">{row.caseCount}건</td>
                  <td className="py-2.5 text-muted">{fmtEokMan(row.contractAmount)}</td>
                  <td className="py-2.5 text-muted">{row.paymentRate.toFixed(0)}%</td>
                </tr>
              ))}
              {staffPerf.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted">
                    선택된 기간에 데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
