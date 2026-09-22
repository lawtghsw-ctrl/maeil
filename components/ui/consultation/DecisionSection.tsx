"use client";

// 상담일지 우측 "의사" 섹션 — 사용자가 지정한 세 줄만 노출합니다. 구 판단메모 필드는
// 데이터 호환을 위해 타입에 남겨두되 이번 고밀도 화면에서는 숨깁니다.
import type { ConsultationJudgment } from "@/lib/types";
import { DenseRow, OXToggle, SectionCard, WonInput } from "./shared";

export function DecisionSection({
  judgment,
  patchJudgment,
}: {
  judgment: ConsultationJudgment;
  patchJudgment: (p: Partial<ConsultationJudgment>) => void;
}) {
  return (
    <SectionCard title="의사">
      <DenseRow label="추후 워크아웃 가능 여부" labelWidth="120px">
        <OXToggle value={judgment.workoutFeasible} onChange={(v) => patchJudgment({ workoutFeasible: v })} />
        <span className="ml-auto shrink-0 border-l border-slate-200 pl-2 text-[11px] font-semibold text-slate-600">안내여부</span>
        <OXToggle value={judgment.workoutGuided} onChange={(v) => patchJudgment({ workoutGuided: v })} />
      </DenseRow>
      <DenseRow label="부채발급비용, 송달료, 인지대 안내여부" labelWidth="145px">
        <OXToggle value={judgment.costGuided} onChange={(v) => patchJudgment({ costGuided: v })} />
        <span className="ml-auto shrink-0 border-l border-slate-200 pl-2 text-[11px] font-semibold text-slate-600">금액</span>
        <WonInput value={judgment.workoutAmount} onChange={(v) => patchJudgment({ workoutAmount: v })} className="max-w-[145px]" />
      </DenseRow>
      <DenseRow label="워크아웃 진행여부" labelWidth="120px">
        <OXToggle value={judgment.workoutInProgress} onChange={(v) => patchJudgment({ workoutInProgress: v })} />
      </DenseRow>
    </SectionCard>
  );
}
