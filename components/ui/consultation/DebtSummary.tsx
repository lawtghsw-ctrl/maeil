"use client";

// 상담일지 대형 팝업 — "채무 요약" 섹션(신규). 아래 "채무 리스트"(loanRecords, 개별 대출
// 상세)를 기준으로 총 채무금액/총 신용금액/총 담보금액/총 이자(연 추정)/월 불입금을
// 자동 계산해 보여주고, 급여일·카드결제 정보처럼 자동계산 대상이 아닌 항목은 수동
// 입력란(ConsultationDebtSummaryExtra)으로 둡니다. 기존 5개 고정 카테고리 "채무현황"
// 표(청산가치 산정용, DebtRow[])는 별개로 그대로 유지되며 이 자동계산에는 섞지
// 않았습니다(성격이 다른 두 표를 합산하면 오히려 부정확해지기 때문).
import type { ChangeEvent } from "react";
import type { ConsultationDebtSummaryExtra, LoanRecord } from "@/lib/types";
import { Input, Label } from "@/components/ui/Primitives";
import { ManwonInput, SectionCard, UnitNumberInput } from "./shared";
import { fmtWon } from "@/lib/format";

export function DebtSummary({
  loanRecords,
  extra,
  patchExtra,
}: {
  loanRecords: LoanRecord[];
  extra: ConsultationDebtSummaryExtra;
  patchExtra: (p: Partial<ConsultationDebtSummaryExtra>) => void;
}) {
  const totalDebt = loanRecords.reduce((a, l) => a + (l.balance || 0), 0);
  const totalCredit = loanRecords.filter((l) => l.kind1 === "신용").reduce((a, l) => a + (l.balance || 0), 0);
  const totalSecured = loanRecords.filter((l) => l.kind1 === "담보").reduce((a, l) => a + (l.balance || 0), 0);
  const totalInterest = loanRecords.reduce((a, l) => a + (l.balance || 0) * ((l.interestRate || 0) / 100), 0);
  const totalMonthlyPayment = loanRecords.reduce((a, l) => a + (l.monthlyPayment || 0), 0);

  const tiles: Array<[string, string]> = [
    ["총 채무금액", fmtWon(totalDebt)],
    ["총 신용금액", fmtWon(totalCredit)],
    ["총 담보금액", fmtWon(totalSecured)],
    ["총 이자(연 추정)", fmtWon(totalInterest)],
    ["월 불입금", fmtWon(totalMonthlyPayment)],
  ];

  return (
    <SectionCard title="채무 요약" className="xl:col-span-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 p-2.5">
            <div className="text-[11px] font-semibold text-slate-500">{label}</div>
            <div className="mt-0.5 text-sm font-bold text-slate-900">{value}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-slate-400">※ 위 자동계산은 아래 "채무 리스트"(개별 대출) 기준이며, 5개 고정 카테고리 채무현황 표(청산가치 산정용)와는 별도로 계산됩니다.</div>

      <div className="grid grid-cols-2 gap-2.5 border-t border-slate-100 pt-2.5 sm:grid-cols-4">
        <Label text="급여일">
          <UnitNumberInput value={extra.salaryPayDay} onChange={(v) => patchExtra({ salaryPayDay: v })} unit="일" max={31} />
        </Label>
        <Label text="카드결제금액">
          <ManwonInput value={extra.cardPaymentAmount} onChange={(v) => patchExtra({ cardPaymentAmount: v })} />
        </Label>
        <Label text="카드결제일">
          <UnitNumberInput value={extra.cardPaymentDay} onChange={(v) => patchExtra({ cardPaymentDay: v })} unit="일" max={31} />
        </Label>
        <Label text="보유중인 신용카드">
          <Input value={extra.heldCreditCards ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchExtra({ heldCreditCards: e.target.value })} placeholder="예: 국민카드, 현대카드" />
        </Label>
      </div>
    </SectionCard>
  );
}
