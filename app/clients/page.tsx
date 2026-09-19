"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { clients, getCasesByClient } from "@/lib/mock-data";
import type { LeadSource } from "@/lib/types";
import { fmtDate, fmtWon } from "@/lib/format";
import { CaseTypeBadge, StatusBadge } from "@/components/ui/Badge";

const SOURCE_FILTERS: Array<LeadSource | "전체"> = [
  "전체",
  "메타광고",
  "커뮤니티",
  "지인소개",
  "네이버검색",
  "재상담",
];

export default function ClientsPage() {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "전체">("전체");

  const rows = useMemo(() => {
    return clients
      .filter((cl) => sourceFilter === "전체" || cl.source === sourceFilter)
      .filter((cl) => {
        if (!query.trim()) return true;
        return cl.name.includes(query) || cl.phone.includes(query);
      })
      .sort((a, b) => (a.registeredAt < b.registeredAt ? 1 : -1));
  }, [query, sourceFilter]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">고객관리</h1>
        <p className="mt-0.5 text-sm text-muted">
          의뢰인 {clients.length}명 중 {rows.length}명 표시
        </p>
      </div>

      <div className="card space-y-3 p-4">
        <input
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder="이름 · 연락처 검색"
          className="w-full rounded-md2 border border-line px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="flex flex-wrap gap-2">
          {SOURCE_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`rounded-sm2 px-2.5 py-1 text-xs font-medium ${
                sourceFilter === s ? "bg-navy text-white" : "bg-line text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((cl) => {
          const clientCases = getCasesByClient(cl.id);
          const totalReceivable = clientCases.reduce(
            (a, c) => a + Math.max(0, c.contractAmount - c.paidAmount),
            0
          );
          return (
            <div key={cl.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-ink">{cl.name}</div>
                <span className="rounded-sm2 bg-line px-1.5 py-0.5 text-[11px] text-muted">
                  {cl.source}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {cl.phone} · 등록 {fmtDate(cl.registeredAt)}
              </div>
              <div className="mt-3 space-y-1.5">
                {clientCases.map((c) => (
                  <Link
                    key={c.id}
                    href={`/cases/${c.id}`}
                    className="flex items-center gap-2 rounded-md2 border border-line px-2.5 py-1.5 text-xs hover:bg-bg"
                  >
                    <CaseTypeBadge caseType={c.caseType} />
                    <span className="truncate text-muted">{c.caseNumber}</span>
                    <span className="ml-auto shrink-0">
                      <StatusBadge status={c.status} />
                    </span>
                  </Link>
                ))}
                {clientCases.length === 0 && (
                  <div className="text-xs text-muted2">등록된 사건 없음</div>
                )}
              </div>
              {totalReceivable > 0 && (
                <div className="mt-3 text-xs text-danger">
                  미수금 합계 {fmtWon(totalReceivable)}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="card col-span-full py-10 text-center text-sm text-muted">
            조건에 맞는 의뢰인이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
