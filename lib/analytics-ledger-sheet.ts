import type { AnalyticsSection, AnalyticsCell } from "./analytics-excel";
import { analyticsLedgerDate, recordedActualPayment, type AnalyticsLedgerRow } from "./analytics-ledger";

export interface AnalyticsLedgerViewRow extends AnalyticsLedgerRow {
  standard: number;
  standardKnown: boolean;
  discount: number;
  fee: number;
  net: number;
}

export const LEDGER_HEADERS = ["사건유형", "수임일", "최근 입금일", "담당", "의뢰인", "사건번호", "납부방식", "총 수임료", "해당 월 실입금", "누적 실입금", "미수 잔금", "초과입금", "미확인 입금 기록액", "기준 수임료", "할인액", "누적 수수료", "누적 실수령", "상태", "확인사항"];

export function ledgerValues(row: AnalyticsLedgerViewRow): AnalyticsCell[] {
  const recent = row.cumulativePayments.map(payment=>analyticsLedgerDate(payment.paidDate)).sort().at(-1) ?? "";
  return [row.case.caseType,row.contractDate,recent,row.case.assignedStaff,row.client?.name??"-",row.case.caseNumber,row.case.paymentMethod,row.case.contractAmount,row.periodPaid,row.cumulativePaid,
    row.balanceKnown?Math.max(0,row.balance):"확인 필요",row.balanceKnown?row.overpayment:"확인 필요",row.unallocatedPaid,row.standardKnown?row.standard:"확인 불가",row.standardKnown?row.discount:"확인 불가",row.fee,row.net,row.status,
    row.balanceKnown?row.warnings.length?"연결·원본 확인":"":`입금일·실납부액 확인 필요${row.unknownActualCount?` · 금액 미확인 ${row.unknownActualCount}회차`:""}${row.unreconciledPaid>0?" · 원본 합계 불일치":""}`];
}

export function ledgerTotals(rows: AnalyticsLedgerViewRow[]) {
  return rows.reduce((total,row)=>({
    contract:total.contract+row.case.contractAmount,month:total.month+row.periodPaid,cumulative:total.cumulative+row.cumulativePaid,
    balance:total.balance+(row.balanceKnown?Math.max(0,row.balance):0),overpayment:total.overpayment+(row.balanceKnown?row.overpayment:0),
    unallocated:total.unallocated+row.unallocatedPaid,fee:total.fee+row.fee,net:total.net+row.net,uncertain:total.uncertain+Number(!row.balanceKnown),
  }),{contract:0,month:0,cumulative:0,balance:0,overpayment:0,unallocated:0,fee:0,net:0,uncertain:0});
}

export function createLedgerSection(rows: AnalyticsLedgerViewRow[]): AnalyticsSection {
  const total=ledgerTotals(rows);
  return {
    title:"계약별 수임 · 입금 원장",
    headers:LEDGER_HEADERS,
    rows:rows.map(ledgerValues),
    formats:["text","date","date","text","text","text","text","won","won","won","won","won","won","won","won","won","won","text","text"],
    widths:[15,14,14,15,16,22,16,18,19,19,19,18,21,18,18,18,19,18,42],
    totalRow:[`합계 · ${rows.length}계약`,"","","","","","",total.contract,total.month,total.cumulative,total.uncertain?`확인 필요 ${total.uncertain}건`:total.balance,total.uncertain?`확인 필요 ${total.uncertain}건`:total.overpayment,total.unallocated,"","",total.fee,total.net,"",total.uncertain?`확인된 계약 잔금 합계 ${total.balance.toLocaleString("ko-KR")}원`:""],
    note:"한 행은 한 계약입니다. 실입금 열은 실제 금액과 일자가 기록된 확인분만 합계하며, 확인 필요 회차가 있으면 전체 입금 합계는 미확정입니다. 해당 월 실입금은 누적 실입금에 포함되므로 두 금액을 더하지 않습니다. 잔금은 총 수임료 − 월말까지 일자가 확인된 누적 입금이며, 차액이 음수인 계약은 미수 잔금 0원과 초과입금으로 나누어 표시하며 다른 계약 미수금과 상계하지 않습니다. 입금일·실납부액 미확인 계약의 잔금은 확정하지 않습니다. 미확인 입금 기록액에는 실제 입금 여부가 확인되지 않은 과거 계약 요약값이 포함될 수 있습니다. 계약금액·상태는 현재 기록 기준이며 취하·환불 금액은 자동 추정하지 않습니다.",
  };
}

/** Receipt details never repeat contract balances, so summing cash cannot double-count them. */
export function createReceiptSection(rows: AnalyticsLedgerViewRow[], mode: "monthly"|"cumulative"): AnalyticsSection {
  const receipts=rows.flatMap(row=>(mode==="monthly"?row.periodPayments:row.cumulativePayments).map(payment=>({row,payment}))).sort((a,b)=>analyticsLedgerDate(a.payment.paidDate).localeCompare(analyticsLedgerDate(b.payment.paidDate))||a.payment.id.localeCompare(b.payment.id));
  const amount=(payment:AnalyticsLedgerViewRow["periodPayments"][number])=>recordedActualPayment(payment);
  return {title:mode==="monthly"?"해당 월 입금 상세":"누적 입금 상세",headers:["결제일","사건유형","담당","의뢰인","사건번호","회차","실입금액","납부방식","입금 기록 ID"],
    rows:receipts.map(({row,payment})=>[analyticsLedgerDate(payment.paidDate),row.case.caseType,row.case.assignedStaff,row.client?.name??"-",row.case.caseNumber,payment.seq,amount(payment)??"확인 필요",row.case.paymentMethod,payment.id]),
    formats:["date","text","text","text","text","integer","won","text","text"],widths:[14,15,15,16,22,10,19,16,36],totalRow:[receipts.some(({payment})=>amount(payment)===undefined)?"확인분 합계 · 금액 미확인 있음":"입금 합계","","","","","",receipts.reduce((sum,{payment})=>sum+(amount(payment)??0),0),"",""]};
}
