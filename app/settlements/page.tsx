"use client";

// 도원 Admin(tg_m)의 '정산' 메뉴를 로파워 도메인에 맞게 이식.
// 사채업 특유의 '환수' 개념은 없으므로 계약매출/실매출/미수금 3대 지표와
// 담당자별 정산 요약, 결제완료 내역(CSV 내보내기)으로 구성했습니다.
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { getStaffPerformance } from "@/lib/dashboard";
import { PAYMENT_METHOD_NOTE } from "@/lib/types";
import { fmtDate, fmtWon } from "@/lib/format";
import { Card, PageHeader, Pagination, pageRows } from "@/components/ui/Primitives";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KpiCard } from "@/components/ui/KpiCard";
import { Download } from "lucide-react";

function monthRange() {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const end = `${y}-${String(m + 1).padStart(2, "0")}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, "0")}`;
  return { start, end };
}

function inRange(date: string, start: string, end: string): boolean {
  const d = date.slice(0, 10);
  return (!start || d >= start) && (!end || d <= end);
}

function downloadCsv(rows: Array<Record<string, string>>, filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => `"${(r[h] ?? "").replace(/"/g, '""')}"`).join(","))];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SettlementsPage() {
  const { cases, clients, installments } = useStore();
  const init = monthRange();
  const [rangeStart, setRangeStart] = useState(init.start);
  const [rangeEnd, setRangeEnd] = useState(init.end);
  const [page, setPage] = useState(1);

  const paidRows = useMemo(
    () =>
      installments
        .filter((i) => i.status === "완료" && i.paidDate && inRange(i.paidDate, rangeStart, rangeEnd))
        .map((i) => {
          const c = cases.find((x) => x.id === i.caseId);
          const client = c ? clients.find((x) => x.id === c.clientId) : undefined;
          return { installment: i, case: c, client };
        })
        .sort((a, b) => (a.installment.paidDate! < b.installment.paidDate! ? 1 : -1)),
    [installments, cases, clients, rangeStart, rangeEnd]
  );

  const kpi = useMemo(() => {
    const contractSales = cases.filter((c) => inRange(c.contractDate, rangeStart, rangeEnd)).reduce((a, c) => a + c.contractAmount, 0);
    const realSales = paidRows.reduce((a, r) => a + r.installment.amount, 0);
    const receivable = cases.reduce((a, c) => a + Math.max(0, c.contractAmount - c.paidAmount), 0);
    return { contractSales, realSales, receivable };
  }, [cases, paidRows, rangeStart, rangeEnd]);

  const staffRows = useMemo(() => getStaffPerformance(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  function exportCsv() {
    const rows = paidRows.map((r) => ({
      입금일시: r.installment.paidDate ?? "",
      의뢰인성함: r.client?.name ?? "-",
      연락처: r.client?.phone ?? "-",
      구분: r.case?.caseType ?? "-",
      결제금액: String(r.installment.amount),
      결제방법: r.case ? PAYMENT_METHOD_NOTE[r.case.paymentMethod] : "-",
      비고: r.installment.seq === 1 ? "계약금" : `${r.installment.seq - 1}회차`,
    }));
    downloadCsv(rows, `정산_${rangeStart}_${rangeEnd}.csv`);
  }

  return (
    <>
      <PageHeader
        title="정산"
        description="선택한 기간의 계약매출·실매출·미수금과 담당자별 정산 현황을 확인합니다."
        action={
          <DateRangePicker
            start={rangeStart}
            end={rangeEnd}
            onChange={(s, e) => {
              setRangeStart(s);
              setRangeEnd(e);
              setPage(1);
            }}
          />
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="계약매출 (계약일 기준)" value={fmtWon(kpi.contractSales)} />
        <KpiCard label="실매출 (결제완료액)" value={fmtWon(kpi.realSales)} />
        <KpiCard label="현재 전체 미수금" value={fmtWon(kpi.receivable)} />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">담당자별 정산 요약</div>
        <div className="overflow-x-auto">
          <table className="admin-responsive-table w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["담당자", "계약건수", "계약금액", "결제율"].map((h) => (
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
                  <td className="px-4 py-3 text-slate-900">{fmtWon(r.contractAmount)}</td>
                  <td className="px-4 py-3 text-slate-500">{r.paymentRate.toFixed(1)}%</td>
                </tr>
              ))}
              {staffRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                    선택한 기간에 계약 건이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="text-sm font-semibold text-slate-900">결제완료 내역 ({paidRows.length}건)</div>
          <button
            onClick={exportCsv}
            disabled={paidRows.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download size={13} />
            CSV 다운로드
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="admin-responsive-table w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["입금일시", "의뢰인 성함", "연락처", "구분", "결제금액", "결제 방법", "비고"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(paidRows, page, 10).map((r) => (
                <tr key={r.installment.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-500">{r.installment.paidDate ? fmtDate(r.installment.paidDate) : "-"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{r.client?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.client?.phone ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.case?.caseType ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-900">{fmtWon(r.installment.amount)}</td>
                  <td className="px-4 py-3 text-slate-500">{r.case ? PAYMENT_METHOD_NOTE[r.case.paymentMethod] : "-"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.installment.seq === 1 ? "계약금" : `${r.installment.seq - 1}회차`}</td>
                </tr>
              ))}
              {paidRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    선택한 기간에 결제완료 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={paidRows.length} onChange={setPage} pageSize={10} />
      </Card>
    </>
  );
}
