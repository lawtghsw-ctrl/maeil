import { deltaClass, fmtDeltaPct } from "@/lib/format";

export function KpiCard({
  label,
  value,
  sublabel,
  deltaPct,
  invert,
}: {
  label: string;
  value: string;
  sublabel?: string;
  deltaPct?: number;
  invert?: boolean;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="text-xs sm:text-sm text-muted mb-2">{label}</div>
      <div className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {typeof deltaPct === "number" && (
          <span className={`font-medium ${deltaClass(deltaPct, invert)}`}>
            {fmtDeltaPct(deltaPct)}
          </span>
        )}
        {sublabel && <span className="text-muted2">{sublabel}</span>}
      </div>
    </div>
  );
}

export function StatChip({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md2 bg-brand-pale text-base">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted truncate">{label}</div>
        <div className="text-sm font-semibold text-ink truncate">{value}</div>
      </div>
    </div>
  );
}
