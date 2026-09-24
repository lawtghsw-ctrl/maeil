"use client";

// 도원 Admin(tg_m)의 '데이터집계'(components/analytics.tsx) 구조를 이식.
// 사채업 특유의 연체율·재약정성공률 등은 로파워 도메인에 맞지 않아, 담당자별 실적과
// 최근 6개월 계약/결제 추이, 사건유형·절차단계 분포로 재구성했습니다.
// (대시보드 1차 정리에서 걷어낸 '계약·결제 추이', '담당자별 실적'을 이 페이지로 재배치)
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { addMonths, buildDayMap, sumRange } from "@/lib/period-engine";
import { getStaffPerformance, getStageDistribution, CASE_TYPE_COLORS, STAGE_CHART_COLORS } from "@/lib/dashboard";
import { STAGE_GENERIC_LABELS } from "@/lib/types";
import { fmtEokMan, fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { KpiCard } from "@/components/ui/KpiCard";
import { StackedRatioBar } from "@/components/charts/StackedRatioBar";
import { TrendBarChart, type TrendBucket } from "@/components/charts/TrendBarChart";

function monthRange() {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  return {
    start: `${y}-${String(m + 1).padStart(2, "0")}-01`,
    end: `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`,
  };
}

export default function AnalyticsPage() {
  const { clients, cases, installments, leads, can, currentStaff } = useStore();
  const [range] = useState(monthRange());

  const dayMap = useMemo(() => buildDayMap(cases, installments, leads), [cases, installments, leads]);
  const stageDist = useMemo(() => getStageDistribution(cases), [cases]);
  const staffRows = useMemo(() => getStaffPerformance(cases, "2000-01-01", "2999-12-31"), [cases]);

  const caseTypeSplit = useMemo(() => {
    const 개인회생 = cases.filter((c) => c.caseType === "개인회생").length;
    const 개인파산 = cases.filter((c) => c.caseType === "개인파산").length;
    return { 개인회생, 개인파산 };
  }, [cases]);

  const monthlyTrend: TrendBucket[] = useMemo(() => {
    const now = new Date();
    const buckets: TrendBucket[] = [];
    for (let i = 5; i >= 0; i--) {
      const anchor = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -i);
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      const sum = sumRange(start, end > now ? now : end, dayMap);
      buckets.push({
        label: `${anchor.getMonth() + 1}월`,
        a: sum.contractAmount,
        b: sum.paymentAmount,
      });
    }
    return buckets;
  }, [dayMap]);

  const thisMonthContract = cases.filter((c) => c.contractDate >= range.start && c.contractDate <= range.end).length;
  const thisMonthPayment = installments
    .filter((i) => i.status === "완료" && i.paidDate && i.paidDate >= range.start && i.paidDate <= range.end)
    .reduce((a, i) => a + i.amount, 0);
  const activeCaseCount = cases.filter((c) => c.status === "진행중").length;
  const receivableTotal = cases.reduce((a, c) => a + Math.max(0, c.contractAmount - c.paidAmount), 0);

  return (
    <>
      <PageHeader title="데이터집계" description={can("analytics.view_all") ? "전사 담당자 실적과 사건/계약 통계를 확인합니다." : `${currentStaff ?? "내"} 담당 업무 기준 통계를 확인합니다.`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="현재 조회 고객수" value={`${clients.length}명`} />
        <KpiCard label="진행중 사건" value={`${activeCaseCount}건`} />
        <KpiCard label="이번달 신규계약" value={`${thisMonthContract}건`} />
        {can("analytics.finance") && <KpiCard label="이번달 결제완료액" value={fmtWon(thisMonthPayment)} />}
      </div>

      {can("analytics.finance") && <Card className="mt-4 p-4 sm:p-5">
        <div className="mb-4 text-sm font-semibold text-slate-900">최근 6개월 계약·결제 추이</div>
        <TrendBarChart buckets={monthlyTrend} labelA="계약금액" labelB="결제완료액" colorA="#d97706" colorB="#2563eb" valueFmt={fmtEokMan} />
      </Card>}

      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">담당자별 실적 (전체 기간)</div>
        <div className="overflow-x-auto">
          <table className="admin-responsive-table w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {(["담당자", "계약건수", ...(can("analytics.finance") ? ["계약금액", "결제율"] : [])]).map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffRows.map((r) => (
                <tr key={r.staff} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-900">{r.staff}</td>
                  <td className="px-4 py-3 text-slate-500">{r.caseCount}건</td>
                  {can("analytics.finance") && <td className="px-4 py-3 text-slate-900">{fmtWon(r.contractAmount)}</td>}
                  {can("analytics.finance") && <td className="px-4 py-3 text-slate-500">{r.paymentRate.toFixed(1)}%</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="mb-4 text-sm font-semibold text-slate-900">사건유형별 사건 수 분포 (전체 {cases.length}건)</div>
          <StackedRatioBar
            segments={[
              { label: "개인회생", count: caseTypeSplit.개인회생, color: CASE_TYPE_COLORS.개인회생 },
              { label: "개인파산", count: caseTypeSplit.개인파산, color: CASE_TYPE_COLORS.개인파산 },
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

      {can("analytics.finance") && <Card className="mt-4 bg-slate-50 px-4 py-3 text-xs text-slate-500">현재 조회범위 미수금 {fmtWon(receivableTotal)} — 상세 내역은 계약관리 상세의 분납관리에서 확인하세요.</Card>}
    </>
  );
}
