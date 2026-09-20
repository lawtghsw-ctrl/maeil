"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import type { Client, LeadSource } from "@/lib/types";
import { fmtDate, fmtWon } from "@/lib/format";
import { CaseTypeBadge, StatusBadge } from "@/components/ui/Badge";
import { Button, Card, Input, Label, PageHeader, Pagination, SearchBox, pageRows } from "@/components/ui/Primitives";

const SOURCE_FILTERS: Array<LeadSource | "전체"> = ["전체", "메타광고", "커뮤니티", "지인소개", "네이버검색", "재상담"];

type DraftClient = Pick<Client, "name" | "phone" | "email" | "assignedStaff" | "memo">;

export default function ClientsPage() {
  const { clients, cases, updateClient } = useStore();
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "전체">("전체");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftClient>({ name: "", phone: "", email: "", assignedStaff: "", memo: "" });

  const rows = useMemo(() => {
    return clients
      .filter((cl) => sourceFilter === "전체" || cl.source === sourceFilter)
      .filter((cl) => {
        if (!query.trim()) return true;
        return cl.name.includes(query) || cl.phone.includes(query);
      })
      .map((cl) => {
        const clientCases = cases.filter((c) => c.clientId === cl.id);
        const receivable = clientCases.reduce((a, c) => a + Math.max(0, c.contractAmount - c.paidAmount), 0);
        return { client: cl, cases: clientCases, receivable };
      })
      .sort((a, b) => (a.client.registeredAt < b.client.registeredAt ? 1 : -1));
  }, [clients, cases, query, sourceFilter]);

  function startEdit(c: Client) {
    setEditingId(c.id);
    setDraft({ name: c.name, phone: c.phone, email: c.email ?? "", assignedStaff: c.assignedStaff ?? "", memo: c.memo ?? "" });
  }

  function saveEdit(id: string) {
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    updateClient(id, {
      // 이름·연락처는 필수값이라 비워둔 채 저장하면 원래 값을 유지함
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      email: draft.email?.trim() || undefined,
      assignedStaff: draft.assignedStaff?.trim() || undefined,
      memo: draft.memo?.trim() || undefined,
    });
    setEditingId(null);
  }

  return (
    <>
      <PageHeader
        title="고객관리"
        description={`의뢰인 ${clients.length}명 중 ${rows.length}명 표시 — '수정'을 눌러 정보를 바로 고칠 수 있어요.`}
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
          {SOURCE_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSourceFilter(s);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${sourceFilter === s ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 의뢰인이 없습니다.</div>}
          {pageRows(rows, page, 10).map(({ client, cases: clientCases, receivable }) => {
            const isEditing = editingId === client.id;
            if (isEditing) {
              return (
                <div key={client.id} className="space-y-2 bg-blue-50/40 p-4">
                  <Label text="이름">
                    <Input value={draft.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                  </Label>
                  <Label text="연락처">
                    <Input value={draft.phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
                  </Label>
                  <Label text="담당자">
                    <Input
                      value={draft.assignedStaff ?? ""}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, assignedStaff: e.target.value }))}
                    />
                  </Label>
                  <Label text="메모">
                    <Input value={draft.memo ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, memo: e.target.value }))} />
                  </Label>
                  <div className="flex gap-2 pt-1">
                    <Button className="flex-1" onClick={() => saveEdit(client.id)}>
                      저장
                    </Button>
                    <Button variant="secondary" className="flex-1" onClick={() => setEditingId(null)}>
                      취소
                    </Button>
                  </div>
                </div>
              );
            }
            return (
              <div key={client.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-bold text-slate-900">{client.name}</div>
                    <a href={`tel:${client.phone}`} className="mt-0.5 inline-block text-sm font-semibold text-blue-700">
                      {client.phone}
                    </a>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {fmtDate(client.registeredAt)} · {client.source} · 담당 {client.assignedStaff ?? "-"}
                    </div>
                  </div>
                  {receivable > 0 ? (
                    <span className="shrink-0 text-sm font-semibold text-red-600">{fmtWon(receivable)}</span>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-400">미수금 없음</span>
                  )}
                </div>
                {clientCases.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {clientCases.map((c) => (
                      <Link key={c.id} href={`/cases/${c.id}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px]">
                        <CaseTypeBadge caseType={c.caseType} />
                        <StatusBadge status={c.status} />
                      </Link>
                    ))}
                  </div>
                )}
                <Button variant="secondary" className="w-full" onClick={() => startEdit(client)}>
                  수정
                </Button>
              </div>
            );
          })}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["이름", "연락처", "이메일", "유입경로", "등록일", "담당자", "사건", "미수금", "메모", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, 10).map(({ client, cases: clientCases, receivable }) => {
                const isEditing = editingId === client.id;
                if (isEditing) {
                  return (
                    <tr key={client.id} className="border-t border-slate-100 bg-blue-50/40 align-top">
                      <td className="px-4 py-3">
                        <Input value={draft.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, name: e.target.value }))} className="w-28" />
                      </td>
                      <td className="px-4 py-3">
                        <Input value={draft.phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, phone: e.target.value }))} className="w-32" />
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          value={draft.email ?? ""}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, email: e.target.value }))}
                          className="w-36"
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{client.source}</td>
                      <td className="px-4 py-3 text-slate-500">{fmtDate(client.registeredAt)}</td>
                      <td className="px-4 py-3">
                        <Input
                          value={draft.assignedStaff ?? ""}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, assignedStaff: e.target.value }))}
                          className="w-20"
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{clientCases.length}건</td>
                      <td className="px-4 py-3 text-slate-500">{receivable > 0 ? fmtWon(receivable) : "-"}</td>
                      <td className="px-4 py-3">
                        <Input value={draft.memo ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, memo: e.target.value }))} className="w-40" />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button className="mr-1 px-2.5 py-1.5" onClick={() => saveEdit(client.id)}>
                          저장
                        </Button>
                        <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setEditingId(null)}>
                          취소
                        </Button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={client.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{client.name}</td>
                    <td className="px-4 py-3 text-slate-500">{client.phone}</td>
                    <td className="px-4 py-3 text-slate-500">{client.email ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{client.source}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(client.registeredAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{client.assignedStaff ?? "-"}</td>
                    <td className="px-4 py-3">
                      {clientCases.length === 0 ? (
                        <span className="text-slate-300">없음</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {clientCases.map((c) => (
                            <Link key={c.id} href={`/cases/${c.id}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] hover:bg-white">
                              <CaseTypeBadge caseType={c.caseType} />
                              <StatusBadge status={c.status} />
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {receivable > 0 ? <span className="font-semibold text-red-600">{fmtWon(receivable)}</span> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-slate-500">{client.memo ?? "-"}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => startEdit(client)}>
                        수정
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                    조건에 맞는 의뢰인이 없습니다.
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
