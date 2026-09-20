// 도메인 전용 배지 — 공용 Badge(components/ui/Primitives)의 톤(gray/blue/green/red/amber)만
// 사용해 도원 Admin과 동일한 색상 체계를 유지합니다.
import type {
  CaseStage,
  CaseStatus,
  CaseType,
  DbLeadStatus,
  InstallmentStatus,
} from "@/lib/types";
import { CASE_STAGES, DB_LEAD_STATUS_LABEL, STAGE_LABELS } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/Primitives";

export function StageBadge({ stage, caseType }: { stage: CaseStage; caseType: CaseType }) {
  const idx = CASE_STAGES.indexOf(stage);
  const tone: BadgeTone = idx <= 1 ? "gray" : idx <= 5 ? "blue" : idx <= 7 ? "amber" : "green";
  return <Badge tone={tone}>{STAGE_LABELS[caseType][stage]}</Badge>;
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const toneMap: Record<CaseStatus, BadgeTone> = {
    진행중: "blue",
    보류: "amber",
    취하: "red",
    종결: "green",
  };
  return <Badge tone={toneMap[status]}>{status}</Badge>;
}

export function InstallmentStatusBadge({ status }: { status: InstallmentStatus }) {
  const toneMap: Record<InstallmentStatus, BadgeTone> = {
    완료: "green",
    예정: "gray",
    연체: "amber",
    실패: "red",
  };
  return <Badge tone={toneMap[status]}>{status}</Badge>;
}

export function CaseTypeBadge({ caseType }: { caseType: CaseType }) {
  return <Badge tone={caseType === "개인회생" ? "blue" : "amber"}>{caseType}</Badge>;
}

export function DbLeadStatusBadge({ status }: { status: DbLeadStatus }) {
  const toneMap: Record<DbLeadStatus, BadgeTone> = {
    신규접수: "blue",
    상담예정: "blue",
    상담완료: "amber",
    재통화필요: "red",
    고려중: "amber",
    서류검토중: "amber",
    계약진행중: "blue",
    수임전환: "green",
    부재중: "red",
    거절: "gray",
    부적합: "gray",
    종결_중단: "gray",
  };
  return <Badge tone={toneMap[status]}>{DB_LEAD_STATUS_LABEL[status]}</Badge>;
}
