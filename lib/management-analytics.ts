"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CASE_TYPE_OPTIONS,
  type CaseRecord,
  type CaseType,
  type DbLead,
  type Installment,
  type PaymentMethod,
} from "@/lib/types";

export const MANAGEMENT_SETTINGS_KEY = "management_analytics_v1";

export type AcquisitionMode = "direct_ads" | "db_purchase";
export type EmploymentType = "정규직" | "프리랜서";
export type IncentiveMode = "회수매출%" | "수임액%" | "건당고정";
export type FeePayer = "사무소 부담" | "고객 부담" | "해당 없음";

export interface StandardFeeRule {
  id: string;
  caseType: CaseType;
  baseFee: number;
  minFee: number;
  approvalDiscountAmount: number;
  effectiveFrom: string;
}

export interface StaffCompensationRule {
  staff: string;
  employmentType: EmploymentType;
  baseSalary: number;
  incentiveMode: IncentiveMode;
  incentiveValue: number;
  clawbackOnCancel: boolean;
}

export interface PaymentFeeRule {
  paymentMethod: PaymentMethod;
  rate: number;
  payer: FeePayer;
}

export interface AdSpendEntry {
  id: string;
  date: string;
  creative: string;
  amount: number;
  memo?: string;
}

export interface FixedCostEntry {
  id: string;
  label: string;
  monthlyAmount: number;
}

export interface FinancialSnapshot {
  acquisitionMode: AcquisitionMode;
  dbPurchaseUnitCost: number;
  feeRules: StandardFeeRule[];
  staffCompensations: StaffCompensationRule[];
  paymentFees: PaymentFeeRule[];
  adSpendEntries: AdSpendEntry[];
  fixedCosts: FixedCostEntry[];
}

export interface MonthClosing {
  closedAt: string;
  snapshot: FinancialSnapshot;
}

export interface ManagementSettings {
  version: 1;
  acquisitionMode: AcquisitionMode;
  dbPurchaseUnitCost: number;
  monthlyContractTarget: number;
  activeDbCap: number;
  neglectedDays: number;
  minimumContactAttempts: number;
  feeRules: StandardFeeRule[];
  staffCompensations: StaffCompensationRule[];
  paymentFees: PaymentFeeRule[];
  adSpendEntries: AdSpendEntry[];
  fixedCosts: FixedCostEntry[];
  monthClosings: Record<string, MonthClosing>;
}

const PAYMENT_METHODS: PaymentMethod[] = ["단순분납", "로피분납", "신카할부완납", "캐피탈분납"];

function feeRule(caseType: CaseType, baseFee: number): StandardFeeRule {
  return {
    id: `fee-${String(caseType)}-2026-10-01`,
    caseType,
    baseFee,
    minFee: Math.round(baseFee * 0.85),
    approvalDiscountAmount: Math.round(baseFee * 0.1),
    effectiveFrom: "2026-10-01",
  };
}

