"use client";

import { useState, type ChangeEvent } from "react";
import { useStore } from "@/lib/store";
import type { ConsultationCounselPlan, ConsultationRecentLoanInsurance, PctRange, RepaymentPlanInput } from "@/lib/types";
import { PCT_RANGE_OPTIONS } from "@/lib/types";
import { lookupMinLivingCost, type RepaymentPlanResult } from "@/lib/consultation";
import { NumberInput, Select } from "@/components/ui/Primitives";
import {
  FieldRow,
  ManwonInput,
  SectionCard,
  compactSelectClass,
  compactTextareaClass,
} from "./shared";
import { fmtWon } from "@/lib/format";
import { ChevronRight } from "lucide-react";

export function PlanSection({
  counselPlan,
  patchCounselPlan,
  plan,
  patchPlan,
  result,
  recentLoanInsurance,
  patchRecentLoanInsurance,
  requiredKeys,
  missingKeys,
}: {
  counselPlan: ConsultationCounselPlan;
  patchCounselPlan: (p: Partial<ConsultationCounselPlan>) => void;
  plan: RepaymentPlanInput;
  patchPlan: (p: Partial<RepaymentPlanInput>) => void;
  result: RepaymentPlanResult;
  recentLoanInsurance: ConsultationRecentLoanInsurance;
  patchRecentLoanInsurance: (p: Partial<ConsultationRecentLoanInsurance>) => void;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
}) {
  const { minLivingCostTable } = useStore();
  const [showAuto, setShowAuto] = useState(false);
  const required = (key: string) => requiredKeys.has(key);
  const missing = (key: string) => missingKeys.has(key);

  return (
    <SectionCard title="플랜" className="min-h-0 flex-1">
      <FieldRow label="회생 예상플랜" required={required("rehabPlanNote")} missing={missing("rehabPlanNote")} contentClassName="items-stretch">
        <textarea
          className={`${compactTextareaClass} min-h-12 flex-1`}
          value={counselPlan.rehabPlanNote ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchCounselPlan({ rehabPlanNote: e.target.value })}
        />
      </FieldRow>
      <FieldRow label="회복 예상플랜" required={required("recoveryPlanNote")} missing={missing("recoveryPlanNote")} contentClassName="items-stretch">
        <textarea
          className={`${compactTextareaClass} min-h-12 flex-1`}
          value={counselPlan.recoveryPlanNote ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchCounselPlan({ recoveryPlanNote: e.target.value })}
        />
      </FieldRow>

      <div className="grid grid-cols-2">
        <FieldRow label="원금 탕감율" labelClassName="w-[82px]" className="grid-cols-[82px_minmax(0,1fr)] border-r">
          <Select
            value={counselPlan.principalReductionRange ?? ""}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => patchCounselPlan({ principalReductionRange: (e.target.value || undefined) as PctRange | undefined })}
            className={compactSelectClass}
          >
            <option value="">미지정</option>
            {PCT_RANGE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </FieldRow>
        <FieldRow label="변제금 감소율" labelClassName="w-[88px]" className="grid-cols-[88px_minmax(0,1fr)]">
          <Select
            value={counselPlan.paymentReductionRange ?? ""}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => patchCounselPlan({ paymentReductionRange: (e.target.value || undefined) as PctRange | undefined })}
            className={compactSelectClass}
          >
            <option value="">미지정</option>
            {PCT_RANGE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </FieldRow>
      </div>

      <FieldRow label="최근 3개월내 대출 사용처" labelClassName="text-[9px]">
        <textarea
          className={`${compactTextareaClass} min-h-11 flex-1`}
          value={recentLoanInsurance.recentLoanUsage ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchRecentLoanInsurance({ recentLoanUsage: e.target.value })}
        />
      </FieldRow>

      <FieldRow label="보험료 / 환급금액">
        <ManwonInput value={recentLoanInsurance.insurancePremium} onChange={(v) => patchRecentLoanInsurance({ insurancePremium: v })} />
        <span className="text-[10px] text-slate-400">/</span>
        <ManwonInput value={recentLoanInsurance.insuranceRefundAmount} onChange={(v) => patchRecentLoanInsurance({ insuranceRefundAmount: v })} />
      </FieldRow>

      <div className="p-1">
        <button
          type="button"
          onClick={() => setShowAuto((v) => !v)}
          className="flex h-7 w-full items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
        >
          법원 변제계획 자동계산 {showAuto ? "접기" : "펼치기"}
          <ChevronRight size={12} className={`transition-transform ${showAuto ? "rotate-90" : ""}`} />
        </button>
      </div>

      {showAuto && (
        <div className="grid grid-cols-2 gap-1 border-t border-slate-200 p-1 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="w-16 shrink-0 text-center font-semibold text-slate-500">가구원수</span>
            <NumberInput className="h-7 px-2 text-[11px] sm:h-7 sm:text-[11px]" min={1} value={plan.householdSize} onChange={(v) => patchPlan({ householdSize: v || 1, minLivingCost: lookupMinLivingCost(v || 1, minLivingCostTable) })} />
          </div>
          <div className="flex items-center gap-1">
            <span className="w-16 shrink-0 text-center font-semibold text-slate-500">최저생계비</span>
            <ManwonInput value={plan.minLivingCost} onChange={(v) => patchPlan({ minLivingCost: v })} />
          </div>
          <div className="rounded bg-blue-50 px-2 py-1 text-blue-700">최종 월 변제금: <b>{fmtWon(result.finalMonthlyRepayment)}</b></div>
          <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">탕감률: <b>{result.writeOffRate.toFixed(1)}%</b></div>
        </div>
      )}
    </SectionCard>
  );
}
