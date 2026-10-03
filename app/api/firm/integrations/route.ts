import { NextRequest, NextResponse } from "next/server";
import {
  encryptIntegrationSecret,
  makeIntegrationSecret,
  makeSourceKey,
  hashSecret,
  platformError,
  requirePlatformUser,
  writePlatformAudit,
} from "@/lib/platform/server";

async function resolveFirmId(request: NextRequest, profile: any, body?: any) {
  if (profile.platform_role === "super_admin") {
    const value = body?.lawFirmId || request.nextUrl.searchParams.get("lawFirmId");
    if (!value) throw new Error("로펌을 선택해주세요.");
    return String(value);
  }
  if (!profile.law_firm_id) throw new Error("NO_FIRM");
  return String(profile.law_firm_id);
}

async function assertFirm(admin: any, lawFirmId: string) {
  const { data, error } = await admin.from("law_firms").select("id,firm_code,name,status,duplicate_window_days,billing_type,lead_unit_price").eq("id", lawFirmId).maybeSingle();
  if (error || !data) throw new Error("로펌 정보를 찾지 못했습니다.");
  return data;
}

async function assertOwned(admin: any, table: string, id: string | null | undefined, lawFirmId: string, label: string) {
  if (!id) return null;
  const { data, error } = await admin.from(table).select("id,law_firm_id").eq("id", id).maybeSingle();
  if (error || !data || data.law_firm_id !== lawFirmId) throw new Error(`${label}이(가) 현재 로펌 소속이 아닙니다.`);
  return data;
}

