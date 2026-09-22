"use client";

// 상담일지 대형 팝업 — "의사" 섹션(ConsultationJudgment). v13 레이아웃 정밀개편 요청의
// 필드 순서(추후 워크아웃 가능여부/안내여부 한 줄 → 부채발급비용 등 안내여부+금액 한 줄
// → 워크아웃 진행여부)에 맞춰 재배치했습니다. 값 자체(judgment.*)는 기존 그대로입니다.
import type { ChangeEvent } from "react";
import type { ConsultationJudgment } from "@/lib/types";
import { Label } from "@/components/ui/Primitives";
import { ManwonInput, OXToggle, SectionCard } from "./shared";

export function DecisionSection({
  judgment,
  patchJudgment,
}: {
  judgment: ConsultationJudgment;
  patchJudgment: (p: Partial<ConsultationJudgment>) => void;
}) {
  return (
    <SectionCard title="의사">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <Label text="추후 워크아웃 가능 여부">
          <OXToggle value={judgment.workoutFeasible} onChange={(v) => patchJudgment({ workoutFeasible: v })} />
        </Label>
        <Label text="안내 여부">
          <OXToggle value={judgment.workoutGuided} onChange={(v) => patchJudgment({ workoutGuided: v })} />
        </Label>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
        <Label text="부채발급비용/송달료/인지대 안내여부">
          <OXToggle value={judgment.costGuided} onChange={(v) => patchJudgment({ costGuided: v })} />
        </Label>
        <Label text="금액">
          <ManwonInput value={judgment.workoutAmount} onChange={(v) => patchJudgment({ workoutAmount: v })} />
        </Label>
      </div>
      <Label text="워크아웃 진행 여부">
        <OXToggle value={judgment.workoutInProgress} onChange={(v) => patchJudgment({ workoutInProgress: v })} />
      </Label>
      <Label text="판단 관련 메모">
        <textarea
          className="min-h-14 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          value={judgment.judgmentNote ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchJudgment({ judgmentNote: e.target.value })}
        />
      </Label>
    </SectionCard>
  );
}
