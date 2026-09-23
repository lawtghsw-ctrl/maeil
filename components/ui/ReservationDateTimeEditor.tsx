"use client";

// DB관리 고객리스트와 상담일지에서 동일한 예약 UX를 공유합니다.
// 브라우저 기본 datetime-local은 날짜/시/분을 한 번에 다뤄야 해 빠른 상담예약에 불편하므로
// 날짜 달력 + 오전/오후 시간 + 10분 단위 분 선택으로 분리하되, 저장값은 기존 reservationAt
// 형식(YYYY-MM-DDTHH:mm)을 그대로 유지합니다.
import type { ChangeEvent } from "react";
import { kstDateStr } from "@/lib/consultation";

const RESERVATION_MINUTES = ["00", "10", "20", "30", "40", "50"] as const;
const RESERVATION_HOURS = Array.from({ length: 24 }, (_, hour) => {
  const period = hour < 12 ? "오전" : "오후";
  const displayHour = hour % 12 || 12;
  return { value: String(hour).padStart(2, "0"), label: `${period} ${displayHour}시` };
});

export function ReservationDateTimeEditor({
  value,
  disabled,
  onChange,
  compact = false,
}: {
  value?: string;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
  compact?: boolean;
}) {
  const date = value?.slice(0, 10) ?? "";
  const time = value?.slice(11, 16) ?? "";
  const [hour = "", minute = ""] = time.split(":");

  const commit = (nextDate: string, nextHour: string, nextMinute: string) => {
    if (!nextDate) {
      onChange(undefined);
      return;
    }
    onChange(`${nextDate}T${nextHour || "10"}:${nextMinute || "00"}`);
  };

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${compact ? "sm:flex-nowrap" : "w-full sm:flex-nowrap"}`}>
      <input
        type="date"
        value={date}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => commit(e.target.value, hour || "10", minute || "00")}
        className={`${compact ? "w-[126px]" : "min-w-[122px] flex-1"} h-8 rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] font-semibold text-amber-900 outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300`}
      />
      <select
        value={hour || "10"}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => commit(date || kstDateStr(), e.target.value, minute || "00")}
        className={`${compact ? "w-[92px]" : "w-[96px]"} h-8 rounded-md border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-900 outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300`}
      >
        {RESERVATION_HOURS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <select
        value={minute || "00"}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => commit(date || kstDateStr(), hour || "10", e.target.value)}
        className={`${compact ? "w-[68px]" : "w-[72px]"} h-8 rounded-md border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-900 outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300`}
      >
        {RESERVATION_MINUTES.map((m) => <option key={m} value={m}>{m}분</option>)}
      </select>
    </div>
  );
}
