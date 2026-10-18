"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  BookOpen, CheckCircle2, Clock3, ImagePlus, MessageSquareText,
  Phone, Plus, RefreshCw, Send, Settings2, Trash2, UploadCloud, X
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStoreSession as useStore } from "@/lib/store";
import DeliveryControls, { validDeliveryState, type DeliveryState } from "@/components/sms/DeliveryControls";

type Tab = "send" | "history" | "automation" | "settings";
export type Recipient = { name: string; phone: string };
type Sender = { id: string; staff_name: string; label: string; phone: string; is_default: boolean; is_active: boolean; is_registered: boolean };
type Template = { id: string; name: string; category: string; body: string };
type Outbox = {
  id: string; receiver_name: string | null; receiver_number: string; sender_number: string; message: string;
  msg_type: string; status: string; source: string; auto_kind: string | null; created_at: string; provider_message_id: string | null;
  recordKind: "legacy" | "delivery"; reserved_at: string | null; error_message: string | null; deleted_at: string | null;
};
type Automation = {
  new_lead_enabled: boolean; absence_enabled: boolean; new_lead_template: string; absence_template: string;
  duplicate_guard_minutes: number;
};
type StaffAutomation = {
  id?: string; staff_name: string; sender_number_id: string | null;
  new_lead_enabled: boolean; absence_enabled: boolean;
  new_lead_template: string; absence_template: string;
  new_lead_image_paths: string[]; absence_image_paths: string[];
};
type SendRequest = {
  lawFirmId: string; epochId: string; requestId: string; senderNumberId: string;
  recipients: Recipient[]; message: string; title: string | null; imagePaths: string[]; reservedAt: string | null;
};
export type SmsDraft = {
  tab: Tab; senderId: string; recipients: Recipient[]; manualName: string; manualPhone: string; bulkText: string;
  title: string; message: string; images: File[]; reservedAt: string; automation: Automation; automationStaff: string;
  staffAutomation: StaffAutomation; newLeadAutoImages: File[]; absenceAutoImages: File[];
  newSender: { staff_name: string; label: string; phone: string; is_registered: boolean };
  newTemplate: { name: string; category: string; body: string }; pendingRequest: SendRequest | null; automationDirty: boolean;
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
  return ({ pending_api:"API 연동대기", queued:"신규 요청 대기", scheduled:"예약 요청 대기", claimed:"처리 중", sending:"처리 중", accepted:"접수 · 결과확인중", pending:"접수 · 결과확인중", sent:"발송완료", delivered:"발송완료", delivery_delivered:"전달완료", delivery_failed:"전달 실패", delivery_unknown:"전달 확인 필요 · 재발송 안함", failed:"실패", rejected:"접수 거절", unknown:"확인 필요 · 재발송 안함", cancelled:"취소", expired:"활성 구간 종료 · 미발송" } as Record<string,string>)[status] ?? status;
}
function sourceLabel(source: string) {
  return ({ manual:"수기발송", file:"주소록파일", new_lead:"신규DB 자동", absence:"부재중 자동" } as Record<string,string>)[source] ?? source;
}

export default function SmsCenter({ initialRecipients = [], contextKey = "center", draftCache }: { initialRecipients?: Recipient[]; contextKey?: string; draftCache?: Map<string, SmsDraft> }) {
  const { profile, superAdminFirmScope } = useStore();
  const firmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const localDrafts = useRef(new Map<string, SmsDraft>());
  const drafts = draftCache ?? localDrafts.current;
  const owner = useRef(profile?.id);
  if (owner.current !== profile?.id) { drafts.clear(); owner.current = profile?.id; }
  const scope = `${profile?.id ?? "anonymous"}:${firmId ?? "no-firm"}:${contextKey}`;
  const saveDraft = useCallback((draft: SmsDraft) => { if (owner.current === profile?.id) drafts.set(scope, draft); }, [scope, profile?.id, drafts]);
  return <SmsFirmWorkspace key={scope} initialDraft={drafts.get(scope)} onDraftChange={saveDraft} initialRecipients={initialRecipients}/>;
}