export const DEFAULT_MANAGEMENT_SETTINGS: ManagementSettings = {
  version: 1,
  acquisitionMode: "direct_ads",
  dbPurchaseUnitCost: 0,
  monthlyContractTarget: 50,
  activeDbCap: 40,
  neglectedDays: 7,
  minimumContactAttempts: 5,
  feeRules: CASE_TYPE_OPTIONS.map((type) => feeRule(type, type === "개인파산" ? 3_000_000 : 4_000_000)),
  staffCompensations: [],
  paymentFees: PAYMENT_METHODS.map((paymentMethod) => ({
    paymentMethod,
    rate: paymentMethod === "신카할부완납" ? 3.5 : paymentMethod === "캐피탈분납" ? 5 : paymentMethod === "로피분납" ? 3 : 0,
    payer: paymentMethod === "단순분납" ? "해당 없음" : "사무소 부담",
  })),
  adSpendEntries: [],
  fixedCosts: [
    { id: "fixed-rent", label: "임대료", monthlyAmount: 0 },
    { id: "fixed-telecom", label: "통신비", monthlyAmount: 0 },
    { id: "fixed-crm", label: "CRM · 솔루션", monthlyAmount: 0 },
  ],
  monthClosings: {},
};

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeManagementSettings(value: unknown): ManagementSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ManagementSettings>;
  return {
    ...DEFAULT_MANAGEMENT_SETTINGS,
    ...raw,
    version: 1,
    acquisitionMode: raw.acquisitionMode === "db_purchase" ? "db_purchase" : "direct_ads",
    dbPurchaseUnitCost: Math.max(0, num(raw.dbPurchaseUnitCost)),
    monthlyContractTarget: Math.max(0, num(raw.monthlyContractTarget, 50)),
    activeDbCap: Math.max(1, num(raw.activeDbCap, 40)),
    neglectedDays: Math.max(1, num(raw.neglectedDays, 7)),
    minimumContactAttempts: Math.max(1, num(raw.minimumContactAttempts, 5)),
    feeRules: Array.isArray(raw.feeRules) && raw.feeRules.length ? raw.feeRules.map((r) => ({
      id: String(r.id || crypto.randomUUID()),
      caseType: String(r.caseType || "개인회생"),
      baseFee: Math.max(0, num(r.baseFee)),
      minFee: Math.max(0, num(r.minFee)),
      approvalDiscountAmount: Math.max(0, num(r.approvalDiscountAmount)),
      effectiveFrom: String(r.effectiveFrom || "2026-10-01"),
    })) : DEFAULT_MANAGEMENT_SETTINGS.feeRules,
    staffCompensations: Array.isArray(raw.staffCompensations) ? raw.staffCompensations.map((r) => ({
      staff: String(r.staff || ""),
      employmentType: (r.employmentType === "프리랜서" ? "프리랜서" : "정규직") as EmploymentType,
      baseSalary: Math.max(0, num(r.baseSalary)),
      incentiveMode: (r.incentiveMode === "수임액%" || r.incentiveMode === "건당고정" ? r.incentiveMode : "회수매출%") as IncentiveMode,
      incentiveValue: Math.max(0, num(r.incentiveValue)),
      clawbackOnCancel: r.clawbackOnCancel !== false,
    })).filter((r) => r.staff) : [],
    paymentFees: Array.isArray(raw.paymentFees) && raw.paymentFees.length ? raw.paymentFees.map((r) => ({
      paymentMethod: r.paymentMethod,
      rate: Math.max(0, num(r.rate)),
      payer: (r.payer === "고객 부담" || r.payer === "해당 없음" ? r.payer : "사무소 부담") as FeePayer,
    })) : DEFAULT_MANAGEMENT_SETTINGS.paymentFees,
    adSpendEntries: Array.isArray(raw.adSpendEntries) ? raw.adSpendEntries.map((r) => ({
      id: String(r.id || crypto.randomUUID()),
      date: String(r.date || ""),
      creative: String(r.creative || ""),
      amount: Math.max(0, num(r.amount)),
      memo: r.memo ? String(r.memo) : undefined,
    })).filter((r) => r.date && r.creative) : [],
    fixedCosts: Array.isArray(raw.fixedCosts) && raw.fixedCosts.length ? raw.fixedCosts.map((r) => ({
      id: String(r.id || crypto.randomUUID()),
      label: String(r.label || "운영비"),
      monthlyAmount: Math.max(0, num(r.monthlyAmount)),
    })) : DEFAULT_MANAGEMENT_SETTINGS.fixedCosts,
    monthClosings: raw.monthClosings && typeof raw.monthClosings === "object" ? raw.monthClosings : {},
  };
}

export function ensureStaffCompensations(settings: ManagementSettings, staffNames: string[]): ManagementSettings {
  const existing = new Map(settings.staffCompensations.map((row) => [row.staff, row]));
  const merged = staffNames.filter(Boolean).map((staff) => existing.get(staff) ?? {
    staff,
    employmentType: "정규직" as const,
    baseSalary: 0,
    incentiveMode: "회수매출%" as const,
    incentiveValue: 0,
    clawbackOnCancel: true,
  });
  for (const row of settings.staffCompensations) {
    if (!merged.some((item) => item.staff === row.staff)) merged.push(row);
  }
  return { ...settings, staffCompensations: merged };
}

export function makeFinancialSnapshot(settings: ManagementSettings): FinancialSnapshot {
  return {
    acquisitionMode: settings.acquisitionMode,
    dbPurchaseUnitCost: settings.dbPurchaseUnitCost,
    feeRules: settings.feeRules.map((row) => ({ ...row })),
    staffCompensations: settings.staffCompensations.map((row) => ({ ...row })),
    paymentFees: settings.paymentFees.map((row) => ({ ...row })),
    adSpendEntries: settings.adSpendEntries.map((row) => ({ ...row })),
    fixedCosts: settings.fixedCosts.map((row) => ({ ...row })),
  };
}

