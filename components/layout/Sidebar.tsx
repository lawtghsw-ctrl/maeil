"use client";

// 도원 Admin(tg_m) components/sidebar.tsx와 동일한 구조(고정 사이드바 + 모바일 드로어)로
// 이식 — 메뉴/브랜딩만 로파워(회생·파산)에 맞게 교체. v25부터 Supabase Auth의 실제 로그인
// 프로필/역할을 표시하고, 사이드바에서 로그아웃할 수 있습니다.
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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

// v17: 상세 DB관리의 단계 타일을 DB관리 상단으로 통합했으므로 별도 메뉴를 제거했습니다.
// 기존 /db/detail 주소는 /db로 리다이렉트해 북마크 호환만 유지합니다.
export const menu = [
  ["대시보드", "/", LayoutDashboard],
  ["DB관리", "/db", Inbox],
  ["계약관리", "/cases", FileSignature],
  ["정산", "/settlements", Calculator],
  ["정산설정", "/settlement-settings", Percent],
  ["최저생계비 계산기", "/min-living-cost", Scale],
  ["기간별 변동내역", "/changes", History],
  ["데이터집계", "/analytics", Activity],
] as const;

function NavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  // 하위 상세 페이지에서도 가장 구체적으로 일치하는 메뉴 하나만 활성화되도록 계산합니다.
  const bestHref = menu.reduce<string | null>((best, [, href]) => {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (!matches) return best;
    if (best === null || href.length > best.length) return href;
    return best;
  }, null);

  return (
    <nav className="flex-1 overflow-y-auto p-3">
      {menu.map(([label, href, Icon]) => {
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
          <div className="grid size-9 place-items-center rounded-full bg-slate-800 text-xs font-bold text-white">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{name}</div>
            <div className="text-xs text-slate-500">{roleLabel}</div>
          </div>
          <button
            type="button"
            title="로그아웃"
            onClick={() => void signOut()}
            className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-red-600"
          >
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
      <div className="grid size-9 place-items-center rounded-lg bg-blue-600 text-white">
        <ShieldCheck size={19} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-slate-900">로파워</div>
        <div className="text-[10px] font-semibold tracking-widest text-slate-400">LAWPOWER ADMIN</div>
      </div>
      {close && (
        <button
          onClick={close}
          className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="메뉴 닫기"
        >
          <X size={20} />
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <Brand />
        <NavItems pathname={pathname} />
        <ProfileBlock />
      </aside>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-50 grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
        aria-label="메뉴 열기"
      >
        <Menu size={21} />
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            aria-label="메뉴 닫기"
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => setMobileOpen(false)}
          />
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
