"use client";

import { useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { leadContactLabel } from "@/lib/mock-data";
import { DB_LEAD_STATUSES, MAX_RECALL_TOTAL, type DbLeadStatus, type TimeSlot } from "@/lib/types";
import { DbLeadStatusBadge, TimeSlotChip } from "@/components/ui/Badge";
import { Button, Card, PageHeader, Pagination, SearchBox, pageRows } from "@/components/ui/Primitives";
import { fmtDate } from "@/lib/format";

const TIME_SLOTS: TimeSlot[] = ["평오전", "평점심", "평오후", "퇴근후", "주말오전", "주말오후"];

export default function DbManagementPage() {
  const { leads, updateLead, convertLeadToClient } = useStore();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DbLeadStatus | "전체">("전체");
  const [slotFilter, setSlotFilter] = useState<TimeSlot | "전체">("전체");
  const [page, setPage] = useState(1);
  const [justConverted, setJustConverted] = useState<string | null>(null);

  const rows = useMemo(() => {
    return leads
      .filter((l) => statusFilter === "전체" || l.status === statusFilter)
      .filter((l) => slotFilter === "전체" || l.timeSlot === slotFilter)
      .filter((l) => {
        if (!query.trim()) return true;
        return l.name.includes(query) || l.phone.includes(query);
      })
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [leads, statusFilter, slotFilter, query]);

  const newTodayCount = leads.filter((l) => l.callAttempts === 0 && l.status === "신규접수").length;

  return (
    <>
      <PageHeader
        title="DB관리"
        description={`광고 등으로 접수된 상담 신청 ${leads.length}건 · 미확인 신규 ${newTodayCount}건 — 기초정보를 메모하고 상태를 정리한 뒤 '고객 전환'으로 고객관리에 등록하세요.`}
      />

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
          placeholder="이름 · 연락처 검색"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setStatusFilter(e.target.value as DbLeadStatus | "전체");
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
          >
            <option value="전체">상태 전체</option>
            {DB_LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="mx-1 w-px bg-slate-200" />
          <button
            onClick={() => setSlotFilter("전체")}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
              slotFilter === "전체" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            시간대 전체
          </button>
          {TIME_SLOTS.map((s) => (
            <button key={s} onClick={() => setSlotFilter(s)} className={`rounded-md p-0.5 ${slotFilter === s ? "ring-2 ring-blue-500" : ""}`}>
              <TimeSlotChip slot={s} />
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 DB가 없습니다.</div>}
          {pageRows(rows, page, 10).map((lead) => (
            <div key={lead.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold text-slate-900">{leadContactLabel(lead)}</span>
                    <TimeSlotChip slot={lead.timeSlot} />
                  </div>
                  <a href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`} className="mt-1 inline-block text-sm font-semibold text-blue-700">
                    {lead.phone}
                  </a>
                  <div className="mt-1 text-[11px] text-slate-400">{fmtDate(lead.receivedAt)} · 담당 {lead.assignedStaff}</div>
                </div>
                <DbLeadStatusBadge status={lead.status} />
              </div>
              <select
                value={lead.status}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { status: e.target.value as DbLeadStatus })}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                {DB_LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                defaultValue={lead.memo ?? ""}
                placeholder="기초정보 메모 (부채원인, 특이사항 등)"
                onBlur={(e: FocusEvent<HTMLInputElement>) => updateLead(lead.id, { memo: e.target.value })}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
              />
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className={lead.callAttempts >= MAX_RECALL_TOTAL - 1 && !lead.convertedClientId ? "font-semibold text-red-600" : ""}>
                  재콜 {lead.callAttempts}/{MAX_RECALL_TOTAL}회
                </span>
                {lead.convertedClientId ? (
                  <Link href="/clients" className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                    고객관리로 이동
                  </Link>
                ) : (
                  <Button
                    className="px-2.5 py-1.5"
                    onClick={() => {
                      convertLeadToClient(lead.id);
                      setJustConverted(lead.id);
                    }}
                  >
                    고객 전환
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["접수일", "시간대", "이름(저장형식)", "연락처", "담당자", "재콜", "상태", "메모", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, 10).map((lead) => {
                const nearLimit = lead.callAttempts >= MAX_RECALL_TOTAL - 1 && !lead.convertedClientId;
                return (
                  <tr key={lead.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(lead.receivedAt)}</td>
                    <td className="px-4 py-3">
                      <TimeSlotChip slot={lead.timeSlot} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{leadContactLabel(lead)}</div>
                      {lead.caseTypeGuess && <div className="text-[11px] text-slate-400">추정유형 {lead.caseTypeGuess}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{lead.phone}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{lead.assignedStaff}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={nearLimit ? "font-semibold text-red-600" : "text-slate-500"}>
                        {lead.callAttempts}/{MAX_RECALL_TOTAL}회
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={lead.status}
                        disabled={!!lead.convertedClientId}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { status: e.target.value as DbLeadStatus })}
                        className="min-w-[110px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                      >
                        {DB_LEAD_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1">
                        <DbLeadStatusBadge status={lead.status} />
                      </div>
                    </td>
                    <td className="min-w-[220px] px-4 py-3">
                      <input
                        defaultValue={lead.memo ?? ""}
                        placeholder="기초정보 메모 (부채원인, 특이사항 등)"
                        onBlur={(e: FocusEvent<HTMLInputElement>) => updateLead(lead.id, { memo: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {lead.convertedClientId ? (
                        <Link href="/clients" className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                          고객관리로 이동
                        </Link>
                      ) : (
                        <Button
                          className="px-2.5 py-1.5"
                          onClick={() => {
                            convertLeadToClient(lead.id);
                            setJustConverted(lead.id);
                          }}
                        >
                          고객 전환
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    조건에 맞는 DB가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={rows.length} onChange={setPage} pageSize={10} />
      </Card>

      {justConverted && (
        <Card className="mt-4 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          고객관리로 전환되었습니다.{" "}
          <Link href="/clients" className="font-semibold underline">
            고객관리에서 확인하기
          </Link>
        </Card>
      )}
    </>
  );
}
