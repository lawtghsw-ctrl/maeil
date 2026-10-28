"use client";

import { useEffect, useState } from "react";
import { authJson } from "@/lib/platform/client";
import type { CaseRecord, Client, DbLead, Installment } from "@/lib/types";

export interface AnalyticsSourceData {
  firmId: string;
  complete: true;
  counts: { leads: number; cases: number; clients: number; installments: number };
  leads: DbLead[];
  cases: CaseRecord[];
  clients: Client[];
  installments: Installment[];
  loadedAt: string;
}

interface AnalyticsSourceState {
  key: string;
  data: AnalyticsSourceData | null;
  error: string | null;
  loading: boolean;
}

const ENTITIES = ["leads", "cases", "clients", "installments"] as const;
type Entity = typeof ENTITIES[number];
interface SourcePage {
  firmId: string;
  entity: Entity;
  cursor: string | null;
  rows: Array<{ id: string; _lawFirmId: string }>;
  count: number;
  nextCursor: string | null;
  complete: boolean;
}

/** Read all HTTP pages before exposing ANY arrays to statistics or exports. */
export async function fetchAnalyticsSource(firmId: string, signal: AbortSignal): Promise<AnalyticsSourceData> {
  async function readEntity(entity: Entity) {
    const result: SourcePage["rows"] = [];
    let cursor: string | null = null;
    const seenIds = new Set<string>();
    for (;;) {
      if (signal.aborted) throw new Error("집계 자료 요청이 취소되었습니다.");
      const params = new URLSearchParams({ firmId, entity });
      if (cursor) params.set("after", cursor);
      const page = await authJson<SourcePage>(`/api/admin/analytics-source?${params}`, { signal, cache: "no-store" });
      if (signal.aborted) throw new Error("집계 자료 요청이 취소되었습니다.");
      if (!page || page.firmId !== firmId || page.entity !== entity || page.cursor !== cursor
        || !Array.isArray(page.rows) || page.rows.length > 50 || !Number.isInteger(page.count)
        || page.count !== page.rows.length || typeof page.complete !== "boolean") {
        throw new Error("전체 집계 자료의 범위 또는 페이지 건수를 확인할 수 없습니다. 다시 불러와주세요.");
      }
      if (page.rows.length === 0) {
        if (!page.complete || page.nextCursor !== null) throw new Error("집계 자료의 마지막 페이지를 확인할 수 없습니다.");
        return result;
      }
      if (page.complete) throw new Error("일부 집계 자료를 전체 자료로 표시할 수 없습니다.");
      // The database collation owns ordering. JavaScript string comparison can
      // reject valid legacy mixed-case / underscore / hyphen ID pages.
      let lastId: string | null = null;
      for (const row of page.rows) {
        if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id
          || row._lawFirmId !== firmId || seenIds.has(row.id)) {
          throw new Error("집계 자료의 페이지 순서 또는 로펌 범위를 확인할 수 없습니다.");
        }
        seenIds.add(row.id);
        lastId = row.id;
      }
      if (page.nextCursor !== lastId) throw new Error("다음 집계 자료 페이지를 확인할 수 없습니다.");
      result.push(...page.rows);
      cursor = lastId;
    }
  }
  const [leads, cases, clients, installments] = await Promise.all(ENTITIES.map(readEntity));
  return { firmId, complete: true,
    counts: { leads: leads.length, cases: cases.length, clients: clients.length, installments: installments.length },
    leads, cases, clients, installments, loadedAt: new Date().toISOString(),
  } as AnalyticsSourceData;
}

/** Do not render/export a partial, mismatched, or stale cross-firm response. */
export function isCompleteAnalyticsSource(value: unknown, firmId: string): value is AnalyticsSourceData {
  if (!value || typeof value !== "object") return false;
  const data = value as AnalyticsSourceData;
  if (data.complete !== true || data.firmId !== firmId || !data.counts
    || typeof data.loadedAt !== "string" || !Number.isFinite(Date.parse(data.loadedAt))) return false;
  return ENTITIES.every(key => {
    const rows = data[key], count = data.counts[key];
    if (!Array.isArray(rows) || !Number.isInteger(count) || count < 0 || count !== rows.length) return false;
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id
        || row._lawFirmId !== firmId || ids.has(row.id)) return false;
      ids.add(row.id);
    }
    return true;
  });
}

/** sourceToken can invalidate after local edits; revision supports a visible refresh button. */
export function useAnalyticsSource(firmId: string | undefined, enabled = true, revision = 0, sourceToken = "") {
  const [retryRevision, setRetryRevision] = useState(0);
  const key = enabled && firmId ? JSON.stringify([firmId, revision, sourceToken, retryRevision]) : "";
  const [state, setState] = useState<AnalyticsSourceState>({ key: "", data: null, error: null, loading: false });

  useEffect(() => {
    if (!key || !firmId) return;
    const controller = new AbortController();
    let active = true;
    setState({ key, data: null, error: null, loading: true });
    // Full history needs multiple sequential pages per entity, especially on cold starts.
    // Bound the entire refresh while still aborting all peers on any error or scope change.
    const timeout = setTimeout(() => {
      if (!active) return;
      controller.abort();
      setState({ key, data: null, error: "전체 집계 자료 요청 시간이 초과됐습니다. 다시 불러오기를 눌러주세요.", loading: false });
    }, 120_000);
    void fetchAnalyticsSource(firmId, controller.signal).then(data => {
      if (!active || controller.signal.aborted) return;
      if (!isCompleteAnalyticsSource(data, firmId)) throw new Error("전체 집계 자료의 범위 또는 건수를 확인할 수 없습니다. 다시 불러와주세요.");
      setState({ key, data, error: null, loading: false });
    }).catch(error => {
      if (active && !controller.signal.aborted) {
        setState({ key, data: null, error: error instanceof Error ? error.message : "전체 집계 자료를 읽지 못했습니다.", loading: false });
        controller.abort();
      }
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [key, firmId]);

  const visible = state.key === key ? state : { key, data: null, error: null, loading: !!key };
  return { ...visible, retry: () => setRetryRevision(value => value + 1) };
}
