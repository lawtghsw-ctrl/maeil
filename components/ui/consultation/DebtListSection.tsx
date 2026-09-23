"use client";

// 상담일지 하단 "기대출리스트".
// v19: 파일 선택/드래그앤드롭 즉시 파싱하고, 중복 의심 항목만 자동 제외한 뒤
// 정상 항목은 곧바로 기대출 리스트에 반영합니다. 별도 Preview/적용 버튼은 제거했습니다.
// 수기 추가/수정/삭제는 기존 방식 그대로 유지합니다.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { AttachedFileMeta, LoanRecord } from "@/lib/types";
import { LOAN_KIND1_OPTIONS } from "@/lib/types";
import { Button, Input, Select } from "@/components/ui/Primitives";
import { findLikelyDuplicate, parseDebtFile } from "@/lib/debt-parsers";
import { fmtWon } from "@/lib/format";
import { SectionCard } from "./shared";
import { Paperclip, Plus, Trash2 } from "lucide-react";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

const ALLOWED_EXT = ["html", "htm", "xlsx", "xls", "csv", "pdf"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function DebtListSection({
  loanRecords,
  setLoanRecords,
  setAttachedFiles,
}: {
  loanRecords: LoanRecord[];
  setLoanRecords: Updater<LoanRecord[]>;
  setAttachedFiles: Updater<AttachedFileMeta[]>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function processFile(file: File) {
    setErrorMsg(null);
    setSuccessMsg(null);

    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!ALLOWED_EXT.includes(ext)) {
      setErrorMsg("지원하지 않는 파일 형식입니다 (.html/.htm, .xlsx, .xls, .csv, .pdf만 첨부할 수 있습니다).");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrorMsg("파일 용량이 너무 큽니다 — 20MB 이하 파일만 첨부할 수 있습니다.");
      return;
    }

    setBusy(true);
    try {
      const result = await parseDebtFile(file);
      if (!result.ok || result.items.length === 0) {
        setErrorMsg(result.message ?? "파일에서 채무정보를 자동으로 확인하지 못했습니다. 파일 형식을 확인하거나 직접 입력해주세요.");
        return;
      }

      const meta: AttachedFileMeta = {
        id: `FILE-${Date.now()}`,
        name: file.name,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
        attachedAt: new Date().toISOString(),
      };
      setAttachedFiles((prev) => [...prev, meta]);

      let addedCount = 0;
      let duplicateCount = 0;

      setLoanRecords((prev) => {
        const next = [...prev];

        result.items.forEach((item, index) => {
          const duplicate = findLikelyDuplicate(item, next);
          if (duplicate) {
            duplicateCount += 1;
            return;
          }

          next.push({
            id: `LOAN-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}`,
            kind1: item.kind1,
            kind2: item.kind2,
            lender: item.lender,
            executedAt: item.executedAt,
            balance: item.balance,
            note: item.note,
            originalAmount: item.originalAmount,
            monthlyPayment: item.monthlyPayment,
            interestRate: item.interestRate,
            securedAmount: item.securedAmount,
            source: "file",
            sourceFileName: item.sourceFileName || file.name,
          });
          addedCount += 1;
        });

        return next;
      });

      const duplicateText = duplicateCount > 0 ? ` · 중복 의심 ${duplicateCount}건 자동 제외` : "";
      setSuccessMsg(`"${file.name}"에서 ${result.items.length}건 확인 · ${addedCount}건 자동 적용${duplicateText}`);
    } catch {
      setErrorMsg("파일 분석 중 오류가 발생했습니다. 파일 형식을 확인하거나 직접 입력해주세요.");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  function addManualRow() {
    setLoanRecords((prev) => [
      ...prev,
      {
        id: `LOAN-${Date.now()}-${prev.length}`,
        kind1: "신용",
        kind2: "",
        lender: "",
        executedAt: "",
        balance: 0,
        note: "",
        source: "manual",
      },
    ]);
  }

  function updateRow(i: number, patch: Partial<LoanRecord>) {
    setLoanRecords((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setLoanRecords((prev) => prev.filter((_, n) => n !== i));
  }

  const total = loanRecords.reduce((a, r) => a + (r.balance || 0), 0);

  return (
    <SectionCard title="기대출리스트" className="h-full min-h-0" bodyClassName="space-y-1 p-1">
      <div
        onDragOver={(e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-1 rounded border border-dashed px-2 py-1 transition ${
          dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm,.xlsx,.xls,.csv,.pdf"
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) void processFile(file);
            e.target.value = "";
          }}
        />

        <Button
          variant="secondary"
          className="px-2.5 py-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          <Paperclip size={13} />
          {busy ? "분석 중…" : "파일 선택"}
        </Button>

        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
          파일을 선택하거나 여기에 끌어다 놓으면 채무정보를 자동 추출·적용합니다. (credit4u HTML 권장)
        </span>

        <Button variant="secondary" className="px-2.5 py-1.5" onClick={addManualRow} disabled={busy}>
          <Plus size={13} />
          추가
        </Button>

        <a
          href="https://www.credit4u.or.kr:2443/debtcheck"
          target="_blank"
          rel="noreferrer"
          className="w-full text-[10px] font-semibold text-blue-600 underline"
        >
          본인신용정보 열람서비스 바로가기 ↗
        </a>
      </div>

      {errorMsg && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="shrink-0 font-semibold underline">
            확인
          </button>
        </div>
      )}

      {successMsg && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} className="shrink-0 font-semibold underline">
            확인
          </button>
        </div>
      )}

      <div className="max-h-52 overflow-y-auto rounded border border-slate-200">
        <table className="w-full min-w-[620px] text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              {["구분1", "구분2", "금융사", "실행일", "잔액(천원)", "관리"].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loanRecords.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  아직 등록된 대출이 없습니다. 위 "추가" 버튼 또는 파일 업로드로 채워주세요.
                </td>
              </tr>
            )}

            {loanRecords.map((row, i) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-2 py-1">
                  <Select
                    value={row.kind1}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                      updateRow(i, { kind1: e.target.value as LoanRecord["kind1"] })
                    }
                    className="h-7 w-20 px-1.5 text-[11px] sm:h-7"
                  >
                    {LOAN_KIND1_OPTIONS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                </td>

                <td className="px-2 py-1">
                  <Input
                    className="h-7 w-28 px-1.5 text-[11px] sm:h-7"
                    value={row.kind2 ?? ""}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { kind2: e.target.value })}
                    placeholder="예: 신용대출(100)"
                  />
                </td>

                <td className="px-2 py-1">
                  <Input
                    className="h-7 w-24 px-1.5 text-[11px] sm:h-7"
                    value={row.lender ?? ""}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { lender: e.target.value })}
                    placeholder="예: 제이티저축은행"
                  />
                </td>

                <td className="px-2 py-1">
                  <input
                    type="date"
                    className="h-7 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] outline-none sm:h-7"
                    value={row.executedAt ?? ""}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { executedAt: e.target.value })}
                  />
                </td>

                <td className="px-2 py-1">
                  <input
                    inputMode="numeric"
                    className="h-7 w-24 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] outline-none sm:h-7"
                    value={row.balance ? Math.round(row.balance / 1000).toLocaleString("ko-KR") : ""}
                    placeholder="0"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const raw = e.target.value.replace(/[^0-9-]/g, "");
                      updateRow(i, { balance: raw === "" ? 0 : Math.max(0, Number(raw)) * 1000 });
                    }}
                  />
                </td>

                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="grid size-6 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="대출 삭제"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loanRecords.length > 0 && (
        <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[10px]">
          <span className="font-semibold text-slate-500">채무 리스트 합계 ({loanRecords.length}건)</span>
          <span className="font-bold text-slate-900">{fmtWon(total)}</span>
        </div>
      )}
    </SectionCard>
  );
}
