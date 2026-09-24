import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CONSULT_TIME_OPTIONS,
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
}

interface IncomingBody {
  sheetId?: unknown;
  sheetName?: unknown;
  rows?: unknown;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

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

  // Google Sheet의 한국식 표시값(2026. 9. 24. 오후 10:15 / 2026-09-24 22:15 등)을 최대한 보존합니다.
  const normalized = raw
    .replace(/\./g, "-")
    .replace(/\s+/g, " ")
    .replace(/-\s*/g, "-")
    .replace(/오전/g, "AM")
    .replace(/오후/g, "PM")
    .trim();
  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString();
}

function exactOption<T extends readonly string[]>(value: unknown, options: T): T[number] | undefined {
  const raw = text(value);
  return options.includes(raw as T[number]) ? (raw as T[number]) : undefined;
}

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim();
  if (!configuredSecret) return fail("GOOGLE_SHEETS_WEBHOOK_SECRET 환경변수가 설정되지 않았습니다.", 500);

  const suppliedSecret = request.headers.get("x-lawpower-webhook-secret")?.trim();
  if (!suppliedSecret || suppliedSecret !== configuredSecret) return fail("연동 인증키가 올바르지 않습니다.", 401);

  let body: IncomingBody;
  try {
    body = (await request.json()) as IncomingBody;
  } catch {
    return fail("JSON 요청 형식이 올바르지 않습니다.", 400);
  }

  const sheetName = text(body.sheetName);
  const allowedSheetName = (process.env.GOOGLE_SHEETS_SHEET_NAME || "DB가공").trim();
  if (sheetName !== allowedSheetName) return fail(`허용된 시트는 '${allowedSheetName}' 입니다.`, 400);

  if (!Array.isArray(body.rows)) return fail("rows 배열이 없습니다.", 400);
  if (body.rows.length === 0) return NextResponse.json({ ok: true, imported: 0, duplicates: 0, skipped: 0, results: [] });
  if (body.rows.length > 200) return fail("한 번에 최대 200행까지 전송할 수 있습니다.", 400);

  const admin = createAdminClient();
  const results: Array<Record<string, unknown>> = [];
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;

  // 순서를 보장하기 위해 시트 행번호 순서대로 한 건씩 처리합니다.
  // 실제 담당자 선택은 DB 함수에서 advisory lock을 잡고 처리하므로 동시 webhook에도 안전합니다.
  for (const rawRow of body.rows as IncomingSheetRow[]) {
    if (!rawRow || typeof rawRow !== "object") {
      skipped += 1;
      results.push({ rowNumber: null, ok: false, skipped: true, reason: "행 데이터 형식 오류" });
      continue;
    }
    const rowNumber = Number(rawRow.rowNumber);
    const externalKey = text(rawRow.externalKey);
    const name = text(rawRow.name);
    const phone = normalizePhone(rawRow.phone);

    if (!externalKey || !Number.isInteger(rowNumber) || rowNumber < 2 || !name || !phone) {
      skipped += 1;
      results.push({ rowNumber: Number.isFinite(rowNumber) ? rowNumber : null, ok: false, skipped: true, reason: "필수값(externalKey/행번호/성함/휴대폰) 누락" });
      continue;
    }

    const debtRaw = text(rawRow.debtRange);
    const incomeRaw = text(rawRow.income);
    const consultTimeRaw = text(rawRow.consultTime);
    const debtRange = exactOption(rawRow.debtRange, DEBT_RANGE_OPTIONS) as DebtRange | undefined;
    const incomeRange = exactOption(rawRow.income, INCOME_RANGE_OPTIONS) as IncomeRange | undefined;
    const consultTime = exactOption(rawRow.consultTime, CONSULT_TIME_OPTIONS) as ConsultTimeSlot | undefined;

    const leadId = `DB-GS-${crypto.randomUUID()}`;
    const lead: Omit<DbLead, "assignedStaff"> = {
      id: leadId,
      name,
      phone,
      receivedAt: parseReceivedAt(rawRow.intakeAt),
      status: "신규접수",
      detailStage: "신규디비",
      email: text(rawRow.email) || undefined,
      adName: text(rawRow.adName) || undefined,
      debtRange,
      incomeRange,
      consultTime,
      debtRaw: debtRange ? undefined : debtRaw || undefined,
      incomeRaw: incomeRange ? undefined : incomeRaw || undefined,
      consultTimeRaw: consultTime ? undefined : consultTimeRaw || undefined,
      sourceSheet: sheetName,
      sourceRow: rowNumber,
      sourceExternalKey: externalKey,
    };

    const { data, error } = await admin.rpc("import_google_sheet_lead", {
      p_external_key: externalKey,
      p_lead_id: leadId,
      p_lead_data: lead,
      p_sheet_name: sheetName,
      p_row_number: rowNumber,
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: `시트 ${rowNumber}행 처리 실패: ${error.message}`,
          imported,
          duplicates,
          skipped,
          results,
        },
        { status: 500 }
      );
    }

    const item = (data ?? {}) as { duplicate?: boolean; leadId?: string; assignedStaff?: string };
    if (item.duplicate) duplicates += 1;
    else imported += 1;
    results.push({ rowNumber, ok: true, duplicate: !!item.duplicate, leadId: item.leadId ?? leadId, assignedStaff: item.assignedStaff ?? null });
  }

  return NextResponse.json({ ok: true, imported, duplicates, skipped, results });
}
