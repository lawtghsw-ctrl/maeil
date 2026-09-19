"use client";

import { isNextBlocked, type PeriodBounds, type PeriodMode } from "@/lib/period-engine";

const MODE_LABELS: Record<PeriodMode, string> = {
  year: "년",
  month: "월",
  week: "주",
  day: "일",
};

function formatRangeLabel(mode: PeriodMode, bounds: PeriodBounds): string {
  const s = bounds.start;
  const e = bounds.naturalEnd;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (mode === "year") return `${s.getFullYear()}년`;
  if (mode === "month") return `${s.getFullYear()}.${pad(s.getMonth() + 1)}`;
  if (mode === "week")
    return `${pad(s.getMonth() + 1)}.${pad(s.getDate())} - ${pad(e.getMonth() + 1)}.${pad(
      e.getDate()
    )}`;
  return `${s.getFullYear()}.${pad(s.getMonth() + 1)}.${pad(s.getDate())}`;
}

export function PeriodControl({
  mode,
  anchor,
  bounds,
  onModeChange,
  onShift,
}: {
  mode: PeriodMode;
  anchor: Date;
  bounds: PeriodBounds;
  onModeChange: (mode: PeriodMode) => void;
  onShift: (delta: 1 | -1) => void;
}) {
  const nextBlocked = isNextBlocked(mode, anchor);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-md2 border border-line bg-white p-0.5">
        {(Object.keys(MODE_LABELS) as PeriodMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`rounded-sm2 px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === m ? "bg-navy text-white" : "text-muted hover:text-ink"
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="이전 기간"
          onClick={() => onShift(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-md2 border border-line bg-white text-muted hover:text-ink"
        >
          ‹
        </button>
        <div className="min-w-[130px] text-center text-sm font-medium text-ink">
          {formatRangeLabel(mode, bounds)}
        </div>
        <button
          type="button"
          aria-label="다음 기간"
          disabled={nextBlocked}
          onClick={() => onShift(1)}
          className={`flex h-8 w-8 items-center justify-center rounded-md2 border border-line bg-white ${
            nextBlocked ? "cursor-not-allowed text-muted2/50" : "text-muted hover:text-ink"
          }`}
        >
          ›
        </button>
      </div>
    </div>
  );
}
