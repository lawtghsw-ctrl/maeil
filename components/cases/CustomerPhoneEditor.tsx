"use client";

import { useEffect, useId, useRef, useState } from "react";
import { changedCustomerPhone } from "@/lib/customer-phone";
import { useStore } from "@/lib/store";
import type { Client } from "@/lib/types";

type PhoneClient = Pick<Client, "id" | "phone">;

export function CustomerPhoneEditor({ client }: { client: PhoneClient }) {
  const { isAdmin, profile, superAdminFirmScope, can, updateClientPhone } = useStore();
  const permitted = isAdmin && can("cases.view")
    && (profile?.platformRole !== "super_admin" || superAdminFirmScope !== null);

  // A customer or access-scope change must discard the old editing session.
  // Same-customer realtime updates deliberately keep the in-progress draft.
  const identity = `${client.id}:${profile?.id ?? ""}:${superAdminFirmScope?.id ?? profile?.lawFirmId ?? ""}:${permitted}`;
  return <PhoneField key={identity} client={client} permitted={permitted} updateClientPhone={updateClientPhone} />;
}

function PhoneField({ client, permitted, updateClientPhone }: {
  client: PhoneClient;
  permitted: boolean;
  updateClientPhone: (id: string, phone: string) => Promise<boolean>;
}) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(client.phone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const editStartPhone = useRef(client.phone);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function startEditing() {
    if (!permitted || inFlight.current) return;
    editStartPhone.current = client.phone;
    setDraft(client.phone);
    setError("");
    setSaved(false);
    setEditing(true);
  }

  function cancel() {
    if (inFlight.current) return;
    setDraft(client.phone);
    setError("");
    setEditing(false);
  }

  async function save() {
    if (!permitted || !editing || inFlight.current) return;
    setError("");
    setSaved(false);
    // An untouched or reverted draft must not undo a realtime update that
    // arrived after editing began. Only an intentional final change is saved.
    if (draft.trim() === editStartPhone.current.trim()) {
      setEditing(false);
      return;
    }
    let phone: string | undefined;
    try {
      phone = changedCustomerPhone(client.phone, draft, permitted);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "연락처를 확인해주세요.");
      return;
    }
    if (phone === undefined) {
      setEditing(false);
      return;
    }

    inFlight.current = true;
    setSaving(true);
    try {
      const success = await updateClientPhone(client.id, phone);
      if (!mounted.current) return;
      if (success) {
        setEditing(false);
        setSaved(true);
      } else {
        setError("저장 실패: 계정 권한 또는 서버 연결을 확인해주세요. 입력값은 유지됩니다.");
      }
    } catch {
      if (mounted.current) setError("저장 실패: 서버 연결을 확인한 뒤 다시 시도해주세요. 입력값은 유지됩니다.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div className="min-w-0 text-xs">
    {editing && permitted ? <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void save(); }} aria-busy={saving}>
      <label htmlFor={inputId} className="shrink-0 text-slate-500">연락처</label>
      <input
        id={inputId}
        aria-label="고객 연락처"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className="h-8 w-44 max-w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-500 disabled:bg-slate-100"
        type="tel"
        autoComplete="tel"
        maxLength={40}
        value={draft}
        disabled={saving}
        autoFocus
        onChange={event => { setDraft(event.target.value); setError(""); }}
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } }}
      />
      <button type="submit" className="rounded-md bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50" disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
      <button type="button" className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50" disabled={saving} onClick={cancel}>취소</button>
    </form> : <div className="flex flex-wrap items-center gap-2">
      <span><span className="text-slate-500">연락처 </span>{client.phone || "-"}</span>
      {permitted && <button type="button" aria-label="고객 연락처 수정" className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50" onClick={startEditing}>수정</button>}
      {saved && <span role="status" className="text-blue-700">연락처를 저장했습니다.</span>}
    </div>}
    {error && <p id={`${inputId}-error`} role="alert" className="mt-1 text-red-600">{error}</p>}
  </div>;
}
