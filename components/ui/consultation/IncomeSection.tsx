"use client";

// 상담일지 중단 상단 "소득". 사용자 지정 순서와 한 줄 병합 규칙(|)을 그대로 반영했습니다.
// 직군/거주형태 같은 빠른 선택은 버튼 그룹, 재직기간은 첫 취직일을 기준으로 만 개월 자동계산합니다.
import type { ChangeEvent } from "react";
import type { ConsultationIncome, OccupationType } from "@/lib/types";
import { calcTenureMonths } from "@/lib/consultation";
import {
  DenseButtonGroup,
  DenseRow,
  ManwonInput,
  OXToggle,
  SectionCard,
  UnitNumberInput,
  denseInputClass,
} from "./shared";

const OCCUPATION_TYPES: OccupationType[] = ["직장인", "사업자", "연금소득", "프리랜서", "기타"];

export function IncomeSection({
  income,
  patchIncome,
  occupationType,
  onOccupationTypeChange,
  requiredKeys: _requiredKeys,
  missingKeys: _missingKeys,
}: {
  income: ConsultationIncome;
  patchIncome: (p: Partial<ConsultationIncome>) => void;
  occupationType: OccupationType | undefined;
  onOccupationTypeChange: (v: OccupationType | undefined) => void;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
}) {
  function handleStartDateChange(v: string) {
    const months = calcTenureMonths(v || undefined);
    patchIncome({
      employmentStartDate: v || undefined,
      tenureMonths: months,
      tenureInfo: months !== undefined ? `${months}개월` : income.tenureInfo,
    });
  }

  return (
    <SectionCard title="소득">
      <DenseRow label="직군">
        <DenseButtonGroup options={OCCUPATION_TYPES} value={occupationType} onChange={onOccupationTypeChange} />
      </DenseRow>

      <DenseRow label="4대유무">
        <OXToggle value={income.hasFourInsurances} onChange={(v) => patchIncome({ hasFourInsurances: v })} />
      </DenseRow>

      <DenseRow label="재직기간">
        <input
          type="date"
          className={denseInputClass}
          value={income.employmentStartDate ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleStartDateChange(e.target.value)}
          title="첫 취직일"
        />
        <UnitNumberInput
          value={income.tenureMonths}
          onChange={(v) => patchIncome({ tenureMonths: v, tenureInfo: `${v}개월` })}
          unit="개월"
          className="max-w-[116px]"
        />
      </DenseRow>

      <DenseRow label="월실수령">
        <ManwonInput value={income.monthlyAvgIncome} onChange={(v) => patchIncome({ monthlyAvgIncome: v })} className="max-w-[150px]" />
        <span className="ml-auto shrink-0 border-l border-slate-200 pl-2 text-[11px] font-semibold text-slate-600">추가소득</span>
        <input
          className={`${denseInputClass} max-w-[135px]`}
          value={income.secondaryIncomeNote ?? (income.secondaryIncome ? `${Math.round(income.secondaryIncome / 10000)}만원` : "")}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const text = e.target.value;
            const digits = text.replace(/[^0-9.]/g, "");
            const manwon = digits ? Number(digits) : 0;
            patchIncome({
              secondaryIncomeNote: text,
              secondaryIncome: Number.isFinite(manwon) ? Math.max(0, manwon) * 10000 : 0,
            });
          }}
          placeholder="없음"
        />
      </DenseRow>

      <DenseRow label="퇴직금">
        <ManwonInput value={income.severancePayEstimate} onChange={(v) => patchIncome({ severancePayEstimate: v })} className="max-w-[170px]" />
      </DenseRow>

      <DenseRow label="급여통장">
        <input
          className={`${denseInputClass} max-w-[150px]`}
          value={income.salaryAccountBank ?? income.salaryAccount ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patchIncome({ salaryAccountBank: e.target.value })}
          placeholder="은행명"
        />
        <span className="shrink-0 text-[11px] text-slate-500">은행</span>
        <span className="ml-auto shrink-0 border-l border-slate-200 pl-2 text-[11px] font-semibold text-slate-600">급통변경</span>
        <OXToggle value={income.salaryAccountChangeable} onChange={(v) => patchIncome({ salaryAccountChangeable: v })} />
      </DenseRow>
    </SectionCard>
  );
}
