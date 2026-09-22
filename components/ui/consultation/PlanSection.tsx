"use client";

// 상담일지 대형 팝업 — "플랜" 섹션. v13 레이아웃 정밀개편 요청에 따라:
// 1) 원금탕감율/변제금감소율을 숫자 직접입력 대신 구간 드롭다운(10~20%~90~100%)으로 변경.
// 2) 최근대출/보험(구 RecentLoanInsuranceSection) 두 줄을 별도 "바" 없이 이 섹션 안에
//    이어붙였습니다(요청 원문에서 플랜 항목 바로 아래에 이어져 있고 별도 구분 바가
//    없었기 때문 — 값 자체는 기존 ConsultationRecentLoanInsurance 필드 그대로 재사용).
// 아래 "법원 변제계획 자동계산"(RepaymentPlanInput/computeRepaymentPlan)은 기존 그대로
// 접어서 유지합니다(계산식 변경 없음).
import { useState, type ChangeEvent } from "react";
import { useStore } from "@/lib/store";
import type { ConsultationCounselPlan, ConsultationRecentLoanInsurance, PctRange, RepaymentPlanInput } from "@/lib/types";
import { PCT_RANGE_OPTIONS } from "@/lib/types";
import { lookupMinLivingCost, type RepaymentPlanResult } from "@/lib/consultation";
import { NumberInput, Label, Select, Input } from "@/components/ui/Primitives";
import { ManwonInput, SectionCard, compactTextareaClass } from "./shared";
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
}: {
  counselPlan: ConsultationCounselPlan;
  patchCounselPlan: (p: Partial<ConsultationCounselPlan>) => void;
  plan: RepaymentPlanInput;
  patchPlan: (p: Partial<RepaymentPlanInput>) => void;
  result: RepaymentPlanResult;
  recentLoanInsurance: ConsultationRecentLoanInsurance;
  patchRecentLoanInsurance: (p: Partial<ConsultationRecentLoanInsurance>) => void;
}) {
  const { minLivingCostTable } = useStore();
  const [showAuto, setShowAuto] = useState(false);

  return (
    <SectionCard title="플랜">
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
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <Label text="원금 탕감율">
          <Select
            value={counselPlan.principalReductionRange ?? ""}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => patchCounselPlan({ principalReductionRange: (e.target.value || undefined) as PctRange | undefined })}
            className="w-full"
          >
            <option value="">미지정</option>
            {PCT_RANGE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Label>
        <Label text="변제금 감소율">
          <Select
            value={counselPlan.paymentReductionRange ?? ""}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => patchCounselPlan({ paymentReductionRange: (e.target.value || undefined) as PctRange | undefined })}
            className="w-full"
          >
            <option value="">미지정</option>
            {PCT_RANGE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Label>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
        <Label text="최근 3개월 내 대출 사용처">
          <Input
            value={recentLoanInsurance.recentLoanUsage ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchRecentLoanInsurance({ recentLoanUsage: e.target.value })}
            placeholder="예: OO캐피탈 300만원(2026-08)"
          />
        </Label>
        <Label text="보험료 / 환급금액">
          <div className="flex items-center gap-1.5">
            <ManwonInput value={recentLoanInsurance.insurancePremium} onChange={(v) => patchRecentLoanInsurance({ insurancePremium: v })} />
            <span className="shrink-0 text-slate-300">/</span>
            <ManwonInput value={recentLoanInsurance.insuranceRefundAmount} onChange={(v) => patchRecentLoanInsurance({ insuranceRefundAmount: v })} />
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
