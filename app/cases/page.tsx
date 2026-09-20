"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { CASE_STAGES, type CaseStage, type CaseStatus, type CaseType } from "@/lib/types";
import { CaseTypeBadge, StageBadge, StatusBadge } from "@/components/ui/Badge";
import { Card, PageHeader, Pagination, SearchBox, pageRows } from "@/components/ui/Primitives";
import { fmtDate, fmtWon } from "@/lib/format";

const TYPE_FILTERS: Array<CaseType | "전체"> = ["전체", "개인회생", "개인파산"];
const STATUS_FILTERS: Array<CaseStatus | "전체"> = ["전체", "진행중", "보류", "종결", "취하"];

export default function CasesPage() {
  const { cases, clients } = useStore();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<CaseType | "전체">("전체");
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "전체">("진행중");
  const [stageFilter, setStageFilter] = useState<CaseStage | "전체">("전체");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    return cases
      .map((c) => ({ c, client: clients.find((cl) => cl.id === c.clientId) }))
      .filter(({ c, client }) => {
        if (typeFilter !== "전체" && c.caseType !== typeFilter) return false;
        if (statusFilter !== "전체" && c.status !== statusFilter) return false;
        if (stageFilter !== "전체" && c.stage !== stageFilter) return false;
        if (query.trim()) {
          const q = query.trim();
          const hit = client?.name.includes(q) || c.caseNumber.includes(q) || client?.phone.includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => (a.c.contractDate < b.c.contractDate ? 1 : -1));
  }, [cases, clients, query, typeFilter, statusFilter, stageFilter]);

  return (
    <>
      <PageHeader title="사건관리" description={`회생/파산 사건 ${cases.length}건 중 ${rows.length}건 표시`} />

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
          placeholder="의뢰인명 · 사건번호 · 연락처 검색"
        />
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTypeFilter(t);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${typeFilter === t ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {t}
            </button>
          ))}
          <span className="mx-1 w-px bg-slate-200" />
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${statusFilter === s ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStageFilter("전체")}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${stageFilter === "전체" ? "bg-slate-800 text-white" : "bg-blue-50 text-blue-700"}`}
          >
            전체 단계
          </button>
          {CASE_STAGES.map((st) => (
            <button
              key={st}
              onClick={() => setStageFilter(st)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${stageFilter === st ? "bg-slate-800 text-white" : "bg-blue-50 text-blue-700"}`}
            >
              {st === "개시_선고" ? "개시/선고" : st === "변제계획_면책심문" ? "인가/면책심문" : st}
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 사건이 없습니다.</div>}
          {pageRows(rows, page, 10).map(({ c, client }) => {
            const receivable = Math.max(0, c.contractAmount - c.paidAmount);
            return (
              <Link key={c.id} href={`/cases/${c.id}`} className="block space-y-2 p-4 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-base font-bold text-slate-900">{client?.name ?? "-"}</span>
                      <CaseTypeBadge caseType={c.caseType} />
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{c.caseNumber} · 담당 {c.assignedStaff}</div>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex items-center gap-2">
                  <StageBadge stage={c.stage} caseType={c.caseType} />
                  <span className="text-xs text-slate-400">{fmtDate(c.contractDate)} 계약</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">계약금액 {fmtWon(c.contractAmount)}</span>
                  {receivable > 0 ? <span className="font-semibold text-red-600">미수 {fmtWon(receivable)}</span> : <span className="text-slate-300">미수금 없음</span>}
                </div>
              </Link>
            );
          })}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[880px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["의뢰인", "사건번호", "유형", "단계", "담당자", "계약일", "계약금액", "미수금", "상태", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, 10).map(({ c, client }) => {
                const receivable = Math.max(0, c.contractAmount - c.paidAmount);
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{client?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{c.caseNumber}</td>
                    <td className="px-4 py-3">
                      <CaseTypeBadge caseType={c.caseType} />
                    </td>
                    <td className="px-4 py-3">
                      <StageBadge stage={c.stage} caseType={c.caseType} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{c.assignedStaff}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(c.contractDate)}</td>
                    <td className="px-4 py-3 text-slate-900">{fmtWon(c.contractAmount)}</td>
                    <td className="px-4 py-3">
                      {receivable > 0 ? <span className="font-semibold text-red-600">{fmtWon(receivable)}</span> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/cases/${c.id}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        상세
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                    조건에 맞는 사건이 없습니다.
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
