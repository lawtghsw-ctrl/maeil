"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import type { InstallmentStatus } from "@/lib/types";
import { fmtDate, fmtEokMan, fmtWon } from "@/lib/format";
import { InstallmentStatusBadge } from "@/components/ui/Badge";
import { Card, PageHeader, Pagination, SearchBox, pageRows } from "@/components/ui/Primitives";

const STATUS_TABS: Array<InstallmentStatus | "전체"> = ["전체", "예정", "완료", "연체", "실패"];

export default function BillingPage() {
  const { cases, clients, installments } = useStore();
  const [status, setStatus] = useState<InstallmentStatus | "전체">("전체");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const joined = useMemo(() => {
    return installments.map((ins) => {
      const c = cases.find((x) => x.id === ins.caseId);
      const client = c ? clients.find((cl) => cl.id === c.clientId) : undefined;
      return { ins, c, client };
    });
  }, [installments, cases, clients]);

  const totals = useMemo(() => {
    const contractAmount = cases.reduce((a, c) => a + c.contractAmount, 0);
    const paymentAmount = installments.filter((i) => i.status === "완료").reduce((a, i) => a + i.amount, 0);
    const overdueAmount = installments.filter((i) => i.status === "연체" || i.status === "실패").reduce((a, i) => a + i.amount, 0);
    const receivable = contractAmount - paymentAmount;
    return { contractAmount, paymentAmount, overdueAmount, receivable };
  }, [cases, installments]);

  const rows = useMemo(() => {
    return joined
      .filter(({ ins }) => status === "전체" || ins.status === status)
      .filter(({ client }) => {
        if (!query.trim()) return true;
        return client?.name.includes(query) ?? false;
      })
      .sort((a, b) => (a.ins.dueDate < b.ins.dueDate ? 1 : -1));
  }, [joined, status, query]);

  return (
    <>
      <PageHeader title="입금·분납 관리" description={`전체 분납 ${installments.length}건`} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-slate-500">계약금액 합계</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{fmtEokMan(totals.contractAmount)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">결제완료액</div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">{fmtEokMan(totals.paymentAmount)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">연체·실패액</div>
          <div className="mt-1 text-lg font-semibold text-red-600">{fmtEokMan(totals.overdueAmount)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">미수금</div>
          <div className="mt-1 text-lg font-semibold text-red-600">{fmtEokMan(totals.receivable)}</div>
        </Card>
      </div>

      <Card className="mb-4 space-y-3 p-3">
        <SearchBox
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          onReset={() => {
            setQuery("");
            setPage(1);
          }}
          placeholder="의뢰인명 검색"
        />
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${status === s ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 내역이 없습니다.</div>}
          {pageRows(rows, page, 10).map(({ ins, c, client }) => (
            <div key={ins.id} className="space-y-1.5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-bold text-slate-900">{client?.name ?? "-"}</div>
                  <div className="text-xs text-slate-500">{ins.seq === 1 ? "계약금" : `${ins.seq - 1}회차`}</div>
                </div>
                <InstallmentStatusBadge status={ins.status} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">납부기한 {fmtDate(ins.dueDate)}</span>
                <span className="font-semibold text-slate-900">{fmtWon(ins.amount)}</span>
              </div>
              {c && (
                <Link href={`/cases/${c.id}`} className="inline-block text-xs font-semibold text-blue-700">
                  사건보기 →
                </Link>
              )}
            </div>
          ))}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["의뢰인", "회차", "납부기한", "금액", "상태", "입금일", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, 10).map(({ ins, c, client }) => (
                <tr key={ins.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{client?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-500">{ins.seq === 1 ? "계약금" : `${ins.seq - 1}회차`}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(ins.dueDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{fmtWon(ins.amount)}</td>
                  <td className="px-4 py-3">
                    <InstallmentStatusBadge status={ins.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{ins.paidDate ? fmtDate(ins.paidDate) : "-"}</td>
                  <td className="px-4 py-3 text-right">
                    {c && (
                      <Link href={`/cases/${c.id}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        사건보기
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    조건에 맞는 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={rows.length} onChange={setPage} pageSize={10} />
      </Card>
    </>
  );
}
