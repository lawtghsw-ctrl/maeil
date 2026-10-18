"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_MANAGEMENT_SETTINGS, ensureStaffCompensations, normalizeManagementSettings, isManagerProfile, type ManagementSettings } from "@/lib/management-core";
export * from "@/lib/management-core";

const EMPTY_STAFF_NAMES: string[] = [];
export function useManagementSettings(
  profile: { id?: string; lawFirmId?: string; platformRole?: string; role?: string } | null | undefined,
  superAdminFirmScope: { id: string } | null | undefined,
  staffNames: string[] = EMPTY_STAFF_NAMES,
) {
  const staffKey = JSON.stringify(staffNames);
  // Callers may derive an equal array on each render; avoid a request loop.
  const stableStaffNames = useMemo<string[]>(() => JSON.parse(staffKey), [staffKey]);
  const manager = isManagerProfile(profile);
  const effectiveFirmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const globalSuperView = profile?.platformRole === "super_admin" && !superAdminFirmScope;
  const supabase = useMemo(() => createClient(), []);
  const [settingsByFirm, setSettingsByFirm] = useState<Record<string, ManagementSettings>>({});
  const [loading, setLoading] = useState(manager);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const pendingRead = useRef<AbortController | null>(null);
  const revisions = useRef<Record<string, string | null>>({});

  const authHeaders = useCallback(async () => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw new Error(sessionError.message);
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [supabase]);

  const reload = useCallback(async () => {
    const requestId = ++sequence.current;
    pendingRead.current?.abort();
    if (!manager) { setLoading(false); return; }
    const controller = new AbortController();
    pendingRead.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const params = new URLSearchParams();
      if (effectiveFirmId) params.set("firmId", effectiveFirmId);
      const response = await fetch(`/api/admin/management-settings${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || payload?.error || "정산설정을 불러오지 못했습니다.");

      const map: Record<string, ManagementSettings> = {};
      const versions: Record<string, string | null> = {};
      for (const row of payload?.rows ?? []) {
        if (!row?.law_firm_id) continue;
        versions[row.law_firm_id] = row.updated_at ?? null;
        map[row.law_firm_id] = ensureStaffCompensations(
          normalizeManagementSettings(row.value),
          effectiveFirmId === row.law_firm_id ? stableStaffNames : [],
        );
      }
      if (effectiveFirmId && !map[effectiveFirmId]) {
        map[effectiveFirmId] = ensureStaffCompensations(DEFAULT_MANAGEMENT_SETTINGS, stableStaffNames);
        versions[effectiveFirmId] = null;
      }
      if (sequence.current === requestId) { revisions.current = versions; setSettingsByFirm(map); }
    } catch (e) {
      if (sequence.current !== requestId) return;
      const message = controller.signal.aborted ? "정산설정 요청 시간이 초과됐습니다. 다시 불러오기를 눌러주세요." : e instanceof Error ? e.message : "정산설정을 불러오지 못했습니다.";
      setError(message);
      if (effectiveFirmId) {
        setSettingsByFirm((prev) => ({
          ...prev,
          [effectiveFirmId]: prev[effectiveFirmId] ?? ensureStaffCompensations(DEFAULT_MANAGEMENT_SETTINGS, stableStaffNames),
        }));
      }
    } finally {
      clearTimeout(timeout);
      if (sequence.current === requestId) setLoading(false);
    }
  }, [authHeaders, effectiveFirmId, manager, stableStaffNames]);

  useEffect(() => { void reload(); return () => { sequence.current++; pendingRead.current?.abort(); }; }, [reload]);

  const activeSettings = useMemo(() => effectiveFirmId
    ? settingsByFirm[effectiveFirmId] ?? ensureStaffCompensations(DEFAULT_MANAGEMENT_SETTINGS, stableStaffNames)
    : DEFAULT_MANAGEMENT_SETTINGS, [effectiveFirmId, settingsByFirm, stableStaffNames]);

  const save = useCallback(async (next: ManagementSettings) => {
    if (!manager || !effectiveFirmId) throw new Error("대상 로펌을 선택해주세요.");
    if (!(effectiveFirmId in revisions.current)) throw new Error("정산설정을 먼저 다시 불러온 후 저장해주세요.");
    const expectedUpdatedAt = revisions.current[effectiveFirmId];
    const normalized = ensureStaffCompensations(normalizeManagementSettings(next), staffNames);
    const headers = await authHeaders();
    const response = await fetch("/api/admin/management-settings", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ firmId: effectiveFirmId, value: normalized, expectedUpdatedAt }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error || "정산설정 저장에 실패했습니다.");
    const saved = ensureStaffCompensations(normalizeManagementSettings(payload?.value ?? normalized), staffNames);
    revisions.current[effectiveFirmId] = payload.updatedAt ?? null;
    setSettingsByFirm((prev) => ({ ...prev, [effectiveFirmId]: saved }));
    return saved;
  }, [authHeaders, effectiveFirmId, manager, staffNames]);

  return { manager, globalSuperView, effectiveFirmId, activeSettings, settingsByFirm, loading, error, reload, save };
}
