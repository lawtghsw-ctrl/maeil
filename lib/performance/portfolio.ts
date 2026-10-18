import {
  buildFirmPerformanceReport, performanceRange,
  type DailyPerformance, type FirmPerformanceInput, type FirmPerformanceReport,
  type PerformanceMetrics, type PerformanceQuality,
} from "./firm";

export type PortfolioScope = "active" | "all";
export interface PortfolioFirmIdentity { firmId: string; firmName: string; status: string; isDemo?: boolean }
export interface PortfolioFirmPerformance extends PortfolioFirmIdentity {
  summary: PerformanceMetrics;
  previous: PerformanceMetrics;
  quality: PerformanceQuality;
}
/** Server-only intermediate: no customer records or merged staff identities. */
export interface PortfolioFirmSnapshot extends PortfolioFirmPerformance {
  trend: DailyPerformance[];
  funnel: FirmPerformanceReport["funnel"];
  caseTypes: FirmPerformanceReport["caseTypes"];
  stages: FirmPerformanceReport["stages"];
}
export interface PortfolioAverage {
  db: number; contracts: number; contractAmount: number; cash: number;
  /** Unweighted mean of firm conversion rates; no-intake firms are excluded. */
  conversionRate: number | null;
  conversionFirmCount: number;
}
export interface PortfolioPerformanceReport {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  generatedAt: string;
  scope: PortfolioScope;
  includeDemo: boolean;
  excludedDemoCount: number;
  /** Current selected firms, including zero-activity firms, in both periods. */
  firmCount: number;
  summary: PerformanceMetrics;
  previous: PerformanceMetrics;
  average: PortfolioAverage;
  previousAverage: PortfolioAverage;
  trend: DailyPerformance[];
  averageTrend: DailyPerformance[];
  funnel: FirmPerformanceReport["funnel"];
  caseTypes: FirmPerformanceReport["caseTypes"];
  stages: FirmPerformanceReport["stages"];
  firms: PortfolioFirmPerformance[];
  quality: PerformanceQuality;
}

export function portfolioScope(value: string | null | undefined): PortfolioScope {
  if (value === null || value === undefined || value === "" || value === "active") return "active";
  if (value === "all") return "all";
  throw new Error("로펌 범위는 이용중 또는 전체로 선택해주세요.");
}

export function isDemoPortfolioFirm(firm: { firm_code?: unknown; name?: unknown }): boolean {
  return firm.firm_code === "0000000000" && firm.name === "TEST";
}

/** Every tenant is aggregated separately before totals are combined. An equal
 * case/lead/client ID or staff name in another tenant cannot join this tenant. */
export function buildPortfolioFirmSnapshot(input: FirmPerformanceInput, start: string, end: string, firm: PortfolioFirmIdentity, now = new Date()): PortfolioFirmSnapshot {
  const report = buildFirmPerformanceReport(input, start, end, { firmId: firm.firmId, firmName: firm.firmName }, undefined, now);
  return { ...firm, summary: report.summary, previous: report.previous, quality: report.quality,
    trend: report.trend, funnel: report.funnel, caseTypes: report.caseTypes, stages: report.stages };
}

function add(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isFinite(sum) || Math.abs(sum) > Number.MAX_SAFE_INTEGER) throw new Error("집계 금액 또는 건수가 안전한 계산 범위를 넘었습니다. 기간을 줄여주세요.");
  return sum;
}
function addMetrics(target: PerformanceMetrics, source: PerformanceMetrics) {
  for (const key of Object.keys(target) as Array<keyof PerformanceMetrics>) {
    if (key !== "conversionRate" && key !== "contractConversionRate") target[key] = add(target[key], source[key]);
  }
  // Weighted by intake volume; never average individual firms' percentages.
  target.conversionRate = target.db ? target.converted / target.db * 100 : 0;
  target.contractConversionRate = target.db ? target.contractedDb / target.db * 100 : 0;
}
function average(metrics: PerformanceMetrics, count: number, firms: readonly PerformanceMetrics[]): PortfolioAverage {
  const conversionFirms = firms.filter(firm => firm.db > 0);
  return { db: count ? metrics.db / count : 0, contracts: count ? metrics.contracts / count : 0,
    contractAmount: count ? metrics.contractAmount / count : 0, cash: count ? metrics.cash / count : 0,
    conversionRate: conversionFirms.length ? conversionFirms.reduce((sum, firm) => sum + firm.converted / firm.db * 100, 0) / conversionFirms.length : null,
    conversionFirmCount: conversionFirms.length };
}

