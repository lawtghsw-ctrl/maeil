"use client";

// 상담일지 대형 팝업 — "의사/상담판단" 섹션(신규, ConsultationJudgment). 상담자가 빠르게
// 판단해 기록하는 항목이라 필수값으로 두지는 않았습니다(참고 이미지에도 필수 표시 없음).
import type { ChangeEvent } from "react";
import type { ConsultationJudgment } from "@/lib/types";
import { Label } from "@/components/ui/Primitives";
import { ManwonInput, OXToggle, SectionCard, compactTextareaClass } from "./shared";

export function DecisionSection({
  judgment,
  patchJudgment,
}: {
  judgment: ConsultationJudgment;
  patchJudgment: (p: Partial<ConsultationJudgment>) => void;
}) {
  return (
    <SectionCard title="의사 / 상담판단">
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
        <Label text="추후 워크아웃 가능 여부">
          <OXToggle value={judgment.workoutFeasible} onChange={(v) => patchJudgment({ workoutFeasible: v })} />
        </Label>
        <Label text="안내 여부">
          <OXToggle value={judgment.workoutGuided} onChange={(v) => patchJudgment({ workoutGuided: v })} />
        </Label>
        <Label text="부채발급비용/송달료/인지대 안내">
          <OXToggle value={judgment.costGuided} onChange={(v) => patchJudgment({ costGuided: v })} />
        </Label>
        <Label text="워크아웃 진행 여부">
          <OXToggle value={judgment.workoutInProgress} onChange={(v) => patchJudgment({ workoutInProgress: v })} />
        </Label>
      </div>
      <Label text="금액">
        <ManwonInput value={judgment.workoutAmount} onChange={(v) => patchJudgment({ workoutAmount: v })} />
      </Label>
      <Label text="판단 관련 메모">
        <textarea
          className={compactTextareaClass}
          value={judgment.judgmentNote ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchJudgment({ judgmentNote: e.target.value })}
        />
      </Label>
    </SectionCard>
  );
}