export function effectiveFinancialConfig(settings: ManagementSettings, month: string): FinancialSnapshot {
  const snapshot = settings.monthClosings?.[month]?.snapshot as Partial<FinancialSnapshot> | undefined;
  if (!snapshot) return makeFinancialSnapshot(settings);
  return {
    acquisitionMode: snapshot.acquisitionMode === "db_purchase" ? "db_purchase" : "direct_ads",
    dbPurchaseUnitCost: Math.max(0, num(snapshot.dbPurchaseUnitCost)),
    feeRules: Array.isArray(snapshot.feeRules)
      ? snapshot.feeRules.map((row) => ({ ...row }))
      : settings.feeRules.map((row) => ({ ...row })),
    staffCompensations: Array.isArray(snapshot.staffCompensations)
      ? snapshot.staffCompensations.map((row) => ({ ...row }))
      : settings.staffCompensations.map((row) => ({ ...row })),
    paymentFees: Array.isArray(snapshot.paymentFees)
      ? snapshot.paymentFees.map((row) => ({ ...row }))
      : settings.paymentFees.map((row) => ({ ...row })),
    adSpendEntries: Array.isArray(snapshot.adSpendEntries)
      ? snapshot.adSpendEntries.map((row) => ({ ...row }))
      : settings.adSpendEntries.map((row) => ({ ...row })),
    fixedCosts: Array.isArray(snapshot.fixedCosts)
      ? snapshot.fixedCosts.map((row) => ({ ...row }))
      : settings.fixedCosts.map((row) => ({ ...row })),
  };
}

export function inDateRange(value: string | undefined, start: string, end: string) {
  if (!value) return false;
  const d = value.slice(0, 10);
  return (!start || d >= start) && (!end || d <= end);
}

export function monthKeysBetween(start: string, end: string): string[] {
  if (!start || !end) return [];
  const [sy, sm] = start.slice(0, 7).split("-").map(Number);
  const [ey, em] = end.slice(0, 7).split("-").map(Number);
  if (!sy || !sm || !ey || !em) return [];
  const result: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { y += 1; m = 1; }
  }
  return result;
}

export function standardFeeAt(settings: ManagementSettings, caseType: CaseType, contractDate: string): StandardFeeRule | undefined {
  const rules = effectiveFinancialConfig(settings, contractDate.slice(0, 7)).feeRules;
  return rules
    .filter((row) => row.caseType === caseType && row.effectiveFrom <= contractDate.slice(0, 10))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
    ?? rules.filter((row) => row.caseType === caseType).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
}

export function paymentFeeFor(paymentMethod: PaymentMethod, amount: number, config: FinancialSnapshot) {
  const rule = config.paymentFees.find((row) => row.paymentMethod === paymentMethod);
  if (!rule || rule.payer !== "사무소 부담") return 0;
  return Math.round(amount * (rule.rate / 100));
}

function caseMap(cases: CaseRecord[]) {
  return new Map(cases.map((record) => [record.id, record]));
}

export function cashByStaff(
  cases: CaseRecord[],
  installments: Installment[],
  start: string,
  end: string,
) {
  const byCase = caseMap(cases);
  const map = new Map<string, number>();
  for (const ins of installments) {
    if (ins.status !== "완료" || !inDateRange(ins.paidDate, start, end)) continue;
    const record = byCase.get(ins.caseId);
    if (!record) continue;
    map.set(record.assignedStaff, (map.get(record.assignedStaff) ?? 0) + ins.amount);
  }
  return map;
}

export function paymentFeesForRange(
  cases: CaseRecord[],
  installments: Installment[],
  settings: ManagementSettings,
  start: string,
  end: string,
) {
  const byCase = caseMap(cases);
  let total = 0;
  for (const ins of installments) {
    if (ins.status !== "완료" || !inDateRange(ins.paidDate, start, end)) continue;
    const record = byCase.get(ins.caseId);
    if (!record || !ins.paidDate) continue;
    const config = effectiveFinancialConfig(settings, ins.paidDate.slice(0, 7));
    total += paymentFeeFor(record.paymentMethod, ins.amount, config);
  }
  return total;
}

