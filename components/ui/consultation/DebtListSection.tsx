"use client";

// 중단+우측 하단을 합쳐 배치하는 "기대출리스트". 파일 선택/드래그앤드롭 → 추출 →
// 미리보기 확인 → 적용 흐름과 수기 추가를 동시에 지원합니다. 표는 요청한 6개 컬럼만
// 보여주며 잔액은 화면에서 '만원' 단위로 편집하고 내부 데이터는 원 단위로 유지합니다.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { AttachedFileMeta, LoanRecord, LoanKind1 } from "@/lib/types";
import { Button } from "@/components/ui/Primitives";
import { findLikelyDuplicate, parseDebtFile, type ParsedDebtItem } from "@/lib/debt-parsers";
import { SectionCard, denseInputClass, denseSelectClass } from "./shared";
import { Paperclip, Plus, ScanSearch, Trash2 } from "lucide-react";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

interface PreviewRow {
  item: ParsedDebtItem;
  dupOf: LoanRecord | undefined;
  include: boolean;
}

const ALLOWED_EXT = ["xlsx", "xls", "csv", "pdf"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const VISIBLE_KIND1: LoanKind1[] = ["신용", "담보", "개인"];

function toManwon(v: number | undefined): string {
  if (!v) return "";
  return Math.round(v / 10000).toLocaleString("ko-KR");
}

export function DebtListSection({
  loanRecords,
  setLoanRecords,
  setAttachedFiles,
  className,
}: {
  loanRecords: LoanRecord[];
  setLoanRecords: Updater<LoanRecord[]>;
  setAttachedFiles: Updater<AttachedFileMeta[]>;
  className?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewFileName, setPreviewFileName] = useState("");

  function pickFile(file: File) {
    setErrorMsg(null);
    setPreview(null);
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!ALLOWED_EXT.includes(ext)) {
      setErrorMsg("지원하지 않는 파일 형식입니다. xlsx/xls/csv/pdf 파일만 선택해주세요.");
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrorMsg("20MB 이하 파일만 첨부할 수 있습니다.");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }

  async function extract() {
    if (!selectedFile) return;
    const file = selectedFile;
    setAttachedFiles((prev) => [
      ...prev,
      {
        id: `FILE-${Date.now()}`,
        name: file.name,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
        attachedAt: new Date().toISOString(),
      },
    ]);
    setBusy(true);
    const result = await parseDebtFile(file);
    setBusy(false);
    if (!result.ok || result.items.length === 0) {
      setErrorMsg(result.message ?? "파일에서 채무정보를 찾지 못했습니다. 직접 추가해주세요.");
      return;
    }
    setPreviewFileName(file.name);
    setPreview(
      result.items.map((item) => {
        const dupOf = findLikelyDuplicate(item, loanRecords);
        return { item, dupOf, include: !dupOf };
      })
    );
    setSelectedFile(null);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickFile(file);
  }

  function applyPreview() {
    if (!preview) return;
    const toAdd: LoanRecord[] = preview
      .filter((r) => r.include)
      .map((r) => ({
        id: `LOAN-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        kind1: r.item.kind1 === "담보" || r.item.kind1 === "신용" ? r.item.kind1 : "개인",
        kind2: r.item.kind2,
        lender: r.item.lender,
        executedAt: r.item.executedAt,
        balance: r.item.balance,
        note: r.item.note,
        originalAmount: r.item.originalAmount,
        monthlyPayment: r.item.monthlyPayment,
        interestRate: r.item.interestRate,
        securedAmount: r.item.securedAmount,
        source: "file" as const,
        sourceFileName: r.item.sourceFileName,
      }));
    setLoanRecords((prev) => [...prev, ...toAdd]);
    setPreview(null);
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
        source: "manual" as const,
      },
    ]);
  }

  function updateRow(i: number, patch: Partial<LoanRecord>) {
    setLoanRecords((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setLoanRecords((prev) => prev.filter((_, n) => n !== i));
  }

  const includeCount = preview?.filter((r) => r.include).length ?? 0;
  const total = loanRecords.reduce((a, r) => a + (r.balance || 0), 0);

  return (
    <SectionCard title="기대출리스트" className={className}>
      <div
        onDragOver={(e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex min-h-[36px] items-center gap-1.5 border-b border-slate-200 px-1.5 py-1 transition ${
          dragOver ? "bg-blue-50" : "bg-white"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0];
            if (f) pickFile(f);
            e.target.value = "";
          }}
        />
        <Button variant="secondary" className="h-7 rounded-[4px] px-2 text-[11px]" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          <Paperclip size={12} /> 파일 선택
        </Button>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
          {selectedFile ? selectedFile.name : "파일을 선택하거나 이 영역으로 드래그 앤 드롭"}
        </span>
        <Button className="h-7 rounded-[4px] px-2 text-[11px]" onClick={extract} disabled={!selectedFile || busy}>
          <ScanSearch size={12} /> {busy ? "분석중" : "추출"}
        </Button>
        <Button variant="secondary" className="h-7 rounded-[4px] px-2 text-[11px]" onClick={addManualRow}>
          <Plus size={12} /> 추가
        </Button>
      </div>

      {errorMsg && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
          <span>{errorMsg}</span>
          <button type="button" className="font-semibold underline" onClick={() => setErrorMsg(null)}>확인</button>
        </div>
      )}

      {preview && (
        <div className="border-b border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-700">
            <span>{previewFileName} · {preview.length}건 추출</span>
            <div className="flex gap-1">
              <Button variant="secondary" className="h-7 rounded-[4px] px-2 text-[11px]" onClick={() => setPreview(null)}>취소</Button>
              <Button className="h-7 rounded-[4px] px-2 text-[11px]" onClick={applyPreview} disabled={includeCount === 0}>{includeCount}건 적용</Button>
            </div>
          </div>
          <div className="max-h-28 overflow-y-auto border border-slate-200 bg-white">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-slate-100 text-left text-slate-600">
                <tr>
                  {['적용','금융사','구분','실행일','잔액(만원)','상태'].map((h) => <th key={h} className="border-r border-slate-200 px-1.5 py-1 last:border-r-0">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={row.item.id} className="border-t border-slate-200">
                    <td className="px-1.5 py-1"><input type="checkbox" checked={row.include} onChange={(e: ChangeEvent<HTMLInputElement>) => setPreview((p) => p?.map((r,n) => n === i ? {...r, include:e.target.checked} : r) ?? null)} /></td>
                    <td className="px-1.5 py-1">{row.item.lender ?? '-'}</td>
                    <td className="px-1.5 py-1">{row.item.kind2 ?? row.item.kind1}</td>
                    <td className="px-1.5 py-1">{row.item.executedAt ?? '-'}</td>
                    <td className="px-1.5 py-1">{toManwon(row.item.balance) || '0'}</td>
                    <td className="px-1.5 py-1">{row.dupOf ? <span className="font-semibold text-amber-700">중복의심</span> : '신규'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="max-h-[158px] overflow-y-auto">
        <table className="w-full table-fixed text-[11px]">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[20%]" />
            <col className="w-[25%]" />
            <col className="w-[18%]" />
            <col className="w-[17%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-100 text-left text-slate-600">
            <tr>
              {['구분1','구분2','금융사','실행일','잔액','관리'].map((h) => (
                <th key={h} className="border-b border-r border-slate-300 px-1.5 py-1 font-semibold last:border-r-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loanRecords.length === 0 && (
              <tr><td colSpan={6} className="h-14 text-center text-[11px] text-slate-400">등록된 기대출이 없습니다. 파일 추출 또는 [추가]로 입력해주세요.</td></tr>
            )}
            {loanRecords.map((row, i) => (
              <tr key={row.id} className="border-b border-slate-200 last:border-b-0">
                <td className="border-r border-slate-200 p-0.5">
                  <select className={`${denseSelectClass} w-full`} value={VISIBLE_KIND1.includes(row.kind1) ? row.kind1 : '개인'} onChange={(e: ChangeEvent<HTMLSelectElement>) => updateRow(i, { kind1: e.target.value as LoanKind1 })}>
                    {VISIBLE_KIND1.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </td>
                <td className="border-r border-slate-200 p-0.5"><input className={denseInputClass} value={row.kind2 ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { kind2: e.target.value })} placeholder="신용대출(100)" /></td>
                <td className="border-r border-slate-200 p-0.5"><input className={denseInputClass} value={row.lender ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { lender: e.target.value })} placeholder="금융사" /></td>
                <td className="border-r border-slate-200 p-0.5"><input type="date" className={denseInputClass} value={row.executedAt ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { executedAt: e.target.value })} /></td>
                <td className="border-r border-slate-200 p-0.5">
                  <input
                    inputMode="numeric"
                    className={denseInputClass}
                    value={toManwon(row.balance)}
                    placeholder="0"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const raw = e.target.value.replace(/[^0-9-]/g, '');
                      const n = raw === '' ? 0 : Number(raw);
                      updateRow(i, { balance: Number.isFinite(n) ? Math.max(0, n) * 10000 : 0 });
                    }}
                  />
                </td>
                <td className="p-0.5 text-center">
                  <button type="button" onClick={() => removeRow(i)} className="inline-grid size-6 place-items-center rounded-[4px] text-red-500 hover:bg-red-50" aria-label="대출 삭제"><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex h-7 items-center justify-between border-t border-slate-200 bg-slate-50 px-2 text-[11px]">
        <span className="text-slate-500">{loanRecords.length}건</span>
        <span className="font-semibold text-slate-700">잔액 합계 {Math.round(total / 10000).toLocaleString('ko-KR')}만원</span>
      </div>
    </SectionCard>
  );
}
