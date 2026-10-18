"use client";

import type { ReactNode } from "react";

/** Native disclosure: keyboard/touch accessible without a tooltip dependency. */
export function InfoHelp({ summary, children, className = "" }: { summary: string; children: ReactNode; className?: string }) {
  return <details className={`text-xs text-slate-500 ${className}`} onKeyDown={event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  }}>
    <summary aria-label={`${summary} · 자세한 설명`} className="flex cursor-pointer list-none items-center gap-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 [&::-webkit-details-marker]:hidden">
      <span>{summary}</span><span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-bold">i</span>
    </summary>
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-normal leading-5 text-slate-600">{children}</div>
  </details>;
}
