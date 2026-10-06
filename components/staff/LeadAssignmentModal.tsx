"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Clock3, Plus, RefreshCw, Settings2, Trash2, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Modal, Select } from "@/components/ui/Primitives";
import { CONSULT_TIME_OPTIONS, normalizeConsultTimeValue } from "@/lib/types";

type DayType = "all" | "weekday" | "weekend" | "custom";

interface AssignmentStaff {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isWorkStaff: boolean;
  platformRole: string;
}

interface AssignmentMember {
  profileId: string;
  enabled: boolean;
  order: number;
  weight: number;
}

interface AssignmentRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  dayType: DayType;
  weekdays: number[];
  startTime: string;
  endTime: string;
  consultTimeSlots: string[];
  members: AssignmentMember[];
}

interface AssignmentConfig {
  version: 2;
  enabled: boolean;
  timezone: "Asia/Seoul";
  members: AssignmentMember[];
  rules: AssignmentRule[];
}

interface AssignmentPayload {
  lawFirm: { id: string; name: string; status: string };
  staff: AssignmentStaff[];
  config: AssignmentConfig;
}

const CONSULT_TIME_SLOTS = CONSULT_TIME_OPTIONS;

const WEEKDAYS = [
  [1, "월"], [2, "화"], [3, "수"], [4, "목"], [5, "금"], [6, "토"], [7, "일"],
] as const;

function cloneConfig(config: AssignmentConfig): AssignmentConfig {
  const cloned = JSON.parse(JSON.stringify(config)) as AssignmentConfig;
  return {
    ...cloned,
    rules: cloned.rules.map((rule) => ({
      ...rule,
      // 기존 설정의 "주말 오전/주말 오후"도 새 시간표기 슬롯으로 자동 승계합니다.
      consultTimeSlots: Array.from(new Set(rule.consultTimeSlots.map((slot) => normalizeConsultTimeValue(slot) ?? slot))),
    })),
  };
}

function nextRuleId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeOrder(members: AssignmentMember[]) {
  return [...members]
    .sort((a, b) => a.order - b.order || a.profileId.localeCompare(b.profileId))
    .map((member, idx) => ({ ...member, order: idx + 1 }));
}

function percentFor(member: AssignmentMember, members: AssignmentMember[]) {
  const total = members.filter((m) => m.enabled).reduce((sum, m) => sum + Math.max(1, Number(m.weight) || 1), 0);
  if (!member.enabled || total <= 0) return 0;
  return Math.round((Math.max(1, Number(member.weight) || 1) / total) * 1000) / 10;
}

function memberMap(members: AssignmentMember[]) {
  return new Map(members.map((item) => [item.profileId, item]));
}

function createRule(name: string, staff: AssignmentStaff[], dayType: DayType, startTime: string, endTime: string, weekdays: number[] = []): AssignmentRule {
  return {
    id: nextRuleId(),
    name,
    enabled: true,
    priority: 1,
    dayType,
    weekdays,
    startTime,
    endTime,
    consultTimeSlots: [],
    members: staff.map((row, idx) => ({ profileId: row.id, enabled: false, order: idx + 1, weight: 1 })),
  };
}

