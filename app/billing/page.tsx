"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import type { InstallmentStatus } from "@/lib/types";
import { fmtDate, fmtEokMan, fmtWon } from "@/lib/format";
import { InstallmentStatusBadge } from "@/components/ui/Badge";

const STATUS_TABS: Array<InstallmentStatus | "전체"> = ["전체", "예정", "완료", "연체", "실패"];

export default function BillingPage() {
  const { cases, clients, installments } = useStore();
  const [status, setStatus] = useState<InstallmentStatus | "전체">("전체");
  const [query, setQuery] = useState("");

  const joined = useMemo(() => {
    return installments.map((ins) => {
      const c = cases.find((x) => x.id === ins.caseId);
      const client = c ? clients.find((cl) => cl.id === c.clientId) : undefined;
      return { ins, c, client };
    });
  }, [installments, cases, clients]);

  const totals = useMemo(() => {
    const contractAmount = cases.reduce((a, c) => a + c.contractAmount, 0);
    const paymentAmount = installments
      .filter((i) => i.status === "완료")
      .reduce((a, i) => a + i.amount, 0);
    const overdueAmount = installments
      .filter((i) => i.status === "연체" || i.status === "실패")
      .reduce((a, i) => a + i.amount, 0);
    const receivable = contractAmount - paymentAmount;
    return { contractAmount, paymentAmount, overdueAmount, receivable };
  }, [cases, installments]);

  const rows = useMemo(() => {
    return joined
      .filter(({ ins }) => status === "전체" || ins.status === status)
      .filter(({ c, client }) => {
        if (!query.trim()) return true;
        return (
          client?.name.includes(query) ||
          c?.caseNumber.includes(query) ||
          false
        );
      })
      .sort((a, b) => (a.ins.dueDate < b.ins.dueDate ? 1 : -1));
  }, [joined, status, query]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">청구·결제 관리</h1>
        <p className="mt-0.5 text-sm text-muted">전체 분납 {installments.length}건</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="계약금액 합계" value={fmtEokMan(totals.contractAmount)} />
        <SummaryCard label="결제완료액" value={fmtEokMan(totals.paymentAmount)} tone="success" />
        <SummaryCard label="연체·실패액" value={fmtEokMan(totals.overdueAmount)} tone="danger" />
        <SummaryCard label="미수금" value={fmtEokMan(totals.receivable)} tone="danger" />
      </div>

      <div className="card space-y-3 p-4">
        <input
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder="의뢰인명 · 사건번호 검색"
          className="w-full rounded-md2 border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-sm2 px-2.5 py-1 text-xs font-medium ${
                status === s ? "bg-navy text-white" : "bg-line text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">의뢰인</th>
              <th className="py-2 pr-3 font-medium">사건번호</th>
              <th className="py-2 pr-3 font-medium">회차</th>
              <th className="py-2 pr-3 font-medium">납부기한</th>
              <th className="py-2 pr-3 font-medium">금액</th>
              <th className="py-2 pr-3 font-medium">상태</th>
              <th className="py-2 font-medium">입금일</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ins, c, client }) => (
              <tr key={ins.id} className="border-b border-line last:border-0 hover:bg-bg">
                <td className="py-2.5 pr-3 font-medium text-ink">{client?.name ?? "-"}</td>
                <td className="py-2.5 pr-3 text-muted">{c?.caseNumber ?? "-"}</td>
                <td className="py-2.5 pr-3 text-muted">
                  {ins.seq === 1 ? "계약금" : `${ins.seq - 1}회차`}
                </td>
                <td className="py-2.5 pr-3 text-muted">{fmtDate(ins.dueDate)}</td>
                <td className="py-2.5 pr-3 text-ink">{fmtWon(ins.amount)}</td>
                <td className="py-2.5 pr-3">
                  <InstallmentStatusBadge status={ins.status} />
                </td>
                <td className="py-2.5 text-muted">{ins.paidDate ? fmtDate(ins.paidDate) : "-"}</td>
                <td className="py-2.5 text-right">
                  {c && (
                    <Link
                      href={`/cases/${c.id}`}
                      className="rounded-md2 border border-line px-2.5 py-1 text-xs text-muted hover:text-ink"
                    >
                      사건보기
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted">
                  조건에 맞는 내역이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold ${
          tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
