"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useStore, type InstallmentDraft } from "@/lib/store";
import type { CaseRecord, Client, InstallmentStatus, StaffName } from "@/lib/types";
import { PAYMENT_METHOD_NOTE, STAFF_LIST } from "@/lib/types";
import { fmtDate, fmtWon } from "@/lib/format";
import { CaseTypeBadge, StatusBadge } from "@/components/ui/Badge";
import {
  Button,
  Card,
  Input,
  Label,
  Modal,
  NumberInput,
  PageHeader,
  Pagination,
  SearchBox,
  Select,
  pageRows,
} from "@/components/ui/Primitives";
import { ConfirmDelete } from "@/components/ui/ConfirmDelete";
import { Plus, RefreshCw, FileSignature, Trash2, WalletCards } from "lucide-react";

type DraftClient = Pick<Client, "name" | "phone" | "assignedStaff" | "memo">;

const INSTALLMENT_STATUSES: InstallmentStatus[] = ["예정", "완료", "연체", "실패"];

export default function ClientsPage() {
  const { clients, cases, updateClient, deleteClient } = useStore();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftClient>({ name: "", phone: "", assignedStaff: undefined, memo: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [eformOpen, setEformOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<Client | null>(null);

  const rows = useMemo(() => {
    return clients
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
  }, [clients, cases, query]);

  const selected = rows.find((r) => r.client.id === selectedId) ?? null;

  function startEdit(c: Client) {
    setEditingId(c.id);
    setDraft({ name: c.name, phone: c.phone, assignedStaff: c.assignedStaff, memo: c.memo ?? "" });
  }

  function saveEdit(id: string) {
    const name = draft.name.trim();
    const phone = draft.phone.trim();
    updateClient(id, {
      // 이름·연락처는 필수값이라 비워둔 채 저장하면 원래 값을 유지함
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      assignedStaff: draft.assignedStaff,
      memo: draft.memo?.trim() || undefined,
    });
    setEditingId(null);
  }

  function selectRow(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <>
      <PageHeader
        title="고객관리"
        description={`의뢰인 ${clients.length}명 중 ${rows.length}명 표시 — 이름을 클릭하면 하단에서 계약·분납·전자계약서를 바로 관리할 수 있어요.`}
      />

      <Card className="mb-4 p-3">
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
                    <Select
                      value={draft.assignedStaff ?? ""}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, assignedStaff: e.target.value as StaffName }))}
                      className="w-full"
                    >
                      <option value="">미지정</option>
                      {STAFF_LIST.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
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
              <div
                key={client.id}
                onClick={() => selectRow(client.id)}
                className={`cursor-pointer space-y-2 p-4 ${selectedId === client.id ? "bg-blue-50/60" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-bold text-slate-900">{client.name}</div>
                    <a
                      href={`tel:${client.phone}`}
                      onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
                      className="mt-0.5 inline-block text-sm font-semibold text-blue-700"
                    >
                      {client.phone}
                    </a>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {fmtDate(client.registeredAt)} · 담당 {client.assignedStaff ?? "-"}
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
                      <span key={c.id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px]">
                        <CaseTypeBadge caseType={c.caseType} />
                        <StatusBadge status={c.status} />
                      </span>
                    ))}
                  </div>
                )}
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(client);
                  }}
                >
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
                {["등록일", "이름", "연락처", "담당자", "계약현황", "미수금", "메모", ""].map((h) => (
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
                      <td className="px-4 py-3 text-slate-500">{fmtDate(client.registeredAt)}</td>
                      <td className="px-4 py-3">
                        <Input value={draft.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, name: e.target.value }))} className="w-28" />
                      </td>
                      <td className="px-4 py-3">
                        <Input value={draft.phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, phone: e.target.value }))} className="w-32" />
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={draft.assignedStaff ?? ""}
                          onChange={(e: ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, assignedStaff: e.target.value as StaffName }))}
                          className="w-24"
                        >
                          <option value="">미지정</option>
                          {STAFF_LIST.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
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
                  <tr
                    key={client.id}
                    onClick={() => selectRow(client.id)}
                    className={`cursor-pointer border-t transition-colors ${
                      selectedId === client.id ? "border-blue-100 bg-blue-50/70" : "border-slate-100 hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-4 py-3 text-slate-500">{fmtDate(client.registeredAt)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{client.name}</td>
                    <td className="px-4 py-3 text-slate-500">{client.phone}</td>
                    <td className="px-4 py-3 text-slate-500">{client.assignedStaff ?? "-"}</td>
                    <td className="px-4 py-3">
                      {clientCases.length === 0 ? (
                        <span className="text-slate-300">없음</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {clientCases.map((c) => (
                            <span key={c.id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px]">
                              <CaseTypeBadge caseType={c.caseType} />
                              <StatusBadge status={c.status} />
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {receivable > 0 ? <span className="font-semibold text-red-600">{fmtWon(receivable)}</span> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-slate-500">{client.memo ?? "-"}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(client);
                        }}
                      >
                        수정
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                    조건에 맞는 의뢰인이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={rows.length} onChange={setPage} pageSize={10} />
      </Card>

      {selected && (
        <CustomerDetail
          client={selected.client}
          clientCases={selected.cases}
          receivable={selected.receivable}
          onEdit={() => startEdit(selected.client)}
          onInstallments={() => setInstallOpen(true)}
          onEform={() => setEformOpen(true)}
          onDelete={() => setDelTarget(selected.client)}
        />
      )}

      {selected && (
        <InstallmentModal
          key={`ins-${selected.client.id}-${installOpen}`}
          open={installOpen}
          client={selected.client}
          clientCases={selected.cases}
          onClose={() => setInstallOpen(false)}
        />
      )}

      {selected && (
        <EformStubModal
          key={`eform-${selected.client.id}-${eformOpen}`}
          open={eformOpen}
          client={selected.client}
          clientCases={selected.cases}
          onClose={() => setEformOpen(false)}
        />
      )}

      <ConfirmDelete
        open={!!delTarget}
        name={delTarget?.name || "고객"}
        label="고객 정보와 연결된 계약·분납 데이터"
        onClose={() => setDelTarget(null)}
        onConfirm={() => {
          if (delTarget) {
            deleteClient(delTarget.id);
            if (selectedId === delTarget.id) setSelectedId(null);
          }
        }}
      />
    </>
  );
}

function CustomerDetail({
  client,
  clientCases,
  receivable,
  onEdit,
  onInstallments,
  onEform,
  onDelete,
}: {
  client: Client;
  clientCases: CaseRecord[];
  receivable: number;
  onEdit: () => void;
  onInstallments: () => void;
  onEform: () => void;
  onDelete: () => void;
}) {
  const contractTotal = clientCases.reduce((a, c) => a + c.contractAmount, 0);
  const paidTotal = clientCases.reduce((a, c) => a + c.paidAmount, 0);

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 xl:flex-row xl:items-center">
        <div>
          <div className="text-lg font-bold">{client.name} 고객 정보</div>
          <div className="mt-1 text-sm text-slate-500">
            {client.phone} · 담당 {client.assignedStaff ?? "-"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onEdit}>
            고객정보 수정
          </Button>
          <Button disabled={clientCases.length === 0} onClick={onInstallments}>
            <WalletCards size={15} />
            분납관리
          </Button>
          <Button variant="secondary" onClick={onEform}>
            <FileSignature size={15} />
            전자계약서
          </Button>
          <Button variant="danger" onClick={onDelete}>
            <Trash2 size={14} />
            삭제
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {(
          [
            ["등록일", fmtDate(client.registeredAt)],
            ["담당자", client.assignedStaff ?? "-"],
            ["연결된 계약", `${clientCases.length}건`],
            ["계약금액 합계", fmtWon(contractTotal)],
            ["기납부액", fmtWon(paidTotal)],
            ["미수금", fmtWon(receivable)],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-500">{l}</div>
            <div className={`mt-1 font-bold ${l === "미수금" && receivable > 0 ? "text-red-600" : "text-slate-900"}`}>{v}</div>
          </div>
        ))}
      </div>

      {clientCases.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold text-slate-500">연결된 사건 (계약관리로 이동)</div>
          <div className="flex flex-wrap gap-2">
            {clientCases.map((c) => (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50"
              >
                <CaseTypeBadge caseType={c.caseType} />
                <span className="font-semibold text-slate-700">{c.caseNumber}</span>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {client.memo && (
        <div className="mt-4 rounded-xl border border-slate-100 p-4 text-sm">
          <div className="mb-1 text-xs font-semibold text-slate-500">메모</div>
          {client.memo}
        </div>
      )}
    </Card>
  );
}

function InstallmentModal({
  open,
  client,
  clientCases,
  onClose,
}: {
  open: boolean;
  client: Client;
  clientCases: CaseRecord[];
  onClose: () => void;
}) {
  const { installments, setCaseInstallments } = useStore();
  const [caseId, setCaseId] = useState(clientCases[0]?.id ?? "");

  const makeRows = (cid: string): InstallmentDraft[] => {
    const x = installments
      .filter((i) => i.caseId === cid)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map(({ id, dueDate, amount, status, paidDate }) => ({ id, dueDate, amount, status, paidDate }));
    return x.length ? x : [{ dueDate: "", amount: 0, status: "예정" as InstallmentStatus, paidDate: "" }];
  };

  const [rows, setRows] = useState<InstallmentDraft[]>(() => makeRows(caseId));

  useEffect(() => {
    if (open) {
      const first = clientCases[0]?.id ?? "";
      setCaseId(first);
      setRows(makeRows(first));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id]);

  function switchCase(id: string) {
    setCaseId(id);
    setRows(makeRows(id));
  }

  function update(i: number, p: Partial<InstallmentDraft>) {
    setRows((r) => r.map((x, n) => (n === i ? { ...x, ...p } : x)));
  }

  function save() {
    if (!caseId) return;
    setCaseInstallments(caseId, rows.filter((r) => r.dueDate));
    onClose();
  }

  return (
    <Modal open={open} title={`${client.name} · 입금/분납 일정`} onClose={onClose}>
      {clientCases.length > 1 && (
        <div className="mb-4">
          <Label text="대상 계약">
            <Select value={caseId} onChange={(e: ChangeEvent<HTMLSelectElement>) => switchCase(e.target.value)}>
              {clientCases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.caseNumber} · {c.caseType}
                </option>
              ))}
            </Select>
          </Label>
        </div>
      )}
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id || i} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <b className="text-sm">납부 일정 {i + 1}</b>
              {rows.length > 1 && (
                <Button variant="danger" onClick={() => setRows((x) => x.filter((_, n) => n !== i))}>
                  삭제
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Label text="납부 예정일">
                <input
                  type="date"
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm"
                  value={r.dueDate}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => update(i, { dueDate: e.target.value })}
                />
              </Label>
              <Label text="금액">
                <NumberInput value={r.amount} onChange={(v) => update(i, { amount: v })} />
              </Label>
              <Label text="실제 입금일">
                <input
                  type="date"
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm"
                  value={r.paidDate ?? ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => update(i, { paidDate: e.target.value })}
                />
              </Label>
              <Label text="상태">
                <Select value={r.status} onChange={(e: ChangeEvent<HTMLSelectElement>) => update(i, { status: e.target.value as InstallmentStatus })}>
                  {INSTALLMENT_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Label>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={() => setRows((x) => [...x, { dueDate: "", amount: 0, status: "예정", paidDate: "" }])}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-blue-300 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
      >
        <Plus size={15} />
        납부 일정 추가
      </button>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          취소
        </Button>
        <Button onClick={save}>일정 저장</Button>
      </div>
    </Modal>
  );
}

function EformStubModal({
  open,
  client,
  clientCases,
  onClose,
}: {
  open: boolean;
  client: Client;
  clientCases: CaseRecord[];
  onClose: () => void;
}) {
  const [phone, setPhone] = useState(client.phone);
  const [message, setMessage] = useState("계약서 확인 후 서명 부탁드립니다.");
  const c = clientCases[0];

  useEffect(() => {
    if (open) setPhone(client.phone);
  }, [open, client.phone]);

  return (
    <Modal open={open} title={`${client.name} · 전자계약서 전송`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
          <b>{client.name}</b> 고객의 계약정보를 템플릿에 자동 입력해 서명 요청을 전송합니다.
          <div className="mt-1 text-xs text-blue-600">※ 전자서명 API 연동 전 화면 미리보기입니다 — 전송 버튼은 실제로 발송되지 않습니다.</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label text="고객명">
            <Input value={client.name} readOnly />
          </Label>
          <Label text="계약일">
            <Input value={c?.contractDate ?? "-"} readOnly />
          </Label>
          <Label text="전화번호(SMS)">
            <Input value={phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} />
          </Label>
          <Label text="사건유형">
            <Input value={c?.caseType ?? "-"} readOnly />
          </Label>
          <Label text="계약금액">
            <Input value={c ? fmtWon(c.contractAmount) : "-"} readOnly />
          </Label>
          <Label text="결제수단">
            <Input value={c ? PAYMENT_METHOD_NOTE[c.paymentMethod] : "-"} readOnly />
          </Label>
        </div>
        <Label text="전송 메시지">
          <Input value={message} onChange={(e: ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)} />
        </Label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => alert("전자계약서 전송 기능은 API 연동 후 제공됩니다.")}>
            <RefreshCw size={15} />
            계약서 전송
          </Button>
        </div>
      </div>
    </Modal>
  );
}
