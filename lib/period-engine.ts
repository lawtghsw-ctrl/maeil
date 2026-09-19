// 기간 엔진 — 로피(LawFee) 고객사 대시보드 스펙의 "4.기간엔진 로직·코드" 시트를
// TypeScript로 이식한 버전. 년/월/주/일 탭 전환, 이전/다음 기간 이동(미래 차단),
// 월 상대 주차 라벨링, 구간 합산, 전기간 대비 증감률 계산을 동일한 규칙으로 재구현함.

import type { CaseType, DayAggregate } from "./types";

export type PeriodMode = "year" | "month" | "week" | "day";

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

export function addYears(d: Date, n: number): Date {
  const r = new Date(d);
  r.setFullYear(r.getFullYear() + n);
  return r;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isoStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function clampToToday(d: Date, today: Date): Date {
  const t0 = startOfDay(today);
  return d > t0 ? t0 : d;
}

// 월 1일 기준 7일 단위 블록으로 월-상대 주차를 계산 (ISO 연간주차 미사용)
export function weekOfMonthIndex(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

export interface PeriodBounds {
  start: Date;
  naturalEnd: Date;
  end: Date; // '오늘'을 넘지 않도록 클램프된 종료일 — 진행중 기간은 오늘까지만 집계
}

export function periodBounds(
  mode: PeriodMode,
  anchor: Date,
  today: Date = new Date()
): PeriodBounds {
  let start: Date;
  let naturalEnd: Date;
  if (mode === "year") {
    start = new Date(anchor.getFullYear(), 0, 1);
    naturalEnd = new Date(anchor.getFullYear(), 11, 31);
  } else if (mode === "month") {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    naturalEnd = new Date(
      anchor.getFullYear(),
      anchor.getMonth(),
      daysInMonth(anchor.getFullYear(), anchor.getMonth())
    );
  } else if (mode === "week") {
    const dom = anchor.getDate();
    const blockStart = Math.floor((dom - 1) / 7) * 7 + 1;
    start = new Date(anchor.getFullYear(), anchor.getMonth(), blockStart);
    naturalEnd = addDays(start, 6);
  } else {
    start = startOfDay(anchor);
    naturalEnd = new Date(start);
  }
  return { start, naturalEnd, end: clampToToday(naturalEnd, today) };
}

export function nextAnchor(mode: PeriodMode, anchor: Date): Date {
  if (mode === "year") return addYears(anchor, 1);
  if (mode === "month") return addMonths(anchor, 1);
  if (mode === "week") return addDays(anchor, 7);
  return addDays(anchor, 1);
}

export function prevAnchor(mode: PeriodMode, anchor: Date): Date {
  if (mode === "year") return addYears(anchor, -1);
  if (mode === "month") return addMonths(anchor, -1);
  if (mode === "week") return addDays(anchor, -7);
  return addDays(anchor, -1);
}

// 다음(›) 이동 시 차단 여부 — 다음 기간의 '시작일'이 오늘보다 미래면 이동 차단
export function isNextBlocked(
  mode: PeriodMode,
  anchor: Date,
  today: Date = new Date()
): boolean {
  const na = nextAnchor(mode, anchor);
  const { start } = periodBounds(mode, na, today);
  return start > startOfDay(today);
}

export interface RangeSum {
  newConsultCount: number;
  newContractCount: number;
  contractAmount: number;
  paymentAmount: number;
  caseTypeSplit: Record<CaseType, number>; // 결제완료액 기준 구성비 절대금액
}

const emptySplit = (): Record<CaseType, number> => ({
  개인회생: 0,
  개인파산: 0,
});

// dayMap: 날짜(YYYY-MM-DD) → 그날의 집계 데이터
export function sumRange(
  start: Date,
  end: Date,
  dayMap: Map<string, DayAggregate>
): RangeSum {
  let newConsultCount = 0;
  let newContractCount = 0;
  let contractAmount = 0;
  let paymentAmount = 0;
  const caseTypeSplit = emptySplit();

  let cur = new Date(start);
  const endClamped = end;
  while (cur <= endClamped) {
    const day = dayMap.get(isoStr(cur));
    if (day) {
      newConsultCount += day.newConsultCount;
      newContractCount += day.newContractCount;
      contractAmount += day.contractAmount;
      paymentAmount += day.paymentAmount;
      (Object.keys(caseTypeSplit) as CaseType[]).forEach((k) => {
        caseTypeSplit[k] += day.paymentAmount * (day.caseTypeSplit[k] ?? 0);
      });
    }
    cur = addDays(cur, 1);
  }

  return { newConsultCount, newContractCount, contractAmount, paymentAmount, caseTypeSplit };
}

export interface PeriodStats {
  mode: PeriodMode;
  bounds: PeriodBounds;
  current: RangeSum;
  previous: RangeSum;
  receivableTotal: number; // 미수금 = 계약금액 - 결제(입금)액, 선택 구간 기준
  deltas: {
    newContractCount: number;
    contractAmount: number;
    paymentAmount: number;
    receivable: number;
  };
}

function pct(c: number, p: number): number {
  if (p === 0) return c === 0 ? 0 : 100;
  return ((c - p) / p) * 100;
}

// '전기간'은 항상 같은 mode의 바로 이전 구간(전년/전월/전주/전일)으로 자동 계산됨
export function computeStats(
  mode: PeriodMode,
  anchor: Date,
  dayMap: Map<string, DayAggregate>,
  today: Date = new Date()
): PeriodStats {
  const bounds = periodBounds(mode, anchor, today);
  const current = sumRange(bounds.start, bounds.end, dayMap);

  const pAnchor = prevAnchor(mode, anchor);
  const prevBounds = periodBounds(mode, pAnchor, today);
  const previous = sumRange(prevBounds.start, prevBounds.end, dayMap);

  const curReceivable = current.contractAmount - current.paymentAmount;
  const prevReceivable = previous.contractAmount - previous.paymentAmount;

  return {
    mode,
    bounds,
    current,
    previous,
    receivableTotal: curReceivable,
    deltas: {
      newContractCount: pct(current.newContractCount, previous.newContractCount),
      contractAmount: pct(current.contractAmount, previous.contractAmount),
      paymentAmount: pct(current.paymentAmount, previous.paymentAmount),
      receivable: pct(curReceivable, prevReceivable),
    },
  };
}

// 청구·결제 현황용 슬라이싱 옵션 — 년→월별만, 월→주별/일별, 주→일별만
export const GRAN_OPTIONS: Record<PeriodMode, Array<"month" | "week" | "day">> = {
  year: ["month"],
  month: ["week", "day"],
  week: ["day"],
  day: [],
};

export interface Bucket {
  label: string;
  range: string; // 날짜구간 표기, 예: 8.08-8.14
  contractAmount: number;
  paymentAmount: number;
}

// 월 모드에서 '기간별 통계'의 주별 버킷 생성 (아직 시작 안 한 주차는 생성하지 않음)
export function weekBucketsOfMonth(
  year: number,
  month: number, // 0-indexed
  dayMap: Map<string, DayAggregate>,
  today: Date = new Date()
): Bucket[] {
  const total = daysInMonth(year, month);
  const buckets: Bucket[] = [];
  for (let blockStart = 1; blockStart <= total; blockStart += 7) {
    const s = new Date(year, month, blockStart);
    if (s > startOfDay(today)) break;
    const blockEndDay = Math.min(blockStart + 6, total);
    const e = clampToToday(new Date(year, month, blockEndDay), today);
    const range = sumRange(s, e, dayMap);
    const wk = weekOfMonthIndex(s);
    buckets.push({
      label: `${wk}주차`,
      range: `${month + 1}.${String(blockStart).padStart(2, "0")}-${month + 1}.${String(
        blockEndDay
      ).padStart(2, "0")}`,
      contractAmount: range.contractAmount,
      paymentAmount: range.paymentAmount,
    });
  }
  return buckets;
}

export function dayBucketsOfRange(
  start: Date,
  end: Date,
  dayMap: Map<string, DayAggregate>
): Bucket[] {
  const buckets: Bucket[] = [];
  let cur = new Date(start);
  while (cur <= end) {
    const day = dayMap.get(isoStr(cur));
    buckets.push({
      label: `${cur.getMonth() + 1}.${String(cur.getDate()).padStart(2, "0")}`,
      range: isoStr(cur),
      contractAmount: day?.contractAmount ?? 0,
      paymentAmount: day?.paymentAmount ?? 0,
    });
    cur = addDays(cur, 1);
  }
  return buckets;
}

export function monthBucketsOfYear(
  year: number,
  dayMap: Map<string, DayAggregate>,
  today: Date = new Date()
): Bucket[] {
  const buckets: Bucket[] = [];
  for (let m = 0; m < 12; m++) {
    const s = new Date(year, m, 1);
    if (s > startOfDay(today)) break;
    const e = clampToToday(new Date(year, m, daysInMonth(year, m)), today);
    const range = sumRange(s, e, dayMap);
    buckets.push({
      label: `${m + 1}월`,
      range: `${year}.${String(m + 1).padStart(2, "0")}`,
      contractAmount: range.contractAmount,
      paymentAmount: range.paymentAmount,
    });
  }
  return buckets;
}

export interface PeriodHeadline {
  periodLabel: string;
  isOngoing: boolean; // true=진행중(오늘 포함, 현재형 문장), false=완결된 과거 기간(과거형 문장)
}

export function periodHeadline(
  mode: PeriodMode,
  bounds: PeriodBounds,
  today: Date = new Date()
): PeriodHeadline {
  const isOngoing = bounds.naturalEnd >= startOfDay(today) && bounds.start <= startOfDay(today);
  const periodLabel =
    mode === "year"
      ? `${bounds.start.getFullYear()}년`
      : mode === "month"
      ? `${bounds.start.getFullYear()}년 ${bounds.start.getMonth() + 1}월`
      : mode === "week"
      ? `${bounds.start.getMonth() + 1}월 ${weekOfMonthIndex(bounds.start)}주차`
      : `${bounds.start.getMonth() + 1}월 ${bounds.start.getDate()}일`;
  return { periodLabel, isOngoing };
}
