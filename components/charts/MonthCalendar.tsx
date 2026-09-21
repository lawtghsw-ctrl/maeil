"use client";

// 도원 Admin(tg_m) app/(admin)/page.tsx의 MonthCalendar를 그대로 이식한 월간 일정 캘린더.
// 날짜 칸에 마우스를 올리면 미리보기, 클릭하면 고정(pin) 팝업으로 해당 날짜의 항목을 보여줍니다.
import { useState, type ChangeEvent, type MouseEvent } from "react";
import { CalendarDays } from "lucide-react";
import { Card } from "@/components/ui/Primitives";
import { fmtWon } from "@/lib/format";

function today(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate()
  ).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface CalendarItem {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  sub: string;
  done: boolean;
  status?: string;
  amount: number;
  duplicateTag?: string;
}

interface DayPreview {
  date: string;
  rows: CalendarItem[];
  top: number;
  left: number;
}

export function MonthCalendar({
  title,
  month,
  onMonthChange,
  items,
  tone,
  summary,
}: {
  title: string;
  month: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  items: CalendarItem[];
  tone: "blue" | "amber" | "violet";
  summary?: { paid: number; expected: number; total: number };
}) {
  const [yy, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const firstDay = new Date(yy, mm - 1, 1).getDay();
  const days = [
    ...Array(firstDay).fill(""),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  const [hovered, setHovered] = useState<DayPreview | null>(null);
  const [pinned, setPinned] = useState<DayPreview | null>(null);

  function previewPosition(e: MouseEvent<HTMLDivElement>, date: string, rows: CalendarItem[]): DayPreview {
    const rect = e.currentTarget.getBoundingClientRect();
    const popupWidth = 280;
    const popupHeight = 258;
    const gap = 8;
    let left = rect.right + gap;
    if (typeof window !== "undefined" && left + popupWidth > window.innerWidth - 10) {
      left = Math.max(10, rect.left - popupWidth - gap);
    }
    let top = rect.top;
    if (typeof window !== "undefined" && top + popupHeight > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - popupHeight - 10);
    }
    return { date, rows, top, left };
  }
  function showDay(e: MouseEvent<HTMLDivElement>, date: string, rows: CalendarItem[]) {
    if (pinned || !rows.length) return;
    setHovered(previewPosition(e, date, rows));
  }
  function pinDay(e: MouseEvent<HTMLDivElement>, date: string, rows: CalendarItem[]) {
    if (!rows.length) return;
    e.stopPropagation();
    setHovered(null);
    setPinned(previewPosition(e, date, rows));
  }
  const active = pinned || hovered;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold">{title}</h3>
              <p className="mt-1 text-xs text-slate-500">{month} 일정</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={yy}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onMonthChange(`${e.target.value}-${String(mm).padStart(2, "0")}`)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
              >
                {Array.from({ length: 11 }, (_, i) => yy - 5 + i).map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
              <select
                value={mm}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onMonthChange(`${yy}-${String(Number(e.target.value)).padStart(2, "0")}`)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onMonthChange(shiftMonth(month, -1))}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                이전달
              </button>
              <button
                type="button"
                onClick={() => onMonthChange(today().slice(0, 7))}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                이번달
              </button>
              <button
                type="button"
                onClick={() => onMonthChange(shiftMonth(month, 1))}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                다음달
              </button>
              <span className="grid h-8 w-9 place-items-center rounded-lg border border-slate-200 bg-white">
                <CalendarDays
                  size={17}
                  className={tone === "blue" ? "text-blue-600" : tone === "amber" ? "text-amber-600" : "text-violet-600"}
                />
              </span>
            </div>
          </div>
          {summary && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                <div className="text-[11px] font-semibold text-emerald-700">해당 달 총 입금액</div>
                <div className="mt-1 text-lg font-bold text-emerald-900">{fmtWon(summary.paid)}</div>
                <div className="mt-0.5 text-[10px] text-emerald-700/80">계약금 + 분납 실입금</div>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                <div className="text-[11px] font-semibold text-blue-700">받을 예정 금액</div>
                <div className="mt-1 text-lg font-bold text-blue-900">{fmtWon(summary.expected)}</div>
                <div className="mt-0.5 text-[10px] text-blue-700/80">아직 받지 못한 분납 예정액</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold text-slate-600">합산 금액</div>
                <div className="mt-1 text-lg font-bold text-slate-900">{fmtWon(summary.total)}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">총 입금액 + 받을 예정 금액</div>
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
          {["일", "월", "화", "수", "목", "금", "토"].map((x) => (
            <div key={x} className="p-2 text-center text-xs font-semibold text-slate-500">
              {x}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const rows = d ? items.filter((x) => x.date === d) : [];
            return (
              <div
                key={`${d}-${i}`}
                onMouseEnter={(e: MouseEvent<HTMLDivElement>) => d && showDay(e, d, rows)}
                onMouseLeave={() => {
                  if (!pinned) setHovered(null);
                }}
                onClick={(e: MouseEvent<HTMLDivElement>) => d && pinDay(e, d, rows)}
                className={`min-h-[96px] border-b border-r border-slate-100 p-1.5 sm:min-h-[112px] sm:p-2 ${
                  rows.length ? "cursor-pointer hover:bg-slate-50/80" : ""
                }`}
              >
                {d && (
                  <>
                    <div className="text-xs font-bold text-slate-600">{Number(d.slice(-2))}</div>
                    <div className="mt-1.5 space-y-1.5">
                      {rows.slice(0, 3).map((x) => {
                        const rowClass = x.done
                          ? "bg-slate-200 text-slate-500 opacity-75"
                          : tone === "blue"
                          ? "bg-blue-50 text-blue-800"
                          : tone === "amber"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-violet-50 text-violet-800";
                        return (
                          <div key={x.id} className={`rounded-md px-1.5 py-1 text-[10px] font-medium sm:text-[11px] ${rowClass}`}>
                            <div className="flex min-w-0 items-center gap-1">
                              <span className="min-w-0 truncate">{x.label}</span>
                              {x.duplicateTag && (
                                <span className="shrink-0 rounded bg-white/80 px-1 py-0.5 text-[8px] font-bold text-slate-600 ring-1 ring-inset ring-slate-200">
                                  {x.duplicateTag}
                                </span>
                              )}
                            </div>
                            <div className="truncate opacity-90">{x.sub}</div>
                          </div>
                        );
                      })}
                      {rows.length > 3 && (
                        <div className="px-1 text-[10px] font-semibold text-slate-500">+{rows.length - 3}건</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {pinned && <div className="fixed inset-0 z-[90]" onClick={() => setPinned(null)} aria-hidden="true" />}

      {active && (
        <div
          className={`fixed z-[100] w-[280px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ${
            pinned ? "pointer-events-auto" : "pointer-events-none"
          }`}
          style={{ top: active.top, left: active.left }}
          onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        >
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="shrink-0 text-[13px] font-bold text-slate-900">
                {Number(active.date.slice(5, 7))}월 {Number(active.date.slice(-2))}일 일정
              </div>
              <div
                className={`min-w-0 flex-1 truncate text-center text-[10px] font-bold ${
                  tone === "blue" ? "text-blue-700" : tone === "amber" ? "text-amber-700" : "text-violet-700"
                }`}
              >
                합계 {fmtWon(active.rows.reduce((sum, row) => sum + (row.amount || 0), 0))}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">
                  {active.rows.length}건
                </div>
                {pinned && <div className="text-[9px] font-semibold text-blue-600">고정됨</div>}
              </div>
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {title}
              {!pinned && " · 클릭하면 고정"}
            </div>
          </div>
          <div className="max-h-[174px] space-y-1.5 overflow-y-auto p-2">
            {active.rows.map((x) => {
              const rowClass = x.done
                ? "border-slate-200 bg-slate-100 text-slate-500"
                : tone === "blue"
                ? "border-blue-100 bg-blue-50 text-blue-900"
                : tone === "amber"
                ? "border-amber-100 bg-amber-50 text-amber-900"
                : "border-violet-100 bg-violet-50 text-violet-900";
              return (
                <div key={x.id} className={`rounded-lg border px-2.5 py-2 ${rowClass}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      <div className="min-w-0 break-words text-[12px] font-bold leading-4">{x.label}</div>
                      {x.duplicateTag && (
                        <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[8px] font-bold text-slate-600 ring-1 ring-inset ring-slate-200">
                          {x.duplicateTag}
                        </span>
                      )}
                    </div>
                    {x.status && (
                      <span
                        className={`shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[8px] font-bold ${
                          x.done ? "text-slate-500" : "text-red-600"
                        }`}
                      >
                        {x.status}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 break-words text-[10px] leading-4 opacity-85">{x.sub}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
