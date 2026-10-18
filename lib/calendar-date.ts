/** Calendar-only arithmetic. Values remain YYYY-MM-DD strings, with no timezone conversion. */
export const MONDAY_WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
export function mondayWeekday(sundayWeekday: number): number { return (sundayWeekday + 6) % 7; }
function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(12, 0, 0, 0); return date;
}
export function calendarDateParts(value: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const date = utcDate(year, month, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
}
function dateText(date: Date): string { return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
export function localCalendarToday(): string {
  const date = new Date(); return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function calendarMonthDays(month: string): (string | null)[] {
  const first = calendarDateParts(`${month}-01`); if (!first) return [];
  const start = utcDate(first.year, first.month, 1), last = utcDate(first.year, first.month + 1, 0).getUTCDate();
  const days: (string | null)[] = Array(mondayWeekday(start.getUTCDay())).fill(null);
  for (let day = 1; day <= last; day++) days.push(`${month}-${String(day).padStart(2, "0")}`);
  while (days.length % 7) days.push(null); return days;
}
export function shiftCalendarDate(value: string, days: number): string {
  const parts = calendarDateParts(value); if (!parts) return value;
  const next = utcDate(parts.year, parts.month, parts.day + days);
  return next.getUTCFullYear() >= 1 && next.getUTCFullYear() <= 9999 ? dateText(next) : value;
}
export function shiftCalendarMonth(value: string, months: number): string {
  const parts = calendarDateParts(value); if (!parts) return value;
  const first = utcDate(parts.year, parts.month + months, 1);
  if (first.getUTCFullYear() < 1 || first.getUTCFullYear() > 9999) return value;
  const last = utcDate(first.getUTCFullYear(), first.getUTCMonth() + 2, 0).getUTCDate();
  return dateText(utcDate(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(parts.day, last)));
}
export function calendarKeyDate(value: string, key: string, shift = false): string | null {
  const parts = calendarDateParts(value); if (!parts) return null;
  const weekday = mondayWeekday(utcDate(parts.year, parts.month, parts.day).getUTCDay());
  if (key === "ArrowLeft") return shiftCalendarDate(value, -1);
  if (key === "ArrowRight") return shiftCalendarDate(value, 1);
  if (key === "ArrowUp") return shiftCalendarDate(value, -7);
  if (key === "ArrowDown") return shiftCalendarDate(value, 7);
  if (key === "Home") return shiftCalendarDate(value, -weekday);
  if (key === "End") return shiftCalendarDate(value, 6 - weekday);
  if (key === "PageUp") return shiftCalendarMonth(value, shift ? -12 : -1);
  if (key === "PageDown") return shiftCalendarMonth(value, shift ? 12 : 1);
  return null;
}
export function isCalendarDateAllowed(value: string, min?: string, max?: string): boolean {
  return !!calendarDateParts(value) && (!min || !calendarDateParts(min) || value >= min) && (!max || !calendarDateParts(max) || value <= max);
}
export function clampCalendarDate(value: string, min?: string, max?: string): string {
  if (min && calendarDateParts(min) && value < min) return min;
  if (max && calendarDateParts(max) && value > max) return max;
  return value;
}
