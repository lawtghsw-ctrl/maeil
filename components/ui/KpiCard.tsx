import { deltaClass, fmtDeltaPct } from "@/lib/format";
import { Card } from "@/components/ui/Primitives";

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
    <Card className="p-4 sm:p-5">
      <div className="mb-2 text-xs text-slate-500 sm:text-sm">{label}</div>
      <div className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{value}</div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {typeof deltaPct === "number" && (
          <span className={`font-medium ${deltaClass(deltaPct, invert)}`}>{fmtDeltaPct(deltaPct)}</span>
        )}
        {sublabel && <span className="text-slate-400">{sublabel}</span>}
      </div>
    </Card>
  );
}
