// 대시보드 전용 집계 헬퍼 — mock-data의 원본 레코드를 화면에서 바로 쓸 수 있는 형태로 가공.
// 실서비스 전환 시 이 파일의 함수들을 서버 API(또는 Supabase RPC) 호출로 교체하면 됨.

import { addDays, isoStr, startOfDay } from "./period-engine";
import {
  cases,
  clients,
  dayMap,
  getCaseById,
  getClientById,
  installments,
  overdueDaysOf,
} from "./mock-data";
import type { CaseStage, CaseType } from "./types";
import { CASE_STAGES } from "./types";

export interface OverdueRow {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  caseType: CaseType;
  amount: number;
  overdueDays: number;
  reason: string;
}

export function getOverdueList(limit = 8): OverdueRow[] {
  const rows: OverdueRow[] = [];
  for (const ins of installments) {
    if (ins.status !== "연체" && ins.status !== "실패") continue;
    const c = getCaseById(ins.caseId);
    if (!c) continue;
    const client = getClientById(c.clientId);
    rows.push({
      installmentId: ins.id,
      caseId: c.id,
      caseNumber: c.caseNumber,
      clientName: client?.name ?? "-",
      caseType: c.caseType,
      amount: ins.amount,
      overdueDays: overdueDaysOf(ins),
      reason: ins.status === "실패" ? "결제 실패" : "미입금",
    });
  }
  rows.sort((a, b) => b.overdueDays - a.overdueDays);
  return rows.slice(0, limit);
}

export interface UpcomingScheduleRow {
  id: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  type: string;
  date: string;
  title: string;
  dday: number;
}

export function getUpcomingSchedule(limit = 6): UpcomingScheduleRow[] {
  const today = startOfDay(new Date());
  const rows = cases
    .filter((c) => c.nextHearingDate && c.status === "진행중")
    .map((c) => {
      const d = new Date((c.nextHearingDate as string) + "T00:00:00");
      const dday = Math.round((d.getTime() - today.getTime()) / 86400000);
      const client = getClientById(c.clientId);
      return {
        id: c.id,
        caseId: c.id,
        caseNumber: c.caseNumber,
        clientName: client?.name ?? "-",
        type: c.stage === "보정대기" ? "서류제출기한" : "법원기일",
        date: c.nextHearingDate as string,
        title:
          c.stage === "법원접수"
            ? "심문기일"
            : c.stage === "보정대기"
            ? "보정서 제출기한"
            : c.stage === "개시_선고"
            ? "채권자집회"
            : "정기 서류 제출",
        dday,
      };
    })
    .filter((r) => r.dday >= -1)
    .sort((a, b) => a.dday - b.dday);
  return rows.slice(0, limit);
}

export interface StageCount {
  stage: CaseStage;
  count: number;
}

export function getStageDistribution(): StageCount[] {
  const map = new Map<CaseStage, number>();
  for (const s of CASE_STAGES) map.set(s, 0);
  for (const c of cases) {
    if (c.status === "취하") continue;
    map.set(c.stage, (map.get(c.stage) ?? 0) + 1);
  }
  return CASE_STAGES.map((s) => ({ stage: s, count: map.get(s) ?? 0 }));
}

export interface StaffPerformanceRow {
  staff: string;
  caseCount: number;
  contractAmount: number;
  paymentRate: number; // 결제율(%) = 기납부액 합 / 계약금액 합
}

export function getStaffPerformance(startIso: string, endIso: string): StaffPerformanceRow[] {
  const inRange = cases.filter((c) => c.contractDate >= startIso && c.contractDate <= endIso);
  const map = new Map<string, { count: number; contract: number; paid: number }>();
  for (const c of inRange) {
    const row = map.get(c.assignedStaff) ?? { count: 0, contract: 0, paid: 0 };
    row.count += 1;
    row.contract += c.contractAmount;
    row.paid += c.paidAmount;
    map.set(c.assignedStaff, row);
  }
  return Array.from(map.entries())
    .map(([staff, v]) => ({
      staff,
      caseCount: v.count,
      contractAmount: v.contract,
      paymentRate: v.contract > 0 ? (v.paid / v.contract) * 100 : 0,
    }))
    .sort((a, b) => b.contractAmount - a.contractAmount);
}

// 청구·결제 스냅샷 — 기간 설정과 무관하게 항상 '오늘' 기준
export function getTodaySnapshot() {
  const today = startOfDay(new Date());
  const yIso = isoStr(addDays(today, -1));
  const tIso = isoStr(today);
  const todayDay = dayMap.get(tIso);
  const yestDay = dayMap.get(yIso);
  return {
    today: {
      contractAmount: todayDay?.contractAmount ?? 0,
      paymentAmount: todayDay?.paymentAmount ?? 0,
      newContractCount: todayDay?.newContractCount ?? 0,
    },
    yesterday: {
      contractAmount: yestDay?.contractAmount ?? 0,
      paymentAmount: yestDay?.paymentAmount ?? 0,
      newContractCount: yestDay?.newContractCount ?? 0,
    },
  };
}

export function getWeekCompare() {
  const today = startOfDay(new Date());
  let thisWeek = 0;
  let lastWeek = 0;
  const sparkline: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const v = dayMap.get(isoStr(d))?.paymentAmount ?? 0;
    thisWeek += v;
    sparkline.push(v);
  }
  for (let i = 13; i >= 7; i--) {
    const d = addDays(today, -i);
    lastWeek += dayMap.get(isoStr(d))?.paymentAmount ?? 0;
  }
  return { thisWeek, lastWeek, sparkline };
}

export const STAGE_CHART_COLORS: Record<CaseStage, string> = {
  상담접수: "#9CA1B0",
  서류준비: "#6B7280",
  신청서작성: "#5A72D6",
  법원접수: "#2944AF",
  보정대기: "#B06A1A",
  개시_선고: "#1C3080",
  변제계획_면책심문: "#B06A1A",
  면책결정: "#2C7A3F",
  종결: "#1B1E2B",
};

export const CASE_TYPE_COLORS: Record<CaseType, string> = {
  개인회생: "#2944AF",
  개인파산: "#B06A1A",
};

export const clientCount = clients.length;
export const activeCaseCount = cases.filter((c) => c.status === "진행중").length;
