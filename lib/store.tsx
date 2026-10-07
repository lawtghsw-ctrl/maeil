"use client";

// v25 실사용 전환:
// - mock-data seed를 완전히 제거하고 Supabase를 영구 저장소로 사용합니다.
// - 화면 컴포넌트는 기존 useStore() 인터페이스를 최대한 유지해 대규모 UI 재작성 없이 실DB로 전환합니다.
// - 모든 쓰기는 먼저 화면에 반영한 뒤 Supabase에 저장하고, 실패하면 오류를 표시한 후 서버 상태로 재동기화합니다.
// - Realtime 구독으로 여러 직원이 동시에 수정한 내용도 자동 반영합니다.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import type {
  BoardPost,
  CaseRecord,
  Client,
  DbLead,
  Installment,
  InstallmentStatus,
  PaymentMethod,
  ScheduleItem,
  StaffName,
} from "./types";
import { DB_INTAKE_OWNER, STAFF_LIST } from "./types";
import { defaultMinLivingCostTable, type MinLivingCostTable } from "./consultation";
import { createClient, hasSupabaseEnv } from "./supabase/client";
import type { PermissionKey, PermissionMap } from "./permissions";

type DocumentState = Record<string, Record<string, boolean>>;

export interface InstallmentDraft {
  id?: string;
  dueDate: string;
  amount: number;
  status: InstallmentStatus;
  paidDate?: string;
}

export type ChangeCategory = "DB관리" | "고객관리" | "계약관리" | "입금·분납" | "게시판" | "설정";
export type ChangeAction = "등록" | "수정" | "삭제";
export type SettlementRateMap = Record<string, Record<PaymentMethod, number>>;

export interface ChangeLogEntry {
  _lawFirmId?: string;
  _lawFirmName?: string;
  id: string;
  category: ChangeCategory;
  action: ChangeAction;
  targetName: string;
  detail: string;
  staff: string;
  at: string;
}

export interface AppUserProfile {
  id: string;
  email?: string;
  displayName: string;
  role: "admin" | "staff";
  platformRole?: "super_admin" | "firm_admin" | "staff";
  lawFirmId?: string;
  staffName?: StaffName;
  isActive: boolean;
  isWorkStaff: boolean;
  permissions: PermissionMap;
}

export interface SuperAdminFirmScope {
  id: string;
  firmCode: string;
  name: string;
  status: "active" | "suspended";
}

export interface LawFirmSummary {
  id: string;
  firmCode: string;
  name: string;
  status: "active" | "suspended";
}

const DEFAULT_RATE_BY_METHOD: Record<PaymentMethod, number> = {
  단순분납: 100,
  로피분납: 90,
  신카할부완납: 85,
  캐피탈분납: 80,
};

function defaultSettlementRates(staffNames: readonly string[] = STAFF_LIST): SettlementRateMap {
  const map: SettlementRateMap = {};
  for (const staff of staffNames) map[staff] = { ...DEFAULT_RATE_BY_METHOD };
  return map;
}

function todayIsoStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeId(prefix: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${id}`;
}

function asStaffName(value: unknown): StaffName | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

interface AppStoreValue {
  clients: Client[];
  cases: CaseRecord[];
  installments: Installment[];
  scheduleItems: ScheduleItem[];
  leads: DbLead[];
  posts: BoardPost[];
  caseDocuments: DocumentState;
  changeLog: ChangeLogEntry[];
  settlementRates: SettlementRateMap;
  minLivingCostTable: MinLivingCostTable;
  loading: boolean;
  syncError: string | null;
  currentUser: User | null;
  profile: AppUserProfile | null;
  staffDirectory: AppUserProfile[];
  workStaffNames: StaffName[];
  firmDirectory: LawFirmSummary[];
  superAdminFirmScope: SuperAdminFirmScope | null;
  enterSuperAdminFirmScope: (firm: SuperAdminFirmScope) => void;
  exitSuperAdminFirmScope: () => void;
  isAdmin: boolean;
  currentStaff?: StaffName;
  can: (permission: PermissionKey) => boolean;
  reloadData: () => Promise<void>;
  signOut: () => Promise<void>;
  addLead: (draft: Omit<DbLead, "id" | "receivedAt"> & { receivedAt?: string }) => string;
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  updateLead: (id: string, patch: Partial<DbLead>) => Promise<boolean>;
  deleteLead: (id: string) => void;
  convertLeadToClient: (leadId: string) => string | undefined;
  toggleDocument: (caseId: string, itemId: string) => void;
  addCase: (draft: Omit<CaseRecord, "id">) => string;
  updateCase: (id: string, patch: Partial<CaseRecord>) => void;
  deleteCase: (id: string) => Promise<boolean>;
  setCaseInstallments: (
    caseId: string,
    rows: InstallmentDraft[],
    finance?: { totalDebt?: number; contractAmount?: number; paidAmount?: number; installmentCount?: number; paymentMethod?: PaymentMethod }
  ) => Promise<boolean>;
  addPost: (draft: Omit<BoardPost, "id">) => void;
  updatePost: (id: string, patch: Partial<BoardPost>) => void;
  deletePost: (id: string) => void;
  updateSettlementRate: (staff: StaffName, method: PaymentMethod, rate: number) => void;
  setMinLivingCostForSize: (size: number, amount: number) => void;
  setMinLivingCostExtraPerPerson: (amount: number) => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const configured = hasSupabaseEnv();
  const supabase = useMemo(() => (configured ? createClient() : null), [configured]);

  const [clients, setClients] = useState<Client[]>([]);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [leads, setLeads] = useState<DbLead[]>([]);
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [caseDocuments, setCaseDocuments] = useState<DocumentState>({});
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const [settlementRates, setSettlementRates] = useState<SettlementRateMap>(() => defaultSettlementRates());
  const [minLivingCostTable, setMinLivingCostTable] = useState<MinLivingCostTable>(() => defaultMinLivingCostTable());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUserProfile | null>(null);
  const [staffDirectory, setStaffDirectory] = useState<AppUserProfile[]>([]);
  const [firmDirectory, setFirmDirectory] = useState<LawFirmSummary[]>([]);
  const [superAdminFirmScope, setSuperAdminFirmScope] = useState<SuperAdminFirmScope | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem("lawpower_super_firm_scope");
      return raw ? (JSON.parse(raw) as SuperAdminFirmScope) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(configured ? null : "Supabase 환경변수가 설정되지 않았습니다.");

  const actorName = profile?.displayName || profile?.staffName || currentUser?.email || "시스템";
  const currentStaff = profile?.platformRole === "super_admin" ? undefined : profile?.staffName;
  const isAdmin = profile?.role === "admin";
  const isGlobalSuperAdmin = profile?.platformRole === "super_admin" && !superAdminFirmScope;
  const effectiveFirmId =
    profile?.lawFirmId ||
    (profile?.platformRole === "super_admin" ? superAdminFirmScope?.id : undefined);

  const globalViewPermissions = useMemo(() => new Set<PermissionKey>([
    "dashboard.view","dashboard.company_metrics","dashboard.company_todo","dashboard.finance","dashboard.installment_calendar","dashboard.schedule_calendar","dashboard.statistics",
    "db.view","db.view_all","db.view_finance","db.view_consultation",
    "cases.view","cases.view_all","cases.view_finance",
    "settlements.view","settlements.view_all","settlement_settings.view",
    "living.view","changes.view","changes.view_all","analytics.view","analytics.view_all","analytics.finance"
  ]), []);

  const enterSuperAdminFirmScope = useCallback((firm: SuperAdminFirmScope) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("lawpower_super_firm_scope", JSON.stringify(firm));
    }
    setSuperAdminFirmScope(firm);
  }, []);

  const exitSuperAdminFirmScope = useCallback(() => {
    if (typeof window !== "undefined") window.sessionStorage.removeItem("lawpower_super_firm_scope");
    setSuperAdminFirmScope(null);
  }, []);
  const can = useCallback(
    (permission: PermissionKey) => {
      if (!profile?.isActive) return false;
      if (profile.platformRole === "super_admin" && isGlobalSuperAdmin) return globalViewPermissions.has(permission);
      return profile.role === "admin" || profile.permissions?.[permission] === true;
    },
    [globalViewPermissions, isGlobalSuperAdmin, profile]
  );
  const workStaffNames = useMemo(() => {
    const names = staffDirectory
      .filter((item) => item.isWorkStaff && item.staffName)
      .map((item) => item.staffName as StaffName);
    return names.length ? Array.from(new Set(names)) : [...STAFF_LIST];
  }, [staffDirectory]);

  const canPatchLead = useCallback(
    (patch: Partial<DbLead>) => {
      if (isAdmin) return true;
      const keys = Object.keys(patch) as Array<keyof DbLead>;
      if (!keys.length) return false;
      return keys.every((key) => {
        if (key === "consultation") return can("db.edit_consultation");
        if (key === "detailStage" || key === "status") return can("db.change_stage");
        if (key === "assignedStaff") return can("db.change_assignee");
        if (key === "reservationAt") return can("db.manage_reservation");
        if (key === "convertedClientId" || key === "convertedCaseId") return can("db.convert");
        return can("db.edit_basic");
      });
    },
    [can, isAdmin]
  );

  const canPatchCase = useCallback(
    (patch: Partial<CaseRecord>) => {
      if (isAdmin) return true;
      const keys = Object.keys(patch) as Array<keyof CaseRecord>;
      if (!keys.length) return false;
      return keys.every((key) => {
        if (key === "assignedStaff") return can("cases.change_assignee");
        if (key === "totalDebt" || key === "paidAmount" || key === "contractAmount" || key === "installmentCount" || key === "paymentMethod") return can("cases.manage_installments");
        if (key === "docsSentAt") return can("cases.send_docs");
        return false;
      });
    },
    [can, isAdmin]
  );

  const fetchEntityTable = useCallback(
    async <T,>(table: string, lawFirmId?: string, firmNames?: Map<string, string>): Promise<T[]> => {
      if (!supabase) return [];
      let query = supabase.from(table).select("id,data,law_firm_id");
      if (lawFirmId) query = query.eq("law_firm_id", lawFirmId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row: { id: string; data: unknown; law_firm_id?: string | null }) => ({
        ...(row.data as T),
        id: row.id,
        _lawFirmId: row.law_firm_id ?? undefined,
        _lawFirmName: row.law_firm_id ? (firmNames?.get(row.law_firm_id) ?? "알 수 없는 로펌") : undefined,
      } as T));
    },
    [supabase]
  );

  const reloadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    try {
      setSyncError(null);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const user = userData.user;
      setCurrentUser(user ?? null);
      if (!user) {
        setLoading(false);
        return;
      }

      // Resolve identity before fetching business tables. SUPER_ADMIN must never
      // download all firms' operational CRM rows into the browser store.
      const { data: p, error: profileError } = await supabase
        .from("profiles")
        .select("id,email,display_name,role,platform_role,law_firm_id,staff_name,is_active,is_work_staff,permissions")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;

      if (!p || p.is_active === false) {
        setProfile(p ? {
          id: p.id,
          email: p.email ?? user.email ?? undefined,
          displayName: p.display_name || user.email || "사용자",
          role: p.role === "admin" ? "admin" : "staff",
          platformRole: p.platform_role || "staff",
          lawFirmId: p.law_firm_id || undefined,
          staffName: asStaffName(p.staff_name || p.display_name),
          isActive: false,
          isWorkStaff: p.is_work_staff !== false,
          permissions: (p.permissions ?? {}) as PermissionMap,
        } : null);
        setLeads([]); setClients([]); setCases([]); setInstallments([]); setScheduleItems([]); setPosts([]); setChangeLog([]); setStaffDirectory([]);
        setSyncError(p ? "비활성 계정입니다. 관리자에게 계정 활성화를 요청해주세요." : "사용자 프로필이 없습니다. Supabase 초기 SQL을 확인해주세요.");
        await supabase.auth.signOut();
        if (typeof window !== "undefined") window.location.replace("/login");
        return;
      }

      const resolvedProfile: AppUserProfile = {
        id: p.id,
        email: p.email ?? user.email ?? undefined,
        displayName: p.display_name || user.email || "사용자",
        role: p.role === "admin" ? "admin" : "staff",
        platformRole: p.platform_role || "staff",
        lawFirmId: p.law_firm_id || undefined,
        staffName: asStaffName(p.staff_name || p.display_name),
        isActive: true,
        isWorkStaff: p.is_work_staff !== false,
        permissions: (p.permissions ?? {}) as PermissionMap,
      };
      setProfile(resolvedProfile);

      const { data: activeUser, error: activeError } = await supabase.rpc("is_active_user");
      if (activeError || activeUser !== true) {
        setLeads([]); setClients([]); setCases([]); setInstallments([]); setScheduleItems([]); setPosts([]); setChangeLog([]); setStaffDirectory([]);
        setSyncError("소속 로펌이 이용중지 상태이거나 사용할 수 없는 계정입니다.");
        await supabase.auth.signOut();
        if (typeof window !== "undefined") window.location.replace("/login");
        return;
      }

      const { data: firmRows, error: firmError } = await supabase
        .from("law_firms")
        .select("id,firm_code,name,status")
        .order("name");
      if (firmError) throw firmError;
      const firms: LawFirmSummary[] = (firmRows ?? []).map((firm: any) => ({
        id: firm.id, firmCode: String(firm.firm_code), name: firm.name, status: firm.status === "suspended" ? "suspended" : "active",
      }));
      setFirmDirectory(firms);
      const firmNames = new Map(firms.map((firm) => [firm.id, firm.name]));

      let targetFirmId = resolvedProfile.lawFirmId;
      if (resolvedProfile.platformRole === "super_admin" && superAdminFirmScope?.id) {
        const scopedFirm = firms.find((firm) => firm.id === superAdminFirmScope.id);
        if (!scopedFirm) {
          exitSuperAdminFirmScope();
          throw new Error("선택한 로펌 정보를 찾지 못했습니다.");
        }
        if (
          scopedFirm.name !== superAdminFirmScope.name ||
          scopedFirm.firmCode !== superAdminFirmScope.firmCode ||
          scopedFirm.status !== superAdminFirmScope.status
        ) enterSuperAdminFirmScope(scopedFirm);
        targetFirmId = scopedFirm.id;
      }

      const globalMode = resolvedProfile.platformRole === "super_admin" && !targetFirmId;
      if (!globalMode && !targetFirmId) throw new Error("소속 로펌을 확인할 수 없습니다.");

      const [
        loadedLeads, loadedClients, loadedCases, loadedInstallments, loadedSchedule, loadedPosts, loadedChanges, directoryRes,
      ] = await Promise.all([
        fetchEntityTable<DbLead>("app_leads", globalMode ? undefined : targetFirmId, firmNames),
        fetchEntityTable<Client>("app_clients", globalMode ? undefined : targetFirmId, firmNames),
        fetchEntityTable<CaseRecord>("app_cases", globalMode ? undefined : targetFirmId, firmNames),
        fetchEntityTable<Installment>("app_installments", globalMode ? undefined : targetFirmId, firmNames),
        fetchEntityTable<ScheduleItem>("app_schedule_items", globalMode ? undefined : targetFirmId, firmNames),
        fetchEntityTable<BoardPost>("app_board_posts", globalMode ? undefined : targetFirmId, firmNames),
        fetchEntityTable<ChangeLogEntry>("app_change_logs", globalMode ? undefined : targetFirmId, firmNames),
        globalMode
          ? supabase.from("profiles").select("id,display_name,role,platform_role,law_firm_id,staff_name,is_active,is_work_staff,permissions").eq("is_work_staff", true).order("display_name")
          : supabase.from("profiles").select("id,display_name,role,platform_role,law_firm_id,staff_name,is_active,is_work_staff,permissions").eq("law_firm_id", targetFirmId!).eq("is_work_staff", true).order("display_name"),
      ]);
      if (directoryRes.error) throw directoryRes.error;

      setLeads(loadedLeads.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)));
      setClients(loadedClients);
      setCases(loadedCases);
      setInstallments(loadedInstallments);
      setScheduleItems(loadedSchedule);
      setPosts(loadedPosts);
      setChangeLog(loadedChanges.sort((a, b) => b.at.localeCompare(a.at)));

      const directory: AppUserProfile[] = (directoryRes.data ?? []).map((row: any) => ({
        id: row.id,
        displayName: row.display_name || row.staff_name || "사용자",
        role: row.role === "admin" ? "admin" : "staff",
        platformRole: row.platform_role || "staff",
        lawFirmId: row.law_firm_id || undefined,
        staffName: asStaffName(row.staff_name || row.display_name),
        isActive: row.is_active !== false,
        isWorkStaff: row.is_work_staff !== false,
        permissions: (row.permissions ?? {}) as PermissionMap,
      }));
      setStaffDirectory(directory);

      if (globalMode) {
        setSettlementRates(defaultSettlementRates(directory.map((item) => item.staffName).filter(Boolean) as string[]));
        setMinLivingCostTable(defaultMinLivingCostTable());
        setCaseDocuments({});
      } else {
        const { data: firmSettingsData, error: firmSettingsError } = await supabase.from("firm_settings").select("key,value").eq("law_firm_id", targetFirmId!);
        if (firmSettingsError) throw firmSettingsError;
        const firmSettings = new Map((firmSettingsData ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
        const rates = firmSettings.get("settlement_rates") as SettlementRateMap | undefined;
        const living = firmSettings.get("min_living_cost") as MinLivingCostTable | undefined;
        const docs = firmSettings.get("case_documents") as DocumentState | undefined;
        const rateDefaults = defaultSettlementRates(directory.map((item) => item.staffName).filter(Boolean) as string[]);
        setSettlementRates(rates ? { ...rateDefaults, ...rates } : rateDefaults);
        setMinLivingCostTable(living ?? defaultMinLivingCostTable());
        setCaseDocuments(docs ?? {});
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Supabase 데이터 로딩에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [enterSuperAdminFirmScope, exitSuperAdminFirmScope, fetchEntityTable, supabase, superAdminFirmScope]);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  useEffect(() => {
    if (!supabase || !currentUser) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reloadData(), 180);
    };

    const channel = supabase.channel("lawpower-live");
    for (const table of [
      "app_leads",
      "app_clients",
      "app_cases",
      "app_installments",
      "app_schedule_items",
      "app_board_posts",
      "app_change_logs",
      "app_settings",
      "firm_settings",
      "profiles",
    ]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleReload);
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, currentUser, reloadData]);

  const saveEntity = useCallback(
    async (table: string, entity: { id: string; _lawFirmId?: string; _lawFirmName?: string }) => {
      if (!supabase) throw new Error("Supabase가 연결되지 않았습니다.");
      const rowFirmId = effectiveFirmId || entity._lawFirmId;
      if (!rowFirmId) throw new Error("전체 로펌 통합보기는 조회 전용입니다. 수정/등록하려면 좌측에서 대상 로펌을 선택해주세요.");
      const cleanEntity: Record<string, unknown> = { ...entity };
      delete cleanEntity._lawFirmId; delete cleanEntity._lawFirmName;

      // v28.25: 기존에는 모든 저장을 UPSERT로 처리했습니다. Postgres RLS에서 UPSERT는
      // 기존 행 수정이어도 INSERT 정책까지 함께 검사하므로, '수정 권한은 있지만 등록 권한은
      // 없는 직원'의 정상적인 저장이 거절되고 화면이 원래 값으로 돌아가는 문제가 있었습니다.
      // 먼저 UPDATE를 시도하고 실제 대상 행이 없을 때만 INSERT하여 권한 의미를 분리합니다.
      const payload = { data: cleanEntity, law_firm_id: rowFirmId };
      const { data: existingRow, error: lookupError } = await supabase
        .from(table)
        .select("id")
        .eq("id", entity.id)
        .eq("law_firm_id", rowFirmId)
        .maybeSingle();
      if (lookupError) throw lookupError;

      if (existingRow) {
        const { error: updateError } = await supabase
          .from(table)
          .update(payload)
          .eq("id", entity.id)
          .eq("law_firm_id", rowFirmId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from(table).insert({ id: entity.id, ...payload });
        if (insertError) throw insertError;
      }

      // Lead 상태 변경 트리거가 Meta 전송 대기열을 만들면 같은 요청 흐름에서 즉시 전송을 시도합니다.
      // 실패해도 CRM 저장은 성공 상태를 유지하고, queue가 다음 수정/수동 전송/외부 worker에서 재시도합니다.
      if (table === "app_leads") {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token;
          if (token) {
            await fetch("/api/integrations/meta/flush", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ limit: 10 }),
            });
          }
        } catch {
          // best-effort only
        }
      }
    },
    [effectiveFirmId, supabase]
  );

  const deleteEntity = useCallback(
    async (table: string, id: string) => {
      if (!supabase) throw new Error("Supabase가 연결되지 않았습니다.");
      if (isGlobalSuperAdmin) throw new Error("전체 로펌 통합보기는 조회 전용입니다. 대상 로펌을 선택한 뒤 삭제해주세요.");
      let query = supabase.from(table).delete().eq("id", id);
      if (effectiveFirmId) query = query.eq("law_firm_id", effectiveFirmId);
      const { error } = await query;
      if (error) throw error;
    },
    [effectiveFirmId, isGlobalSuperAdmin, supabase]
  );

  const saveSetting = useCallback(
    async (key: string, value: unknown) => {
      if (!supabase) throw new Error("Supabase가 연결되지 않았습니다.");
      if (!effectiveFirmId) throw new Error("전체 로펌 통합보기에서는 로펌별 설정을 변경할 수 없습니다. 좌측에서 대상 로펌을 선택해주세요.");
      const { error } = await supabase.from("firm_settings").upsert(
        { law_firm_id: effectiveFirmId, key, value, updated_by: currentUser?.id ?? null },
        { onConflict: "law_firm_id,key" }
      );
      if (error) throw error;
    },
    [currentUser?.id, effectiveFirmId, supabase]
  );

  const queueWrite = useCallback(
    (promise: Promise<unknown>) => {
      void promise.catch((err) => {
        // v28.25: 저장 실패 직후 전체 reloadData()를 호출하면 사용자가 다른 화면에서
        // 작성 중이던 값까지 서버값으로 덮여 '초기화'처럼 보일 수 있습니다. 실패한 입력은
        // 화면에 유지하고 오류를 명확히 표시해 재시도할 수 있게 합니다.
        const message = err instanceof Error ? err.message : "데이터 저장에 실패했습니다.";
        setSyncError(`저장 실패 · 입력값은 현재 화면에 유지됩니다. 새로고침하지 말고 다시 저장해주세요. (${message})`);
      });
    },
    []
  );

  const logChange = useCallback(
    (category: ChangeCategory, action: ChangeAction, targetName: string, detail: string) => {
      const entry: ChangeLogEntry = {
        id: makeId("CHG"),
        category,
        action,
        targetName,
        detail,
        staff: actorName,
        at: new Date().toISOString(),
      };
      setChangeLog((prev) => [entry, ...prev]);
      queueWrite(saveEntity("app_change_logs", entry));
    },
    [actorName, queueWrite, saveEntity]
  );

  const addLead = useCallback(
    (draft: Omit<DbLead, "id" | "receivedAt"> & { receivedAt?: string }): string => {
      if (isGlobalSuperAdmin || !can("db.create")) return "";
      const lead: DbLead = {
        ...draft,
        assignedStaff: workStaffNames.includes(DB_INTAKE_OWNER) ? DB_INTAKE_OWNER : (currentStaff || draft.assignedStaff),
        id: makeId("DB"),
        receivedAt: draft.receivedAt ?? new Date().toISOString(),
      };
      setLeads((prev) => [lead, ...prev]);
      queueWrite(saveEntity("app_leads", lead));
      logChange("DB관리", "등록", lead.name, "신규 DB 등록");
      return lead.id;
    },
    [can, currentStaff, isGlobalSuperAdmin, logChange, queueWrite, saveEntity, workStaffNames]
  );

  const updateClient = useCallback(
    (id: string, patch: Partial<Client>) => {
      if (isGlobalSuperAdmin || !isAdmin) return;
      const before = clients.find((c) => c.id === id);
      if (!before) return;
      const next = { ...before, ...patch };
      setClients((prev) => prev.map((c) => (c.id === id ? next : c)));
      queueWrite(saveEntity("app_clients", next));
      logChange("계약관리", "수정", before.name, "고객정보 수정");
    },
    [clients, isAdmin, isGlobalSuperAdmin, logChange, queueWrite, saveEntity]
  );

  const deleteClient = useCallback(
    (id: string) => {
      if (isGlobalSuperAdmin || !isAdmin) return;
      const target = clients.find((c) => c.id === id);
      if (!target) return;
      const linkedCases = cases.filter((c) => c.clientId === id);
      const caseIds = new Set(linkedCases.map((c) => c.id));
      const linkedInstallments = installments.filter((i) => caseIds.has(i.caseId));
      const linkedSchedule = scheduleItems.filter((s) => s.clientId === id || (!!s.caseId && caseIds.has(s.caseId)));

      setClients((prev) => prev.filter((c) => c.id !== id));
      setCases((prev) => prev.filter((c) => c.clientId !== id));
      setInstallments((prev) => prev.filter((i) => !caseIds.has(i.caseId)));
      setScheduleItems((prev) => prev.filter((s) => !linkedSchedule.some((x) => x.id === s.id)));

      queueWrite(
        Promise.all([
          deleteEntity("app_clients", id),
          ...linkedCases.map((c) => deleteEntity("app_cases", c.id)),
          ...linkedInstallments.map((i) => deleteEntity("app_installments", i.id)),
          ...linkedSchedule.map((s) => deleteEntity("app_schedule_items", s.id)),
        ])
      );
      logChange("계약관리", "삭제", target.name, "고객 정보 및 연결된 계약·분납 데이터 삭제");
    },
    [cases, clients, deleteEntity, installments, isAdmin, isGlobalSuperAdmin, logChange, queueWrite, scheduleItems]
  );

  const updateLead = useCallback(
    async (id: string, patch: Partial<DbLead>): Promise<boolean> => {
      if (isGlobalSuperAdmin || !canPatchLead(patch)) {
        setSyncError("저장 실패 · 현재 계정에 해당 DB 항목을 수정할 권한이 없습니다.");
        return false;
      }
      const before = leads.find((l) => l.id === id);
      if (!before) {
        setSyncError("저장 실패 · 수정할 DB를 찾지 못했습니다. 목록을 새로 확인해주세요.");
        return false;
      }
      const next = { ...before, ...patch };
      setLeads((prev) => prev.map((l) => (l.id === id ? next : l)));
      try {
        await saveEntity("app_leads", next);
        setSyncError(null);
        logChange("DB관리", "수정", before.name, "DB 리드 정보 수정");
        return true;
      } catch (err) {
        // 저장이 실패해도 사용자가 방금 입력한 값은 유지합니다. 상담일지 모달은 별도의
        // 로컬 임시저장도 갖고 있어 새로고침/팝업 종료 후 다시 복구할 수 있습니다.
        const message = err instanceof Error ? err.message : "데이터 저장에 실패했습니다.";
        setSyncError(`저장 실패 · 입력값은 유지되었습니다. 다시 저장해주세요. (${message})`);
        return false;
      }
    },
    [canPatchLead, isGlobalSuperAdmin, leads, logChange, saveEntity]
  );

  const deleteLead = useCallback(
    (id: string) => {
      if (isGlobalSuperAdmin || !can("db.delete")) return;
      const target = leads.find((lead) => lead.id === id);
      if (!target) return;

      setLeads((prev) => prev.filter((lead) => lead.id !== id));
      queueWrite(deleteEntity("app_leads", id));
      logChange(
        "DB관리",
        "삭제",
        target.name,
        target.convertedClientId
          ? "DB 고객정보 삭제 (계약관리로 전환된 고객·계약 데이터는 유지)"
          : "DB 고객정보 및 상담일지·메모·예약정보 삭제"
      );
    },
    [can, deleteEntity, isGlobalSuperAdmin, leads, logChange, queueWrite]
  );

  const convertLeadToClient = useCallback(
    (leadId: string): string | undefined => {
      if (isGlobalSuperAdmin || !can("db.convert")) return undefined;
      const lead = leads.find((l) => l.id === leadId);
      if (!lead) return undefined;

      // v27.11 보정: v27.10에서 이미 고객만 생성되고 계약이 생성되지 않은 리드는
      // 고객전환 버튼을 다시 누르면 기존 Client를 유지한 채 미접수 계약만 생성합니다.
      if (lead.convertedClientId) {
        if (lead.convertedCaseId) return lead.convertedClientId;
        const existingClient = clients.find((client) => client.id === lead.convertedClientId);
        if (!existingClient) return lead.convertedClientId;

        const today = todayIsoStr();
        const caseRecord: CaseRecord = {
          id: makeId("CASE"),
          caseNumber: `미접수-${Date.now().toString().slice(-6)}`,
          clientId: existingClient.id,
          caseType: lead.applicationType === "개인파산" ? "개인파산" : "개인회생",
          court: "미지정",
          stage: "상담접수",
          stageUpdatedAt: today,
          status: "진행중",
          assignedStaff: lead.assignedStaff,
          totalDebt: 0,
          contractAmount: 0,
          contractDate: today,
          paidAmount: 0,
          paymentMethod: "단순분납",
          memo: lead.memo,
          fromLeadId: lead.id,
        };
        const nextLead: DbLead = { ...lead, convertedCaseId: caseRecord.id };

        setCases((prev) => [caseRecord, ...prev]);
        setLeads((prev) => prev.map((item) => (item.id === leadId ? nextLead : item)));
        queueWrite(Promise.all([saveEntity("app_cases", caseRecord), saveEntity("app_leads", nextLead)]));
        logChange("DB관리", "수정", lead.name, "기존 전환 고객의 누락 계약 생성");
        return existingClient.id;
      }

      // v27.10 임시 운영: 상담일지 필수항목이 미작성이어도 고객 전환을 허용합니다.
      // 상담일지 데이터가 있으면 그대로 승계하고, 비어 있으면 미작성 상태로 고객을 생성합니다.

      const today = todayIsoStr();
      const client: Client = {
        id: makeId("CL"),
        name: lead.name,
        phone: lead.phone,
        registeredAt: today,
        assignedStaff: lead.assignedStaff,
        memo: lead.memo,
        fromLeadId: lead.id,
        applicationType: lead.applicationType,
        consultation: lead.consultation,
      };

      // v27.11: DB의 "고객 전환"은 고객 레코드만 만드는 것이 아니라
      // 계약관리에서 바로 이어서 처리할 수 있는 미접수 계약 레코드까지 함께 생성합니다.
      // 계약금액/법원/결제수단 등은 계약관리 상세에서 이후 보완하면 됩니다.
      const caseType = lead.applicationType === "개인파산" ? "개인파산" : "개인회생";
      const caseRecord: CaseRecord = {
        id: makeId("CASE"),
        caseNumber: `미접수-${Date.now().toString().slice(-6)}`,
        clientId: client.id,
        caseType,
        court: "미지정",
        stage: "상담접수",
        stageUpdatedAt: today,
        status: "진행중",
        assignedStaff: lead.assignedStaff,
        totalDebt: 0,
        contractAmount: 0,
        contractDate: today,
        paidAmount: 0,
        paymentMethod: "단순분납",
        memo: lead.memo,
        fromLeadId: lead.id,
      };

      const nextLead: DbLead = {
        ...lead,
        status: "수임전환",
        convertedClientId: client.id,
        convertedCaseId: caseRecord.id,
      };

      setClients((prev) => [...prev, client]);
      setCases((prev) => [caseRecord, ...prev]);
      setLeads((prev) => prev.map((l) => (l.id === leadId ? nextLead : l)));
      queueWrite(
        Promise.all([
          saveEntity("app_clients", client),
          saveEntity("app_cases", caseRecord),
          saveEntity("app_leads", nextLead),
        ])
      );
      logChange("DB관리", "수정", lead.name, "고객 및 계약관리 미접수 계약 생성");
      return client.id;
    },
    [can, clients, isGlobalSuperAdmin, leads, logChange, queueWrite, saveEntity]
  );

  const toggleDocument = useCallback(
    (caseId: string, itemId: string) => {
      if (isGlobalSuperAdmin || !can("cases.send_docs")) return;
      const next: DocumentState = {
        ...caseDocuments,
        [caseId]: {
          ...(caseDocuments[caseId] ?? {}),
          [itemId]: !(caseDocuments[caseId]?.[itemId] ?? false),
        },
      };
      setCaseDocuments(next);
      queueWrite(saveSetting("case_documents", next));
    },
    [can, caseDocuments, isGlobalSuperAdmin, queueWrite, saveSetting]
  );

  const addCase = useCallback(
    (draft: Omit<CaseRecord, "id">): string => {
      if (isGlobalSuperAdmin || !can("cases.create")) return "";
      const record: CaseRecord = {
        ...draft,
        assignedStaff: can("cases.change_assignee") ? draft.assignedStaff : (currentStaff || draft.assignedStaff),
        id: makeId("CASE"),
      };
      setCases((prev) => [record, ...prev]);
      queueWrite(saveEntity("app_cases", record));

      const client = clients.find((c) => c.id === record.clientId);
      if (client?.fromLeadId) {
        const lead = leads.find((l) => l.id === client.fromLeadId);
        if (lead) {
          const nextLead = { ...lead, convertedCaseId: record.id };
          setLeads((prev) => prev.map((l) => (l.id === lead.id ? nextLead : l)));
          queueWrite(saveEntity("app_leads", nextLead));
        }
      }
      logChange("계약관리", "등록", record.caseNumber, "계약 등록");
      return record.id;
    },
    [can, clients, currentStaff, isGlobalSuperAdmin, leads, logChange, queueWrite, saveEntity]
  );

  const updateCase = useCallback(
    (id: string, patch: Partial<CaseRecord>) => {
      if (isGlobalSuperAdmin || !canPatchCase(patch)) return;
      const before = cases.find((c) => c.id === id);
      if (!before) return;
      const next = { ...before, ...patch };
      setCases((prev) => prev.map((c) => (c.id === id ? next : c)));
      queueWrite(saveEntity("app_cases", next));
      logChange("계약관리", "수정", before.caseNumber, "계약 관련 정보 수정");
    },
    [canPatchCase, cases, isGlobalSuperAdmin, logChange, queueWrite, saveEntity]
  );

  const deleteCase = useCallback(
    async (id: string): Promise<boolean> => {
      if (isGlobalSuperAdmin || !can("cases.delete")) {
        setSyncError("삭제 실패 · 현재 계정에 계약 삭제 권한이 없습니다.");
        return false;
      }
      const target = cases.find((record) => record.id === id);
      if (!target) {
        setSyncError("삭제 실패 · 계약을 찾지 못했습니다. 목록을 새로 확인해주세요.");
        return false;
      }
      if (!supabase) {
        setSyncError("삭제 실패 · Supabase가 연결되지 않았습니다.");
        return false;
      }

      try {
        const { error } = await supabase.rpc("delete_case_with_relations", { target_case_id: id });
        if (error) throw error;

        setCases((prev) => prev.filter((record) => record.id !== id));
        setInstallments((prev) => prev.filter((item) => item.caseId !== id));
        setScheduleItems((prev) => prev.filter((item) => item.caseId !== id));
        setLeads((prev) => prev.map((lead) => lead.convertedCaseId === id ? { ...lead, convertedCaseId: undefined } : lead));
        setSyncError(null);
        logChange("계약관리", "삭제", target.caseNumber, "계약 및 연결된 분납·계약일정 삭제 (고객정보·원본 DB 유지)");
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "계약 삭제에 실패했습니다.";
        setSyncError(`삭제 실패 · 데이터는 변경되지 않았습니다. (${message})`);
        return false;
      }
    },
    [can, cases, isGlobalSuperAdmin, logChange, supabase]
  );

  const setCaseInstallments = useCallback(
    async (
      caseId: string,
      rows: InstallmentDraft[],
      finance?: { totalDebt?: number; contractAmount?: number; paidAmount?: number; installmentCount?: number; paymentMethod?: PaymentMethod }
    ): Promise<boolean> => {
      if (isGlobalSuperAdmin || !can("cases.manage_installments")) {
        setSyncError("저장 실패 · 현재 계정에 분납관리 수정 권한이 없습니다.");
        return false;
      }
      const oldRows = installments.filter((i) => i.caseId === caseId);
      const updated: Installment[] = rows.map((r, idx) => ({
        id: r.id ?? makeId(`${caseId}-INS`),
        caseId,
        seq: idx + 1,
        dueDate: r.dueDate,
        amount: r.amount,
        status: r.status,
        paidDate: r.paidDate || undefined,
      }));
      const keepIds = new Set(updated.map((i) => i.id));
      const removed = oldRows.filter((i) => !keepIds.has(i.id));
      const completedAmount = updated.filter((i) => i.status === "완료").reduce((sum, i) => sum + i.amount, 0);
      const caseBefore = cases.find((c) => c.id === caseId);
      const caseNext = caseBefore
        ? {
            ...caseBefore,
            totalDebt: Math.max(0, finance?.totalDebt ?? caseBefore.totalDebt),
            contractAmount: Math.max(0, finance?.contractAmount ?? caseBefore.contractAmount),
            paidAmount: Math.max(0, finance?.paidAmount ?? completedAmount),
            installmentCount: Math.max(0, Math.trunc(finance?.installmentCount ?? updated.length)),
            paymentMethod: finance?.paymentMethod ?? caseBefore.paymentMethod,
          }
        : undefined;

      setInstallments((prev) => [...prev.filter((i) => i.caseId !== caseId), ...updated]);
      if (caseNext) setCases((prev) => prev.map((c) => (c.id === caseId ? caseNext : c)));

      try {
        await Promise.all([
          ...removed.map((i) => deleteEntity("app_installments", i.id)),
          ...updated.map((i) => saveEntity("app_installments", i)),
          ...(caseNext ? [saveEntity("app_cases", caseNext)] : []),
        ]);
        setSyncError(null);
        if (caseBefore) logChange("계약관리", "수정", caseBefore.caseNumber, "총 채무액·총 수임료·납부금액·납부회차·결제방법 및 분납 일정 저장");
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "분납정보 저장에 실패했습니다.";
        setSyncError(`저장 실패 · 분납 입력값은 현재 화면에 유지됩니다. 다시 저장해주세요. (${message})`);
        return false;
      }
    },
    [can, cases, deleteEntity, installments, isGlobalSuperAdmin, logChange, saveEntity]
  );

  const addPost = useCallback(
    (draft: Omit<BoardPost, "id">) => {
      if (isGlobalSuperAdmin) return;
      const post: BoardPost = { ...draft, id: makeId("POST") };
      setPosts((prev) => [...prev, post]);
      queueWrite(saveEntity("app_board_posts", post));
      logChange("게시판", "등록", draft.title, "게시글 등록");
    },
    [isGlobalSuperAdmin, logChange, queueWrite, saveEntity]
  );

  const updatePost = useCallback(
    (id: string, patch: Partial<BoardPost>) => {
      if (isGlobalSuperAdmin) return;
      const before = posts.find((p) => p.id === id);
      if (!before) return;
      const next = { ...before, ...patch };
      setPosts((prev) => prev.map((p) => (p.id === id ? next : p)));
      queueWrite(saveEntity("app_board_posts", next));
      logChange("게시판", "수정", before.title, "게시글 수정");
    },
    [isGlobalSuperAdmin, logChange, posts, queueWrite, saveEntity]
  );

  const deletePost = useCallback(
    (id: string) => {
      if (isGlobalSuperAdmin) return;
      const before = posts.find((p) => p.id === id);
      if (!before) return;
      setPosts((prev) => prev.filter((p) => p.id !== id));
      queueWrite(deleteEntity("app_board_posts", id));
      logChange("게시판", "삭제", before.title, "게시글 삭제");
    },
    [deleteEntity, isGlobalSuperAdmin, logChange, posts, queueWrite]
  );

  const updateSettlementRate = useCallback(
    (staff: StaffName, method: PaymentMethod, rate: number) => {
      if (isGlobalSuperAdmin || !can("settlement_settings.edit")) return;
      const next = { ...settlementRates, [staff]: { ...settlementRates[staff], [method]: rate } };
      setSettlementRates(next);
      queueWrite(saveSetting("settlement_rates", next));
      logChange("설정", "수정", `${staff} · ${method}`, `정산요율 ${rate}%로 변경`);
    },
    [can, isGlobalSuperAdmin, logChange, queueWrite, saveSetting, settlementRates]
  );

  const setMinLivingCostForSize = useCallback(
    (size: number, amount: number) => {
      if (isGlobalSuperAdmin || !can("living.edit")) return;
      const next = { ...minLivingCostTable, sizes: { ...minLivingCostTable.sizes, [size]: amount } };
      setMinLivingCostTable(next);
      queueWrite(saveSetting("min_living_cost", next));
      logChange("설정", "수정", "최저생계비 계산기", `${size}인가구 최저생계비 ${amount.toLocaleString("ko-KR")}원으로 설정`);
    },
    [can, isGlobalSuperAdmin, logChange, minLivingCostTable, queueWrite, saveSetting]
  );

  const setMinLivingCostExtraPerPerson = useCallback(
    (amount: number) => {
      if (isGlobalSuperAdmin || !can("living.edit")) return;
      const next = { ...minLivingCostTable, extraPerPerson: amount };
      setMinLivingCostTable(next);
      queueWrite(saveSetting("min_living_cost", next));
      logChange("설정", "수정", "최저생계비 계산기", `추가 가구원 기준금액 ${amount.toLocaleString("ko-KR")}원으로 설정`);
    },
    [can, isGlobalSuperAdmin, logChange, minLivingCostTable, queueWrite, saveSetting]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    if (typeof window !== "undefined") window.sessionStorage.removeItem("lawpower_super_firm_scope");
    await supabase.auth.signOut();
    window.location.href = "/login";
  }, [supabase]);

  const value = useMemo<AppStoreValue>(
    () => ({
      clients,
      cases,
      installments,
      scheduleItems,
      leads,
      posts,
      caseDocuments,
      changeLog,
      settlementRates,
      minLivingCostTable,
      loading,
      syncError,
      currentUser,
      profile,
      staffDirectory,
      workStaffNames,
      firmDirectory,
      superAdminFirmScope,
      enterSuperAdminFirmScope,
      exitSuperAdminFirmScope,
      isAdmin,
      currentStaff,
      can,
      reloadData,
      signOut,
      addLead,
      updateClient,
      deleteClient,
      updateLead,
      deleteLead,
      convertLeadToClient,
      toggleDocument,
      addCase,
      updateCase,
      deleteCase,
      setCaseInstallments,
      addPost,
      updatePost,
      deletePost,
      updateSettlementRate,
      setMinLivingCostForSize,
      setMinLivingCostExtraPerPerson,
    }),
    [
      clients,
      cases,
      installments,
      scheduleItems,
      leads,
      posts,
      caseDocuments,
      changeLog,
      settlementRates,
      minLivingCostTable,
      loading,
      syncError,
      currentUser,
      profile,
      staffDirectory,
      workStaffNames,
      firmDirectory,
      superAdminFirmScope,
      enterSuperAdminFirmScope,
      exitSuperAdminFirmScope,
      isAdmin,
      currentStaff,
      can,
      reloadData,
      signOut,
      addLead,
      updateClient,
      deleteClient,
      updateLead,
      deleteLead,
      convertLeadToClient,
      toggleDocument,
      addCase,
      updateCase,
      deleteCase,
      setCaseInstallments,
      addPost,
      updatePost,
      deletePost,
      updateSettlementRate,
      setMinLivingCostForSize,
      setMinLivingCostExtraPerPerson,
    ]
  );

  return (
    <AppStoreContext.Provider value={value}>
      {loading ? (
        <div className="grid min-h-screen place-items-center bg-[#f6f8fb] text-sm font-semibold text-slate-500">데이터를 불러오는 중...</div>
      ) : (
        <>
          {syncError && (
            <div className="fixed left-1/2 top-3 z-[200] w-[min(680px,calc(100vw-24px))] -translate-x-1/2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 shadow-lg">
              데이터 동기화 오류: {syncError}
            </div>
          )}
          {children}
        </>
      )}
    </AppStoreContext.Provider>
  );
}

export function useStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error("useStore는 AppStoreProvider 내부에서만 사용할 수 있습니다.");
  return ctx;
}
