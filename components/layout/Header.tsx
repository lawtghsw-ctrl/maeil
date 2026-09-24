"use client";

// 도원 Admin(tg_m) components/header.tsx와 동일한 구조(검색 + 알림벨 + 새로고침)로 이식 —
// 검색 대상은 고객(의뢰인), 알림은 연체·실패 분납 + 오늘까지의 기일·제출기한, 신규 DB
// 뱃지는 DB관리의 미확인(신규접수) 리드 건수로 매핑.
import { Bell, CalendarClock, ChevronDown, ChevronUp, Clock3, Inbox, PhoneCall, RefreshCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
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

function kstDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function reservationTimeMs(value: string): number {
  // datetime-local 값은 타임존이 없으므로 KST(+09:00)로 명시해 서버/브라우저 위치와 무관하게 계산합니다.
  const normalized = value.length === 16 ? `${value}:00+09:00` : `${value}+09:00`;
  return new Date(normalized).getTime();
}

function formatReservationClock(value: string): string {
  const time = value.split("T")[1] ?? "";
  return time.slice(0, 5);
}

export function Header() {
  const { clients, installments, cases, scheduleItems, leads, isAdmin, currentStaff, profile } = useStore();
  const router = useRouter();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [reservationCallOpen, setReservationCallOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const todayIso = kstDateKey(new Date(nowMs));

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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

  // 최종관리자는 전체 예약을 보고, 추후 직원계정에는 본인 담당 예약만 노출합니다.
  // 예약 24시간 전부터 지난 24시간까지 계속 보여 단계 변경을 놓치지 않게 합니다.
  const reservationAlerts = useMemo(() => {
    const now = nowMs;
    const min = now - 24 * 60 * 60 * 1000;
    const max = now + 24 * 60 * 60 * 1000;
    return leads
      .filter((lead) => (isAdmin || (!!currentStaff && lead.assignedStaff === currentStaff)) && lead.detailStage === "예약" && !!lead.reservationAt)
      .map((lead) => ({ lead, at: reservationTimeMs(lead.reservationAt as string) }))
      .filter(({ at }) => Number.isFinite(at) && at >= min && at <= max)
      .sort((a, b) => a.at - b.at)
      .map(({ lead, at }) => ({
        id: `reservation-${lead.id}`,
        name: lead.name,
        phone: lead.phone,
        reservationAt: lead.reservationAt as string,
        overdue: at < now,
      }));
  }, [leads, nowMs, isAdmin, currentStaff]);

  // 로그인 담당자의 "오늘 예약콜"은 별도 고정 바에서 항상 확인할 수 있습니다.
  // 평소에는 노란색, 예약 10분 전부터(예약시간 경과 후 단계가 아직 예약인 경우 포함) 빨간색으로 강조합니다.
  const todayReservationCalls = useMemo(() => {
    const today = kstDateKey(new Date(nowMs));
    return leads
      .filter(
        (lead) =>
          (isAdmin || (!!currentStaff && lead.assignedStaff === currentStaff)) &&
          lead.detailStage === "예약" &&
          !!lead.reservationAt &&
          lead.reservationAt.slice(0, 10) === today
      )
      .map((lead) => ({
        lead,
        at: reservationTimeMs(lead.reservationAt as string),
      }))
      .filter(({ at }) => Number.isFinite(at))
      .sort((a, b) => a.at - b.at)
      .map(({ lead, at }) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        reservationAt: lead.reservationAt as string,
        at,
        urgent: at <= nowMs + 10 * 60 * 1000,
        overdue: at < nowMs,
      }));
  }, [leads, nowMs, isAdmin, currentStaff]);

  const hasUrgentReservation = todayReservationCalls.some((item) => item.urgent);
  const nextReservation = todayReservationCalls.find((item) => item.at >= nowMs) ?? todayReservationCalls[todayReservationCalls.length - 1];

  const alertCount = overdueAlerts.length + scheduleAlerts.length + reservationAlerts.length;
  const scopedLeads = isAdmin ? leads : leads.filter((l) => !!currentStaff && l.assignedStaff === currentStaff);
  const newLeadCount = scopedLeads.filter((l) => (l.detailStage ?? (l.status === "신규접수" || l.status === "상담예정" ? "신규디비" : "")) === "신규디비").length;
  const reservationOwnerLabel = isAdmin ? "전체 담당자" : currentStaff ?? profile?.displayName ?? "내 예약";

  function choose(id: string) {
    setQ("");
    setSearchOpen(false);
    const relatedCase = cases.find((record) => record.clientId === id);
    router.push(relatedCase ? `/cases/${relatedCase.id}` : "/cases");
  }

  return (
    <>
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
                  <div className="text-[11px] text-slate-400">확인할 업무 알림 {alertCount}건</div>
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
                    {reservationAlerts.slice(0, 8).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setNoticeOpen(false);
                          router.push("/db");
                        }}
                        className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-amber-50"
                      >
                        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
                          <CalendarClock size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <b className="truncate text-sm">상담예약 · {a.name}</b>
                            <span className={`shrink-0 text-[10px] font-bold ${a.overdue ? "text-red-600" : "text-amber-700"}`}>
                              {a.overdue ? "시간 경과" : "예정"}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            {new Date(a.reservationAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {a.phone}
                          </span>
                        </span>
                      </button>
                    ))}
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

    <div className="fixed right-4 top-[72px] z-40 hidden w-[360px] max-w-[calc(100vw-24px)] sm:block">
      <button
        type="button"
        onClick={() => setReservationCallOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left shadow-md transition ${
          hasUrgentReservation
            ? "border-red-400 bg-red-50 text-red-900 ring-2 ring-red-100"
            : "border-amber-300 bg-amber-50 text-amber-950"
        }`}
        title="오늘 예약콜 보기"
      >
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${hasUrgentReservation ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
          <PhoneCall size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs font-black">
            예약콜 · {reservationOwnerLabel}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${hasUrgentReservation ? "bg-red-600 text-white" : "bg-amber-600 text-white"}`}>
              {todayReservationCalls.length}건
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] font-semibold opacity-80">
            {nextReservation
              ? `${formatReservationClock(nextReservation.reservationAt)} ${nextReservation.name}${nextReservation.urgent ? " · 10분 이내/경과" : ""}`
              : "오늘 예정된 예약콜이 없습니다."}
          </span>
        </span>
        {reservationCallOpen ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
      </button>

      {reservationCallOpen && (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <div>
              <div className="text-sm font-bold text-slate-900">오늘 예약콜</div>
              <div className="text-[11px] text-slate-400">{reservationOwnerLabel} · 예약시간 순</div>
            </div>
            <button type="button" onClick={() => setReservationCallOpen(false)} className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {todayReservationCalls.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">오늘 예약된 고객이 없습니다.</div>
            ) : (
              todayReservationCalls.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setReservationCallOpen(false);
                    router.push("/db");
                  }}
                  className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 ${
                    item.urgent ? "bg-red-50 hover:bg-red-100" : "hover:bg-amber-50"
                  }`}
                >
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${item.urgent ? "bg-red-600 text-white" : "bg-amber-100 text-amber-700"}`}>
                    <Clock3 size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <b className="truncate text-sm text-slate-900">{item.name}</b>
                      <span className={`shrink-0 text-xs font-black ${item.urgent ? "text-red-700" : "text-amber-700"}`}>
                        {formatReservationClock(item.reservationAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">{item.phone}</span>
                    {item.urgent && (
                      <span className="mt-0.5 block text-[10px] font-bold text-red-600">
                        {item.overdue ? "예약시간 경과 · 확인 필요" : "예약 10분 이내 · 통화 준비"}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
}