export function laborCostForRange(
  cases: CaseRecord[],
  installments: Installment[],
  settings: ManagementSettings,
  start: string,
  end: string,
) {
  const months = monthKeysBetween(start, end);
  const byCase = caseMap(cases);
  let total = 0;

  for (const month of months) {
    const config = effectiveFinancialConfig(settings, month);
    const monthStart = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const s = start > monthStart ? start : monthStart;
    const e = end < monthEnd ? end : monthEnd;
    const monthCases = cases.filter((record) => inDateRange(record.contractDate, s, e));
    const monthPayments = installments.filter(
      (ins) => ins.status === "완료" && inDateRange(ins.paidDate, s, e)
    );

    const daysInThisMonth = new Date(y, m, 0).getDate();
    const coveredDays = Math.max(
      1,
      Math.round(
        (new Date(`${e}T00:00:00`).getTime() - new Date(`${s}T00:00:00`).getTime()) / 86400000
      ) + 1
    );
    const baseRatio = Math.min(1, coveredDays / daysInThisMonth);

    for (const rule of config.staffCompensations) {
      const eligibleCases = monthCases.filter(
        (record) =>
          record.assignedStaff === rule.staff &&
          (!rule.clawbackOnCancel || record.status !== "취하")
      );
      const contractSales = eligibleCases.reduce(
        (sum, record) => sum + record.contractAmount,
        0
      );
      const cash = monthPayments.reduce((sum, ins) => {
        const record = byCase.get(ins.caseId);
        if (!record || record.assignedStaff !== rule.staff) return sum;
        if (rule.clawbackOnCancel && record.status === "취하") return sum;
        return sum + ins.amount;
      }, 0);

      const bonus =
        rule.incentiveMode === "회수매출%"
          ? cash * (rule.incentiveValue / 100)
          : rule.incentiveMode === "수임액%"
            ? contractSales * (rule.incentiveValue / 100)
            : eligibleCases.length * rule.incentiveValue;

      total += Math.round(rule.baseSalary * baseRatio + bonus);
    }
  }

  return Math.round(total);
}

export function staffCompensationForRange(
  staff: string,
  cases: CaseRecord[],
  installments: Installment[],
  settings: ManagementSettings,
  start: string,
  end: string,
) {
  const filteredSettings: ManagementSettings = {
    ...settings,
    staffCompensations: settings.staffCompensations.filter((row) => row.staff === staff),
    monthClosings: Object.fromEntries(Object.entries(settings.monthClosings ?? {}).map(([month, closing]) => [month, {
      ...closing,
      snapshot: {
        ...closing.snapshot,
        staffCompensations: closing.snapshot.staffCompensations.filter((row) => row.staff === staff),
      },
    }])),
  };
  return laborCostForRange(cases, installments, filteredSettings, start, end);
}

export function acquisitionCostForRange(
  leads: DbLead[],
  settings: ManagementSettings,
  start: string,
  end: string,
) {
  const months = monthKeysBetween(start, end);
  let total = 0;

  for (const month of months) {
    const config = effectiveFinancialConfig(settings, month);
    const monthStart = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const s = start > monthStart ? start : monthStart;
    const e = end < monthEnd ? end : monthEnd;

    if (config.acquisitionMode === "db_purchase") {
      total +=
        leads.filter((lead) => inDateRange(lead.receivedAt, s, e)).length *
        config.dbPurchaseUnitCost;
    } else {
      total += config.adSpendEntries
        .filter((row) => inDateRange(row.date, s, e))
        .reduce((sum, row) => sum + row.amount, 0);
    }
  }
  return total;
}

export function adSpendForCreativeForRange(
  settings: ManagementSettings,
  creative: string,
  start: string,
  end: string,
) {
  let total = 0;
  for (const month of monthKeysBetween(start, end)) {
    const config = effectiveFinancialConfig(settings, month);
    if (config.acquisitionMode !== "direct_ads") continue;
    const monthStart = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const s = start > monthStart ? start : monthStart;
    const e = end < monthEnd ? end : monthEnd;
    total += config.adSpendEntries
      .filter((row) => inDateRange(row.date, s, e) && row.creative === creative)
      .reduce((sum, row) => sum + row.amount, 0);
  }
  return total;
}

