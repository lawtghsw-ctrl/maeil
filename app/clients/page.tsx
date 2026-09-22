"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useStore, type InstallmentDraft } from "@/lib/store";
import type {
  CaseRecord,
  Client,
  ConsultationInfo,
  ConsultDirection,
  InstallmentStatus,
  PaymentMethod,
  StaffName,
} from "@/lib/types";
import { CONSULT_DIRECTIONS, PAYMENT_METHOD_NOTE, STAFF_LIST } from "@/lib/types";
import { DOCUMENT_CHECKLIST_TEMPLATE } from "@/lib/documents";
import { fmtDate, fmtWon } from "@/lib/format";
import { exportConsultationExcel } from "@/lib/excel-export";
import { StatusBadge } from "@/components/ui/Badge";
import { DocumentChecklist } from "@/components/ui/DocumentChecklist";
import { ConsultationModal } from "@/components/ui/consultation/ConsultationModal";
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
import { ClipboardList, FileSignature, Percent, Plus, RefreshCw, Send, Trash2, WalletCards } from "lucide-react";

const INSTALLMENT_STATUSES: InstallmentStatus[] = ["예정", "완료", "연체", "실패"];
const TYPE_FILTERS: Array<ConsultDirection | "전체"> = ["전체", ...CONSULT_DIRECTIONS];
const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_NOTE) as PaymentMethod[];
const CLIENTS_PAGE_SIZE = 5;

function caseStatusText(clientCases: CaseRecord[]): string {
  if (clientCases.length === 0) return "연결된 계약 없음";
  // 계약분류(caseType)와 진행도(status)를 하나로 합치지 않고 "계약분류 | 진행도" 형태로 분리 표기
  return clientCases.map((c) => `${c.caseType} | ${c.status}`).join(", ");
}

function todayIsoStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ClientsPage() {
  const { clients, cases, installments, updateClient, updateCase, deleteClient } = useStore();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ConsultDirection | "전체">("전체");
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<Client | null>(null);
  const [consultTarget, setConsultTarget] = useState<Client | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [eformOpen, setEformOpen] = useState(false);
  const [docGuideOpen, setDocGuideOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<Client | null>(null);

  const rows = useMemo(() => {
    return clients
      .filter((cl) => typeFilter === "전체" || cl.applicationType === typeFilter)
      .filter((cl) => {
        if (!query.trim()) return true;
        return cl.name.includes(query) || cl.phone.includes(query);
      })
      .map((cl) => {
        const clientCases = cases.filter((c) => c.clientId === cl.id);
        const contractTotal = clientCases.reduce((a, c) => a + c.contractAmount, 0);
        const paidTotal = clientCases.reduce((a, c) => a + c.paidAmount, 0);
        const receivable = clientCases.reduce((a, c) => a + Math.max(0, c.contractAmount - c.paidAmount), 0);
        return { client: cl, cases: clientCases, contractTotal, paidTotal, receivable };
      })
      .sort((a, b) => (a.client.registeredAt < b.client.registeredAt ? 1 : -1));
  }, [clients, cases, typeFilter, query]);

  const selected = rows.find((r) => r.client.id === selectedId) ?? null;

  function selectRow(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  const countByType = useMemo(() => {
    const map: Record<string, number> = { 전체: clients.length };
    for (const t of CONSULT_DIRECTIONS) {
      map[t] = clients.filter((c) => c.applicationType === t).length;
    }
    return map;
  }, [clients]);

  // ---- 관리가 필요한 의뢰인 — 미수금은 남아있는데 아직 '예정' 상태의 분납 일정이
  // 하나도 등록되지 않은 계약을 모아 상단에 보여줍니다(도원 사채어드민의
  // '분납/상환일정 미등록' 박스와 동일한 취지). 검색·필터와 무관하게 항상 전체
  // 의뢰인 기준으로 계산해, 필터에 가려져 놓치는 일이 없게 했습니다.
  const attentionClients = useMemo(() => {
    return clients
      .map((cl) => {
        const clientCases = cases.filter((c) => c.clientId === cl.id);
        const receivable = clientCases.reduce((a, c) => a + Math.max(0, c.contractAmount - c.paidAmount), 0);
        const hasScheduled = clientCases.some((c) => installments.some((i) => i.caseId === c.id && i.status === "예정"));
        return { client: cl, receivable, hasCases: clientCases.length > 0, hasScheduled };
      })
      .filter((r) => r.hasCases && r.receivable > 0 && !r.hasScheduled)
      .sort((a, b) => b.receivable - a.receivable);
  }, [clients, cases, installments]);

  return (
    <>
      <PageHeader
        title="고객관리"
        description={`의뢰인 ${clients.length}명 중 ${rows.length}명 표시 — 이름을 클릭하면 하단에서 계약·분납·전자계약서를 바로 관리할 수 있어요.`}
      />

      <Card className="mb-4 overflow-hidden border-red-100">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">관리가 필요한 의뢰인 (미수금 있음 · 분납일정 미등록)</div>
          <span className="text-xs text-slate-400">{attentionClients.length}명</span>
        </div>
        {attentionClients.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">현재 분납일정 등록이 필요한 의뢰인이 없습니다.</div>
        ) : (
          // 게시판처럼 세로로 전부 나열하고 목록이 길면 박스 안에서 세로 스크롤되도록 해서,
          // 뱃지에 표시된 전체 건수와 실제 보이는 목록이 항상 일치하도록 했습니다.
          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {attentionClients.map(({ client, receivable }) => (
              <button
                key={client.id}
                type="button"
                onClick={() => selectRow(client.id)}
                className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-red-50/50 px-4 py-2.5 text-left text-xs transition hover:bg-red-50"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-slate-900">{client.name}</span>
                  <span className="ml-2 text-slate-400">담당 {client.assignedStaff ?? "-"}</span>
                </div>
                <span className="shrink-0 font-semibold text-red-600">미수금 {fmtWon(receivable)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

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
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTypeFilter(t);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                typeFilter === t ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {t}
              <span className={`ml-1 ${typeFilter === t ? "text-blue-100" : "text-slate-400"}`}>({countByType[t] ?? 0})</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 의뢰인이 없습니다.</div>}
          {pageRows(rows, page, CLIENTS_PAGE_SIZE).map(({ client, cases: clientCases, contractTotal, paidTotal, receivable }) => (
            <div
              key={client.id}
              onClick={() => selectRow(client.id)}
              className={`cursor-pointer space-y-2 p-4 ${selectedId === client.id ? "bg-blue-50/60" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-bold text-slate-900">{client.name}</span>
                    {client.applicationType && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
                        {client.applicationType}
                      </span>
                    )}
                  </div>
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
              <div className="text-xs text-slate-500">{caseStatusText(clientCases)}</div>
              <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                <span>계약금액 {contractTotal > 0 ? fmtWon(contractTotal) : "-"}</span>
                <span>결제금액 {paidTotal > 0 ? fmtWon(paidTotal) : "-"}</span>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditTarget(client);
                }}
              >
                상세
              </Button>
            </div>
          ))}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[1040px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["등록일", "이름", "연락처", "담당자", "계약현황", "계약금액", "결제금액", "미수금", "메모", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, CLIENTS_PAGE_SIZE).map(({ client, cases: clientCases, contractTotal, paidTotal, receivable }) => (
                <tr
                  key={client.id}
                  onClick={() => selectRow(client.id)}
                  className={`cursor-pointer border-t transition-colors ${
                    selectedId === client.id ? "border-blue-100 bg-blue-50/70" : "border-slate-100 hover:bg-slate-50"
                  }`}
                >
                  <td className="px-4 py-3 text-slate-500">{fmtDate(client.registeredAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      {client.name}
                      {client.applicationType && (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
                          {client.applicationType}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{client.phone}</td>
                  <td className="px-4 py-3 text-slate-500">{client.assignedStaff ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-500">{caseStatusText(clientCases)}</td>
                  <td className="px-4 py-3 text-slate-900">{contractTotal > 0 ? fmtWon(contractTotal) : "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{paidTotal > 0 ? fmtWon(paidTotal) : "-"}</td>
                  <td className="px-4 py-3">
                    {receivable > 0 ? <span className="font-semibold text-red-600">{fmtWon(receivable)}</span> : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-slate-500">{client.memo ?? "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="secondary"
                      className="px-2.5 py-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditTarget(client);
                      }}
                    >
                      상세
                    </Button>
                  </td>
                </tr>
              ))}
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
        <Pagination page={page} total={rows.length} onChange={setPage} pageSize={CLIENTS_PAGE_SIZE} />
      </Card>

      {selected && (
        <CustomerDetail
          client={selected.client}
          clientCases={selected.cases}
          receivable={selected.receivable}
          onEdit={() => setEditTarget(selected.client)}
          onConsultation={() => setConsultTarget(selected.client)}
          onInstallments={() => setInstallOpen(true)}
          onEform={() => setEformOpen(true)}
          onDocGuide={() => setDocGuideOpen(true)}
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

      {selected && (
        <DocGuideModal
          key={`docguide-${selected.client.id}-${docGuideOpen}`}
          open={docGuideOpen}
          client={selected.client}
          clientCases={selected.cases}
          onClose={() => setDocGuideOpen(false)}
        />
      )}

      {editTarget && (
        <CustomerEditModal
          key={editTarget.id}
          open={!!editTarget}
          client={editTarget}
          primaryCase={cases.find((c) => c.clientId === editTarget.id)}
          onClose={() => setEditTarget(null)}
          onSave={(clientPatch, contractMemo, primaryCaseId, paymentMethod) => {
            // v12: 상담일지(인적사항~상담메모)는 더 이상 이 모달이 다루지 않으므로, patch에
            // consultation 키 자체가 없어 updateClient의 {...c, ...patch} 병합 규칙상 기존
            // client.consultation 값은 그대로 보존됩니다.
            updateClient(editTarget.id, clientPatch);
            if (primaryCaseId) updateCase(primaryCaseId, { memo: contractMemo, ...(paymentMethod ? { paymentMethod } : {}) });
            setEditTarget(null);
          }}
        />
      )}

      {consultTarget && (
        <ClientConsultationModal
          key={consultTarget.id}
          open={!!consultTarget}
          client={consultTarget}
          primaryCase={cases.find((c) => c.clientId === consultTarget.id)}
          onClose={() => setConsultTarget(null)}
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
  onConsultation,
  onInstallments,
  onEform,
  onDocGuide,
  onDelete,
}: {
  client: Client;
  clientCases: CaseRecord[];
  receivable: number;
  onEdit: () => void;
  onConsultation: () => void;
  onInstallments: () => void;
  onEform: () => void;
  onDocGuide: () => void;
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
            {client.phone} · 담당 {client.assignedStaff ?? "-"} {client.applicationType && `· ${client.applicationType}`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onEdit}>
            고객정보 수정
          </Button>
          <Button variant="secondary" onClick={onConsultation}>
            <ClipboardList size={15} />
            상담일지
          </Button>
          <Button disabled={clientCases.length === 0} onClick={onInstallments}>
            <WalletCards size={15} />
            분납관리
          </Button>
          <Button variant="secondary" onClick={onEform}>
            <FileSignature size={15} />
            전자계약서
          </Button>
          <Button variant="secondary" onClick={onDocGuide}>
            <Send size={15} />
            서류안내문 전송
          </Button>
          <Link
            href="/settlement-settings"
            className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Percent size={15} />
            정산요율 설정
          </Link>
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
            ["결제금액", fmtWon(paidTotal)],
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
                <span className="font-semibold text-slate-700">{c.caseType}</span>
                <span className="text-slate-500">{c.caseNumber}</span>
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

// ---- 서류안내문 전송 팝업 — 도원 Admin '카카오톡 공지 생성' 기능을 서류 미제출 독촉용으로 이식 ----
// 실제 카카오톡 알림톡/SMS 발송 API 연동 전이므로, 서류체크리스트 기준 미제출 항목을
// 자동으로 뽑아 메시지 초안을 만들어 보여주고, 전송 버튼은 미리보기 알림으로 대체합니다.
const DOC_GUIDE_CHANNELS = ["카카오톡 알림톡", "SMS"] as const;
type DocGuideChannel = (typeof DOC_GUIDE_CHANNELS)[number];

function buildDocGuideMessage(clientName: string, pendingLabels: string[]): string {
  if (pendingLabels.length === 0) {
    return `[로파워] ${clientName}님, 제출해주신 서류 확인이 모두 완료되었습니다. 협조 감사드립니다.`;
  }
  return [
    `[로파워] ${clientName}님, 원활한 사건 진행을 위해 아래 서류를 준비해 보내주시기 바랍니다.`,
    "",
    ...pendingLabels.map((l, i) => `${i + 1}. ${l}`),
    "",
    "서류 준비에 어려움이 있으시면 담당자에게 편하게 연락 부탁드립니다. 감사합니다.",
  ].join("\n");
}

function DocGuideModal({
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
  const { caseDocuments, updateCase } = useStore();
  const c = clientCases[0];
  const checked = c ? caseDocuments[c.id] ?? {} : {};
  const pending = DOCUMENT_CHECKLIST_TEMPLATE.filter((d) => !checked[d.id]);

  const [channel, setChannel] = useState<DocGuideChannel>("카카오톡 알림톡");
  const [phone, setPhone] = useState(client.phone);
  const [message, setMessage] = useState(() => buildDocGuideMessage(client.name, pending.map((d) => d.label)));

  useEffect(() => {
    if (open) {
      setChannel("카카오톡 알림톡");
      setPhone(client.phone);
      setMessage(buildDocGuideMessage(client.name, pending.map((d) => d.label)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id]);

  function send() {
    if (c) updateCase(c.id, { docsSentAt: todayIsoStr() });
    alert("서류안내문 전송 기능은 카카오톡 알림톡/SMS API 연동 후 실제로 발송됩니다. (지금은 미리보기 화면입니다)");
    onClose();
  }

  return (
    <Modal open={open} title={`${client.name} · 서류안내문 전송`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
          <b>{client.name}</b> 고객에게 미제출 서류 안내문을 발송합니다.
          <div className="mt-1 text-xs text-blue-600">
            ※ 카카오톡 알림톡/SMS API 연동 전 화면 미리보기입니다 — 전송 버튼을 눌러도 실제로 발송되지 않습니다.
          </div>
        </div>

        {!c && (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            연결된 계약이 없어 서류 체크리스트를 불러올 수 없습니다. 계약관리에서 사건을 먼저 등록해주세요.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Label text="발송 채널">
            <Select value={channel} onChange={(e: ChangeEvent<HTMLSelectElement>) => setChannel(e.target.value as DocGuideChannel)} className="w-full">
              {DOC_GUIDE_CHANNELS.map((ch) => (
                <option key={ch}>{ch}</option>
              ))}
            </Select>
          </Label>
          <Label text="수신 연락처">
            <Input value={phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} />
          </Label>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="mb-2 text-xs font-semibold text-slate-500">
            미제출 서류 ({pending.length}/{DOCUMENT_CHECKLIST_TEMPLATE.length})
          </div>
          {pending.length === 0 ? (
            <div className="text-sm font-semibold text-emerald-600">모든 서류가 제출 완료되었습니다.</div>
          ) : (
            <ul className="space-y-1 text-xs text-slate-600">
              {pending.map((d) => (
                <li key={d.id}>· {d.label}</li>
              ))}
            </ul>
          )}
        </div>

        <Label text="발송 메시지">
          <textarea
            className="min-h-40 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:text-sm"
            value={message}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
          />
        </Label>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={send} disabled={!c}>
            <Send size={15} />
            안내문 전송
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- 고객정보 수정 팝업 ----
// v12: 예전에는 이 팝업 안에 인적사항~상담메모까지 상담일지 전 항목이 탭으로 함께 들어
// 있었지만, 상담일지가 별도의 대형 단일 팝업(ConsultationModal, 아래 ClientConsultationModal
// 참고)으로 독립되면서 이 팝업은 원래 목적대로 "고객 레코드 자체"(이름/연락처/담당자/
// 상담후방향/메모, 그리고 연동된 계약의 메모·결제방식)와 서류체크리스트만 다룹니다.
// 상담일지 팝업을 이 팝업 안에 중첩시키지 않고(Section 31의 "팝업 중첩 금지"와 같은
// 취지) 고객상세 화면에서 "상담일지" 버튼으로 별도로 열도록 했습니다(DB관리 화면의
// 상담일지 팝업과 동일한 구조).
type TabKey = "기본정보" | "서류체크리스트";
const TABS: TabKey[] = ["기본정보", "서류체크리스트"];

function CustomerEditModal({
  open,
  client,
  primaryCase,
  onClose,
  onSave,
}: {
  open: boolean;
  client: Client;
  primaryCase?: CaseRecord;
  onClose: () => void;
  onSave: (
    clientPatch: Pick<Client, "name" | "phone" | "assignedStaff" | "memo" | "applicationType">,
    contractMemo: string,
    primaryCaseId: string | undefined,
    paymentMethod: PaymentMethod | undefined
  ) => void;
}) {
  const [tab, setTab] = useState<TabKey>("기본정보");
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(client.phone);
  const [assignedStaff, setAssignedStaff] = useState<StaffName | undefined>(client.assignedStaff);
  const [applicationType, setApplicationType] = useState<ConsultDirection | undefined>(client.applicationType);
  const [memo, setMemo] = useState(client.memo ?? "");
  const [contractMemo, setContractMemo] = useState(primaryCase?.memo ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | undefined>(primaryCase?.paymentMethod);

  useEffect(() => {
    if (!open) return;
    setTab("기본정보");
    setName(client.name);
    setPhone(client.phone);
    setAssignedStaff(client.assignedStaff);
    setApplicationType(client.applicationType);
    setMemo(client.memo ?? "");
    setContractMemo(primaryCase?.memo ?? "");
    setPaymentMethod(primaryCase?.paymentMethod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id]);

  function save() {
    if (!name.trim() || !phone.trim()) return;
    onSave(
      { name: name.trim(), phone: phone.trim(), assignedStaff, memo: memo.trim() || undefined, applicationType },
      contractMemo.trim(),
      primaryCase?.id,
      paymentMethod
    );
  }

  return (
    <Modal open={open} title={`${client.name} 고객정보 수정`} onClose={onClose} size="lg">
      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
              tab === t ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "기본정보" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="이름">
              <Input value={name} onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
            </Label>
            <Label text="연락처">
              <Input value={phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} />
            </Label>
            <Label text="담당자">
              <Select value={assignedStaff ?? ""} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAssignedStaff(e.target.value as StaffName)} className="w-full">
                <option value="">미지정</option>
                {STAFF_LIST.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Label>
            <Label text="상담 후 방향(신청분류)">
              <Select
                value={applicationType ?? ""}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setApplicationType((e.target.value || undefined) as ConsultDirection | undefined)}
                className="w-full"
              >
                <option value="">미지정</option>
                {CONSULT_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Label>
          </div>
          <Label text="고객 메모">
            <Input value={memo} onChange={(e: ChangeEvent<HTMLInputElement>) => setMemo(e.target.value)} />
          </Label>
          <Label text="계약 관련 메모 (계약관리 사건 메모와 연동)">
            <textarea
              className="min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:text-sm"
              placeholder={primaryCase ? "계약 진행 관련 특이사항을 기록하세요." : "연결된 계약이 없어 저장 시 반영되지 않습니다."}
              value={contractMemo}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setContractMemo(e.target.value)}
              disabled={!primaryCase}
            />
          </Label>
          <Label text="결제방식 (정산설정의 담당자×결제수단 요율과 자동 연동)">
            <Select
              value={paymentMethod ?? ""}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setPaymentMethod((e.target.value || undefined) as PaymentMethod | undefined)}
              className="w-full"
              disabled={!primaryCase}
            >
              <option value="">{primaryCase ? "선택" : "연결된 계약이 없어 저장 시 반영되지 않습니다"}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            {primaryCase && (
              <div className="mt-1 text-[11px] text-slate-400">{paymentMethod ? PAYMENT_METHOD_NOTE[paymentMethod] : "결제방식을 선택하면 정산 메뉴에 적용요율이 자동 반영됩니다."}</div>
            )}
          </Label>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400">
            인적사항·소득·자산·채무·상담메모 등 상담일지 내용은 &ldquo;상담일지&rdquo; 버튼에서 별도로 작성/수정합니다.
          </div>
        </div>
      )}

      {tab === "서류체크리스트" &&
        (primaryCase ? (
          <DocumentChecklist caseId={primaryCase.id} docsSentAt={primaryCase.docsSentAt} />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
            연결된 계약이 없어 서류 체크리스트를 사용할 수 없습니다. 계약관리에서 사건을 먼저 등록해주세요.
          </div>
        ))}

      <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onClose}>
          취소
        </Button>
        <Button onClick={save}>저장</Button>
      </div>
    </Modal>
  );
}

// ---- 상담일지 팝업 (고객관리 단계) ----
// DB관리 화면의 LeadConsultationModal과 동일한 얇은 래퍼 패턴 — 공용 ConsultationModal을
// 감싸서 고객관리에만 있는 요소(연결된 계약의 사건번호를 "사건번호"로 표시, "고객 상담
// 엑셀 다운로드" 버튼)만 추가로 연결합니다. 고객관리에는 DB관리의 "상세 단계
// (detailStage)" 개념이 없으므로 showDetailStage는 전달하지 않습니다(기본값 false).
function ClientConsultationModal({
  open,
  client,
  primaryCase,
  onClose,
}: {
  open: boolean;
  client: Client;
  primaryCase?: CaseRecord;
  onClose: () => void;
}) {
  const { updateClient } = useStore();
  const [applicationType, setApplicationType] = useState<ConsultDirection | undefined>(client.applicationType);

  useEffect(() => {
    if (!open) return;
    setApplicationType(client.applicationType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id]);

  return (
    <ConsultationModal
      open={open}
      resetKey={client.id}
      onClose={onClose}
      displayName={client.name}
      displayPhone={client.phone}
      joinedAtLabel={fmtDate(client.registeredAt)}
      caseNumberLabel={primaryCase?.caseNumber ?? "- (연결된 계약 없음)"}
      applicationType={applicationType}
      onApplicationTypeChange={setApplicationType}
      initialConsultation={client.consultation}
      onSave={(consultation) => {
        updateClient(client.id, { applicationType, consultation });
      }}
      onExportExcel={(draft: ConsultationInfo) =>
        exportConsultationExcel({
          clientName: client.name,
          phone: client.phone,
          registeredAt: client.registeredAt,
          assignedStaff: client.assignedStaff,
          applicationType,
          personal: draft.personal ?? {},
          income: draft.income ?? {},
          assets: draft.assets ?? [],
          debts: draft.debts ?? [],
          plan: draft.plan ?? { householdSize: 1, minLivingCost: 0, otherDeduction: 0, repaymentMonths: 36 },
          memoLog: draft.memoLog,
          contractMemo: primaryCase?.memo,
        })
      }
    />
  );
}
