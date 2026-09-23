"use client";

// 도원 Admin(tg_m) components/ui.tsx · pagination.tsx의 디자인 시스템을 그대로 이식한
// 공용 프리미티브 — Card/Button/Badge/PageHeader/Input/Select/Modal 및 리스트 화면에서
// 반복 사용하는 SearchBox/StatusTabs/Label/NumberInput.
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)]",
        className
      )}
    >
      {children}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  className,
  variant = "primary",
  children,
  onClick,
  type = "button",
  disabled = false,
}: {
  className?: string;
  variant?: ButtonVariant;
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-red-50 text-red-700 hover:bg-red-100",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:h-9",
        styles[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

export type BadgeTone = "gray" | "blue" | "green" | "red" | "amber";

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: BadgeTone }) {
  const map: Record<BadgeTone, string> = {
    gray: "bg-slate-100 text-slate-600",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold",
        map[tone]
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col justify-between gap-3 sm:mb-5 lg:flex-row lg:items-end">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description && (
          <p className="mt-1 break-keep text-[13px] leading-5 text-slate-500 sm:text-sm">
            {description}
          </p>
        )}
      </div>
      {action && <div className="w-full lg:w-auto">{action}</div>}
    </div>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  className,
  readOnly = false,
  disabled = false,
}: {
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={onChange}
      type={type}
      placeholder={placeholder}
      readOnly={readOnly}
      disabled={disabled}
      className={cn(
        "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm",
        (readOnly || disabled) && "bg-slate-50 text-slate-500",
        className
      )}
    />
  );
}

export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
}: {
  value?: string;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={cn(
        "h-11 rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 disabled:opacity-60 sm:h-10 sm:text-sm",
        className
      )}
    >
      {children}
    </select>
  );
}

export type ModalSize = "md" | "lg" | "xl" | "full";

export function Modal({
  open,
  title,
  headerExtra,
  children,
  onClose,
  size = "md",
}: {
  open: boolean;
  title: string;
  // 헤더 우측(닫기 버튼 왼쪽)에 붙는 부가 콘텐츠 — 예: 상담일지 자동저장 상태("저장
  // 중.../저장됨")나 작성률 뱃지처럼 제목 옆에 작게 보여줘야 하는 요소. 옵션 prop이라
  // 기존 Modal 호출부는 전혀 영향받지 않습니다.
  headerExtra?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  size?: ModalSize;
}) {
  if (!open) return null;
  // md/lg/xl은 기존과 동일하게 내용물 높이에 맞춰 늘어나고 뷰포트를 넘지 않도록만 제한.
  // full은 "상담일지를 한 화면에" 요청에 맞춰 뷰포트에 최대한 맞춘 고정 크기로 열리고,
  // 내용이 넘치면 카드 자체가(스티키 헤더 아래) 내부 스크롤됩니다.
  const sizeClass: Record<ModalSize, string> = {
    md: "max-w-2xl max-h-[calc(100dvh-16px)] sm:max-h-[90vh]",
    lg: "max-w-4xl max-h-[calc(100dvh-16px)] sm:max-h-[90vh]",
    xl: "max-w-5xl max-h-[calc(100dvh-16px)] sm:max-h-[90vh]",
    full: "max-w-[1920px] w-[98vw] h-[96dvh] max-h-[96dvh]",
  };
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-2 sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl",
          sizeClass[size]
        )}
        onMouseDown={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      >
        <div className={cn("flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-white", size === "full" ? "px-3 py-2" : "px-4 py-3 sm:px-5 sm:py-4")}>
          <h2 className="min-w-0 break-keep pr-3 font-bold">{title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {headerExtra}
            <button
              onClick={onClose}
              className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 sm:size-8"
            >
              ✕
            </button>
          </div>
        </div>
        <div className={cn("overflow-y-auto overscroll-contain", size === "full" ? "p-2 sm:p-2.5" : "p-4 sm:p-5")}>{children}</div>
      </div>
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  onReset,
  placeholder = "이름 또는 연락처 검색",
}: {
  value: string;
  onChange: (v: string) => void;
  onReset?: () => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      {onReset && (
        <Button type="button" variant="secondary" onClick={onReset} className="shrink-0">
          초기화
        </Button>
      )}
    </div>
  );
}

export function StatusTabs<T extends string>({
  value,
  onChange,
  left,
  right,
  leftCount,
  rightCount,
}: {
  value: T;
  onChange: (v: T) => void;
  left: { value: T; label: string };
  right: { value: T; label: string };
  leftCount?: number;
  rightCount?: number;
}) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => onChange(left.value)}
        className={`h-10 px-4 text-sm font-bold transition ${
          value === left.value ? "bg-blue-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        {left.label}
        {leftCount !== undefined && (
          <span className={`ml-1.5 text-xs ${value === left.value ? "text-blue-100" : "text-slate-400"}`}>
            ({leftCount})
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onChange(right.value)}
        className={`h-10 border-l border-slate-200 px-4 text-sm font-bold transition ${
          value === right.value ? "bg-blue-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        {right.label}
        {rightCount !== undefined && (
          <span className={`ml-1.5 text-xs ${value === right.value ? "text-blue-100" : "text-slate-400"}`}>
            ({rightCount})
          </span>
        )}
      </button>
    </div>
  );
}

// required/missing — 상담기록지 필수항목을 하늘색으로 강조 표시하기 위한 옵션.
// required만 true면 옅은 "필수" 뱃지만 붙고, missing까지 true면(필수인데 비어있음)
// 라벨 전체를 하늘색 박스로 감싸 한눈에 띄도록 합니다.
export function Label({
  text,
  children,
  required,
  missing,
}: {
  text: string;
  children: ReactNode;
  required?: boolean;
  missing?: boolean;
}) {
  return (
    <label
      className={cn(
        "text-sm font-semibold",
        missing && "block rounded-lg border-2 border-sky-300 bg-sky-50 p-2"
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        {text}
        {required && (
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", missing ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-400")}>
            필수
          </span>
        )}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  className = "",
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  className?: string;
  disabled?: boolean;
}) {
  const display = value ? value.toLocaleString("ko-KR") : "";
  return (
    <input
      inputMode="numeric"
      disabled={disabled}
      className={cn(
        "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm",
        className,
        disabled ? "bg-slate-100 text-slate-500" : ""
      )}
      value={display}
      placeholder="0"
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/[^0-9-]/g, "");
        const n = raw === "" ? 0 : Number(raw);
        onChange(Number.isFinite(n) ? Math.max(min, n) : min);
      }}
    />
  );
}

export const PAGE_SIZE = 20;

export function Pagination({
  page,
  total,
  onChange,
  pageSize = PAGE_SIZE,
}: {
  page: number;
  total: number;
  onChange: (p: number) => void;
  pageSize?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-t border-slate-100 px-4 py-4">
      <Button variant="secondary" onClick={() => onChange(Math.max(1, page - 1))}>
        <ChevronLeft size={15} />
        이전
      </Button>
      <span className="min-w-20 text-center text-sm text-slate-500">
        {page} / {pages}
      </span>
      <Button variant="secondary" onClick={() => onChange(Math.min(pages, page + 1))}>
        다음
        <ChevronRight size={15} />
      </Button>
    </div>
  );
}

export function pageRows<T>(rows: T[], page: number, pageSize = PAGE_SIZE): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

// 검색창 자동완성/알림 드롭다운 등에서 바깥 클릭 시 닫히도록 하는 공용 훅
export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function handler(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

export function useToggle(initial = false): [boolean, () => void, (v: boolean) => void] {
  const [v, setV] = useState(initial);
  return [v, () => setV((p) => !p), setV];
}
