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
import { STAFF_LIST } from "./types";
import { checkConsultationRequired, defaultMinLivingCostTable, type MinLivingCostTable } from "./consultation";
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
  staffName?: StaffName;
  isActive: boolean;
  isWorkStaff: boolean;
  permissions: PermissionMap;
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
  isAdmin: boolean;
  currentStaff?: StaffName;
  can: (permission: PermissionKey) => boolean;
  reloadData: () => Promise<void>;
  signOut: () => Promise<void>;
  addLead: (draft: Omit<DbLead, "id" | "receivedAt"> & { receivedAt?: string }) => string;
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  updateLead: (id: string, patch: Partial<DbLead>) => void;
  deleteLead: (id: string) => void;
  convertLeadToClient: (leadId: string) => string | undefined;
  toggleDocument: (caseId: string, itemId: string) => void;
  addCase: (draft: Omit<CaseRecord, "id">) => string;
  updateCase: (id: string, patch: Partial<CaseRecord>) => void;
  setCaseInstallments: (caseId: string, rows: InstallmentDraft[]) => void;
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
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(configured ? null : "Supabase 환경변수가 설정되지 않았습니다.");

  const actorName = profile?.displayName || profile?.staffName || currentUser?.email || "시스템";
  const currentStaff = profile?.staffName;
  const isAdmin = profile?.role === "admin";
  const can = useCallback(
    (permission: PermissionKey) => Boolean(profile?.isActive && (profile.role === "admin" || profile.permissions?.[permission] === true)),
    [profile]
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
        if (key === "paidAmount") return can("cases.manage_installments");
        if (key === "docsSentAt") return can("cases.send_docs");
        return false;
      });
    },
    [can, isAdmin]
  );

  const fetchEntityTable = useCallback(
    async <T,>(table: string): Promise<T[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from(table).select("id,data");
      if (error) throw error;
      return (data ?? []).map((row: { id: string; data: unknown }) => ({ ...(row.data as T), id: row.id } as T));
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

      const [
        loadedLeads,
        loadedClients,
        loadedCases,
        loadedInstallments,
        loadedSchedule,
        loadedPosts,
        loadedChanges,
        settingsRes,
        profileRes,
        directoryRes,
      ] = await Promise.all([
        fetchEntityTable<DbLead>("app_leads"),
        fetchEntityTable<Client>("app_clients"),
        fetchEntityTable<CaseRecord>("app_cases"),
        fetchEntityTable<Installment>("app_installments"),
        fetchEntityTable<ScheduleItem>("app_schedule_items"),
        fetchEntityTable<BoardPost>("app_board_posts"),
        fetchEntityTable<ChangeLogEntry>("app_change_logs"),
        supabase.from("app_settings").select("key,value"),
        supabase.from("profiles").select("id,email,display_name,role,staff_name,is_active,is_work_staff,permissions").eq("id", user.id).maybeSingle(),
        supabase.from("profiles").select("id,display_name,role,staff_name,is_active,is_work_staff,permissions").eq("is_work_staff", true).order("display_name"),
      ]);

      if (settingsRes.error) throw settingsRes.error;
      if (profileRes.error) throw profileRes.error;
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
        staffName: asStaffName(row.staff_name || row.display_name),
        isActive: row.is_active !== false,
        isWorkStaff: row.is_work_staff !== false,
        permissions: (row.permissions ?? {}) as PermissionMap,
      }));
      setStaffDirectory(directory);

      const settings = new Map((settingsRes.data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
      const rates = settings.get("settlement_rates") as SettlementRateMap | undefined;
      const living = settings.get("min_living_cost") as MinLivingCostTable | undefined;
      const docs = settings.get("case_documents") as DocumentState | undefined;
      const rateDefaults = defaultSettlementRates(directory.map((item) => item.staffName).filter(Boolean) as string[]);
      if (rates) setSettlementRates({ ...rateDefaults, ...rates });
      else setSettlementRates(rateDefaults);
      if (living) setMinLivingCostTable(living);
      if (docs) setCaseDocuments(docs);

      const p = profileRes.data;
      if (!p || p.is_active === false) {
        setProfile(
          p
            ? {
                id: p.id,
                email: p.email ?? user.email ?? undefined,
                displayName: p.display_name || user.email || "사용자",
                role: p.role === "admin" ? "admin" : "staff",
                staffName: asStaffName(p.staff_name || p.display_name),
                isActive: false,
                isWorkStaff: p.is_work_staff !== false,
                permissions: (p.permissions ?? {}) as PermissionMap,
              }
            : null
        );
        setLeads([]);
        setClients([]);
        setCases([]);
        setInstallments([]);
        setScheduleItems([]);
        setPosts([]);
        setChangeLog([]);
        setSyncError(p ? "비활성 계정입니다. 최종관리자에게 계정 활성화를 요청해주세요." : "사용자 프로필이 없습니다. Supabase 초기 SQL을 확인해주세요.");
        await supabase.auth.signOut();
        if (typeof window !== "undefined") window.location.replace("/login");
        return;
      }

      setProfile({
        id: p.id,
        email: p.email ?? user.email ?? undefined,
        displayName: p.display_name || user.email || "사용자",
        role: p.role === "admin" ? "admin" : "staff",
        staffName: asStaffName(p.staff_name || p.display_name),
        isActive: true,
        isWorkStaff: p.is_work_staff !== false,
        permissions: (p.permissions ?? {}) as PermissionMap,
      });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Supabase 데이터 로딩에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [fetchEntityTable, supabase]);

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
    async (table: string, entity: { id: string }) => {
      if (!supabase) throw new Error("Supabase가 연결되지 않았습니다.");
      const { error } = await supabase.from(table).upsert({ id: entity.id, data: entity }, { onConflict: "id" });
      if (error) throw error;
    },
    [supabase]
  );

  const deleteEntity = useCallback(
    async (table: string, id: string) => {
      if (!supabase) throw new Error("Supabase가 연결되지 않았습니다.");
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    [supabase]
  );

  const saveSetting = useCallback(
    async (key: string, value: unknown) => {
      if (!supabase) throw new Error("Supabase가 연결되지 않았습니다.");
      const { error } = await supabase.from("app_settings").upsert({ key, value }, { onConflict: "key" });
      if (error) throw error;
    },
    [supabase]
  );

  const queueWrite = useCallback(
    (promise: Promise<unknown>) => {
      void promise.catch((err) => {
        setSyncError(err instanceof Error ? err.message : "데이터 저장에 실패했습니다.");
        void reloadData();
      });
    },
    [reloadData]
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
      if (!can("db.create")) return "";
      const lead: DbLead = {
        ...draft,
        assignedStaff: can("db.change_assignee") ? draft.assignedStaff : (currentStaff || draft.assignedStaff),
        id: makeId("DB"),
        receivedAt: draft.receivedAt ?? new Date().toISOString(),
      };
      setLeads((prev) => [lead, ...prev]);
      queueWrite(saveEntity("app_leads", lead));
      logChange("DB관리", "등록", lead.name, "신규 DB 등록");
      return lead.id;
    },
    [can, currentStaff, logChange, queueWrite, saveEntity]
  );

  const updateClient = useCallback(
    (id: string, patch: Partial<Client>) => {
      if (!isAdmin) return;
      const before = clients.find((c) => c.id === id);
      if (!before) return;
      const next = { ...before, ...patch };
      setClients((prev) => prev.map((c) => (c.id === id ? next : c)));
      queueWrite(saveEntity("app_clients", next));
      logChange("계약관리", "수정", before.name, "고객정보 수정");
    },
    [clients, isAdmin, logChange, queueWrite, saveEntity]
  );

  const deleteClient = useCallback(
    (id: string) => {
      if (!isAdmin) return;
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
    [cases, clients, deleteEntity, installments, isAdmin, logChange, queueWrite, scheduleItems]
  );

  const updateLead = useCallback(
    (id: string, patch: Partial<DbLead>) => {
      if (!canPatchLead(patch)) return;
      const before = leads.find((l) => l.id === id);
      if (!before) return;
      const next = { ...before, ...patch };
      setLeads((prev) => prev.map((l) => (l.id === id ? next : l)));
      queueWrite(saveEntity("app_leads", next));
      logChange("DB관리", "수정", before.name, "DB 리드 정보 수정");
    },
    [canPatchLead, leads, logChange, queueWrite, saveEntity]
  );

  const deleteLead = useCallback(
    (id: string) => {
      if (!can("db.delete")) return;
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
    [can, deleteEntity, leads, logChange, queueWrite]
  );

  const convertLeadToClient = useCallback(
    (leadId: string): string | undefined => {
      if (!can("db.convert")) return undefined;
      const lead = leads.find((l) => l.id === leadId);
      if (!lead) return undefined;
      if (lead.convertedClientId) return lead.convertedClientId;

      const completeness = checkConsultationRequired(lead.applicationType, lead.consultation);
      if (!completeness.ok) return undefined;

      const client: Client = {
        id: makeId("CL"),
        name: lead.name,
        phone: lead.phone,
        registeredAt: todayIsoStr(),
        assignedStaff: lead.assignedStaff,
        memo: lead.memo,
        fromLeadId: lead.id,
        applicationType: lead.applicationType,
        consultation: lead.consultation,
      };
      const nextLead: DbLead = { ...lead, status: "수임전환", convertedClientId: client.id };

      setClients((prev) => [...prev, client]);
      setLeads((prev) => prev.map((l) => (l.id === leadId ? nextLead : l)));
      queueWrite(Promise.all([saveEntity("app_clients", client), saveEntity("app_leads", nextLead)]));
      logChange("DB관리", "수정", lead.name, "계약관리 전환용 고객 생성");
      return client.id;
    },
    [can, leads, logChange, queueWrite, saveEntity]
  );

  const toggleDocument = useCallback(
    (caseId: string, itemId: string) => {
      if (!can("cases.send_docs")) return;
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
    [can, caseDocuments, queueWrite, saveSetting]
  );

  const addCase = useCallback(
    (draft: Omit<CaseRecord, "id">): string => {
      if (!can("cases.create")) return "";
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
    [can, clients, currentStaff, leads, logChange, queueWrite, saveEntity]
  );

  const updateCase = useCallback(
    (id: string, patch: Partial<CaseRecord>) => {
      if (!canPatchCase(patch)) return;
      const before = cases.find((c) => c.id === id);
      if (!before) return;
      const next = { ...before, ...patch };
      setCases((prev) => prev.map((c) => (c.id === id ? next : c)));
      queueWrite(saveEntity("app_cases", next));
      logChange("계약관리", "수정", before.caseNumber, "계약 관련 정보 수정");
    },
    [canPatchCase, cases, logChange, queueWrite, saveEntity]
  );

  const setCaseInstallments = useCallback(
    (caseId: string, rows: InstallmentDraft[]) => {
      if (!can("cases.manage_installments")) return;
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
      const paidAmount = updated.filter((i) => i.status === "완료").reduce((sum, i) => sum + i.amount, 0);
      const caseBefore = cases.find((c) => c.id === caseId);
      const caseNext = caseBefore ? { ...caseBefore, paidAmount } : undefined;

      setInstallments((prev) => [...prev.filter((i) => i.caseId !== caseId), ...updated]);
      if (caseNext) setCases((prev) => prev.map((c) => (c.id === caseId ? caseNext : c)));

      queueWrite(
        Promise.all([
          ...removed.map((i) => deleteEntity("app_installments", i.id)),
          ...updated.map((i) => saveEntity("app_installments", i)),
          ...(caseNext ? [saveEntity("app_cases", caseNext)] : []),
        ])
      );
      if (caseBefore) logChange("계약관리", "수정", caseBefore.caseNumber, "분납 일정 저장");
    },
    [can, cases, deleteEntity, installments, logChange, queueWrite, saveEntity]
  );

  const addPost = useCallback(
    (draft: Omit<BoardPost, "id">) => {
      const post: BoardPost = { ...draft, id: makeId("POST") };
      setPosts((prev) => [...prev, post]);
      queueWrite(saveEntity("app_board_posts", post));
      logChange("게시판", "등록", draft.title, "게시글 등록");
    },
    [logChange, queueWrite, saveEntity]
  );

  const updatePost = useCallback(
    (id: string, patch: Partial<BoardPost>) => {
      const before = posts.find((p) => p.id === id);
      if (!before) return;
      const next = { ...before, ...patch };
      setPosts((prev) => prev.map((p) => (p.id === id ? next : p)));
      queueWrite(saveEntity("app_board_posts", next));
      logChange("게시판", "수정", before.title, "게시글 수정");
    },
    [logChange, posts, queueWrite, saveEntity]
  );

  const deletePost = useCallback(
    (id: string) => {
      const before = posts.find((p) => p.id === id);
      if (!before) return;
      setPosts((prev) => prev.filter((p) => p.id !== id));
      queueWrite(deleteEntity("app_board_posts", id));
      logChange("게시판", "삭제", before.title, "게시글 삭제");
    },
    [deleteEntity, logChange, posts, queueWrite]
  );

  const updateSettlementRate = useCallback(
    (staff: StaffName, method: PaymentMethod, rate: number) => {
      if (!can("settlement_settings.edit")) return;
      const next = { ...settlementRates, [staff]: { ...settlementRates[staff], [method]: rate } };
      setSettlementRates(next);
      queueWrite(saveSetting("settlement_rates", next));
      logChange("설정", "수정", `${staff} · ${method}`, `정산요율 ${rate}%로 변경`);
    },
    [can, logChange, queueWrite, saveSetting, settlementRates]
  );

  const setMinLivingCostForSize = useCallback(
    (size: number, amount: number) => {
      if (!can("living.edit")) return;
      const next = { ...minLivingCostTable, sizes: { ...minLivingCostTable.sizes, [size]: amount } };
      setMinLivingCostTable(next);
      queueWrite(saveSetting("min_living_cost", next));
      logChange("설정", "수정", "최저생계비 계산기", `${size}인가구 최저생계비 ${amount.toLocaleString("ko-KR")}원으로 설정`);
    },
    [can, logChange, minLivingCostTable, queueWrite, saveSetting]
  );

  const setMinLivingCostExtraPerPerson = useCallback(
    (amount: number) => {
      if (!can("living.edit")) return;
      const next = { ...minLivingCostTable, extraPerPerson: amount };
      setMinLivingCostTable(next);
      queueWrite(saveSetting("min_living_cost", next));
      logChange("설정", "수정", "최저생계비 계산기", `추가 가구원 기준금액 ${amount.toLocaleString("ko-KR")}원으로 설정`);
    },
    [can, logChange, minLivingCostTable, queueWrite, saveSetting]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
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
