"use client";
import { useEffect, useState } from "react";
import { authJson } from "@/lib/platform/client";
import type { FirmSupplySummary } from "@/lib/firm-reporting";

export function useFirmSupply(firmId: string | undefined, start: string, end: string, enabled = true, revision = 0) {
  const key = enabled && firmId ? `${firmId}:${start}:${end}:${revision}` : "";
  const [state, setState] = useState<{ key: string; data: FirmSupplySummary | null; error: string | null; loading: boolean }>({ key: "", data: null, error: null, loading: false });
  useEffect(() => {
    if (!key || !firmId) return;
    const controller = new AbortController();
    setState({ key, data: null, error: null, loading: true });
    const params = new URLSearchParams({ firmId, start, end });
    void authJson<FirmSupplySummary>(`/api/admin/firm-supply?${params}`, { signal: controller.signal, cache: "no-store" }).then(data => {
      if (!controller.signal.aborted) setState({ key, data, error: null, loading: false });
    }).catch(error => { if (!controller.signal.aborted) setState({ key, data: null, error: error instanceof Error ? error.message : "공급 원장을 읽지 못했습니다.", loading: false }); });
    return () => controller.abort();
  }, [key, firmId, start, end]);
  return state.key === key ? state : { key, data: null, error: null, loading: !!key };
}
