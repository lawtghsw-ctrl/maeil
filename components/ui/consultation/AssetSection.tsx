"use client";

// 상담일지 중단 "자산" + 바로 아래 채무요약. 기존 AssetRow[] 데이터는 계산/호환을 위해
// 그대로 유지하지만, 사용자가 지정한 최종 상담일지 화면에는 별도 재산현황 표를 노출하지
// 않습니다. 채무요약은 수기 입력이 가능하며 값이 아직 없으면 기대출 리스트를 기준으로
// 자동 계산한 값을 즉시 보여줍니다.
import type { ChangeEvent } from "react";
import type { AssetRow, ConsultationDebtSummaryExtra, ConsultationHousing, LoanRecord } from "@/lib/types";
import { HOUSING_TYPES } from "@/lib/types";
import {
  DenseButtonGroup,
  DenseRow,
  ManwonInput,
  OXToggle,
  SectionCard,
  UnitNumberInput,
  denseInputClass,
} from "./shared";

export function AssetSection({
  housing,
  patchHousing,
  assets: _assets,
  setAssets: _setAssets,
  loanRecords,
  debtSummaryExtra,
  patchDebtSummaryExtra,
  requiredKeys: _requiredKeys,
  missingKeys: _missingKeys,
}: {
  housing: ConsultationHousing;
  patchHousing: (p: Partial<ConsultationHousing>) => void;
  assets: AssetRow[];
  setAssets: (updater: AssetRow[] | ((prev: AssetRow[]) => AssetRow[])) => void;
  loanRecords: LoanRecord[];
  debtSummaryExtra: ConsultationDebtSummaryExtra;
  patchDebtSummaryExtra: (p: Partial<ConsultationDebtSummaryExtra>) => void;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
}) {
  const autoTotalDebt = loanRecords.reduce((a, l) => a + (l.balance || 0), 0);
  const autoTotalCredit = loanRecords.filter((l) => l.kind1 === "신용").reduce((a, l) => a + (l.balance || 0), 0);
  const autoTotalSecured = loanRecords.filter((l) => l.kind1 === "담보").reduce((a, l) => a + (l.balance || 0), 0);
  const autoTotalInterest = loanRecords.reduce((a, l) => a + (l.balance || 0) * ((l.interestRate || 0) / 100), 0);
  const autoMonthlyPayment = loanRecords.reduce((a, l) => a + (l.monthlyPayment || 0), 0);

  return (
    <SectionCard title="자산">
      <DenseRow label="거주형태">
        <DenseButtonGroup options={HOUSING_TYPES} value={housing.housingType} onChange={(v) => patchHousing({ housingType: v })} />
      </DenseRow>
      <DenseRow label="">
        <input
          className={denseInputClass}
          value={housing.housingNote ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patchHousing({ housingNote: e.target.value })}
          placeholder="거주 관련 메모"
        />
      </DenseRow>
      <DenseRow label="차량유무">
        <OXToggle value={housing.hasVehicle} onChange={(v) => patchHousing({ hasVehicle: v })} />
        <input
          className={denseInputClass}
          value={housing.vehicleInfo ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patchHousing({ vehicleInfo: e.target.value })}
          placeholder="차량 정보"
        />
      </DenseRow>
      <DenseRow label="배우자 차량유무" labelWidth="96px">
        <OXToggle value={housing.spouseHasVehicle} onChange={(v) => patchHousing({ spouseHasVehicle: v })} />
        <input
          className={denseInputClass}
          value={housing.spouseVehicleInfo ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patchHousing({ spouseVehicleInfo: e.target.value })}
          placeholder="배우자 차량 정보"
        />
      </DenseRow>

      <DenseRow label="총 채무금액" className="border-t border-slate-300">
        <ManwonInput
          value={debtSummaryExtra.totalDebtAmount ?? autoTotalDebt}
          onChange={(v) => patchDebtSummaryExtra({ totalDebtAmount: v })}
          className="max-w-[180px]"
        />
      </DenseRow>
      <DenseRow label="총 신용금액">
        <ManwonInput
          value={debtSummaryExtra.totalCreditAmount ?? autoTotalCredit}
          onChange={(v) => patchDebtSummaryExtra({ totalCreditAmount: v })}
          className="max-w-[145px]"
        />
        <span className="ml-auto shrink-0 border-l border-slate-200 pl-2 text-[11px] font-semibold text-slate-600">총 담보금액</span>
        <ManwonInput
          value={debtSummaryExtra.totalSecuredAmount ?? autoTotalSecured}
          onChange={(v) => patchDebtSummaryExtra({ totalSecuredAmount: v })}
          className="max-w-[135px]"
        />
      </DenseRow>
      <DenseRow label="총 이자">
        <ManwonInput
          value={debtSummaryExtra.totalInterestAmount ?? autoTotalInterest}
          onChange={(v) => patchDebtSummaryExtra({ totalInterestAmount: v })}
          className="max-w-[145px]"
        />
        <span className="ml-auto shrink-0 border-l border-slate-200 pl-2 text-[11px] font-semibold text-slate-600">월 불입금</span>
        <ManwonInput
          value={debtSummaryExtra.monthlyDebtPayment ?? autoMonthlyPayment}
          onChange={(v) => patchDebtSummaryExtra({ monthlyDebtPayment: v })}
          className="max-w-[135px]"
        />
      </DenseRow>
      <DenseRow label="급여일">
        <UnitNumberInput
          value={debtSummaryExtra.salaryPayDay}
          onChange={(v) => patchDebtSummaryExtra({ salaryPayDay: v })}
          unit="일"
          max={31}
          className="max-w-[110px]"
        />
        <span className="ml-auto shrink-0 border-l border-slate-200 pl-2 text-[11px] font-semibold text-slate-600">카드결제금액</span>
        <ManwonInput
          value={debtSummaryExtra.cardPaymentAmount}
          onChange={(v) => patchDebtSummaryExtra({ cardPaymentAmount: v })}
          className="max-w-[135px]"
        />
      </DenseRow>
      <DenseRow label="매출결제일">
        <UnitNumberInput
          value={debtSummaryExtra.cardPaymentDay}
          onChange={(v) => patchDebtSummaryExtra({ cardPaymentDay: v })}
          unit="일"
          max={31}
          className="max-w-[120px]"
        />
      </DenseRow>
      <DenseRow label="보유중인 신용카드" labelWidth="96px">
        <input
          className={denseInputClass}
          value={debtSummaryExtra.heldCreditCards ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patchDebtSummaryExtra({ heldCreditCards: e.target.value })}
          placeholder="예: 하나/삼성/국민"
        />
      </DenseRow>
    </SectionCard>
  );
}
