import type { CaseRecord, Client, Installment, TenantStamped } from "./types";
import { kstPerformanceDate } from "./performance/firm";

export type AnalyticsLedgerMode = "monthly" | "cumulative";
export type AnalyticsLedgerWarningCode =
  | "duplicate-case" | "duplicate-client" | "duplicate-installment"
  | "unmatched-payment" | "ambiguous-payment" | "missing-client"
  | "invalid-contract-date" | "undated-payment" | "legacy-undated-payment"
  | "undated-sources-disagree" | "case-paid-summary-mismatch" | "excluded-contract-receipt" | "missing-actual-payment";

export interface AnalyticsLedgerWarning {
  code: AnalyticsLedgerWarningCode;
  caseId?: string;
  paymentId?: string;
  firmId?: string;
}

export interface AnalyticsLedgerInput {
  cases: readonly CaseRecord[];
  clients: readonly Client[];
  installments: readonly Installment[];
  /** Inclusive reporting period. The caller chooses the approved period. */
  periodStart: string;
  periodEnd: string;
  /** Inclusive cumulative cash cutoff, explicitly supplied by the caller. */
  cutoff: string;
  mode: AnalyticsLedgerMode;
  /** Optional additional scope restriction; existing store/RLS scope is unchanged. */
  firmId?: string;
}

export interface AnalyticsLedgerRow {
  key: string;
  case: CaseRecord;
  client?: Client;
  contractDate: string;
  periodPaid: number;
  cumulativePaid: number;
  periodUnknownActualCount: number;
  cumulativeUnknownActualCount: number;
  unknownActualCount: number;
  /** Current contract amount minus dated cash through cutoff; signed, not clamped. */
  balance: number;
  overpayment: number;
  /** Unknown dates prevent this balance from being a fully reconciled amount. */
  balanceKnown: boolean;
  /** Undated installment cash, or undated case-level cash when no completed rows exist. Never both. */
  unallocatedPaid: number;
  unallocatedPaidKnown: boolean;
  unallocatedSource: "installments" | "case" | "none";
  legacyPaidAmount: number;
  /** Case summary above all completed receipts: an unresolved discrepancy, NOT cash. */
  unreconciledPaid: number;
  periodPayments: Installment[];
  cumulativePayments: Installment[];
  undatedPayments: Installment[];
  /** Unknown actual amount, at/before cutoff or undated. Future-only unknowns are excluded. */
  missingActualPayments: Installment[];
  warnings: AnalyticsLedgerWarning[];
  status: string;
}

export interface AnalyticsLedgerResult {
  rows: AnalyticsLedgerRow[];
  /** Cannot be allocated to any reporting month; review separately from dated cash. */
  unallocatedCases: Array<{ caseId: string; firmId?: string; amount: number; amountKnown: boolean; source: "installments" | "case"; includedInRows: boolean }>;
  /** Scoped completed rows requiring actual-amount confirmation, including unmatched contracts. */
  incompletePayments: Installment[];
  totals: {
    caseCount: number;
    contractAmount: number;
    periodPaid: number;
    cumulativePaid: number;
    /** Scope-wide quality counts, including excluded/unmatched receipts. */
    periodUnknownActualCount: number;
    cumulativeUnknownActualCount: number;
    undatedUnknownActualCount: number;
    /** Sum of current fees less known dated cash, including uncertain rows; NOT a confirmed receivable total. */
    balance: number;
    overpayment: number;
    confirmedBalance: number;
    confirmedOverpayment: number;
    unallocatedPaid: number;
    uncertainBalanceCases: number;
    /** Dated receipts excluded from rows because their contract is future/undated/unmatched. */
    excludedPeriodPaid: number;
    excludedCumulativePaid: number;
    excludedUnallocatedPaid: number;
  };
  warnings: AnalyticsLedgerWarning[];
}

/** Existing reporting convention: valid calendar dates and timestamps in KST. */
export function analyticsLedgerDate(value?: string): string {
  return kstPerformanceDate(value) ?? "";
}

