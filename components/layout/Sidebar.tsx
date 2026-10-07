"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Activity, Building2, FileSignature, Calculator, History, Inbox, KeyRound, LayoutDashboard, Link2, Menu, MessageSquareText, Percent, Scale, ShieldCheck, LogOut, UsersRound, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import type { PermissionKey } from "@/lib/permissions";

type MenuItem = readonly [string, string, LucideIcon, PermissionKey | "admin"];
const baseMenu: MenuItem[] = [
  ["대시보드", "/", LayoutDashboard, "dashboard.view"],
  ["DB관리", "/db", Inbox, "db.view"],
  ["계약관리", "/cases", FileSignature, "cases.view"],
  ["문자발송", "/sms", MessageSquareText, "sms.view"],
  ["정산", "/settlements", Calculator, "settlements.view"],
  ["정산설정", "/settlement-settings", Percent, "admin"],
  ["최저생계비 계산기", "/min-living-cost", Scale, "living.view"],
  ["기간별 변동내역", "/changes", History, "changes.view"],
  ["데이터집계", "/analytics", Activity, "admin"],
  ["직원계정관리", "/staff-accounts", UsersRound, "admin"],
];

function NavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const router = useRouter();
  const { isAdmin, can, profile, superAdminFirmScope, firmDirectory, enterSuperAdminFirmScope, exitSuperAdminFirmScope } = useStore();
  const platformRole = profile?.platformRole ?? "staff";
  const isSuper = platformRole === "super_admin";
  const visible = useMemo(() => {
    const rows = baseMenu.filter(([, , , permission]) => permission === "admin" ? isAdmin : can(permission));
    if (isSuper) rows.unshift(["로파워 플랫폼", "/platform", Building2, "admin"]);
    if (isSuper && superAdminFirmScope) rows.push(["로펌 설정/광고연동", `/firm/settings?lawFirmId=${encodeURIComponent(superAdminFirmScope.id)}`, Link2, "admin"]);
    else if (platformRole === "firm_admin") rows.push(["로펌 설정/직원초대", "/firm/settings", Link2, "admin"]);
    rows.push(["내 계정", "/account", KeyRound, "admin"]);
    return rows;
  }, [can, isAdmin, isSuper, platformRole, superAdminFirmScope]);

  const best = visible.reduce<string | null>((current, [, href]) => {
    const cleanHref = href.split("?")[0];
    const matches = cleanHref === "/" ? pathname === "/" : pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
    return matches && (current === null || cleanHref.length > current.length) ? cleanHref : current;
  }, null);

  function changeScope(value: string) {
    if (!value) { exitSuperAdminFirmScope(); router.push("/"); router.refresh(); onNavigate?.(); return; }
    const firm = firmDirectory.find((item) => item.id === value); if (!firm) return;
    enterSuperAdminFirmScope(firm); router.push("/"); router.refresh(); onNavigate?.();
  }

  return <nav className="flex-1 overflow-y-auto p-3">
    {isSuper && <div className={`mb-3 rounded-xl border p-3 ${superAdminFirmScope ? "border-blue-100 bg-blue-50" : "border-violet-100 bg-violet-50"}`}>
      <div className={`text-[10px] font-black tracking-wider ${superAdminFirmScope ? "text-blue-500" : "text-violet-500"}`}>관리 범위</div>
      <select value={superAdminFirmScope?.id ?? ""} onChange={(e) => changeScope(e.target.value)} className="mt-2 h-9 w-full rounded-lg border border-white bg-white px-2 text-xs font-bold text-slate-800 shadow-sm outline-none"><option value="">전체 로펌 통합보기</option>{firmDirectory.map((firm) => <option key={firm.id} value={firm.id}>{firm.name} · {firm.firmCode}</option>)}</select>
      <div className="mt-2 text-[10px] leading-4 text-slate-500">{superAdminFirmScope ? `${superAdminFirmScope.name} 데이터만 표시 · 전체 수정 가능` : "모든 로펌 데이터 통합 표시 · 안전을 위해 조회 전용"}</div>
    </div>}
    {visible.map(([label, href, Icon]) => { const cleanHref = href.split("?")[0]; return <Link key={`${label}-${href}`} href={href} onClick={onNavigate} className={cn("mb-1 flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition", cleanHref === best ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")}><Icon size={18}/>{label}</Link>; })}
  </nav>;
}

function ProfileBlock() {
  const { profile, currentUser, signOut, superAdminFirmScope } = useStore();
  const name = profile?.displayName || currentUser?.email?.split("@")[0] || "사용자"; const initial = name.trim().slice(0, 1) || "관";
  const roleLabel = profile?.platformRole === "super_admin" ? superAdminFirmScope ? `로파워 최상위 · ${superAdminFirmScope.name}` : "로파워 최상위 · 전체 로펌" : profile?.platformRole === "firm_admin" ? "로펌 관리자" : profile?.staffName ? `STAFF · ${profile.staffName}` : "STAFF";
  return <div className="border-t border-slate-100 p-4"><div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-slate-800 text-xs font-bold text-white">{initial}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{name}</div><div className="truncate text-xs text-slate-500">{roleLabel}</div></div><button type="button" title="로그아웃" onClick={() => void signOut()} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-red-600"><LogOut size={15}/></button></div></div></div>;
}
function Brand({ close }: { close?: () => void }) { const { superAdminFirmScope, profile } = useStore(); const subtitle = profile?.platformRole === "super_admin" ? (superAdminFirmScope?.name ?? "ALL FIRMS") : "LAWPOWER ADMIN"; return <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5"><div className="grid size-9 place-items-center rounded-lg bg-blue-600 text-white"><ShieldCheck size={19}/></div><div className="min-w-0 flex-1"><div className="font-bold text-slate-900">로파워</div><div className="truncate text-[10px] font-semibold tracking-widest text-slate-400">{subtitle}</div></div>{close&&<button onClick={close} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="메뉴 닫기"><X size={20}/></button>}</div>; }
export function Sidebar(){const pathname=usePathname();const[mobileOpen,setMobileOpen]=useState(false);useEffect(()=>setMobileOpen(false),[pathname]);return <><aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-slate-200 bg-white lg:flex lg:flex-col"><Brand/><NavItems pathname={pathname}/><ProfileBlock/></aside><button onClick={()=>setMobileOpen(true)} className="fixed left-3 top-3 z-50 grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden" aria-label="메뉴 열기"><Menu size={21}/></button>{mobileOpen&&<div className="fixed inset-0 z-[80] lg:hidden"><button aria-label="메뉴 닫기" className="absolute inset-0 bg-slate-950/35" onClick={()=>setMobileOpen(false)}/><aside className="absolute inset-y-0 left-0 flex w-[280px] max-w-[86vw] flex-col bg-white shadow-2xl"><Brand close={()=>setMobileOpen(false)}/><NavItems pathname={pathname} onNavigate={()=>setMobileOpen(false)}/><ProfileBlock/></aside></div>}</>;}
