"use client";

// v22: 고객관리와 계약관리를 통합하면서 고객관리에서 실제로 유지하기로 한
// 분납관리 / 전자계약서 / 서류안내문 전송 3개 기능만 계약 상세에서 재사용합니다.
// 별도 고객관리 화면을 다시 의존하지 않도록 사건 1건 + 고객 1명을 입력으로 받는 독립
// 컴포넌트로 분리했습니다. 실제 외부 API(전자서명/알림톡)는 아직 연결 전이라 기존과
// 동일하게 미리보기 동작을 유지합니다.
import { useEffect, useState, type ChangeEvent } from "react";
import { FileSignature, Plus, RefreshCw, Send, Table2, WalletCards } from "lucide-react";
import { useStore, type InstallmentDraft } from "@/lib/store";
import type { CaseRecord, Client, InstallmentStatus, PaymentMethod } from "@/lib/types";
import { PAYMENT_METHOD_NOTE } from "@/lib/types";
import { DOCUMENT_CHECKLIST_TEMPLATE } from "@/lib/documents";
import { fmtWon } from "@/lib/format";
import { Button, Input, Label, Modal, NumberInput, Select } from "@/components/ui/Primitives";

const INSTALLMENT_STATUSES: InstallmentStatus[] = ["예정", "완료", "연체", "실패"];
const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_NOTE) as PaymentMethod[];
const DOC_GUIDE_CHANNELS = ["카카오톡 알림톡", "SMS"] as const;
type DocGuideChannel = (typeof DOC_GUIDE_CHANNELS)[number];

type ActionKind = "installment" | "eform" | "docGuide" | "priorityRepayment" | null;

function todayIsoStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CaseActionPanel({ client, caseRecord }: { client: Client; caseRecord: CaseRecord }) {
  const { can } = useStore();
  const [open, setOpen] = useState<ActionKind>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {can("cases.manage_installments") && <Button onClick={() => setOpen("installment")}>
          <WalletCards size={15} />
          분납관리
        </Button>}
        {can("cases.econtract") && <Button variant="secondary" onClick={() => setOpen("eform")}>
          <FileSignature size={15} />
          전자계약서
        </Button>}
        {can("cases.send_docs") && <Button variant="secondary" onClick={() => setOpen("docGuide")}>
          <Send size={15} />
          서류안내문 전송
        </Button>}
        <Button variant="secondary" onClick={() => setOpen("priorityRepayment")}>
          <Table2 size={15} />
          최우선변제 안내표
        </Button>
      </div>

      <CaseInstallmentModal
        open={open === "installment"}
        client={client}
        caseRecord={caseRecord}
        onClose={() => setOpen(null)}
      />
      <CaseEformModal
        open={open === "eform"}
        client={client}
        caseRecord={caseRecord}
        onClose={() => setOpen(null)}
      />
      <CaseDocGuideModal
        open={open === "docGuide"}
        client={client}
        caseRecord={caseRecord}
        onClose={() => setOpen(null)}
      />
      <PriorityRepaymentGuideModal open={open === "priorityRepayment"} onClose={() => setOpen(null)} />
    </>
  );
}

