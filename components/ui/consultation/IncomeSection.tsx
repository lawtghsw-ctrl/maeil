"use client";

// 상담일지 대형 팝업 — "소득" 섹션. 직군(occupationType)은 데이터상 ConsultationPersonal에
// 속한 기존 필드지만, 화면 배치는 참고 이미지대로 이 섹션에 둡니다(값이 저장되는 곳과
// 화면에 보이는 위치가 다를 수 있다는 점만 유의 — 중복 저장은 하지 않습니다).
//
// v13 변경: "재직기간"을 개월수 직접입력 대신 [첫 취직일(날짜)] → [자동계산 개월수]
// 방식으로 바꿨습니다. 첫 취직일을 고르면 calcTenureMonths로 개월수를 계산해
// income.tenureMonths와 tenureInfo("N개월")를 함께 자동 채우므로, 기존 필수항목 체크
// (tenureInfo 기준)도 그대로 통과합니다 — 첫 취직일을 모르는 경우 기존처럼 개월수를
// 손으로 입력해도 동작합니다(자동계산값이 있으면 화면에는 자동계산 쪽을 우선 표시).
import type { ChangeEvent } from "react";
import type { ConsultationIncome, OccupationType } from "@/lib/types";
import { Input, Label } from "@/components/ui/Primitives";
import { calcTenureMonths } from "@/lib/consultation";
import { ManwonInput, OXToggle, SectionCard, UnitNumberInput, dateInputClass } from "./shared";

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

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
        <Label text="4대보험 유무">
          <OXToggle value={income.hasFourInsurances} onChange={(v) => patchIncome({ hasFourInsurances: v })} />
        </Label>
        <div />
      </div>

      <Label text="재직기간" required={requiredKeys.has("tenureInfo")} missing={missingKeys.has("tenureInfo")}>
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="date"
            className={dateInputClass}
            value={income.employmentStartDate ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleStartDateChange(e.target.value)}
          />
          <UnitNumberInput
            value={income.tenureMonths}
            onChange={(v) => patchIncome({ tenureMonths: v, tenureInfo: `${v}개월` })}
            unit="개월"
          />
        </div>
      </Label>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
        <Label text="월 실수령" required={requiredKeys.has("monthlyAvgIncome")} missing={missingKeys.has("monthlyAvgIncome")}>
          <ManwonInput value={income.monthlyAvgIncome} onChange={(v) => patchIncome({ monthlyAvgIncome: v })} />
        </Label>
        <Label text="추가소득">
          <ManwonInput value={income.secondaryIncome} onChange={(v) => patchIncome({ secondaryIncome: v })} />
        </Label>
      </div>
      <Label text="퇴직금">
        <ManwonInput value={income.severancePayEstimate} onChange={(v) => patchIncome({ severancePayEstimate: v })} />
      </Label>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
        <Label text="급여통장">
          <Input value={income.salaryAccount ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchIncome({ salaryAccount: e.target.value })} />
        </Label>
        <Label text="급통 변경 가능 여부">
          <OXToggle value={income.salaryAccountChangeable} onChange={(v) => patchIncome({ salaryAccountChangeable: v })} />
        </Label>
      </div>
      <Label text="급여통장 은행">
        <Input value={income.salaryAccountBank ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchIncome({ salaryAccountBank: e.target.value })} />
      </Label>
    </SectionCard>
  );
}
