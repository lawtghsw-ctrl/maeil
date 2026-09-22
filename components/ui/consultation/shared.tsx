"use client";

// 상담일지 전용 고밀도 UI. 참고 이미지처럼 한 화면에 최대한 많은 정보를 배치하기 위해
// 일반 어드민 폼보다 입력 높이/여백/라벨 폭을 줄이고, 섹션은 회색 구분바 + 표 형태 행으로
// 구성합니다. 필수 항목은 사용자가 지정한 '*' 필드처럼 라벨 영역 자체를 연한 하늘색으로
// 표시하며, 미입력 상태는 빨간 테두리로 한 번 더 구분합니다.
import type { ChangeEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const denseInputClass =
  "h-7 w-full min-w-0 rounded-[4px] border border-slate-300 bg-white px-2 text-[12px] leading-none text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";

export const denseSelectClass =
  "h-7 min-w-0 rounded-[4px] border border-slate-300 bg-white px-1.5 text-[12px] text-slate-800 outline-none focus:border-blue-400";

export const denseTextareaClass =
  "min-h-[44px] w-full resize-none rounded-[4px] border border-slate-300 bg-white px-2 py-1.5 text-[12px] leading-4 text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100";

export const dateInputClass = denseInputClass;
export const compactTextareaClass = denseTextareaClass;
export const textareaClass =
  "min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

export function OXToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex h-7 overflow-hidden rounded-[4px] border border-slate-300 align-middle">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={cn(
          "w-8 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
          value === true ? "bg-blue-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
        )}
      >
        O
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={cn(
          "w-8 border-l border-slate-300 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
          value === false ? "bg-blue-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
        )}
      >
        X
      </button>
    </div>
  );
}

// 금액 입력 — 화면은 만원 단위, 내부 데이터는 기존 계산 로직 호환을 위해 원 단위로 유지.
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
  const manwon = value ? Math.round(value / 10000) : 0;
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <input
        inputMode="numeric"
        disabled={disabled}
        className={denseInputClass}
        value={manwon ? manwon.toLocaleString("ko-KR") : ""}
        placeholder="0"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value.replace(/[^0-9-]/g, "");
          const n = raw === "" ? 0 : Number(raw);
          onChange(Number.isFinite(n) ? Math.max(min, n) * 10000 : min);
        }}
      />
      <span className="shrink-0 text-[11px] font-semibold text-slate-500">만원</span>
    </div>
  );
}

// 원 단위 입력 — 송달료/인지대처럼 실제 원 단위 금액을 기록할 때 사용.
export function WonInput({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <input
        inputMode="numeric"
        disabled={disabled}
        className={denseInputClass}
        value={value ? Math.round(value).toLocaleString("ko-KR") : ""}
        placeholder="0"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value.replace(/[^0-9-]/g, "");
          const n = raw === "" ? 0 : Number(raw);
          onChange(Number.isFinite(n) ? Math.max(0, n) : 0);
        }}
      />
      <span className="shrink-0 text-[11px] font-semibold text-slate-500">원</span>
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
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <input
        inputMode="numeric"
        disabled={disabled}
        className={denseInputClass}
        value={value === undefined || value === null ? "" : String(value)}
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
      <span className="shrink-0 text-[11px] font-semibold text-slate-500">{unit}</span>
    </div>
  );
}

// 순수 구분용 회색 바. 액션/입력 요소는 절대 넣지 않습니다.
export function SectionBar({ label }: { label: string }) {
  return (
    <div className="select-none border-b border-slate-300 bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-600">
      {label}
    </div>
  );
}

export function SectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-[5px] border border-slate-300 bg-white", className)}>
      <SectionBar label={title} />
      <div>{children}</div>
    </section>
  );
}

// 참고 이미지의 '라벨 셀 + 입력 셀' 구조. required=true이면 라벨 배경을 항상 하늘색으로,
// missing=true이면 해당 행 전체에 빨간 inset 테두리를 추가합니다.
export function DenseRow({
  label,
  required = false,
  missing = false,
  children,
  labelWidth = "84px",
  className,
  contentClassName,
}: {
  label: string;
  required?: boolean;
  missing?: boolean;
  children: ReactNode;
  labelWidth?: string;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-[32px] border-b border-slate-200 last:border-b-0",
        missing && "shadow-[inset_0_0_0_1px_rgba(239,68,68,.85)]",
        className
      )}
      style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr)` }}
    >
      <div
        className={cn(
          "flex items-center border-r border-slate-200 px-1.5 py-1 text-[11px] font-semibold leading-4 text-slate-600",
          required ? "bg-sky-100" : "bg-slate-50",
          missing && "text-red-700"
        )}
      >
        {label}
      </div>
      <div className={cn("flex min-w-0 items-center gap-1.5 px-1.5 py-0.5", contentClassName)}>{children}</div>
    </div>
  );
}

export function DenseButtonGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "h-7 rounded-[4px] border px-2 text-[11px] font-semibold transition",
            value === option
              ? "border-blue-500 bg-blue-500 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export const compactLabelText = "text-xs font-semibold";
