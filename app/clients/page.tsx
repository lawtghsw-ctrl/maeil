"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import type { Client, LeadSource } from "@/lib/types";
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

type DraftClient = Pick<Client, "name" | "phone" | "email" | "assignedStaff" | "memo">;

export default function ClientsPage() {
  const { clients, cases, updateClient } = useStore();
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "전체">("전체");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftClient>({
    name: "",
    phone: "",
    email: "",
    assignedStaff: "",
    memo: "",
  });

  const rows = useMemo(() => {
    return clients
      .filter((cl) => sourceFilter === "전체" || cl.source === sourceFilter)
      .filter((cl) => {
        if (!query.trim()) return true;
        return cl.name.includes(query) || cl.phone.includes(query);
      })
      .map((cl) => {
        const clientCases = cases.filter((c) => c.clientId === cl.id);
        const receivable = clientCases.reduce(
          (a, c) => a + Math.max(0, c.contractAmount - c.paidAmount),
          0
        );
        return { client: cl, cases: clientCases, receivable };
      })
      .sort((a, b) => (a.client.registeredAt < b.client.registeredAt ? 1 : -1));
  }, [clients, cases, query, sourceFilter]);

  function startEdit(c: Client) {
    setEditingId(c.id);
    setDraft({
      name: c.name,
      phone: c.phone,
      email: c.email ?? "",
      assignedStaff: c.assignedStaff ?? "",
      memo: c.memo ?? "",
    });
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
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">고객관리</h1>
        <p className="mt-0.5 text-sm text-muted">
          의뢰인 {clients.length}명 중 {rows.length}명 표시 — 정보 옆 &apos;수정&apos;으로 바로 고칠 수
          있어요.
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

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2.5 pl-4 pr-3 font-medium">이름</th>
              <th className="py-2.5 pr-3 font-medium">연락처</th>
              <th className="py-2.5 pr-3 font-medium">이메일</th>
              <th className="py-2.5 pr-3 font-medium">유입경로</th>
              <th className="py-2.5 pr-3 font-medium">등록일</th>
              <th className="py-2.5 pr-3 font-medium">담당자</th>
              <th className="py-2.5 pr-3 font-medium">사건</th>
              <th className="py-2.5 pr-3 font-medium">미수금</th>
              <th className="py-2.5 pr-3 font-medium">메모</th>
              <th className="py-2.5 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ client, cases: clientCases, receivable }) => {
              const isEditing = editingId === client.id;
              if (isEditing) {
                return (
                  <tr key={client.id} className="border-b border-line bg-brand-pale/40 align-top">
                    <td className="py-2 pl-4 pr-3">
                      <input
                        value={draft.name}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setDraft((d) => ({ ...d, name: e.target.value }))
                        }
                        className="w-28 rounded-sm2 border border-line px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        value={draft.phone}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setDraft((d) => ({ ...d, phone: e.target.value }))
                        }
                        className="w-28 rounded-sm2 border border-line px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        value={draft.email ?? ""}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setDraft((d) => ({ ...d, email: e.target.value }))
                        }
                        className="w-36 rounded-sm2 border border-line px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2 pr-3 text-muted">{client.source}</td>
                    <td className="py-2 pr-3 text-muted">{fmtDate(client.registeredAt)}</td>
                    <td className="py-2 pr-3">
                      <input
                        value={draft.assignedStaff ?? ""}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setDraft((d) => ({ ...d, assignedStaff: e.target.value }))
                        }
                        className="w-20 rounded-sm2 border border-line px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2 pr-3 text-muted">{clientCases.length}건</td>
                    <td className="py-2 pr-3 text-muted">
                      {receivable > 0 ? fmtWon(receivable) : "-"}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        value={draft.memo ?? ""}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setDraft((d) => ({ ...d, memo: e.target.value }))
                        }
                        className="w-40 rounded-sm2 border border-line px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => saveEdit(client.id)}
                        className="mr-1 rounded-md2 bg-navy px-2.5 py-1 text-xs font-medium text-white"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-md2 border border-line px-2.5 py-1 text-xs text-muted"
                      >
                        취소
                      </button>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={client.id} className="border-b border-line last:border-0 hover:bg-bg">
                  <td className="py-2.5 pl-4 pr-3 font-medium text-ink">{client.name}</td>
                  <td className="py-2.5 pr-3 text-muted">{client.phone}</td>
                  <td className="py-2.5 pr-3 text-muted">{client.email ?? "-"}</td>
                  <td className="py-2.5 pr-3">
                    <span className="rounded-sm2 bg-line px-1.5 py-0.5 text-[11px] text-muted">
                      {client.source}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-muted">{fmtDate(client.registeredAt)}</td>
                  <td className="py-2.5 pr-3 text-muted">{client.assignedStaff ?? "-"}</td>
                  <td className="py-2.5 pr-3">
                    {clientCases.length === 0 ? (
                      <span className="text-muted2">없음</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {clientCases.map((c) => (
                          <Link
                            key={c.id}
                            href={`/cases/${c.id}`}
                            className="inline-flex items-center gap-1 rounded-sm2 border border-line px-1.5 py-0.5 text-[11px] hover:bg-white"
                          >
                            <CaseTypeBadge caseType={c.caseType} />
                            <StatusBadge status={c.status} />
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {receivable > 0 ? (
                      <span className="font-medium text-danger">{fmtWon(receivable)}</span>
                    ) : (
                      <span className="text-muted2">-</span>
                    )}
                  </td>
                  <td className="max-w-[180px] truncate py-2.5 pr-3 text-muted">
                    {client.memo ?? "-"}
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    <button
                      onClick={() => startEdit(client)}
                      className="rounded-md2 border border-line px-2.5 py-1 text-xs text-muted hover:text-ink"
                    >
                      수정
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-muted">
                  조건에 맞는 의뢰인이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
