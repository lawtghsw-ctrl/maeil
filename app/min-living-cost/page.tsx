"use client";

// 최저생계비 계산기 — 가구원수별 최저생계비는 매년 고시가 바뀌는 법적으로 민감한 수치라
// LawPower가 임의의 표를 만들어 자동판정하지 않습니다. 대신 이 화면에서 로펌 관리자가
// 매년 고시된 최신 기준을 직접 입력해 관리하면, 그 값이 고객관리 수정 팝업의 변제계획
// 탭(가구원수 선택)에 자동 반영됩니다.
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { lookupMinLivingCost, MIN_LIVING_COST_HOUSEHOLD_SIZES } from "@/lib/consultation";
import { fmtWon } from "@/lib/format";
import { Card, Label, NumberInput, PageHeader } from "@/components/ui/Primitives";
import { Info } from "lucide-react";

export default function MinLivingCostPage() {
  const { minLivingCostTable, setMinLivingCostForSize, setMinLivingCostExtraPerPerson } = useStore();
  const [previewSize, setPreviewSize] = useState(1);

  const previewValue = useMemo(() => lookupMinLivingCost(previewSize, minLivingCostTable), [previewSize, minLivingCostTable]);
  const unset = previewValue === 0;

  return (
    <>
      <PageHeader
        title="최저생계비 계산기"
        description="가구원수별 최저생계비를 직접 설정하면, 고객관리 수정 팝업의 변제계획 탭에서 가구원수를 선택할 때 자동으로 반영됩니다."
      />

      <Card className="mb-4 flex items-start gap-3 border-amber-100 bg-amber-50/60 px-4 py-3 text-xs text-amber-700">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          최저생계비(기준중위소득) 기준액은 매년 정부 고시로 바뀌는 수치라, 특정 연도의 값을 임의로
          채워두지 않았습니다. 1인가구만 상담일지 원본 수치를 참고로 넣어두었고, 나머지 가구원수는
          아래에서 최신 고시 기준을 직접 입력해주세요. 저장한 값은 즉시 고객 상담일지에 반영됩니다.
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">가구원수별 최저생계비 설정</div>
        <div className="divide-y divide-slate-100">
          {MIN_LIVING_COST_HOUSEHOLD_SIZES.map((size) => {
            const value = minLivingCostTable.sizes[size] ?? 0;
            return (
              <div key={size} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="w-20 shrink-0 text-sm font-semibold text-slate-700">{size}인가구</div>
                <NumberInput className="max-w-[220px]" value={value} onChange={(v) => setMinLivingCostForSize(size, v)} />
                <div className="text-xs text-slate-400">{value > 0 ? fmtWon(value) : "관리자 설정 필요"}</div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="w-20 shrink-0 text-sm font-semibold text-slate-700">7인 이상</div>
            <div className="text-xs text-slate-500">6인가구 기준 + 1인당</div>
            <NumberInput
              className="max-w-[220px]"
              value={minLivingCostTable.extraPerPerson}
              onChange={(v) => setMinLivingCostExtraPerPerson(v)}
            />
            <div className="text-xs text-slate-400">추가 (예: 7인가구 = 6인가구 값 + 위 금액 × 1)</div>
          </div>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">계산기 (미리보기)</div>
        <div className="flex flex-wrap items-end gap-4">
          <Label text="가구원수">
            <NumberInput min={1} className="max-w-[160px]" value={previewSize} onChange={(v) => setPreviewSize(v || 1)} />
          </Label>
          <div className="rounded-xl bg-slate-50 px-5 py-3">
            <div className="text-xs font-semibold text-slate-500">해당 가구원수 최저생계비</div>
            <div className={`mt-1 text-lg font-bold ${unset ? "text-red-500" : "text-slate-900"}`}>
              {unset ? "관리자 설정 필요" : fmtWon(previewValue)}
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
