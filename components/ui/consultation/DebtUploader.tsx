"use client";

// 상담일지 대형 팝업 — 채무파일 업로드(Drag & Drop) + 자동분석 Preview/적용 흐름.
// 파일 업로드 즉시 DB(=store)에 반영하지 않고, 항상 "분석 → Preview → 사용자 확인 →
// 적용" 순서를 거칩니다. 파싱 실패해도(허용되지 않는 형식, 인식 불가 등) 상담일지
// 전체가 오류나지 않도록 항상 안내 메시지로 처리합니다.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { AttachedFileMeta, LoanRecord } from "@/lib/types";
import { Button } from "@/components/ui/Primitives";
import { findLikelyDuplicate, parseDebtFile, type ParsedDebtItem } from "@/lib/debt-parsers";
import { fmtWon } from "@/lib/format";
import { Paperclip, Upload } from "lucide-react";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

interface PreviewRow {
  item: ParsedDebtItem;
  dupOf: LoanRecord | undefined;
  include: boolean; // 신규로 추가할지 — 중복 의심 항목은 기본 false(기존 유지)
}

const ALLOWED_EXT = ["xlsx", "xls", "csv", "pdf"];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

export function DebtUploader({
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
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewFileName, setPreviewFileName] = useState("");

  function registerAttachment(file: File) {
    const meta: AttachedFileMeta = {
      id: `FILE-${Date.now()}`,
      name: file.name,
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
      attachedAt: new Date().toISOString(),
    };
    setAttachedFiles((prev) => [...prev, meta]);
  }

  async function handleFile(file: File) {
    setErrorMsg(null);
    setPreview(null);
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!ALLOWED_EXT.includes(ext)) {
      setErrorMsg("지원하지 않는 파일 형식입니다 (.xlsx, .xls, .csv, .pdf만 첨부할 수 있습니다).");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrorMsg("파일 용량이 너무 큽니다 — 20MB 이하 파일만 첨부할 수 있습니다.");
      return;
    }
    // 자동분석 성공 여부와 무관하게, 원본 파일은 첨부목록에 우선 등록합니다(파일명은
    // 여기서는 그대로 보여주지만 실제 저장 경로는 UUID 등으로 별도 관리해야 함 — 아래
    // 28번 보안 항목 참고 주석).
    registerAttachment(file);
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
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
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

  const includeCount = preview?.filter((r) => r.include).length ?? 0;

  return (
    <div className="space-y-2.5">
      <div
        onDragOver={(e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${
          dragOver ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50"
        }`}
      >
        <Upload size={18} className="text-slate-400" />
        <div className="text-xs text-slate-500">
          {busy ? "파일을 분석하는 중입니다…" : "채무 파일을 이곳에 끌어다 놓으세요 (.xlsx / .xls / .csv / .pdf)"}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          <Paperclip size={13} />
          파일 선택
        </Button>
        <a href="https://www.credit4u.or.kr" target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-blue-600 underline">
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
              &ldquo;중복 의심&rdquo; 항목은 기존 채무 리스트에 비슷한 항목이 이미 있어 기본은 제외(기존 유지)로 체크가 꺼져 있습니다 — 실제로 새로 추가해야 하면 체크해주세요.
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
    </div>
  );
}
