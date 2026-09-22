"use client";

import type { ConsultationJudgment } from "@/lib/types";
import { FieldRow, OXToggle, SectionCard, WonInput } from "./shared";

export function DecisionSection({
  judgment,
  patchJudgment,
}: {
  judgment: ConsultationJudgment;
  patchJudgment: (p: Partial<ConsultationJudgment>) => void;
}) {
  return (
    <SectionCard title="의사" className="shrink-0">
      <div className="grid grid-cols-2">
        <FieldRow label="추후 워크아웃 가능 여부" labelClassName="w-[126px] text-[9px]" className="grid-cols-[126px_minmax(0,1fr)] border-r">
          <OXToggle value={judgment.workoutFeasible} onChange={(v) => patchJudgment({ workoutFeasible: v })} />
        </FieldRow>
        <FieldRow label="안내여부" labelClassName="w-[72px]" className="grid-cols-[72px_minmax(0,1fr)]">
          <OXToggle value={judgment.workoutGuided} onChange={(v) => patchJudgment({ workoutGuided: v })} />
        </FieldRow>
      </div>

      <div className="grid grid-cols-[1.45fr_1fr]">
        <FieldRow label="부채발급비용, 송달료, 인지대 안내여부" labelClassName="w-[155px] text-[8px]" className="grid-cols-[155px_minmax(0,1fr)] border-r">
          <OXToggle value={judgment.costGuided} onChange={(v) => patchJudgment({ costGuided: v })} />
        </FieldRow>
        <FieldRow label="금액" labelClassName="w-[52px]" className="grid-cols-[52px_minmax(0,1fr)]">
          <WonInput value={judgment.workoutAmount} onChange={(v) => patchJudgment({ workoutAmount: v })} />
        </FieldRow>
      </div>

      <FieldRow label="워크아웃 진행여부">
        <OXToggle value={judgment.workoutInProgress} onChange={(v) => patchJudgment({ workoutInProgress: v })} />
      </FieldRow>
    </SectionCard>
  );
}
