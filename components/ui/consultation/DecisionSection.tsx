"use client";

// 우측 상단 "의사" 영역. 참고 이미지처럼 모든 판단 행의 라벨/선택칸 시작 위치를
// 동일하게 맞춰 시선이 흔들리지 않도록 했습니다. 긴 라벨도 줄바꿈하지 않고 한 줄로
// 보이도록 고정 폭을 주고, 글씨는 기존보다 살짝 키웠습니다.
import type { ConsultationJudgment } from "@/lib/types";
import { OXToggle, SectionCard, WonInput } from "./shared";

const LABEL_CLASS =
  "flex min-w-0 items-center justify-center whitespace-nowrap border-r border-slate-200 bg-slate-50 px-1.5 text-center text-[10.5px] font-bold text-slate-600";
const CONTROL_CLASS = "flex min-w-0 items-center p-1";

export function DecisionSection({
  judgment,
  patchJudgment,
}: {
  judgment: ConsultationJudgment;
  patchJudgment: (p: Partial<ConsultationJudgment>) => void;
}) {
  return (
    <SectionCard title="의사" className="shrink-0">
      <div className="grid min-h-9 grid-cols-[180px_76px_88px_minmax(0,1fr)] border-b border-slate-200">
        <div className={LABEL_CLASS}>추후 워크아웃 가능 여부</div>
        <div className={`${CONTROL_CLASS} border-r border-slate-200`}>
          <OXToggle value={judgment.workoutFeasible} onChange={(v) => patchJudgment({ workoutFeasible: v })} />
        </div>
        <div className={LABEL_CLASS}>안내여부</div>
        <div className={CONTROL_CLASS}>
          <OXToggle value={judgment.workoutGuided} onChange={(v) => patchJudgment({ workoutGuided: v })} />
        </div>
      </div>

      <div className="grid min-h-9 grid-cols-[180px_76px_88px_minmax(0,1fr)] border-b border-slate-200">
        <div className={LABEL_CLASS}>부채발급비용, 송달료, 인지대 안내여부</div>
        <div className={`${CONTROL_CLASS} border-r border-slate-200`}>
          <OXToggle value={judgment.costGuided} onChange={(v) => patchJudgment({ costGuided: v })} />
        </div>
        <div className={LABEL_CLASS}>금액</div>
        <div className={CONTROL_CLASS}>
          <WonInput value={judgment.workoutAmount} onChange={(v) => patchJudgment({ workoutAmount: v })} />
        </div>
      </div>

      <div className="grid min-h-9 grid-cols-[180px_76px_minmax(0,1fr)]">
        <div className={LABEL_CLASS}>워크아웃 진행여부</div>
        <div className={`${CONTROL_CLASS} border-r border-slate-200`}>
          <OXToggle value={judgment.workoutInProgress} onChange={(v) => patchJudgment({ workoutInProgress: v })} />
        </div>
        <div className="bg-white" />
      </div>
    </SectionCard>
  );
}
