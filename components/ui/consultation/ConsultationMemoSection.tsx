"use client";

// 상담일지 대형 팝업 — "상담메모" 섹션. 기존 ConsultationTabsEditor의 상담메모 탭을 그대로
// 옮긴 것으로, 단일 textarea를 계속 덮어쓰는 방식이 아니라 작성자·시각(초 단위)·태그가
// 함께 남는 게시판(append-only) 형태입니다(Section 18/19). 항목은 memoLog(별도 배열)에
// 쌓이며, 작성자와 시각은 항상 CURRENT_STAFF/new Date()로 서버(=store) 쪽에서 정하듯
// 이 컴포넌트가 직접 채우고, 사용자가 입력할 수 있는 값이 아닙니다.
import { useState, type ChangeEvent } from "react";
import { CURRENT_STAFF } from "@/lib/store";
import type { MemoLogEntry, MemoLogTag } from "@/lib/types";
import { Button } from "@/components/ui/Primitives";
import { SectionCard, textareaClass } from "./shared";
import { fmtDateTime } from "@/lib/format";
import { Plus } from "lucide-react";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

export function ConsultationMemoSection({
  memoLog,
  setMemoLog,
}: {
  memoLog: MemoLogEntry[];
  setMemoLog: Updater<MemoLogEntry[]>;
}) {
  const [memoDraft, setMemoDraft] = useState("");
  const [memoTag, setMemoTag] = useState<MemoLogTag>("일반");

  // 새 항목은 배열 맨 앞에 추가해 최신순으로 쌓이는 게시판 형태를 유지합니다(Section 18).
  // 작성자(staff)·시각(at)은 여기서 서버 값처럼 고정해서 채우며 사용자가 직접 입력하지
  // 못하게 합니다(Section 19).
  function addMemoEntry() {
    if (!memoDraft.trim() && memoTag === "일반") return;
    const entry: MemoLogEntry = {
      id: `MEMO-${Date.now()}`,
      staff: CURRENT_STAFF,
      at: new Date().toISOString(),
      text: memoDraft.trim(),
      tag: memoTag,
    };
    setMemoLog((prev) => [entry, ...prev]);
    setMemoDraft("");
    setMemoTag("일반");
  }

  return (
    <SectionCard title={`상담메모 (${memoLog.length}건, 최신순)`} className="xl:col-span-3">
      <div className="space-y-2.5 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
        <textarea
          className={textareaClass + " min-h-20 bg-white"}
          value={memoDraft}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setMemoDraft(e.target.value)}
          placeholder="상담 진행 내용, 고객 요청사항, 후속 조치 등을 자유롭게 기록하세요."
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">콜 태그</span>
          <button
            type="button"
            onClick={() => setMemoTag((t) => (t === "재통화" ? "일반" : "재통화"))}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              memoTag === "재통화" ? "border-emerald-300 bg-emerald-500 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            재통화
          </button>
          <button
            type="button"
            onClick={() => setMemoTag((t) => (t === "부재중" ? "일반" : "부재중"))}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              memoTag === "부재중" ? "border-red-300 bg-red-500 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            부재중
          </button>
          <Button className="ml-auto px-3 py-1.5" onClick={addMemoEntry} disabled={!memoDraft.trim() && memoTag === "일반"}>
            <Plus size={14} />
            추가
          </Button>
        </div>
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
          [재통화]는 오늘 통화가 연결된 경우, [부재중]은 연결되지 않은 경우에 선택 후 추가해주세요. 하루 [부재중] 3회 또는 [재통화] 1회가
          기록되면 DB관리 고객리스트의 콜 관리 경고가 해제되고, 자정(KST)이 지나면 다시 초기화됩니다.
        </div>
      </div>

      {memoLog.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">
          아직 작성된 메모가 없습니다. 위에서 작성 후 [추가]를 눌러주세요.
        </div>
      ) : (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
          {memoLog.map((entry) => (
            <li key={entry.id} className="px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-900">{entry.staff}</span>
                <span className="text-slate-400">{fmtDateTime(entry.at)}</span>
                {entry.tag !== "일반" && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${entry.tag === "재통화" ? "bg-emerald-500" : "bg-red-500"}`}>{entry.tag}</span>
                )}
              </div>
              {entry.text && <div className="mt-1 whitespace-pre-wrap text-slate-600">{entry.text}</div>}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
