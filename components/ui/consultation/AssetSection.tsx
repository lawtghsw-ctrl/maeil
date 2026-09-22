"use client";

// 상담일지 중단 하단 "자산". 원본 참고 화면의 순서와 밀도를 맞춰 거주/차량 정보 뒤에
// 채무 요약 수기 입력란을 바로 이어 붙입니다. 기대출 리스트에서 계산 가능한 값은 수기값이
// 없을 때만 fallback으로 표시하므로 파일 파싱 후에도 즉시 합계를 확인할 수 있습니다.
import type { ChangeEvent } from "react";
import type { ConsultationDebtSummaryExtra, ConsultationHousing, LoanRecord } from "@/lib/types";
import { HOUSING_TYPES } from "@/lib/types";
import { Input } from "@/components/ui/Primitives";
import {
  FieldRow,
  ManwonInput,
  OXToggle,
  SectionCard,
  UnitNumberInput,
  compactInputClass,
} from "./shared";

export function AssetSection({
  housing,
  patchHousing,
  loanRecords,
  debtSummaryExtra,
  patchDebtSummaryExtra,
  requiredKeys,
  missingKeys,
}: {
  housing: ConsultationHousing;
  patchHousing: (p: Partial<ConsultationHousing>) => void;
  loanRecords: LoanRecord[];
  debtSummaryExtra: ConsultationDebtSummaryExtra;
  patchDebtSummaryExtra: (p: Partial<ConsultationDebtSummaryExtra>) => void;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
}) {
  const required = (key: string) => requiredKeys.has(key);
  const missing = (key: string) => missingKeys.has(key);

  const autoTotalDebt = loanRecords.reduce((a, l) => a + (l.balance || 0), 0);
  const autoTotalCredit = loanRecords.filter((l) => l.kind1 === "신용").reduce((a, l) => a + (l.balance || 0), 0);
  const autoTotalSecured = loanRecords.filter((l) => l.kind1 === "담보").reduce((a, l) => a + (l.balance || 0), 0);
  const autoTotalInterest = loanRecords.reduce((a, l) => a + (l.balance || 0) * ((l.interestRate || 0) / 100), 0);
  const autoMonthlyPayment = loanRecords.reduce((a, l) => a + (l.monthlyPayment || 0), 0);

  const totalDebt = debtSummaryExtra.totalDebtAmount ?? (autoTotalDebt || undefined);
  const totalCredit = debtSummaryExtra.totalCreditAmount ?? (autoTotalCredit || undefined);
  const totalSecured = debtSummaryExtra.totalSecuredAmount ?? (autoTotalSecured || undefined);
  const totalInterest = debtSummaryExtra.totalInterestAmount ?? (autoTotalInterest || undefined);
  const monthlyPayment = debtSummaryExtra.monthlyPaymentAmount ?? (autoMonthlyPayment || undefined);

  return (
    <SectionCard title="자산" className="min-h-0 flex-1">
      <FieldRow label="거주형태" required={required("housingType")} missing={missing("housingType")}>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {HOUSING_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => patchHousing({ housingType: housing.housingType === t ? undefined : t })}
              className={`h-7 flex-1 whitespace-nowrap rounded border px-1 text-[9px] font-bold transition ${
                housing.housingType === t
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="거주 메모">
        <Input className={compactInputClass} value={housing.housingNote ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchHousing({ housingNote: e.target.value })} />
      </FieldRow>

      <FieldRow label="차량유무">
        <OXToggle value={housing.hasVehicle} onChange={(v) => patchHousing({ hasVehicle: v })} />
        <Input className={compactInputClass} value={housing.vehicleInfo ?? ""} onChange={(e) => patchHousing({ vehicleInfo: e.target.value })} placeholder="차량 정보" />
      </FieldRow>

      <FieldRow label="배우자 차량유무">
        <OXToggle value={housing.spouseHasVehicle} onChange={(v) => patchHousing({ spouseHasVehicle: v })} />
        <Input className={compactInputClass} value={housing.spouseVehicleInfo ?? ""} onChange={(e) => patchHousing({ spouseVehicleInfo: e.target.value })} placeholder="배우자 차량 정보" />
      </FieldRow>

      <FieldRow label="총 채무금액" required={required("hasDebtAmount")} missing={missing("hasDebtAmount")}>
        <ManwonInput value={totalDebt} onChange={(v) => patchDebtSummaryExtra({ totalDebtAmount: v })} />
      </FieldRow>

      <div className="grid grid-cols-2">
        <FieldRow label="총 신용금액" labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)] border-r">
          <ManwonInput value={totalCredit} onChange={(v) => patchDebtSummaryExtra({ totalCreditAmount: v })} />
        </FieldRow>
        <FieldRow label="총 담보금액" labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)]">
          <ManwonInput value={totalSecured} onChange={(v) => patchDebtSummaryExtra({ totalSecuredAmount: v })} />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2">
        <FieldRow label="총 이자" labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)] border-r">
          <ManwonInput value={totalInterest} onChange={(v) => patchDebtSummaryExtra({ totalInterestAmount: v })} />
        </FieldRow>
        <FieldRow label="월 불입금" required={required("monthlyPaymentAmount")} missing={missing("monthlyPaymentAmount")} labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)]">
          <ManwonInput value={monthlyPayment} onChange={(v) => patchDebtSummaryExtra({ monthlyPaymentAmount: v })} />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2">
        <FieldRow label="급여일" labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)] border-r">
          <UnitNumberInput value={debtSummaryExtra.salaryPayDay} onChange={(v) => patchDebtSummaryExtra({ salaryPayDay: v })} unit="일" max={31} />
        </FieldRow>
        <FieldRow label="카드결제금액" labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)]">
          <ManwonInput value={debtSummaryExtra.cardPaymentAmount} onChange={(v) => patchDebtSummaryExtra({ cardPaymentAmount: v })} />
        </FieldRow>
      </div>

      <FieldRow label="대출결제일" required={required("cardPaymentDay")} missing={missing("cardPaymentDay")}>
        <UnitNumberInput value={debtSummaryExtra.cardPaymentDay} onChange={(v) => patchDebtSummaryExtra({ cardPaymentDay: v })} unit="일" max={31} />
      </FieldRow>

      <FieldRow label="보유중인 신용카드">
        <Input className={compactInputClass} value={debtSummaryExtra.heldCreditCards ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchDebtSummaryExtra({ heldCreditCards: e.target.value })} placeholder="예: 하나/삼성/국민" />
      </FieldRow>
    </SectionCard>
  );
}
