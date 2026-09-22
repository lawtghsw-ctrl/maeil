"use client";

// 상담일지 대형 팝업 — "상담 플랜" 섹션. 위쪽은 v12에서 새로 추가된 자유기재 플랜
// 메모(ConsultationCounselPlan)이고, 아래 "법원 변제계획 자동계산"은 기존 RepaymentPlanInput
// + computeRepaymentPlan 로직을 그대로 접어서 담았습니다(계산식 변경 없음) — 카드가
// 복잡해지는 것을 막기 위해 기본은 접혀있고 필요할 때만 펼쳐 봅니다.
import { useState, type ChangeEvent } from "react";
import { useStore } from "@/lib/store";
import type { ConsultationCounselPlan, RepaymentPlanInput } from "@/lib/types";
import { lookupMinLivingCost, type RepaymentPlanResult } from "@/lib/consultation";
import { NumberInput, Label } from "@/components/ui/Primitives";
import { ManwonInput, SectionCard, compactTextareaClass } from "./shared";
import { fmtWon } from "@/lib/format";
import { ChevronRight } from "lucide-react";

export function PlanSection({
  counselPlan,
  patchCounselPlan,
  plan,
  patchPlan,
  result,
}: {
  counselPlan: ConsultationCounselPlan;
  patchCounselPlan: (p: Partial<ConsultationCounselPlan>) => void;
  plan: RepaymentPlanInput;
  patchPlan: (p: Partial<RepaymentPlanInput>) => void;
  result: RepaymentPlanResult;
}) {
  const { minLivingCostTable } = useStore();
  const [showAuto, setShowAuto] = useState(false);

  return (
    <SectionCard title="상담 플랜">
      <Label text="회생 예상플랜">
        <textarea className={compactTextareaClass} value={counselPlan.rehabPlanNote ?? ""} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchCounselPlan({ rehabPlanNote: e.target.value })} />
      </Label>
      <Label text="회복 예상플랜">
        <textarea
          className={compactTextareaClass}
          value={counselPlan.recoveryPlanNote ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchCounselPlan({ recoveryPlanNote: e.target.value })}
        />
      </Label>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
        <Label text="원금 탕감율">
          <div className="flex items-center gap-1.5">
            <NumberInput value={counselPlan.principalReductionPct ?? 0} onChange={(v) => patchCounselPlan({ principalReductionPct: v })} />
            <span className="shrink-0 text-xs font-semibold text-slate-400">%</span>
          </div>
        </Label>
        <Label text="변제금 감소율">
          <div className="flex items-center gap-1.5">
            <NumberInput value={counselPlan.paymentReductionPct ?? 0} onChange={(v) => patchCounselPlan({ paymentReductionPct: v })} />
            <span className="shrink-0 text-xs font-semibold text-slate-400">%</span>
          </div>
        </Label>
      </div>

      <button
        type="button"
        onClick={() => setShowAuto((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
      >
        법원 변제계획 자동계산(개인회생) {showAuto ? "접기" : "펼치기"}
        <ChevronRight size={13} className={`transition-transform ${showAuto ? "rotate-90" : ""}`} />
      </button>

      {showAuto && (
        <div className="space-y-2 rounded-lg border border-slate-100 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Label text="가구원수">
              <NumberInput
                min={1}
                value={plan.householdSize}
                onChange={(v) => patchPlan({ householdSize: v || 1, minLivingCost: lookupMinLivingCost(v || 1, minLivingCostTable) })}
              />
            </Label>
            <Label text="최저생계비">
              <ManwonInput value={plan.minLivingCost} onChange={(v) => patchPlan({ minLivingCost: v })} />
            </Label>
            <Label text="기타공제금">
              <ManwonInput value={plan.otherDeduction} onChange={(v) => patchPlan({ otherDeduction: v })} />
            </Label>
            <Label text="변제개월수">
              <NumberInput min={1} value={plan.repaymentMonths} onChange={(v) => patchPlan({ repaymentMonths: v || 1 })} />
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-slate-50 p-2">
              <div className="font-semibold text-slate-500">월 가용소득(자동)</div>
              <div className="mt-0.5 font-bold text-slate-900">{fmtWon(result.monthlyDisposableIncome)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <div className="font-semibold text-slate-500">청산가치(자동)</div>
              <div className="mt-0.5 font-bold text-slate-900">{fmtWon(result.liquidationValue)}</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-2">
              <div className="font-semibold text-blue-600">최종 월 변제금(자동)</div>
              <div className="mt-0.5 font-bold text-blue-700">{fmtWon(result.finalMonthlyRepayment)}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2">
              <div className="font-semibold text-emerald-600">탕감액/탕감률(자동)</div>
              <div className="mt-0.5 font-bold text-emerald-700">
                {fmtWon(result.writeOffAmount)} ({result.writeOffRate.toFixed(1)}%)
              </div>
            </div>
          </div>
          <div className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${result.feasible ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            진행가능여부(자동판정): {result.feasible ? "가능" : "재검토 필요"} — {result.feasibilityNote}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
