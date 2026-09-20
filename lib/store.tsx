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
  ScheduleItem,
} from "./types";

type DocumentState = Record<string, Record<string, boolean>>; // caseId -> itemId -> checked

export interface InstallmentDraft {
  id?: string;
  dueDate: string;
  amount: number;
  status: InstallmentStatus;
  paidDate?: string;
}

interface AppStoreValue {
  clients: Client[];
  cases: CaseRecord[];
  installments: Installment[];
  scheduleItems: ScheduleItem[];
  leads: DbLead[];
  posts: BoardPost[];
  caseDocuments: DocumentState;
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  updateLead: (id: string, patch: Partial<DbLead>) => void;
  convertLeadToClient: (leadId: string) => string | undefined; // 생성된(또는 기존) clientId 반환
  toggleDocument: (caseId: string, itemId: string) => void;
  setCaseInstallments: (caseId: string, rows: InstallmentDraft[]) => void;
  addPost: (draft: Omit<BoardPost, "id">) => void;
  updatePost: (id: string, patch: Partial<BoardPost>) => void;
  deletePost: (id: string) => void;
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
  const clientSeqRef = useRef(seedClients.length);
  const postSeqRef = useRef(seedPosts.length);
  const insSeqRef = useRef(0);

  const updateClient = useCallback((id: string, patch: Partial<Client>) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const deleteClient = useCallback(
    (id: string) => {
      const clientCaseIds = cases.filter((c) => c.clientId === id).map((c) => c.id);
      setClients((prev) => prev.filter((c) => c.id !== id));
      setCases((prev) => prev.filter((c) => c.clientId !== id));
      setInstallments((prev) => prev.filter((i) => !clientCaseIds.includes(i.caseId)));
      setScheduleItems((prev) =>
        prev.filter((s) => s.clientId !== id && !(s.caseId && clientCaseIds.includes(s.caseId)))
      );
    },
    [cases]
  );

  const updateLead = useCallback((id: string, patch: Partial<DbLead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

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
        },
      ]);

      setLeads((prev) =>
        prev.map((l) =>
          l.id === leadId ? { ...l, status: "수임전환" as const, convertedClientId: newClientId } : l
        )
      );

      return newClientId;
    },
    [leads]
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

  // 고객 상세 패널의 '분납관리'에서 사건 하나의 입금/분납 일정 전체를 새 배열로 교체.
  // 계약금(1회차) 표시 규칙(seq===1)을 유지하기 위해 배열 순서를 그대로 seq로 사용하고,
  // 저장 시 사건의 기납부액(paidAmount)도 완료 건 합계로 재계산해 미수금이 자동 반영되게 함.
  const setCaseInstallments = useCallback((caseId: string, rows: InstallmentDraft[]) => {
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
  }, []);

  const addPost = useCallback((draft: Omit<BoardPost, "id">) => {
    postSeqRef.current += 1;
    setPosts((prev) => [...prev, { ...draft, id: `POST-${String(postSeqRef.current).padStart(4, "0")}` }]);
  }, []);

  const updatePost = useCallback((id: string, patch: Partial<BoardPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const deletePost = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const value = useMemo<AppStoreValue>(
    () => ({
      clients,
      cases,
      installments,
      scheduleItems,
      leads,
      posts,
      caseDocuments,
      updateClient,
      deleteClient,
      updateLead,
      convertLeadToClient,
      toggleDocument,
      setCaseInstallments,
      addPost,
      updatePost,
      deletePost,
    }),
    [
      clients,
      cases,
      installments,
      scheduleItems,
      leads,
      posts,
      caseDocuments,
      updateClient,
      deleteClient,
      updateLead,
      convertLeadToClient,
      toggleDocument,
      setCaseInstallments,
      addPost,
      updatePost,
      deletePost,
    ]
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) {
    throw new Error("useStore는 AppStoreProvider 내부에서만 사용할 수 있습니다.");
  }
  return ctx;
}
