"use client";

// 상담일지 대형 팝업 — "최근 대출 / 보험" 섹션(신규, ConsultationRecentLoanInsurance).
import type { ChangeEvent } from "react";
import type { ConsultationRecentLoanInsurance } from "@/lib/types";
import { Label } from "@/components/ui/Primitives";
import { ManwonInput, SectionCard, compactTextareaClass } from "./shared";

export function RecentLoanInsuranceSection({
  value,
  patch,
}: {
  value: ConsultationRecentLoanInsurance;
  patch: (p: Partial<ConsultationRecentLoanInsurance>) => void;
}) {
  return (
    <SectionCard title="최근 대출 / 보험">
      <Label text="최근 3개월 내 대출 사용처">
        <textarea
          className={compactTextareaClass}
          value={value.recentLoanUsage ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patch({ recentLoanUsage: e.target.value })}
          placeholder="예: 생활비 부족으로 OO캐피탈 300만원 대출(2026-08)"
        />
      </Label>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
        <Label text="보험료">
          <ManwonInput value={value.insurancePremium} onChange={(v) => patch({ insurancePremium: v })} />
        </Label>
        <Label text="환급금액">
          <ManwonInput value={value.insuranceRefundAmount} onChange={(v) => patch({ insuranceRefundAmount: v })} />
        </Label>
      </div>
      <Label text="보험 관련 메모">
        <textarea className={compactTextareaClass} value={value.insuranceNote ?? ""} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patch({ insuranceNote: e.target.value })} />
      </Label>
    </SectionCard>
  );
}
