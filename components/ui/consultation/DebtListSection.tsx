"use client";

// 상담일지 대형 팝업 — 하단 전체폭 "기대출리스트" 섹션. v13 레이아웃 정밀개편 요청에 따라
// 기존 DebtUploader(파일 업로드)와 DebtTable(수기입력 목록)을 하나의 구분 바 아래로
// 합쳤고, 파일 첨부 흐름을 "파일 선택 → 추출 → (Preview 확인) → 적용"의 명시적 3단계로
// 바꿨습니다(이전에는 파일을 고르는 즉시 자동으로 분석했습니다 — 이번 요청의 "파일 선택
// / 추출 / 추가" 3버튼 구성에 맞춘 변경). 업로드 즉시 DB(=store)에 반영하지 않고 항상
// "분석 → Preview → 사용자 확인 → 적용" 순서를 거치는 원칙(요청 원문 13번)은 그대로
// 유지됩니다. 표 컬럼은 요청하신 대로 "구분1(드롭다운) | 구분2 | 금융사 | 실행일 | 잔액
// | 관리" 6개로 간소화했습니다 — 월불입/출처 등 나머지 값은 데이터에는 그대로 남아있고
// (채무 요약 자동계산·중복검사 등에 계속 쓰임) 이 표에서만 화면에 노출하지 않습니다.
//
// 삭제 정책: 기존 프로젝트 전체에 soft-delete 관례가 없어(Section 15 확인 결과) 이 표의
// 삭제도 즉시 배열에서 제거하는 hard delete로 구현했습니다.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { AttachedFileMeta, LoanRecord } from "@/lib/types";
import { LOAN_KIND1_OPTIONS } from "@/lib/types";
import { Button, Input, Select } from "@/components/ui/Primitives";
import { findLikelyDuplicate, parseDebtFile, type ParsedDebtItem } from "@/lib/debt-parsers";
import { fmtWon } from "@/lib/format";
import { SectionCard } from "./shared";
import { Paperclip, Plus, ScanSearch, Trash2 } from "lucide-react";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

interface PreviewRow {
  item: ParsedDebtItem;
  dupOf: LoanRecord | undefined;
  include: boolean;
}

