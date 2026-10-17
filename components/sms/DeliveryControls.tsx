"use client";

import { useEffect, useState } from "react";
import { Clock3, RefreshCw, ShieldCheck } from "lucide-react";

export type DeliveryState = {
  gate: { epochId: string | null; liveEnabled: boolean; autoEnabled: boolean; activatedAt: string | null };
  capabilities: { sms: boolean; lms: boolean; mms: boolean; maxRecipients: number; maxImages: number; minReservationMinutes: number };
  serverTime: string;
  canManageGate: boolean;
  globalReady?: boolean;
  disabledReason?: string;
};

export function validDeliveryState(value: unknown): value is DeliveryState {
  if (!value || typeof value !== "object") return false;
  const data = value as DeliveryState;
  return !!data.gate && !!data.capabilities && typeof data.gate.liveEnabled === "boolean" && typeof data.gate.autoEnabled === "boolean"
    && (data.gate.epochId === null || (typeof data.gate.epochId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.gate.epochId)))
    && (data.gate.activatedAt === null || (typeof data.gate.activatedAt === "string" && Number.isFinite(Date.parse(data.gate.activatedAt))))
    && (!(data.gate.liveEnabled || data.gate.autoEnabled) || (!!data.gate.epochId && !!data.gate.activatedAt))
    && typeof data.canManageGate === "boolean" && (data.globalReady === undefined || typeof data.globalReady === "boolean")
    && (data.disabledReason === undefined || typeof data.disabledReason === "string")
    && typeof data.serverTime === "string" && Number.isFinite(Date.parse(data.serverTime))
    && [data.capabilities.sms, data.capabilities.lms, data.capabilities.mms].every((item) => typeof item === "boolean")
    && Number.isInteger(data.capabilities.maxRecipients) && data.capabilities.maxRecipients > 0 && data.capabilities.maxRecipients <= 1000
    && Number.isInteger(data.capabilities.maxImages) && data.capabilities.maxImages >= 0 && data.capabilities.maxImages <= 3
    && Number.isFinite(data.capabilities.minReservationMinutes) && data.capabilities.minReservationMinutes >= 0;
}

type Props = {
  state: DeliveryState | null;
  loading: boolean;
  saving: boolean;
  error: string;
  onRefresh: () => void;
  onSave: (liveEnabled: boolean, autoEnabled: boolean) => Promise<void>;
};

export default function DeliveryControls({ state, loading, saving, error, onRefresh, onSave }: Props) {
  const [live, setLive] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    setLive(state?.gate.liveEnabled ?? false);
    setAutomatic(state?.gate.autoEnabled ?? false);
    setAcknowledged(false);
  }, [state?.gate.epochId, state?.gate.liveEnabled, state?.gate.autoEnabled]);
  const changed = !!state && (live !== state.gate.liveEnabled || automatic !== state.gate.autoEnabled);
  const enabling = live || automatic;
  const unavailable = loading || saving || !state || !!error;
  return <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 font-black text-indigo-950"><ShieldCheck size={18}/> 로펌 발송 활성 상태</h2>
        <p className="mt-1 text-xs leading-5 text-indigo-700">문구 설정과 별도로 관리합니다. 활성화 이후 새로 승인된 요청만 발송하며, 이전 대기 문자는 보내지 않습니다.</p></div>
      <button type="button" disabled={loading || saving} onClick={onRefresh} aria-label="서버 발송 상태 새로고침" className="rounded-lg border border-indigo-200 bg-white p-2 text-indigo-700 disabled:opacity-40"><RefreshCw size={16}/></button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
    {loading ? <p className="mt-3 text-sm text-slate-500">서버에서 발송 상태를 확인하고 있습니다.</p> : state && <>
      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
        <span className="rounded-full bg-white px-3 py-1.5">수기·주소록: {state.gate.liveEnabled ? "활성" : "중지"}</span>
        <span className="rounded-full bg-white px-3 py-1.5">신규 DB·부재중 자동: {state.gate.autoEnabled ? "활성" : "중지"}</span>
        {state.globalReady === false && <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-800">서버 발송 준비 필요</span>}
      </div>
      {state.gate.activatedAt && <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Clock3 size={13}/> 현재 활성 구간 시작: {new Date(state.gate.activatedAt).toLocaleString("ko-KR")}</p>}
      {state.disabledReason && <p className="mt-3 text-sm font-semibold text-amber-800">{state.disabledReason}</p>}
      {state.canManageGate ? <div className="mt-4 border-t border-indigo-100 pt-4">
        <div className="flex flex-wrap gap-5 text-sm font-bold text-slate-700">
          <label className="flex items-center gap-2"><input type="checkbox" checked={live} disabled={unavailable} onChange={(event) => { setLive(event.target.checked); setAcknowledged(false); }}/> 수기·주소록 발송 허용</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={automatic} disabled={unavailable} onChange={(event) => { setAutomatic(event.target.checked); setAcknowledged(false); }}/> 신규 DB·부재중 자동발송 허용</label>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">변경 시 새 활성 구간이 시작됩니다. 이전 구간의 미처리 요청은 발송하지 않습니다. 담당자별 문구·이미지·자동발송 선택은 아래 저장된 설정을 따릅니다.</p>
        {changed && enabling && <label className="mt-3 flex items-start gap-2 text-xs font-semibold leading-5 text-indigo-900"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={saving}/> 변경 이후의 새 요청만 실제 발송하며, 과거 대기 문자는 보내지 않는 것을 확인했습니다.</label>}
        <button type="button" disabled={unavailable || !changed || (enabling && (!acknowledged || state.globalReady === false))} onClick={() => void onSave(live, automatic)} className="mt-4 rounded-xl bg-indigo-700 px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? "서버 상태 저장 중..." : enabling ? "새 요청부터 활성 상태 적용" : "발송 중지 적용"}</button>
      </div> : <p className="mt-3 text-xs text-slate-500">활성 상태 변경은 로펌 관리자에게 요청해주세요.</p>}
    </>}
  </section>;
}
