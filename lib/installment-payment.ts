import type { Installment, InstallmentStatus } from "./types";
import { calendarDateParts } from "./calendar-date";

type Payment = Pick<Installment, "status" | "amount" | "actualPaidAmount">;
type DatedPayment = Payment & Pick<Installment, "dueDate" | "paidDate">;

export function isReceiptStatus(status: InstallmentStatus): boolean {
  return status === "완료" || status === "선납부";
}

export function installmentPaidAmount(row: Payment): number {
  if (row.status === "선납부") {
    const amount = row.actualPaidAmount;
    // A scheduled amount never represents an actual advance receipt.
    return typeof amount === "number" && Number.isFinite(amount) ? Math.max(0, amount) : 0;
  }
  return row.status === "완료" ? Math.max(0, Number(row.actualPaidAmount ?? row.amount) || 0) : 0;
}

export function installmentRemainingAmount(row: Payment): number {
  if (row.status === "완료") return 0;
  return Math.max(0, (Number(row.amount) || 0) - installmentPaidAmount(row));
}

export function validatePrepaymentRows(rows: readonly DatedPayment[]): string | null {
  for (const row of rows) {
    if (row.status !== "선납부") continue;
    if (!calendarDateParts(row.dueDate)) return "선납부 회차의 상환 예정일을 입력해주세요.";
    if (installmentPaidAmount(row) <= 0) return "선납부 회차의 실납부금액을 입력해주세요.";
    if (!row.paidDate || !calendarDateParts(row.paidDate)) return "선납부 회차의 실제 입금일을 입력해주세요.";
  }
  return null;
}
