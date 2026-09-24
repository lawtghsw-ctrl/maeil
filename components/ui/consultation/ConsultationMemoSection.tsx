"use client";

// 상담메모는 별도 버튼/팝업으로 숨기지 않고 상담일지 하단에 항상 보이도록 배치합니다.
// 왼쪽에서 바로 입력하고, 아래에는 최신순 메모를 짧은 내부 스크롤로 확인할 수 있습니다.
import { useState, type ChangeEvent } from "react";
import { useStore } from "@/lib/store";
import type { MemoLogEntry, MemoLogTag } from "@/lib/types";
import { Button } from "@/components/ui/Primitives";
import { SectionCard, compactTextareaClass } from "./shared";
import { fmtDateTime } from "@/lib/format";
import { Plus } from "lucide-react";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

export function ConsultationMemoSection({ memoLog, setMemoLog }: { memoLog: MemoLogEntry[]; setMemoLog: Updater<MemoLogEntry[]> }) {
  const { profile, currentUser } = useStore();
  const [memoDraft, setMemoDraft] = useState("");
  const [memoTag, setMemoTag] = useState<MemoLogTag>("일반");

  function addMemoEntry() {
    if (!memoDraft.trim() && memoTag === "일반") return;
    const entry: MemoLogEntry = {
      id: `MEMO-${Date.now()}`,
      staff: profile?.displayName || currentUser?.email || "사용자",
      at: new Date().toISOString(),
      text: memoDraft.trim(),
      tag: memoTag,
    };
    setMemoLog((prev) => [entry, ...prev]);
    setMemoDraft("");
    setMemoTag("일반");
  }

  return (
    <SectionCard title={`상담메모 (${memoLog.length})`} className="h-full min-h-0" bodyClassName="flex min-h-0 flex-col gap-1 p-1">
      <textarea
        className={`${compactTextareaClass} min-h-12 shrink-0`}
        value={memoDraft}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setMemoDraft(e.target.value)}
        placeholder="상담 메모 작성"
      />
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setMemoTag((t) => (t === "재통화" ? "일반" : "재통화"))}
          className={`h-7 rounded border px-2 text-[10px] font-bold ${memoTag === "재통화" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-200 bg-white text-slate-600"}`}
        >
          통화완료
        </button>
        <button
          type="button"
          onClick={() => setMemoTag((t) => (t === "부재중" ? "일반" : "부재중"))}
          className={`h-7 rounded border px-2 text-[10px] font-bold ${memoTag === "부재중" ? "border-slate-500 bg-slate-700 text-white" : "border-slate-200 bg-white text-slate-600"}`}
        >
          부재중
        </button>
        <Button className="ml-auto h-7 px-2 text-[10px] sm:h-7" onClick={addMemoEntry} disabled={!memoDraft.trim() && memoTag === "일반"}>
          <Plus size={12} /> 추가
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-slate-200 bg-white">
        {memoLog.length === 0 ? (
          <div className="grid h-full min-h-16 place-items-center text-[10px] text-slate-400">등록된 메모가 없습니다.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {memoLog.map((entry) => (
              <li key={entry.id} className="px-2 py-1 text-[10px]">
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <b className="text-slate-800">{entry.staff}</b>
                  <span className="text-slate-400">{fmtDateTime(entry.at)}</span>
                  {entry.tag !== "일반" && <span className="rounded bg-slate-100 px-1 font-bold text-slate-600">{entry.tag === "재통화" ? "통화완료" : entry.tag}</span>}
                </div>
                {entry.text && <div className="mt-0.5 whitespace-pre-wrap leading-4 text-slate-600">{entry.text}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
