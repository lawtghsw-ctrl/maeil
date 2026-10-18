"use client";

import { useEffect, useRef, useState } from "react";
import { FileSignature, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { authJson } from "@/lib/platform/client";
import { defaultEsignTemplate, ESIGN_FIELD_LABELS, type EsignField, type EsignTemplate, type FirmEsignView } from "@/lib/eformsign-config";

export default function FirmEsignSettings({ lawFirmId }: { lawFirmId: string }) {
  const [data, setData] = useState<FirmEsignView | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [companyId, setCompanyId] = useState(""), [templates, setTemplates] = useState<EsignTemplate[]>([]);
  const [secrets, setSecrets] = useState({ apiKey: "", privateKey: "", memberId: "", senderMemberId: "" });
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const actionLock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current, controller = new AbortController();
    actionLock.current = false; setChecking(false);
    setData(null); setError(""); setMessage(""); setCompanyId(""); setTemplates([]); setSaving(false); setSecrets({ apiKey: "", privateKey: "", memberId: "", senderMemberId: "" });
    authJson<FirmEsignView>(`/api/firm/eformsign?lawFirmId=${encodeURIComponent(lawFirmId)}`, { signal: controller.signal, cache: "no-store" }).then(result => {
      if (id !== generation.current) return;
      setData(result); setCompanyId(result.companyId); setTemplates(result.templates.length ? result.templates : [defaultEsignTemplate()]);
    }).catch(e => { if (id === generation.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "전자계약 연결을 불러오지 못했습니다."); });
    return () => { generation.current++; controller.abort(); };
  }, [lawFirmId]);
  function patchTemplate(index: number, patch: Partial<EsignTemplate>) { setTemplates(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  async function save() {
    if (!data?.canManage || actionLock.current) return;
    actionLock.current = true;
    const id = generation.current; setSaving(true); setError(""); setMessage("");
    try {
      const result = await authJson<{ message: string }>("/api/firm/eformsign", { method: "PUT", body: JSON.stringify({ lawFirmId, expectedConnectionId: data.connectionId, companyId, templates, ...secrets }) });
      if (id !== generation.current) return;
      setSecrets({ apiKey: "", privateKey: "", memberId: "", senderMemberId: "" }); setMessage(result.message);
      const next = await authJson<FirmEsignView>(`/api/firm/eformsign?lawFirmId=${encodeURIComponent(lawFirmId)}`, { cache: "no-store" });
      if (id === generation.current) setData(next);
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : "전자계약 연결 저장 실패"); }
    finally { if (id === generation.current) { actionLock.current = false; setSaving(false); } }
  }
  async function checkConnection() {
    if (!data?.canManage || !data.configured || actionLock.current) return;
    actionLock.current = true;
    const id = generation.current; setChecking(true); setError(""); setMessage("");
    try {
      const result = await authJson<{ ok: boolean; message: string }>("/api/firm/eformsign", { method: "POST", body: JSON.stringify({ action: "check_connection", lawFirmId }) });
      if (id === generation.current) setMessage(result.message);
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : "전자계약 연결 확인 실패"); }
    finally { if (id === generation.current) { actionLock.current = false; setChecking(false); } }
  }
  return <section className="rounded-2xl border bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-black"><FileSignature size={17}/>로펌 수임계약 · 이폼사인</h2><p className="mt-1 text-xs leading-5 text-slate-500">이 로펌의 수임계약에 사용할 계정과 템플릿입니다. 로파워 판매계약과 구분하여 관리합니다.</p></div>{data && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${data.configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{data.configured ? data.source === "legacy_env" ? "매일 기존 연결 유지" : "연결 설정 저장됨" : "연결 등록 필요"}</span>}</div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{message}</p>}
    {!data && !error && <p className="mt-3 text-xs text-slate-400">연결정보를 불러오는 중...</p>}
    {data && <>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">{([["API 키", data.presence.apiKey], ["서명키", data.presence.privateKey], ["멤버 ID", data.presence.memberId], ["발송 멤버", data.presence.senderMemberId]] as const).map(([label, present]) => <span key={label}>{label} <b className={present ? "text-slate-700" : "text-amber-700"}>{present ? "등록됨" : "미등록"}</b></span>)}</div>
      {data.canManage && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3"><button type="button" onClick={() => void checkConnection()} disabled={!data.configured || saving || checking} className="flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50"><ShieldCheck size={14}/>{checking ? "연결 확인 중..." : "저장된 연결 확인"}</button><p className="text-xs leading-5 text-slate-500">저장된 계정으로 인증 상태만 확인합니다. 입력 중인 변경사항은 먼저 저장해주세요. 문서 발송은 실행하지 않습니다.</p></div>}
      {!data.canManage && <p className="mt-3 text-xs leading-6 text-slate-500">연결 변경은 로파워 관리자에게 요청해주세요. 계약관리에서 기존 권한에 따라 본 로펌의 문서를 발송하고 상태를 확인할 수 있습니다.</p>}
      {data.canManage && <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4"><p className="text-xs leading-6 text-slate-500">비밀값은 다시 표시되지 않습니다. 빈 항목은 기존 값을 유지합니다. 다른 로펌의 계정은 사용하지 않으며, 회사 ID가 인증 응답과 일치해야 발송됩니다.</p><div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-semibold text-slate-600">이폼사인 회사 ID<input aria-label="이폼사인 회사 ID" value={companyId} onChange={e => setCompanyId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm"/></label>{(["apiKey", "memberId", "senderMemberId"] as const).map(key => <label key={key} className="text-xs font-semibold text-slate-600">{{ apiKey: "API 키", memberId: "멤버 ID", senderMemberId: "발송 멤버 ID (선택)" }[key]}<input aria-label={`이폼사인 ${key}`} type="password" autoComplete="new-password" value={secrets[key]} onChange={e => setSecrets(s => ({ ...s, [key]: e.target.value }))} placeholder={data.presence[key] ? "기존 값 유지 · 변경할 때만 입력" : "새 값 입력"} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm"/></label>)}</div><label className="block text-xs font-semibold text-slate-600">서명키 (PEM 또는 PKCS8 HEX)<textarea aria-label="이폼사인 서명키" autoComplete="off" rows={3} value={secrets.privateKey} onChange={e => setSecrets(s => ({ ...s, privateKey: e.target.value }))} placeholder={data.presence.privateKey ? "기존 서명키 유지 · 변경할 때만 입력" : "서명키 입력"} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-mono text-xs"/></label></div>}
      <div className="mt-4 space-y-3">{templates.map((template, index) => <div key={index} className="rounded-xl border p-4"><div className="grid gap-3 md:grid-cols-3">{(["caseType", "templateId", "documentName"] as const).map(key => <label key={key} className="text-[11px] font-semibold text-slate-500">{{ caseType: "사건유형", templateId: "이폼사인 템플릿 ID", documentName: "문서명" }[key]}<input aria-label={`템플릿 ${index + 1} ${key}`} disabled={!data.canManage} value={template[key]} onChange={e => patchTemplate(index, { [key]: e.target.value })} className="mt-1 h-9 w-full rounded-lg border px-2 text-xs disabled:bg-slate-50"/></label>)}</div><div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-[11px] text-slate-500">본문 고정연도<input aria-label={`템플릿 ${index + 1} 고정연도`} type="number" disabled={!data.canManage} value={template.fixedYear ?? ""} onChange={e => patchTemplate(index, { fixedYear: e.target.value ? Number(e.target.value) : null })} placeholder="연도 필드 사용 시 비움" className="mt-1 block h-9 w-44 rounded-lg border px-2 text-xs"/></label><label className="text-[11px] text-slate-500">연도 입력항목 ID (선택)<input aria-label={`템플릿 ${index + 1} 연도 필드`} disabled={!data.canManage} value={template.yearField} onChange={e => patchTemplate(index, { yearField: e.target.value })} placeholder="예: 연도" className="mt-1 block h-9 w-44 rounded-lg border px-2 text-xs"/></label>{data.canManage && templates.length > 1 && <button type="button" aria-label={`템플릿 ${index + 1} 제거`} onClick={() => setTemplates(rows => rows.filter((_, i) => i !== index))} className="flex h-9 items-center gap-1 px-2 text-xs text-rose-600"><Trash2 size={14}/>제거</button>}</div><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">문서 자동입력 항목 연결</summary><p className="mt-2 text-[11px] leading-5 text-slate-400">이폼사인 템플릿에 설정한 항목 ID와 일치해야 합니다. 기본값은 기존 수임약정서 항목입니다.</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{(Object.keys(ESIGN_FIELD_LABELS) as EsignField[]).map(key => <label key={key} className="text-[11px] text-slate-500">{ESIGN_FIELD_LABELS[key]}<input disabled={!data.canManage} aria-label={`템플릿 ${index + 1} ${key} 필드`} value={template.fields[key]} onChange={e => patchTemplate(index, { fields: { ...template.fields, [key]: e.target.value } })} className="mt-1 h-8 w-full rounded-lg border px-2 text-xs"/></label>)}</div></details></div>)}</div>
      {data.canManage && <div className="mt-4 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => setTemplates(rows => [...rows, { ...defaultEsignTemplate(), caseType: "", fixedYear: new Date().getFullYear() }])} disabled={templates.length >= 20 || saving || checking} className="flex h-9 items-center gap-2 rounded-lg border px-3 text-xs disabled:opacity-50"><Plus size={14}/>사건유형별 템플릿 추가</button><button type="button" onClick={() => void save()} disabled={saving || checking} className="flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white disabled:opacity-50"><Save size={14}/>{saving ? "저장 중..." : "연결·템플릿 저장"}</button></div>}
    </>}
  </section>;
}
