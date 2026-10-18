"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Activity, ChevronDown, BriefcaseBusiness, ChartNoAxesCombined, FileCheck2, Megaphone, Settings2, Building2, FileSignature, Calculator, History, Inbox, KeyRound, LayoutDashboard, Link2, Menu, MessageSquareText, Percent, Scale, LogOut, UsersRound, X, type LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils";
import { useStoreSession as useStore } from "@/lib/store";
import { authJson } from "@/lib/platform/client";
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

const platformMenu = [
  ["통합 관제 홈", "/platform", LayoutDashboard],
  ["공급 계약 · 이행", "/platform/contracts", FileCheck2],
  ["DB 원가 · 마진", "/platform/costs", ChartNoAxesCombined],
  ["메타 광고 · 광고비", "/platform/advertising", Megaphone],
  ["영업 파이프라인", "/platform/sales", BriefcaseBusiness],
  ["로파워 정산설정", "/platform/settings", Settings2],
  ["로펌 등록 · 관리", "/platform/firms", Building2],
  ["연동 모니터링 · 로그", "/platform/logs", Activity],
] as const;

function NavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const router = useRouter();
  const navId = useId();
  const { isAdmin, can, profile, superAdminFirmScope, firmDirectory, enterSuperAdminFirmScope, exitSuperAdminFirmScope } = useStore();
  const platformRole = profile?.platformRole ?? "staff";
  const isSuper = platformRole === "super_admin";
  const global = isSuper && !superAdminFirmScope;
  const [platformOpen, setPlatformOpen] = useState(true);
  const [firmOpen, setFirmOpen] = useState(true);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState("");
  const visible = useMemo(() => {
    const rows = baseMenu.filter(([, href, , permission]) => (!global || href === "/analytics") && (permission === "admin" ? isAdmin : can(permission))).map((row): MenuItem => row[1] === "/analytics" ? [global ? "전체 로펌 성과 · 통계" : "데이터집계", row[1], row[2], row[3]] : row);
    if (isSuper && superAdminFirmScope) rows.push(["로펌 설정/광고연동", `/firm/settings?lawFirmId=${encodeURIComponent(superAdminFirmScope.id)}`, Link2, "admin"]);
    else if (platformRole === "firm_admin") rows.push(["로펌 설정/직원초대", "/firm/settings", Link2, "admin"]);
    return rows;
  }, [can, isAdmin, isSuper, global, platformRole, superAdminFirmScope]);
  const isActive = (href: string) => { const clean = href.split("?")[0]; return clean === "/platform" ? pathname === "/platform" || (pathname === "/" && global) : clean === "/" ? pathname === "/" : pathname === clean || pathname.startsWith(`${clean}/`); };
  async function changeScope(value: string) {
    if (scopeBusy) return;
    if (!value) { exitSuperAdminFirmScope(); router.push("/platform"); onNavigate?.(); return; }
    const firm = firmDirectory.find((item) => item.id === value); if (!firm) return;
    setScopeBusy(true); setScopeError("");
    try {
      await authJson("/api/platform/firm-view", { method: "POST", body: JSON.stringify({lawFirmId: firm.id, action: "enter"}) });
      enterSuperAdminFirmScope(firm); router.push("/"); setFirmOpen(true); onNavigate?.();
    } catch (error) { setScopeError(error instanceof Error ? error.message : "로펌 화면을 열지 못했습니다."); }
    finally { setScopeBusy(false); }
  }
  const link = (label: string, href: string, Icon: LucideIcon) => <Link key={href} href={href} onClick={onNavigate} aria-current={isActive(href) ? "page" : undefined} className={cn("mb-1 flex min-h-10 items-center gap-2.5 rounded-lg py-2 pl-5 pr-2 text-xs font-semibold transition", isActive(href) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")}><Icon size={16} className="shrink-0"/>{label}</Link>;
  return <nav className="flex-1 overflow-y-auto p-3" aria-label="주 메뉴">
    {isSuper && <div className={`mb-3 rounded-xl border p-3 ${superAdminFirmScope ? "border-blue-100 bg-blue-50" : "border-violet-100 bg-violet-50"}`}>
      <label htmlFor={`${navId}-management-scope`} className="text-[10px] font-black tracking-wider text-violet-500">관리 범위</label>
      <select id={`${navId}-management-scope`} disabled={scopeBusy} value={superAdminFirmScope?.id ?? ""} onChange={(e) => void changeScope(e.target.value)} className="mt-2 h-9 w-full rounded-lg border border-white bg-white px-2 text-xs font-bold text-slate-800 shadow-sm outline-none"><option value="">전체 로펌 통합보기</option>{firmDirectory.map((firm) => <option key={firm.id} value={firm.id}>{firm.name} · {firm.firmCode}</option>)}</select>
      <div className="mt-2 text-[10px] leading-4 text-slate-500">{superAdminFirmScope ? `로파워 운영진으로 보는 중 · ${superAdminFirmScope.name}` : "계약 이행·원가·로펌 성과 통합 관제"}</div>
      {scopeError && <p role="alert" className="mt-2 text-xs text-red-600">{scopeError}</p>}
    </div>}
    {isSuper && <section className="mb-3">
      <button type="button" aria-expanded={platformOpen} aria-controls={`${navId}-platform-navigation`} onClick={() => setPlatformOpen(value => !value)} className="mb-1 flex w-full items-center gap-2 rounded-xl bg-blue-50 px-3 py-3 text-sm font-bold text-blue-700"><Building2 size={18}/>로파워 운영<ChevronDown size={17} className={cn("ml-auto transition-transform", !platformOpen && "-rotate-90")}/></button>
      <div id={`${navId}-platform-navigation`} hidden={!platformOpen}>{platformMenu.map(([label, href, Icon]) => link(label, href, Icon))}</div>
    </section>}
    <section className="mb-3">
      <button type="button" aria-expanded={firmOpen} aria-controls={`${navId}-firm-navigation`} onClick={() => setFirmOpen(value => !value)} className="mb-1 flex w-full items-center gap-2 rounded-xl bg-slate-100 px-3 py-3 text-sm font-bold text-slate-800"><Scale size={18}/>로펌 운영<ChevronDown size={17} className={cn("ml-auto transition-transform", !firmOpen && "-rotate-90")}/></button>
      <div id={`${navId}-firm-navigation`} hidden={!firmOpen}>{global && <p className="px-3 py-2 text-[11px] leading-5 text-slate-500">관리 범위에서 로펌을 선택하면 DB·계약·문자 등 해당 로펌의 업무 메뉴가 열립니다.</p>}{visible.map(([label, href, Icon]) => link(label, href, Icon))}</div>
    </section>
    {link("내 계정", "/account", KeyRound)}
  </nav>;
}

function ProfileBlock() {
  const { profile, currentUser, signOut, superAdminFirmScope } = useStore();
  const name = profile?.displayName || currentUser?.email?.split("@")[0] || "사용자"; const initial = name.trim().slice(0, 1) || "관";
  const roleLabel = profile?.platformRole === "super_admin" ? superAdminFirmScope ? `로파워 최상위 · ${superAdminFirmScope.name}` : "로파워 최상위 · 전체 로펌" : profile?.platformRole === "firm_admin" ? "로펌 관리자" : profile?.staffName ? `STAFF · ${profile.staffName}` : "STAFF";
  return <div className="border-t border-slate-100 p-4"><div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-slate-800 text-xs font-bold text-white">{initial}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{name}</div><div className="truncate text-xs text-slate-500">{roleLabel}</div></div><button type="button" title="로그아웃" onClick={() => void signOut()} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-red-600"><LogOut size={15}/></button></div></div></div>;
}
function Brand({ close }: { close?: () => void }) { const { superAdminFirmScope, profile } = useStore(); const subtitle = profile?.platformRole === "super_admin" ? (superAdminFirmScope?.name ?? "ALL FIRMS") : "LAWPOWER ADMIN"; return <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-5"><BrandLogo/><div className="min-w-0 flex-1"><div className="font-bold text-slate-900">로파워</div><div className="truncate text-[10px] font-semibold tracking-widest text-slate-400">{subtitle}</div></div>{close&&<button onClick={close} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="메뉴 닫기"><X size={20}/></button>}</div>; }
export function Sidebar(){const pathname=usePathname();const[mobileOpen,setMobileOpen]=useState(false);useEffect(()=>setMobileOpen(false),[pathname]);return <><aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-slate-200 bg-white lg:flex lg:flex-col"><Brand/><NavItems pathname={pathname}/><ProfileBlock/></aside><button onClick={()=>setMobileOpen(true)} className="fixed left-3 top-3 z-50 grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden" aria-label="메뉴 열기"><Menu size={21}/></button>{mobileOpen&&<div className="fixed inset-0 z-[80] lg:hidden"><button aria-label="메뉴 닫기" className="absolute inset-0 bg-slate-950/35" onClick={()=>setMobileOpen(false)}/><aside className="absolute inset-y-0 left-0 flex w-[280px] max-w-[86vw] flex-col bg-white shadow-2xl"><Brand close={()=>setMobileOpen(false)}/><NavItems pathname={pathname} onNavigate={()=>setMobileOpen(false)}/><ProfileBlock/></aside></div>}</>;}
