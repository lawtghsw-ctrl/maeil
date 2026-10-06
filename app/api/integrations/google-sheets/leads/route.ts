import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeConsultTimeValue,
  DEBT_RANGE_OPTIONS,
  INCOME_RANGE_OPTIONS,
  type ConsultTimeSlot,
  type DbLead,
  type DebtRange,
  type IncomeRange,
} from "@/lib/types";

interface IncomingSheetRow {
  externalKey?: unknown;
  rowNumber?: unknown;
  intakeAt?: unknown;
  adName?: unknown;
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  debtRange?: unknown;
  income?: unknown;
  consultTime?: unknown;
  formId?: unknown;
  metaLeadId?: unknown;
  campaignId?: unknown;
  adsetId?: unknown;
  adId?: unknown;
}

interface IncomingBody {
  firmCode?: unknown;
  sourceKey?: unknown;
  sheetId?: unknown;
  sheetName?: unknown;
  formId?: unknown;
  rows?: unknown;
}

type AdminClient = ReturnType<typeof createAdminClient>;
type SourceRow = {
  id: string;
  law_firm_id: string;
  source_key: string;
  name: string;
  meta_form_id: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  meta_account_id: string | null;
  sheet_integration_id: string | null;
  active: boolean;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function normalizePhone(value: unknown) {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("010")) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("01")) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

function parseReceivedAt(value: unknown) {
  const raw = text(value);
  if (!raw) return new Date().toISOString();
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const normalized = raw.replace(/\./g, "-").replace(/\s+/g, " ").replace(/-\s*/g, "-").replace(/오전/g, "AM").replace(/오후/g, "PM").trim();
  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString();
}

function exactOption<T extends readonly string[]>(value: unknown, options: T): T[number] | undefined {
  const raw = text(value);
  return options.includes(raw as T[number]) ? raw as T[number] : undefined;
}

