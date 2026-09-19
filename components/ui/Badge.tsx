import type { ReactNode } from "react";
import type { CaseStage, CaseStatus, CaseType, InstallmentStatus } from "@/lib/types";
import { CASE_STAGES, STAGE_LABELS } from "@/lib/types";

function ToneBadge({
  tone,
  children,
}: {
  tone: "navy" | "blue" | "gold" | "green" | "red" | "muted";
  children: ReactNode;
}) {
  const toneClass: Record<typeof tone, string> = {
    navy: "bg-navy-3 text-white",
    blue: "bg-brand-pale text-brand",
    gold: "bg-gold-tint text-gold",
    green: "bg-success-tint text-success",
    red: "bg-danger-tint text-danger",
    muted: "bg-line text-muted",
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm2 px-2 py-0.5 text-xs font-medium whitespace-nowrap ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

export function StageBadge({ stage, caseType }: { stage: CaseStage; caseType: CaseType }) {
  const idx = CASE_STAGES.indexOf(stage);
  const tone: "muted" | "blue" | "gold" | "green" =
    idx <= 1 ? "muted" : idx <= 5 ? "blue" : idx <= 7 ? "gold" : "green";
  return <ToneBadge tone={tone}>{STAGE_LABELS[caseType][stage]}</ToneBadge>;
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const toneMap: Record<CaseStatus, "blue" | "gold" | "red" | "green"> = {
    진행중: "blue",
    보류: "gold",
    취하: "red",
    종결: "green",
  };
  return <ToneBadge tone={toneMap[status]}>{status}</ToneBadge>;
}

export function InstallmentStatusBadge({ status }: { status: InstallmentStatus }) {
  const toneMap: Record<InstallmentStatus, "green" | "muted" | "gold" | "red"> = {
    완료: "green",
    예정: "muted",
    연체: "gold",
    실패: "red",
  };
  return <ToneBadge tone={toneMap[status]}>{status}</ToneBadge>;
}

export function CaseTypeBadge({ caseType }: { caseType: CaseType }) {
  return <ToneBadge tone={caseType === "개인회생" ? "blue" : "gold"}>{caseType}</ToneBadge>;
}