export function SmsFirmWorkspace({ initialDraft, onDraftChange, initialRecipients = [] }: { initialDraft?: SmsDraft; onDraftChange: (draft: SmsDraft) => void; initialRecipients?: Recipient[] }) {
  const supabase = useMemo(() => createClient(), []);
  const { profile, superAdminFirmScope, workStaffNames, can } = useStore();
  const firmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const [tab, setTab] = useState<Tab>(initialDraft?.tab ?? "send");
  const [senders, setSenders] = useState<Sender[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [history, setHistory] = useState<Outbox[]>([]);
  const [automation, setAutomation] = useState<Automation>(initialDraft?.automation ?? {
    new_lead_enabled: true, absence_enabled: true, new_lead_template: DEFAULT_NEW, absence_template: DEFAULT_ABSENCE, duplicate_guard_minutes: 5
  });
  const [staffAutomationRows, setStaffAutomationRows] = useState<StaffAutomation[]>([]);
  const [automationStaff, setAutomationStaff] = useState(initialDraft?.automationStaff ?? profile?.staffName ?? "");
  const [staffAutomation, setStaffAutomation] = useState<StaffAutomation>(initialDraft?.staffAutomation ?? {
    staff_name: profile?.staffName ?? "", sender_number_id: null,
    new_lead_enabled: true, absence_enabled: true, new_lead_template: DEFAULT_NEW, absence_template: DEFAULT_ABSENCE,
    new_lead_image_paths: [], absence_image_paths: []
  });
  const [newLeadAutoImages, setNewLeadAutoImages] = useState<File[]>(initialDraft?.newLeadAutoImages ?? []);
  const [absenceAutoImages, setAbsenceAutoImages] = useState<File[]>(initialDraft?.absenceAutoImages ?? []);
  const [senderId, setSenderId] = useState(initialDraft?.senderId ?? "");
  const [recipients, setRecipients] = useState<Recipient[]>(() => initialDraft?.recipients ?? mergeRecipients([], initialRecipients));
  const [manualName, setManualName] = useState(initialDraft?.manualName ?? "");
  const [manualPhone, setManualPhone] = useState(initialDraft?.manualPhone ?? "");
  const [bulkText, setBulkText] = useState(initialDraft?.bulkText ?? "");
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const [message, setMessage] = useState(initialDraft?.message ?? "");
  const [images, setImages] = useState<File[]>(initialDraft?.images ?? []);
  const [reservedAt, setReservedAt] = useState(initialDraft?.reservedAt ?? "");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [newSender, setNewSender] = useState(initialDraft?.newSender ?? { staff_name: profile?.staffName ?? "", label: "", phone: "", is_registered: false });
  const [newTemplate, setNewTemplate] = useState(initialDraft?.newTemplate ?? { name: "", category: "일반", body: "" });
  const [delivery, setDelivery] = useState<DeliveryState | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(true);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyView, setHistoryView] = useState<"active" | "deleted">("active");
  const [canManageHistory, setCanManageHistory] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const [historyUpdatedAt, setHistoryUpdatedAt] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [pendingRequest, setPendingRequest] = useState<SendRequest | null>(initialDraft?.pendingRequest ?? null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const sending = useRef(false);
  const gateSaving = useRef(false);
  const automationDirty = useRef(initialDraft?.automationDirty ?? false);
  const pendingRef = useRef<SendRequest | null>(initialDraft?.pendingRequest ?? null);
  const loadSequence = useRef(0);
  const deliverySequence = useRef(0);
  const historySequence = useRef(0);
  const deliveryAbort = useRef<AbortController | null>(null);
  const historyAbort = useRef<AbortController | null>(null);
  const historyInFlight = useRef(false);
  const historyMutating = useRef(false);
  const serverOffset = useRef(0);

  const selectedSender = senders.find((s) => s.id === senderId);
  const bytes = smsBytes(message);
  const msgType = images.length ? "MMS" : bytes <= 90 ? "SMS" : "LMS";
  const canSend = can("sms.send");
  const canHistory = can("sms.view_history");
  const canManage = can("sms.manage_settings");
  const liveReady = !!delivery && !deliveryLoading && !deliverySaving && !deliveryError && delivery.globalReady !== false && delivery.gate.liveEnabled && !!delivery.gate.epochId;
  const latestDraft = useRef<SmsDraft | null>(null);
  latestDraft.current = { tab, senderId, recipients, manualName, manualPhone, bulkText, title, message, images, reservedAt, automation, automationStaff, staffAutomation, newLeadAutoImages, absenceAutoImages, newSender, newTemplate, pendingRequest, automationDirty: automationDirty.current };
  useEffect(() => { if (latestDraft.current) onDraftChange(latestDraft.current); });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; loadSequence.current++; deliverySequence.current++; historySequence.current++;
      deliveryAbort.current?.abort(); historyAbort.current?.abort();
      if (latestDraft.current) onDraftChange({ ...latestDraft.current, pendingRequest: pendingRef.current });
    };
  }, [onDraftChange]);

  const authorizedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("로그인이 필요합니다. 작성한 내용은 유지됩니다.");
    if (!mounted.current || init.signal?.aborted) throw new Error("화면이 변경되어 요청을 중단했습니다.");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${data.session.access_token}`);
    return fetch(url, { ...init, headers });
  }, [supabase]);

  const loadDelivery = useCallback(async () => {
    if (!firmId) { setDeliveryLoading(false); return; }
    const sequence = ++deliverySequence.current;
    deliveryAbort.current?.abort();
    const controller = new AbortController(); deliveryAbort.current = controller;
    setDeliveryLoading(true); setDeliveryError("");
    try {
      const response = await authorizedFetch(`/api/sms/delivery?lawFirmId=${encodeURIComponent(firmId)}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !validDeliveryState(data)) throw new Error(data?.error || "서버 발송 상태를 확인하지 못했습니다.");
      if (!mounted.current || sequence !== deliverySequence.current) return;
      serverOffset.current = Date.parse(data.serverTime) - Date.now();
      setDelivery(data);
    } catch (error) {
      if (!mounted.current || sequence !== deliverySequence.current || controller.signal.aborted) return;
      setDelivery(null); setDeliveryError(error instanceof Error ? error.message : "서버 발송 상태를 확인하지 못했습니다.");
    } finally { if (mounted.current && sequence === deliverySequence.current) setDeliveryLoading(false); }
  }, [firmId, authorizedFetch]);

  const loadHistory = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!firmId || !canHistory || historyMutating.current || (quiet && historyInFlight.current)) return;
    const sequence = ++historySequence.current;
    historyInFlight.current = true;
    historyAbort.current?.abort();
    const controller = new AbortController(); historyAbort.current = controller;
    setHistoryLoading(true); setHistoryError("");
    try {
      const response = await authorizedFetch(`/api/sms/history?lawFirmId=${encodeURIComponent(firmId)}&view=${historyView}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data?.items)) throw new Error(data?.error || "발송내역을 읽지 못했습니다.");
      const rows: Outbox[] = data.items.map((row: Record<string, unknown>) => {
        if (!row || typeof row.id !== "string" || !["legacy", "delivery"].includes(String(row.recordKind)) || typeof row.status !== "string") throw new Error("발송내역 응답을 확인하지 못했습니다.");
        return { id: row.id, recordKind: row.recordKind as "legacy" | "delivery", receiver_name: String(row.receiverName ?? ""), receiver_number: String(row.receiverNumber ?? ""), sender_number: String(row.senderNumber ?? ""), message: String(row.message ?? ""), msg_type: String(row.msgType ?? ""), status: row.status, source: String(row.source ?? ""), auto_kind: typeof row.autoKind === "string" ? row.autoKind : null, created_at: String(row.createdAt ?? ""), reserved_at: typeof row.reservedAt === "string" ? row.reservedAt : null, provider_message_id: row.providerMessageId == null ? null : String(row.providerMessageId), error_message: typeof row.errorMessage === "string" ? row.errorMessage : null, deleted_at: typeof row.deletedAt === "string" ? row.deletedAt : null };
      });
      if (mounted.current && sequence === historySequence.current) {
        setHistory(rows); setCanManageHistory(data.canManageHistory === true); setHistoryUpdatedAt(new Date().toISOString());
        setSelectedHistoryIds((previous) => data.canManageHistory === true ? previous.filter((id) => rows.some((row) => row.id === id)) : []);
      }
    } catch (error) {
      if (mounted.current && sequence === historySequence.current && !controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "발송내역을 읽지 못했습니다.");
    } finally { if (mounted.current && sequence === historySequence.current) { historyInFlight.current = false; setHistoryLoading(false); } }
  }, [firmId, canHistory, historyView, authorizedFetch]);

  useEffect(() => { void loadDelivery(); }, [loadDelivery]);
  useEffect(() => {
    if (tab !== "history" || !canHistory) return;
    const refresh = () => { if (document.visibilityState === "visible") void loadHistory({ quiet: true }); };
    refresh();
    const timer = setInterval(refresh, 12000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh);
      historySequence.current++; historyAbort.current?.abort(); historyInFlight.current = false;
    };
  }, [tab, canHistory, loadHistory, historyRefreshKey]);

  function changeHistoryView(view: "active" | "deleted") {
    if (historyMutating.current || view === historyView) return;
    historySequence.current++; historyAbort.current?.abort(); historyInFlight.current = false;
    setHistoryView(view); setHistory([]); setSelectedHistoryIds([]); setHistoryError(""); setHistoryNotice(""); setHistoryUpdatedAt(null); setHistoryLoading(true);
  }

  function toggleHistorySelection(id: string) {
    if (!canManageHistory || historyMutating.current) return;
    setSelectedHistoryIds((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : previous.length < 100 ? [...previous, id] : previous);
  }

  async function changeHistoryVisibility(ids: string[], restore: boolean) {
    if (!firmId || !canManageHistory || historyMutating.current || !ids.length || ids.length > 100 || ids.some((id) => !history.some((row) => row.id === id))) return;
    if (!restore && !confirm(`${ids.length}건을 발송내역 목록에서 삭제할까요?\n문자 발송·예약은 취소되지 않으며, 삭제한 내역은 복구할 수 있습니다.`)) return;
    historyMutating.current = true; setHistoryBusy(true); setHistoryError(""); setHistoryNotice("");
    historySequence.current++; historyAbort.current?.abort(); historyInFlight.current = false; setHistoryLoading(false);
    try {
      const response = await authorizedFetch("/api/sms/history", { method: restore ? "PATCH" : "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ lawFirmId: firmId, ids }) });
      const data = await response.json();
      if (!response.ok || data?.ok !== true) throw new Error(data?.error || "내역 목록 변경을 확인하지 못했습니다. 새로고침 후 확인해주세요.");
      if (!mounted.current) return;
      setSelectedHistoryIds([]); setHistoryNotice(`${ids.length}건의 내역을 ${restore ? "복구했습니다." : "목록에서 삭제했습니다. 삭제한 내역에서 복구할 수 있습니다."}`);
    } catch (error) {
      if (mounted.current) setHistoryNotice(error instanceof Error ? error.message : "내역 목록을 변경하지 못했습니다.");
    } finally {
      historyMutating.current = false;
      if (mounted.current) { setHistoryBusy(false); setHistoryRefreshKey((value) => value + 1); }
    }
  }

  async function saveDelivery(liveEnabled: boolean, autoEnabled: boolean) {
    if (!firmId || !delivery?.canManageGate || gateSaving.current) return;
    gateSaving.current = true; setDeliverySaving(true); setDeliveryError("");
    const sequence = ++deliverySequence.current; deliveryAbort.current?.abort();
    try {
      const response = await authorizedFetch("/api/sms/delivery", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ lawFirmId: firmId, expectedEpochId: delivery.gate.epochId, liveEnabled, autoEnabled, acknowledgeNewOnly: true }) });
      const data = await response.json();
      if (!response.ok || !validDeliveryState(data)) throw new Error(data?.error || "발송 활성 상태를 저장하지 못했습니다.");
      if (!mounted.current || sequence !== deliverySequence.current) return;
      serverOffset.current = Date.parse(data.serverTime) - Date.now(); setDelivery(data);
      setNotice("서버의 발송 활성 상태를 반영했습니다. 이전 대기 문자는 발송하지 않습니다.");
    } catch (error) {
      if (mounted.current && sequence === deliverySequence.current) { setDelivery(null); setDeliveryError(error instanceof Error ? error.message : "발송 활성 상태를 저장하지 못했습니다."); }
    } finally { gateSaving.current = false; if (mounted.current) { setDeliverySaving(false); setDeliveryLoading(false); } }
  }

  useEffect(() => {
    const allowedTabs: Tab[] = [
      ...(canSend ? ["send" as Tab] : []),
      ...(canHistory ? ["history" as Tab] : []),
      ...(canManage ? ["automation" as Tab, "settings" as Tab] : []),
    ];
    if (allowedTabs.length && !allowedTabs.includes(tab)) setTab(allowedTabs[0]);
  }, [canSend, canHistory, canManage, tab]);

  const load = useCallback(async () => {
    if (!firmId) return;
    const sequence = ++loadSequence.current;
    const [senderRes, templateRes, autoRes, staffAutoRes] = await Promise.all([
      supabase.from("sms_sender_numbers").select("*").eq("law_firm_id", firmId).order("is_default", { ascending:false }).order("staff_name"),
      supabase.from("sms_templates").select("id,name,category,body").eq("law_firm_id", firmId).order("created_at"),
      supabase.from("sms_automation_settings").select("new_lead_enabled,absence_enabled,new_lead_template,absence_template,duplicate_guard_minutes").eq("law_firm_id", firmId).maybeSingle(),
      supabase.from("sms_staff_automation_settings").select("id,staff_name,sender_number_id,new_lead_enabled,absence_enabled,new_lead_template,absence_template,new_lead_image_paths,absence_image_paths").eq("law_firm_id", firmId).order("staff_name"),
    ]);
    if (!mounted.current || sequence !== loadSequence.current) return;
    if (senderRes.error) setNotice(senderRes.error.message);
    else {
      const rows = (senderRes.data ?? []) as Sender[];
      setSenders(rows);
      setSenderId((prev) => prev || rows.find((s) => s.staff_name === profile?.staffName)?.id || rows.find((s) => s.is_default)?.id || rows[0]?.id || "");
    }
    if (!templateRes.error) setTemplates((templateRes.data ?? []) as Template[]);
    if (autoRes.data && !automationDirty.current) setAutomation(autoRes.data as Automation);
    if (!staffAutoRes.error) setStaffAutomationRows((staffAutoRes.data ?? []) as StaffAutomation[]);
  }, [firmId, profile?.staffName, supabase]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!automationStaff) {
      const first = profile?.staffName || workStaffNames[0] || "";
      if (first) setAutomationStaff(first);
      return;
    }
    if (automationDirty.current && staffAutomation.staff_name === automationStaff) return;
    const saved = staffAutomationRows.find((row) => row.staff_name === automationStaff);
    const mappedSender = senders.find((row) => row.staff_name === automationStaff && row.is_active);
    setStaffAutomation(saved ?? {
      staff_name: automationStaff,
      sender_number_id: mappedSender?.id ?? null,
      new_lead_enabled: automation.new_lead_enabled,
      absence_enabled: automation.absence_enabled,
      new_lead_template: automation.new_lead_template || DEFAULT_NEW,
      absence_template: automation.absence_template || DEFAULT_ABSENCE,
      new_lead_image_paths: [],
      absence_image_paths: [],
    });
    setNewLeadAutoImages([]);
    setAbsenceAutoImages([]);
  }, [automationStaff, staffAutomationRows, senders, automation, profile?.staffName, workStaffNames]);

  function addManual() {
    if (sending.current || pendingRef.current) return;
    const phone = digits(manualPhone);
    if (phone.length < 10) { setNotice("수신번호를 확인해주세요."); return; }
    setRecipients((prev) => mergeRecipients(prev, [{ name: manualName, phone }]));
    setManualName(""); setManualPhone(""); setNotice("");
  }

  function addBulk() {
    if (sending.current || pendingRef.current) return;
    const rows = bulkText.split(/\r?\n/).map((line) => {
      const parts = line.split(/[,\t]/).map((v) => v.trim());
      if (parts.length === 1) return { name:"", phone:parts[0] };
      return digits(parts[0]).length >= 10 ? { name:parts[1] ?? "", phone:parts[0] } : { name:parts[0], phone:parts[1] ?? "" };
    });
    setRecipients((prev) => mergeRecipients(prev, rows));
    setBulkText("");
  }

  async function parseAddressFile(file: File) {
    if (sending.current || pendingRef.current) return;
    try {
      const [buf, XLSX] = await Promise.all([file.arrayBuffer(), import("xlsx")]);
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
      if (!mounted.current || sending.current || pendingRef.current) return;
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
      if (!mounted.current) throw new Error("로펌 화면이 변경되어 요청을 중단했습니다.");
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${firmId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;
      const { error } = await supabase.storage.from("sms-media").upload(path, file, { upsert:false });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  }

  async function queueSend() {
    if (sending.current) return;
    const verifyingExisting = !!pendingRef.current;
    if (!canSend) { setNotice("문자 발송 권한이 없습니다."); return; }
    if (!firmId) { setNotice("대상 로펌을 먼저 선택해주세요."); return; }
    if (!pendingRef.current) {
      if (!liveReady || !delivery?.gate.epochId) { setNotice(delivery?.disabledReason || "서버에서 로펌 발송 활성 상태를 먼저 확인해주세요. 작성한 내용은 유지됩니다."); return; }
      if (!selectedSender?.is_active || !selectedSender.is_registered) { setNotice("알리고 등록이 완료된 활성 발신번호를 선택해주세요."); return; }
      if (!recipients.length) { setNotice("수신자를 1명 이상 추가해주세요."); return; }
      if (recipients.some((recipient) => !/^01[016789]\d{7,8}$/.test(recipient.phone))) { setNotice("수신번호를 확인해주세요. 올바른 단일 휴대전화 번호만 발송할 수 있습니다."); return; }
      if (!message.trim()) { setNotice("문자 내용을 작성해주세요."); return; }
      if (recipients.length > delivery.capabilities.maxRecipients) { setNotice(`한 번에 최대 ${delivery.capabilities.maxRecipients.toLocaleString()}명까지 요청할 수 있습니다.`); return; }
      if (images.length > delivery.capabilities.maxImages || (images.length && !delivery.capabilities.mms)) { setNotice("현재 서버에서 이 이미지 문자 요청을 지원하지 않습니다. 첨부한 파일은 유지됩니다."); return; }
      const longestMessage = Math.max(...recipients.map((recipient) => smsBytes(message.replaceAll("{고객명}", recipient.name || "고객"))));
      if (!images.length && !(longestMessage > 90 ? delivery.capabilities.lms : delivery.capabilities.sms)) { setNotice("현재 서버에서 이 문자 유형의 발송을 지원하지 않습니다."); return; }
      if (reservedAt && (!Number.isFinite(new Date(reservedAt).getTime()) || new Date(reservedAt).getTime() < Date.now() + serverOffset.current + delivery.capabilities.minReservationMinutes * 60000)) { setNotice(`예약시간은 서버 현재 시각보다 ${delivery.capabilities.minReservationMinutes}분 이상 이후로 지정해주세요.`); return; }
      if (!confirm(`${recipients.length.toLocaleString()}명에게 ${reservedAt ? "예약 문자" : "문자"} 발송을 요청할까요?\n이번에 작성한 요청만 등록하며, 이전 대기 문자는 발송하지 않습니다.`)) return;
    }
    sending.current = true;
    setBusy(true); setNotice("");
    try {
      if (!pendingRef.current) {
        const imagePaths = await uploadImages();
        if (!mounted.current) return;
        pendingRef.current = { lawFirmId: firmId, epochId: delivery!.gate.epochId!, requestId: crypto.randomUUID(), senderNumberId: selectedSender!.id, recipients: recipients.map((recipient) => ({ ...recipient })), message, title: title.trim() || null, imagePaths, reservedAt: reservedAt ? new Date(reservedAt).toISOString() : null };
        setPendingRequest(pendingRef.current);
      }
      const response = await authorizedFetch("/api/sms/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pendingRef.current) });
      const data = await response.json();
      if (!response.ok) {
        // A first explicit rejection did not approve a request. Once ambiguous, retain the ID even if later permissions or the gate change.
        if (!verifyingExisting && response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) { pendingRef.current = null; if (mounted.current) setPendingRequest(null); }
        throw new Error(data?.error || "발송 요청 접수 여부를 확인하지 못했습니다.");
      }
      if (data?.ok !== true || typeof data.batchId !== "string" || !Number.isInteger(data.createdCount) || data.createdCount < 0 || typeof data.reused !== "boolean" || !["queued", "scheduled"].includes(data.status)) throw new Error("발송 요청 접수 여부를 확인하지 못했습니다.");
      pendingRef.current = null;
      if (!mounted.current) {
        if (latestDraft.current) onDraftChange({ ...latestDraft.current, pendingRequest: null, recipients: [], message: "", title: "", images: [], reservedAt: "" });
        return;
      }
      setPendingRequest(null);
      setNotice(`${data.reused ? "기존 요청을 확인했습니다." : "새 요청을 등록했습니다."} ${data.createdCount.toLocaleString()}건${data.status === "scheduled" ? " · 예약 요청" : ""}. 발송 결과는 아래 내역에서 확인해주세요.`);
      setRecipients([]); setMessage(""); setTitle(""); setImages([]); setReservedAt("");
      if (canHistory) { setHistoryView("active"); setSelectedHistoryIds([]); setTab("history"); setHistoryRefreshKey((value) => value + 1); }
    } catch (e) {
      if (mounted.current) setNotice(`${e instanceof Error ? e.message : "발송 요청을 처리하지 못했습니다."}${pendingRef.current ? " 동일 요청으로 접수 여부를 다시 확인해주세요. 작성한 내용은 유지됩니다." : ""}`);
      else if (latestDraft.current) onDraftChange({ ...latestDraft.current, pendingRequest: pendingRef.current });
    } finally { sending.current = false; if (mounted.current) setBusy(false); }
  }

  async function uploadAutoImages(files: File[], kind: "new-lead" | "absence") {
    if (!firmId || !files.length) return [] as string[];
    const paths: string[] = [];
    for (const file of files.slice(0, 3)) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${firmId}/auto/${automationStaff}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;
      const { error } = await supabase.storage.from("sms-media").upload(path, file, { upsert:false });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  }

  async function saveAutomation() {
    if (!firmId || !automationStaff) { setNotice("자동발송을 설정할 영업자를 선택해주세요."); return; }
    setBusy(true); setNotice("");
    try {
      const [newLeadUploaded, absenceUploaded] = await Promise.all([
        uploadAutoImages(newLeadAutoImages, "new-lead"),
        uploadAutoImages(absenceAutoImages, "absence"),
      ]);
      const newLeadPaths = newLeadAutoImages.length ? newLeadUploaded : staffAutomation.new_lead_image_paths;
      const absencePaths = absenceAutoImages.length ? absenceUploaded : staffAutomation.absence_image_paths;

      const { error: globalError } = await supabase.from("sms_automation_settings").upsert({
        law_firm_id: firmId, ...automation, updated_by: profile?.id ?? null
      }, { onConflict:"law_firm_id" });
      if (globalError) throw globalError;

      const { error } = await supabase.from("sms_staff_automation_settings").upsert({
        law_firm_id: firmId,
        staff_name: automationStaff,
        sender_number_id: staffAutomation.sender_number_id || null,
        new_lead_enabled: staffAutomation.new_lead_enabled,
        absence_enabled: staffAutomation.absence_enabled,
        new_lead_template: staffAutomation.new_lead_template,
        absence_template: staffAutomation.absence_template,
        new_lead_image_paths: newLeadPaths,
        absence_image_paths: absencePaths,
        updated_by: profile?.id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict:"law_firm_id,staff_name" });
      if (error) throw error;
      automationDirty.current = false;
      setNewLeadAutoImages([]); setAbsenceAutoImages([]);
      setNotice(`${automationStaff} 자동발송 문구·이미지 설정을 저장했습니다.`);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "자동발송 설정 저장에 실패했습니다.");
    } finally { setBusy(false); }
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
    ...(canSend ? [["send","문자 보내기",<Send key="s" size={16}/>] as [Tab,string,ReactNode]] : []),
    ...(canHistory ? [["history","발송내역",<Clock3 key="h" size={16}/>] as [Tab,string,ReactNode]] : []),
    ...(canManage ? [["automation","자동발송",<RefreshCw key="a" size={16}/>] as [Tab,string,ReactNode], ["settings","발신번호 · 문구",<Settings2 key="g" size={16}/>] as [Tab,string,ReactNode]] : []),
  ];

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <div className="flex items-center gap-2 text-2xl font-black text-slate-900"><MessageSquareText className="text-blue-600"/> 문자발송</div>
        <p className="mt-1 text-sm text-slate-500">수기·주소록 대량발송과 DB 자동문자를 한 곳에서 관리합니다.</p>
      </div>
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${liveReady ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        <Clock3 size={14}/> {deliveryLoading ? "서버 발송 상태 확인 중" : deliveryError ? "발송 상태 확인 필요" : delivery && delivery.globalReady !== false ? `새 수기 요청 ${liveReady ? "활성" : "중지"} · 자동발송 ${delivery.gate.autoEnabled ? "활성" : "중지"}` : "실발송 중지 · 작성 및 설정 저장 가능"}
      </div>
    </div>

    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      {tabs.map(([id,label,icon]) => <button key={id} onClick={()=>setTab(id)} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold ${tab===id?"bg-slate-900 text-white":"text-slate-500 hover:bg-slate-50"}`}>{icon}{label}</button>)}
    </div>

    {notice && <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700"><span>{notice}</span><button onClick={()=>setNotice("")}><X size={15}/></button></div>}
    {(deliveryError || delivery?.disabledReason) && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{deliveryError || delivery?.disabledReason}</p>}
    {pendingRequest && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">이전 요청의 접수 여부를 확인해야 합니다. 작성한 내용을 유지하고 동일 요청 ID로 확인합니다. 새 요청을 추가하지 않습니다.</div>}

    {tabs.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">문자발송 메뉴 조회 권한은 있으나 사용할 수 있는 세부 권한이 없습니다. 관리자에게 문자 발송·발송내역·설정 권한 중 필요한 권한을 요청해주세요.</div>}

    {tab === "send" && canSend && <div className="grid gap-5 2xl:grid-cols-[1fr_390px]">
      <div className="space-y-5">
        <fieldset disabled={busy || !!pendingRequest} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
        </fieldset>

        <fieldset disabled={busy || !!pendingRequest} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4"><h2 className="font-black text-slate-900">2. 발신번호 · 메시지</h2><p className="text-xs text-slate-400">실발송은 알리고 등록이 완료된 담당자 번호를 사용합니다.</p></div>
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
              <div className="mt-1 font-normal text-slate-400">서버 현재 시각보다 {delivery?.capabilities.minReservationMinutes ?? 10}분 이상 이후로 지정합니다.</div>
            </label>
          </div>
          {images.length>0 && <div className="mt-2 flex flex-wrap gap-2">{images.map((f)=><span key={f.name} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">{f.name}</span>)}</div>}
        </fieldset>
        <div>
          <button disabled={busy || (!pendingRequest && !liveReady)} onClick={()=>void queueSend()} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Send size={17}/>{busy ? "요청 확인 중..." : pendingRequest ? "동일 요청 접수 여부 확인" : `${reservedAt ? "예약" : "새 문자"} 발송 요청 · ${recipients.length}건`}</button>
          {!liveReady && !pendingRequest && <p className="mt-2 text-center text-xs text-slate-500">서버의 로펌 발송 활성 상태가 확인되면 요청할 수 있습니다. 작성한 내용은 유지됩니다.</p>}
        </div>
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

    {tab === "history" && canHistory && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5">
        <div><h2 className="font-black">발송내역</h2><p className="mt-1 text-xs leading-5 text-slate-500">새 요청과 이전 보관 내역을 함께 표시합니다. 이전 대기 문자는 발송 대상에 포함되지 않습니다.</p>
          <p className="mt-1 text-xs text-slate-400">화면을 보고 있는 동안 12초마다 갱신{historyUpdatedAt ? ` · 최근 확인 ${new Date(historyUpdatedAt).toLocaleTimeString("ko-KR")}` : ""}</p>
        </div>
        <button type="button" disabled={historyLoading || historyBusy} onClick={()=>void loadHistory()} aria-label="발송내역 새로고침" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40"><RefreshCw size={15} className={historyLoading ? "animate-spin" : ""}/>{historyLoading ? "확인 중" : "새로고침"}</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={historyView === "active"} disabled={historyBusy} onClick={()=>changeHistoryView("active")} className={`rounded-lg px-3 py-2 text-xs font-bold ${historyView === "active" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>발송내역 보기</button>
          {(canManageHistory || historyView === "deleted") && <button type="button" aria-pressed={historyView === "deleted"} disabled={historyBusy} onClick={()=>changeHistoryView("deleted")} className={`rounded-lg px-3 py-2 text-xs font-bold ${historyView === "deleted" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>삭제한 내역</button>}
          <span className="text-xs text-slate-400">표시 {history.length.toLocaleString()}건</span>
        </div>
        {canManageHistory && <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{selectedHistoryIds.length}/100건 선택</span>
          <button type="button" disabled={!selectedHistoryIds.length || historyBusy || historyLoading} onClick={()=>void changeHistoryVisibility(selectedHistoryIds, historyView === "deleted")} className={`rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40 ${historyView === "deleted" ? "border-blue-200 text-blue-700" : "border-red-200 text-red-600"}`}>{historyBusy ? "목록 변경 중..." : historyView === "deleted" ? "선택 복구" : "선택 삭제"}</button>
        </div>}
      </div>
      {canManageHistory && <p className="bg-slate-50 px-5 py-2.5 text-xs leading-5 text-slate-500">삭제는 목록에서 보관하는 기능입니다. 문자 발송·예약을 취소하지 않으며, 삭제한 내역은 복구할 수 있습니다.</p>}
      {historyNotice && <p role="status" className="border-b border-blue-100 bg-blue-50 px-5 py-3 text-sm text-blue-700">{historyNotice}</p>}
      {historyError && <p role="alert" className="px-5 py-3 text-sm text-red-700">{historyError}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
        {canManageHistory && <th className="px-3 py-3"><input type="checkbox" aria-label="표시된 내역 최대 100건 선택" checked={history.length > 0 && history.slice(0,100).every((row)=>selectedHistoryIds.includes(row.id))} disabled={historyBusy || historyLoading || !history.length} onChange={(event)=>setSelectedHistoryIds(event.target.checked ? history.slice(0,100).map((row)=>row.id) : [])}/></th>}
        {["등록일시","구분","수신자","발신번호","유형","내용","상태","알리고 ID"].map((label)=><th key={label} className="px-4 py-3">{label}</th>)}
        {canManageHistory && <th className="px-4 py-3">관리</th>}
      </tr></thead><tbody>
        {history.map((h)=><tr key={`${h.recordKind}:${h.id}`} className={`border-t border-slate-100 ${selectedHistoryIds.includes(h.id) ? "bg-blue-50/50" : ""}`}>
          {canManageHistory && <td className="px-3 py-3"><input type="checkbox" aria-label={`${h.receiver_name || h.receiver_number || "문자"} 내역 선택`} value={h.id} checked={selectedHistoryIds.includes(h.id)} disabled={historyBusy || historyLoading || (selectedHistoryIds.length >= 100 && !selectedHistoryIds.includes(h.id))} onChange={()=>toggleHistorySelection(h.id)}/></td>}
          <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{new Date(h.created_at).toLocaleString("ko-KR")}{h.reserved_at && <div className="mt-1">예약 {new Date(h.reserved_at).toLocaleString("ko-KR")}</div>}{h.deleted_at && <div className="mt-1 text-slate-400">목록 삭제 {new Date(h.deleted_at).toLocaleString("ko-KR")}</div>}</td>
          <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{sourceLabel(h.source)}</span><div className="mt-1 text-[10px] text-slate-400">{h.recordKind === "legacy" ? "이전 보관" : "신규 승인 요청"}</div></td>
          <td className="px-4 py-3"><b>{h.receiver_name||"-"}</b><div className="text-xs text-slate-400">{prettyPhone(h.receiver_number)}</div></td>
          <td className="px-4 py-3 text-xs">{prettyPhone(h.sender_number)}</td><td className="px-4 py-3 font-bold">{h.msg_type}</td>
          <td className="max-w-[320px] truncate px-4 py-3 text-xs" title={h.message}>{h.message}</td>
          <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${h.status==="sent" || h.status==="delivered" || h.status==="delivery_delivered" ? "bg-emerald-50 text-emerald-700" : (h.status==="failed" || h.status==="delivery_failed") ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{h.recordKind === "legacy" && ["pending_api", "queued", "sending"].includes(h.status) ? "이전 보관 · 발송 대상 아님" : statusLabel(h.status)}</span>{h.error_message && <div className="mt-1 max-w-56 text-xs text-red-600">{h.error_message}</div>}</td>
          <td className="px-4 py-3 text-xs text-slate-400">{h.provider_message_id||"-"}</td>
          {canManageHistory && <td className="px-4 py-3"><button type="button" disabled={historyBusy || historyLoading} onClick={()=>void changeHistoryVisibility([h.id],historyView === "deleted")} aria-label={`${h.receiver_name || h.receiver_number || "문자"} 내역 ${historyView === "deleted" ? "복구" : "삭제"}`} className={`whitespace-nowrap text-xs font-bold disabled:opacity-40 ${historyView === "deleted" ? "text-blue-600" : "text-red-500"}`}>{historyView === "deleted" ? "복구" : "삭제"}</button></td>}
        </tr>)}
        {!history.length && !historyError && <tr><td colSpan={canManageHistory ? 10 : 8} className="px-4 py-12 text-center text-slate-400">{historyLoading ? "발송내역을 확인하고 있습니다." : historyView === "deleted" ? "삭제한 내역이 없습니다." : "아직 발송내역이 없습니다."}</td></tr>}
      </tbody></table></div>
    </section>}


    {tab === "automation" && canManage && <div className="space-y-5">
      <DeliveryControls state={delivery} loading={deliveryLoading} saving={deliverySaving} error={deliveryError} onRefresh={()=>void loadDelivery()} onSave={saveDelivery}/>
      <p className="text-sm leading-6 text-slate-600">아래 문구·이미지를 저장해도 자동발송은 켜지지 않습니다. 서버의 자동발송 활성 상태와 담당자별 선택이 모두 켜져 있어야 새 요청을 등록합니다.</p>
      <div className="space-y-5" onChangeCapture={()=>{ automationDirty.current = true; }}>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="font-black text-slate-900">영업자별 자동발송 설정</h2><p className="mt-1 text-xs text-slate-400">영업자마다 신규 DB·부재중 문구와 이미지를 각각 다르게 지정합니다.</p></div>
          <label className="w-full text-xs font-bold text-slate-500 lg:w-72">설정할 영업자
            <select value={automationStaff} onChange={(e)=>setAutomationStaff(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800">
              <option value="">영업자 선택</option>{workStaffNames.map((name)=><option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
        {automationStaff && <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-500">자동발송 발신번호
            <select value={staffAutomation.sender_number_id ?? ""} onChange={(e)=>setStaffAutomation((p)=>({...p,sender_number_id:e.target.value||null}))} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
              <option value="">담당자 매핑 번호 자동사용</option>{senders.filter((s)=>s.is_active).map((s)=><option key={s.id} value={s.id}>{s.staff_name} · {s.label} · {prettyPhone(s.phone)}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-500">부재중 중복발송 방지
            <div className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3"><input type="number" min={0} max={60} value={automation.duplicate_guard_minutes} onChange={(e)=>setAutomation((p)=>({...p,duplicate_guard_minutes:Number(e.target.value)||0}))} className="w-20 bg-transparent text-sm outline-none"/><span className="text-sm font-normal text-slate-500">분</span></div>
          </label>
        </div>}
      </section>

      {automationStaff && <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-black">신규 DB 즉시문자 · {automationStaff}</h2><p className="text-xs text-slate-400">DB 입고 후 담당 배정 시 자동 등록</p></div><input type="checkbox" checked={staffAutomation.new_lead_enabled} onChange={(e)=>setStaffAutomation((p)=>({...p,new_lead_enabled:e.target.checked}))} className="size-5"/></div>
          <label className="block text-xs font-bold text-slate-500">저장 문구 불러오기
            <select defaultValue="" onChange={(e)=>{const t=templates.find((x)=>x.id===e.target.value);if(t)setStaffAutomation((p)=>({...p,new_lead_template:t.body}));}} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">문구 선택</option>{templates.map((t)=><option key={t.id} value={t.id}>{t.category} · {t.name}</option>)}</select>
          </label>
          <textarea value={staffAutomation.new_lead_template} onChange={(e)=>setStaffAutomation((p)=>({...p,new_lead_template:e.target.value}))} className="mt-3 min-h-36 w-full rounded-xl border border-slate-200 p-4 text-sm leading-6"/>
          <div className="mt-2 text-xs text-slate-400">치환값: {"{고객명}"} · {"{담당자}"}</div>
          <label className="mt-4 flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-600"><ImagePlus size={20}/> 자동발송 이미지 ({newLeadAutoImages.length || staffAutomation.new_lead_image_paths.length}/3)<input type="file" accept="image/jpeg,image/png,image/gif" multiple className="hidden" onChange={(e)=>setNewLeadAutoImages(Array.from(e.target.files??[]).slice(0,3))}/></label>
          {(newLeadAutoImages.length>0 || staffAutomation.new_lead_image_paths.length>0) && <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{newLeadAutoImages.length>0 ? newLeadAutoImages.map((f)=><div key={f.name}>새 이미지 · {f.name}</div>) : staffAutomation.new_lead_image_paths.map((path)=><div key={path}>저장됨 · {path.split("/").pop()}</div>)}<button onClick={()=>{automationDirty.current=true;setNewLeadAutoImages([]);setStaffAutomation((p)=>({...p,new_lead_image_paths:[]}));}} className="mt-2 font-bold text-red-500">이미지 제거</button></div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-black">부재중 자동문자 · {automationStaff}</h2><p className="text-xs text-slate-400">상담일지에서 부재중 기록 추가 시 자동 등록</p></div><input type="checkbox" checked={staffAutomation.absence_enabled} onChange={(e)=>setStaffAutomation((p)=>({...p,absence_enabled:e.target.checked}))} className="size-5"/></div>
          <label className="block text-xs font-bold text-slate-500">저장 문구 불러오기
            <select defaultValue="" onChange={(e)=>{const t=templates.find((x)=>x.id===e.target.value);if(t)setStaffAutomation((p)=>({...p,absence_template:t.body}));}} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">문구 선택</option>{templates.map((t)=><option key={t.id} value={t.id}>{t.category} · {t.name}</option>)}</select>
          </label>
          <textarea value={staffAutomation.absence_template} onChange={(e)=>setStaffAutomation((p)=>({...p,absence_template:e.target.value}))} className="mt-3 min-h-36 w-full rounded-xl border border-slate-200 p-4 text-sm leading-6"/>
          <div className="mt-2 text-xs text-slate-400">치환값: {"{고객명}"} · {"{담당자}"}</div>
          <label className="mt-4 flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-600"><ImagePlus size={20}/> 자동발송 이미지 ({absenceAutoImages.length || staffAutomation.absence_image_paths.length}/3)<input type="file" accept="image/jpeg,image/png,image/gif" multiple className="hidden" onChange={(e)=>setAbsenceAutoImages(Array.from(e.target.files??[]).slice(0,3))}/></label>
          {(absenceAutoImages.length>0 || staffAutomation.absence_image_paths.length>0) && <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{absenceAutoImages.length>0 ? absenceAutoImages.map((f)=><div key={f.name}>새 이미지 · {f.name}</div>) : staffAutomation.absence_image_paths.map((path)=><div key={path}>저장됨 · {path.split("/").pop()}</div>)}<button onClick={()=>{automationDirty.current=true;setAbsenceAutoImages([]);setStaffAutomation((p)=>({...p,absence_image_paths:[]}));}} className="mt-2 font-bold text-red-500">이미지 제거</button></div>}
        </section>

        <section className="xl:col-span-2 rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <div className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-blue-600"/><div className="text-sm text-blue-900"><b>영업자별 자동발송 우선 적용</b><div className="mt-1 leading-6 text-blue-700">DB 담당자 이름과 일치하는 설정이 있으면 해당 영업자의 문구·이미지·발신번호를 사용합니다. 별도 설정이 없는 영업자는 기존 로펌 기본 문구와 담당자 매핑 발신번호를 사용합니다. 이미지가 있으면 MMS 대기열로 등록됩니다.</div></div></div>
        </section>
        {canManage && <button disabled={busy} onClick={()=>void saveAutomation()} className="xl:col-span-2 h-12 rounded-xl bg-slate-900 text-sm font-black text-white">{busy?"저장 중...":`${automationStaff} 자동발송 설정 저장`}</button>}
      </div>}
      </div>
    </div>}

    {tab === "settings" && canManage && <div className="grid gap-5 xl:grid-cols-2">
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
        <div className="space-y-2">{templates.map((t)=><div key={t.id} className="rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><div><span className="mr-2 rounded bg-slate-100 px-2 py-1 text-[10px] font-bold">{t.category}</span><b className="text-sm">{t.name}</b></div>{canManage&&<button onClick={()=>void deleteTemplate(t.id)} className="text-red-400"><Trash2 size={15}/></button>}</div><div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-500">{t.body}</div><button disabled={busy || !!pendingRequest || !canSend} onClick={()=>{if(sending.current || pendingRef.current)return;setMessage(t.body);setTab("send");}} className="mt-2 text-xs font-bold text-blue-600 disabled:opacity-40">이 문구로 보내기</button></div>)}</div>
        {canManage && <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <div className="grid grid-cols-[1fr_110px] gap-2"><input value={newTemplate.name} onChange={(e)=>setNewTemplate((p)=>({...p,name:e.target.value}))} placeholder="템플릿명" className="h-10 rounded-lg border border-slate-200 px-3 text-sm"/><select value={newTemplate.category} onChange={(e)=>setNewTemplate((p)=>({...p,category:e.target.value}))} className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option>일반</option><option>상담</option><option>분납</option><option>서류</option><option>공지</option></select></div>
          <textarea value={newTemplate.body} onChange={(e)=>setNewTemplate((p)=>({...p,body:e.target.value}))} placeholder="저장할 문구" className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm"/>
          <button onClick={()=>void addTemplate()} className="mt-2 w-full rounded-lg bg-slate-900 py-2.5 text-xs font-black text-white">문구 저장</button>
        </div>}
      </section>

      <section className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-black">문자 발송 안내</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          {[["발신번호 등록","알리고에 사전 등록한 활성 번호만 발송"],["이전 내역 보관","연결 전 대기 문자는 발송 대상에서 제외"],["자동발송","문구 저장과 별도로 서버에서 명시적으로 활성화"],["결과 확인","요청 등록·알리고 접수·최종 전달 결과를 구분"]].map(([a,b])=><div key={a} className="rounded-xl bg-slate-50 p-4"><b className="text-sm">{a}</b><div className="mt-1 text-xs leading-5 text-slate-400">{b}</div></div>)}
        </div>
      </section>
    </div>}
  </div>;
}