export async function GET(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin", "firm_admin"]);
    const lawFirmId = await resolveFirmId(request, profile);
    const [firmRes, meta, sheets, sources, logs, ingestErrors, rules, queue, supplyLedger] = await Promise.all([
      admin.from("law_firms").select("id,firm_code,name,status,duplicate_window_days,billing_type,lead_unit_price").eq("id", lawFirmId).single(),
      admin.from("firm_meta_accounts").select("id,name,business_id,ad_account_id,page_id,dataset_id,test_event_code,active,created_at,updated_at,access_token_ciphertext,last_success_at,last_error_at,last_error_message").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("firm_sheet_integrations").select("id,name,spreadsheet_id,sheet_name,active,last_received_at,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("ad_sources").select("id,name,source_key,meta_form_id,campaign_id,adset_id,ad_id,active,sheet_integration_id,meta_account_id,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("meta_event_logs").select("id,lead_id,event_name,status,response_code,error_message,requested_at,responded_at,meta_account_id,ad_source_id,event_id").eq("law_firm_id", lawFirmId).order("requested_at", { ascending: false }).limit(50),
      admin.from("integration_ingest_errors").select("id,source_key,sheet_id,sheet_name,form_id,external_key,row_number,reason,created_at").eq("law_firm_id", lawFirmId).order("created_at", { ascending: false }).limit(50),
      admin.from("firm_meta_event_rules").select("id,trigger_type,trigger_value,event_name,enabled,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at"),
      admin.from("meta_event_queue").select("id,lead_id,event_name,event_id,status,attempts,next_attempt_at,last_error,created_at,updated_at").eq("law_firm_id", lawFirmId).order("created_at", { ascending: false }).limit(50),
      admin.from("lead_supply_ledger").select("id,external_key,lead_id,classification,billable,billing_type,unit_price_snapshot,ad_source_id,meta_account_id,origin,supplied_at").eq("law_firm_id", lawFirmId).order("supplied_at", { ascending: false }).limit(100),
    ]);
    if (firmRes.error) throw firmRes.error;
    for (const response of [meta, sheets, sources, logs, ingestErrors, rules, queue, supplyLedger]) if (response.error) throw response.error;
    const metaAccounts = (meta.data ?? []).map((row: any) => {
      const { access_token_ciphertext, ...safe } = row;
      return { ...safe, hasAccessToken: Boolean(access_token_ciphertext) };
    });
    return NextResponse.json({
      viewerRole: profile.platform_role,
      firm: firmRes.data,
      metaAccounts,
      sheets: sheets.data ?? [],
      sources: sources.data ?? [],
      metaLogs: logs.data ?? [],
      ingestErrors: ingestErrors.data ?? [],
      metaRules: rules.data ?? [],
      metaQueue: queue.data ?? [],
      supplyLedger: supplyLedger.data ?? [],
    });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    const body = await request.json();
    const lawFirmId = await resolveFirmId(request, profile, body);
    await assertFirm(admin, lawFirmId);
    const action = String(body.action || "");

    if (action === "create_meta_account") {
      const name = String(body.name || "").trim();
      if (!name) throw new Error("광고계정 구분명을 입력해주세요.");
      const token = String(body.accessToken || "").trim();
      const { data, error } = await admin.from("firm_meta_accounts").insert({
        law_firm_id: lawFirmId,
        name,
        business_id: String(body.businessId || "").trim() || null,
        ad_account_id: String(body.adAccountId || "").trim() || null,
        page_id: String(body.pageId || "").trim() || null,
        dataset_id: String(body.datasetId || "").trim() || null,
        test_event_code: String(body.testEventCode || "").trim() || null,
        access_token_ciphertext: token ? encryptIntegrationSecret(token) : null,
        active: true,
      }).select("id,name,business_id,ad_account_id,page_id,dataset_id,test_event_code,active").single();
      if (error) throw error;
      await writePlatformAudit(admin, request, profile, { lawFirmId, action: "integration.meta.create", targetType: "firm_meta_account", targetId: data.id, detail: { name: data.name, adAccountId: data.ad_account_id, datasetId: data.dataset_id, hasAccessToken: Boolean(token) } });
      return NextResponse.json({ ok: true, metaAccount: { ...data, hasAccessToken: Boolean(token) } });
    }

    if (action === "create_sheet") {
      const name = String(body.name || "").trim();
      const spreadsheetId = String(body.spreadsheetId || "").trim();
      if (!name) throw new Error("시트 연동명을 입력해주세요.");
      if (!spreadsheetId) throw new Error("Spreadsheet ID를 입력해주세요. 신규 로펌 연동은 ID 검증을 필수로 사용합니다.");
      const secret = makeIntegrationSecret();
      const { data, error } = await admin.from("firm_sheet_integrations").insert({
        law_firm_id: lawFirmId,
        name,
        spreadsheet_id: spreadsheetId,
        sheet_name: String(body.sheetName || "Raw2").trim() || "Raw2",
        secret_hash: hashSecret(secret),
        active: true,
      }).select("id,name,spreadsheet_id,sheet_name,active").single();
      if (error) throw error;
      await writePlatformAudit(admin, request, profile, { lawFirmId, action: "integration.sheet.create", targetType: "firm_sheet_integration", targetId: data.id, detail: { name: data.name, spreadsheetId: data.spreadsheet_id, sheetName: data.sheet_name } });
      return NextResponse.json({ ok: true, sheet: data, ingestSecret: secret });
    }

    if (action === "create_source") {
      const name = String(body.name || "").trim();
      if (!name) throw new Error("광고소스명을 입력해주세요.");
      const sheetIntegrationId = body.sheetIntegrationId ? String(body.sheetIntegrationId) : null;
      const metaAccountId = body.metaAccountId ? String(body.metaAccountId) : null;
      if (!sheetIntegrationId) throw new Error("광고소스에는 Google Sheet 연동을 반드시 지정해주세요.");
      await assertOwned(admin, "firm_sheet_integrations", sheetIntegrationId, lawFirmId, "Google Sheet 연동");
      await assertOwned(admin, "firm_meta_accounts", metaAccountId, lawFirmId, "Meta 광고계정");
      const sourceKey = String(body.sourceKey || "").trim().toUpperCase() || makeSourceKey("LP");
      const { data, error } = await admin.from("ad_sources").insert({
        law_firm_id: lawFirmId,
        name,
        source_key: sourceKey,
        sheet_integration_id: sheetIntegrationId,
        meta_account_id: metaAccountId,
        meta_form_id: String(body.metaFormId || "").trim() || null,
        campaign_id: String(body.campaignId || "").trim() || null,
        adset_id: String(body.adsetId || "").trim() || null,
        ad_id: String(body.adId || "").trim() || null,
        active: true,
      }).select("*").single();
      if (error) throw error;
      await writePlatformAudit(admin, request, profile, { lawFirmId, action: "integration.source.create", targetType: "ad_source", targetId: data.id, detail: { name: data.name, sourceKey: data.source_key, metaFormId: data.meta_form_id, adId: data.ad_id } });
      return NextResponse.json({ ok: true, source: data });
    }

    if (action === "create_meta_rule") {
      const triggerType = body.triggerType === "status" ? "status" : "detail_stage";
      const triggerValue = String(body.triggerValue || "").trim();
      const eventName = String(body.eventName || "").trim();
      if (!triggerValue || !eventName) throw new Error("진행단계/상태 값과 Meta 이벤트명을 입력해주세요.");
      const { data, error } = await admin.from("firm_meta_event_rules").insert({
        law_firm_id: lawFirmId,
        trigger_type: triggerType,
        trigger_value: triggerValue,
        event_name: eventName,
        enabled: body.enabled === true,
      }).select("*").single();
      if (error) throw error;
      await writePlatformAudit(admin, request, profile, { lawFirmId, action: "integration.meta_rule.create", targetType: "meta_event_rule", targetId: data.id, detail: { triggerType, triggerValue, eventName, enabled: body.enabled === true } });
      return NextResponse.json({ ok: true, rule: data });
    }

    throw new Error("지원하지 않는 작업입니다.");
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    const body = await request.json();
    const lawFirmId = await resolveFirmId(request, profile, body);
    await assertFirm(admin, lawFirmId);
    const kind = String(body.kind || "");
    const id = String(body.id || "");

    if (kind === "firm") {
      const firmPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.duplicateWindowDays !== undefined) firmPatch.duplicate_window_days = Math.max(1, Math.min(3650, Number(body.duplicateWindowDays) || 30));
      if (body.leadUnitPrice !== undefined) firmPatch.lead_unit_price = Math.max(0, Math.trunc(Number(body.leadUnitPrice) || 0));
      if (["per_lead", "monthly", "manual"].includes(String(body.billingType || ""))) firmPatch.billing_type = String(body.billingType);
      const { error } = await admin.from("law_firms").update(firmPatch).eq("id", lawFirmId);
      if (error) throw error;
      await writePlatformAudit(admin, request, profile, { lawFirmId, action: "firm.settings.update", targetType: "law_firm", targetId: lawFirmId, detail: { firmPatch } });
      return NextResponse.json({ ok: true });
    }

    if (!id) throw new Error("대상 ID가 없습니다.");
    const table = kind === "meta" ? "firm_meta_accounts" : kind === "sheet" ? "firm_sheet_integrations" : kind === "source" ? "ad_sources" : kind === "rule" ? "firm_meta_event_rules" : "";
    if (!table) throw new Error("지원하지 않는 연동 유형입니다.");
    await assertOwned(admin, table, id, lawFirmId, "대상 설정");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.active === "boolean" && kind !== "rule") patch.active = body.active;
    if (typeof body.enabled === "boolean" && kind === "rule") patch.enabled = body.enabled;
    if (typeof body.name === "string" && body.name.trim() && kind !== "rule") patch.name = body.name.trim();
    if (kind === "meta") {
      if (typeof body.businessId === "string") patch.business_id = body.businessId.trim() || null;
      if (typeof body.adAccountId === "string") patch.ad_account_id = body.adAccountId.trim() || null;
      if (typeof body.pageId === "string") patch.page_id = body.pageId.trim() || null;
      if (typeof body.datasetId === "string") patch.dataset_id = body.datasetId.trim() || null;
      if (typeof body.testEventCode === "string") patch.test_event_code = body.testEventCode.trim() || null;
      if (typeof body.accessToken === "string" && body.accessToken.trim()) {
        patch.access_token_ciphertext = encryptIntegrationSecret(body.accessToken.trim());
      }
    }
    if (kind === "sheet") {
      if (typeof body.spreadsheetId === "string") {
        const spreadsheetId = body.spreadsheetId.trim();
        if (!spreadsheetId) throw new Error("Spreadsheet ID는 비워둘 수 없습니다.");
        patch.spreadsheet_id = spreadsheetId;
      }
      if (typeof body.sheetName === "string") patch.sheet_name = body.sheetName.trim() || "Raw2";
      if (body.rotateSecret === true) {
        const secret = makeIntegrationSecret();
        patch.secret_hash = hashSecret(secret);
        const { error } = await admin.from(table).update(patch).eq("id", id).eq("law_firm_id", lawFirmId);
        if (error) throw error;
        await writePlatformAudit(admin, request, profile, { lawFirmId, action: "integration.sheet.secret.rotate", targetType: "firm_sheet_integration", targetId: id });
        return NextResponse.json({ ok: true, ingestSecret: secret });
      }
    }
    if (kind === "source") {
      if (body.sheetIntegrationId !== undefined) {
        if (!body.sheetIntegrationId) throw new Error("Google Sheet 연동은 필수입니다.");
        await assertOwned(admin, "firm_sheet_integrations", String(body.sheetIntegrationId), lawFirmId, "Google Sheet 연동");
        patch.sheet_integration_id = String(body.sheetIntegrationId);
      }
      if (body.metaAccountId !== undefined) {
        await assertOwned(admin, "firm_meta_accounts", body.metaAccountId ? String(body.metaAccountId) : null, lawFirmId, "Meta 광고계정");
        patch.meta_account_id = body.metaAccountId ? String(body.metaAccountId) : null;
      }
      if (typeof body.metaFormId === "string") patch.meta_form_id = body.metaFormId.trim() || null;
    }
    if (kind === "rule") {
      if (body.triggerType === "status" || body.triggerType === "detail_stage") patch.trigger_type = body.triggerType;
      if (typeof body.triggerValue === "string" && body.triggerValue.trim()) patch.trigger_value = body.triggerValue.trim();
      if (typeof body.eventName === "string" && body.eventName.trim()) patch.event_name = body.eventName.trim();
    }
    const { error } = await admin.from(table).update(patch).eq("id", id).eq("law_firm_id", lawFirmId);
    if (error) throw error;
    const auditPatch = { ...patch };
    if ("access_token_ciphertext" in auditPatch) auditPatch.access_token_ciphertext = "[encrypted token rotated]";
    if ("secret_hash" in auditPatch) auditPatch.secret_hash = "[secret rotated]";
    await writePlatformAudit(admin, request, profile, { lawFirmId, action: `integration.${kind}.update`, targetType: table, targetId: id, detail: { patch: auditPatch } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}
