"use client";

// 상담일지 중단 상단 "소득". 참고 이미지처럼 라벨/입력 셀을 가로 한 줄로 붙여 배치하고,
// 직군은 한 줄 버튼 선택으로 유지합니다. 선택형 버튼은 같은 값을 한 번 더 누르면 미선택으로
// 돌아갑니다. 첫 취직일을 고르면 재직 개월 수를 자동 계산합니다.
import type { ChangeEvent } from "react";
import type { ConsultationIncome, OccupationType } from "@/lib/types";
import { Input } from "@/components/ui/Primitives";
import { calcTenureMonths } from "@/lib/consultation";
import {
  FieldRow,
  ManwonInput,
  OXToggle,
  SectionCard,
  compactInputClass,
} from "./shared";

const OCCUPATION_TYPES: OccupationType[] = ["직장인", "사업자", "연금소득", "프리랜서", "기타"];

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
  const required = (key: string) => requiredKeys.has(key);
  const missing = (key: string) => missingKeys.has(key);

  function handleStartDateChange(v: string) {
    const months = calcTenureMonths(v || undefined);
    patchIncome({
      employmentStartDate: v || undefined,
      tenureMonths: months,
      tenureInfo: months !== undefined ? `${months}개월` : undefined,
    });
  }

  return (
    <SectionCard title="소득" className="shrink-0">
      <FieldRow label="직군" required={required("occupationType")} missing={missing("occupationType")}>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {OCCUPATION_TYPES.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onOccupationTypeChange(occupationType === o ? undefined : o)}
              className={`h-7 flex-1 whitespace-nowrap rounded border px-1 text-[10px] font-bold transition ${
                occupationType === o
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="4대유무">
        <OXToggle value={income.hasFourInsurances} onChange={(v) => patchIncome({ hasFourInsurances: v })} />
      </FieldRow>

      <FieldRow label="재직기간" required={required("tenureInfo")} missing={missing("tenureInfo")}>
        <input
          type="date"
          className={compactInputClass}
          value={income.employmentStartDate ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleStartDateChange(e.target.value)}
        />
        <div className="flex h-7 min-w-[86px] items-center justify-center rounded border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-700">
          {income.tenureMonths === undefined ? "- 개월" : `${income.tenureMonths}개월`}
        </div>
      </FieldRow>

      <div className="grid grid-cols-2">
        <FieldRow label="월실수령" required={required("monthlyAvgIncome")} missing={missing("monthlyAvgIncome")} labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)] border-r">
          <ManwonInput value={income.monthlyAvgIncome} onChange={(v) => patchIncome({ monthlyAvgIncome: v })} />
        </FieldRow>
        <FieldRow label="추가소득" required={required("secondaryIncome")} missing={missing("secondaryIncome")} labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)]">
          <ManwonInput value={income.secondaryIncome} onChange={(v) => patchIncome({ secondaryIncome: v })} />
        </FieldRow>
      </div>

      <FieldRow label="퇴직금">
        <ManwonInput value={income.severancePayEstimate} onChange={(v) => patchIncome({ severancePayEstimate: v })} />
      </FieldRow>

      <div className="grid grid-cols-2">
        <FieldRow label="급여통장" required={required("salaryAccountBank")} missing={missing("salaryAccountBank")} labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)] border-r">
          <Input
            className={compactInputClass}
            value={income.salaryAccountBank ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchIncome({ salaryAccountBank: e.target.value })}
            placeholder="은행명"
          />
          <span className="shrink-0 text-[10px] text-slate-500">은행</span>
        </FieldRow>
        <FieldRow label="급통변경" required={required("salaryAccountChangeable")} missing={missing("salaryAccountChangeable")} labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)]">
          <OXToggle value={income.salaryAccountChangeable} onChange={(v) => patchIncome({ salaryAccountChangeable: v })} />
        </FieldRow>
      </div>
    </SectionCard>
  );
}
