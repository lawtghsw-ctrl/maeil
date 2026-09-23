"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { PAYMENT_METHOD_NOTE } from "@/lib/types";
import { CaseTypeBadge, InstallmentStatusBadge, StatusBadge } from "@/components/ui/Badge";
import { CaseActionPanel } from "@/components/cases/CaseActionModals";
import { Card } from "@/components/ui/Primitives";
import { fmtDate, fmtWon } from "@/lib/format";

// v22: 고객관리와 계약관리를 계약관리로 통합했습니다. 계약 상세는 고객/계약의 핵심 재무정보와
// 실제로 유지하기로 한 3개 업무도구(분납관리, 전자계약서, 서류안내문 전송)에 집중합니다.
// 기존 절차 진행 단계, 서류체크리스트 UI, 일정 영역은 요청에 따라 제거했습니다.
export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const caseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { cases, clients, installments } = useStore();
  const c = caseId ? cases.find((item) => item.id === caseId) : undefined;

  if (!c) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-slate-500">계약을 찾을 수 없습니다.</p>
        <Link href="/cases" className="mt-3 inline-block text-sm font-semibold text-blue-700">
          계약 목록으로 돌아가기
        </Link>
      </Card>
    );
  }

  const client = clients.find((item) => item.id === c.clientId);
  const installs = installments.filter((item) => item.caseId === c.id).sort((a, b) => a.seq - b.seq);
  const receivable = Math.max(0, c.contractAmount - c.paidAmount);

  return (
    <div className="space-y-4">
      <Link href="/cases" className="text-sm text-slate-500 hover:text-slate-900">
        ← 계약 목록
      </Link>

      <Card className="p-5">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-lg font-bold">
              <span>{client?.name ?? "-"} 계약 상세</span>
              <CaseTypeBadge caseType={c.caseType} />
              <StatusBadge status={c.status} />
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {c.caseNumber} · {c.court} · 담당 {c.assignedStaff} · {client?.phone ?? "-"}
            </div>
          </div>
          {client && <CaseActionPanel client={client} caseRecord={c} />}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["총 채무액", fmtWon(c.totalDebt)],
            ["계약금액", fmtWon(c.contractAmount)],
            ["납부금", fmtWon(c.paidAmount)],
            ["미수금", fmtWon(receivable)],
            ["결제수단", PAYMENT_METHOD_NOTE[c.paymentMethod]],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">{label}</div>
              <div className={`mt-1 font-bold ${label === "미수금" && receivable > 0 ? "text-red-600" : "text-slate-900"}`}>
                {value}
              </div>
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
            <div className="mb-1 text-xs font-semibold text-slate-500">계약 메모</div>
            {c.memo}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="text-sm font-semibold text-slate-900">분납 현황</div>
          <div className="text-xs text-slate-400">수정은 상단의 분납관리에서 진행합니다.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="admin-responsive-table w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["회차", "납부기한", "금액", "상태", "입금일"].map((header) => (
                  <th key={header} className="px-4 py-3 font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {installs.map((ins) => (
                <tr key={ins.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-500">{ins.seq === 1 ? "계약금" : `${ins.seq - 1}회차`}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(ins.dueDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{fmtWon(ins.amount)}</td>
                  <td className="px-4 py-3"><InstallmentStatusBadge status={ins.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{ins.paidDate ? fmtDate(ins.paidDate) : "-"}</td>
                </tr>
              ))}
              {installs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">등록된 분납 일정이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
