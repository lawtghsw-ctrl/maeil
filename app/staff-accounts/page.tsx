"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Plus, RefreshCw, Search, ShieldCheck, UserCog, UserRoundCheck, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_STAFF_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_PRESETS,
  normalizePermissions,
  type PermissionKey,
  type PermissionMap,
} from "@/lib/permissions";
import { Button, Card, Input, Modal, PageHeader, Select } from "@/components/ui/Primitives";

interface StaffAccountRow {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "staff";
  staffName: string;
  isActive: boolean;
  isWorkStaff: boolean;
  autoAssignLeads: boolean;
  leadAssignmentOrder: number;
  permissions: PermissionMap;
  createdAt?: string | null;
  lastSignInAt?: string | null;
}

interface AccountDraft {
  email: string;
  password: string;
  displayName: string;
  role: "admin" | "staff";
  isActive: boolean;
  isWorkStaff: boolean;
  autoAssignLeads: boolean;
  leadAssignmentOrder: number;
  permissions: PermissionMap;
}

const emptyDraft = (): AccountDraft => ({
  email: "",
  password: "",
  displayName: "",
  role: "staff",
  isActive: false,
  isWorkStaff: true,
  autoAssignLeads: true,
  leadAssignmentOrder: 1000,
  permissions: { ...DEFAULT_STAFF_PERMISSIONS },
});

