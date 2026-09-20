"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "대시보드", icon: "🏠" },
  { href: "/clients", label: "고객관리", icon: "👤" },
  { href: "/db", label: "DB관리", icon: "📥" },
  { href: "/cases", label: "사건관리", icon: "📁" },
  { href: "/billing", label: "입금·분납", icon: "💳" },
  { href: "/schedule", label: "일정관리", icon: "📅" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-navy px-3 py-5 text-white lg:flex">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md2 bg-brand text-sm font-bold">
          LP
        </div>
        <div>
          <div className="text-sm font-bold leading-tight">로파워</div>
          <div className="text-[11px] text-white/50 leading-tight">LawPower Admin</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-md2 px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-navy-3 text-white"
                  : "text-white/60 hover:bg-navy-2 hover:text-white"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-light" />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-md2 bg-navy-2 px-3 py-3 text-[11px] text-white/50">
        회생/파산 사건관리 어드민
        <br />
        v0.1 · 로피 디자인 시스템 참고
      </div>
    </aside>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white lg:hidden">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              active ? "text-brand" : "text-muted"
            }`}
          >
            <span aria-hidden className="text-base">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
