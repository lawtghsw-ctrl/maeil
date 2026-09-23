"use client";

// 최저생계비 계산기 — v19 운영 기준 6개 가구원수(1/1.5/2/2.5/3/4인)를 관리합니다.
// 상담일지에서는 여기 저장된 값을 자동으로 불러와 예상 월 변제금/탕감률 계산에 사용합니다.
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { lookupMinLivingCost, MIN_LIVING_COST_HOUSEHOLD_SIZES } from "@/lib/consultation";
import { fmtWon } from "@/lib/format";
import { Card, Label, NumberInput, PageHeader } from "@/components/ui/Primitives";

export default function MinLivingCostPage() {
  const { minLivingCostTable, setMinLivingCostForSize } = useStore();
  const [previewSize, setPreviewSize] = useState<number>(1);

  const previewValue = useMemo(
    () => lookupMinLivingCost(previewSize, minLivingCostTable),
    [previewSize, minLivingCostTable]
  );

  return (
    <>
      <PageHeader
        title="최저생계비 계산기"
        description="가구원수별 기준액을 관리합니다. 상담일지에서 가구원수를 선택하면 해당 금액이 자동 반영됩니다."
      />

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">
          가구원수별 최저생계비 설정
        </div>
        <div className="divide-y divide-slate-100">
          {MIN_LIVING_COST_HOUSEHOLD_SIZES.map((size) => {
            const value = minLivingCostTable.sizes[size] ?? 0;
            return (
              <div key={size} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="w-20 shrink-0 text-sm font-semibold text-slate-700">{size}인가구</div>
                <NumberInput
                  className="max-w-[220px]"
                  value={value}
                  onChange={(v) => setMinLivingCostForSize(size, v)}
                />
                <div className="text-xs text-slate-400">{fmtWon(value)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">상담일지 반영 미리보기</div>
        <div className="flex flex-wrap items-end gap-4">
          <Label text="가구원수">
            <div className="flex flex-wrap gap-1">
              {MIN_LIVING_COST_HOUSEHOLD_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setPreviewSize(size)}
                  className={`h-10 rounded-lg border px-3 text-sm font-bold ${
                    previewSize === size
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {size}인
                </button>
              ))}
            </div>
          </Label>
          <div className="rounded-xl bg-slate-50 px-5 py-3">
            <div className="text-xs font-semibold text-slate-500">자동 반영 최저생계비</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{fmtWon(previewValue)}</div>
          </div>
        </div>
      </Card>
    </>
  );
}