function fmtDateTime(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function permissionCount(map: PermissionMap) {
  return ALL_PERMISSION_KEYS.filter((key) => map[key] === true).length;
}

function PermissionEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: PermissionMap;
  onChange: (next: PermissionMap) => void;
  disabled?: boolean;
}) {
  function toggle(key: PermissionKey) {
    if (disabled) return;
    onChange(normalizePermissions({ ...value, [key]: !value[key] }));
  }

  function setGroup(keys: readonly PermissionKey[], checked: boolean) {
    if (disabled) return;
    const next = { ...value };
    for (const key of keys) next[key] = checked;
    onChange(normalizePermissions(next));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <div>
          <div className="text-xs font-bold text-slate-700">세부 권한</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{permissionCount(value)} / {ALL_PERMISSION_KEYS.length}개 허용</div>
        </div>
        {!disabled && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onChange(normalizePermissions(Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, true])) as PermissionMap))} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">전체 선택</button>
            <button type="button" onClick={() => onChange({})} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">전체 해제</button>
          </div>
        )}
      </div>

      {PERMISSION_GROUPS.map((group) => {
        const keys = group.items.map((item) => item[0]) as PermissionKey[];
        const allChecked = keys.every((key) => value[key] === true);
        return (
          <Card key={group.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div>
                <div className="text-sm font-bold text-slate-900">{group.label}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{group.description}</div>
              </div>
              {!disabled && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={allChecked} onChange={(e) => setGroup(keys, e.target.checked)} className="size-4 rounded border-slate-300" />
                  이 영역 전체
                </label>
              )}
            </div>
            <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
              {group.items.map(([key, label, description]) => (
                <label key={key} className={`flex gap-3 bg-white px-4 py-3 ${disabled ? "cursor-default" : "cursor-pointer hover:bg-blue-50/40"}`}>
                  <input type="checkbox" checked={disabled || value[key] === true} disabled={disabled} onChange={() => toggle(key)} className="mt-0.5 size-4 shrink-0 rounded border-slate-300" />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-800">{label}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{description}</span>
                  </span>
                </label>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange, disabled = false }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-3 ${disabled ? "bg-slate-50" : "cursor-pointer bg-white hover:bg-slate-50"}`}>
      <span>
        <span className="block text-sm font-bold text-slate-800">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-5 shrink-0 rounded border-slate-300" />
    </label>
  );
}

export default function StaffAccountsPage() {
  const { currentUser, isAdmin, reloadData } = useStore();
  const [rows, setRows] = useState<StaffAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<AccountDraft>(() => emptyDraft());
  const [editing, setEditing] = useState<StaffAccountRow | null>(null);
  const [editPassword, setEditPassword] = useState("");

  const api = useCallback(async (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, queryString = "") => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("로그인 세션이 없습니다.");
    const response = await fetch(`/api/admin/users${queryString}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "요청에 실패했습니다.");
    return json;
  }, []);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const json = await api("GET");
      setRows(json.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "직원계정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [api, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.displayName} ${row.email} ${row.staffName}`.toLowerCase().includes(needle));
  }, [query, rows]);

  const summary = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.isActive).length,
    admins: rows.filter((row) => row.role === "admin" && row.isActive).length,
    workStaff: rows.filter((row) => row.isWorkStaff).length,
  }), [rows]);

  function applyPreset(presetId: string, setter: (next: PermissionMap) => void) {
    const preset = PERMISSION_PRESETS.find((item) => item.id === presetId);
    if (preset) setter(normalizePermissions({ ...preset.permissions }));
  }

  async function createAccount() {
    if (!draft.displayName.trim() || !draft.email.trim() || draft.password.length < 8) {
      setError("직원명, 이메일, 8자 이상 임시 비밀번호를 입력해주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("POST", { ...draft, permissions: normalizePermissions(draft.permissions) });
      setCreateOpen(false);
      setDraft(emptyDraft());
      await Promise.all([load(), reloadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "계정 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEditing() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", {
        id: editing.id,
        email: editing.email,
        displayName: editing.displayName,
        role: editing.role,
        isActive: editing.isActive,
        isWorkStaff: editing.isWorkStaff,
        autoAssignLeads: editing.autoAssignLeads,
        leadAssignmentOrder: editing.leadAssignmentOrder,
        permissions: normalizePermissions(editing.permissions),
        password: editPassword || undefined,
      });
      setEditing(null);
      setEditPassword("");
      await Promise.all([load(), reloadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "계정 수정에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(row: StaffAccountRow) {
    if (row.id === currentUser?.id) {
      setError("현재 로그인한 본인 계정은 삭제할 수 없습니다.");
      return;
    }
    if (!window.confirm(`${row.displayName} 계정을 영구 삭제하시겠습니까?\n\n업무 데이터는 삭제되지 않지만 이 계정은 더 이상 로그인할 수 없습니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api("DELETE", undefined, `?id=${encodeURIComponent(row.id)}`);
      setEditing(null);
      await Promise.all([load(), reloadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "계정 삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <>
      <PageHeader
        title="직원계정관리"
        description="최종관리자 전용 · 계정 생성/활성화/실무 담당자 지정/메뉴·기능별 세부 권한을 즉시 적용합니다."
        action={<div className="flex gap-2"><Button variant="secondary" onClick={() => void load()}><RefreshCw size={14} /> 새로고침</Button><Button onClick={() => { setDraft(emptyDraft()); setCreateOpen(true); }}><Plus size={15} /> 직원계정 생성</Button></div>}
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card className="border-blue-100 bg-blue-50 p-4 lg:col-span-2">
          <div className="flex items-start gap-3">
            <UserCog size={18} className="mt-0.5 shrink-0 text-blue-700" />
            <div>
              <div className="text-sm font-black text-blue-900">권한 저장 즉시 적용</div>
              <p className="mt-1 text-xs leading-5 text-blue-700">메뉴 노출, 본인/전체 데이터 범위, 금액정보, 상담일지, 진행단계, 예약, 분납, 정산, 집계 권한이 저장 즉시 반영됩니다. 이미 로그인 중인 직원도 Realtime으로 프로필 변경을 다시 받아옵니다.</p>
            </div>
          </div>
        </Card>
        <Card className="border-emerald-100 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <UserRoundCheck size={18} className="mt-0.5 shrink-0 text-emerald-700" />
            <div>
              <div className="text-sm font-black text-emerald-900">담당자 버튼 + 신규 DB 자동배정</div>
              <p className="mt-1 text-xs leading-5 text-emerald-700">‘실무 담당자로 사용’을 켜면 DB관리 담당자 버튼에 자동 추가됩니다. 활성 계정에서 ‘신규 DB 자동배정 참여’까지 켜면 Google Sheet 신규 DB가 배정 순서대로 1건씩 균등 분배됩니다.</p>
            </div>
          </div>
        </Card>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          { label: "전체 계정", value: summary.total, Icon: UsersRound },
          { label: "활성 계정", value: summary.active, Icon: UserRoundCheck },
          { label: "최종관리자", value: summary.admins, Icon: ShieldCheck },
          { label: "실무 담당자", value: summary.workStaff, Icon: UserCog },
        ] satisfies Array<{ label: string; value: number; Icon: LucideIcon }>).map(({ label, value, Icon }) => (
          <Card key={label} className="flex items-center gap-3 p-4">
            <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon size={18} /></div>
            <div><div className="text-xs font-semibold text-slate-500">{label}</div><div className="mt-0.5 text-xl font-black text-slate-900">{value}</div></div>
          </Card>
        ))}
      </div>

      <Card className="mb-4 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="직원명 또는 이메일 검색" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>{["직원", "구분", "상태", "실무 담당자", "DB 자동배정", "권한", "최근 로그인", ""].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3"><div className="font-bold text-slate-900">{row.displayName}</div><div className="mt-0.5 text-xs text-slate-400">{row.email}</div></td>
                  <td className="px-4 py-3"><span className={`rounded-md px-2 py-1 text-xs font-bold ${row.role === "admin" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"}`}>{row.role === "admin" ? "최종관리자" : "직원"}</span></td>
                  <td className="px-4 py-3"><span className={`rounded-md px-2 py-1 text-xs font-bold ${row.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{row.isActive ? "활성" : "비활성"}</span></td>
                  <td className="px-4 py-3">{row.isWorkStaff ? <span className="font-semibold text-blue-700">사용</span> : <span className="text-slate-400">제외</span>}</td>
                  <td className="px-4 py-3">{row.isActive && row.isWorkStaff && row.autoAssignLeads ? <span className="font-semibold text-emerald-700">참여 · {row.leadAssignmentOrder}</span> : <span className="text-slate-400">제외</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{row.role === "admin" ? "전체 권한" : `${permissionCount(row.permissions)}개`}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(row.lastSignInAt)}</td>
                  <td className="px-4 py-3 text-right"><Button variant="secondary" onClick={() => { setEditing({ ...row, permissions: { ...row.permissions } }); setEditPassword(""); }}>설정</Button></td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">등록된 계정이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-slate-100 md:hidden">
          {filtered.map((row) => (
            <div key={row.id} className="p-4">
              <div className="flex items-start justify-between gap-3"><div><div className="font-bold">{row.displayName}</div><div className="text-xs text-slate-400">{row.email}</div></div><Button variant="secondary" onClick={() => { setEditing({ ...row, permissions: { ...row.permissions } }); setEditPassword(""); }}>설정</Button></div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-slate-100 px-2 py-1">{row.role === "admin" ? "최종관리자" : "직원"}</span><span className={`rounded px-2 py-1 ${row.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{row.isActive ? "활성" : "비활성"}</span><span className="rounded bg-blue-50 px-2 py-1 text-blue-700">실무담당 {row.isWorkStaff ? "사용" : "제외"}</span><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">DB자동배정 {row.isActive && row.isWorkStaff && row.autoAssignLeads ? `참여(${row.leadAssignmentOrder})` : "제외"}</span></div>
            </div>
          ))}
        </div>
      </Card>

      <Modal open={createOpen} title="직원계정 생성" onClose={() => !busy && setCreateOpen(false)} size="xl">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-600">직원명 *<Input className="mt-1" value={draft.displayName} onChange={(e) => setDraft((v) => ({ ...v, displayName: e.target.value }))} placeholder="예: 박형원" /></label>
            <label className="text-xs font-bold text-slate-600">로그인 이메일 *<Input className="mt-1" type="email" value={draft.email} onChange={(e) => setDraft((v) => ({ ...v, email: e.target.value }))} placeholder="staff@example.com" /></label>
            <label className="text-xs font-bold text-slate-600">임시 비밀번호 *<Input className="mt-1" type="password" value={draft.password} onChange={(e) => setDraft((v) => ({ ...v, password: e.target.value }))} placeholder="8자 이상" /></label>
            <label className="text-xs font-bold text-slate-600">계정 구분<Select className="mt-1 w-full" value={draft.role} onChange={(e) => setDraft((v) => ({ ...v, role: e.target.value as "admin" | "staff" }))}><option value="staff">직원</option><option value="admin">최종관리자</option></Select></label>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <ToggleRow label="계정 활성화" description="활성화 즉시 로그인할 수 있습니다. 계정만 먼저 만들려면 해제 상태로 두세요." checked={draft.isActive} onChange={(isActive) => setDraft((v) => ({ ...v, isActive }))} />
            <ToggleRow label="실무 담당자로 사용" description="DB관리 담당자 버튼/담당자 선택 및 정산설정 목록에 자동 반영됩니다." checked={draft.isWorkStaff} onChange={(isWorkStaff) => setDraft((v) => ({ ...v, isWorkStaff, autoAssignLeads: isWorkStaff ? v.autoAssignLeads : false }))} />
            <ToggleRow label="신규 DB 자동배정 참여" description="활성 + 실무담당 계정만 Google Sheet 신규 DB 라운드로빈 자동배정에 참여합니다." checked={draft.autoAssignLeads} disabled={!draft.isWorkStaff} onChange={(autoAssignLeads) => setDraft((v) => ({ ...v, autoAssignLeads }))} />
          </div>
          <label className="block max-w-xs text-xs font-bold text-slate-600">DB 자동배정 순서
            <Input className="mt-1" type="number" min={1} max={9999} value={draft.leadAssignmentOrder} disabled={!draft.isWorkStaff || !draft.autoAssignLeads} onChange={(e) => setDraft((v) => ({ ...v, leadAssignmentOrder: Math.max(1, Number(e.target.value) || 1) }))} />
            <span className="mt-1 block text-[11px] font-normal leading-4 text-slate-400">숫자가 작은 직원부터 순환합니다. 예: 강이삭 10 → 박형원 20 → 다시 강이삭.</span>
          </label>
          {draft.role === "staff" ? <>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><div className="text-xs font-bold text-blue-800">권한 프리셋</div><div className="mt-2 flex flex-wrap gap-2">{PERMISSION_PRESETS.map((preset) => <button key={preset.id} type="button" title={preset.description} onClick={() => applyPreset(preset.id, (permissions) => setDraft((v) => ({ ...v, permissions })))} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">{preset.label}</button>)}</div></div>
            <PermissionEditor value={draft.permissions} onChange={(permissions) => setDraft((v) => ({ ...v, permissions }))} />
          </> : <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-800"><b>최종관리자 계정</b>은 모든 메뉴/기능/전체 담당자 데이터를 자동으로 사용할 수 있습니다. 세부 체크박스보다 관리자 역할이 우선합니다.</div>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>취소</Button><Button onClick={() => void createAccount()} disabled={busy}>{busy ? "생성 중..." : "계정 생성"}</Button></div>
        </div>
      </Modal>

      <Modal open={!!editing} title={editing ? `${editing.displayName} · 계정/권한 설정` : "직원계정 설정"} onClose={() => !busy && setEditing(null)} size="full">
        {editing && <div className="space-y-4">
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-bold text-slate-600">직원명<Input className="mt-1" value={editing.displayName} onChange={(e) => setEditing((v) => v ? { ...v, displayName: e.target.value, staffName: e.target.value } : v)} /></label>
            <label className="text-xs font-bold text-slate-600">로그인 이메일<Input className="mt-1" type="email" value={editing.email} onChange={(e) => setEditing((v) => v ? { ...v, email: e.target.value } : v)} /></label>
            <label className="text-xs font-bold text-slate-600">계정 구분<Select className="mt-1 w-full" value={editing.role} disabled={editing.id === currentUser?.id} onChange={(e) => setEditing((v) => v ? { ...v, role: e.target.value as "admin" | "staff" } : v)}><option value="staff">직원</option><option value="admin">최종관리자</option></Select></label>
            <label className="text-xs font-bold text-slate-600">새 비밀번호(선택)<div className="relative mt-1"><KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input type="password" className="pl-9" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="변경할 때만 8자 이상" /></div></label>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <ToggleRow label="계정 활성화" description="끄면 즉시 로그인 불가 상태가 됩니다. 현재 로그인한 본인 관리자 계정은 비활성화할 수 없습니다." checked={editing.isActive} onChange={(isActive) => setEditing((v) => v ? { ...v, isActive } : v)} disabled={editing.id === currentUser?.id} />
            <ToggleRow label="실무 담당자로 사용" description="켜면 DB관리 담당자 버튼/선택목록/정산설정에 자동 노출됩니다. 홍성원 개발자 계정은 끄고, 강이삭·박형원처럼 실무를 보는 계정은 켜두면 됩니다." checked={editing.isWorkStaff} onChange={(isWorkStaff) => setEditing((v) => v ? { ...v, isWorkStaff, autoAssignLeads: isWorkStaff ? v.autoAssignLeads : false } : v)} />
            <ToggleRow label="신규 DB 자동배정 참여" description="활성 + 실무담당 계정만 Google Sheet 신규 DB 라운드로빈 자동배정에 참여합니다." checked={editing.autoAssignLeads} disabled={!editing.isWorkStaff} onChange={(autoAssignLeads) => setEditing((v) => v ? { ...v, autoAssignLeads } : v)} />
          </div>
          <label className="block max-w-xs text-xs font-bold text-slate-600">DB 자동배정 순서
            <Input className="mt-1" type="number" min={1} max={9999} value={editing.leadAssignmentOrder} disabled={!editing.isWorkStaff || !editing.autoAssignLeads} onChange={(e) => setEditing((v) => v ? { ...v, leadAssignmentOrder: Math.max(1, Number(e.target.value) || 1) } : v)} />
            <span className="mt-1 block text-[11px] font-normal leading-4 text-slate-400">숫자가 작은 직원부터 순환합니다. 현재 운영 권장: 강이삭 10 / 박형원 20.</span>
          </label>
          {editing.role === "staff" ? <>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-bold text-blue-800">권한 프리셋</div><div className="mt-0.5 text-[11px] text-blue-600">프리셋 적용 후 아래 체크박스를 다시 수기로 세밀하게 조정할 수 있습니다.</div></div><div className="flex flex-wrap gap-2">{PERMISSION_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => applyPreset(preset.id, (permissions) => setEditing((v) => v ? { ...v, permissions } : v))} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">{preset.label}</button>)}</div></div></div>
            <PermissionEditor value={editing.permissions} onChange={(permissions) => setEditing((v) => v ? { ...v, permissions } : v)} />
          </> : <PermissionEditor value={Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, true])) as PermissionMap} onChange={() => {}} disabled />}
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
            <Button variant="danger" onClick={() => void deleteAccount(editing)} disabled={busy || editing.id === currentUser?.id}>계정 영구삭제</Button>
            <div className="flex gap-2"><Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>취소</Button><Button onClick={() => void saveEditing()} disabled={busy}><Check size={15} /> {busy ? "저장 중..." : "설정 저장"}</Button></div>
          </div>
        </div>}
      </Modal>
    </>
  );
}
