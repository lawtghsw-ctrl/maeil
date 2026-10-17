import type { PerformanceCase } from "./firm";

export const LAWYER_SETTINGS_KEY = "performance_lawyers_v1";
export const MAX_LAWYERS = 200;
export const MAX_LAWYER_ASSIGNMENTS = 10000;
export const MAX_LAWYER_JSON_BYTES = 1024 * 1024;

export interface PerformanceLawyer { id: string; name: string; isActive: boolean }
export interface LawyerConfig { version: 1; lawyers: PerformanceLawyer[]; assignments: Record<string, string> }
export interface LawyerConfigResponse { firmId: string; value: LawyerConfig; updatedAt: string | null; missingCaseIds: string[] }
export interface LawyerDraftState extends LawyerConfigResponse { draft: LawyerConfig }
export interface LawyerMetric {
  id: string; name: string; isActive: boolean; caseCount: number; contractCount: number;
  contractAmount: number; periodCash: number; outstanding: number; overdueAmount: number;
}

export function emptyLawyerConfig(): LawyerConfig { return { version: 1, lawyers: [], assignments: {} }; }

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("지원하지 않는 변호사 설정 항목이 있습니다.");
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 128 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

// Invalid persisted/submitted data is rejected, never silently discarded.
export function normalizeLawyerConfig(value: unknown, requireActiveAssignments = true): LawyerConfig {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.lawyers) || !object(value.assignments)) throw new Error("변호사 설정 형식이 올바르지 않습니다.");
  onlyKeys(value, ["version", "lawyers", "assignments"]);
  if (value.lawyers.length > MAX_LAWYERS) throw new Error(`변호사는 최대 ${MAX_LAWYERS}명까지 등록할 수 있습니다.`);
  const ids = new Set<string>();
  const names = new Set<string>();
  const lawyers = value.lawyers.map((raw): PerformanceLawyer => {
    if (!object(raw)) throw new Error("변호사 항목 형식이 올바르지 않습니다.");
    onlyKeys(raw, ["id", "name", "isActive"]);
    const id = identifier(raw.id, "변호사 ID");
    if (ids.has(id)) throw new Error("중복된 변호사 ID가 있습니다.");
    if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(raw.name)) throw new Error("변호사 이름은 1~80자로 입력해주세요.");
    const name = raw.name.trim();
    const nameKey = name.toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
    if (names.has(nameKey)) throw new Error("같은 이름의 변호사가 이미 있습니다.");
    if (typeof raw.isActive !== "boolean") throw new Error("변호사 활동 상태가 올바르지 않습니다.");
    ids.add(id); names.add(nameKey);
    return { id, name, isActive: raw.isActive };
  });
  const entries = Object.entries(value.assignments);
  if (entries.length > MAX_LAWYER_ASSIGNMENTS) throw new Error(`사건 배정은 최대 ${MAX_LAWYER_ASSIGNMENTS}건까지 저장할 수 있습니다.`);
  const lawyerById = new Map(lawyers.map((lawyer) => [lawyer.id, lawyer]));
  const assignments = Object.fromEntries(entries.map(([caseId, rawLawyerId]) => {
    identifier(caseId, "사건 ID");
    const lawyerId = identifier(rawLawyerId, "변호사 ID");
    const lawyer = lawyerById.get(lawyerId);
    if (!lawyer) throw new Error("등록되지 않은 변호사에게 배정된 사건이 있습니다.");
    if (requireActiveAssignments && !lawyer.isActive) throw new Error("비활성 변호사의 사건을 먼저 배정 해제하거나 다른 변호사에게 배정해주세요.");
    return [caseId, lawyerId];
  }));
  return { version: 1, lawyers, assignments };
}

export function resolveLawyerFirmId(profile: { platform_role?: string | null; law_firm_id?: string | null; role?: string | null }, requested: unknown): string {
  if (profile.platform_role !== "super_admin" && profile.platform_role !== "firm_admin" && profile.role !== "admin") throw new Error("FORBIDDEN");
  const firmId = identifier(requested, "로펌 ID");
  if (profile.platform_role !== "super_admin" && (!profile.law_firm_id || firmId !== profile.law_firm_id)) throw new Error("FORBIDDEN");
  return firmId;
}

export function missingLawyerCaseIds(config: LawyerConfig, firmCaseIds: ReadonlySet<string>): string[] {
  return Object.keys(config.assignments).filter((caseId) => !firmCaseIds.has(caseId));
}

export function aggregateLawyerPerformance(cases: readonly PerformanceCase[], config: LawyerConfig): { rows: LawyerMetric[]; unassignedCount: number } {
  const rows: LawyerMetric[] = config.lawyers.map((lawyer) => ({ ...lawyer, caseCount: 0, contractCount: 0, contractAmount: 0, periodCash: 0, outstanding: 0, overdueAmount: 0 }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  let unassignedCount = 0;
  for (const record of cases) {
    const row = byId.get(config.assignments[record.id]);
    if (!row) { unassignedCount += 1; continue; }
    row.caseCount += 1;
    if (record.inPeriod && record.contractAmount > 0 && record.status !== "취하") {
      row.contractCount += 1;
      row.contractAmount += record.contractAmount;
    }
    row.periodCash += record.periodCash;
    row.outstanding += record.outstanding;
    row.overdueAmount += record.overdueAmount;
  }
  return { rows, unassignedCount };
}
