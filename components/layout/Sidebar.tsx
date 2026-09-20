"use client";

// 도원 Admin(tg_m) components/sidebar.tsx와 동일한 구조(고정 사이드바 + 모바일 드로어)로
// 이식 — 메뉴/브랜딩만 로파워(회생·파산)에 맞게 교체. 별도 로그인 백엔드가 없으므로
// 프로필 블록은 데모용 고정 표기로 대체합니다.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FileSignature,
  Inbox,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// 도원 Admin(tg_m)과 동일하게 DB(리드) 관리를 고객관리보다 앞에 두고, '사건관리'는
// '계약관리'로 명칭을 통일, 별도였던 일정관리 메뉴는 없애고 내부 게시판을 추가함.
export const menu = [
  ["대시보드", "/", LayoutDashboard],
  ["DB관리", "/db", Inbox],
  ["고객관리", "/clients", Users],
  ["계약관리", "/cases", FileSignature],
  ["입금·분납", "/billing", WalletCards],
  ["게시판", "/board", MessagesSquare],
] as const;

function NavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto p-3">
      {menu.map(([label, href, Icon]) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
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
  return (
    <div className="border-t border-slate-100 p-4">
      <div className="rounded-xl bg-slate-50 p-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-full bg-slate-800 text-xs font-bold text-white">
            직
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">직원1</div>
            <div className="text-xs text-slate-500">STAFF · 데모 버전</div>
          </div>
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
