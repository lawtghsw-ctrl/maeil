"use client";

import { useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { InfoHelp } from "@/components/ui/InfoHelp";

export const CHART_COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#0ea5e9", "#8b5cf6", "#f43f5e", "#64748b"];
export const numberText = (value: number) => Math.round(value).toLocaleString("ko-KR");
export const moneyText = (value: number) => `${numberText(value)}원`;
export function compactMoney(value: number) {
  const n = Math.abs(value);
  return `${value < 0 ? "−" : ""}${n >= 100000000 ? `${(n / 100000000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억` : n >= 10000 ? `${(n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}만` : numberText(n)}`;
}

export function PerformancePanel({ title, description, action, children, className = "" }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5"><div><h2 className="text-sm font-bold text-slate-900">{title}</h2>{description && <InfoHelp className="mt-1" summary="집계 기준">{description}</InfoHelp>}</div>{action}</div>
    {children}
  </section>;
}

export function PerformanceMetric({ label, value, caption, previous, current, points = false, dark = false }: { label: string; value: string; caption?: string; previous?: number; current?: number; points?: boolean; dark?: boolean }) {
  const comparable = previous !== undefined && current !== undefined;
  const change = comparable ? points ? current - previous : previous ? (current - previous) / Math.abs(previous) * 100 : null : null;
  const Icon = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return <div className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${dark ? "border-indigo-950 bg-indigo-950 text-white" : "border-slate-200 bg-white"}`}>
    <div className={`text-xs font-semibold ${dark ? "text-indigo-200" : "text-slate-500"}`}>{label}</div>
    <div className="mt-3 break-words text-2xl font-extrabold tracking-tight sm:text-[27px]">{value}</div>
    {comparable && <div className={`mt-2 flex items-center gap-1 text-[11px] font-semibold ${dark ? "text-indigo-200" : change !== null && change > 0 ? "text-emerald-700" : "text-slate-500"}`}><Icon size={13}/>{change === null ? previous === 0 && current === 0 ? "이전 기간과 동일" : "이전 기간 실적 없음" : `${change > 0 ? "+" : ""}${change.toFixed(1)}${points ? "%p" : "%"} · 이전 기간 대비`}</div>}
    {caption && (caption.length > 36 ? <InfoHelp className="mt-2" summary="집계 기준">{caption}</InfoHelp> : <div className={`mt-2 text-[11px] leading-5 ${dark ? "text-indigo-200/80" : "text-slate-400"}`}>{caption}</div>)}
  </div>;
}

export function EmptyPerformance({ title = "선택한 조건의 데이터가 없습니다.", description }: { title?: string; description?: string }) {
  return <div className="px-5 py-12 text-center"><div className="text-sm font-semibold text-slate-600">{title}</div>{description && <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-400">{description}</p>}</div>;
}

export type ChartSeries = { name: string; color: string; values: number[] };
export function PerformanceTrend({ labels, series, money = false }: { labels: string[]; series: ChartSeries[]; money?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  if (!labels.length || !series.some(row => row.values.some(v => v !== 0))) return <EmptyPerformance title="이 기간에 집계된 추이 데이터가 없습니다."/>;
  const max = Math.max(1, ...series.flatMap(row => row.values));
  const width = 760, height = 230, left = 65, right = 18, top = 15, bottom = 38;
  const plotW = width - left - right, plotH = height - top - bottom;
  const x = (i: number) => left + (labels.length === 1 ? plotW / 2 : i * plotW / (labels.length - 1));
  const y = (v: number) => top + plotH - v / max * plotH;
  const validActive = active !== null && active < labels.length ? active : null;
  const format = money ? compactMoney : numberText;
  return <div className="p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">{series.map(row => <div key={row.name} className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-5 rounded-full" style={{backgroundColor:row.color}}/>{row.name}</div>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map(s => s.name).join(" · ")} 기간별 추이`} className="w-full overflow-visible" onPointerMove={e => { const box=e.currentTarget.getBoundingClientRect(); const position=(e.clientX-box.left)/box.width*width; setActive(Math.max(0,Math.min(labels.length-1,Math.round((position-left)/plotW*(labels.length-1))))); }} onPointerLeave={()=>setActive(null)}>
      {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1={left} x2={width-right} y1={top+plotH*i/4} y2={top+plotH*i/4} stroke="#e2e8f0" strokeDasharray="3 5"/><text x={left-12} y={top+plotH*i/4+4} textAnchor="end" fill="#94a3b8" fontSize="10">{format(max*(1-i/4))}</text></g>)}
      {series.map(row => <g key={row.name}><polyline points={row.values.map((v,i)=>`${x(i)},${y(v)}`).join(" ")} fill="none" stroke={row.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{row.values.map((v,i)=><circle key={i} cx={x(i)} cy={y(v)} r={labels.length>62?2:3.5} fill="white" stroke={row.color} strokeWidth="2" tabIndex={0} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)} aria-label={`${labels[i]} ${row.name} ${money?moneyText(v):numberText(v)}`}><title>{`${labels[i]} · ${row.name} ${money?moneyText(v):numberText(v)}`}</title></circle>)}</g>)}
      {[...new Set([0,Math.round((labels.length-1)/3),Math.round((labels.length-1)*2/3),labels.length-1])].map(i=><text key={i} x={x(i)} y={height-9} textAnchor="middle" fill="#94a3b8" fontSize="10">{labels[i].slice(5).replace("-",".")}</text>)}
      {validActive !== null && <line x1={x(validActive)} x2={x(validActive)} y1={top} y2={top+plotH} stroke="#64748b" strokeDasharray="4 4"/>}
    </svg>
    <div aria-live="polite" className="mt-1 flex min-h-7 flex-wrap justify-end gap-x-4 gap-y-1 text-[11px] text-slate-500">{validActive !== null ? <><b className="text-slate-700">{labels[validActive]}</b>{series.map(row=><span key={row.name}>{row.name} <b style={{color:row.color}}>{money?moneyText(row.values[validActive]??0):numberText(row.values[validActive]??0)}</b></span>)}</> : <span>그래프 위에 마우스를 올리거나 점에 포커스하면 상세값이 표시됩니다.</span>}</div>
  </div>;
}

export function PerformanceBars({ rows, money = false, onSelect, selected, formatValue }: { rows: {name:string;value:number;secondary?:string}[]; money?:boolean; onSelect?:(name:string)=>void; selected?:string; formatValue?:(value:number)=>string }) {
  const max=Math.max(1,...rows.map(row=>row.value));
  if (!rows.length) return <EmptyPerformance/>;
  return <div className="space-y-4 p-4 sm:p-5">{rows.map((row,i)=>{
    const content=<><div className="mb-2 flex items-start justify-between gap-3"><span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-700"><span className="grid size-5 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] text-slate-500">{i+1}</span><span className="truncate">{row.name}</span></span><span className="shrink-0 text-right"><b className="text-xs text-slate-900">{formatValue?formatValue(row.value):money?moneyText(row.value):numberText(row.value)}</b>{row.secondary&&<span className="ml-2 text-[10px] text-slate-400">{row.secondary}</span>}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${selected===row.name?"bg-emerald-500":"bg-indigo-500"}`} style={{width:`${Math.max(0,row.value/max*100)}%`}}/></div></>;
    return onSelect?<button key={row.name} type="button" className="block w-full rounded-lg p-1 text-left outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-400" onClick={()=>onSelect(row.name)} aria-pressed={selected===row.name}>{content}</button>:<div key={row.name}>{content}</div>;
  })}</div>;
}

