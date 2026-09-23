"use client";

import { useEffect, type ChangeEvent } from "react";
import { useStore } from "@/lib/store";
import type { ConsultationCounselPlan, ConsultationRecentLoanInsurance, PctRange, RepaymentPlanInput } from "@/lib/types";
import { PCT_RANGE_OPTIONS } from "@/lib/types";
import { lookupMinLivingCost, MIN_LIVING_COST_HOUSEHOLD_SIZES, type RepaymentPlanResult } from "@/lib/consultation";
import { Select } from "@/components/ui/Primitives";
import { ReservationDateTimeEditor } from "@/components/ui/ReservationDateTimeEditor";
import {
  FieldRow,
  ManwonInput,
  SectionCard,
  compactSelectClass,
  compactTextareaClass,
  OXToggle,
  SectionBar,
} from "./shared";
import { fmtWon } from "@/lib/format";

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
  reservationChoice,
  reservationAt,
  onReservationChoiceChange,
  onReservationAtChange,
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
  reservationChoice?: boolean;
  reservationAt?: string;
  onReservationChoiceChange?: (value: boolean | undefined) => void;
  onReservationAtChange?: (value: string | undefined) => void;
}) {
  const { minLivingCostTable } = useStore();
  const required = (key: string) => requiredKeys.has(key);
  const missing = (key: string) => missingKeys.has(key);

  // 기존 데이터에 가구원수만 있고 최저생계비가 비어 있거나 예전 값인 경우에도
  // 상담일지를 열면 현재 운영표 기준값으로 즉시 동기화합니다.
  useEffect(() => {
    const autoCost = lookupMinLivingCost(plan.householdSize || 1, minLivingCostTable);
    if (autoCost > 0 && plan.minLivingCost !== autoCost) {
      patchPlan({ minLivingCost: autoCost });
    }
  }, [plan.householdSize, plan.minLivingCost, minLivingCostTable, patchPlan]);

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

      {/* 접기/펼치기 없이 상담자가 항상 결과를 보도록 상시 노출합니다. */}
      <div className="border-t border-slate-200">
        <div className="select-none border-b border-slate-200 bg-slate-100 px-2 py-1 text-center text-[10px] font-extrabold text-slate-600">
          법원 변제계획 자동계산
        </div>
        <div className="space-y-1 p-1 text-[10px]">
          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-1">
            <span className="text-center font-semibold text-slate-500">가구원수</span>
            <div className="grid grid-cols-6 gap-1">
              {MIN_LIVING_COST_HOUSEHOLD_SIZES.map((size) => {
                const selected = Number(plan.householdSize) === Number(size);
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => patchPlan({ householdSize: size, minLivingCost: lookupMinLivingCost(size, minLivingCostTable) })}
                    className={`h-7 whitespace-nowrap rounded border px-1 text-[10px] font-bold transition ${
                      selected
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {size}인
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-1">
            <span className="text-center font-semibold text-slate-500">최저생계비</span>
            <div className="h-7 rounded border border-slate-200 bg-slate-50 px-2 leading-7 font-bold text-slate-700">
              {fmtWon(plan.minLivingCost || lookupMinLivingCost(plan.householdSize || 1, minLivingCostTable))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1">
            <div className="rounded bg-blue-50 px-2 py-1.5 text-blue-700">
              최종 월 변제금: <b>{fmtWon(result.finalMonthlyRepayment)}</b>
            </div>
            <div className="rounded bg-emerald-50 px-2 py-1.5 text-emerald-700">
              예상 탕감률: <b>{result.writeOffRate.toFixed(1)}%</b>
            </div>
          </div>
        </div>
      </div>

      {onReservationChoiceChange && onReservationAtChange && (
        <div className="border-t border-slate-200">
          <SectionBar label="예약 일정 등록" />
          <FieldRow label="예약" contentClassName="flex-wrap sm:flex-nowrap">
            <OXToggle value={reservationChoice} onChange={onReservationChoiceChange} />
            {reservationChoice === true && (
              <div className="min-w-0 flex-1">
                <ReservationDateTimeEditor value={reservationAt} onChange={onReservationAtChange} />
              </div>
            )}
            {reservationChoice !== true && (
              <span className="text-[10px] text-slate-400">O 선택 시 예약 날짜와 시간을 지정할 수 있습니다.</span>
            )}
          </FieldRow>
        </div>
      )}
    </SectionCard>
  );
}
