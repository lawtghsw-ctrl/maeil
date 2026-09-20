"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { ddayLabel, fmtDate } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";

type RangeFilter = "임박(7일)" | "이번달" | "전체";
const RANGE_FILTERS: RangeFilter[] = ["임박(7일)", "이번달", "전체"];

export default function SchedulePage() {
  const { cases, clients, scheduleItems } = useStore();
  const [range, setRange] = useState<RangeFilter>("임박(7일)");

  const rows = useMemo(() => {
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return scheduleItems
      .map((s) => {
        const c = s.caseId ? cases.find((x) => x.id === s.caseId) : undefined;
        const client = c ? clients.find((cl) => cl.id === c.clientId) : undefined;
        const d = new Date(s.date + "T00:00:00");
        const diffDays = Math.round((d.getTime() - t0.getTime()) / 86400000);
        return { s, c, client, diffDays };
      })
      .filter((row) => {
        if (range === "임박(7일)") return row.diffDays >= -1 && row.diffDays <= 7;
        if (range === "이번달")
          return (
            new Date(row.s.date + "T00:00:00").getMonth() === today.getMonth() &&
            new Date(row.s.date + "T00:00:00").getFullYear() === today.getFullYear()
          );
        return true;
      })
      .sort((a, b) => (a.s.date < b.s.date ? -1 : 1));
  }, [cases, clients, scheduleItems, range]);

  return (
    <>
      <PageHeader title="일정관리" description="법원기일 · 서류제출기한 · 상담예약" />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-2">
          {RANGE_FILTERS.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${range === r ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </Card>

      <Card className="divide-y divide-slate-100 p-0">
        {rows.map(({ s, c, client, diffDays }) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${diffDays <= 3 ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
              {ddayLabel(s.date)}
            </span>
            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{s.type}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-900">
                {client?.name ?? "-"}님 · {s.title}
              </div>
              <div className="truncate text-xs text-slate-500">
                {fmtDate(s.date)} {c ? `· ${c.caseNumber}` : ""}
              </div>
            </div>
            {c && (
              <Link href={`/cases/${c.id}`} className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                사건보기
              </Link>
            )}
          </div>
        ))}
        {rows.length === 0 && <div className="py-10 text-center text-sm text-slate-400">해당 조건의 일정이 없습니다.</div>}
      </Card>
    </>
  );
}