export function summarizePortfolioPerformance(
  snapshots: readonly PortfolioFirmSnapshot[], start: string, end: string, scope: PortfolioScope = "active", now = new Date(),
  options: { includeDemo?: boolean; excludedDemoCount?: number } = {},
): PortfolioPerformanceReport {
  const range = performanceRange(start, end);
  const empty = buildFirmPerformanceReport({ leads: [], cases: [], clients: [], installments: [] }, start, end, { firmId: "", firmName: "" }, undefined, now);
  const summary = { ...empty.summary }, previous = { ...empty.previous }, quality = { ...empty.quality };
  const trend = new Map(empty.trend.map(day => [day.date, { ...day }]));
  const funnel = new Map<string, number>(), stages = new Map<string, number>();
  const caseTypes = new Map<string, FirmPerformanceReport["caseTypes"][number]>();
  const firms: PortfolioFirmPerformance[] = [];
  const includeDemo = options.includeDemo === true;
  let excludedDemoCount = includeDemo ? 0 : options.excludedDemoCount ?? 0;
  const seen = new Set<string>();
  for (const firm of snapshots) {
    if (scope === "active" && firm.status !== "active") continue;
    if (!includeDemo && firm.isDemo) { excludedDemoCount += 1; continue; }
    if (seen.has(firm.firmId)) throw new Error("로펌이 중복되어 성과를 집계할 수 없습니다.");
    seen.add(firm.firmId);
    addMetrics(summary, firm.summary); addMetrics(previous, firm.previous);
    for (const key of Object.keys(quality) as Array<keyof PerformanceQuality>) quality[key] = add(quality[key], firm.quality[key]);
    for (const day of firm.trend) {
      const total = trend.get(day.date);
      if (!total) throw new Error("로펌별 집계 기간이 일치하지 않습니다.");
      for (const key of ["db", "converted", "contracts", "contractAmount", "cash"] as const) total[key] = add(total[key], day[key]);
    }
    for (const row of firm.funnel) funnel.set(row.name, add(funnel.get(row.name) ?? 0, row.count));
    for (const row of firm.stages) stages.set(row.name, add(stages.get(row.name) ?? 0, row.count));
    for (const row of firm.caseTypes) {
      const total = caseTypes.get(row.name) ?? { name: row.name, contracts: 0, contractAmount: 0, cash: 0 };
      total.contracts = add(total.contracts, row.contracts); total.contractAmount = add(total.contractAmount, row.contractAmount); total.cash = add(total.cash, row.cash);
      caseTypes.set(row.name, total);
    }
    firms.push({ firmId: firm.firmId, firmName: firm.firmName, status: firm.status, isDemo: firm.isDemo === true, summary: firm.summary, previous: firm.previous, quality: firm.quality });
  }
  const firmCount = firms.length;
  const counts = (map: Map<string, number>) => [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
  const days = [...trend.values()];
  return { ...range, generatedAt: now.toISOString(), scope, includeDemo, excludedDemoCount, firmCount, summary, previous,
    average: average(summary, firmCount, firms.map(firm => firm.summary)), previousAverage: average(previous, firmCount, firms.map(firm => firm.previous)), trend: days,
    averageTrend: days.map(day => ({ date: day.date, db: firmCount ? day.db / firmCount : 0, converted: firmCount ? day.converted / firmCount : 0,
      contracts: firmCount ? day.contracts / firmCount : 0, contractAmount: firmCount ? day.contractAmount / firmCount : 0, cash: firmCount ? day.cash / firmCount : 0 })),
    funnel: counts(funnel), stages: counts(stages), caseTypes: [...caseTypes.values()].sort((a, b) => b.contracts - a.contracts || a.name.localeCompare(b.name, "ko")),
    firms: firms.sort((a, b) => b.summary.contractAmount - a.summary.contractAmount || a.firmName.localeCompare(b.firmName, "ko") || a.firmId.localeCompare(b.firmId)), quality };
}
