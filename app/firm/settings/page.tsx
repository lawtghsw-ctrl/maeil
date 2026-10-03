"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Copy, KeyRound, Link2, Megaphone, PlayCircle, Plus, RefreshCcw, RotateCw, Settings2, UsersRound } from "lucide-react";
import { authJson } from "@/lib/platform/client";

type Data = {
  viewerRole: "super_admin" | "firm_admin";
  firm: any;
  metaAccounts: any[];
  sheets: any[];
  sources: any[];
  metaLogs: any[];
  ingestErrors: any[];
  metaRules: any[];
  metaQueue: any[];
  supplyLedger: any[];
};

const fmtDt = (value?: string | null) => value ? new Date(value).toLocaleString("ko-KR") : "없음";

function FirmSettingsContent() {
  const params = useSearchParams();
  const lawFirmId = params.get("lawFirmId") || "";
  const qs = lawFirmId ? `?lawFirmId=${encodeURIComponent(lawFirmId)}` : "";
  const [data, setData] = useState<Data | null>(null);
  const [invites, setInvites] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"staff" | "firm_admin">("staff");
  const [busyFlush, setBusyFlush] = useState(false);
  const [duplicateDays, setDuplicateDays] = useState(30);
  const [billingType, setBillingType] = useState("per_lead");
  const [leadUnitPrice, setLeadUnitPrice] = useState(0);
  const [meta, setMeta] = useState({ name: "", adAccountId: "", businessId: "", pageId: "", datasetId: "", accessToken: "", testEventCode: "" });
  const [sheet, setSheet] = useState({ name: "", spreadsheetId: "", sheetName: "Raw2" });
  const [source, setSource] = useState({ name: "", sourceKey: "", sheetIntegrationId: "", metaAccountId: "", metaFormId: "", campaignId: "", adsetId: "", adId: "" });
  const [rule, setRule] = useState({ triggerType: "detail_stage", triggerValue: "", eventName: "", enabled: false });

  async function load() {
    setError(null);
    try {
      const [d, i] = await Promise.all([
        authJson<Data>(`/api/firm/integrations${qs}`),
        authJson<{ invites: any[] }>(`/api/firm/invites${qs}`),
      ]);
      setData(d);
      setDuplicateDays(Number(d.firm?.duplicate_window_days || 30));
      setBillingType(String(d.firm?.billing_type || "per_lead"));
      setLeadUnitPrice(Number(d.firm?.lead_unit_price || 0));
      setInvites(i.invites);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    }
  }
  useEffect(() => { void load(); }, [lawFirmId]);

  async function postAction(body: Record<string, unknown>) {
    return authJson<any>("/api/firm/integrations", { method: "POST", body: JSON.stringify({ lawFirmId: lawFirmId || undefined, ...body }) });
  }
  async function patchAction(body: Record<string, unknown>) {
    return authJson<any>("/api/firm/integrations", { method: "PATCH", body: JSON.stringify({ lawFirmId: lawFirmId || undefined, ...body }) });
  }

  async function createInvite(role: "staff" | "firm_admin" = "staff") {
    try {
      const r = await authJson<any>("/api/firm/invites", { method: "POST", body: JSON.stringify({ lawFirmId: lawFirmId || undefined, role }) });
      setInviteCode(r.code);
      setInviteRole(role);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "초대 생성 실패"); }
  }
  async function revokeInvite(id: string) {
    if (!confirm("이 초대코드를 취소할까요?")) return;
    try { await authJson(`/api/firm/invites?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "초대 취소 실패"); }
  }
  async function createMeta() {
    try {
      await postAction({ action: "create_meta_account", ...meta });
      setMeta({ name: "", adAccountId: "", businessId: "", pageId: "", datasetId: "", accessToken: "", testEventCode: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "광고계정 저장 실패"); }
  }
  async function createSheet() {
    try {
      const r = await postAction({ action: "create_sheet", ...sheet });
      setSecret(r.ingestSecret);
      setSheet({ name: "", spreadsheetId: "", sheetName: "Raw2" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "시트 저장 실패"); }
  }
  async function rotateSheetSecret(id: string) {
    if (!confirm("기존 Sheet Secret은 즉시 무효화됩니다. 새 Secret을 발급할까요?")) return;
    try {
      const r = await patchAction({ kind: "sheet", id, rotateSecret: true });
      setSecret(r.ingestSecret);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Secret 재발급 실패"); }
  }
  async function createSource() {
    try {
      await postAction({ action: "create_source", ...source });
      setSource({ name: "", sourceKey: "", sheetIntegrationId: "", metaAccountId: "", metaFormId: "", campaignId: "", adsetId: "", adId: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "광고소스 저장 실패"); }
  }
  async function createRule() {
    try {
      await postAction({ action: "create_meta_rule", ...rule });
      setRule({ triggerType: "detail_stage", triggerValue: "", eventName: "", enabled: false });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Meta 규칙 저장 실패"); }
  }
  async function toggle(kind: "meta" | "sheet" | "source", id: string, active: boolean) {
    try { await patchAction({ kind, id, active }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "상태 변경 실패"); }
  }
  async function toggleRule(id: string, enabled: boolean) {
    try { await patchAction({ kind: "rule", id, enabled }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "규칙 변경 실패"); }
  }
  async function saveFirmPolicy() {
    try { await patchAction({ kind: "firm", duplicateWindowDays: duplicateDays, billingType, leadUnitPrice }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "로펌 운영설정 저장 실패"); }
  }
  async function flushMetaQueue() {
    setBusyFlush(true); setError(null);
    try {
      await authJson("/api/integrations/meta/flush", { method: "POST", body: JSON.stringify({ lawFirmId: lawFirmId || undefined, limit: 30 }) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Meta 대기열 전송 실패"); }
    finally { setBusyFlush(false); }
  }

  const activeInvites = useMemo(() => invites.filter((i) => !i.used_at && !i.revoked_at && new Date(i.expires_at).getTime() > Date.now()), [invites]);
  const queuePending = useMemo(() => data?.metaQueue.filter((x) => ["pending", "processing"].includes(x.status)).length ?? 0, [data]);
  const queueFailed = useMemo(() => data?.metaQueue.filter((x) => x.status === "failed").length ?? 0, [data]);

  if (!data) return <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">{error || "로펌 설정을 불러오는 중..."}</div>;
  const canManageIntegrations = data.viewerRole === "super_admin";

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-xs font-black text-blue-700">LAW FIRM WORKSPACE</div>
        <h1 className="mt-1 text-2xl font-black">{data.firm.name}</h1>
        <p className="mt-1 text-sm text-slate-500">로펌 ID <b className="font-mono text-slate-800">{data.firm.firm_code}</b> · Sheet / Meta / 광고소스 / 직원초대</p>
      </div>
      <button onClick={() => void load()} className="grid size-10 place-items-center rounded-xl border bg-white"><RefreshCcw size={16} /></button>
    </div>

    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
    {!canManageIntegrations && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"><b>로펌 관리자 화면</b> · 직원 초대는 직접 관리할 수 있고, 광고계정·Google Sheet·광고소스·Meta 자동전송 설정은 로파워에서 관리합니다.</div>}
    {inviteCode && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><div className="text-xs font-bold text-blue-700">새 {inviteRole === "firm_admin" ? "로펌관리자" : "직원"} 초대코드 · 24시간 · 1회용</div><div className="mt-2 flex items-center gap-2"><code className="rounded-lg bg-white px-3 py-2 text-lg font-black">{inviteCode}</code><button onClick={() => navigator.clipboard.writeText(inviteCode)} className="rounded-lg border bg-white p-2"><Copy size={16} /></button></div><p className="mt-2 text-xs text-blue-700">/join에서 사용합니다. 생성 후 이 화면을 벗어나면 전체 코드는 다시 표시되지 않습니다.</p></div>}
    {canManageIntegrations && secret && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs font-bold text-emerald-700">Google Sheet 연동 Secret · 최초 1회만 표시</div><div className="mt-2 flex items-center gap-2"><code className="max-w-full overflow-x-auto rounded-lg bg-white px-3 py-2 text-sm font-black">{secret}</code><button onClick={() => navigator.clipboard.writeText(secret)} className="rounded-lg border bg-white p-2"><Copy size={16} /></button></div></div>}

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 font-black"><Settings2 size={17} />DB 공급/중복 기준</div><p className="mt-1 text-xs text-slate-500">같은 로펌 안에서 동일 전화번호가 중복기간 안에 다시 들어오면 중복 처리합니다. DB 단가는 공급원장에 유입 당시 스냅샷으로 저장됩니다.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-4"><label><span className="mb-1 block text-[11px] font-bold text-slate-500">중복기간</span><div className="flex items-center gap-2"><input type="number" min={1} max={3650} value={duplicateDays} disabled={!canManageIntegrations} onChange={(e) => setDuplicateDays(Number(e.target.value))} className="h-9 w-full rounded-lg border px-3 text-sm disabled:bg-slate-100"/><span className="text-xs">일</span></div></label><label><span className="mb-1 block text-[11px] font-bold text-slate-500">과금방식</span><select value={billingType} disabled={!canManageIntegrations} onChange={(e)=>setBillingType(e.target.value)} className="h-9 w-full rounded-lg border px-3 text-sm disabled:bg-slate-100"><option value="per_lead">DB 건당</option><option value="monthly">월정액</option><option value="manual">수동정산</option></select></label><label><span className="mb-1 block text-[11px] font-bold text-slate-500">DB 단가</span><div className="flex items-center gap-2"><input type="number" min={0} value={leadUnitPrice} disabled={!canManageIntegrations} onChange={(e)=>setLeadUnitPrice(Number(e.target.value))} className="h-9 w-full rounded-lg border px-3 text-sm disabled:bg-slate-100"/><span className="text-xs">원</span></div></label><div className="flex items-end">{canManageIntegrations&&<button onClick={()=>void saveFirmPolicy()} className="h-9 w-full rounded-lg bg-slate-900 px-3 text-xs font-bold text-white">운영설정 저장</button>}</div></div>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 font-black"><UsersRound size={17} />직원 초대</div><p className="mt-1 text-xs text-slate-500">1명당 1회용 코드이며 24시간 후 자동 만료됩니다. 로펌 관리자는 STAFF만, 로파워는 필요 시 FIRM_ADMIN도 초대할 수 있습니다.</p></div><div className="flex gap-2"><button onClick={() => void createInvite("staff")} className="flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white"><Plus size={14} />직원 초대코드</button>{canManageIntegrations && <button onClick={() => void createInvite("firm_admin")} className="flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700"><Plus size={14} />로펌관리자 초대</button>}</div></div>
      <div className="mt-3 text-sm"><b>현재 유효 초대 {activeInvites.length}건</b><div className="mt-2 grid gap-2 sm:grid-cols-2">{invites.slice(0, 8).map((i) => { const valid = !i.used_at && !i.revoked_at && new Date(i.expires_at).getTime() > Date.now(); return <div key={i.id} className="rounded-lg border p-3"><div className="flex justify-between gap-2"><div><code>{i.code_preview}</code><span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{i.role === "firm_admin" ? "로펌관리자" : "직원"}</span></div><span className="text-xs font-bold text-slate-500">{i.used_at ? "사용완료" : i.revoked_at ? "취소" : !valid ? "만료" : "유효"}</span></div><div className="mt-1 flex items-center justify-between"><span className="text-[11px] text-slate-400">만료 {fmtDt(i.expires_at)}</span>{valid && <button onClick={() => void revokeInvite(i.id)} className="text-[11px] font-bold text-red-600">취소</button>}</div></div>; })}</div></div>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 font-black"><Megaphone size={17} />Meta 광고계정</div>
      <p className="mt-1 text-xs text-slate-500">한 로펌에 여러 광고계정을 등록할 수 있습니다. Access Token은 암호화 저장되며 화면에서 다시 노출하지 않습니다.</p>
      {canManageIntegrations && <div className="mt-3 grid gap-2 md:grid-cols-3">
        {(["name", "adAccountId", "datasetId", "pageId", "businessId", "testEventCode", "accessToken"] as const).map((k) => <input key={k} type={k === "accessToken" ? "password" : "text"} value={meta[k]} onChange={(e) => setMeta((v) => ({ ...v, [k]: e.target.value }))} placeholder={{ name: "구분명*", adAccountId: "Ad Account ID", datasetId: "Dataset/Pixel ID", pageId: "Page ID", businessId: "Business ID", testEventCode: "Test Event Code (선택)", accessToken: "Access Token" }[k]} className="h-10 rounded-lg border px-3 text-sm" />)}
        <button onClick={() => void createMeta()} className="h-10 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white">광고계정 추가</button>
      </div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{data.metaAccounts.map((m) => <div key={m.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><b>{m.name}</b>{canManageIntegrations ? <button onClick={() => void toggle("meta", m.id, !m.active)} className={`rounded-full px-2 py-1 text-[10px] font-bold ${m.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{m.active ? "활성" : "비활성"}</button> : <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${m.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{m.active ? "활성" : "비활성"}</span>}</div><div className="mt-1 text-xs text-slate-500">Ad {m.ad_account_id || "-"}</div><div className="text-xs text-slate-500">Dataset {m.dataset_id || "-"}</div><div className="text-xs text-slate-500">Token {m.hasAccessToken ? "암호화 저장됨" : "미등록"}</div><div className="mt-1 text-[11px] text-slate-400">최근 성공 {fmtDt(m.last_success_at)}</div>{m.last_error_at && <div className="mt-1 text-[11px] font-semibold text-red-600">최근 오류 {fmtDt(m.last_error_at)} · {m.last_error_message || "오류"}</div>}</div>)}</div>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 font-black"><Link2 size={17} />Google Sheet</div>
      <p className="mt-1 text-xs text-slate-500">로펌마다 별도 Spreadsheet를 등록합니다. Spreadsheet ID와 Sheet 이름이 모두 일치해야 DB를 받습니다.</p>
      {canManageIntegrations && <div className="mt-3 grid gap-2 md:grid-cols-4"><input value={sheet.name} onChange={(e) => setSheet((v) => ({ ...v, name: e.target.value }))} placeholder="연동명*" className="h-10 rounded-lg border px-3 text-sm" /><input value={sheet.spreadsheetId} onChange={(e) => setSheet((v) => ({ ...v, spreadsheetId: e.target.value }))} placeholder="Spreadsheet ID*" className="h-10 rounded-lg border px-3 text-sm" /><input value={sheet.sheetName} onChange={(e) => setSheet((v) => ({ ...v, sheetName: e.target.value }))} placeholder="Raw2" className="h-10 rounded-lg border px-3 text-sm" /><button onClick={() => void createSheet()} className="h-10 rounded-lg bg-slate-900 text-sm font-bold text-white">Sheet 추가</button></div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.sheets.map((s) => <div key={s.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><b>{s.name}</b><div className="flex gap-1">{canManageIntegrations && <button title="Secret 재발급" onClick={() => void rotateSheetSecret(s.id)} className="rounded-lg border p-1.5"><RotateCw size={13} /></button>}{canManageIntegrations ? <button onClick={() => void toggle("sheet", s.id, !s.active)} className={`rounded-full px-2 py-1 text-[10px] font-bold ${s.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{s.active ? "활성" : "비활성"}</button> : <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${s.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{s.active ? "활성" : "비활성"}</span>}</div></div><div className="mt-1 break-all text-xs text-slate-500">{s.sheet_name} · {s.spreadsheet_id || "ID 미입력"}</div><div className="text-xs text-slate-400">마지막 수신 {fmtDt(s.last_received_at)}</div></div>)}</div>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 font-black"><KeyRound size={17} />광고소스 매핑</div><p className="mt-1 text-xs text-slate-500">Instant Form / Sheet / Meta 광고계정을 하나의 Source로 묶습니다. 한 Sheet에 여러 Form이 들어오면 행의 Form ID/Ad ID로 자동 판별합니다. 같은 Form을 여러 광고에서 재사용하면 Ad ID도 등록하는 것을 권장합니다.</p>
      {canManageIntegrations && <div className="mt-3 grid gap-2 md:grid-cols-3"><input value={source.name} onChange={(e) => setSource((v) => ({ ...v, name: e.target.value }))} placeholder="소스명*" className="h-10 rounded-lg border px-3 text-sm" /><input value={source.sourceKey} onChange={(e) => setSource((v) => ({ ...v, sourceKey: e.target.value }))} placeholder="Source Key (비우면 자동)" className="h-10 rounded-lg border px-3 text-sm" /><input value={source.metaFormId} onChange={(e) => setSource((v) => ({ ...v, metaFormId: e.target.value }))} placeholder="Meta Form ID" className="h-10 rounded-lg border px-3 text-sm" /><input value={source.adId} onChange={(e) => setSource((v) => ({ ...v, adId: e.target.value }))} placeholder="Ad ID (같은 Form 재사용 시 권장)" className="h-10 rounded-lg border px-3 text-sm" /><input value={source.adsetId} onChange={(e) => setSource((v) => ({ ...v, adsetId: e.target.value }))} placeholder="Adset ID (선택)" className="h-10 rounded-lg border px-3 text-sm" /><input value={source.campaignId} onChange={(e) => setSource((v) => ({ ...v, campaignId: e.target.value }))} placeholder="Campaign ID (선택)" className="h-10 rounded-lg border px-3 text-sm" /><select value={source.sheetIntegrationId} onChange={(e) => setSource((v) => ({ ...v, sheetIntegrationId: e.target.value }))} className="h-10 rounded-lg border px-3 text-sm"><option value="">Sheet 선택*</option>{data.sheets.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select value={source.metaAccountId} onChange={(e) => setSource((v) => ({ ...v, metaAccountId: e.target.value }))} className="h-10 rounded-lg border px-3 text-sm"><option value="">Meta 광고계정 선택</option>{data.metaAccounts.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button onClick={() => void createSource()} className="h-10 rounded-lg bg-blue-600 text-sm font-bold text-white">광고소스 추가</button></div>}
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["소스", "SOURCE KEY", "FORM / AD", "SHEET", "META", "상태"].map((x) => <th key={x} className="p-2 text-left">{x}</th>)}</tr></thead><tbody>{data.sources.map((s) => <tr key={s.id} className="border-t"><td className="p-2 font-bold">{s.name}</td><td className="p-2 font-mono text-xs">{s.source_key}</td><td className="p-2"><div>{s.meta_form_id || "-"}</div><div className="text-[10px] text-slate-400">Ad {s.ad_id || "-"}</div></td><td className="p-2">{data.sheets.find((x) => x.id === s.sheet_integration_id)?.name || "-"}</td><td className="p-2">{data.metaAccounts.find((x) => x.id === s.meta_account_id)?.name || "-"}</td><td className="p-2">{canManageIntegrations ? <button onClick={() => void toggle("source", s.id, !s.active)} className={`rounded-full px-2 py-1 text-[10px] font-bold ${s.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{s.active ? "활성" : "비활성"}</button> : <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${s.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{s.active ? "활성" : "비활성"}</span>}</td></tr>)}</tbody></table></div>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 font-black"><PlayCircle size={17} />Meta 자동 피드백 규칙</div><p className="mt-1 text-xs text-slate-500">DB 상태/진행단계가 바뀌면 자동으로 전송 대기열에 쌓입니다. 활성 규칙의 실패 이벤트는 스케줄러가 주기적으로 재시도합니다. 기본 규칙은 안전을 위해 비활성 상태입니다.</p></div>{canManageIntegrations ? <button disabled={busyFlush} onClick={() => void flushMetaQueue()} className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-50">{busyFlush ? "전송 중..." : `대기열 전송 (${queuePending}/${queueFailed})`}</button> : <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">대기 {queuePending} · 실패 {queueFailed}</span>}</div>
      {canManageIntegrations && <div className="mt-3 grid gap-2 md:grid-cols-4"><select value={rule.triggerType} onChange={(e) => setRule((v) => ({ ...v, triggerType: e.target.value }))} className="h-10 rounded-lg border px-3 text-sm"><option value="detail_stage">진행단계</option><option value="status">내부상태</option></select><input value={rule.triggerValue} onChange={(e) => setRule((v) => ({ ...v, triggerValue: e.target.value }))} placeholder="예: 상담 / 수임전환" className="h-10 rounded-lg border px-3 text-sm" /><input value={rule.eventName} onChange={(e) => setRule((v) => ({ ...v, eventName: e.target.value }))} placeholder="Meta Event Name" className="h-10 rounded-lg border px-3 text-sm" /><button onClick={() => void createRule()} className="h-10 rounded-lg bg-slate-900 text-sm font-bold text-white">규칙 추가</button></div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{data.metaRules.map((r) => <div key={r.id} className="rounded-xl border p-3"><div className="flex items-center justify-between"><b className="text-sm">{r.trigger_type === "status" ? "상태" : "진행단계"} · {r.trigger_value}</b>{canManageIntegrations ? <button onClick={() => void toggleRule(r.id, !r.enabled)} className={`rounded-full px-2 py-1 text-[10px] font-bold ${r.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{r.enabled ? "자동전송 ON" : "OFF"}</button> : <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${r.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{r.enabled ? "자동전송 ON" : "OFF"}</span>}</div><div className="mt-1 text-xs text-slate-500">→ {r.event_name}</div></div>)}</div>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 font-black"><Settings2 size={17} />DB 공급 원장</div>
      <p className="mt-1 text-xs text-slate-500">Sheet 유입 기준으로 정상/재유입/중복 판정을 기록합니다. 기존 v27 이력은 backfill로 보존되며 과금대상에서 제외됩니다.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["수신시각","판정","과금","Lead","단가 스냅샷","구분"].map((x)=><th key={x} className="p-2 text-left">{x}</th>)}</tr></thead><tbody>{data.supplyLedger.length===0?<tr><td colSpan={6} className="p-6 text-center text-xs text-slate-400">공급 기록이 없습니다.</td></tr>:data.supplyLedger.slice(0,30).map((x)=><tr key={x.id} className="border-t"><td className="p-2 text-xs">{fmtDt(x.supplied_at)}</td><td className="p-2 font-bold">{x.classification}</td><td className="p-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${x.billable?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-500"}`}>{x.billable?"과금":"제외"}</span></td><td className="p-2 font-mono text-xs">{x.lead_id||"-"}</td><td className="p-2 text-xs">{Number(x.unit_price_snapshot||0).toLocaleString("ko-KR")}원</td><td className="p-2 text-xs text-slate-500">{x.origin}</td></tr>)}</tbody></table></div>
    </section>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-center gap-2 font-black"><AlertTriangle size={17} />Sheet 연동 오류</div><p className="mt-1 text-xs text-slate-500">로펌ID/Source/Secret/Spreadsheet/Form 불일치 등 최근 오류입니다.</p><div className="mt-3 space-y-2">{data.ingestErrors.length === 0 ? <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-400">최근 오류 없음</div> : data.ingestErrors.slice(0, 12).map((x) => <div key={x.id} className="rounded-lg border border-red-100 bg-red-50/40 p-3"><div className="text-xs font-bold text-red-700">{x.reason}</div><div className="mt-1 text-[11px] text-slate-500">{fmtDt(x.created_at)} · {x.source_key || "source 미확인"} · 행 {x.row_number || "-"}</div></div>)}</div></section>
      <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-center gap-2 font-black"><Megaphone size={17} />Meta 전송 로그</div><p className="mt-1 text-xs text-slate-500">최근 전송 성공/실패 기록입니다.</p><div className="mt-3 space-y-2">{data.metaLogs.length === 0 ? <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-400">전송 기록 없음</div> : data.metaLogs.slice(0, 12).map((x) => <div key={x.id} className="rounded-lg border p-3"><div className="flex justify-between gap-2"><b className="text-xs">{x.event_name}</b><span className={`text-[11px] font-bold ${x.status === "success" ? "text-emerald-700" : x.status === "failed" ? "text-red-600" : "text-amber-600"}`}>{x.status}</span></div><div className="mt-1 text-[11px] text-slate-500">{fmtDt(x.requested_at)} · Lead {x.lead_id || "-"}</div>{x.error_message && <div className="mt-1 line-clamp-2 text-[11px] text-red-600">{x.error_message}</div>}</div>)}</div></section>
    </div>
  </div>;
}

export default function FirmSettingsPage() {
  return <Suspense fallback={<div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">로펌 설정을 불러오는 중...</div>}><FirmSettingsContent /></Suspense>;
}