/** Scheduled amount is never evidence of cash. Explicit recorded zero is valid. */
export function recordedActualPayment(row: Pick<Installment, "actualPaidAmount">): number | undefined {
  const value = row.actualPaidAmount;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function scopedKey(row: TenantStamped & { id: string }, fallback?: string): string {
  return JSON.stringify([row._lawFirmId ?? fallback ?? "", row.id]);
}

/** A scoped store may have old unstamped rows. Explicitly different stamps never join. */
function sameTenant(left: TenantStamped, right: TenantStamped): boolean {
  return !left._lawFirmId || !right._lawFirmId || left._lawFirmId === right._lawFirmId;
}

/**
 * Read-only settlement detail, one row per contract (not per name or receipt).
 * It deliberately does not reconstruct historical contract fees/status, infer
 * refund amounts, add case.paidAmount to installments, or count scheduled rows.
 * Cancellation remains visible, and cash on a cancelled contract stays cash.
 */
export function buildAnalyticsLedger(input: AnalyticsLedgerInput): AnalyticsLedgerResult {
  const { periodStart, periodEnd, cutoff } = input;
  if ([periodStart, periodEnd, cutoff].some(value => analyticsLedgerDate(value) !== value)
    || periodStart > periodEnd || periodEnd > cutoff) {
    throw new Error("원장 조회기간과 누적 기준일을 확인해주세요.");
  }
  const warnings: AnalyticsLedgerWarning[] = [];
  const inScope = (row: TenantStamped) => !input.firmId || !row._lawFirmId || row._lawFirmId === input.firmId;
  const warning = (code: AnalyticsLedgerWarningCode, record?: CaseRecord, payment?: Installment): AnalyticsLedgerWarning => {
    const item = { code, ...(record ? { caseId: record.id } : {}), ...(payment ? { paymentId: payment.id } : {}),
      ...((record?._lawFirmId ?? payment?._lawFirmId ?? input.firmId) ? { firmId: record?._lawFirmId ?? payment?._lawFirmId ?? input.firmId } : {}) };
    warnings.push(item);
    return item;
  };
  function unique<T extends TenantStamped & { id: string }>(rows: readonly T[], code: AnalyticsLedgerWarningCode): T[] {
    const result = new Map<string, T>();
    for (const row of rows) {
      if (!inScope(row)) continue;
      const key = scopedKey(row, input.firmId);
      if (result.has(key)) {
        warning(code, code === "duplicate-case" ? row as unknown as CaseRecord : undefined,
          code === "duplicate-installment" ? row as unknown as Installment : undefined);
      } else result.set(key, row); // Preserve established firstByKey behavior.
    }
    return [...result.values()];
  }
  const cases = unique(input.cases, "duplicate-case");
  const clients = unique(input.clients, "duplicate-client");
  const installments = unique(input.installments, "duplicate-installment");
  const incompletePayments = installments.filter(payment => {
    if (payment.status !== "완료" || recordedActualPayment(payment) !== undefined) return false;
    const date = analyticsLedgerDate(payment.paidDate);
    return !date || date <= cutoff;
  });
  const incompletePaymentSet = new Set(incompletePayments);
  const periodUnknownActualCount = incompletePayments.filter(payment => {
    const date = analyticsLedgerDate(payment.paidDate);
    return !!date && date >= periodStart && date <= periodEnd;
  }).length;
  const cumulativeUnknownActualCount = incompletePayments.filter(payment => !!analyticsLedgerDate(payment.paidDate)).length;
  const undatedUnknownActualCount = incompletePayments.length - cumulativeUnknownActualCount;
  const casesById = new Map<string, CaseRecord[]>();
  const clientsById = new Map<string, Client[]>();
  const paymentsByCase = new Map<CaseRecord, Installment[]>();
  for (const record of cases) {
    const group = casesById.get(record.id) ?? [];
    group.push(record); casesById.set(record.id, group);
  }
  for (const client of clients) {
    const group = clientsById.get(client.id) ?? [];
    group.push(client); clientsById.set(client.id, group);
  }
  let excludedPeriodPaid = 0, excludedCumulativePaid = 0;
  const includeExcluded = (payment: Installment) => {
    if (payment.status !== "완료") return;
    const date = analyticsLedgerDate(payment.paidDate);
    const amount = recordedActualPayment(payment);
    if (!date || amount === undefined) return;
    if (date >= periodStart && date <= periodEnd) excludedPeriodPaid += amount;
    if (date <= cutoff) excludedCumulativePaid += amount;
  };
  for (const payment of installments) {
    const possible = (casesById.get(payment.caseId) ?? []).filter(record => sameTenant(record, payment));
    if (possible.length !== 1) {
      warning(possible.length ? "ambiguous-payment" : "unmatched-payment", undefined, payment);
      if (incompletePaymentSet.has(payment)) warning("missing-actual-payment", undefined, payment);
      includeExcluded(payment);
      continue;
    }
    const record = possible[0];
    const group = paymentsByCase.get(record) ?? [];
    group.push(payment); paymentsByCase.set(record, group);
  }
  const rows: AnalyticsLedgerRow[] = [];
  const unallocatedCases: AnalyticsLedgerResult["unallocatedCases"] = [];
  let excludedUnallocatedPaid = 0;
  for (const record of cases) {
    const rowWarnings: AnalyticsLedgerWarning[] = [];
    const addWarning = (code: AnalyticsLedgerWarningCode, payment?: Installment) => rowWarnings.push(warning(code, record, payment));
    const contractDate = analyticsLedgerDate(record.contractDate);
    const payments = paymentsByCase.get(record) ?? [];
    const completed = payments.filter(payment => payment.status === "완료");
    const periodPayments: Installment[] = [], cumulativePayments: Installment[] = [], undatedPayments: Installment[] = [], missingActualPayments: Installment[] = [];
    for (const payment of completed) {
      const date = analyticsLedgerDate(payment.paidDate);
      if ((!date || date <= cutoff) && recordedActualPayment(payment) === undefined) {
        missingActualPayments.push(payment); addWarning("missing-actual-payment", payment);
      }
      if (!date) { undatedPayments.push(payment); addWarning("undated-payment", payment); continue; }
      if (date >= periodStart && date <= periodEnd) periodPayments.push(payment);
      if (date <= cutoff) cumulativePayments.push(payment);
    }
    if (!contractDate) addWarning("invalid-contract-date");
    const datedContractInScope = !!contractDate && contractDate <= cutoff;
    const selected = datedContractInScope && (input.mode === "cumulative"
      || contractDate >= periodStart && contractDate <= periodEnd || periodPayments.length > 0);
    const legacyPaidAmount = Math.max(0, Number(record.paidAmount) || 0);
    const undatedTotal = undatedPayments.reduce((sum, payment) => sum + (recordedActualPayment(payment) ?? 0), 0);
    // The stored case amount is a summary, not an additional cash receipt.
    // Keep the installment source when present; never sum these two sources.
    const unallocatedSource = undatedPayments.length ? "installments" : !completed.length && legacyPaidAmount > 0 ? "case" : "none";
    const unallocatedPaidKnown = unallocatedSource !== "case" && undatedPayments.every(payment => recordedActualPayment(payment) !== undefined);
    const unallocatedPaid = unallocatedSource === "installments" ? undatedTotal : unallocatedSource === "case" ? legacyPaidAmount : 0;
    // Compare against ALL completed receipts, including later ones. Comparing
    // only through cutoff would incorrectly flag ordinary future receipts.
    const allActualsKnown = completed.every(payment => recordedActualPayment(payment) !== undefined);
    const completedTotal = completed.reduce((sum, payment) => sum + (recordedActualPayment(payment) ?? 0), 0);
    const unreconciledPaid = completed.length && allActualsKnown ? Math.max(0, legacyPaidAmount - completedTotal) : 0;
    if (unallocatedSource === "case") addWarning("legacy-undated-payment");
    if (unreconciledPaid > 0) addWarning("case-paid-summary-mismatch");
    if (undatedPayments.length && allActualsKnown && !completed.some(payment => analyticsLedgerDate(payment.paidDate))
      && legacyPaidAmount > 0 && legacyPaidAmount !== undatedTotal) addWarning("undated-sources-disagree");
    if (unallocatedSource !== "none" && (!contractDate || contractDate <= cutoff)) {
      unallocatedCases.push({ caseId: record.id, firmId: record._lawFirmId ?? input.firmId,
        amount: unallocatedPaid, amountKnown: unallocatedPaidKnown, source: unallocatedSource, includedInRows: selected });
      if (!selected) excludedUnallocatedPaid += unallocatedPaid;
    }
    if (!selected) {
      // Future/undated contracts cannot be silently mixed into historical fees.
      for (const payment of datedContractInScope ? [] : completed) {
        const date = analyticsLedgerDate(payment.paidDate);
        if (date && date <= cutoff) { addWarning("excluded-contract-receipt", payment); includeExcluded(payment); }
      }
      continue;
    }
    const candidates = (clientsById.get(record.clientId) ?? []).filter(client => sameTenant(record, client));
    const client = candidates.length === 1 ? candidates[0] : undefined;
    if (!client) addWarning("missing-client");
    const periodPaid = periodPayments.reduce((sum, payment) => sum + (recordedActualPayment(payment) ?? 0), 0);
    const cumulativePaid = cumulativePayments.reduce((sum, payment) => sum + (recordedActualPayment(payment) ?? 0), 0);
    const periodUnknownActualCount = periodPayments.filter(payment => recordedActualPayment(payment) === undefined).length;
    const cumulativeUnknownActualCount = cumulativePayments.filter(payment => recordedActualPayment(payment) === undefined).length;
    const balance = record.contractAmount - cumulativePaid;
    const balanceKnown = undatedPayments.length === 0 && unallocatedSource !== "case" && unreconciledPaid === 0 && missingActualPayments.length === 0;
    const hasOverdue = payments.some(payment => (payment.status === "연체" || payment.status === "실패")
      && !!analyticsLedgerDate(payment.dueDate) && analyticsLedgerDate(payment.dueDate) <= cutoff);
    const status = record.status === "취하" ? "취하" : !balanceKnown ? "입금내역 확인 필요"
      : balance < 0 ? "초과입금" : balance === 0 && record.contractAmount > 0 ? "완납" : hasOverdue ? "연체" : "분납 중";
    rows.push({ key: scopedKey(record, input.firmId), case: record, client, contractDate, periodPaid, cumulativePaid,
      balance, overpayment: Math.max(0, -balance), balanceKnown, unallocatedPaid, unallocatedPaidKnown, unallocatedSource, legacyPaidAmount, unreconciledPaid,
      periodUnknownActualCount, cumulativeUnknownActualCount, unknownActualCount: missingActualPayments.length,
      periodPayments, cumulativePayments, undatedPayments, missingActualPayments, warnings: rowWarnings, status });
  }
  const totals = rows.reduce((total, row) => {
    total.caseCount++;
    total.contractAmount += row.case.contractAmount;
    total.periodPaid += row.periodPaid;
    total.cumulativePaid += row.cumulativePaid;
    total.balance += row.balance;
    total.overpayment += row.overpayment;
    if (row.balanceKnown) {
      total.confirmedBalance += row.balance;
      total.confirmedOverpayment += row.overpayment;
    }
    total.unallocatedPaid += row.unallocatedPaid;
    if (!row.balanceKnown) total.uncertainBalanceCases++;
    return total;
  }, { caseCount: 0, contractAmount: 0, periodPaid: 0, cumulativePaid: 0, balance: 0, overpayment: 0, confirmedBalance: 0, confirmedOverpayment: 0,
    unallocatedPaid: 0, uncertainBalanceCases: 0, excludedPeriodPaid, excludedCumulativePaid, excludedUnallocatedPaid,
    periodUnknownActualCount, cumulativeUnknownActualCount, undatedUnknownActualCount });
  return { rows, unallocatedCases, incompletePayments, totals, warnings };
}
