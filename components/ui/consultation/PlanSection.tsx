"use client";

// 상담일지 우측 "플랜". 최종 요청에 없는 법원 자동계산 패널은 데이터/계산 로직은 그대로
// 유지하되 화면에서 숨겨, 참고 이미지처럼 플랜 + 최근대출/보험만 한눈에 보이도록 구성합니다.
import type { ChangeEvent } from "react";
import type {
  ConsultationCounselPlan,
  ConsultationRecentLoanInsurance,
  PctRange,
  RepaymentPlanInput,
} from "@/lib/types";
import { PCT_RANGE_OPTIONS } from "@/lib/types";
import type { RepaymentPlanResult } from "@/lib/consultation";
import { DenseRow, SectionCard, denseInputClass, denseSelectClass, denseTextareaClass } from "./shared";

export function PlanSection({
  counselPlan,
  patchCounselPlan,
  plan: _plan,
  patchPlan: _patchPlan,
  result: _result,
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
  return (
    <SectionCard title="플랜">
      <DenseRow label="회생 예상플랜" contentClassName="py-1">
        <textarea
          className={denseTextareaClass}
          value={counselPlan.rehabPlanNote ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchCounselPlan({ rehabPlanNote: e.target.value })}
        />
      </DenseRow>
      <DenseRow label="회복 예상플랜" contentClassName="py-1">
        <textarea
          className={denseTextareaClass}
          value={counselPlan.recoveryPlanNote ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchCounselPlan({ recoveryPlanNote: e.target.value })}
        />
      </DenseRow>
      <DenseRow label="원금 탕감율">
        <select
          className={`${denseSelectClass} min-w-[120px] flex-1`}
          value={counselPlan.principalReductionRange ?? ""}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            patchCounselPlan({ principalReductionRange: (e.target.value || undefined) as PctRange | undefined })
          }
        >
          <option value="">미지정</option>
          {PCT_RANGE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <span className="ml-auto shrink-0 border-l border-slate-200 pl-2 text-[11px] font-semibold text-slate-600">변제금 감소율</span>
        <select
          className={`${denseSelectClass} min-w-[120px] flex-1`}
          value={counselPlan.paymentReductionRange ?? ""}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            patchCounselPlan({ paymentReductionRange: (e.target.value || undefined) as PctRange | undefined })
          }
        >
          <option value="">미지정</option>
          {PCT_RANGE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </DenseRow>
      <DenseRow label="최근 3개월내 대출 사용처" labelWidth="118px" contentClassName="py-1">
        <textarea
          className={denseTextareaClass}
          value={recentLoanInsurance.recentLoanUsage ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchRecentLoanInsurance({ recentLoanUsage: e.target.value })}
        />
      </DenseRow>
      <DenseRow label="보험료 / 환급금액" labelWidth="118px" contentClassName="py-1">
        <textarea
          className={denseTextareaClass}
          value={
            recentLoanInsurance.insuranceNote ??
            (recentLoanInsurance.insurancePremium || recentLoanInsurance.insuranceRefundAmount
              ? `${Math.round((recentLoanInsurance.insurancePremium ?? 0) / 10000)}만원 / ${Math.round((recentLoanInsurance.insuranceRefundAmount ?? 0) / 10000)}만원`
              : "")
          }
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchRecentLoanInsurance({ insuranceNote: e.target.value })}
          placeholder="보험료 / 환급금액 및 보험 관련 메모"
        />
      </DenseRow>
    </SectionCard>
  );
}
