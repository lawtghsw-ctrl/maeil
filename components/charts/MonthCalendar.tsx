"use client";

import { useMemo, useState } from "react";
import type { Installment } from "@/lib/types";
import { fmtMan } from "@/lib/format";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(
    2,
    "0"
  )}`;
}

interface DayCell {
  date: Date;
  iso: string;
  inMonth: boolean;
  isToday: boolean;
  dueAmount: number;
  dueCount: number;
  overdueCount: number;
}

// 분납(입금) 예정일을 월간 달력으로 보여주는 위젯 — 도원 어드민의 분납 캘린더를 참고해
// 날짜별 예정금액/건수, 연체 여부를 한눈에 볼 수 있게 구성.
export function MonthCalendar({ installments }: { installments: Installment[] }) {
  const [cursor, setCursor] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);

  const todayIso = isoOf(new Date());

  const byDate = useMemo(() => {
    const map = new Map<string, { amount: number; count: number; overdue: number }>();
    for (const ins of installments) {
      const cur = map.get(ins.dueDate) ?? { amount: 0, count: 0, overdue: 0 };
      cur.amount += ins.amount;
      cur.count += 1;
      if (ins.status === "연체" || ins.status === "실패") cur.overdue += 1;
      map.set(ins.dueDate, cur);
    }
    return map;
  }, [installments]);

  const cells: DayCell[] = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay(); // 0=일요일
    const gridStart = new Date(year, month, 1 - startOffset);

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const iso = isoOf(d);
      const agg = byDate.get(iso);
      return {
        date: d,
        iso,
        inMonth: d.getMonth() === month,
        isToday: iso === todayIso,
        dueAmount: agg?.amount ?? 0,
        dueCount: agg?.count ?? 0,
        overdueCount: agg?.overdue ?? 0,
      };
    });
  }, [cursor, byDate, todayIso]);

  const selectedCell = cells.find((c) => c.iso === selected);
  const selectedInstallments = selected
    ? installments.filter((i) => i.dueDate === selected).sort((a, b) => b.amount - a.amount)
    : [];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">
          {cursor.getFullYear()}년 {cursor.getMonth() + 1}월 분납 일정
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-md2 border border-line text-muted hover:text-ink"
          >
            ‹
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth(), 1))}
            className="rounded-md2 border border-line px-2 py-1 text-xs text-muted hover:text-ink"
          >
            오늘
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-md2 border border-line text-muted hover:text-ink"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted2">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => (
          <button
            key={cell.iso}
            onClick={() => setSelected(cell.dueCount > 0 ? cell.iso : null)}
            className={`flex h-16 flex-col items-start rounded-md2 border p-1.5 text-left text-[11px] ${
              cell.inMonth ? "bg-white" : "bg-bg text-muted2"
            } ${cell.isToday ? "border-brand" : "border-line"} ${
              selected === cell.iso ? "ring-2 ring-brand" : ""
            }`}
          >
            <span className={cell.isToday ? "font-bold text-brand" : cell.inMonth ? "text-ink" : "text-muted2"}>
              {cell.date.getDate()}
            </span>
            {cell.dueCount > 0 && (
              <span
                className={`mt-auto rounded-sm2 px-1 py-0.5 text-[10px] font-medium ${
                  cell.overdueCount > 0 ? "bg-danger-tint text-danger" : "bg-brand-pale text-brand"
                }`}
              >
                {fmtMan(cell.dueAmount)} · {cell.dueCount}건
              </span>
            )}
          </button>
        ))}
      </div>

      {selectedCell && selectedInstallments.length > 0 && (
        <div className="mt-3 rounded-md2 border border-line p-3">
          <div className="mb-2 text-xs font-semibold text-ink">
            {selectedCell.date.getMonth() + 1}월 {selectedCell.date.getDate()}일 분납 예정{" "}
            {selectedInstallments.length}건
          </div>
          <ul className="space-y-1 text-xs text-muted">
            {selectedInstallments.slice(0, 6).map((ins) => (
              <li key={ins.id} className="flex justify-between">
                <span>
                  {ins.caseId} · {ins.seq === 1 ? "계약금" : `${ins.seq - 1}회차`}
                </span>
                <span className="font-medium text-ink">{fmtMan(ins.amount)}</span>
              </li>
            ))}
            {selectedInstallments.length > 6 && (
              <li className="text-muted2">외 {selectedInstallments.length - 6}건</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
