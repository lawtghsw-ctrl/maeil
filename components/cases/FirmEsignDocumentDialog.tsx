"use client";
import { DateInput } from "@/components/ui/DateInput";

import { useEffect, useRef, useState } from "react";
import type { CaseRecord, Client } from "@/lib/types";
import { authJson } from "@/lib/platform/client";
import { Button, Input, Label, Modal } from "@/components/ui/Primitives";

type Preflight = { configured: boolean; templateName: string | null; fixedYear: number | null; documentId: string | null; sendBlocked: boolean; status: string };
type Fields = { name: string; address: string; residentNumber: string; phone: string; creditorCount: string; fee: string; contractDate: string; signerName: string; message: string };
const labels: Record<keyof Fields, string> = { name: "고객명", address: "주소", residentNumber: "주민등록번호", phone: "서명 요청 받을 전화번호", creditorCount: "채권자 수", fee: "수임료", contractDate: "계약일", signerName: "서명자 이름", message: "전송 메시지" };

export default function FirmEsignDocumentDialog({ open, client, caseRecord, onClose }: { open: boolean; client: Client; caseRecord: CaseRecord; onClose: () => void }) {
  const [form, setForm] = useState<Fields>({ name: "", address: "", residentNumber: "", phone: "", creditorCount: "", fee: "", contractDate: "", signerName: "", message: "" });
  const [data, setData] = useState<Preflight | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false);
  const generation = useRef(0), lock = useRef(false);
  useEffect(() => {
    const id = ++generation.current, controller = new AbortController();
    setData(null); setError(""); setMessage(""); setConfirmed(false); setBusy(false); setAttempted(false); lock.current = false;
    if (!open) { setForm(f => ({ ...f, residentNumber: "" })); return; }
    setForm({ name: client.name, address: client.consultation?.personal?.address || "", residentNumber: "", phone: client.phone, creditorCount: "", fee: String(caseRecord.contractAmount), contractDate: caseRecord.contractDate, signerName: client.name, message: "계약서 확인 후 서명 부탁드립니다." });
    authJson<Preflight>(`/api/integrations/eformsign/send?caseId=${encodeURIComponent(caseRecord.id)}`, { signal: controller.signal, cache: "no-store" }).then(result => { if (id === generation.current) setData(result); }).catch(e => { if (id === generation.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "전자계약 연결 확인 실패"); });
    return () => { generation.current++; controller.abort(); };
    // Keep user input while the store updates the same case in the background.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseRecord.id]);
  async function run(kind: "send" | "status") {
    if (lock.current || !data || (kind === "send" && (!confirmed || attempted || data.sendBlocked || !data.configured))) return;
    if (kind === "send" && Object.entries(form).some(([key, value]) => key !== "message" && !value.trim())) { setError("메시지를 제외한 모든 계약 항목을 입력해주세요."); return; }
    lock.current = true; setBusy(true); setError(""); setMessage(""); const id = generation.current;
    if (kind === "send") setAttempted(true);
    try {
      const result = await authJson<{ documentId: string; status: string }>(`/api/integrations/eformsign/${kind}`, { method: "POST", body: JSON.stringify({ caseId: caseRecord.id, ...(kind === "send" ? form : {}) }) });
      if (id !== generation.current) return;
      setData(previous => previous ? { ...previous, documentId: result.documentId, sendBlocked: true, status: result.status } : previous);
      setForm(previous => ({ ...previous, residentNumber: "" })); setConfirmed(false);
      setMessage(kind === "send" ? "서명 요청이 전송되었습니다. 아래 서명상태 확인으로 진행 결과를 확인해주세요." : `서명상태: ${result.status}`);
    } catch (e) { if (id === generation.current) setError((e instanceof Error ? e.message : "요청 결과를 확인하지 못했습니다.") + (kind === "send" ? " 발송 결과 확인 전 다시 전송하지 마세요. 서명상태 확인을 먼저 이용해주세요." : "")); }
    finally { if (id === generation.current) { lock.current = false; setBusy(false); } }
  }
  return <Modal open={open} title={`${client.name} · 전자계약서 전송`} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4">
      <div className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">이 로펌에 등록한 이폼사인 계정으로 고객에게 실제 서명 요청 문자를 보냅니다.<p className="mt-1 text-xs leading-5">문서 내용·수신번호·금액을 확인해주세요. 발송 후에는 같은 계약에 다시 발송하지 않으며, 응답이 불명확하면 먼저 상태를 확인합니다.</p></div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{message}</p>}
      {!data && !error && <p className="text-sm text-slate-500">로펌 연결정보 확인 중...</p>}
      {data && <>
        <div className="rounded-lg border p-3 text-xs leading-6 text-slate-600"><b>{data.templateName || "이 사건유형 템플릿 미등록"}</b><p>현재 상태: {data.status}{data.fixedYear ? ` · 템플릿 고정연도 ${data.fixedYear}년` : ""}</p>{!data.configured && <p className="text-amber-700">로파워 관리자에게 이 로펌의 계정·템플릿 등록을 요청해주세요.</p>}</div>
        {!data.sendBlocked && !attempted && <div className="grid gap-3 sm:grid-cols-2">{(Object.keys(labels) as (keyof Fields)[]).map(key => <Label key={key} text={labels[key]}>{key === "contractDate" ? <DateInput aria-label={`전자계약 ${key}`} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base sm:h-10 sm:text-sm" disabled={busy} value={form[key]} onValueChange={value => { setForm(previous => ({ ...previous, [key]: value })); setConfirmed(false); }}/> : <Input aria-label={`전자계약 ${key}`} type={key === "residentNumber" ? "password" : "text"} autoComplete="off" disabled={busy} value={form[key]} onChange={e => { setForm(previous => ({ ...previous, [key]: e.target.value })); setConfirmed(false); }}/>}</Label>)}</div>}
        {!data.sendBlocked && !attempted && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><input aria-label="실제 전자계약 발송 확인" type="checkbox" checked={confirmed} disabled={busy || !data.configured} onChange={e => setConfirmed(e.target.checked)} className="mt-1"/>수신번호 {form.phone}와 계약 내용을 확인했으며, 고객에게 실제 서명 요청을 발송합니다.</label>}
      </>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={onClose}>닫기</Button><Button variant="secondary" disabled={busy || !data} onClick={() => void run("status")}>서명상태 확인</Button><Button disabled={busy || !data?.configured || data.sendBlocked || attempted || !confirmed} onClick={() => void run("send")}>{busy ? "요청 중..." : "실제 서명 요청 전송"}</Button></div>
    </div>
  </Modal>;
}
