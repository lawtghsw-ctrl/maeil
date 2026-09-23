"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  PhoneCall,
  PhoneMissed,
  UserPlus,
} from "lucide-react";
import { useStore, CURRENT_STAFF } from "@/lib/store";
import { DB_LEAD_DEFAULT_STAGE_BY_STATUS, type DbLead } from "@/lib/types";
import { checkCallWarning, kstDateStr } from "@/lib/consultation";
import { fmtWon } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";

type ContractPeriod = "일" | "주" | "월" | "기간설정";

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

function TodoCard({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: DbLead[];
  kind: "예약" | "상담" | "고려";
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="text-sm font-bold text-slate-900">{title}</div>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{rows.length}건</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-400">현재 표시할 DB가 없습니다.</div>
      ) : (
        <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
          {rows.map((lead) => (
            <div key={lead.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{lead.name}</span>
                  <span className="text-xs text-slate-400">{lead.phone}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {kind === "예약" && lead.reservationAt
                    ? `예약 ${lead.reservationAt.replace("T", " ")}`
                    : kind === "상담"
                      ? "상담 진행 중"
                      : "고려중 · 재컨택 필요"}
                  {lead.memo ? ` · ${lead.memo}` : ""}
                </div>
              </div>
              <Link
                href="/db"
                className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                DB 열기
              </Link>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// v22 개인 대시보드: 실제 로그인 연동 전에는 CURRENT_STAFF를 로그인 계정으로 간주합니다.
// 로그인 기능이 붙으면 CURRENT_STAFF 자리에 세션 사용자를 연결하면 동일 집계가 개인별로 동작합니다.
export default function DashboardPage() {
  const { leads, cases } = useStore();
  const today = kstDateStr();
  const [contractPeriod, setContractPeriod] = useState<ContractPeriod>("월");
  const month = monthBounds(today);
  const [customStart, setCustomStart] = useState(month.start);
  const [customEnd, setCustomEnd] = useState(today);

  const personalLeads = useMemo(
    () => leads.filter((lead) => lead.assignedStaff === CURRENT_STAFF),
    [leads]
  );
  const personalCases = useMemo(
    () => cases.filter((record) => record.assignedStaff === CURRENT_STAFF),
    [cases]
  );

  const dashboard = useMemo(() => {
    const newGreetingDone = personalLeads.filter((lead) => greetingCompletedToday(lead, today));
    const noAnswerNeed = personalLeads.filter(
      (lead) => leadStage(lead) === "부재" && checkCallWarning(lead.consultation?.memoLog, today).active && !lead.convertedClientId
    );
    const recall = personalLeads
      .filter((lead) => leadStage(lead) === "예약" && !lead.convertedClientId)
      .sort((a, b) => (a.reservationAt ?? a.receivedAt).localeCompare(b.reservationAt ?? b.receivedAt));
    const consulting = personalLeads
      .filter((lead) => leadStage(lead) === "상담" && !lead.convertedClientId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    // 상담 후 착수금 안내/설득 단계로 넘어갔거나 고객전환까지 끝난 건을 상담완료로 봅니다.
    const completed = personalLeads.filter((lead) => {
      const stage = leadStage(lead);
      return !!lead.convertedClientId || stage === "착수금 안내" || stage === "설득필요";
    });
    const consideration = personalLeads
      .filter((lead) => (lead.status === "고려중" || leadStage(lead) === "설득필요") && !lead.convertedClientId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    return { newGreetingDone, noAnswerNeed, recall, consulting, completed, consideration };
  }, [personalLeads, today]);

  const contractBounds = useMemo(() => {
    if (contractPeriod === "일") return { start: today, end: today };
    if (contractPeriod === "주") return weekBounds(today);
    if (contractPeriod === "월") return monthBounds(today);
    return { start: customStart, end: customEnd };
  }, [contractPeriod, today, customStart, customEnd]);

  const contractSummary = useMemo(() => {
    const rows = personalCases.filter(
      (record) => record.contractDate >= contractBounds.start && record.contractDate <= contractBounds.end
    );
    return {
      count: rows.length,
      amount: rows.reduce((sum, record) => sum + record.contractAmount, 0),
    };
  }, [personalCases, contractBounds]);

  const topCards = [
    { icon: UserPlus, label: "당일신규 DB", value: dashboard.newGreetingDone.length, sub: "문자인사 완료건", tone: "blue" },
    { icon: PhoneMissed, label: "부재컨택 필요 DB", value: dashboard.noAnswerNeed.length, sub: "오늘 콜 관리 대상", tone: "red" },
    { icon: CalendarClock, label: "재통화약속 DB", value: dashboard.recall.length, sub: "예약 일정 등록", tone: "amber" },
    { icon: PhoneCall, label: "상담중인 DB", value: dashboard.consulting.length, sub: "현재 상담 단계", tone: "blue" },
    { icon: CheckCircle2, label: "상담완료 DB", value: dashboard.completed.length, sub: "상담 후속 단계 포함", tone: "emerald" },
  ] as const;

  return (
    <>
      <PageHeader
        title={`${CURRENT_STAFF} 개인 대시보드`}
        description="개인계정 기준으로 본인에게 배정된 DB와 계약 실적만 표시합니다."
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

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <TodoCard title="재통화약속 DB" rows={dashboard.recall.slice(0, 12)} kind="예약" />
        <TodoCard title="상담 중 DB" rows={dashboard.consulting.slice(0, 12)} kind="상담" />
        <TodoCard title="고려중 DB" rows={dashboard.consideration.slice(0, 12)} kind="고려" />
      </div>
    </>
  );
}
