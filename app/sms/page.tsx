"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import * as XLSX from "xlsx";
import {
  BookOpen, CheckCircle2, Clock3, FileSpreadsheet, ImagePlus, MessageSquareText,
  Phone, Plus, RefreshCw, Send, Settings2, Trash2, UploadCloud, UsersRound, X
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";

type Tab = "send" | "history" | "automation" | "settings";
type Recipient = { name: string; phone: string };
type Sender = { id: string; staff_name: string; label: string; phone: string; is_default: boolean; is_active: boolean; is_registered: boolean };
type Template = { id: string; name: string; category: string; body: string };
type Outbox = {
  id: string; receiver_name: string | null; receiver_number: string; sender_number: string; message: string;
  msg_type: string; status: string; source: string; auto_kind: string | null; created_at: string; provider_message_id: string | null;
};
type Automation = {
  new_lead_enabled: boolean; absence_enabled: boolean; new_lead_template: string; absence_template: string;
  duplicate_guard_minutes: number;
};

const DEFAULT_NEW = "[로파워] {고객명}님, 상담 접수가 확인되었습니다. 담당자 {담당자}이(가) 곧 연락드리겠습니다.";
const DEFAULT_ABSENCE = "[로파워] {고객명}님, 상담 관련하여 연락드렸으나 통화가 연결되지 않아 문자드립니다. 확인 후 편하실 때 연락 부탁드립니다.";

function digits(v: unknown) { return String(v ?? "").replace(/\D/g, ""); }
function prettyPhone(v: string) {
  const n = digits(v);
  if (n.length === 11) return `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}`;
  if (n.length === 10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
  return v;
}
function smsBytes(value: string) {
  return Array.from(value).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
}
function mergeRecipients(prev: Recipient[], next: Recipient[]) {
  const map = new Map<string, Recipient>();
  [...prev, ...next].forEach((r) => {
    const phone = digits(r.phone);
    if (phone.length >= 10) map.set(phone, { name: r.name.trim(), phone });
  });
  return Array.from(map.values());
}
function statusLabel(status: string) {
  return ({ pending_api:"API 연동대기", queued:"발송대기", sending:"발송중", sent:"발송완료", failed:"실패", cancelled:"취소" } as Record<string,string>)[status] ?? status;
}
function sourceLabel(source: string) {
  return ({ manual:"수기발송", file:"주소록파일", new_lead:"신규DB 자동", absence:"부재중 자동" } as Record<string,string>)[source] ?? source;
}

export default function SmsCenterPage() {
  const supabase = useMemo(() => createClient(), []);
  const { profile, superAdminFirmScope, workStaffNames, isAdmin } = useStore();
  const firmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const [tab, setTab] = useState<Tab>("send");
  const [senders, setSenders] = useState<Sender[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [history, setHistory] = useState<Outbox[]>([]);
  const [automation, setAutomation] = useState<Automation>({
    new_lead_enabled: true, absence_enabled: true, new_lead_template: DEFAULT_NEW, absence_template: DEFAULT_ABSENCE, duplicate_guard_minutes: 5
  });
  const [senderId, setSenderId] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [reservedAt, setReservedAt] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [newSender, setNewSender] = useState({ staff_name: profile?.staffName ?? "", label: "", phone: "", is_registered: false });
  const [newTemplate, setNewTemplate] = useState({ name: "", category: "일반", body: "" });
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedSender = senders.find((s) => s.id === senderId);
  const bytes = smsBytes(message);
  const msgType = images.length ? "MMS" : bytes <= 90 ? "SMS" : "LMS";
  const canManage = isAdmin || profile?.platformRole === "firm_admin" || profile?.platformRole === "super_admin";

  const load = useCallback(async () => {
    if (!firmId) return;
    const [senderRes, templateRes, historyRes, autoRes] = await Promise.all([
      supabase.from("sms_sender_numbers").select("*").eq("law_firm_id", firmId).order("is_default", { ascending:false }).order("staff_name"),
      supabase.from("sms_templates").select("id,name,category,body").eq("law_firm_id", firmId).order("created_at"),
      supabase.from("sms_outbox").select("id,receiver_name,receiver_number,sender_number,message,msg_type,status,source,auto_kind,created_at,provider_message_id").eq("law_firm_id", firmId).order("created_at", { ascending:false }).limit(300),
      supabase.from("sms_automation_settings").select("new_lead_enabled,absence_enabled,new_lead_template,absence_template,duplicate_guard_minutes").eq("law_firm_id", firmId).maybeSingle(),
    ]);
    if (senderRes.error) setNotice(senderRes.error.message);
    else {
      const rows = (senderRes.data ?? []) as Sender[];
      setSenders(rows);
      setSenderId((prev) => prev || rows.find((s) => s.staff_name === profile?.staffName)?.id || rows.find((s) => s.is_default)?.id || rows[0]?.id || "");
    }
    if (!templateRes.error) setTemplates((templateRes.data ?? []) as Template[]);
    if (!historyRes.error) setHistory((historyRes.data ?? []) as Outbox[]);
    if (autoRes.data) setAutomation(autoRes.data as Automation);
  }, [firmId, profile?.staffName, supabase]);

  useEffect(() => { void load(); }, [load]);

  function addManual() {
    const phone = digits(manualPhone);
    if (phone.length < 10) { setNotice("수신번호를 확인해주세요."); return; }
    setRecipients((prev) => mergeRecipients(prev, [{ name: manualName, phone }]));
    setManualName(""); setManualPhone(""); setNotice("");
  }

  function addBulk() {
    const rows = bulkText.split(/\r?\n/).map((line) => {
      const parts = line.split(/[,\t]/).map((v) => v.trim());
      if (parts.length === 1) return { name:"", phone:parts[0] };
      return digits(parts[0]).length >= 10 ? { name:parts[1] ?? "", phone:parts[0] } : { name:parts[0], phone:parts[1] ?? "" };
    });
    setRecipients((prev) => mergeRecipients(prev, rows));
    setBulkText("");
  }

  async function parseAddressFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:"array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header:1, defval:"" });
      if (!matrix.length) return;
      const first = matrix[0].map((v) => String(v).trim().toLowerCase());
      const phoneIdx = first.findIndex((v) => /전화|휴대|핸드폰|연락처|phone|mobile/.test(v));
      const nameIdx = first.findIndex((v) => /이름|성명|고객|name/.test(v));
      const hasHeader = phoneIdx >= 0 || nameIdx >= 0;
      const start = hasHeader ? 1 : 0;
      const pIdx = phoneIdx >= 0 ? phoneIdx : (nameIdx === 0 ? 1 : 0);
      const nIdx = nameIdx >= 0 ? nameIdx : (pIdx === 0 ? 1 : 0);
      const parsed = matrix.slice(start).map((row) => ({ name:String(row[nIdx] ?? ""), phone:String(row[pIdx] ?? "") }));
      setRecipients((prev) => mergeRecipients(prev, parsed));
      setNotice(`${file.name}에서 연락처를 불러왔습니다.`);
    } catch {
      setNotice("주소록 파일을 읽지 못했습니다. CSV/XLS/XLSX 형식을 확인해주세요.");
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void parseAddressFile(file);
  }

  async function uploadImages() {
    if (!firmId || !images.length) return [] as string[];
    const paths: string[] = [];
    for (const file of images.slice(0, 3)) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${firmId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;
      const { error } = await supabase.storage.from("sms-media").upload(path, file, { upsert:false });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  }

  async function queueSend() {
    if (!firmId) { setNotice("대상 로펌을 먼저 선택해주세요."); return; }
    if (!selectedSender) { setNotice("발신번호를 선택해주세요."); return; }
    if (!recipients.length) { setNotice("수신자를 1명 이상 추가해주세요."); return; }
    if (!message.trim()) { setNotice("문자 내용을 작성해주세요."); return; }
    if (recipients.length > 1000) { setNotice("한 번에 최대 1,000명까지 등록할 수 있습니다."); return; }

    setBusy(true); setNotice("");
    try {
      const imagePaths = await uploadImages();
      const rows = recipients.map((r) => ({
        law_firm_id: firmId,
        source: "manual",
        sender_number_id: selectedSender.id,
        sender_number: digits(selectedSender.phone),
        receiver_number: r.phone,
        receiver_name: r.name || null,
        title: title.trim() || null,
        message: message.replaceAll("{고객명}", r.name || "고객"),
        msg_type: msgType,
        image_paths: imagePaths,
        reserved_at: reservedAt ? new Date(reservedAt).toISOString() : null,
        status: "pending_api",
        created_by: profile?.id ?? null,
      }));
      const { error } = await supabase.from("sms_outbox").insert(rows);
      if (error) throw error;
      setNotice(`총 ${rows.length}건이 API 연동대기열에 등록되었습니다.`);
      setRecipients([]); setMessage(""); setTitle(""); setImages([]); setReservedAt("");
      await load();
      setTab("history");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "발송대기 등록에 실패했습니다.");
    } finally { setBusy(false); }
  }

  async function saveAutomation() {
    if (!firmId) return;
    setBusy(true);
    const { error } = await supabase.from("sms_automation_settings").upsert({
      law_firm_id: firmId, ...automation, updated_by: profile?.id ?? null
    }, { onConflict:"law_firm_id" });
    setBusy(false);
    setNotice(error ? error.message : "자동발송 설정을 저장했습니다.");
  }

  async function addSender() {
    if (!firmId || !newSender.staff_name || digits(newSender.phone).length < 9) { setNotice("담당자와 발신번호를 확인해주세요."); return; }
    const { error } = await supabase.from("sms_sender_numbers").insert({
      law_firm_id: firmId, staff_name:newSender.staff_name, label:newSender.label || newSender.staff_name,
      phone:digits(newSender.phone), is_registered:newSender.is_registered, is_active:true, is_default:senders.length === 0
    });
    setNotice(error ? error.message : "발신번호를 추가했습니다.");
    if (!error) { setNewSender({ staff_name:profile?.staffName ?? "", label:"", phone:"", is_registered:false }); await load(); }
  }

  async function deleteSender(id: string) {
    if (!confirm("이 발신번호를 삭제할까요?")) return;
    const { error } = await supabase.from("sms_sender_numbers").delete().eq("id", id);
    setNotice(error ? error.message : "발신번호를 삭제했습니다.");
    if (!error) await load();
  }

  async function setDefaultSender(id: string) {
    if (!firmId) return;
    await supabase.from("sms_sender_numbers").update({ is_default:false }).eq("law_firm_id", firmId);
    const { error } = await supabase.from("sms_sender_numbers").update({ is_default:true }).eq("id", id);
    setNotice(error ? error.message : "기본 발신번호를 변경했습니다.");
    if (!error) await load();
  }

  async function addTemplate() {
    if (!firmId || !newTemplate.name.trim() || !newTemplate.body.trim()) { setNotice("템플릿명과 내용을 입력해주세요."); return; }
    const { error } = await supabase.from("sms_templates").insert({ law_firm_id:firmId, ...newTemplate, created_by:profile?.id ?? null });
    setNotice(error ? error.message : "문구 템플릿을 저장했습니다.");
    if (!error) { setNewTemplate({ name:"", category:"일반", body:"" }); await load(); }
  }

  async function deleteTemplate(id: string) {
    const { error } = await supabase.from("sms_templates").delete().eq("id", id);
    setNotice(error ? error.message : "템플릿을 삭제했습니다.");
    if (!error) await load();
  }

  if (profile?.platformRole === "super_admin" && !superAdminFirmScope) {
    return <div className="rounded-2xl border border-violet-200 bg-violet-50 p-6 text-sm text-violet-800">문자발송은 로펌별 발신번호를 사용합니다. 좌측 상단에서 대상 로펌을 먼저 선택해주세요.</div>;
  }

  const tabs: Array<[Tab,string,ReactNode]> = [
    ["send","문자 보내기",<Send key="s" size={16}/>],
    ["history","발송내역",<Clock3 key="h" size={16}/>],
    ["automation","자동발송",<RefreshCw key="a" size={16}/>],
    ["settings","발신번호 · 문구",<Settings2 key="g" size={16}/>],
  ];

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <div className="flex items-center gap-2 text-2xl font-black text-slate-900"><MessageSquareText className="text-blue-600"/> 문자발송</div>
        <p className="mt-1 text-sm text-slate-500">수기·주소록 대량발송과 DB 자동문자를 한 곳에서 관리합니다.</p>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
        <Clock3 size={14}/> 알리고 API 미연동 · 현재 발송은 대기열에만 저장됩니다.
      </div>
    </div>

    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      {tabs.map(([id,label,icon]) => <button key={id} onClick={()=>setTab(id)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold ${tab===id?"bg-slate-900 text-white":"text-slate-500 hover:bg-slate-50"}`}>{icon}{label}</button>)}
    </div>

    {notice && <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700"><span>{notice}</span><button onClick={()=>setNotice("")}><X size={15}/></button></div>}

    {tab === "send" && <div className="grid gap-5 2xl:grid-cols-[1fr_390px]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-black text-slate-900">1. 수신자</h2><p className="text-xs text-slate-400">수기 입력 또는 주소록 파일을 드래그해서 추가</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{recipients.length}명</span></div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div onDrop={onDrop} onDragOver={(e)=>e.preventDefault()} onClick={()=>fileInput.current?.click()} className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-center hover:border-blue-300 hover:bg-blue-50">
              <UploadCloud className="mb-2 text-slate-400"/><b className="text-sm">주소록 파일 드롭</b><span className="mt-1 text-xs text-slate-400">CSV · XLS · XLSX / 이름·연락처 자동 인식</span>
              <input ref={fileInput} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(f) void parseAddressFile(f); e.currentTarget.value="";}}/>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 text-xs font-bold text-slate-500">연락처 수기 작성</div>
              <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
                <input value={manualName} onChange={(e)=>setManualName(e.target.value)} placeholder="고객명" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"/>
                <input value={manualPhone} onChange={(e)=>setManualPhone(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")addManual();}} placeholder="010-0000-0000" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"/>
                <button onClick={addManual} className="grid size-10 place-items-center rounded-lg bg-blue-600 text-white"><Plus size={17}/></button>
              </div>
              <textarea value={bulkText} onChange={(e)=>setBulkText(e.target.value)} placeholder={"여러 명 붙여넣기\n홍길동,01012345678\n김철수,01098765432"} className="mt-2 min-h-20 w-full rounded-lg border border-slate-200 p-3 text-xs outline-none focus:border-blue-400"/>
              <button onClick={addBulk} className="mt-2 w-full rounded-lg bg-slate-100 py-2 text-xs font-bold text-slate-700">붙여넣은 연락처 추가</button>
            </div>
          </div>
          {recipients.length > 0 && <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-slate-100 p-2">
            <div className="flex flex-wrap gap-2">{recipients.map((r)=><span key={r.phone} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs"><b>{r.name||"이름없음"}</b> {prettyPhone(r.phone)} <button onClick={()=>setRecipients((p)=>p.filter((x)=>x.phone!==r.phone))}><X size={12}/></button></span>)}</div>
            <button onClick={()=>setRecipients([])} className="mt-2 text-xs font-bold text-red-500">전체 삭제</button>
          </div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4"><h2 className="font-black text-slate-900">2. 발신번호 · 메시지</h2><p className="text-xs text-slate-400">알리고에 등록할 담당자 번호를 선택합니다.</p></div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-bold text-slate-500">발신번호
              <select value={senderId} onChange={(e)=>setSenderId(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">발신번호 선택</option>
                {senders.filter((s)=>s.is_active).map((s)=><option key={s.id} value={s.id}>{s.staff_name} · {s.label} · {prettyPhone(s.phone)}{s.is_registered?" · 등록완료":" · 등록대기"}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">저장 문구
              <select defaultValue="" onChange={(e)=>{const t=templates.find((x)=>x.id===e.target.value); if(t)setMessage(t.body);}} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">문구 선택</option>{templates.map((t)=><option key={t.id} value={t.id}>{t.category} · {t.name}</option>)}
              </select>
            </label>
          </div>
          {(msgType==="LMS"||msgType==="MMS") && <label className="mt-4 block text-xs font-bold text-slate-500">제목
            <input value={title} maxLength={44} onChange={(e)=>setTitle(e.target.value)} placeholder="장문/그림문자 제목" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"/>
          </label>}
          <label className="mt-4 block text-xs font-bold text-slate-500">문구 작성
            <textarea value={message} onChange={(e)=>setMessage(e.target.value)} placeholder="발송할 문자 내용을 입력하세요. {고객명}을 사용하면 수신자 이름으로 치환됩니다." className="mt-1 min-h-44 w-full rounded-xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-blue-400"/>
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex gap-2"><span className={`rounded-full px-2.5 py-1 font-black ${msgType==="SMS"?"bg-emerald-50 text-emerald-700":"bg-violet-50 text-violet-700"}`}>{msgType}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">약 {bytes} Byte</span></div>
            <span className="text-slate-400">알리고 기준 SMS 90Byte 초과 시 LMS 권장</span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label className="flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-600">
              <ImagePlus size={20}/> 이미지 첨부 ({images.length}/3)
              <input type="file" accept="image/jpeg,image/png,image/gif" multiple className="hidden" onChange={(e)=>setImages(Array.from(e.target.files??[]).slice(0,3))}/>
            </label>
            <label className="text-xs font-bold text-slate-500">예약발송 <span className="font-normal text-slate-400">(선택)</span>
              <input type="datetime-local" value={reservedAt} onChange={(e)=>setReservedAt(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"/>
              <div className="mt-1 font-normal text-slate-400">알리고 연결 후 예약시간 10분 이후 규칙을 최종 검증합니다.</div>
            </label>
          </div>
          {images.length>0 && <div className="mt-2 flex flex-wrap gap-2">{images.map((f)=><span key={f.name} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">{f.name}</span>)}</div>}
          <button disabled={busy} onClick={()=>void queueSend()} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"><Send size={17}/>{busy?"등록 중...":`발송대기 등록 · ${recipients.length}건`}</button>
        </section>
      </div>

      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm 2xl:sticky 2xl:top-5">
        <div className="mb-4 flex items-center justify-between"><b>미리보기</b><span className="text-xs text-slate-400">{msgType}</span></div>
        <div className="mx-auto max-w-[330px] rounded-[32px] border-[7px] border-slate-900 bg-slate-50 p-4 shadow-xl">
          <div className="mb-5 text-center text-[11px] font-bold text-slate-400">{selectedSender?prettyPhone(selectedSender.phone):"발신번호"}</div>
          <div className="rounded-2xl rounded-tl-md bg-white p-4 text-sm leading-6 shadow-sm">
            {title && <div className="mb-2 font-black">{title}</div>}
            <div className="whitespace-pre-wrap">{message||"문자 내용을 입력하면 이곳에 미리 표시됩니다."}</div>
            {images.length>0 && <div className="mt-3 rounded-xl bg-slate-100 p-6 text-center text-xs text-slate-400"><ImagePlus className="mx-auto mb-1"/>이미지 {images.length}장 첨부</div>}
          </div>
          <div className="mt-2 text-right text-[10px] text-slate-400">수신 {recipients.length}명</div>
        </div>
      </aside>
    </div>}

    {tab === "history" && <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="font-black">발송내역</h2><p className="text-xs text-slate-400">수기발송과 자동발송을 함께 확인합니다.</p></div><button onClick={()=>void load()} className="rounded-lg border border-slate-200 p-2 text-slate-500"><RefreshCw size={16}/></button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>{["등록일시","구분","수신자","발신번호","유형","내용","상태","알리고 ID"].map((h)=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
      <tbody>{history.map((h)=><tr key={h.id} className="border-t border-slate-100"><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{new Date(h.created_at).toLocaleString("ko-KR")}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{sourceLabel(h.source)}</span></td><td className="px-4 py-3"><b>{h.receiver_name||"-"}</b><div className="text-xs text-slate-400">{prettyPhone(h.receiver_number)}</div></td><td className="px-4 py-3 text-xs">{prettyPhone(h.sender_number)}</td><td className="px-4 py-3 font-bold">{h.msg_type}</td><td className="max-w-[320px] truncate px-4 py-3 text-xs">{h.message}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${h.status==="sent"?"bg-emerald-50 text-emerald-700":h.status==="failed"?"bg-red-50 text-red-700":"bg-amber-50 text-amber-700"}`}>{statusLabel(h.status)}</span></td><td className="px-4 py-3 text-xs text-slate-400">{h.provider_message_id||"-"}</td></tr>)}
      {!history.length&&<tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">아직 발송내역이 없습니다.</td></tr>}</tbody></table></div>
    </section>}

    {tab === "automation" && <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-black">신규 DB 즉시문자</h2><p className="text-xs text-slate-400">DB 입고 + 담당자 배정 시 담당자 발신번호로 자동 등록</p></div><input type="checkbox" checked={automation.new_lead_enabled} onChange={(e)=>setAutomation((p)=>({...p,new_lead_enabled:e.target.checked}))} className="size-5"/></div>
        <textarea value={automation.new_lead_template} onChange={(e)=>setAutomation((p)=>({...p,new_lead_template:e.target.value}))} className="min-h-36 w-full rounded-xl border border-slate-200 p-4 text-sm leading-6"/>
        <div className="mt-2 text-xs text-slate-400">치환값: {"{고객명}"} · {"{담당자}"}</div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-black">부재중 자동문자</h2><p className="text-xs text-slate-400">상담일지에서 부재중 기록 추가 시 자동 등록</p></div><input type="checkbox" checked={automation.absence_enabled} onChange={(e)=>setAutomation((p)=>({...p,absence_enabled:e.target.checked}))} className="size-5"/></div>
        <textarea value={automation.absence_template} onChange={(e)=>setAutomation((p)=>({...p,absence_template:e.target.value}))} className="min-h-36 w-full rounded-xl border border-slate-200 p-4 text-sm leading-6"/>
        <label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-500">중복 클릭 방지
          <input type="number" min={0} max={60} value={automation.duplicate_guard_minutes} onChange={(e)=>setAutomation((p)=>({...p,duplicate_guard_minutes:Number(e.target.value)||0}))} className="h-9 w-20 rounded-lg border border-slate-200 px-2"/>분
        </label>
      </section>
      <section className="xl:col-span-2 rounded-2xl border border-blue-100 bg-blue-50 p-5">
        <div className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-blue-600"/><div className="text-sm text-blue-900"><b>자동발송 동작 기준</b><div className="mt-1 leading-6 text-blue-700">구글시트·메타·수기 DB 모두 app_leads에 들어오는 순간 동일하게 감지합니다. 담당자에게 매핑된 발신번호가 없으면 기본 발신번호를 사용합니다. API 연결 전에는 실제 발송하지 않고 대기열에 저장합니다.</div></div></div>
      </section>
      {canManage && <button disabled={busy} onClick={()=>void saveAutomation()} className="xl:col-span-2 h-12 rounded-xl bg-slate-900 text-sm font-black text-white">자동발송 설정 저장</button>}
    </div>}

    {tab === "settings" && <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4"><h2 className="flex items-center gap-2 font-black"><Phone size={17}/> 담당자별 발신번호</h2><p className="text-xs text-slate-400">알리고에서 사전 등록한 번호와 담당자를 매핑합니다.</p></div>
        <div className="space-y-2">{senders.map((s)=><div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><div className="grid size-9 place-items-center rounded-full bg-blue-50 text-blue-700"><Phone size={15}/></div><div className="min-w-0 flex-1"><b className="text-sm">{s.staff_name} · {s.label}</b><div className="text-xs text-slate-400">{prettyPhone(s.phone)} · {s.is_registered?"알리고 등록완료":"알리고 등록대기"}</div></div>{s.is_default?<span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">기본</span>:canManage&&<button onClick={()=>void setDefaultSender(s.id)} className="text-xs font-bold text-blue-600">기본지정</button>}{canManage&&<button onClick={()=>void deleteSender(s.id)} className="text-red-400"><Trash2 size={15}/></button>}</div>)}</div>
        {canManage && <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={newSender.staff_name} onChange={(e)=>setNewSender((p)=>({...p,staff_name:e.target.value}))} className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">담당자 선택</option>{workStaffNames.map((n)=><option key={n}>{n}</option>)}</select>
            <input value={newSender.label} onChange={(e)=>setNewSender((p)=>({...p,label:e.target.value}))} placeholder="표시명 (예: 영업용)" className="h-10 rounded-lg border border-slate-200 px-3 text-sm"/>
            <input value={newSender.phone} onChange={(e)=>setNewSender((p)=>({...p,phone:e.target.value}))} placeholder="발신번호" className="h-10 rounded-lg border border-slate-200 px-3 text-sm"/>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold"><input type="checkbox" checked={newSender.is_registered} onChange={(e)=>setNewSender((p)=>({...p,is_registered:e.target.checked}))}/> 알리고 발신번호 등록완료</label>
          </div>
          <button onClick={()=>void addSender()} className="mt-2 w-full rounded-lg bg-blue-600 py-2.5 text-xs font-black text-white">발신번호 추가</button>
        </div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4"><h2 className="flex items-center gap-2 font-black"><BookOpen size={17}/> 문구 템플릿</h2><p className="text-xs text-slate-400">자주 쓰는 안내문을 저장해 발송화면에서 바로 불러옵니다.</p></div>
        <div className="space-y-2">{templates.map((t)=><div key={t.id} className="rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><div><span className="mr-2 rounded bg-slate-100 px-2 py-1 text-[10px] font-bold">{t.category}</span><b className="text-sm">{t.name}</b></div>{canManage&&<button onClick={()=>void deleteTemplate(t.id)} className="text-red-400"><Trash2 size={15}/></button>}</div><div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-500">{t.body}</div><button onClick={()=>{setMessage(t.body);setTab("send");}} className="mt-2 text-xs font-bold text-blue-600">이 문구로 보내기</button></div>)}</div>
        {canManage && <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <div className="grid grid-cols-[1fr_110px] gap-2"><input value={newTemplate.name} onChange={(e)=>setNewTemplate((p)=>({...p,name:e.target.value}))} placeholder="템플릿명" className="h-10 rounded-lg border border-slate-200 px-3 text-sm"/><select value={newTemplate.category} onChange={(e)=>setNewTemplate((p)=>({...p,category:e.target.value}))} className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option>일반</option><option>상담</option><option>분납</option><option>서류</option><option>공지</option></select></div>
          <textarea value={newTemplate.body} onChange={(e)=>setNewTemplate((p)=>({...p,body:e.target.value}))} placeholder="저장할 문구" className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm"/>
          <button onClick={()=>void addTemplate()} className="mt-2 w-full rounded-lg bg-slate-900 py-2.5 text-xs font-black text-white">문구 저장</button>
        </div>}
      </section>

      <section className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-black">API 연결 전 체크</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          {[["발신번호 등록","알리고 사이트에서 사용할 번호를 사전 등록"],["API Key","서버 환경변수에만 저장"],["테스트모드","실발송 전 testmode_yn=Y로 검증"],["결과 동기화","msg_id 기준 성공·실패 결과 반영"]].map(([a,b])=><div key={a} className="rounded-xl bg-slate-50 p-4"><b className="text-sm">{a}</b><div className="mt-1 text-xs leading-5 text-slate-400">{b}</div></div>)}
        </div>
      </section>
    </div>}
  </div>;
}