export function fixedCostForRange(settings: ManagementSettings, start: string, end: string) {
  let total = 0;
  for (const month of monthKeysBetween(start, end)) {
    const config = effectiveFinancialConfig(settings, month);
    const [y, m] = month.split("-").map(Number);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const s = start > monthStart ? start : monthStart;
    const e = end < monthEnd ? end : monthEnd;
    const daysInMonth = new Date(y, m, 0).getDate();
    const coveredDays = Math.max(
      1,
      Math.round(
        (new Date(`${e}T00:00:00`).getTime() - new Date(`${s}T00:00:00`).getTime()) / 86400000
      ) + 1
    );
    const ratio = Math.min(1, coveredDays / daysInMonth);
    total += config.fixedCosts.reduce(
      (sum, row) => sum + Math.round(row.monthlyAmount * ratio),
      0
    );
  }
  return Math.round(total);
}

export function firstActivityMinutes(lead: DbLead): number | undefined {
  const received = new Date(lead.receivedAt).getTime();
  if (!Number.isFinite(received)) return undefined;
  const rows = [...(lead.consultation?.memoLog ?? [])]
    .filter((entry) => /(통화|전화|연결|부재|문자|상담)/.test(entry.text) || entry.tag === "부재중" || entry.tag === "재통화")
    .sort((a, b) => a.at.localeCompare(b.at));
  if (!rows.length) return undefined;
  const first = new Date(rows[0].at).getTime();
  if (!Number.isFinite(first)) return undefined;
  return Math.max(0, Math.round((first - received) / 60000));
}

export function contactCount(lead: DbLead) {
  return (lead.consultation?.memoLog ?? []).filter((entry) =>
    /(통화|전화|연결|부재|문자|상담)/.test(entry.text) || entry.tag === "부재중" || entry.tag === "재통화"
  ).length;
}

export function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function isManagerProfile(profile: { role?: string; platformRole?: string } | null | undefined) {
  return profile?.platformRole === "super_admin" || profile?.platformRole === "firm_admin" || profile?.role === "admin";
}

export function useManagementSettings(
  profile: { id?: string; lawFirmId?: string; platformRole?: string; role?: string } | null | undefined,
  superAdminFirmScope: { id: string } | null | undefined,
  staffNames: string[] = [],
) {
  const manager = isManagerProfile(profile);
  const effectiveFirmId = profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : profile?.lawFirmId;
  const globalSuperView = profile?.platformRole === "super_admin" && !superAdminFirmScope;
  const supabase = useMemo(() => createClient(), []);
  const [settingsByFirm, setSettingsByFirm] = useState<Record<string, ManagementSettings>>({});
  const [loading, setLoading] = useState(manager);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!manager) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    let query = supabase.from("firm_settings").select("law_firm_id,value").eq("key", MANAGEMENT_SETTINGS_KEY);
    if (effectiveFirmId) query = query.eq("law_firm_id", effectiveFirmId);
    const { data, error: loadError } = await query;
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const map: Record<string, ManagementSettings> = {};
    for (const row of data ?? []) {
      map[row.law_firm_id] = ensureStaffCompensations(normalizeManagementSettings(row.value), effectiveFirmId === row.law_firm_id ? staffNames : []);
    }
    if (effectiveFirmId && !map[effectiveFirmId]) {
      map[effectiveFirmId] = ensureStaffCompensations(DEFAULT_MANAGEMENT_SETTINGS, staffNames);
    }
    setSettingsByFirm(map);
    setLoading(false);
  }, [effectiveFirmId, manager, staffNames, supabase]);

  useEffect(() => { void reload(); }, [reload]);

  const activeSettings = effectiveFirmId
    ? settingsByFirm[effectiveFirmId] ?? ensureStaffCompensations(DEFAULT_MANAGEMENT_SETTINGS, staffNames)
    : DEFAULT_MANAGEMENT_SETTINGS;

  const save = useCallback(async (next: ManagementSettings) => {
    if (!manager || !effectiveFirmId) throw new Error("대상 로펌을 선택해주세요.");
    const normalized = ensureStaffCompensations(normalizeManagementSettings(next), staffNames);
    const { error: saveError } = await supabase.from("firm_settings").upsert({
      law_firm_id: effectiveFirmId,
      key: MANAGEMENT_SETTINGS_KEY,
      value: normalized,
      updated_by: profile?.id ?? null,
    }, { onConflict: "law_firm_id,key" });
    if (saveError) throw saveError;
    setSettingsByFirm((prev) => ({ ...prev, [effectiveFirmId]: normalized }));
    return normalized;
  }, [effectiveFirmId, manager, profile?.id, staffNames, supabase]);

  return { manager, globalSuperView, effectiveFirmId, activeSettings, settingsByFirm, loading, error, reload, save };
}
