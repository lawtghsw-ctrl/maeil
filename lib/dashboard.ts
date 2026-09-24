// 실데이터 기반 대시보드 집계 헬퍼.
// v25부터 mock-data를 참조하지 않고 store에서 받은 배열만 처리하는 순수 함수로 동작합니다.

import { addDays, isoStr, startOfDay } from "./period-engine";
import type { CaseRecord, CaseStage, CaseType, Client, DbLead, Installment } from "./types";
import { CASE_STAGES } from "./types";
import { checkCallWarning } from "./consultation";

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

function overdueDaysOf(ins: Installment, refDate: Date = new Date()): number {
  if (ins.status !== "연체" && ins.status !== "실패") return 0;
  const due = new Date(`${ins.dueDate}T00:00:00`);
  const t0 = startOfDay(refDate);
  return Math.max(0, Math.round((t0.getTime() - due.getTime()) / 86400000));
}

export function getOverdueList(
  installments: Installment[],
  cases: CaseRecord[],
  clients: Client[],
  limit = 8
): OverdueRow[] {
  const rows: OverdueRow[] = [];
  for (const ins of installments) {
    if (ins.status !== "연체" && ins.status !== "실패") continue;
    const c = cases.find((item) => item.id === ins.caseId);
    if (!c) continue;
    const client = clients.find((item) => item.id === c.clientId);
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
  return rows.sort((a, b) => b.overdueDays - a.overdueDays).slice(0, limit);
}

export interface StageCount {
  stage: CaseStage;
  count: number;
}

export function getStageDistribution(cases: CaseRecord[]): StageCount[] {
  const map = new Map<CaseStage, number>();
  for (const s of CASE_STAGES) map.set(s, 0);
  for (const c of cases) {
    if (c.status === "취하") continue;
    map.set(c.stage, (map.get(c.stage) ?? 0) + 1);
  }
  return CASE_STAGES.map((stage) => ({ stage, count: map.get(stage) ?? 0 }));
}

export interface StaffPerformanceRow {
  staff: string;
  caseCount: number;
  contractAmount: number;
  paymentRate: number;
}

export function getStaffPerformance(cases: CaseRecord[], startIso: string, endIso: string): StaffPerformanceRow[] {
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
    .map(([staff, value]) => ({
      staff,
      caseCount: value.count,
      contractAmount: value.contract,
      paymentRate: value.contract > 0 ? (value.paid / value.contract) * 100 : 0,
    }))
    .sort((a, b) => b.contractAmount - a.contractAmount);
}

export const STAGE_CHART_COLORS: Record<CaseStage, string> = {
  상담접수: "#cbd5e1",
  서류준비: "#94a3b8",
  신청서작성: "#60a5fa",
  법원접수: "#2563eb",
  보정대기: "#f59e0b",
  개시_선고: "#1d4ed8",
  변제계획_면책심문: "#d97706",
  면책결정: "#059669",
  종결: "#334155",
};

export const CASE_TYPE_COLORS: Record<CaseType, string> = {
  개인회생: "#2563eb",
  개인파산: "#d97706",
};

export interface LeadKpis {
  newToday: number;
  noAnswerYesterday: number;
  callWarningRate: number;
  monthNewLeads: number;
  monthConverted: number;
  conversionRate: number;
}

export function getLeadKpis(leads: DbLead[]): LeadKpis {
  const today = startOfDay(new Date());
  const todayIso = isoStr(today);
  const yesterdayIso = isoStr(addDays(today, -1));
  const monthPrefix = todayIso.slice(0, 7);
  const newToday = leads.filter((l) => l.receivedAt.slice(0, 10) === todayIso).length;
  const noAnswerYesterday = leads.filter((l) => l.receivedAt.slice(0, 10) === yesterdayIso && l.status === "부재중").length;
  const activeLeads = leads.filter(
    (l) => !l.convertedClientId && l.status !== "거절" && l.status !== "부적합" && l.status !== "종결_중단"
  );
  const warnedCount = activeLeads.filter((l) => checkCallWarning(l.consultation?.memoLog).active).length;
  const callWarningRate = activeLeads.length > 0 ? (warnedCount / activeLeads.length) * 100 : 0;
  const monthLeads = leads.filter((l) => l.receivedAt.slice(0, 7) === monthPrefix);
  const monthNewLeads = monthLeads.length;
  const monthConverted = monthLeads.filter((l) => !!l.convertedClientId).length;
  const conversionRate = monthNewLeads > 0 ? (monthConverted / monthNewLeads) * 100 : 0;
  return { newToday, noAnswerYesterday, callWarningRate, monthNewLeads, monthConverted, conversionRate };
}

export interface ConsiderationTodoRow {
  id: string;
  name: string;
  phone: string;
  assignedStaff: string;
  receivedAt: string;
  noAnswerCountToday: number;
  warningActive: boolean;
}

export function getConsiderationTodoList(leads: DbLead[], limit = 8): ConsiderationTodoRow[] {
  return leads
    .filter((l) => l.status === "고려중" && !l.convertedClientId)
    .map((l) => {
      const w = checkCallWarning(l.consultation?.memoLog);
      return {
        id: l.id,
        name: l.name,
        phone: l.phone,
        assignedStaff: l.assignedStaff,
        receivedAt: l.receivedAt,
        noAnswerCountToday: w.noAnswerCountToday,
        warningActive: w.active,
      };
    })
    .sort((a, b) => {
      if (a.warningActive !== b.warningActive) return a.warningActive ? -1 : 1;
      return b.noAnswerCountToday - a.noAnswerCountToday;
    })
    .slice(0, limit);
}
