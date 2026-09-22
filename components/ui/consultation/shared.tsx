"use client";

// 상담일지 대형 팝업(ConsultationModal) 전용 공용 UI 조각 — O/X 빠른선택, 만원 단위
// 숫자입력, 섹션 카드 타이틀 등. 여러 Section 컴포넌트가 공유합니다.
import type { ChangeEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Primitives";

// 워크아웃 진행여부/도박이력 등 boolean 판단 항목을 빠르게 누를 수 있는 [O]/[X] 토글.
// value===undefined(미선택)는 두 버튼 모두 비활성 톤으로 표시합니다.
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
    <div className="inline-flex h-9 overflow-hidden rounded-lg border border-slate-200">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={cn(
          "w-10 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
          value === true ? "bg-blue-600 text-white" : "bg-white text-slate-400 hover:bg-slate-50"
        )}
      >
        O
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={cn(
          "w-10 border-l border-slate-200 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
          value === false ? "bg-slate-800 text-white" : "bg-white text-slate-400 hover:bg-slate-50"
        )}
      >
        X
      </button>
    </div>
  );
}

// 금액 입력 — 표시/입력은 "만원" 단위(예: 370)로 하되, 실제 저장값은 기존 필드와 동일하게
// 원(₩) 단위를 그대로 씁니다(computeRepaymentPlan/fmtWon 등 기존 계산·표시 로직과 호환
// 유지 목적). 10,000원 미만 단수는 저장 시 반올림됩니다.
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
    <div className={cn("flex items-center gap-1.5", className)}>
      <input
        inputMode="numeric"
        disabled={disabled}
        className={cn(
          "h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-9",
          disabled && "bg-slate-100 text-slate-500"
        )}
        value={manwon ? manwon.toLocaleString("ko-KR") : ""}
        placeholder="0"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value.replace(/[^0-9-]/g, "");
          const n = raw === "" ? 0 : Number(raw);
          onChange(Number.isFinite(n) ? Math.max(min, n) * 10000 : min);
        }}
      />
      <span className="shrink-0 text-xs font-semibold text-slate-400">만원</span>
    </div>
  );
}

// 일반 숫자 입력 + 임의 단위(개월/명/일/% 등) — 단위는 값 자체에 타이핑하지 않고
// input 바깥에 별도 표시합니다.
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
    <div className={cn("flex items-center gap-1.5", className)}>
      <input
        inputMode="numeric"
        disabled={disabled}
        className={cn(
          "h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-9",
          disabled && "bg-slate-100 text-slate-500"
        )}
        value={value ? String(value) : ""}
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
      <span className="shrink-0 text-xs font-semibold text-slate-400">{unit}</span>
    </div>
  );
}

// 구 ConsultationTabsEditor.tsx에서 옮겨온 공용 클래스 — app/clients/page.tsx의 "계약
// 관련 메모" textarea 등 상담일지 밖에서도 재사용되고 있어 여기로 이전했습니다.
export const dateInputClass =
  "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm";
export const textareaClass =
  "min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:text-sm";
// 상담일지 대형 팝업 안에서 쓰는 좀 더 낮은(컴팩트) textarea
export const compactTextareaClass =
  "min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col p-3.5", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-slate-900">{title}</div>
        {action}
      </div>
      <div className="flex-1 space-y-2.5">{children}</div>
    </Card>
  );
}

// Label 하나에 라벨 텍스트 + 컴팩트 간격을 적용한 공용 wrapper. Primitives의 Label을
// 그대로 쓰되(필수/누락 시 하늘색·빨강 강조 로직 재사용), 대형 모달의 고밀도 레이아웃에
// 맞춰 text-xs로 통일합니다.
export const compactLabelText = "text-xs font-semibold";
