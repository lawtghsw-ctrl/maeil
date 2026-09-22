"use client";

// 상담일지 대형 팝업 — "소득" 섹션. 직군(occupationType)은 데이터상 ConsultationPersonal에
// 속한 기존 필드지만, 화면 배치는 참고 이미지대로 이 섹션에 둡니다(값이 저장되는 곳과
// 화면에 보이는 위치가 다를 수 있다는 점만 유의 — 중복 저장은 하지 않습니다).
import type { ChangeEvent } from "react";
import type { ConsultationIncome, OccupationType } from "@/lib/types";
import { Input, Label, Select } from "@/components/ui/Primitives";
import { ManwonInput, OXToggle, SectionCard, UnitNumberInput } from "./shared";

const OCCUPATION_TYPES: OccupationType[] = ["직장인", "사업자", "프리랜서", "무직", "기타"];

export function IncomeSection({
  income,
  patchIncome,
  occupationType,
  onOccupationTypeChange,
  requiredKeys,
  missingKeys,
}: {
  income: ConsultationIncome;
  patchIncome: (p: Partial<ConsultationIncome>) => void;
  occupationType: OccupationType | undefined;
  onOccupationTypeChange: (v: OccupationType | undefined) => void;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
}) {
  return (
    <SectionCard title="소득">
      <Label text="직군" required={requiredKeys.has("occupationType")} missing={missingKeys.has("occupationType")}>
        <div className="flex flex-wrap gap-1.5">
          {OCCUPATION_TYPES.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onOccupationTypeChange(o)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                occupationType === o ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </Label>
      <Label text="연금소득 여부(국민/노령)">
        <OXToggle value={income.incomeType === "연금소득"} onChange={(v) => patchIncome({ incomeType: v ? "연금소득" : income.incomeType === "연금소득" ? undefined : income.incomeType })} />
      </Label>

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-slate-100 pt-2.5">
        <Label text="4대보험 여부">
          <OXToggle value={income.hasFourInsurances} onChange={(v) => patchIncome({ hasFourInsurances: v })} />
        </Label>
        <Label
          text="재직기간"
          required={requiredKeys.has("tenureInfo")}
          missing={missingKeys.has("tenureInfo")}
        >
          <UnitNumberInput value={income.tenureMonths} onChange={(v) => patchIncome({ tenureMonths: v })} unit="개월" />
        </Label>
      </div>
      <Label text="재직기간·사업장정보(상세)">
        <Input value={income.tenureInfo ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchIncome({ tenureInfo: e.target.value })} placeholder="예: 재직 4년차, ㈜한빛물류" />
      </Label>

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-slate-100 pt-2.5">
        <Label text="월 실수령" required={requiredKeys.has("monthlyAvgIncome")} missing={missingKeys.has("monthlyAvgIncome")}>
          <ManwonInput value={income.monthlyAvgIncome} onChange={(v) => patchIncome({ monthlyAvgIncome: v })} />
        </Label>
        <Label text="추가소득">
          <ManwonInput value={income.secondaryIncome} onChange={(v) => patchIncome({ secondaryIncome: v })} />
        </Label>
        <Label text="연금소득">
          <ManwonInput value={income.pensionIncome} onChange={(v) => patchIncome({ pensionIncome: v })} />
        </Label>
        <Label text="퇴직금">
          <ManwonInput value={income.severancePayEstimate} onChange={(v) => patchIncome({ severancePayEstimate: v })} />
        </Label>
      </div>

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-slate-100 pt-2.5">
        <Label text="급여통장">
          <Input value={income.salaryAccount ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchIncome({ salaryAccount: e.target.value })} />
        </Label>
        <Label text="급여통장 은행">
          <Input value={income.salaryAccountBank ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchIncome({ salaryAccountBank: e.target.value })} />
        </Label>
      </div>
      <Label text="급여통장 변경 가능 여부">
        <OXToggle value={income.salaryAccountChangeable} onChange={(v) => patchIncome({ salaryAccountChangeable: v })} />
      </Label>
      <Label text="비고">
        <Input value={income.note ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchIncome({ note: e.target.value })} />
      </Label>
    </SectionCard>
  );
}