function CaseInstallmentModal({
  open,
  client,
  caseRecord,
  onClose,
}: {
  open: boolean;
  client: Client;
  caseRecord: CaseRecord;
  onClose: () => void;
}) {
  const { installments, setCaseInstallments } = useStore();

  const makeRows = (): InstallmentDraft[] =>
    installments
      .filter((i) => i.caseId === caseRecord.id)
      .sort((a, b) => a.seq - b.seq)
      .map(({ id, dueDate, amount, status, paidDate }) => ({ id, dueDate, amount, status, paidDate }));

  const [rows, setRows] = useState<InstallmentDraft[]>(makeRows);
  const [contractAmount, setContractAmount] = useState(caseRecord.contractAmount);
  const [paidAmount, setPaidAmount] = useState(caseRecord.paidAmount);
  const [installmentCount, setInstallmentCount] = useState(caseRecord.installmentCount ?? makeRows().length);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(caseRecord.paymentMethod);

  useEffect(() => {
    if (!open) return;
    const nextRows = makeRows();
    const nextCount = Math.max(0, caseRecord.installmentCount ?? nextRows.length);
    const filledRows = [...nextRows];
    while (filledRows.length < nextCount) {
      filledRows.push({ dueDate: "", amount: 0, status: "예정", paidDate: "" });
    }
    setRows(filledRows.slice(0, nextCount));
    setContractAmount(caseRecord.contractAmount);
    setPaidAmount(caseRecord.paidAmount);
    setInstallmentCount(nextCount);
    setPaymentMethod(caseRecord.paymentMethod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseRecord.id, caseRecord.contractAmount, caseRecord.paidAmount, caseRecord.installmentCount, caseRecord.paymentMethod]);

  function update(index: number, patch: Partial<InstallmentDraft>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function changeInstallmentCount(value: number) {
    const nextCount = Math.max(0, Math.min(60, Math.trunc(value || 0)));
    setInstallmentCount(nextCount);
    setRows((prev) => {
      const next = [...prev];
      while (next.length < nextCount) next.push({ dueDate: "", amount: 0, status: "예정", paidDate: "" });
      return next.slice(0, nextCount);
    });
  }

  function removeRow(index: number) {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setInstallmentCount(next.length);
      return next;
    });
  }

  function addRow() {
    setRows((prev) => {
      const next = [...prev, { dueDate: "", amount: 0, status: "예정" as InstallmentStatus, paidDate: "" }];
      setInstallmentCount(next.length);
      return next;
    });
  }

  function save() {
    setCaseInstallments(caseRecord.id, rows.filter((row) => row.dueDate), {
      contractAmount,
      paidAmount,
      installmentCount,
      paymentMethod,
    });
    onClose();
  }

  const receivable = Math.max(0, contractAmount - paidAmount);

  return (
    <Modal open={open} title={`${client.name} · 분납관리`} onClose={onClose} size="lg">
      <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
        <div className="mb-3 text-xs font-semibold text-blue-700">
          {caseRecord.caseNumber} · {caseRecord.caseType}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Label text="총 수임료">
            <NumberInput value={contractAmount} onChange={setContractAmount} />
          </Label>
          <Label text="납부금액">
            <NumberInput value={paidAmount} onChange={setPaidAmount} />
          </Label>
          <Label text="납부회차">
            <Input
              type="number"
              min={0}
              max={60}
              value={installmentCount}
              onChange={(e: ChangeEvent<HTMLInputElement>) => changeInstallmentCount(Number(e.target.value))}
            />
          </Label>
          <Label text="결제방법">
            <Select value={paymentMethod} onChange={(e: ChangeEvent<HTMLSelectElement>) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </Select>
          </Label>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
          <span>미수금 <b className={receivable > 0 ? "text-red-600" : "text-slate-900"}>{fmtWon(receivable)}</b></span>
          <span>등록된 일정 <b className="text-slate-900">{rows.length}회</b></span>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={row.id ?? index} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <b className="text-sm">{index + 1}회차</b>
              <Button variant="danger" onClick={() => removeRow(index)}>
                삭제
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Label text="납부 예정일">
                <input
                  type="date"
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm"
                  value={row.dueDate}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => update(index, { dueDate: e.target.value })}
                />
              </Label>
              <Label text="회차 금액">
                <NumberInput value={row.amount} onChange={(value) => update(index, { amount: value })} />
              </Label>
              <Label text="실제 입금일">
                <input
                  type="date"
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm"
                  value={row.paidDate ?? ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => update(index, { paidDate: e.target.value })}
                />
              </Label>
              <Label text="상태">
                <Select
                  value={row.status}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => update(index, { status: e.target.value as InstallmentStatus })}
                >
                  {INSTALLMENT_STATUSES.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </Select>
              </Label>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">
            납부회차가 0회입니다. 회차를 입력하거나 아래 버튼으로 추가하세요.
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-blue-300 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
      >
        <Plus size={15} />
        납부 회차 추가
      </button>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>취소</Button>
        <Button onClick={save}>분납정보 저장</Button>
      </div>
    </Modal>
  );
}

function PriorityRepaymentGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows = [
    ["서울특별시", "1억 5,000만 원 이하", "1억 6,500만 원 이하", "5,000만 원 이하", "5,500만 원 이하"],
    ["과밀억제권역, 세종·용인·화성·김포", "1억 3,000만 원 이하", "1억 4,500만 원 이하", "4,300만 원 이하", "4,800만 원 이하"],
    ["광역시, 안산·광주·파주·이천·평택", "7,000만 원 이하", "8,500만 원 이하", "2,300만 원 이하", "2,800만 원 이하"],
    ["그 밖의 지역", "6,000만 원 이하", "7,500만 원 이하", "2,000만 원 이하", "2,500만 원 이하"],
  ];

  return (
    <Modal open={open} title="최우선변제금액 안내표" onClose={onClose} size="lg">
      <div className="overflow-x-auto rounded-xl border border-slate-300">
        <table className="w-full min-w-[760px] border-collapse text-center text-sm">
          <thead>
            <tr className="bg-white">
              <th rowSpan={2} className="border border-slate-300 px-3 py-3 font-semibold text-slate-700">지역</th>
              <th colSpan={2} className="border border-slate-300 px-3 py-3 font-semibold text-slate-700">최우선변제 대상 임차인의 보증금액</th>
              <th colSpan={2} className="border border-slate-300 px-3 py-3 font-semibold text-slate-700">최우선변제금액</th>
            </tr>
            <tr>
              <th className="border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-600">현행</th>
              <th className="border border-slate-300 bg-amber-100 px-3 py-2 font-semibold text-slate-700">개정안</th>
              <th className="border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-600">현행</th>
              <th className="border border-slate-300 bg-amber-200 px-3 py-2 font-semibold text-slate-700">개정안</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                <td className="border border-slate-300 px-3 py-3 font-medium text-slate-700">{row[0]}</td>
                <td className="border border-slate-300 px-3 py-3 text-slate-700">{row[1]}</td>
                <td className="border border-slate-300 bg-amber-50 px-3 py-3 font-semibold text-slate-800">{row[2]}</td>
                <td className="border border-slate-300 px-3 py-3 text-slate-700">{row[3]}</td>
                <td className="border border-slate-300 bg-amber-100 px-3 py-3 font-semibold text-slate-800">{row[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>확인</Button>
      </div>
    </Modal>
  );
}

function CaseEformModal({
  open,
  client,
  caseRecord,
  onClose,
}: {
  open: boolean;
  client: Client;
  caseRecord: CaseRecord;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState(client.phone);
  const [message, setMessage] = useState("계약서 확인 후 서명 부탁드립니다.");

  useEffect(() => {
    if (open) {
      setPhone(client.phone);
      setMessage("계약서 확인 후 서명 부탁드립니다.");
    }
  }, [open, client.phone]);

  return (
    <Modal open={open} title={`${client.name} · 전자계약서 전송`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
          <b>{client.name}</b> 고객의 계약정보를 템플릿에 자동 입력해 서명 요청을 전송합니다.
          <div className="mt-1 text-xs text-blue-600">※ 전자서명 API 연동 전 미리보기입니다.</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label text="고객명"><Input value={client.name} readOnly /></Label>
          <Label text="계약일"><Input value={caseRecord.contractDate} readOnly /></Label>
          <Label text="전화번호(SMS)">
            <Input value={phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} />
          </Label>
          <Label text="사건유형"><Input value={caseRecord.caseType} readOnly /></Label>
          <Label text="총 수임료"><Input value={fmtWon(caseRecord.contractAmount)} readOnly /></Label>
          <Label text="결제수단"><Input value={PAYMENT_METHOD_NOTE[caseRecord.paymentMethod]} readOnly /></Label>
        </div>
        <Label text="전송 메시지">
          <Input value={message} onChange={(e: ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)} />
        </Label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={() => alert("전자계약서 전송 기능은 API 연동 후 제공됩니다.")}>
            <RefreshCw size={15} />
            계약서 전송
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function buildDocGuideMessage(clientName: string, pendingLabels: string[]): string {
  if (pendingLabels.length === 0) {
    return `[로파워] ${clientName}님, 제출해주신 서류 확인이 모두 완료되었습니다. 협조 감사드립니다.`;
  }
  return [
    `[로파워] ${clientName}님, 원활한 사건 진행을 위해 아래 서류를 준비해 보내주시기 바랍니다.`,
    "",
    ...pendingLabels.map((label, index) => `${index + 1}. ${label}`),
    "",
    "서류 준비에 어려움이 있으시면 담당자에게 편하게 연락 부탁드립니다. 감사합니다.",
  ].join("\n");
}

function CaseDocGuideModal({
  open,
  client,
  caseRecord,
  onClose,
}: {
  open: boolean;
  client: Client;
  caseRecord: CaseRecord;
  onClose: () => void;
}) {
  const { caseDocuments, updateCase } = useStore();
  // 체크리스트 UI 자체는 계약상세에서 제거하지만, 과거에 체크된 데이터는 보존합니다.
  // 따라서 기존 체크상태가 있으면 미제출 서류 계산에 그대로 반영됩니다.
  const checked = caseDocuments[caseRecord.id] ?? {};
  const pending = DOCUMENT_CHECKLIST_TEMPLATE.filter((doc) => !checked[doc.id]);
  const [channel, setChannel] = useState<DocGuideChannel>("카카오톡 알림톡");
  const [phone, setPhone] = useState(client.phone);
  const [message, setMessage] = useState(() => buildDocGuideMessage(client.name, pending.map((doc) => doc.label)));

  useEffect(() => {
    if (open) {
      setChannel("카카오톡 알림톡");
      setPhone(client.phone);
      setMessage(buildDocGuideMessage(client.name, pending.map((doc) => doc.label)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id, caseRecord.id]);

  function send() {
    updateCase(caseRecord.id, { docsSentAt: todayIsoStr() });
    alert("서류안내문 전송 기능은 카카오톡 알림톡/SMS API 연동 후 실제로 발송됩니다. (현재는 미리보기입니다)");
    onClose();
  }

  return (
    <Modal open={open} title={`${client.name} · 서류안내문 전송`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
          <b>{client.name}</b> 고객에게 준비 서류 안내문을 발송합니다.
          <div className="mt-1 text-xs text-blue-600">※ 알림톡/SMS API 연동 전 미리보기입니다.</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label text="발송 채널">
            <Select value={channel} onChange={(e: ChangeEvent<HTMLSelectElement>) => setChannel(e.target.value as DocGuideChannel)}>
              {DOC_GUIDE_CHANNELS.map((item) => <option key={item}>{item}</option>)}
            </Select>
          </Label>
          <Label text="수신 연락처">
            <Input value={phone} onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} />
          </Label>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="mb-2 text-xs font-semibold text-slate-500">안내 대상 서류 ({pending.length}건)</div>
          {pending.length === 0 ? (
            <div className="text-sm font-semibold text-emerald-600">기존 체크기록 기준 미제출 서류가 없습니다.</div>
          ) : (
            <ul className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              {pending.map((doc) => <li key={doc.id}>· {doc.label}</li>)}
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
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={send}>
            <Send size={15} />
            안내문 전송
          </Button>
        </div>
      </div>
    </Modal>
  );
}
