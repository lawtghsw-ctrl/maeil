"use client";

// 상담일지 대형 팝업 — "채무 리스트" 섹션의 상시 노출 테이블. 파일 업로드(DebtUploader)로
// 채워지는 것과 별개로, 상담원이 [+ 추가] 버튼으로 직접 한 건씩 입력/수정/삭제할 수
// 있습니다(수기입력, Section 15). 기본 5~8행만 보이고 나머지는 내부 스크롤로 처리해
// 모달 전체가 늘어나지 않도록 합니다(Section 16).
//
// 삭제 정책: 기존 프로젝트 전체(리드/고객/게시글/첨부파일/기대출리스트 등)를 살펴보면
// soft-delete·비활성화 플래그를 쓰는 곳이 한 곳도 없고 전부 배열에서 즉시 제거하는
// hard delete 방식이라, 이 표의 삭제도 기존 관례를 그대로 따라 hard delete로 구현했습니다
// (Section 15: "기존 시스템에 soft-delete 관례가 있으면 그걸 따르라"는 조건에 대한 확인 결과).
import type { ChangeEvent } from "react";
import type { LoanRecord } from "@/lib/types";
import { LOAN_KIND1_OPTIONS } from "@/lib/types";
import { Input, Select } from "@/components/ui/Primitives";
import { SectionCard } from "./shared";
import { fmtWon } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

export function DebtTable({
  loanRecords,
  setLoanRecords,
}: {
  loanRecords: LoanRecord[];
  setLoanRecords: Updater<LoanRecord[]>;
}) {
  function addRow() {
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

  const total = loanRecords.reduce((a, r) => a + (r.balance || 0), 0);

  return (
    <SectionCard
      title="채무 리스트 (개별 대출 상세)"
      className="xl:col-span-3"
      action={
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <Plus size={13} />
          수기로 추가
        </button>
      }
    >
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              {["구분", "대출종류", "금융사", "실행일", "잔액", "월불입", "출처", "관리"].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loanRecords.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  아직 등록된 대출이 없습니다. 위 &ldquo;수기로 추가&rdquo; 버튼 또는 위쪽 파일 업로드로 채워주세요.
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
                <td className="px-2 py-1">
                  <input
                    inputMode="numeric"
                    className="h-7 w-20 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] outline-none"
                    value={row.monthlyPayment ? row.monthlyPayment.toLocaleString("ko-KR") : ""}
                    placeholder="0"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const raw = e.target.value.replace(/[^0-9-]/g, "");
                      updateRow(i, { monthlyPayment: raw === "" ? 0 : Math.max(0, Number(raw)) });
                    }}
                  />
                </td>
                <td className="px-2 py-1 text-slate-400">{row.source === "file" ? `파일(${row.sourceFileName ?? "-"})` : "수기"}</td>
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
