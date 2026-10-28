import type { CaseRecord, Client, Installment, TenantStamped } from "./types";
import type { AnalyticsCell, AnalyticsSection } from "./analytics-excel";
import { analyticsLedgerDate, recordedActualPayment, type AnalyticsLedgerMode } from "./analytics-ledger";

export const RECEIPT_HEADERS = ["입금일", "담당", "의뢰인", "회차", "납부방식", "실입금액"];

export interface AnalyticsReceipt {
  /** Internal identity only; never exported to a cell. */
  key: string;
  date: string;
  assignedStaff: string;
  clientName: string;
  sequence: number | string;
  paymentMethod: string;
  amount: number;
}

/** Actual payment grain, independent of contract date/status or historical fees. */
export function buildAnalyticsReceipts(input: {
  cases: readonly CaseRecord[];
  clients: readonly Client[];
  installments: readonly Installment[];
  periodStart: string;
  cutoff: string;
  mode: AnalyticsLedgerMode;
  firmId?: string;
}) {
  if (analyticsLedgerDate(input.periodStart) !== input.periodStart || analyticsLedgerDate(input.cutoff) !== input.cutoff || input.periodStart > input.cutoff) {
    throw new Error("입금내역 조회기간을 확인해주세요.");
  }
  const scope = (row: TenantStamped) => row._lawFirmId ?? input.firmId ?? "";
  const key = (row: TenantStamped, id: string) => JSON.stringify([scope(row), id]);
  const inScope = (row: TenantStamped) => !input.firmId || !row._lawFirmId || row._lawFirmId === input.firmId;
  const cases = new Map<string, CaseRecord>(), clients = new Map<string, Client>();
  for (const row of input.cases) if (inScope(row) && !cases.has(key(row,row.id))) cases.set(key(row,row.id),row);
  for (const row of input.clients) if (inScope(row) && !clients.has(key(row,row.id))) clients.set(key(row,row.id),row);
  const seen = new Set<string>(), rows: AnalyticsReceipt[] = [];
  let undatedCount = 0, unknownAmountCount = 0, missingIdentityCount = 0, duplicateCount = 0;
  for (const payment of input.installments) {
    if (!inScope(payment)) continue;
    const paymentKey = key(payment,payment.id);
    if (seen.has(paymentKey)) { duplicateCount++; continue; }
    seen.add(paymentKey);
    if (payment.status !== "완료") continue;
    const date = analyticsLedgerDate(payment.paidDate);
    if (!date) { undatedCount++; continue; }
    if (date > input.cutoff || (input.mode === "monthly" && date < input.periodStart)) continue;
    const amount = recordedActualPayment(payment);
    if (amount === undefined) { unknownAmountCount++; continue; }
    const record = cases.get(key(payment,payment.caseId));
    const client = record ? clients.get(key(record,record.clientId)) : undefined;
    if (!record || !client) missingIdentityCount++;
    rows.push({
      key: paymentKey, date, amount,
      assignedStaff: record?.assignedStaff || "-",
      clientName: client?.name || "-",
      sequence: Number.isInteger(payment.seq) && payment.seq > 0 ? payment.seq : "-",
      paymentMethod: record?.paymentMethod || "-",
    });
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
  return { rows, total: rows.reduce((sum,row)=>sum+row.amount,0), undatedCount, unknownAmountCount, missingIdentityCount, duplicateCount };
}

export function receiptValues(row: AnalyticsReceipt): AnalyticsCell[] {
  return [row.date,row.assignedStaff,row.clientName,row.sequence,row.paymentMethod,row.amount];
}

export function createReceiptOnlySection(rows: readonly AnalyticsReceipt[]): AnalyticsSection {
  return {
    title: "입금내역", headers: RECEIPT_HEADERS, rows: rows.map(receiptValues),
    formats: ["date","text","text","integer","text","won"], widths: [16,18,20,12,18,22],
    totalRow: ["입금 합계","","","","",rows.reduce((sum,row)=>sum+row.amount,0)],
  };
}