export function PerformanceDonut({ rows, label = "전체" }: { rows: {name:string;value:number}[];label?:string }) {
  const positive=rows.filter(row=>row.value>0), total=positive.reduce((sum,row)=>sum+row.value,0);
  if (!total) return <EmptyPerformance/>;
  let offset=0;
  const gradient=positive.map((row,i)=>{const from=offset;offset+=row.value/total*100;return `${CHART_COLORS[i%CHART_COLORS.length]} ${from}% ${offset}%`;}).join(",");
  return <div className="flex flex-col items-center justify-center gap-6 p-5 sm:flex-row"><div className="relative size-40 shrink-0 rounded-full" style={{background:`conic-gradient(${gradient})`}} role="img" aria-label={positive.map(row=>`${row.name} ${row.value}건`).join(", ")}><div className="absolute inset-5 grid place-content-center rounded-full bg-white text-center"><span className="text-[11px] text-slate-400">{label}</span><b className="mt-1 text-2xl text-slate-900">{numberText(total)}</b></div></div><div className="w-full min-w-0 space-y-3">{positive.map((row,i)=><div key={row.name} className="flex items-center justify-between gap-3 text-xs"><div className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{backgroundColor:CHART_COLORS[i%CHART_COLORS.length]}}/><span className="truncate text-slate-600">{row.name}</span></div><div className="shrink-0"><b>{numberText(row.value)}건</b><span className="ml-2 text-slate-400">{(row.value/total*100).toFixed(1)}%</span></div></div>)}</div></div>;
}

export function savePerformanceCsv(rows: (string | number)[][], filename: string) {
  const csv=rows.map(row=>row.map(value=>`"${String(typeof value === "string" && /^[=+\-@\t\r]/.test(value)?`'${value}`:value).replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
