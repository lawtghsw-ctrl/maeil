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
import type { CaseStage, CaseType, DbLead } from "./types";
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

// 색상은 도원 Admin과 동일한 Tailwind 기본 팔레트(slate/blue/emerald/amber)로 통일
export const STAGE_CHART_COLORS: Record<CaseStage, string> = {
  상담접수: "#cbd5e1", // slate-300
  서류준비: "#94a3b8", // slate-400
  신청서작성: "#60a5fa", // blue-400
  법원접수: "#2563eb", // blue-600
  보정대기: "#f59e0b", // amber-500
  개시_선고: "#1d4ed8", // blue-700
  변제계획_면책심문: "#d97706", // amber-600
  면책결정: "#059669", // emerald-600
  종결: "#334155", // slate-700
};

export const CASE_TYPE_COLORS: Record<CaseType, string> = {
  개인회생: "#2563eb", // blue-600
  개인파산: "#d97706", // amber-600
};

export const clientCount = clients.length;
export const activeCaseCount = cases.filter((c) => c.status === "진행중").length;

// ---- TM 영업 관점 대시보드 지표 ----
// store의 실시간 leads 배열을 인자로 받는 순수 함수로 만들어, DB관리에서 상태/콜횟수를
// 바꾸는 즉시 대시보드에도 반영되도록 했습니다(위 함수들과 달리 mock-data를 직접 import
// 하지 않는 이유).
export interface LeadKpis {
  newToday: number; // 당일 신규 DB(의뢰인) 수
  noAnswerYesterday: number; // 전일 접수 건 중 현재 '부재중' 상태인 건수(근사치)
  noAnswerRateUnder5Calls: number; // 콜 5회 이하 리드 중 '부재중' 비율(%)
  monthNewLeads: number; // 이번달 신규 DB 수
  monthConverted: number; // 이번달 신규 DB 중 수임전환된 수
  conversionRate: number; // 이번달 신규 DB 대비 선임률(%)
}

export function getLeadKpis(leads: DbLead[]): LeadKpis {
  const today = startOfDay(new Date());
  const todayIso = isoStr(today);
  const yesterdayIso = isoStr(addDays(today, -1));
  const monthPrefix = todayIso.slice(0, 7);

  const newToday = leads.filter((l) => l.receivedAt.slice(0, 10) === todayIso).length;

  // 어제 접수된 리드 중 아직 '부재중' 상태로 남아있는 건수 — 실제 통화 시도 이력(콜 로그)이
  // 별도로 없어 접수일 기준으로 근사한 값입니다. 콜 로그 기능이 추가되면 더 정확해집니다.
  const noAnswerYesterday = leads.filter((l) => l.receivedAt.slice(0, 10) === yesterdayIso && l.status === "부재중").length;

  const under5 = leads.filter((l) => (l.callCount ?? 0) <= 5);
  const under5NoAnswer = under5.filter((l) => l.status === "부재중").length;
  const noAnswerRateUnder5Calls = under5.length > 0 ? (under5NoAnswer / under5.length) * 100 : 0;

  const monthLeads = leads.filter((l) => l.receivedAt.slice(0, 7) === monthPrefix);
  const monthNewLeads = monthLeads.length;
  const monthConverted = monthLeads.filter((l) => !!l.convertedClientId).length;
  const conversionRate = monthNewLeads > 0 ? (monthConverted / monthNewLeads) * 100 : 0;

  return { newToday, noAnswerYesterday, noAnswerRateUnder5Calls, monthNewLeads, monthConverted, conversionRate };
}

export interface ConsiderationTodoRow {
  id: string;
  name: string;
  phone: string;
  assignedStaff: string;
  receivedAt: string;
  nextContactAt?: string;
  overdue: boolean;
}

// '고려중' 상태 리드를 재설득 컨택 우선순위(재통화 예정일이 지난 순 → 임박한 순)로 정렬.
// 상태값 세분화(진행제안/금액안내완료 등)는 사용자가 상태 목록을 정리한 뒤 반영 예정이라
// 우선 '고려중' 단일 상태를 기준으로 합니다.
export function getConsiderationTodoList(leads: DbLead[], limit = 8): ConsiderationTodoRow[] {
  const todayIso = isoStr(startOfDay(new Date()));
  return leads
    .filter((l) => l.status === "고려중" && !l.convertedClientId)
    .map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      assignedStaff: l.assignedStaff,
      receivedAt: l.receivedAt,
      nextContactAt: l.nextContactAt,
      overdue: !!l.nextContactAt && l.nextContactAt < todayIso,
    }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const an = a.nextContactAt ?? "9999-99-99";
      const bn = b.nextContactAt ?? "9999-99-99";
      return an < bn ? -1 : an > bn ? 1 : 0;
    })
    .slice(0, limit);
}
