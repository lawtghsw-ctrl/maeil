"use client";

import { useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { leadContactLabel } from "@/lib/mock-data";
import {
  DB_LEAD_STATUSES,
  MAX_RECALL_TOTAL,
  type DbLeadStatus,
  type TimeSlot,
} from "@/lib/types";
import { DbLeadStatusBadge, TimeSlotChip } from "@/components/ui/Badge";
import { fmtDate } from "@/lib/format";

const TIME_SLOTS: TimeSlot[] = ["평오전", "평점심", "평오후", "퇴근후", "주말오전", "주말오후"];

export default function DbManagementPage() {
  const { leads, updateLead, convertLeadToClient } = useStore();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DbLeadStatus | "전체">("전체");
  const [slotFilter, setSlotFilter] = useState<TimeSlot | "전체">("전체");
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
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">DB관리</h1>
        <p className="mt-0.5 text-sm text-muted">
          광고 등으로 접수된 상담 신청 {leads.length}건 · 문자인사 전 신규 {newTodayCount}건 — 기초정보를
          메모하고 상태를 정리한 뒤 &apos;고객 전환&apos;으로 고객관리에 등록하세요.
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
          <select
            value={statusFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setStatusFilter(e.target.value as DbLeadStatus | "전체")
            }
            className="rounded-sm2 border border-line bg-white px-2.5 py-1.5 text-xs text-ink"
          >
            <option value="전체">상태 전체</option>
            {DB_LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="mx-1 w-px bg-line" />
          <button
            onClick={() => setSlotFilter("전체")}
            className={`rounded-sm2 px-2.5 py-1 text-xs font-medium ${
              slotFilter === "전체" ? "bg-navy text-white" : "bg-line text-muted"
            }`}
          >
            시간대 전체
          </button>
          {TIME_SLOTS.map((s) => (
            <button
              key={s}
              onClick={() => setSlotFilter(s)}
              className={`rounded-sm2 p-0.5 ${slotFilter === s ? "ring-2 ring-navy" : ""}`}
            >
              <TimeSlotChip slot={s} />
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">접수일</th>
              <th className="py-2 pr-3 font-medium">시간대</th>
              <th className="py-2 pr-3 font-medium">이름(저장형식)</th>
              <th className="py-2 pr-3 font-medium">연락처</th>
              <th className="py-2 pr-3 font-medium">담당자</th>
              <th className="py-2 pr-3 font-medium">재콜</th>
              <th className="py-2 pr-3 font-medium">상태</th>
              <th className="py-2 pr-3 font-medium">메모</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => {
              const nearLimit = lead.callAttempts >= MAX_RECALL_TOTAL - 1 && !lead.convertedClientId;
              return (
                <tr key={lead.id} className="border-b border-line align-top last:border-0">
                  <td className="py-2.5 pr-3 whitespace-nowrap text-muted">{fmtDate(lead.receivedAt)}</td>
                  <td className="py-2.5 pr-3">
                    <TimeSlotChip slot={lead.timeSlot} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-ink">{leadContactLabel(lead)}</div>
                    {lead.caseTypeGuess && (
                      <div className="text-[11px] text-muted2">추정유형 {lead.caseTypeGuess}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-muted">{lead.phone}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-muted">{lead.assignedStaff}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    <span className={nearLimit ? "font-semibold text-danger" : "text-muted"}>
                      {lead.callAttempts}/{MAX_RECALL_TOTAL}회
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <select
                      value={lead.status}
                      disabled={!!lead.convertedClientId}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        updateLead(lead.id, { status: e.target.value as DbLeadStatus })
                      }
                      className="rounded-sm2 border border-line bg-white px-2 py-1 text-xs text-ink disabled:opacity-60"
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
                  <td className="py-2.5 pr-3 min-w-[220px]">
                    <input
                      defaultValue={lead.memo ?? ""}
                      placeholder="기초정보 메모 (부채원인, 특이사항 등)"
                      onBlur={(e: FocusEvent<HTMLInputElement>) => updateLead(lead.id, { memo: e.target.value })}
                      className="w-full rounded-sm2 border border-line px-2 py-1 text-xs outline-none focus:border-brand"
                    />
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {lead.convertedClientId ? (
                      <Link
                        href="/clients"
                        className="rounded-md2 bg-success-tint px-2.5 py-1 text-xs font-medium text-success"
                      >
                        고객관리로 이동
                      </Link>
                    ) : (
                      <button
                        onClick={() => {
                          convertLeadToClient(lead.id);
                          setJustConverted(lead.id);
                        }}
                        className="rounded-md2 bg-navy px-2.5 py-1 text-xs font-medium text-white"
                      >
                        고객 전환
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted">
                  조건에 맞는 DB가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {justConverted && (
        <div className="card bg-success-tint px-4 py-3 text-sm text-success">
          고객관리로 전환되었습니다.{" "}
          <Link href="/clients" className="font-semibold underline">
            고객관리에서 확인하기
          </Link>
        </div>
      )}
    </div>
  );
}
