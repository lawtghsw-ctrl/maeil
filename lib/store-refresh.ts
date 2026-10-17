export const CORE_STORE_TABLES = ["app_leads", "app_clients", "app_cases", "app_installments", "app_schedule_items"] as const;
export const EXTRA_STORE_TABLES = ["app_board_posts", "app_change_logs"] as const;
export const ENTITY_STORE_TABLES = [...CORE_STORE_TABLES, ...EXTRA_STORE_TABLES] as const;
export type StoreEntityTable = typeof ENTITY_STORE_TABLES[number];

export function routeStoreTable(pathname: string): StoreEntityTable | null {
  if (pathname === "/changes" || pathname.startsWith("/changes/")) return "app_change_logs";
  if (pathname === "/board" || pathname.startsWith("/board/")) return "app_board_posts";
  return null;
}

// Supabase JSON rows are plain serializable values. Preserve references only when
// all fields and array ordering match; do not coerce amounts or drop duplicates.
export function retainEqual<T>(previous: T, next: T): T {
  if (previous === next || JSON.stringify(previous) === JSON.stringify(next)) return previous;
  if (!Array.isArray(previous) || !Array.isArray(next)) return next;
  // Queue equal row occurrences, rather than a last-ID-wins map. This preserves
  // duplicate IDs, cross-firm IDs and the exact incoming order while retaining
  // object references for unchanged rows even when another row moves position.
  const rows = new Map<string, { values: unknown[]; used: number }>();
  for (const item of previous) {
    if (!item || typeof item !== "object" || !("id" in item)) continue;
    const key = JSON.stringify(item);
    const bucket = rows.get(key);
    if (bucket) bucket.values.push(item); else rows.set(key, { values: [item], used: 0 });
  }
  return next.map(item => {
    if (!item || typeof item !== "object" || !("id" in item)) return item;
    const bucket = rows.get(JSON.stringify(item));
    return bucket && bucket.used < bucket.values.length ? bucket.values[bucket.used++] : item;
  }) as T;
}

export interface StoreRefreshBatch {
  full: boolean;
  tables: Set<string>;
  isCurrent: () => boolean;
}

// A single reader per provider. Events received while reading form one follow-up
// batch, never concurrent snapshots that can finish in the wrong order.
export function createStoreRefreshQueue(run: (batch: StoreRefreshBatch) => Promise<void>, onError: (error: unknown) => void) {
  let revision = 0;
  let full = false;
  const tables = new Set<string>();
  let waiters: (() => void)[] = [];
  let running: Promise<void> | null = null;
  async function drain() {
    while (full || tables.size) {
      const atRevision = revision;
      const batch = { full, tables: new Set(tables), isCurrent: () => revision === atRevision };
      const completed = waiters;
      full = false; tables.clear(); waiters = [];
      try { await run(batch); } catch (error) { if (batch.isCurrent()) onError(error); }
      finally { completed.forEach(resolve => resolve()); }
    }
  }
  function start() {
    if (running) return;
    running = Promise.resolve().then(drain).finally(() => {
      running = null;
      // A resolved caller can enqueue in the microtask between drain's last
      // iteration and this finalizer. Do not strand that follow-up request.
      if (full || tables.size) start();
    });
  }
  return {
    checkpoint(): () => boolean {
      const atRevision = revision;
      return () => revision === atRevision;
    },
    enqueue(request: { full?: boolean; tables?: readonly string[] }): Promise<void> {
      full ||= request.full === true;
      request.tables?.forEach(table => tables.add(table));
      if (!full && !tables.size) return Promise.resolve();
      const promise = new Promise<void>(resolve => waiters.push(resolve));
      start();
      return promise;
    },
    invalidate() {
      revision++; full = false; tables.clear();
      waiters.forEach(resolve => resolve()); waiters = [];
    },
  };
}