function fail(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

async function findFirmId(admin: AdminClient, firmCode: string) {
  if (!firmCode) return null;
  const { data } = await admin.from("law_firms").select("id").eq("firm_code", firmCode).maybeSingle();
  return data?.id ?? null;
}

async function logIngestError(admin: AdminClient, body: IncomingBody, reason: string, row?: IncomingSheetRow, sourceKey?: string | null) {
  try {
    const firmCode = text(body.firmCode);
    const lawFirmId = await findFirmId(admin, firmCode);
    await admin.from("integration_ingest_errors").insert({
      law_firm_id: lawFirmId,
      source_key: (sourceKey || text(body.sourceKey).toUpperCase()) || null,
      sheet_id: text(body.sheetId) || null,
      sheet_name: text(body.sheetName) || null,
      form_id: text(row?.formId || body.formId) || null,
      external_key: text(row?.externalKey) || null,
      row_number: Number.isInteger(Number(row?.rowNumber)) ? Number(row?.rowNumber) : null,
      reason: reason.slice(0, 1000),
    });
  } catch (error) {
    console.error("LawPower ingest error log failed", error);
  }
}

async function resolveTenant(admin: AdminClient, request: NextRequest, body: IncomingBody) {
  const firmCode = text(request.headers.get("x-lawpower-firm-code") || body.firmCode);
  const sourceKey = text(request.headers.get("x-lawpower-source-key") || body.sourceKey).toUpperCase();
  const suppliedSecret = text(request.headers.get("x-lawpower-ingest-secret") || request.headers.get("x-lawpower-webhook-secret"));

  // v28.2 multi-tenant mode. One Sheet can contain multiple Instant Forms.
  // A fixed Source Key is optional; without it, each row is matched to ad_sources by Ad ID / Form ID.
  if (firmCode || sourceKey || request.headers.get("x-lawpower-ingest-secret")) {
    if (!firmCode || !/^\d{10}$/.test(firmCode)) throw new Error("10자리 로펌 ID가 필요합니다.");
    if (!suppliedSecret) throw new Error("Google Sheet 연동 인증키가 필요합니다.");
    const requestedSheetId = text(body.sheetId);
    const requestedName = text(body.sheetName);
    if (!requestedSheetId) throw new Error("Spreadsheet ID가 없습니다.");
    if (!requestedName) throw new Error("Sheet 이름이 없습니다.");

    const { data: firm, error: firmError } = await admin.from("law_firms")
      .select("id,firm_code,name,status")
      .eq("firm_code", firmCode)
      .maybeSingle();
    if (firmError || !firm || firm.status !== "active") throw new Error("활성 로펌 정보를 찾지 못했습니다.");

    const { data: sheet, error: sheetError } = await admin.from("firm_sheet_integrations")
      .select("id,law_firm_id,spreadsheet_id,sheet_name,secret_hash,active")
      .eq("law_firm_id", firm.id)
      .eq("spreadsheet_id", requestedSheetId)
      .eq("sheet_name", requestedName)
      .maybeSingle();
    if (sheetError || !sheet || !sheet.active) throw new Error("등록된 활성 Google Sheet 연동을 찾지 못했습니다.");
    if (sha256(suppliedSecret) !== sheet.secret_hash) throw new Error("연동 인증키가 올바르지 않습니다.");

    const { data: sources, error: sourceListError } = await admin.from("ad_sources")
      .select("id,law_firm_id,source_key,name,meta_form_id,campaign_id,adset_id,ad_id,meta_account_id,sheet_integration_id,active")
      .eq("law_firm_id", firm.id)
      .eq("sheet_integration_id", sheet.id)
      .eq("active", true);
    if (sourceListError) throw sourceListError;

    let fixedSource: SourceRow | null = null;
    if (sourceKey) {
      fixedSource = ((sources ?? []) as SourceRow[]).find((item) => item.source_key === sourceKey) ?? null;
      if (!fixedSource) throw new Error("이 Google Sheet에 연결된 활성 광고소스키를 찾지 못했습니다.");
    }

    return { firm, sheet, sources: (sources ?? []) as SourceRow[], fixedSource, legacy: false };
  }

  // Existing Maeil Raw2 compatibility. This keeps the current production sheet running until it is migrated.
  const configuredSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim();
  if (!configuredSecret || suppliedSecret !== configuredSecret) throw new Error("기존 연동 인증키가 올바르지 않습니다.");
  const { data: firm, error } = await admin.from("law_firms").select("id,firm_code,name,status").eq("is_legacy_default", true).maybeSingle();
  if (error || !firm || firm.status !== "active") throw new Error("매일법률사무소 기본 로펌이 활성 상태가 아닙니다.");
  const requestedName = text(body.sheetName);
  const configuredSheetName = process.env.GOOGLE_SHEETS_SHEET_NAME?.trim();
  const allowed = new Set(["Raw2", ...(configuredSheetName ? [configuredSheetName] : [])]);
  if (!allowed.has(requestedName)) throw new Error(`허용된 시트는 Raw2 입니다. 현재: ${requestedName || "(없음)"}`);
  return { firm, sheet: null as any, sources: [] as SourceRow[], fixedSource: null as SourceRow | null, legacy: true };
}

function validateSourceLineage(source: SourceRow, row: IncomingSheetRow, body: IncomingBody) {
  const formId = text(row.formId || body.formId);
  const campaignId = text(row.campaignId);
  const adsetId = text(row.adsetId);
  const adId = text(row.adId);
  const checks: Array<[string, string | null, string]> = [
    ["Form ID", source.meta_form_id, formId],
    ["Campaign ID", source.campaign_id, campaignId],
    ["Adset ID", source.adset_id, adsetId],
    ["Ad ID", source.ad_id, adId],
  ];
  for (const [label, configured, incoming] of checks) {
    if (!configured) continue;
    if (!incoming) throw new Error(`${source.name}: ${label} 검증값이 요청에 없습니다.`);
    if (configured !== incoming) throw new Error(`${source.name}: ${label}가 등록값과 다릅니다.`);
  }
}

function resolveSourceForRow(tenant: Awaited<ReturnType<typeof resolveTenant>>, row: IncomingSheetRow, body: IncomingBody): SourceRow | null {
  if (tenant.legacy) return null;
  if (tenant.fixedSource) {
    validateSourceLineage(tenant.fixedSource, row, body);
    return tenant.fixedSource;
  }

  const formId = text(row.formId || body.formId);
  const campaignId = text(row.campaignId);
  const adsetId = text(row.adsetId);
  const adId = text(row.adId);
  const all = tenant.sources;
  if (all.length === 0) throw new Error("이 Google Sheet에 활성 광고소스가 등록되어 있지 않습니다.");

  let candidates: SourceRow[] = [];
  if (adId) candidates = all.filter((item) => item.ad_id === adId);
  if (candidates.length === 0 && formId) candidates = all.filter((item) => item.meta_form_id === formId);
  if (candidates.length === 0 && campaignId) candidates = all.filter((item) => item.campaign_id === campaignId);
  if (candidates.length > 1 && adsetId) candidates = candidates.filter((item) => !item.adset_id || item.adset_id === adsetId);
  if (candidates.length > 1 && campaignId) candidates = candidates.filter((item) => !item.campaign_id || item.campaign_id === campaignId);
  if (candidates.length === 0 && all.length === 1 && !formId && !adId && !campaignId) candidates = [all[0]];

  if (candidates.length === 0) {
    throw new Error("이 행과 일치하는 광고소스를 찾지 못했습니다. Source Key 또는 Form ID/Ad ID 매핑을 확인해주세요.");
  }
  if (candidates.length > 1) {
    throw new Error("광고소스가 2개 이상 일치합니다. Ad ID를 등록하거나 Sheet에 고정 Source Key를 설정해주세요.");
  }
  validateSourceLineage(candidates[0], row, body);
  return candidates[0];
}

export async function POST(request: NextRequest) {
  let body: IncomingBody;
  try {
    body = await request.json() as IncomingBody;
  } catch {
    return fail("JSON 요청 형식이 올바르지 않습니다.", 400);
  }
  if (!Array.isArray(body.rows)) return fail("rows 배열이 없습니다.", 400);
  if (body.rows.length > 200) return fail("한 번에 최대 200행까지 전송할 수 있습니다.", 400);

  const admin = createAdminClient();
  let tenant: Awaited<ReturnType<typeof resolveTenant>>;
  try {
    tenant = await resolveTenant(admin, request, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "연동 인증에 실패했습니다.";
    await logIngestError(admin, body, message);
    return fail(message, 401);
  }
  if (body.rows.length === 0) return NextResponse.json({ ok: true, imported: 0, duplicates: 0, reentries: 0, skipped: 0, results: [] });

  const results: Array<Record<string, unknown>> = [];
  let imported = 0;
  let duplicates = 0;
  let reentries = 0;
  let skipped = 0;
  let retryableConfigurationErrors = 0;

  for (const rawRow of body.rows as IncomingSheetRow[]) {
    const rowNumber = Number(rawRow?.rowNumber);
    const externalKey = text(rawRow?.externalKey);
    const name = text(rawRow?.name);
    const phone = normalizePhone(rawRow?.phone);
    if (!externalKey || !Number.isInteger(rowNumber) || rowNumber < 2 || !name || !phone) {
      const reason = "필수값(externalKey/행번호/성함/휴대폰) 누락";
      skipped += 1;
      await logIngestError(admin, body, reason, rawRow);
      results.push({ rowNumber: Number.isFinite(rowNumber) ? rowNumber : null, ok: false, skipped: true, reason });
      continue;
    }

    let source: SourceRow | null = null;
    try {
      source = resolveSourceForRow(tenant, rawRow, body);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "광고소스 판별 실패";
      skipped += 1;
      retryableConfigurationErrors += 1;
      await logIngestError(admin, body, reason, rawRow);
      results.push({ rowNumber, ok: false, skipped: true, retryable: true, reason });
      continue;
    }

    const formId = text(rawRow.formId || body.formId);
    const metaLeadId = text(rawRow.metaLeadId);
    const campaignId = text(rawRow.campaignId);
    const adsetId = text(rawRow.adsetId);
    const adId = text(rawRow.adId);
    const debtRaw = text(rawRow.debtRange);
    const incomeRaw = text(rawRow.income);
    const consultTimeRaw = text(rawRow.consultTime);
    const debtRange = exactOption(rawRow.debtRange, DEBT_RANGE_OPTIONS) as DebtRange | undefined;
    const incomeRange = exactOption(rawRow.income, INCOME_RANGE_OPTIONS) as IncomeRange | undefined;
    const consultTime = normalizeConsultTimeValue(rawRow.consultTime) as ConsultTimeSlot | undefined;
    const leadId = `DB-GS-${crypto.randomUUID()}`;

    const lead: Omit<DbLead, "assignedStaff"> & { _platform?: Record<string, unknown> } = {
      id: leadId,
      name,
      phone,
      receivedAt: parseReceivedAt(rawRow.intakeAt),
      status: "신규접수",
      detailStage: "신규디비",
      source: "메타",
      email: text(rawRow.email) || undefined,
      adName: text(rawRow.adName) || undefined,
      debtRange,
      incomeRange,
      consultTime,
      debtRaw: debtRange ? undefined : debtRaw || undefined,
      incomeRaw: incomeRange ? undefined : incomeRaw || undefined,
      // 원본 인스턴트 양식 응답은 항상 보존합니다. 피벗용 consultTime은 별도로 정규화합니다.
      consultTimeRaw: consultTimeRaw || undefined,
      _platform: {
        firmCode: tenant.firm.firm_code,
        adSourceId: source?.id ?? null,
        sourceKey: source?.source_key ?? "LEGACY-MAEIL",
        metaAccountId: source?.meta_account_id ?? null,
        formId: formId || null,
        metaLeadId: metaLeadId || null,
        campaignId: campaignId || null,
        adsetId: adsetId || null,
        adId: adId || null,
        sheetId: text(body.sheetId) || null,
      },
    };

    const { data, error } = await admin.rpc("import_tenant_google_sheet_lead", {
      p_law_firm_id: tenant.firm.id,
      p_external_key: externalKey,
      p_lead_id: leadId,
      p_lead_data: lead,
      p_sheet_name: text(body.sheetName) || tenant.sheet?.sheet_name || "Raw2",
      p_row_number: rowNumber,
      p_ad_source_id: source?.id ?? null,
      p_meta_account_id: source?.meta_account_id ?? null,
      p_meta_lead_id: metaLeadId || null,
    });

    if (error) {
      const reason = `시트 ${rowNumber}행 처리 실패: ${error.message}`;
      await logIngestError(admin, body, reason, rawRow, source?.source_key);
      return NextResponse.json({ ok: false, error: reason, imported, duplicates, reentries, skipped, results }, { status: 500 });
    }

    const item = (data ?? {}) as { duplicate?: boolean; classification?: string; duplicateReason?: string; leadId?: string; assignedStaff?: string };
    if (item.duplicate) duplicates += 1;
    else {
      imported += 1;
      if (item.classification === "reentry") reentries += 1;
    }
    results.push({
      rowNumber,
      ok: true,
      duplicate: !!item.duplicate,
      classification: item.classification ?? "new",
      duplicateReason: item.duplicateReason ?? null,
      leadId: item.leadId ?? leadId,
      assignedStaff: item.assignedStaff ?? null,
      sourceKey: source?.source_key ?? "LEGACY-MAEIL",
    });
  }

  if (!tenant.legacy && tenant.sheet?.id) {
    await admin.from("firm_sheet_integrations").update({ last_received_at: new Date().toISOString() }).eq("id", tenant.sheet.id);
  }

  // Mapping/configuration errors must not advance the Apps Script cursor.
  // Already-imported rows are idempotent by firm + externalKey, so the whole batch can be retried safely after fixing the mapping.
  if (retryableConfigurationErrors > 0) {
    return NextResponse.json({
      ok: false,
      retryable: true,
      error: `광고소스 매핑 오류 ${retryableConfigurationErrors}건이 있어 Sheet 커서를 진행하지 않습니다. 로파워 연동설정을 수정한 뒤 자동 재시도됩니다.`,
      firmCode: tenant.firm.firm_code, imported, duplicates, reentries, skipped, results,
    }, { status: 409 });
  }

  return NextResponse.json({ ok: true, firmCode: tenant.firm.firm_code, imported, duplicates, reentries, skipped, results });
}
