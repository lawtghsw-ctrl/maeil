"use client";

// 상담일지 대형 팝업 전용 공용 UI. v14에서는 참고 이미지처럼 "라벨 셀 + 입력 셀"이
// 한 줄에 붙는 고밀도 표형 레이아웃으로 통일했습니다. 필수 라벨은 값 입력 여부와 무관하게
// 항상 연한 하늘색으로 표시하고, 누락 상태도 빨간 글씨를 쓰지 않습니다.
import type { ChangeEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Primitives";

export function OXToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex h-7 overflow-hidden rounded border border-slate-200">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === true ? undefined : true)}
        className={cn(
          "w-8 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
          value === true ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
        )}
      >
        O
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === false ? undefined : false)}
        className={cn(
          "w-8 border-l border-slate-200 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
          value === false ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
        )}
      >
        X
      </button>
    </div>
  );
}

export function ManwonInput({
  value,
  onChange,
  min = 0,
  disabled,
  className,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  disabled?: boolean;
  className?: string;
}) {
  const manwon = value === undefined ? "" : Math.round(value / 10000).toLocaleString("ko-KR");
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1", className)}>
      <input
        inputMode="numeric"
        disabled={disabled}
        className={cn(
          "h-7 w-full min-w-0 rounded border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100",
          disabled && "bg-slate-100 text-slate-500"
        )}
        value={manwon}
        placeholder="0"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value.replace(/[^0-9-]/g, "");
          const n = raw === "" ? 0 : Number(raw);
          onChange(Number.isFinite(n) ? Math.max(min, n) * 10000 : min);
        }}
      />
      <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-500">만원</span>
    </div>
  );
}

export function WonInput({ value, onChange, className }: { value: number | undefined; onChange: (v: number) => void; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1", className)}>
      <input
        inputMode="numeric"
        className="h-7 w-full min-w-0 rounded border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
        value={value === undefined ? "" : value.toLocaleString("ko-KR")}
        placeholder="0"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value.replace(/[^0-9-]/g, "");
          onChange(raw === "" ? 0 : Math.max(0, Number(raw)));
        }}
      />
      <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-500">원</span>
    </div>
  );
}

export function UnitNumberInput({
  value,
  onChange,
  unit,
  min = 0,
  max,
  disabled,
  className,
  readOnly = false,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  readOnly?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1", className)}>
      <input
        inputMode="numeric"
        disabled={disabled}
        readOnly={readOnly}
        className={cn(
          "h-7 w-full min-w-0 rounded border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100",
          (disabled || readOnly) && "bg-slate-50 text-center text-slate-600"
        )}
        value={value === undefined ? "" : String(value)}
        placeholder="0"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value.replace(/[^0-9-]/g, "");
          let n = raw === "" ? 0 : Number(raw);
          if (!Number.isFinite(n)) n = min;
          n = Math.max(min, n);
          if (max !== undefined) n = Math.min(max, n);
          onChange(n);
        }}
      />
      <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-500">{unit}</span>
    </div>
  );
}

export const compactInputClass =
  "h-7 w-full min-w-0 rounded border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 sm:h-7 sm:text-[11px]";
export const compactSelectClass =
  "h-7 w-full min-w-0 rounded border border-slate-200 bg-white px-1.5 text-center text-[11px] outline-none focus:border-blue-400 sm:h-7 sm:text-[11px]";
export const dateInputClass = compactInputClass;
export const textareaClass =
  "min-h-16 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100";
export const compactTextareaClass =
  "min-h-11 w-full rounded border border-slate-200 bg-white px-2 py-1 text-[11px] leading-4 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100";

export function SectionBar({ label }: { label: string }) {
  return (
    <div className="select-none border-b border-slate-300 bg-slate-200 px-2 py-1 text-center text-[12px] font-extrabold tracking-wide text-slate-700">
      {label}
    </div>
  );
}

export function SectionCard({
  title,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden rounded-md", className)}>
      <SectionBar label={title} />
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </Card>
  );
}

export function FieldRow({
  label,
  children,
  required,
  missing,
  labelClassName,
  contentClassName,
  className,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  missing?: boolean;
  labelClassName?: string;
  contentClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("grid min-h-8 grid-cols-[126px_minmax(0,1fr)] border-b border-slate-200 last:border-b-0", className)}>
      <div
        className={cn(
          "flex min-w-0 items-center justify-center border-r border-slate-200 bg-slate-50 px-1.5 text-center text-[10px] font-bold text-slate-600",
          "whitespace-nowrap",
          required && "bg-sky-100 text-slate-700",
          missing && "bg-sky-200 ring-1 ring-inset ring-sky-400",
          labelClassName
        )}
      >
        {label}
      </div>
      <div className={cn("flex min-w-0 items-center gap-1 p-1", contentClassName)}>{children}</div>
    </div>
  );
}

export function SplitRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2", className)}>{children}</div>;
}

export const compactLabelText = "text-[10px] font-semibold";
