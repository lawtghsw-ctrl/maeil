"use client";

// 전역(메모리) 상태 스토어 — 실제 백엔드가 없는 데모이므로, DB관리→고객관리 전환이나
// 고객정보 수정 같은 상호작용이 여러 화면에서 일관되게 보이도록 React Context로 관리합니다.
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
  scheduleItems as seedScheduleItems,
} from "./mock-data";
import type { CaseRecord, Client, DbLead, Installment, ScheduleItem } from "./types";

type DocumentState = Record<string, Record<string, boolean>>; // caseId -> itemId -> checked

interface AppStoreValue {
  clients: Client[];
  cases: CaseRecord[];
  installments: Installment[];
  scheduleItems: ScheduleItem[];
  leads: DbLead[];
  caseDocuments: DocumentState;
  updateClient: (id: string, patch: Partial<Client>) => void;
  updateLead: (id: string, patch: Partial<DbLead>) => void;
  convertLeadToClient: (leadId: string) => string | undefined; // 생성된(또는 기존) clientId 반환
  toggleDocument: (caseId: string, itemId: string) => void;
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
  const [cases] = useState<CaseRecord[]>(seedCases);
  const [installments] = useState<Installment[]>(seedInstallments);
  const [scheduleItems] = useState<ScheduleItem[]>(seedScheduleItems);
  const [leads, setLeads] = useState<DbLead[]>(seedLeads);
  const [caseDocuments, setCaseDocuments] = useState<DocumentState>({});
  const clientSeqRef = useRef(seedClients.length);

  const updateClient = useCallback((id: string, patch: Partial<Client>) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

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
          source: lead.source,
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

  const value = useMemo<AppStoreValue>(
    () => ({
      clients,
      cases,
      installments,
      scheduleItems,
      leads,
      caseDocuments,
      updateClient,
      updateLead,
      convertLeadToClient,
      toggleDocument,
    }),
    [
      clients,
      cases,
      installments,
      scheduleItems,
      leads,
      caseDocuments,
      updateClient,
      updateLead,
      convertLeadToClient,
      toggleDocument,
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
