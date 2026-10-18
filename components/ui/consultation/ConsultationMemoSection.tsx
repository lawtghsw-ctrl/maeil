"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useStoreSession as useStore } from "@/lib/store";
import type { MemoLogEntry, MemoLogTag } from "@/lib/types";
import { activeMemoEntries, visibleMemoEntries, editMemoEntry, deleteMemoEntry, restoreMemoEntry, pinMemoEntry, reorderPinnedMemos } from "@/lib/consultation-memos";
import { Button } from "@/components/ui/Primitives";
import { SectionCard, compactTextareaClass } from "./shared";
import { fmtDateTime } from "@/lib/format";
import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import type { ConsultationPdfMemoDraft } from "@/lib/consultation-pdf-data";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;
type MemoEdit = { original: MemoLogEntry; at: string; by: string };

export function ConsultationMemoSection({ memoLog, setMemoLog, onDraftChange, readOnly = false, generalMemoTag = "부재중" }: {
  memoLog: MemoLogEntry[];
  setMemoLog: Updater<MemoLogEntry[]>;
  onDraftChange?: (draft: ConsultationPdfMemoDraft) => void;
  readOnly?: boolean;
  generalMemoTag?: "일반" | "부재중";
}) {
  const { profile, currentUser } = useStore();
  const [memoDraft, setMemoDraft] = useState("");
  const [memoTag, setMemoTag] = useState<MemoLogTag>("일반");
  const [editing, setEditing] = useState<MemoEdit | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draftStaff = profile?.displayName || currentUser?.email || "사용자";
  const entries = visibleMemoEntries(memoLog);
  const pinned = entries.filter(entry => entry.pinned === true);
  const pinPositions = new Map(pinned.map((entry, index) => [entry.id, index]));
  const idCounts = new Map<string, number>();
  for (const entry of memoLog) idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
  const removed = memoLog.filter(entry => !!entry.deletedAt);
  const controlsDisabled = readOnly || !!editing;
  const editable = () => !readOnly && !containerRef.current?.closest("fieldset[disabled]");
  const audit = () => ({ at: new Date().toISOString(), by: draftStaff });
  useEffect(() => { onDraftChange?.({ text: memoDraft, tag: memoTag, staff: draftStaff }); }, [memoDraft, memoTag, draftStaff, onDraftChange]);

  function addMemoEntry() {
    if (!editable() || (!memoDraft.trim() && memoTag === "일반")) return;
    const entry: MemoLogEntry = {
      id: `MEMO-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      staff: draftStaff,
      at: new Date().toISOString(),
      text: memoDraft.trim(),
      // Preserve the existing new-general-memo contact policy.
      tag: memoTag === "일반" ? generalMemoTag : memoTag,
    };
    setMemoLog(prev => [entry, ...prev]);
    setMemoDraft(""); setMemoTag("일반");
  }

  function beginEdit(entry: MemoLogEntry) {
    if (!editable() || editing || !entry.id || idCounts.get(entry.id) !== 1) return;
    setEditing({ original: entry, ...audit() });
  }
  function changeText(text: string) {
    if (!editable() || !editing) return;
    // Rebuild from the edit-start snapshot: one audit entry per editing session,
    // while every keystroke reaches the parent's save/PDF/local draft immediately.
    const edited = editMemoEntry([editing.original], editing.original.id, text, editing)[0];
    setMemoLog(prev => prev.filter(entry => entry.id === editing.original.id).length === 1 ? prev.map(entry => entry.id === editing.original.id && !entry.deletedAt ? edited : entry) : prev);
  }
  function cancelEdit() {
    if (!editable() || !editing) return;
    const original = editing.original;
    setMemoLog(prev => prev.filter(entry => entry.id === original.id).length === 1 ? prev.map(entry => entry.id === original.id && !entry.deletedAt ? original : entry) : prev);
    setEditing(null);
  }
  function removeEntry(id: string) {
    if (!editable() || editing) return;
    const stamp = audit();
    setMemoLog(prev => deleteMemoEntry(prev, id, stamp));
  }
  function restoreEntry(id: string) {
    if (!editable() || editing) return;
    setMemoLog(prev => restoreMemoEntry(prev, id));
  }
  function setPinned(id: string, value: boolean) {
    if (!editable() || editing) return;
    setMemoLog(prev => pinMemoEntry(prev, id, value));
  }
  function movePinned(id: string, targetId: string) {
    if (!editable() || editing || id === targetId) return;
    setMemoLog(prev => {
      const ids = visibleMemoEntries(prev).filter(entry => entry.pinned === true).map(entry => entry.id);
      const from = ids.indexOf(id), to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      ids.splice(from, 1); ids.splice(to, 0, id);
      return reorderPinnedMemos(prev, ids);
    });
  }
  function startDrag(event: DragEvent<HTMLButtonElement>, id: string) {
    if (!editable() || editing || pinned.length < 2) { event.preventDefault(); return; }
    dragRef.current = id; setDraggedId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
  function endDrag() { dragRef.current = null; setDraggedId(null); }
  function dropOn(event: DragEvent<HTMLLIElement>, targetId: string) {
    if (!editable() || editing || !dragRef.current) return;
    event.preventDefault(); movePinned(dragRef.current, targetId); endDrag();
  }

  return <div ref={containerRef} className="h-full min-h-0">
    <SectionCard title={`상담메모 (${activeMemoEntries(memoLog).length})`} className="h-full min-h-0" bodyClassName="flex min-h-0 flex-col gap-1 p-1">
      <textarea className={`${compactTextareaClass} min-h-12 shrink-0`} value={memoDraft} disabled={readOnly}
        aria-label="새 상담 메모" onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { if (editable()) setMemoDraft(event.target.value); }}
        placeholder={generalMemoTag === "부재중" ? "상담 메모 작성 (일반 메모 추가 시 부재중 1회로 기록)" : "상담 진행 내용, 고객 요청사항, 후속 조치 등을 기록하세요."}/>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" disabled={readOnly} onClick={() => { if (editable()) setMemoTag(tag => tag === "재통화" ? "일반" : "재통화"); }} className={`h-7 rounded border px-2 text-[10px] font-bold ${memoTag === "재통화" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-200 bg-white text-slate-600"}`}>통화완료</button>
        <button type="button" disabled={readOnly} onClick={() => { if (editable()) setMemoTag(tag => tag === "부재중" ? "일반" : "부재중"); }} className={`h-7 rounded border px-2 text-[10px] font-bold ${memoTag === "부재중" ? "border-slate-500 bg-slate-700 text-white" : "border-slate-200 bg-white text-slate-600"}`}>부재중</button>
        <Button className="ml-auto h-7 px-2 text-[10px] sm:h-7" onClick={addMemoEntry} disabled={readOnly || (!memoDraft.trim() && memoTag === "일반")}><Plus size={12}/> 추가</Button>
      </div>
      {!readOnly && <p className="px-1 text-[10px] leading-4 text-slate-500">변경 후 상담일지 저장 · 체크한 메모는 상단 고정{pinned.length > 1 ? " · 끌기 또는 위/아래로 순서 변경" : ""}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-slate-200 bg-white">
        {!entries.length ? <div className="grid h-full min-h-16 place-items-center text-[10px] text-slate-400">등록된 메모가 없습니다.</div> : <ul className="divide-y divide-slate-100">
          {entries.map((entry, displayIndex) => {
            const pinIndex = pinPositions.get(entry.id) ?? -1;
            const rowDisabled = controlsDisabled || !entry.id || idCounts.get(entry.id) !== 1;
            const isEditing = editing?.original.id === entry.id;
            return <li key={idCounts.get(entry.id) === 1 ? entry.id : `${entry.id}:${displayIndex}`} data-memo-id={entry.id}
              onDragOver={event => { if (editable() && !editing && dragRef.current && entry.pinned) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
              onDrop={event => { if (entry.pinned) dropOn(event, entry.id); }}
              className={`grid grid-cols-[minmax(0,1fr)_30px] gap-1 px-2 py-1.5 text-[10px] ${entry.pinned ? "bg-amber-50/60" : ""} ${draggedId === entry.id ? "opacity-50" : ""}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1">
                  <b className="text-slate-800">{entry.staff}</b><span className="text-slate-400">{fmtDateTime(entry.at)}</span>
                  {entry.tag !== "일반" && <span className="rounded bg-slate-100 px-1 font-bold text-slate-600">{entry.tag === "재통화" ? "통화완료" : entry.tag}</span>}
                  {(!entry.id || idCounts.get(entry.id) !== 1) && <span className="text-amber-700">식별자 확인 필요 · 변경 불가</span>}{entry.pinned && <span className="font-bold text-amber-700">고정 {pinIndex + 1}</span>}{entry.editedAt && <span className="text-slate-400">수정됨</span>}
                </div>
                {isEditing ? <div className="mt-1 space-y-1">
                  <textarea aria-label={`${entry.staff} 메모 내용 수정`} value={entry.text} disabled={readOnly} onChange={event => changeText(event.target.value)} className={`${compactTextareaClass} min-h-16`}/>
                  <div className="flex gap-1"><button type="button" disabled={readOnly} onClick={() => { if (editable()) setEditing(null); }} className="rounded bg-blue-600 px-2 py-1 font-bold text-white">편집 적용</button><button type="button" disabled={readOnly} onClick={cancelEdit} className="rounded border px-2 py-1 text-slate-600">편집 취소</button></div>
                  <p className="text-slate-500">입력 내용은 임시본·저장·PDF에 바로 반영됩니다. 취소하면 편집 전 내용으로 돌아갑니다.</p>
                </div> : entry.text ? <div className="mt-0.5 whitespace-pre-wrap break-words leading-4 text-slate-600">{entry.text}</div> : null}
                {!readOnly && !isEditing && <div className="mt-1 flex items-center gap-1">
                  <button type="button" disabled={rowDisabled} onClick={() => beginEdit(entry)} className="rounded border px-1.5 py-0.5 text-slate-600 disabled:opacity-40" aria-label={`${entry.staff} 메모 수정`}>수정</button>
                  <button type="button" disabled={rowDisabled} onClick={() => removeEntry(entry.id)} className="rounded border px-1.5 py-0.5 text-red-600 disabled:opacity-40" aria-label={`${entry.staff} 메모 삭제`}>삭제</button>
                  {entry.pinned && pinned.length > 1 && <div className="ml-auto flex items-center gap-0.5">
                    <button type="button" draggable={!controlsDisabled} disabled={controlsDisabled} onDragStart={event => startDrag(event, entry.id)} onDragEnd={endDrag} aria-label={`${entry.staff} 고정 메모 끌어서 순서 변경`} title="끌어서 고정 순서 변경" className="cursor-grab rounded p-1 text-slate-400 disabled:opacity-40"><GripVertical size={12}/></button>
                    <button type="button" disabled={controlsDisabled || pinIndex === 0} onClick={() => movePinned(entry.id, pinned[pinIndex-1]?.id)} aria-label={`${entry.staff} 고정 메모 위로`} className="rounded border p-1 text-slate-500 disabled:opacity-30"><ArrowUp size={11}/></button>
                    <button type="button" disabled={controlsDisabled || pinIndex === pinned.length-1} onClick={() => movePinned(entry.id, pinned[pinIndex+1]?.id)} aria-label={`${entry.staff} 고정 메모 아래로`} className="rounded border p-1 text-slate-500 disabled:opacity-30"><ArrowDown size={11}/></button>
                  </div>}
                </div>}
              </div>
              <label className="flex w-[30px] flex-col items-center gap-0.5 self-start pt-0.5 text-slate-400"><input type="checkbox" checked={entry.pinned === true} disabled={rowDisabled} onChange={event => setPinned(entry.id, event.target.checked)} aria-label={`${entry.staff} 메모 상단 고정`} className="size-3.5 accent-amber-600"/><span>고정</span></label>
            </li>;
          })}
        </ul>}
      </div>
      {removed.length > 0 && <details className="shrink-0 rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-500">
        <summary className="cursor-pointer">삭제한 메모 {removed.length}건 · 복원</summary>
        <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto">{removed.map(entry => <li key={entry.id} className="flex items-start justify-between gap-2 rounded bg-slate-50 p-1.5"><div className="min-w-0"><b>{entry.staff}</b> · {fmtDateTime(entry.at)}<p className="whitespace-pre-wrap break-words">{entry.text || "태그 메모"}</p></div><button type="button" disabled={controlsDisabled || !entry.id || idCounts.get(entry.id) !== 1} onClick={() => restoreEntry(entry.id)} aria-label={`${entry.staff} 삭제한 메모 복원`} className="shrink-0 rounded border bg-white px-2 py-1 disabled:opacity-40">복원</button></li>)}</ul>
      </details>}
    </SectionCard>
  </div>;
}
