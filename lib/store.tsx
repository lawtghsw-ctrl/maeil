"use client";

// 전역(메모리) 상태 스토어 — 실제 백엔드가 없는 데모이므로, DB관리→고객관리 전환이나
// 고객정보 수정, 분납 일정 편집, 게시판 CRUD 같은 상호작용이 여러 화면에서 일관되게
// 보이도록 React Context로 관리합니다.
// 새로고침하면 seed 데이터로 초기화됩니다(브라우저 저장소 사용 안 함).
// 실서비스 전환 시 이 파일의 setState 호출부를 Supabase insert/update 호출로 바꾸면 됩니다.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  cases as seedCases,
  clients as seedClients,
  installments as seedInstallments,
  leads as seedLeads,
  posts as seedPosts,
  scheduleItems as seedScheduleItems,
} from "./mock-data";
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
import { defaultMinLivingCostTable, type MinLivingCostTable } from "./consultation";

type DocumentState = Record<string, Record<string, boolean>>; // caseId -> itemId -> checked

export interface InstallmentDraft {
  id?: string;
  dueDate: string;
  amount: number;
  status: InstallmentStatus;
  paidDate?: string;
}

// ---- 기간별 변동내역(도원 Admin '변동내역'과 동일한 취지) ----
// 실제 DB가 없는 데모라 Supabase 트리거 대신, 각 store 메서드 호출부에서 직접
// 변경 요약 문자열을 남기는 방식으로 단순화했습니다.
export type ChangeCategory = "DB관리" | "고객관리" | "계약관리" | "입금·분납" | "게시판" | "설정";
export type ChangeAction = "등록" | "수정" | "삭제";

// ---- 결제수단별 정산요율 (담당자별로 로펌 관리자가 설정) ----
// 결제수단(단순분납/로피분납/신카할부완납/캐피탈분납)에 따라 실제 정산금이 달라지고,
// 같은 결제수단이라도 담당자별로 다른 요율을 적용할 수 있어야 한다는 요청을 반영.
export type SettlementRateMap = Record<StaffName, Record<PaymentMethod, number>>;

const DEFAULT_RATE_BY_METHOD: Record<PaymentMethod, number> = {
  단순분납: 100,
  로피분납: 90,
  신카할부완납: 85,
  캐피탈분납: 80,
};

function defaultSettlementRates(): SettlementRateMap {
  const map = {} as SettlementRateMap;
  for (const staff of STAFF_LIST) {
    map[staff] = { ...DEFAULT_RATE_BY_METHOD };
  }
  return map;
}

export interface ChangeLogEntry {
  id: string;
  category: ChangeCategory;
  action: ChangeAction;
  targetName: string; // 대상 이름(고객명·게시글 제목 등)
  detail: string; // 변경 내용 요약
  staff: string;
  at: string; // ISO datetime
}

// 데모 버전 로그인 주체 — 실제 인증 연동 전까지 '직원1' 고정
export const CURRENT_STAFF = "직원1";

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
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  updateLead: (id: string, patch: Partial<DbLead>) => void;
  convertLeadToClient: (leadId: string) => string | undefined; // 생성된(또는 기존) clientId 반환
  toggleDocument: (caseId: string, itemId: string) => void;
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

function todayIsoStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(
    2,
    "0"
  )}`;
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>(seedClients);
  const [cases, setCases] = useState<CaseRecord[]>(seedCases);
  const [installments, setInstallments] = useState<Installment[]>(seedInstallments);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>(seedScheduleItems);
  const [leads, setLeads] = useState<DbLead[]>(seedLeads);
  const [posts, setPosts] = useState<BoardPost[]>(seedPosts);
  const [caseDocuments, setCaseDocuments] = useState<DocumentState>({});
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const [settlementRates, setSettlementRates] = useState<SettlementRateMap>(() => defaultSettlementRates());
  const [minLivingCostTable, setMinLivingCostTable] = useState<MinLivingCostTable>(() => defaultMinLivingCostTable());
  const clientSeqRef = useRef(seedClients.length);
  const postSeqRef = useRef(seedPosts.length);
  const insSeqRef = useRef(0);
  const changeSeqRef = useRef(0);

  const logChange = useCallback(
    (category: ChangeCategory, action: ChangeAction, targetName: string, detail: string) => {
      changeSeqRef.current += 1;
      const entry: ChangeLogEntry = {
        id: `CHG-${String(changeSeqRef.current).padStart(5, "0")}`,
        category,
        action,
        targetName,
        detail,
        staff: CURRENT_STAFF,
        at: new Date().toISOString(),
      };
      setChangeLog((prev) => [entry, ...prev]);
    },
    []
  );

  const updateClient = useCallback(
    (id: string, patch: Partial<Client>) => {
      setClients((prev) => {
        const before = prev.find((c) => c.id === id);
        if (before) logChange("고객관리", "수정", before.name, "고객정보 수정");
        return prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
      });
    },
    [logChange]
  );

  const deleteClient = useCallback(
    (id: string) => {
      const clientCaseIds = cases.filter((c) => c.clientId === id).map((c) => c.id);
      setClients((prev) => {
        const target = prev.find((c) => c.id === id);
        if (target) logChange("고객관리", "삭제", target.name, "고객 정보 및 연결된 계약·분납 데이터 삭제");
        return prev.filter((c) => c.id !== id);
      });
      setCases((prev) => prev.filter((c) => c.clientId !== id));
      setInstallments((prev) => prev.filter((i) => !clientCaseIds.includes(i.caseId)));
      setScheduleItems((prev) =>
        prev.filter((s) => s.clientId !== id && !(s.caseId && clientCaseIds.includes(s.caseId)))
      );
    },
    [cases, logChange]
  );

  const updateLead = useCallback(
    (id: string, patch: Partial<DbLead>) => {
      setLeads((prev) => {
        const before = prev.find((l) => l.id === id);
        if (before) logChange("DB관리", "수정", before.name, "DB 리드 정보 수정");
        return prev.map((l) => (l.id === id ? { ...l, ...patch } : l));
      });
    },
    [logChange]
  );

  // leads를 직접 참조해야 해서(이미 전환됐는지 확인) 의존성 배열에 leads를 포함함.
  const convertLeadToClient = useCallback(
    (leadId: string): string | undefined => {
      const lead = leads.find((l) => l.id === leadId);
      if (!lead) return undefined;
      if (lead.convertedClientId) return lead.convertedClientId;

      clientSeqRef.current += 1;
      const newClientId = `CL-${String(clientSeqRef.current).padStart(4, "0")}`;

      setClients((prev) => [
        ...prev,
        {
          id: newClientId,
          name: lead.name,
          phone: lead.phone,
          registeredAt: todayIsoStr(),
          assignedStaff: lead.assignedStaff,
          memo: lead.memo,
          fromLeadId: lead.id,
          applicationType: lead.applicationType,
        },
      ]);

      setLeads((prev) =>
        prev.map((l) =>
          l.id === leadId ? { ...l, status: "수임전환" as const, convertedClientId: newClientId } : l
        )
      );

      logChange("DB관리", "수정", lead.name, "고객관리로 전환(전환 완료)");

      return newClientId;
    },
    [leads, logChange]
  );

  const toggleDocument = useCallback((caseId: string, itemId: string) => {
    setCaseDocuments((prev) => {
      const caseState = prev[caseId] ?? {};
      return {
        ...prev,
        [caseId]: { ...caseState, [itemId]: !caseState[itemId] },
      };
    });
  }, []);

  const updateCase = useCallback(
    (id: string, patch: Partial<CaseRecord>) => {
      setCases((prev) => {
        const before = prev.find((c) => c.id === id);
        if (before) logChange("계약관리", "수정", before.caseNumber, "계약 관련 메모/정보 수정");
        return prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
      });
    },
    [logChange]
  );

  // 고객 상세 패널의 '분납관리'에서 사건 하나의 입금/분납 일정 전체를 새 배열로 교체.
  // 계약금(1회차) 표시 규칙(seq===1)을 유지하기 위해 배열 순서를 그대로 seq로 사용하고,
  // 저장 시 사건의 기납부액(paidAmount)도 완료 건 합계로 재계산해 미수금이 자동 반영되게 함.
  const setCaseInstallments = useCallback(
    (caseId: string, rows: InstallmentDraft[]) => {
      const updated: Installment[] = rows.map((r, idx) => {
        insSeqRef.current += 1;
        return {
          id: r.id ?? `${caseId}-INS-NEW-${insSeqRef.current}`,
          caseId,
          seq: idx + 1,
          dueDate: r.dueDate,
          amount: r.amount,
          status: r.status,
          paidDate: r.paidDate || undefined,
        };
      });
      setInstallments((prev) => [...prev.filter((i) => i.caseId !== caseId), ...updated]);
      const paidAmount = updated.filter((i) => i.status === "완료").reduce((a, i) => a + i.amount, 0);
      setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, paidAmount } : c)));
      const c = cases.find((x) => x.id === caseId);
      if (c) logChange("입금·분납", "수정", c.caseNumber, "입금/분납 일정 저장");
    },
    [cases, logChange]
  );

  const addPost = useCallback(
    (draft: Omit<BoardPost, "id">) => {
      postSeqRef.current += 1;
      setPosts((prev) => [...prev, { ...draft, id: `POST-${String(postSeqRef.current).padStart(4, "0")}` }]);
      logChange("게시판", "등록", draft.title, "게시글 등록");
    },
    [logChange]
  );

  const updatePost = useCallback(
    (id: string, patch: Partial<BoardPost>) => {
      setPosts((prev) => {
        const before = prev.find((p) => p.id === id);
        if (before) logChange("게시판", "수정", before.title, "게시글 수정");
        return prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
      });
    },
    [logChange]
  );

  const deletePost = useCallback(
    (id: string) => {
      setPosts((prev) => {
        const before = prev.find((p) => p.id === id);
        if (before) logChange("게시판", "삭제", before.title, "게시글 삭제");
        return prev.filter((p) => p.id !== id);
      });
    },
    [logChange]
  );

  const updateSettlementRate = useCallback(
    (staff: StaffName, method: PaymentMethod, rate: number) => {
      setSettlementRates((prev) => ({ ...prev, [staff]: { ...prev[staff], [method]: rate } }));
      logChange("설정", "수정", `${staff} · ${method}`, `정산요율 ${rate}%로 변경`);
    },
    [logChange]
  );

  const setMinLivingCostForSize = useCallback(
    (size: number, amount: number) => {
      setMinLivingCostTable((prev) => ({ ...prev, sizes: { ...prev.sizes, [size]: amount } }));
      logChange("설정", "수정", "최저생계비 계산기", `${size}인가구 최저생계비 ${amount.toLocaleString("ko-KR")}원으로 설정`);
    },
    [logChange]
  );

  const setMinLivingCostExtraPerPerson = useCallback(
    (amount: number) => {
      setMinLivingCostTable((prev) => ({ ...prev, extraPerPerson: amount }));
      logChange("설정", "수정", "최저생계비 계산기", `7인 이상 1인당 추가금액 ${amount.toLocaleString("ko-KR")}원으로 설정`);
    },
    [logChange]
  );

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
      updateClient,
      deleteClient,
      updateLead,
      convertLeadToClient,
      toggleDocument,
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
      updateClient,
      deleteClient,
      updateLead,
      convertLeadToClient,
      toggleDocument,
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

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useStore(): AppStoreValue {
  const ctx = useContext<AppStoreValue | null>(AppStoreContext);
  if (!ctx) {
    throw new Error("useStore는 AppStoreProvider 내부에서만 사용할 수 있습니다.");
  }
  return ctx;
}