const ALLOWED_EXT = ["xlsx", "xls", "csv", "pdf"];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

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
      setErrorMsg("지원하지 않는 파일 형식입니다 (.xlsx, .xls, .csv, .pdf만 첨부할 수 있습니다).");
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrorMsg("파일 용량이 너무 큽니다 — 20MB 이하 파일만 첨부할 수 있습니다.");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }

  // "추출" 버튼 — 선택된 파일을 이 시점에 분석합니다(파일 선택과 분석을 분리한 명시적
  // 2단계 흐름). 원본 파일은 분석 성공 여부와 무관하게 첨부목록에 등록합니다(실제 저장
  // 경로는 UUID 등으로 별도 관리해야 함 — Section 28 참고).
  async function extract() {
    if (!selectedFile) return;
    const file = selectedFile;
    const meta: AttachedFileMeta = {
      id: `FILE-${Date.now()}`,
      name: file.name,
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
      attachedAt: new Date().toISOString(),
    };
    setAttachedFiles((prev) => [...prev, meta]);
    setBusy(true);
    const result = await parseDebtFile(file);
    setBusy(false);
    if (!result.ok || result.items.length === 0) {
      setErrorMsg(result.message ?? "파일에서 채무정보를 자동으로 확인하지 못했습니다. 파일 형식을 확인하거나 직접 입력해주세요.");
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

  function toggleInclude(i: number, checked: boolean) {
    setPreview((prev) => (prev ? prev.map((r, n) => (n === i ? { ...r, include: checked } : r)) : prev));
  }

  function applyPreview() {
    if (!preview) return;
    const toAdd: LoanRecord[] = preview
      .filter((r) => r.include)
      .map((r) => ({
        id: `LOAN-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        kind1: r.item.kind1,
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

  // "추가" 버튼 — 파일 없이도 수기로 한 건씩 바로 추가(Section 15).
  function addManualRow() {
    setLoanRecords((prev) => [
      ...prev,
      { id: `LOAN-${Date.now()}-${prev.length}`, kind1: "신용", kind2: "", lender: "", executedAt: "", balance: 0, note: "", source: "manual" as const },
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
    <SectionCard title="기대출리스트" className="xl:col-span-3">
      <div
        onDragOver={(e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 transition ${
          dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50"
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
        <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          <Paperclip size={13} />
          파일 선택
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
          {selectedFile ? selectedFile.name : "여기로 끌어다 놓거나 파일 선택 후 [추출]을 눌러주세요 (.xlsx/.xls/.csv/.pdf)"}
        </span>
        <Button className="px-2.5 py-1.5" onClick={extract} disabled={!selectedFile || busy}>
          <ScanSearch size={13} />
          {busy ? "분석 중…" : "추출"}
        </Button>
        <Button variant="secondary" className="px-2.5 py-1.5" onClick={addManualRow}>
          <Plus size={13} />
          추가
        </Button>
        <a href="https://www.credit4u.or.kr" target="_blank" rel="noreferrer" className="w-full text-[10px] font-semibold text-blue-600 underline">
          본인신용정보 열람서비스(크레딧포유) 바로가기 ↗
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

      {preview && (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-700">
            &ldquo;{previewFileName}&rdquo;에서 {preview.length}건의 채무정보를 찾았습니다. 적용할 항목을 확인해주세요.
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-100">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>
                  {["적용", "금융사", "구분", "실행일", "잔액", "상태"].map((h) => (
                    <th key={h} className="px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={row.item.id} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={row.include} onChange={(e: ChangeEvent<HTMLInputElement>) => toggleInclude(i, e.target.checked)} />
                    </td>
                    <td className="px-2 py-1.5">{row.item.lender ?? "-"}</td>
                    <td className="px-2 py-1.5">{row.item.kind2 ?? row.item.kind1}</td>
                    <td className="px-2 py-1.5">{row.item.executedAt ?? "-"}</td>
                    <td className="px-2 py-1.5">{fmtWon(row.item.balance)}</td>
                    <td className="px-2 py-1.5">
                      {row.dupOf ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">기존과 유사(중복 의심)</span>
                      ) : (
                        <span className="text-slate-400">신규</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.some((r) => r.dupOf) && (
            <div className="mt-1.5 text-[10px] text-amber-600">
              &ldquo;중복 의심&rdquo; 항목은 기존 채무 리스트에 비슷한 항목이 이미 있어 기본은 제외(기존 유지)로 체크가 꺼져 있습니다.
            </div>
          )}
          <div className="mt-2.5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreview(null)}>
              취소
            </Button>
            <Button onClick={applyPreview} disabled={includeCount === 0}>
              {includeCount}건 적용
            </Button>
          </div>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[620px] text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              {["구분1", "구분2", "금융사", "실행일", "잔액", "관리"].map((h) => (
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
                  아직 등록된 대출이 없습니다. 위 &ldquo;추가&rdquo; 버튼 또는 파일 업로드로 채워주세요.
                </td>
              </tr>
            )}
            {loanRecords.map((row, i) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-2 py-1">
                  <Select value={row.kind1} onChange={(e: ChangeEvent<HTMLSelectElement>) => updateRow(i, { kind1: e.target.value as LoanRecord["kind1"] })} className="h-7 w-20 px-1.5 text-[11px]">
                    {LOAN_KIND1_OPTIONS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <Input className="h-7 w-28 px-1.5 text-[11px]" value={row.kind2 ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { kind2: e.target.value })} placeholder="예: 신용대출(100)" />
                </td>
                <td className="px-2 py-1">
                  <Input className="h-7 w-24 px-1.5 text-[11px]" value={row.lender ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { lender: e.target.value })} placeholder="예: 제이티저축은행" />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="date"
                    className="h-7 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] outline-none"
                    value={row.executedAt ?? ""}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updateRow(i, { executedAt: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    inputMode="numeric"
                    className="h-7 w-24 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] outline-none"
                    value={row.balance ? row.balance.toLocaleString("ko-KR") : ""}
                    placeholder="0"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const raw = e.target.value.replace(/[^0-9-]/g, "");
                      updateRow(i, { balance: raw === "" ? 0 : Math.max(0, Number(raw)) });
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
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <span className="font-semibold text-slate-500">채무 리스트 합계 ({loanRecords.length}건)</span>
          <span className="font-bold text-slate-900">{fmtWon(total)}</span>
        </div>
      )}
    </SectionCard>
  );
}
