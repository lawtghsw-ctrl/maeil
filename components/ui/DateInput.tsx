"use client";

import { useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { calendarDateParts, calendarKeyDate, calendarMonthDays, clampCalendarDate, isCalendarDateAllowed, localCalendarToday, MONDAY_WEEKDAYS, shiftCalendarMonth } from "@/lib/calendar-date";

export interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max"> {
  value: string;
  onValueChange: (value: string) => void;
  onIncompleteChange?: (incomplete: boolean) => void;
  min?: string;
  max?: string;
}

/** The visible text field preserves direct typing; only complete dates (or empty) leave the component. */
export function DateInput({ value, onValueChange, onIncompleteChange, className, disabled, readOnly, min, max, onBlur, onKeyDown, ...props }: DateInputProps) {
  const [text, setText] = useState(value), [open, setOpen] = useState(false);
  const [focusDate, setFocusDate] = useState(() => calendarDateParts(value) ? value : localCalendarToday());
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 420 });
  const lastEmitted = useRef(value), input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const dialogId = useId(), label = props["aria-label"] || props.title || "날짜";
  const invalid = !!text && !isCalendarDateAllowed(text, min, max);
  useEffect(() => { if (value !== lastEmitted.current) { lastEmitted.current = value; setText(value); } }, [value]);
  useEffect(() => { input.current?.setCustomValidity(invalid ? "유효한 날짜를 YYYY-MM-DD 형식으로 입력해주세요." : ""); }, [invalid]);
  useEffect(() => { onIncompleteChange?.(invalid); }, [invalid, onIncompleteChange]);
  useEffect(() => { if (disabled || readOnly) setOpen(false); }, [disabled, readOnly]);
  useEffect(() => {
    if (!open) return;
    const locate = () => {
      const rect = input.current?.getBoundingClientRect(); if (!rect) return;
      const height = Math.min(390, window.innerHeight - 16);
      const below = window.innerHeight - rect.bottom - 8;
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 312)), top: below >= height ? rect.bottom + 4 : Math.max(8, rect.top - height - 4), maxHeight: height });
    };
    const outside = (event: Event) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node) && !input.current?.contains(event.target as Node)) setOpen(false); };
    locate(); document.addEventListener("mousedown", outside); document.addEventListener("focusin", outside);
    window.addEventListener("resize", locate); window.addEventListener("scroll", locate, true);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("focusin", outside); window.removeEventListener("resize", locate); window.removeEventListener("scroll", locate, true); };
  }, [open]);
  useEffect(() => { if (open) popup.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusDate}"]`)?.focus(); }, [open, focusDate]);

  function unavailable() { return !!(disabled || readOnly || input.current?.matches(":disabled")); }
  function emit(next: string) { if (unavailable()) return; lastEmitted.current = next; onValueChange(next); }
  function choose(next: string) { if (unavailable() || !isCalendarDateAllowed(next, min, max)) return; setText(next); onIncompleteChange?.(false); emit(next); setOpen(false); trigger.current?.focus(); }
  function clear() { if (unavailable()) return; setText(""); onIncompleteChange?.(false); emit(""); close(); }
  function show() {
    if (unavailable()) return;
    setFocusDate(clampCalendarDate(calendarDateParts(text) ? text : localCalendarToday(), min, max)); setOpen(true);
  }
  function close() { setOpen(false); trigger.current?.focus(); }
  function keyDay(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const next = calendarKeyDate(date, event.key, event.shiftKey);
    if (next) { event.preventDefault(); setFocusDate(clampCalendarDate(next, min, max)); }
  }
  const month = focusDate.slice(0, 7), year = Number(month.slice(0, 4)), monthNumber = Number(month.slice(5));
  const days = calendarMonthDays(month);
  const yearsStart = Math.max(1, year - 100), yearsEnd = Math.min(9999, year + 20);
  function selectMonth(nextMonth: string) {
    const first = `${nextMonth}-01`; if (calendarDateParts(first)) setFocusDate(clampCalendarDate(first, min, max));
  }
  return <span className={`relative inline-flex min-w-0 items-center ${className ?? "h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
    <input {...props} ref={input} type="text" value={text} disabled={disabled} readOnly={readOnly} placeholder={props.placeholder ?? "YYYY-MM-DD"} maxLength={10} inputMode={props.inputMode ?? "text"} autoComplete={props.autoComplete ?? "off"} aria-invalid={invalid || undefined} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} className="h-full w-full min-w-0 bg-transparent pr-6 text-inherit outline-none" onChange={event => { if (unavailable()) return; const raw = event.target.value; setText(raw); onIncompleteChange?.(!!raw && !isCalendarDateAllowed(raw, min, max)); emit(calendarDateParts(raw) ? raw : ""); }} onBlur={onBlur} onKeyDown={event => { onKeyDown?.(event); if (event.defaultPrevented) return; if (event.key === "ArrowDown" && event.altKey) { event.preventDefault(); show(); } if (event.key === "Escape" && open) { event.preventDefault(); close(); } }}/>
    <button ref={trigger} type="button" disabled={disabled || readOnly} aria-label={`${label} 달력 열기`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} className="absolute right-1 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed" onClick={() => open ? close() : show()}><CalendarDays size={15}/></button>
    {open && typeof document !== "undefined" && createPortal(<div ref={popup} id={dialogId} role="dialog" aria-label={`${label} 선택`} className="fixed z-[250] w-[304px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-2xl" style={position} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" aria-label="이전 달" className="grid size-8 place-items-center rounded hover:bg-slate-100" onClick={() => setFocusDate(clampCalendarDate(shiftCalendarMonth(focusDate, -1), min, max))}><ChevronLeft size={16}/></button>
        <select aria-label="연도 선택" value={year} className="h-8 min-w-0 rounded border px-1 text-sm" onChange={event => selectMonth(`${event.target.value.padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`)}>{Array.from({ length: yearsEnd - yearsStart + 1 }, (_, index) => yearsStart + index).map(item => <option key={item} value={item}>{item}년</option>)}</select>
        <select aria-label="월 선택" value={monthNumber} className="h-8 rounded border px-1 text-sm" onChange={event => selectMonth(`${String(year).padStart(4, "0")}-${event.target.value.padStart(2, "0")}`)}>{Array.from({ length: 12 }, (_, index) => index + 1).map(item => <option key={item} value={item}>{item}월</option>)}</select>
        <button type="button" aria-label="다음 달" className="grid size-8 place-items-center rounded hover:bg-slate-100" onClick={() => setFocusDate(clampCalendarDate(shiftCalendarMonth(focusDate, 1), min, max))}><ChevronRight size={16}/></button>
      </div>
      <div role="grid" aria-label={`${year}년 ${monthNumber}월`}>
        <div role="row" className="grid grid-cols-7 text-center text-xs font-semibold text-slate-500">{MONDAY_WEEKDAYS.map(day => <span role="columnheader" key={day} className="py-2">{day}</span>)}</div>
        {Array.from({ length: days.length / 7 }, (_, week) => <div role="row" key={week} className="grid grid-cols-7">{days.slice(week * 7, week * 7 + 7).map((date, column) => <span role="gridcell" key={date ?? `empty-${column}`} className="grid place-items-center" aria-selected={date ? date === value : undefined}>{date && <button type="button" data-date={date} aria-label={date} aria-current={date === localCalendarToday() ? "date" : undefined} tabIndex={date === focusDate ? 0 : -1} disabled={!isCalendarDateAllowed(date, min, max)} onKeyDown={event => keyDay(event, date)} onClick={() => choose(date)} className={`my-0.5 grid size-9 place-items-center rounded-md text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:text-slate-300 ${date === value ? "bg-blue-600 font-bold text-white" : "hover:bg-blue-50"}`}>{Number(date.slice(-2))}</button>}</span>)}</div>)}
      </div>
      <div className="mt-2 flex justify-between gap-2 border-t pt-2"><button type="button" className="rounded px-2 py-1 text-xs hover:bg-slate-100" onClick={clear}>지우기</button><button type="button" className="rounded px-2 py-1 text-xs hover:bg-slate-100" disabled={!isCalendarDateAllowed(localCalendarToday(), min, max)} onClick={() => choose(localCalendarToday())}>오늘</button><button type="button" className="rounded px-2 py-1 text-xs hover:bg-slate-100" onClick={close}>닫기</button></div>
    </div>, document.body)}
  </span>;
}

/** Separates calendar and local clock inputs without parsing, adding a timezone or changing stored precision. */
export function DateTimeInput({ value, onValueChange, onIncompleteChange, className, min, max, ...props }: DateInputProps) {
  const [parts, setParts] = useState(() => ({ date: value.slice(0, 10), time: value.slice(11) }));
  const [dateIncomplete, setDateIncomplete] = useState(false);
  const dateIncompleteRef = useRef(false);
  const trackDateIncomplete = useCallback((invalid: boolean) => { dateIncompleteRef.current = invalid; setDateIncomplete(invalid); }, []);
  const emitted = useRef(value);
  useEffect(() => { if (value !== emitted.current) { emitted.current = value; setParts({ date: value.slice(0, 10), time: value.slice(11) }); } }, [value]);
  function incomplete(date: string, time: string, invalidDate: boolean) { return invalidDate || (!!(date || time) && (!calendarDateParts(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(time))); }
  const isIncomplete = incomplete(parts.date, parts.time, dateIncomplete);
  useEffect(() => { onIncompleteChange?.(isIncomplete); }, [isIncomplete, onIncompleteChange]);
  function change(date: string, time: string) { setParts({ date, time }); const next = date && time ? `${date}T${time}` : ""; emitted.current = next; onIncompleteChange?.(incomplete(date, time, dateIncompleteRef.current)); onValueChange(next); }
  const label = props["aria-label"] || props.title || "일시";
  return <span className={`inline-flex min-w-0 items-center gap-1 ${className ?? "h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"}`}>
    <DateInput {...props} name={undefined} required={props.required || !!parts.time} value={parts.date} onValueChange={date => change(date, parts.time)} onIncompleteChange={trackDateIncomplete} min={min?.slice(0, 10)} max={max?.slice(0, 10)} aria-label={`${label} 날짜`} className="h-full min-w-[8rem] flex-1"/>
    <input type="time" value={parts.time} onChange={event => change(parts.date, event.target.value)} disabled={props.disabled} readOnly={props.readOnly} required={props.required || !!parts.date || dateIncomplete} step={props.step} min={parts.date === min?.slice(0, 10) ? min.slice(11) : undefined} max={parts.date === max?.slice(0, 10) ? max.slice(11) : undefined} aria-label={`${label} 시간`} className="h-full w-[6rem] min-w-0 bg-transparent text-inherit outline-none"/>
    {props.name && <input type="hidden" name={props.name} value={value}/>}
  </span>;
}