export function LeadAssignmentModal({
  open,
  onClose,
  lawFirmId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  lawFirmId?: string | null;
  onSaved?: () => void | Promise<void>;
}) {
  const [payload, setPayload] = useState<AssignmentPayload | null>(null);
  const [config, setConfig] = useState<AssignmentConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const api = useCallback(async (method: "GET" | "PATCH", body?: unknown) => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("로그인 세션이 없습니다.");
    const query = lawFirmId ? `?lawFirmId=${encodeURIComponent(lawFirmId)}` : "";
    const response = await fetch(`/api/admin/lead-assignment${query}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "요청에 실패했습니다.");
    return json;
  }, [lawFirmId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const json = await api("GET") as AssignmentPayload;
      setPayload(json);
      setConfig(cloneConfig(json.config));
    } catch (err) {
      setError(err instanceof Error ? err.message : "자동배정 설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const staffById = useMemo(() => new Map((payload?.staff ?? []).map((row) => [row.id, row])), [payload?.staff]);
  const activeBase = useMemo(() => config ? normalizeOrder(config.members.filter((item) => item.enabled)) : [], [config]);

  function patchBase(profileId: string, patch: Partial<AssignmentMember>) {
    setSaved(false);
    setConfig((current) => current ? {
      ...current,
      members: current.members.map((item) => item.profileId === profileId ? { ...item, ...patch } : item),
    } : current);
  }

  function moveBase(profileId: string, direction: -1 | 1) {
    if (!config) return;
    const enabled = normalizeOrder(config.members.filter((item) => item.enabled));
    const index = enabled.findIndex((item) => item.profileId === profileId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= enabled.length) return;
    [enabled[index], enabled[target]] = [enabled[target], enabled[index]];
    const order = new Map(enabled.map((item, idx) => [item.profileId, idx + 1]));
    setConfig({
      ...config,
      members: config.members.map((item) => order.has(item.profileId) ? { ...item, order: order.get(item.profileId)! } : item),
    });
    setSaved(false);
  }

  function addRule(kind: "weekday" | "afterHours" | "weekend" | "custom") {
    if (!payload || !config) return;
    const next = kind === "weekday"
      ? createRule("평일 업무시간", payload.staff, "weekday", "09:00", "18:00")
      : kind === "afterHours"
        ? createRule("평일 퇴근 후", payload.staff, "weekday", "18:00", "23:59")
        : kind === "weekend"
          ? createRule("주말 DB", payload.staff, "weekend", "00:00", "23:59")
          : createRule(`상세 규칙 ${config.rules.length + 1}`, payload.staff, "custom", "00:00", "23:59", [1, 2, 3, 4, 5]);
    next.priority = config.rules.length + 1;
    setConfig({ ...config, rules: [...config.rules, next] });
    setSaved(false);
  }

  function patchRule(ruleId: string, patch: Partial<AssignmentRule>) {
    setSaved(false);
    setConfig((current) => current ? {
      ...current,
      rules: current.rules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule),
    } : current);
  }

  function patchRuleMember(ruleId: string, profileId: string, patch: Partial<AssignmentMember>) {
    setSaved(false);
    setConfig((current) => current ? {
      ...current,
      rules: current.rules.map((rule) => {
        if (rule.id !== ruleId) return rule;
        const exists = rule.members.some((member) => member.profileId === profileId);
        const members = exists
          ? rule.members.map((member) => member.profileId === profileId ? { ...member, ...patch } : member)
          : [...rule.members, { profileId, enabled: false, order: rule.members.length + 1, weight: 1, ...patch }];
        return { ...rule, members };
      }),
    } : current);
  }

  function moveRule(ruleId: string, direction: -1 | 1) {
    if (!config) return;
    const rules = [...config.rules].sort((a, b) => a.priority - b.priority);
    const index = rules.findIndex((rule) => rule.id === ruleId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= rules.length) return;
    [rules[index], rules[target]] = [rules[target], rules[index]];
    setConfig({ ...config, rules: rules.map((rule, idx) => ({ ...rule, priority: idx + 1 })) });
    setSaved(false);
  }

  function toggleWeekday(rule: AssignmentRule, day: number) {
    const weekdays = rule.weekdays.includes(day)
      ? rule.weekdays.filter((value) => value !== day)
      : [...rule.weekdays, day].sort((a, b) => a - b);
    patchRule(rule.id, { weekdays });
  }

  function toggleConsultSlot(rule: AssignmentRule, slot: string) {
    const consultTimeSlots = rule.consultTimeSlots.includes(slot)
      ? rule.consultTimeSlots.filter((value) => value !== slot)
      : [...rule.consultTimeSlots, slot];
    patchRule(rule.id, { consultTimeSlots });
  }

  async function save() {
    if (!config) return;
    const active = config.members.filter((item) => item.enabled);
    if (config.enabled && active.length === 0) {
      setError("자동배정을 켜려면 기본 자동배정 대상 직원을 1명 이상 체크해주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const normalized: AssignmentConfig = {
        ...config,
        members: normalizeOrder(config.members),
        rules: [...config.rules]
          .sort((a, b) => a.priority - b.priority)
          .map((rule, idx) => ({ ...rule, priority: idx + 1, members: normalizeOrder(rule.members) })),
      };
      const json = await api("PATCH", { lawFirmId, config: normalized });
      setConfig(cloneConfig(json.config));
      setSaved(true);
      await onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "자동배정 설정 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`DB 자동배정${payload?.lawFirm?.name ? ` · ${payload.lawFirm.name}` : ""}`}
      onClose={() => !saving && onClose()}
      size="full"
      headerExtra={saved ? <span className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">저장됨</span> : undefined}
    >
      {loading && <div className="grid min-h-[320px] place-items-center text-sm font-semibold text-slate-400">자동배정 설정을 불러오는 중...</div>}
      {!loading && error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
      {!loading && payload && config && (
        <div className="space-y-5 pb-20">
          <Card className="border-blue-100 bg-blue-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-black text-blue-950"><Settings2 size={17} /> 자동배정 기본설정</div>
                <p className="mt-1 max-w-4xl text-xs leading-5 text-blue-800">기본 대상은 평소 신규 DB가 들어올 때 사용하는 배정 풀입니다. 아래 상세규칙과 시간이 맞으면 상세규칙이 우선 적용되고, 맞는 규칙이 없으면 기본 대상의 순서·비율대로 배정됩니다. 시간 기준은 대한민국(Asia/Seoul)입니다.</p>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-900">
                <input type="checkbox" checked={config.enabled} onChange={(e) => { setConfig({ ...config, enabled: e.target.checked }); setSaved(false); }} className="size-4 rounded border-slate-300" />
                DB 자동배정 사용
              </label>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.35fr]">
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900"><UsersRound size={16} /> 1. 자동배정 참여 직원</div>
                <div className="mt-1 text-[11px] text-slate-500">해당 로펌의 직원계정이 모두 표시됩니다. 자동배정에 넣을 사람만 체크하세요.</div>
              </div>
              <div className="divide-y divide-slate-100">
                {payload.staff.map((row) => {
                  const member = memberMap(config.members).get(row.id);
                  const eligible = row.isActive && row.isWorkStaff;
                  return (
                    <label key={row.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${eligible ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/70"}`}>
                      <span className="flex min-w-0 items-center gap-3">
                        <input
                          type="checkbox"
                          disabled={!eligible || !config.enabled}
                          checked={eligible && member?.enabled === true}
                          onChange={(e) => patchBase(row.id, { enabled: e.target.checked })}
                          className="size-4 shrink-0 rounded border-slate-300"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-slate-900">{row.name}</span>
                          <span className="block truncate text-[11px] text-slate-400">{row.email}</span>
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold ${eligible ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                        {!row.isActive ? "비활성" : !row.isWorkStaff ? "실무담당 제외" : member?.enabled ? "자동배정 ON" : "자동배정 OFF"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-sm font-black text-slate-900">2. 기본 자동배정 순서 · 배분비율</div>
                <div className="mt-1 text-[11px] text-slate-500">순서는 위에서 아래로 적용됩니다. 비율은 가중치로 입력하며 오른쪽에 실제 비율이 자동 계산됩니다. 예: 1:1 = 50%/50%, 7:3 = 70%/30%.</div>
              </div>
              <div className="p-3">
                {activeBase.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">왼쪽에서 자동배정 참여 직원을 체크해주세요.</div>
                ) : (
                  <div className="space-y-2">
                    {activeBase.map((member, idx) => {
                      const staff = staffById.get(member.profileId);
                      return (
                        <div key={member.profileId} className="grid items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[42px_minmax(150px,1fr)_90px_120px_90px]">
                          <div className="grid size-8 place-items-center rounded-lg bg-slate-900 text-xs font-black text-white">{idx + 1}</div>
                          <div className="min-w-0"><div className="truncate text-sm font-black text-slate-900">{staff?.name ?? "직원"}</div><div className="truncate text-[11px] text-slate-400">{staff?.email}</div></div>
                          <div className="flex gap-1">
                            <button type="button" disabled={idx === 0} onClick={() => moveBase(member.profileId, -1)} className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-25"><ArrowUp size={14} /></button>
                            <button type="button" disabled={idx === activeBase.length - 1} onClick={() => moveBase(member.profileId, 1)} className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-25"><ArrowDown size={14} /></button>
                          </div>
                          <label className="text-[10px] font-bold text-slate-500">배분 가중치<Input className="mt-1 h-9" type="number" min={1} max={100} value={member.weight} onChange={(e) => patchBase(member.profileId, { weight: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} /></label>
                          <div className="text-right"><div className="text-[10px] font-bold text-slate-400">실제 비율</div><div className="mt-1 text-lg font-black text-blue-700">{percentFor(member, config.members)}%</div></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black text-slate-900"><Clock3 size={16} /> 3. 자동배정 상세설정</div>
                <div className="mt-1 text-[11px] leading-5 text-slate-500">상단 규칙부터 우선 적용됩니다. 요일·유입시간·상담가능시간 피벗을 조합할 수 있고, 특정 규칙에서 직원 1명만 선택하면 해당 시간대 DB를 그 직원에게 전부 몰아줄 수 있습니다.</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="secondary" onClick={() => addRule("weekday")}><Plus size={14} /> 평일 업무시간</Button>
                <Button variant="secondary" onClick={() => addRule("afterHours")}><Plus size={14} /> 평일 퇴근후</Button>
                <Button variant="secondary" onClick={() => addRule("weekend")}><Plus size={14} /> 주말</Button>
                <Button onClick={() => addRule("custom")}><Plus size={14} /> 직접 설정</Button>
              </div>
            </div>

            <div className="space-y-3 p-3">
              {config.rules.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">상세 규칙이 없습니다. 필요하면 우측 상단에서 추가하세요. 규칙이 없어도 기본 자동배정은 정상 작동합니다.</div>}
              {[...config.rules].sort((a, b) => a.priority - b.priority).map((rule, ruleIndex) => {
                const ruleActive = normalizeOrder(rule.members.filter((member) => member.enabled));
                return (
                  <div key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-xs font-black text-white">{ruleIndex + 1}</div>
                        <Input value={rule.name} onChange={(e) => patchRule(rule.id, { name: e.target.value })} className="max-w-[360px] font-bold" />
                        <label className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-slate-600"><input type="checkbox" checked={rule.enabled} onChange={(e) => patchRule(rule.id, { enabled: e.target.checked })} className="size-4 rounded border-slate-300" /> 사용</label>
                      </div>
                      <div className="flex gap-1">
                        <button type="button" disabled={ruleIndex === 0} onClick={() => moveRule(rule.id, -1)} className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-25"><ArrowUp size={14} /></button>
                        <button type="button" disabled={ruleIndex === config.rules.length - 1} onClick={() => moveRule(rule.id, 1)} className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-25"><ArrowDown size={14} /></button>
                        <button type="button" onClick={() => { setConfig({ ...config, rules: config.rules.filter((item) => item.id !== rule.id).map((item, idx) => ({ ...item, priority: idx + 1 })) }); setSaved(false); }} className="grid size-8 place-items-center rounded-md border border-red-200 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-4">
                      <label className="text-xs font-bold text-slate-600">요일 조건<Select className="mt-1 w-full" value={rule.dayType} onChange={(e) => patchRule(rule.id, { dayType: e.target.value as DayType })}><option value="all">매일</option><option value="weekday">평일(월~금)</option><option value="weekend">주말(토·일)</option><option value="custom">요일 직접 선택</option></Select></label>
                      <label className="text-xs font-bold text-slate-600">시작시간<Input className="mt-1" type="time" value={rule.startTime} onChange={(e) => patchRule(rule.id, { startTime: e.target.value || "00:00" })} /></label>
                      <label className="text-xs font-bold text-slate-600">종료시간<Input className="mt-1" type="time" value={rule.endTime} onChange={(e) => patchRule(rule.id, { endTime: e.target.value || "23:59" })} /></label>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-[10px] font-bold text-slate-400">적용 기준</div><div className="mt-1 text-xs font-bold text-slate-700">DB 유입시각(KST) + 선택한 피벗</div><div className="mt-0.5 text-[10px] text-slate-400">종료가 시작보다 이르면 자정 넘김으로 처리</div></div>
                    </div>

                    {rule.dayType === "custom" && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs font-bold text-slate-500">요일</span>{WEEKDAYS.map(([day, label]) => <button key={day} type="button" onClick={() => toggleWeekday(rule, day)} className={`size-8 rounded-md text-xs font-black ${rule.weekdays.includes(day) ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-500"}`}>{label}</button>)}</div>
                    )}

                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-black text-slate-700">상담가능시간 피벗 조건 <span className="font-normal text-slate-400">(선택 안 하면 모든 피벗값에 적용)</span></div>
                      <div className="mt-2 flex flex-wrap gap-2">{CONSULT_TIME_SLOTS.map((slot) => <label key={slot} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${rule.consultTimeSlots.includes(slot) ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600"}`}><input type="checkbox" checked={rule.consultTimeSlots.includes(slot)} onChange={() => toggleConsultSlot(rule, slot)} className="size-3.5 rounded border-slate-300" />{slot}</label>)}</div>
                    </div>

                    <div className="mt-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-black text-slate-700">이 규칙의 배정 대상 · 비율</div><div className="text-[10px] text-slate-400">1명만 체크하면 100% 몰아주기 · 여러 명이면 가중치 비율 배정</div></div>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {payload.staff.filter((row) => row.isActive && row.isWorkStaff).map((row) => {
                          const member = memberMap(rule.members).get(row.id) ?? { profileId: row.id, enabled: false, order: 999, weight: 1 };
                          return (
                            <div key={row.id} className={`rounded-xl border p-3 ${member.enabled ? "border-blue-200 bg-blue-50/50" : "border-slate-200 bg-white"}`}>
                              <div className="flex items-center justify-between gap-2"><label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800"><input type="checkbox" checked={member.enabled} onChange={(e) => patchRuleMember(rule.id, row.id, { enabled: e.target.checked })} className="size-4 rounded border-slate-300" />{row.name}</label>{member.enabled && <span className="text-xs font-black text-blue-700">{percentFor(member, rule.members)}%</span>}</div>
                              {member.enabled && <label className="mt-2 block text-[10px] font-bold text-slate-500">배분 가중치<Input className="mt-1 h-8" type="number" min={1} max={100} value={member.weight} onChange={(e) => patchRuleMember(rule.id, row.id, { weight: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} /></label>}
                            </div>
                          );
                        })}
                      </div>
                      {ruleActive.length === 0 && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">이 규칙에 배정 대상이 없으면 기본 자동배정 대상이 대신 적용됩니다.</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-800">실제 배정 예시</div>
            <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-600 md:grid-cols-3">
              <div className="rounded-lg bg-white p-3"><b>기본 1:1</b><br />직원1 1 / 직원2 1 → 1 → 2 → 1 → 2 순환</div>
              <div className="rounded-lg bg-white p-3"><b>기본 7:3</b><br />직원1 가중치 7 / 직원2 3 → 장기적으로 약 70% / 30%</div>
              <div className="rounded-lg bg-white p-3"><b>주말 몰아주기</b><br />주말 규칙에서 직원1만 체크 → 토·일 유입 DB는 직원1에게 100%</div>
            </div>
          </Card>

          <div className="fixed bottom-3 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur">
            <Button variant="secondary" onClick={() => void load()} disabled={saving}><RefreshCw size={14} /> 다시 불러오기</Button>
            <Button variant="secondary" onClick={onClose} disabled={saving}>닫기</Button>
            <Button onClick={() => void save()} disabled={saving}>{saving ? "저장 중..." : "자동배정 설정 저장"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
