import { fmtEokMan } from "@/lib/format";

export interface DonutSegment {
  label: string;
  value: number;
  color: string; // hex
}

export function DonutChart({
  segments,
  centerLabel,
}: {
  segments: DonutSegment[];
  centerLabel: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  let cursor = 0;
  const stops: string[] = [];
  for (const s of segments) {
    const startPct = total > 0 ? (cursor / total) * 100 : 0;
    cursor += s.value;
    const endPct = total > 0 ? (cursor / total) * 100 : 0;
    stops.push(`${s.color} ${startPct}% ${endPct}%`);
  }
  const gradient =
    stops.length > 0 ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#e2e8f0 0% 100%)";

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div
        className="relative h-44 w-44 shrink-0 rounded-full"
        style={{ background: gradient }}
      >
        <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-[0_1px_2px_rgba(15,23,42,.08)]">
          <div className="text-[11px] text-slate-500">합계</div>
          <div className="text-base font-semibold text-slate-900">{centerLabel}</div>
        </div>
      </div>
      <div className="w-full space-y-2">
        {segments.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          return (
            <div key={s.label} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-slate-900">{s.label}</span>
              <span className="ml-auto text-slate-400">{pct.toFixed(0)}%</span>
              <span className="w-24 text-right font-medium text-slate-900">
                {fmtEokMan(s.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
