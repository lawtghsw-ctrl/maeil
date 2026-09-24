"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { type CaseStatus, type CaseType, type PaymentMethod, type StaffName } from "@/lib/types";
import { StatusBadge } from "@/components/ui/Badge";
import { Button, Card, Input, Modal, PageHeader, Pagination, SearchBox, Select, pageRows } from "@/components/ui/Primitives";
import { fmtDate, fmtWon } from "@/lib/format";
import { Plus } from "lucide-react";

const TYPE_FILTERS: Array<CaseType | "전체"> = ["전체", "개인회생", "개인파산"];
const STATUS_FILTERS: Array<CaseStatus | "전체"> = ["전체", "진행중", "보류", "종결", "취하"];


const PAYMENT_METHODS: PaymentMethod[] = ["단순분납", "로피분납", "신카할부완납", "캐피탈분납"];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ContractCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { clients, cases, addCase, workStaffNames, currentStaff, can } = useStore();
  const [clientId, setClientId] = useState("");
  const [caseType, setCaseType] = useState<CaseType>("개인회생");
  const [court, setCourt] = useState("");
  const [assignedStaff, setAssignedStaff] = useState<StaffName>((currentStaff && workStaffNames.includes(currentStaff) ? currentStaff : workStaffNames[0]) || "");
  const [contractAmount, setContractAmount] = useState("");
  const [contractDate, setContractDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("단순분납");

  function chooseClient(id: string) {
    setClientId(id);
    const client = clients.find((item) => item.id === id);
    if (client?.assignedStaff) setAssignedStaff(client.assignedStaff);
    if (client?.applicationType === "개인파산") setCaseType("개인파산");
    if (client?.applicationType === "개인회생") setCaseType("개인회생");
  }

  function save() {
    if (!clientId) return;
    const amount = Number(contractAmount.replace(/[^0-9]/g, "")) || 0;
    const id = addCase({
      caseNumber: `미접수-${Date.now().toString().slice(-6)}`,
      clientId,
      caseType,
      court: court.trim() || "미지정",
      stage: "상담접수",
      stageUpdatedAt: todayIso(),
      status: "진행중",
      assignedStaff,
      totalDebt: 0,
      contractAmount: amount,
      contractDate,
      paidAmount: 0,
      paymentMethod,
      fromLeadId: clients.find((item) => item.id === clientId)?.fromLeadId,
    });
    onClose();
    router.push(`/cases/${id}`);
  }

  return (
    <Modal open={open} title="계약 등록" onClose={onClose} size="md">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          고객 *
          <Select className="mt-1 w-full" value={clientId} onChange={(e) => chooseClient(e.target.value)}>
            <option value="">고객 선택</option>
            {clients.map((client) => {
              const count = cases.filter((record) => record.clientId === client.id).length;
              return <option key={client.id} value={client.id}>{client.name} · {client.phone}{count ? ` · 기존계약 ${count}건` : ""}</option>;
            })}
          </Select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          사건유형
          <Select className="mt-1 w-full" value={caseType} onChange={(e) => setCaseType(e.target.value as CaseType)}>
            <option value="개인회생">개인회생</option>
            <option value="개인파산">개인파산</option>
          </Select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          담당자
          <Select className="mt-1 w-full" value={assignedStaff} disabled={!can("cases.change_assignee") && !!currentStaff} onChange={(e) => setAssignedStaff(e.target.value as StaffName)}>
            {workStaffNames.map((staff) => <option key={staff} value={staff}>{staff}</option>)}
          </Select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          관할법원
          <Input className="mt-1" value={court} onChange={(e) => setCourt(e.target.value)} placeholder="예: 수원회생법원" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          계약일
          <Input className="mt-1" type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          계약금액(원)
          <Input className="mt-1" value={contractAmount} onChange={(e) => setContractAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="예: 3300000" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          결제수단
          <Select className="mt-1 w-full" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
          </Select>
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>취소</Button>
        <Button onClick={save} disabled={!clientId}>계약 등록</Button>
      </div>
    </Modal>
  );
}

export default function CasesPage() {
  const { cases, clients, can, currentStaff } = useStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<CaseType | "전체">("전체");
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "전체">("진행중");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const scopedCases = can("cases.view_all") ? cases : cases.filter((record) => !!currentStaff && record.assignedStaff === currentStaff);
    return scopedCases
      .map((c) => ({ c, client: clients.find((cl) => cl.id === c.clientId) }))
      .filter(({ c, client }) => {
        if (typeFilter !== "전체" && c.caseType !== typeFilter) return false;
        if (statusFilter !== "전체" && c.status !== statusFilter) return false;
        if (query.trim()) {
          const q = query.trim();
          const hit = client?.name.includes(q) || c.caseNumber.includes(q) || client?.phone.includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => (a.c.contractDate < b.c.contractDate ? 1 : -1));
  }, [can, cases, clients, currentStaff, query, typeFilter, statusFilter]);

  return (
    <>
      <PageHeader
        title="계약관리"
        description={`고객·계약 통합관리 · 현재 조회범위 ${rows.length}건 표시`}
        action={can("cases.create") ? <Button onClick={() => setCreateOpen(true)}><Plus size={15} /> 계약 등록</Button> : undefined}
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
          placeholder="의뢰인명 · 사건번호 · 연락처 검색"
        />
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTypeFilter(t);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${typeFilter === t ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {t}
            </button>
          ))}
          <span className="mx-1 w-px bg-slate-200" />
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${statusFilter === s ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {/* 모바일: 카드 리스트 */}
        <div className="divide-y divide-slate-100 md:hidden">
          {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">조건에 맞는 사건이 없습니다.</div>}
          {pageRows(rows, page, 10).map(({ c, client }) => {
            const receivable = Math.max(0, c.contractAmount - c.paidAmount);
            return (
              <Link key={c.id} href={`/cases/${c.id}`} className="block space-y-2 p-4 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-base font-bold text-slate-900">{client?.name ?? "-"}</span>
                      <span className="text-xs font-semibold text-slate-500">{c.caseType}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{c.caseNumber} · 담당 {c.assignedStaff}</div>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="text-xs text-slate-400">{fmtDate(c.contractDate)} 계약</div>
                {can("cases.view_finance") && <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">계약금액 {fmtWon(c.contractAmount)}</span>
                  {receivable > 0 ? <span className="font-semibold text-red-600">미수 {fmtWon(receivable)}</span> : <span className="text-slate-300">미수금 없음</span>}
                </div>}
              </Link>
            );
          })}
        </div>

        {/* 데스크톱: 테이블 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="admin-responsive-table w-full min-w-[960px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {["의뢰인", "사건번호", "유형", "담당자", "계약일", "계약금액", "결제금액", "미수금", "상태", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows(rows, page, 10).map(({ c, client }) => {
                const receivable = Math.max(0, c.contractAmount - c.paidAmount);
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{client?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{c.caseNumber}</td>
                    <td className="px-4 py-3 text-slate-700">{c.caseType}</td>
                    <td className="px-4 py-3 text-slate-500">{c.assignedStaff}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(c.contractDate)}</td>
                    <td className="px-4 py-3 text-slate-900">{can("cases.view_finance") ? fmtWon(c.contractAmount) : "권한없음"}</td>
                    <td className="px-4 py-3 text-slate-700">{can("cases.view_finance") ? fmtWon(c.paidAmount) : "-"}</td>
                    <td className="px-4 py-3">
                      {can("cases.view_finance") ? (receivable > 0 ? <span className="font-semibold text-red-600">{fmtWon(receivable)}</span> : <span className="text-slate-300">-</span>) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/cases/${c.id}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        상세
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                    조건에 맞는 사건이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={rows.length} onChange={setPage} pageSize={10} />
      </Card>
      <ContractCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
