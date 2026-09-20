"use client";

import { useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import {
  DB_LEAD_STATUS_LABEL,
  DB_LEAD_STATUSES,
  STAFF_LIST,
  type CaseType,
  type DbLeadStatus,
  type StaffName,
} from "@/lib/types";
import { Button, Card, PageHeader, Pagination, SearchBox, pageRows } from "@/components/ui/Primitives";
import { fmtDate } from "@/lib/format";

const APPLICATION_TYPES: CaseType[] = ["개인회생", "개인파산"];

export default function DbManagementPage() {
  const { leads, updateLead, convertLeadToClient } = useStore();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DbLeadStatus | "전체">("전체");
  const [page, setPage] = useState(1);
  const [justConverted, setJustConverted] = useState<string | null>(null);

  const rows = useMemo(() => {
    return leads
      .filter((l) => statusFilter === "전체" || l.status === statusFilter)
      .filter((l) => {
        if (!query.trim()) return true;
        return l.name.includes(query) || l.phone.includes(query);
      })
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [leads, statusFilter, query]);

  const newTodayCount = leads.filter((l) => l.status === "신규접수").length;

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
              {DB_LEAD_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 DB가 없습니다.</div>}
          {pageRows(rows, page, 10).map((lead) => (
            <div key={lead.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-base font-bold text-slate-900">{lead.name}</span>
                  <a href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`} className="mt-1 inline-block text-sm font-semibold text-blue-700">
                    {lead.phone}
                  </a>
                  <div className="mt-1 text-[11px] text-slate-400">{fmtDate(lead.receivedAt)}</div>
                </div>
              </div>
              <select
                value={lead.applicationType ?? ""}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  updateLead(lead.id, { applicationType: (e.target.value || undefined) as CaseType | undefined })
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                <option value="">신청분류 미지정</option>
                {APPLICATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={lead.assignedStaff}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { assignedStaff: e.target.value as StaffName })}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                {STAFF_LIST.map((s) => (
                  <option key={s} value={s}>
                    담당 {s}
                  </option>
                ))}
              </select>
              <select
                value={lead.status}
                disabled={!!lead.convertedClientId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { status: e.target.value as DbLeadStatus })}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:opacity-60"
              >
                {DB_LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DB_LEAD_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <input
                defaultValue={lead.memo ?? ""}
                placeholder="기초정보 메모 (부채원인, 특이사항 등)"
                onBlur={(e: FocusEvent<HTMLInputElement>) => updateLead(lead.id, { memo: e.target.value })}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
              />
              <div className="flex items-center justify-end">
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
          <table className="admin-responsive-table w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["접수일", "이름", "연락처", "신청분류", "담당자", "상태", "메모", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, 10).map((lead) => (
                <tr key={lead.id} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(lead.receivedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{lead.name}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{lead.phone}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <select
                      value={lead.applicationType ?? ""}
                      disabled={!!lead.convertedClientId}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        updateLead(lead.id, { applicationType: (e.target.value || undefined) as CaseType | undefined })
                      }
                      className="min-w-[100px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                    >
                      <option value="">미지정</option>
                      {APPLICATION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <select
                      value={lead.assignedStaff}
                      disabled={!!lead.convertedClientId}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => updateLead(lead.id, { assignedStaff: e.target.value as StaffName })}
                      className="min-w-[90px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                    >
                      {STAFF_LIST.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
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
                          {DB_LEAD_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
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
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
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
