"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { cases, getClientById } from "@/lib/mock-data";
import { CASE_STAGES, type CaseStage, type CaseStatus, type CaseType } from "@/lib/types";
import { CaseTypeBadge, StageBadge, StatusBadge } from "@/components/ui/Badge";
import { fmtDate, fmtWon } from "@/lib/format";

const TYPE_FILTERS: Array<CaseType | "전체"> = ["전체", "개인회생", "개인파산"];
const STATUS_FILTERS: Array<CaseStatus | "전체"> = ["전체", "진행중", "보류", "종결", "취하"];

export default function CasesPage() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<CaseType | "전체">("전체");
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "전체">("진행중");
  const [stageFilter, setStageFilter] = useState<CaseStage | "전체">("전체");

  const rows = useMemo(() => {
    return cases
      .map((c) => ({ c, client: getClientById(c.clientId) }))
      .filter(({ c, client }) => {
        if (typeFilter !== "전체" && c.caseType !== typeFilter) return false;
        if (statusFilter !== "전체" && c.status !== statusFilter) return false;
        if (stageFilter !== "전체" && c.stage !== stageFilter) return false;
        if (query.trim()) {
          const q = query.trim();
          const hit =
            client?.name.includes(q) ||
            c.caseNumber.includes(q) ||
            client?.phone.includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => (a.c.contractDate < b.c.contractDate ? 1 : -1));
  }, [query, typeFilter, statusFilter, stageFilter]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">사건관리</h1>
        <p className="mt-0.5 text-sm text-muted">회생/파산 사건 {cases.length}건 중 {rows.length}건 표시</p>
      </div>

      <div className="card space-y-3 p-4">
        <input
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder="의뢰인명 · 사건번호 · 연락처 검색"
          className="w-full rounded-md2 border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-sm2 px-2.5 py-1 text-xs font-medium ${
                typeFilter === t ? "bg-navy text-white" : "bg-line text-muted"
              }`}
            >
              {t}
            </button>
          ))}
          <span className="mx-1 w-px bg-line" />
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-sm2 px-2.5 py-1 text-xs font-medium ${
                statusFilter === s ? "bg-navy text-white" : "bg-line text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStageFilter("전체")}
            className={`rounded-sm2 px-2.5 py-1 text-xs font-medium ${
              stageFilter === "전체" ? "bg-brand text-white" : "bg-brand-pale text-brand"
            }`}
          >
            전체 단계
          </button>
          {CASE_STAGES.map((st) => (
            <button
              key={st}
              onClick={() => setStageFilter(st)}
              className={`rounded-sm2 px-2.5 py-1 text-xs font-medium ${
                stageFilter === st ? "bg-brand text-white" : "bg-brand-pale text-brand"
              }`}
            >
              {st === "개시_선고" ? "개시/선고" : st === "변제계획_면책심문" ? "인가/면책심문" : st}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">의뢰인</th>
              <th className="py-2 pr-3 font-medium">사건번호</th>
              <th className="py-2 pr-3 font-medium">유형</th>
              <th className="py-2 pr-3 font-medium">단계</th>
              <th className="py-2 pr-3 font-medium">담당자</th>
              <th className="py-2 pr-3 font-medium">계약일</th>
              <th className="py-2 pr-3 font-medium">계약금액</th>
              <th className="py-2 pr-3 font-medium">미수금</th>
              <th className="py-2 pr-3 font-medium">상태</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, client }) => {
              const receivable = Math.max(0, c.contractAmount - c.paidAmount);
              return (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-bg">
                  <td className="py-2.5 pr-3 font-medium text-ink">{client?.name ?? "-"}</td>
                  <td className="py-2.5 pr-3 text-muted">{c.caseNumber}</td>
                  <td className="py-2.5 pr-3">
                    <CaseTypeBadge caseType={c.caseType} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <StageBadge stage={c.stage} caseType={c.caseType} />
                  </td>
                  <td className="py-2.5 pr-3 text-muted">{c.assignedStaff}</td>
                  <td className="py-2.5 pr-3 text-muted">{fmtDate(c.contractDate)}</td>
                  <td className="py-2.5 pr-3 text-ink">{fmtWon(c.contractAmount)}</td>
                  <td className="py-2.5 pr-3 text-ink">
                    {receivable > 0 ? (
                      <span className="text-danger">{fmtWon(receivable)}</span>
                    ) : (
                      <span className="text-muted2">-</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="py-2.5 text-right">
                    <Link
                      href={`/cases/${c.id}`}
                      className="rounded-md2 border border-line px-2.5 py-1 text-xs text-muted hover:text-ink"
                    >
                      상세
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted">
                  조건에 맞는 사건이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
