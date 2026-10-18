import type { MemoLogEntry } from "./types";

type MemoStamp = { at: string; by: string };
type MemoEntries = readonly MemoLogEntry[] | null | undefined;

/** Keep storage chronology intact: it is also used by contact/SMS integrations. */
export function activeMemoEntries(log: MemoEntries): MemoLogEntry[] {
  return (log ?? []).filter(entry => !entry.deletedAt);
}

/** Pin order affects presentation only. Unpinned and tied legacy rows stay stable. */
export function visibleMemoEntries(log: MemoEntries): MemoLogEntry[] {
  const active = activeMemoEntries(log);
  const order = (entry: MemoLogEntry) => Number.isFinite(entry.pinOrder) && entry.pinOrder! >= 0 ? entry.pinOrder! : Number.MAX_SAFE_INTEGER;
  return active.filter(entry => entry.pinned).sort((a, b) => order(a) - order(b))
    .concat(active.filter(entry => !entry.pinned));
}

// A missing/ambiguous legacy ID cannot safely identify one row to edit.
function uniqueIndex(log: readonly MemoLogEntry[], id: string): number {
  if (!id) return -1;
  const index = log.findIndex(entry => entry.id === id);
  return index >= 0 && log.findIndex((entry, at) => at !== index && entry.id === id) === -1 ? index : -1;
}

function updateEntry(log: MemoEntries, id: string, update: (entry: MemoLogEntry) => MemoLogEntry): MemoLogEntry[] {
  const entries = log ?? [], index = uniqueIndex(entries, id);
  return entries.map((entry, at) => at === index ? update(entry) : entry);
}

export function editMemoEntry(log: MemoEntries, id: string, text: string, stamp: MemoStamp): MemoLogEntry[] {
  return updateEntry(log, id, entry => entry.deletedAt || entry.text === text ? entry : {
    ...entry, text, editedAt: stamp.at, editedBy: stamp.by,
    editHistory: [...(entry.editHistory ?? []), { text: entry.text, at: stamp.at, by: stamp.by }],
  });
}

export function deleteMemoEntry(log: MemoEntries, id: string, stamp: MemoStamp): MemoLogEntry[] {
  return updateEntry(log, id, entry => entry.deletedAt ? entry : { ...entry, deletedAt: stamp.at, deletedBy: stamp.by });
}

export function restoreMemoEntry(log: MemoEntries, id: string): MemoLogEntry[] {
  return updateEntry(log, id, entry => {
    if (!entry.deletedAt) return entry;
    const { deletedAt: _at, deletedBy: _by, ...restored } = entry;
    return restored;
  });
}

export function pinMemoEntry(log: MemoEntries, id: string, pinned: boolean): MemoLogEntry[] {
  const activePins = visibleMemoEntries(log).filter(entry => entry.pinned);
  const maxOrder = activePins.reduce((max, entry) => Number.isFinite(entry.pinOrder) && entry.pinOrder! >= 0 ? Math.max(max, entry.pinOrder!) : max, -1);
  return updateEntry(log, id, entry => entry.deletedAt || !!entry.pinned === pinned ? entry
    : pinned ? { ...entry, pinned: true, pinOrder: maxOrder + 1 }
      : { ...entry, pinned: false, pinOrder: undefined });
}

export function reorderPinnedMemos(log: MemoEntries, orderedIds: readonly string[]): MemoLogEntry[] {
  const pins = visibleMemoEntries(log).filter(entry => entry.pinned);
  const currentIds = pins.map(entry => entry.id), wanted = new Set(orderedIds);
  // Reject stale/incomplete drag snapshots instead of moving an unrelated row.
  if (wanted.size !== orderedIds.length || wanted.size !== currentIds.length
    || currentIds.some(id => !id || !wanted.has(id) || uniqueIndex(log ?? [], id) < 0)) return [...(log ?? [])];
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  return (log ?? []).map(entry => !entry.deletedAt && entry.pinned ? { ...entry, pinOrder: order.get(entry.id)! } : entry);
}
