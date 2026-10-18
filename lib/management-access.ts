import { makeFinancialSnapshot, normalizeManagementSettings, type ManagementSettings, type MonthClosing } from "@/lib/management-core";

function visibleTotals(value: unknown): MonthClosing["totals"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = ["contractCount", "contractSales", "cashSales", "purchaseCost", "laborCost", "paymentFees", "fixedCost"] as const;
  for (const key of keys) if (!(key === "purchaseCost" && record[key] === null) && (typeof record[key] !== "number" || !Number.isFinite(record[key]) || Number(record[key]) < 0)) return undefined;
  return Object.fromEntries(keys.map(key => [key, record[key]])) as MonthClosing["totals"];
}

export function assertSettingsRevision(current: string | null, expected: unknown) {
  if (expected !== current) throw new Error("다른 관리자가 설정을 변경했거나 화면이 오래되었습니다. 다시 불러온 후 저장해주세요.");
}

/** Firm views never receive platform production costs, including old close snapshots. */
export function firmVisibleSettings(value: unknown): ManagementSettings {
  const settings = normalizeManagementSettings(value);
  const visible = {
    version: settings.version, acquisitionMode: "db_purchase" as const, dbPurchaseUnitCost: 0,
    monthlyContractTarget: settings.monthlyContractTarget, activeDbCap: settings.activeDbCap,
    neglectedDays: settings.neglectedDays, minimumContactAttempts: settings.minimumContactAttempts,
    feeRules: settings.feeRules, staffCompensations: settings.staffCompensations,
    paymentFees: settings.paymentFees, fixedCosts: settings.fixedCosts, adSpendEntries: [],
  };
  return { ...visible, monthClosings: Object.fromEntries(Object.entries(settings.monthClosings).map(([month, closing]) => {
    if (!closing || typeof closing !== "object" || !closing.snapshot || typeof closing.snapshot !== "object" || typeof closing.closedAt !== "string") throw new Error("월마감 기록 형식을 확인해주세요. 원본 기록은 변경되지 않았습니다.");
    const snapshot = normalizeManagementSettings(closing.snapshot);
    return [month, {
      closedAt: closing.closedAt, closedBy: typeof closing.closedBy === "string" ? closing.closedBy : undefined, totals: visibleTotals(closing.totals),
      snapshot: { acquisitionMode: "db_purchase", dbPurchaseUnitCost: 0, adSpendEntries: [], feeRules: snapshot.feeRules, staffCompensations: snapshot.staffCompensations, paymentFees: snapshot.paymentFees, fixedCosts: snapshot.fixedCosts },
    }];
  })) };
}

/** Public setting edits cannot replace private costs or alter an existing close. */
export function mergeFirmSettings(previous: unknown, requested: unknown): ManagementSettings {
  const current = normalizeManagementSettings(previous);
  const stored = previous && typeof previous === "object" ? previous as Partial<ManagementSettings> : {};
  const next = normalizeManagementSettings(requested);
  next.acquisitionMode = current.acquisitionMode;
  next.dbPurchaseUnitCost = current.dbPurchaseUnitCost;
  next.adSpendEntries = Array.isArray(stored.adSpendEntries) ? stored.adSpendEntries : current.adSpendEntries;
  next.monthClosings = Object.fromEntries(Object.keys(next.monthClosings).map(month => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("마감 월을 확인해주세요.");
    return [month, current.monthClosings[month] ?? { closedAt: new Date().toISOString(), snapshot: makeFinancialSnapshot(next) }];
  }));
  return { ...current, ...firmVisibleSettings(next), acquisitionMode: current.acquisitionMode, dbPurchaseUnitCost: current.dbPurchaseUnitCost, adSpendEntries: next.adSpendEntries, monthClosings: next.monthClosings };
}
