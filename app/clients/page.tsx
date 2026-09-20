"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useStore, type InstallmentDraft } from "@/lib/store";
import type {
  AssetRow,
  CaseRecord,
  CaseType,
  Client,
  ConsultationInfo,
  DebtRow,
  Gender,
  InstallmentStatus,
  OccupationType,
  PaymentMethod,
  RepaymentPlanInput,
  StaffName,
} from "@/lib/types";
import { PAYMENT_METHOD_NOTE, STAFF_LIST } from "@/lib/types";
import { DOCUMENT_CHECKLIST_TEMPLATE } from "@/lib/documents";
import { fmtDate, fmtWon } from "@/lib/format";
import { computeRepaymentPlan, emptyAssetRows, emptyDebtRows, emptyPlanInput, lookupMinLivingCost } from "@/lib/consultation";
import { exportConsultationExcel } from "@/lib/excel-export";
import { StatusBadge } from "@/components/ui/Badge";
import { DocumentChecklist } from "@/components/ui/DocumentChecklist";
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
import { Download, FileSignature, Percent, Plus, RefreshCw, Send, Trash2, WalletCards } from "lucide-react";

const INSTALLMENT_STATUSES: InstallmentStatus[] = ["예정", "완료", "연체", "실패"];
const TYPE_FILTERS: Array<CaseType | "전체"> = ["전체", "개인회생", "개인파산"];
const OCCUPATION_TYPES: OccupationType[] = ["사업자", "직장인", "프리랜서", "무직", "기타"];
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
  const { clients, cases, updateClient, updateCase, deleteClient } = useStore();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<CaseType | "전체">("전체");
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<Client | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [eformOpen, setEformOpen] = useState(false);
  const [docGuideOpen, setDocGuideOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
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
        const receivable = clientCases.reduce((a, c) => a + Math.max(0, c.contractAmount - c.paidAmount), 0);
        return { client: cl, cases: clientCases, contractTotal, receivable };
      })
      .sort((a, b) => (a.client.registeredAt < b.client.registeredAt ? 1 : -1));
  }, [clients, cases, typeFilter, query]);

  const selected = rows.find((r) => r.client.id === selectedId) ?? null;

  function selectRow(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  const countByType = useMemo(() => {
    const map: Record<string, number> = { 전체: clients.length };
    for (const t of ["개인회생", "개인파산"] as CaseType[]) {
      map[t] = clients.filter((c) => c.applicationType === t).length;
    }
    return map;
  }, [clients]);

  return (
    <>
      <PageHeader
        title="고객관리"
        description={`의뢰인 ${clients.length}명 중 ${rows.length}명 표시 — 이름을 클릭하면 하단에서 계약·분납·전자계약서를 바로 관리할 수 있어요.`}
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
          {pageRows(rows, page, CLIENTS_PAGE_SIZE).map(({ client, cases: clientCases, contractTotal, receivable }) => (
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
              <div className="text-xs text-slate-500">계약금액 {contractTotal > 0 ? fmtWon(contractTotal) : "-"}</div>
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
          <table className="admin-responsive-table w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["등록일", "이름", "연락처", "담당자", "계약현황", "계약금액", "미수금", "메모", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, CLIENTS_PAGE_SIZE).map(({ client, cases: clientCases, contractTotal, receivable }) => (
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
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
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
          onInstallments={() => setInstallOpen(true)}
          onEform={() => setEformOpen(true)}
          onDocGuide={() => setDocGuideOpen(true)}
          onSettlement={() => setSettlementOpen(true)}
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

      {selected && (
        <SettlementRateModal
          key={`settlement-${selected.client.id}-${settlementOpen}`}
          open={settlementOpen}
          client={selected.client}
          clientCases={selected.cases}
          onClose={() => setSettlementOpen(false)}
        />
      )}

      {editTarget && (
        <CustomerEditModal
          key={editTarget.id}
          open={!!editTarget}
          client={editTarget}
          primaryCase={cases.find((c) => c.clientId === editTarget.id)}
          onClose={() => setEditTarget(null)}
          onSave={(clientPatch, consultation, contractMemo, primaryCaseId) => {
            updateClient(editTarget.id, { ...clientPatch, consultation });
            if (primaryCaseId) updateCase(primaryCaseId, { memo: contractMemo });
            setEditTarget(null);
          }}
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
  onDocGuide,
  onSettlement,
  onDelete,
}: {
  client: Client;
  clientCases: CaseRecord[];
  receivable: number;
  onEdit: () => void;
  onInstallments: () => void;
  onEform: () => void;
  onDocGuide: () => void;
  onSettlement: () => void;
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
          <Button variant="secondary" onClick={onSettlement}>
            <Percent size={15} />
            정산 설정
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

// ---- 정산 설정 팝업 — 결제수단(단순분납/로피분납/신카할부완납/캐피탈분납)별로 정산금이
// 달라지고, 같은 결제수단이라도 담당자별로 다른 정산요율을 설정할 수 있도록 함 ----
function SettlementRateModal({
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
  const { settlementRates, updateSettlementRate } = useStore();
  const c = clientCases[0];
  const rate = c ? settlementRates[c.assignedStaff as StaffName]?.[c.paymentMethod] ?? 0 : 0;
  const expectedSettlement = c ? Math.round((c.contractAmount * rate) / 100) : 0;

  return (
    <Modal open={open} title="정산요율 설정 (담당자 × 결제수단)" onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="rounded-xl bg-blue-50 p-4 text-xs text-blue-700">
          단순분납 / 로피분납 / 신카할부완납 / 캐피탈분납 결제수단에 따라 실제 정산금이 달라지고, 같은 결제수단이라도
          담당자별로 다른 요율을 적용할 수 있습니다. 로펌 관리자가 아래에서 담당자별 · 결제수단별 정산요율(%)을 설정하면
          정산 메뉴 및 예상 정산금 계산에 즉시 반영됩니다.
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">담당자</th>
                {PAYMENT_METHODS.map((m) => (
                  <th key={m} className="px-3 py-2 font-medium">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STAFF_LIST.map((staff) => (
                <tr key={staff} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-slate-700">{staff}</td>
                  {PAYMENT_METHODS.map((m) => (
                    <td key={m} className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <NumberInput
                          className="w-20"
                          value={settlementRates[staff]?.[m] ?? 0}
                          onChange={(v) => updateSettlementRate(staff, m, v)}
                        />
                        <span className="text-slate-400">%</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {c ? (
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-500">
              {client.name} 고객 예상 정산금 · 결제수단 {c.paymentMethod} · 담당 {c.assignedStaff}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-lg font-bold text-slate-900">{fmtWon(expectedSettlement)}</span>
              <span className="text-xs text-slate-400">
                = 계약금액 {fmtWon(c.contractAmount)} × 적용요율 {rate}%
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            연결된 계약이 없어 예상 정산금을 계산할 수 없습니다.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>닫기</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- 고객정보 수정 팝업 — 상담일지(개인회생·개인파산 상담일지) 전 항목을 탭으로 분류 ----
// 도원 Admin의 '수정 팝업 + 메모/체크리스트' 상호작용 패턴을 이식하되, 내용은 고객이
// 전달한 상담일지 엑셀 서식(인적사항/소득현황/재산현황/채무현황/변제계획/상담메모)을
// 그대로 반영해 상담 중 빠뜨리기 쉬운 항목이 없도록 구성했습니다.
type TabKey = "기본정보" | "인적사항" | "소득현황" | "재산현황" | "채무현황" | "변제계획" | "상담메모" | "서류체크리스트";
const TABS: TabKey[] = ["기본정보", "인적사항", "소득현황", "재산현황", "채무현황", "변제계획", "상담메모", "서류체크리스트"];

const dateInputClass =
  "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm";
const textareaClass =
  "min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:text-sm";

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
    consultation: ConsultationInfo,
    contractMemo: string,
    primaryCaseId?: string
  ) => void;
}) {
  const { minLivingCostTable } = useStore();
  const [tab, setTab] = useState<TabKey>("기본정보");
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(client.phone);
  const [assignedStaff, setAssignedStaff] = useState<StaffName | undefined>(client.assignedStaff);
  const [applicationType, setApplicationType] = useState<CaseType | undefined>(client.applicationType);
  const [memo, setMemo] = useState(client.memo ?? "");
  const [contractMemo, setContractMemo] = useState(primaryCase?.memo ?? "");

  const [personal, setPersonal] = useState(client.consultation?.personal ?? {});
  const [income, setIncome] = useState(client.consultation?.income ?? {});
  const [assets, setAssets] = useState<AssetRow[]>(client.consultation?.assets ?? emptyAssetRows());
  const [debts, setDebts] = useState<DebtRow[]>(client.consultation?.debts ?? emptyDebtRows());
  const [plan, setPlan] = useState<RepaymentPlanInput>(client.consultation?.plan ?? emptyPlanInput());
  const [consultMemo, setConsultMemo] = useState(client.consultation?.memo ?? "");

  useEffect(() => {
    if (!open) return;
    setTab("기본정보");
    setName(client.name);
    setPhone(client.phone);
    setAssignedStaff(client.assignedStaff);
    setApplicationType(client.applicationType);
    setMemo(client.memo ?? "");
    setContractMemo(primaryCase?.memo ?? "");
    setPersonal(client.consultation?.personal ?? {});
    setIncome(client.consultation?.income ?? {});
    setAssets(client.consultation?.assets ?? emptyAssetRows());
    setDebts(client.consultation?.debts ?? emptyDebtRows());
    setPlan(client.consultation?.plan ?? emptyPlanInput());
    setConsultMemo(client.consultation?.memo ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id]);

  const result = useMemo(
    () => computeRepaymentPlan(income.monthlyAvgIncome ?? 0, income.secondaryIncome ?? 0, income.pensionIncome ?? 0, assets, debts, plan),
    [income, assets, debts, plan]
  );

  function updateAsset(i: number, patch: Partial<AssetRow>) {
    setAssets((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }
  function updateDebt(i: number, patch: Partial<DebtRow>) {
    setDebts((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }

  function save() {
    if (!name.trim() || !phone.trim()) return;
    onSave(
      { name: name.trim(), phone: phone.trim(), assignedStaff, memo: memo.trim() || undefined, applicationType },
      { personal, income, assets, debts, plan, memo: consultMemo.trim() || undefined },
      contractMemo.trim(),
      primaryCase?.id
    );
  }

  return (
    <Modal open={open} title={`${client.name} 고객정보 수정`} onClose={onClose} size="xl">
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
            <Label text="신청분류">
              <Select
                value={applicationType ?? ""}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setApplicationType((e.target.value || undefined) as CaseType | undefined)}
                className="w-full"
              >
                <option value="">미지정</option>
                <option value="개인회생">개인회생</option>
                <option value="개인파산">개인파산</option>
              </Select>
            </Label>
          </div>
          <Label text="고객 메모">
            <Input value={memo} onChange={(e: ChangeEvent<HTMLInputElement>) => setMemo(e.target.value)} />
          </Label>
          <Label text="계약 관련 메모 (계약관리 사건 메모와 연동)">
            <textarea
              className={textareaClass}
              placeholder={primaryCase ? "계약 진행 관련 특이사항을 기록하세요." : "연결된 계약이 없어 저장 시 반영되지 않습니다."}
              value={contractMemo}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setContractMemo(e.target.value)}
              disabled={!primaryCase}
            />
          </Label>
        </div>
      )}

      {tab === "인적사항" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="생년월일">
              <input
                type="date"
                className={dateInputClass}
                value={personal.birthDate ?? ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, birthDate: e.target.value }))}
              />
            </Label>
            <Label text="성별">
              <Select value={personal.gender ?? ""} onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonal((p) => ({ ...p, gender: (e.target.value || undefined) as Gender | undefined }))} className="w-full">
                <option value="">선택안함</option>
                <option value="남">남</option>
                <option value="여">여</option>
              </Select>
            </Label>
            <Label text="거주지(초본주소)">
              <Input value={personal.address ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, address: e.target.value }))} />
            </Label>
            <Label text="관할법원">
              <Input value={personal.jurisdictionCourt ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, jurisdictionCourt: e.target.value }))} />
            </Label>
            <Label text="직업">
              <Select
                value={personal.occupationType ?? ""}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonal((p) => ({ ...p, occupationType: (e.target.value || undefined) as OccupationType | undefined }))}
                className="w-full"
              >
                <option value="">선택안함</option>
                {OCCUPATION_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Label>
            <Label text="배우자 유무">
              <Select
                value={personal.spouse === undefined ? "" : personal.spouse ? "예" : "아니오"}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonal((p) => ({ ...p, spouse: e.target.value === "예" ? true : e.target.value === "아니오" ? false : undefined }))}
                className="w-full"
              >
                <option value="">선택안함</option>
                <option value="예">예</option>
                <option value="아니오">아니오</option>
              </Select>
            </Label>
            <Label text="자녀 인원">
              <NumberInput value={personal.childrenCount ?? 0} onChange={(v) => setPersonal((p) => ({ ...p, childrenCount: v }))} />
            </Label>
            <Label text="자녀 나이">
              <Input value={personal.childrenAges ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, childrenAges: e.target.value }))} placeholder="예: 8세, 5세" />
            </Label>
            <Label text="기타 부양가족">
              <Input value={personal.otherDependents ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, otherDependents: e.target.value }))} />
            </Label>
            <Label text="중대질환·장기요양 여부">
              <Select
                value={personal.seriousIllness === undefined ? "" : personal.seriousIllness ? "예" : "아니오"}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonal((p) => ({ ...p, seriousIllness: e.target.value === "예" ? true : e.target.value === "아니오" ? false : undefined }))}
                className="w-full"
              >
                <option value="">선택안함</option>
                <option value="예">예</option>
                <option value="아니오">아니오</option>
              </Select>
            </Label>
          </div>
          <Label text="부양가족 특이사항">
            <Input value={personal.dependentNote ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, dependentNote: e.target.value }))} />
          </Label>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ① 인적사항 체크포인트 — 거주지·관할법원 일치 여부, 부양가족 인원(생계비 산정 직결), 중대질환·장기요양 여부를 빠짐없이 확인하세요.
          </div>
        </div>
      )}

      {tab === "소득현황" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="소득유형">
              <Input value={income.incomeType ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setIncome((v) => ({ ...v, incomeType: e.target.value }))} placeholder="예: 근로소득, 사업소득" />
            </Label>
            <Label text="회사명·사업자명">
              <Input value={income.workplaceName ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setIncome((v) => ({ ...v, workplaceName: e.target.value }))} />
            </Label>
            <Label text="재직기간·사업장정보">
              <Input value={income.tenureInfo ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setIncome((v) => ({ ...v, tenureInfo: e.target.value }))} />
            </Label>
            <Label text="월평균소득(최근 3개월)">
              <NumberInput value={income.monthlyAvgIncome ?? 0} onChange={(v) => setIncome((x) => ({ ...x, monthlyAvgIncome: v }))} />
            </Label>
            <Label text="2중소득(부업)">
              <NumberInput value={income.secondaryIncome ?? 0} onChange={(v) => setIncome((x) => ({ ...x, secondaryIncome: v }))} />
            </Label>
            <Label text="연금소득(국민/노령)">
              <NumberInput value={income.pensionIncome ?? 0} onChange={(v) => setIncome((x) => ({ ...x, pensionIncome: v }))} />
            </Label>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-500">연소득(자동)</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{fmtWon(result.totalIncome)}</div>
          </div>
          <Label text="비고">
            <Input value={income.note ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setIncome((v) => ({ ...v, note: e.target.value }))} />
          </Label>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ② 소득현황 체크포인트 — 최근 3개월 평균으로 산정, 부업·2중소득 누락 여부, 사업소득자는 매출/매입 장부 요청 여부를 확인하세요.
          </div>
        </div>
      )}

      {tab === "재산현황" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  {["구분", "평가액", "담보·대출", "담보·대출 금액", "비고"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map((row, i) => (
                  <tr key={row.category} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-700">{row.category}</td>
                    <td className="px-3 py-2">
                      <NumberInput className="w-32" value={row.value} onChange={(v) => updateAsset(i, { value: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <Select value={row.hasSecurity ? "예" : "아니오"} onChange={(e: ChangeEvent<HTMLSelectElement>) => updateAsset(i, { hasSecurity: e.target.value === "예" })} className="w-24">
                        <option value="아니오">아니오</option>
                        <option value="예">예</option>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput className="w-32" value={row.securityAmount} onChange={(v) => updateAsset(i, { securityAmount: v })} disabled={!row.hasSecurity} />
                    </td>
                    <td className="px-3 py-2">
                      <Input className="w-40" value={row.note ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateAsset(i, { note: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-500">자산합계(자동)</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{fmtWon(result.assetTotal)}</div>
          </div>
          <Label text="소액임차인 최우선변제 참고 메모 (지역별 기준액은 매년 고시되므로 자동조회 대신 담당자가 직접 확인해 기록)">
            <Input
              value={plan.smallLeaseNote ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPlan((p) => ({ ...p, smallLeaseNote: e.target.value }))}
              placeholder="예: 서울 지역 기준 최우선변제 대상 여부 확인 필요"
            />
          </Label>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ③ 재산현황 체크포인트 — 임차보증금 반환채권, 보험 해약환급금, 퇴직금 예상액(1/2 산정 여부), 최근 처분한 재산 유무를 확인하세요.
          </div>
        </div>
      )}

      {tab === "채무현황" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  {["구분", "채권자", "내용", "금액", "비고"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {debts.map((row, i) => (
                  <tr key={row.category} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-700">{row.category}</td>
                    <td className="px-3 py-2">
                      <Input className="w-32" value={row.creditor ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateDebt(i, { creditor: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input className="w-32" value={row.detail ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateDebt(i, { detail: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput className="w-32" value={row.amount} onChange={(v) => updateDebt(i, { amount: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input className="w-40" value={row.note ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateDebt(i, { note: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">채무합계(자동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.debtTotal)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">담보채무합계(자동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.securedDebtTotal)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">신용채무(탕감대상)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.unsecuredDebtTotal)}</div>
            </div>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ④ 채무현황 체크포인트 — 세금·건강보험 체납액(우선변제 50% 한도 별도 확인 필요), 담보채무의 실제 담보가치, 신용채무 총액과 채권자 수를 확인하세요.
          </div>
        </div>
      )}

      {tab === "변제계획" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="가구원수">
              <NumberInput
                min={1}
                value={plan.householdSize}
                onChange={(v) =>
                  setPlan((p) => ({
                    ...p,
                    householdSize: v || 1,
                    minLivingCost: lookupMinLivingCost(v || 1, minLivingCostTable),
                  }))
                }
              />
            </Label>
            <Label text="최저생계비 (최저생계비 계산기 설정값 자동 반영 — 필요 시 수동 수정 가능)">
              <NumberInput value={plan.minLivingCost} onChange={(v) => setPlan((p) => ({ ...p, minLivingCost: v }))} />
            </Label>
            <Label text="기타공제금">
              <NumberInput value={plan.otherDeduction} onChange={(v) => setPlan((p) => ({ ...p, otherDeduction: v }))} />
            </Label>
            <Label text="변제개월수">
              <NumberInput min={1} value={plan.repaymentMonths} onChange={(v) => setPlan((p) => ({ ...p, repaymentMonths: v || 1 }))} />
            </Label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">월 가용소득(자동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.monthlyDisposableIncome)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">총변제예정액(자동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.totalPlannedRepayment)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">청산가치(자동=자산-담보채무)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.liquidationValue)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">청산가치 보장 여부</div>
              <div className={`mt-1 font-bold ${result.liquidationCovered ? "text-emerald-600" : "text-red-600"}`}>
                {result.liquidationCovered ? "보장됨" : "미달 — 월 변제금 상향 반영"}
              </div>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <div className="text-xs font-semibold text-blue-600">최종 월 변제금(자동)</div>
              <div className="mt-1 text-lg font-bold text-blue-700">{fmtWon(result.finalMonthlyRepayment)}</div>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <div className="text-xs font-semibold text-blue-600">최종 총변제예정액(자동)</div>
              <div className="mt-1 text-lg font-bold text-blue-700">{fmtWon(result.finalTotalRepayment)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">기존 신용채무총액(연동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.unsecuredDebtTotal)}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-4">
              <div className="text-xs font-semibold text-emerald-600">탕감액(자동) / 탕감률</div>
              <div className="mt-1 font-bold text-emerald-700">
                {fmtWon(result.writeOffAmount)} ({result.writeOffRate.toFixed(1)}%)
              </div>
            </div>
          </div>

          <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${result.feasible ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-red-100 bg-red-50 text-red-700"}`}>
            진행가능여부(자동판정): {result.feasible ? "가능" : "재검토 필요"}
            <div className="mt-1 text-xs font-normal">{result.feasibilityNote}</div>
          </div>
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
            ※ 위 계산은 상담 단계의 추정치이며, 최종 산정은 담당변호사 확인이 필요합니다. 최저생계비·소액임차인 기준액은 매년/지역별로 변경되므로 최신 고시 기준을 직접 확인해 입력하세요.
          </div>
        </div>
      )}

      {tab === "상담메모" && (
        <div className="space-y-4">
          <Label text="상담메모 / 상담내역">
            <textarea
              className={`${textareaClass} min-h-64`}
              value={consultMemo}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setConsultMemo(e.target.value)}
              placeholder="상담 진행 내용, 고객 요청사항, 후속 조치 등을 자유롭게 기록하세요."
            />
          </Label>
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

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
        <Button
          variant="secondary"
          onClick={() =>
            exportConsultationExcel({
              clientName: name.trim() || client.name,
              phone: phone.trim() || client.phone,
              registeredAt: client.registeredAt,
              assignedStaff,
              applicationType,
              personal,
              income,
              assets,
              debts,
              plan,
              consultMemo,
              contractMemo,
            })
          }
        >
          <Download size={15} />
          고객 상담 엑셀 다운로드
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save}>저장</Button>
        </div>
      </div>
    </Modal>
  );
}
