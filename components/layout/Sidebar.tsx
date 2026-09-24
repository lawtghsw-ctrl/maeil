"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  FileSignature,
  Calculator,
  History,
  Inbox,
  LayoutDashboard,
  Menu,
  Percent,
  Scale,
  ShieldCheck,
  LogOut,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import type { PermissionKey } from "@/lib/permissions";

type MenuItem = readonly [string, string, React.ComponentType<{ size?: number }>, PermissionKey | "admin"];

export const menu: MenuItem[] = [
  ["대시보드", "/", LayoutDashboard, "dashboard.view"],
  ["DB관리", "/db", Inbox, "db.view"],
  ["계약관리", "/cases", FileSignature, "cases.view"],
  ["정산", "/settlements", Calculator, "settlements.view"],
  ["정산설정", "/settlement-settings", Percent, "settlement_settings.view"],
  ["최저생계비 계산기", "/min-living-cost", Scale, "living.view"],
  ["기간별 변동내역", "/changes", History, "changes.view"],
  ["데이터집계", "/analytics", Activity, "analytics.view"],
  ["직원계정관리", "/staff-accounts", UsersRound, "admin"],
];

function NavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { isAdmin, can } = useStore();
  const visibleMenu = menu.filter(([, , , permission]) => permission === "admin" ? isAdmin : can(permission));
  const bestHref = visibleMenu.reduce<string | null>((best, [, href]) => {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (!matches) return best;
    if (best === null || href.length > best.length) return href;
    return best;
  }, null);

  return (
    <nav className="flex-1 overflow-y-auto p-3">
      {visibleMenu.map(([label, href, Icon]) => {
        const active = href === bestHref;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "mb-1 flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition",
              active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function ProfileBlock() {
  const { profile, currentUser, signOut } = useStore();
  const name = profile?.displayName || currentUser?.email?.split("@")[0] || "사용자";
  const roleLabel = profile?.role === "admin" ? "최종관리자" : profile?.staffName ? `STAFF · ${profile.staffName}` : "STAFF";
  const initial = name.trim().slice(0, 1) || "관";

  return (
    <div className="border-t border-slate-100 p-4">
      <div className="rounded-xl bg-slate-50 p-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-full bg-slate-800 text-xs font-bold text-white">{initial}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{name}</div>
            <div className="text-xs text-slate-500">{roleLabel}</div>
          </div>
          <button type="button" title="로그아웃" onClick={() => void signOut()} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-red-600">
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Brand({ close }: { close?: () => void }) {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5">
      <div className="grid size-9 place-items-center rounded-lg bg-blue-600 text-white"><ShieldCheck size={19} /></div>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-slate-900">로파워</div>
        <div className="text-[10px] font-semibold tracking-widest text-slate-400">LAWPOWER ADMIN</div>
      </div>
      {close && <button onClick={close} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="메뉴 닫기"><X size={20} /></button>}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <Brand />
        <NavItems pathname={pathname} />
        <ProfileBlock />
      </aside>
      <button onClick={() => setMobileOpen(true)} className="fixed left-3 top-3 z-50 grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden" aria-label="메뉴 열기"><Menu size={21} /></button>
      {mobileOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button aria-label="메뉴 닫기" className="absolute inset-0 bg-slate-950/35" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] max-w-[86vw] flex-col bg-white shadow-2xl">
            <Brand close={() => setMobileOpen(false)} />
            <NavItems pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <ProfileBlock />
          </aside>
        </div>
      )}
    </>
  );
}
