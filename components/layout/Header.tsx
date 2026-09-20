"use client";

// 도원 Admin(tg_m) components/header.tsx와 동일한 구조(검색 + 알림벨 + 새로고침)로 이식 —
// 검색 대상은 고객(의뢰인), 알림은 연체·실패 분납 + 오늘까지의 기일·제출기한, 신규 DB
// 뱃지는 DB관리의 미확인(신규접수) 리드 건수로 매핑.
import { Bell, Inbox, RefreshCcw, Search, X } from "lucide-react";
import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { fmtDate, fmtWon } from "@/lib/format";

function kstDate(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function Header() {
  const { clients, installments, cases, scheduleItems, leads } = useStore();
  const router = useRouter();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);

  const matches = useMemo(
    () =>
      q.trim()
        ? clients.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
        : [],
    [q, clients]
  );

  const overdueAlerts = useMemo(
    () =>
      installments
        .filter((i) => (i.status === "연체" || i.status === "실패") && i.dueDate <= todayIso)
        .map((i) => {
          const c = cases.find((x) => x.id === i.caseId);
          const client = c ? clients.find((x) => x.id === c.clientId) : undefined;
          return { id: i.id, name: client?.name ?? "삭제된 고객", amount: i.amount, dueDate: i.dueDate, status: i.status };
        }),
    [installments, cases, clients, todayIso]
  );
  const scheduleAlerts = useMemo(
    () =>
      scheduleItems
        .filter((s) => !s.done && s.date <= todayIso)
        .map((s) => {
          const c = s.caseId ? cases.find((x) => x.id === s.caseId) : undefined;
          const client = c ? clients.find((x) => x.id === c.clientId) : undefined;
          return { id: s.id, name: client?.name ?? "-", title: s.title, date: s.date, type: s.type };
        }),
    [scheduleItems, cases, clients, todayIso]
  );
  const alertCount = overdueAlerts.length + scheduleAlerts.length;
  const newLeadCount = leads.filter((l) => l.status === "신규접수").length;

  function choose(id: string) {
    setQ("");
    setSearchOpen(false);
    router.push(`/clients?client=${encodeURIComponent(id)}`);
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 pl-16 pr-4 backdrop-blur lg:px-7">
      <div className="relative hidden w-full max-w-md md:block">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setQ(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter" && matches[0]) choose(matches[0].id);
          }}
          placeholder="고객명 또는 전화번호 검색"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
        {searchOpen && q.trim() && (
          <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            {matches.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">일치하는 고객이 없습니다.</div>
            ) : (
              matches.map((c) => (
                <button
                  key={c.id}
                  onClick={() => choose(c.id)}
                  className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-blue-50"
                >
                  <div>
                    <div className="text-sm font-semibold">{c.name}</div>
                    <div className="text-xs text-slate-400">{c.phone}</div>
                  </div>
                  <span className="text-xs text-slate-500">{c.assignedStaff ?? "-"}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {newLeadCount > 0 && (
          <button
            type="button"
            onClick={() => router.push("/db")}
            className="new-db-alert-pulse flex h-9 max-w-[290px] items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-left shadow-sm transition hover:border-amber-400 hover:bg-amber-100 sm:px-3"
            title={`신규 DB ${newLeadCount}건 · DB관리 화면으로 이동`}
            aria-live="polite"
          >
            <span className="relative grid size-5 shrink-0 place-items-center rounded-full bg-amber-500 text-white">
              <Inbox size={12} />
              <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-red-500" />
            </span>
            <span className="min-w-0">
              <span className="hidden truncate text-[11px] font-bold text-amber-950 sm:block">
                신규 DB가 접수되었습니다. 확인 바랍니다.
              </span>
              <span className="truncate text-[11px] font-bold text-amber-950 sm:hidden">신규 DB 확인</span>
            </span>
            <span className="ml-auto shrink-0 rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
              {newLeadCount > 99 ? "99+" : newLeadCount}
            </span>
          </button>
        )}
        <button
          onClick={() => window.location.reload()}
          title="새로고침"
          className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
        >
          <RefreshCcw size={16} />
        </button>
        <div className="relative">
          <button
            onClick={() => setNoticeOpen((v) => !v)}
            title="알림"
            className="relative grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <Bell size={17} />
            {alertCount > 0 && (
              <span className="absolute right-1 top-1 min-w-4 rounded-full bg-blue-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </button>
          {noticeOpen && (
            <div className="absolute right-0 top-11 z-50 w-[calc(100vw-24px)] max-w-[360px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <div className="text-sm font-bold">업무 알림</div>
                  <div className="text-[11px] text-slate-400">오늘까지 확인할 일정 {alertCount}건</div>
                </div>
                <button
                  onClick={() => setNoticeOpen(false)}
                  className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {alertCount === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">확인할 알림이 없습니다.</div>
                ) : (
                  <>
                    {overdueAlerts.slice(0, 8).map((a) => (
                      <div key={a.id} className="border-b border-slate-100 px-4 py-3">
                        <div className="flex justify-between">
                          <b className="text-sm">분납 {a.status} · {a.name}</b>
                          <span className="text-xs font-semibold text-blue-700">{fmtWon(a.amount)}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">{fmtDate(a.dueDate)}</div>
                      </div>
                    ))}
                    {scheduleAlerts.slice(0, 8).map((a) => (
                      <div key={a.id} className="border-b border-slate-100 px-4 py-3">
                        <div className="flex justify-between">
                          <b className="text-sm">{a.type} · {a.name}</b>
                          <span className="text-xs font-semibold text-amber-700">{a.title}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">{fmtDate(a.date)}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="ml-1 hidden text-right sm:block">
          <div className="text-xs font-semibold text-slate-800">{kstDate()}</div>
          <div className="text-[11px] text-slate-400">KST</div>
        </div>
      </div>
    </header>
  );
}
