"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Primitives";
import { useStoreSession } from "@/lib/store";
import type { SmsDraft } from "@/components/sms/SmsCenter";
import type { DbLead } from "@/lib/types";

const SmsCenter = dynamic(() => import("@/components/sms/SmsCenter"), {
  loading: () => <p role="status" className="p-6 text-sm text-slate-500">문자발송 화면을 불러오는 중입니다.</p>,
});

export default function LeadSmsDialog({ lead, onClose }: { lead: DbLead | null; onClose: () => void }) {
  const { profile, superAdminFirmScope, can } = useStoreSession();
  const cache = useRef(new Map<string, SmsDraft>());
  const firmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const owner = useRef(profile?.id);
  if (owner.current !== profile?.id) { cache.current.clear(); owner.current = profile?.id; }
  const eligible = Boolean(lead && firmId && can("sms.send") && (!lead._lawFirmId || lead._lawFirmId === firmId));
  useEffect(() => {
    if (!lead || !eligible) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [lead, eligible, onClose]);
  return <Modal open={eligible} title={`${lead?.name ?? "고객"} · 문자발송`} onClose={onClose} size="full">
    {eligible && lead && <div role="dialog" aria-modal="true" aria-label="고객 문자발송" className="p-2 sm:p-4">
      <SmsCenter contextKey={`lead:${lead.id}`} draftCache={cache.current} initialRecipients={[{ name: lead.name, phone: lead.phone }]}/>
    </div>}
  </Modal>;
}
