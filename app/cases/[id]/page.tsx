"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { CASE_STAGES, PAYMENT_METHOD_NOTE, STAGE_LABELS } from "@/lib/types";
import { CaseTypeBadge, InstallmentStatusBadge, StatusBadge } from "@/components/ui/Badge";
import { DocumentChecklist } from "@/components/ui/DocumentChecklist";
import { Card } from "@/components/ui/Primitives";
import { fmtDate, fmtWon } from "@/lib/format";

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const caseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { cases, clients, installments, scheduleItems } = useStore();
  const c = caseId ? cases.find((x) => x.id === caseId) : undefined;

  if (!c) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-slate-500">사건을 찾을 수 없습니다.</p>
        <Link href="/cases" className="mt-3 inline-block text-sm font-semibold text-blue-700">
          사건 목록으로 돌아가기
        </Link>
      </Card>
    );
  }

  const client = clients.find((x) => x.id === c.clientId);
  const installs = installments.filter((i) => i.caseId === c.id).sort((a, b) => a.seq - b.seq);
  const schedule = scheduleItems.filter((s) => s.caseId === c.id);
  const receivable = Math.max(0, c.contractAmount - c.paidAmount);
  const stageIdx = CASE_STAGES.indexOf(c.stage);

  return (
    <div className="space-y-4">
      <Link href="/cases" className="text-sm text-slate-500 hover:text-slate-900">
        ← 사건 목록
      </Link>

      <Card className="p-5">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-lg font-bold">
              <span>{client?.name ?? "-"} 고객 정보</span>
              <CaseTypeBadge caseType={c.caseType} />
              <StatusBadge status={c.status} />
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {c.caseNumber} · {c.court} · 담당 {c.assignedStaff} · {client?.phone}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["총 채무액", fmtWon(c.totalDebt)],
            ["계약금액", fmtWon(c.contractAmount)],
            ["기납부액", fmtWon(c.paidAmount)],
            ["미수금", fmtWon(receivable)],
            ["결제수단", PAYMENT_METHOD_NOTE[c.paymentMethod]],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">{l}</div>
              <div className={`mt-1 font-bold ${l === "미수금" && receivable > 0 ? "text-red-600" : "text-slate-900"}`}>{v}</div>
            </div>
          ))}
        </div>

        {c.monthlyRepayment && (
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            월 변제금 {fmtWon(c.monthlyRepayment)}
          </div>
        )}
        {c.memo && (
          <div className="mt-4 rounded-xl border border-slate-100 p-4 text-sm">
            <div className="mb-1 text-xs font-semibold text-slate-500">메모</div>
            {c.memo}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-4 text-sm font-semibold text-slate-900">절차 진행 단계</div>
        <div className="flex items-center overflow-x-auto pb-1">
          {CASE_STAGES.map((st, i) => {
            const done = i < stageIdx;
            const active = i === stageIdx;
            return (
              <div key={st} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      active ? "bg-blue-600 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <div className={`w-20 text-center text-[11px] ${active ? "font-semibold text-blue-700" : "text-slate-400"}`}>
                    {STAGE_LABELS[c.caseType][st]}
                  </div>
                </div>
                {i < CASE_STAGES.length - 1 && (
                  <div className={`h-0.5 w-8 shrink-0 sm:w-12 ${i < stageIdx ? "bg-emerald-500" : "bg-slate-100"}`} />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-xs text-slate-500">
          최근 단계 변경일 {fmtDate(c.stageUpdatedAt)}
          {c.filingDate && ` · 법원접수일 ${fmtDate(c.filingDate)}`}
          {c.nextHearingDate && ` · 다음 기일 ${fmtDate(c.nextHearingDate)}`}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">입금 내역</div>
        <div className="overflow-x-auto">
          <table className="admin-responsive-table w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["회차", "납부기한", "금액", "상태", "입금일"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {installs.map((ins) => (
                <tr key={ins.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-500">{ins.seq === 1 ? "계약금" : `${ins.seq - 1}회차`}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(ins.dueDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{fmtWon(ins.amount)}</td>
                  <td className="px-4 py-3">
                    <InstallmentStatusBadge status={ins.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{ins.paidDate ? fmtDate(ins.paidDate) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DocumentChecklist caseId={c.id} docsSentAt={c.docsSentAt} />

      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">일정</div>
        {schedule.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">등록된 일정이 없습니다.</div>
        ) : (
          <ul className="space-y-2">
            {schedule.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">{s.type}</span>
                <span className="text-slate-900">{s.title}</span>
                <span className="ml-auto text-slate-500">{fmtDate(s.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
