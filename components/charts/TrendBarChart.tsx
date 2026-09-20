"use client";

import { useState } from "react";

export interface TrendBucket {
  label: string;
  range?: string;
  a: number;
  b: number;
}

// 그룹형 막대 차트 — SVG path 연산 없이 순수 div 높이(%)로 구현해 안정성을 우선함.
// (로피 comboChart의 막대 부분과 동등한 정보를 전달하되, 곡선/툴팁 좌표계산 리스크를 제거)
export function TrendBarChart({
  buckets,
  labelA,
  labelB,
  colorA = "#d97706",
  colorB = "#2563eb",
  valueFmt,
  height = 180,
}: {
  buckets: TrendBucket[];
  labelA: string;
  labelB: string;
  colorA?: string;
  colorB?: string;
  valueFmt: (v: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.flatMap((b) => [b.a, b.b]));

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: colorA }} />
          {labelA}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: colorB }} />
          {labelB}
        </span>
      </div>
      <div
        className="flex items-end gap-3 overflow-x-auto pb-1"
        style={{ height }}
      >
        {buckets.map((b, i) => (
          <div
            key={i}
            className="relative flex min-w-[46px] flex-1 flex-col items-center justify-end gap-1"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((v) => (v === i ? null : v))}
          >
            {hover === i && (
              <div className="absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white shadow-xl">
                <div className="font-semibold">{b.range ?? b.label}</div>
                <div>
                  {labelA} {valueFmt(b.a)}
                </div>
                <div>
                  {labelB} {valueFmt(b.b)}
                </div>
              </div>
            )}
            <div className="flex h-full items-end gap-1">
              <div
                className="w-3.5 rounded-t-md sm:w-4"
                style={{
                  height: `${Math.max(2, (b.a / max) * 100)}%`,
                  background: colorA,
                }}
              />
              <div
                className="w-3.5 rounded-t-md sm:w-4"
                style={{
                  height: `${Math.max(2, (b.b / max) * 100)}%`,
                  background: colorB,
                }}
              />
            </div>
            <div className="text-[11px] text-slate-400 whitespace-nowrap">{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
