export interface RatioSegment {
  label: string;
  count: number;
  color: string;
}

// 가로 스택 비율 바 — 절차단계별 사건 수 분포, 분납 설정 비율 등에 공용으로 사용
export function StackedRatioBar({ segments }: { segments: RatioSegment[] }) {
  const total = segments.reduce((a, s) => a + s.count, 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-line">
        {segments.map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <div
              key={s.label}
              style={{ width: `${pct}%`, background: s.color }}
              title={`${s.label} ${s.count}건 (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {segments.map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0;
          return (
            <div key={s.label} className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="truncate text-muted">{s.label}</span>
              <span className="ml-auto shrink-0 font-medium text-ink">
                {s.count}건 · {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
