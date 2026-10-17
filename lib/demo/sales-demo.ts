import type { BoardPost, CaseRecord, Client, DbLead, Installment, ScheduleItem } from "@/lib/types";
import type { LawyerConfig } from "@/lib/performance/lawyers";

export const SALES_DEMO_KEY = "sales_demo_seed_v1";
export const SALES_DEMO_KIND = "lawpower_sales_demo_v1";
export const SALES_DEMO_CODE = "0000000000";
export const SALES_DEMO_REPRESENTATIVE = "영업 시연용 · 가상 데이터";
export const SALES_DEMO_COUNTS = { leads: 12, clients: 4, cases: 4, installments: 8, schedules: 3, posts: 1 } as const;

// Fixtures are deliberately synthetic and contain no usable recipient contacts.
// The factory has no database, network or credential dependency.
export function buildSalesDemo(firmId: string, seedDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seedDate) || !Number.isFinite(Date.parse(`${seedDate}T00:00:00Z`))) throw new Error("시연 기준일을 확인해주세요.");
  const month = seedDate.slice(0, 7), day = Number(seedDate.slice(8));
  const date = (offset: number) => `${month}-${String(Math.max(1, Math.min(28, day + offset))).padStart(2, "0")}`;
  const id = (kind: string, n: number) => `DEMO-${firmId}-${kind}-${n}`;
  const name = (n: number) => `시연고객 ${String(n).padStart(2, "0")}`;
  const staff = (n: number) => `TEST${n % 3 + 1}`;
  const leads: DbLead[] = Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    return { id: id("DB", number), name: name(number), phone: "", receivedAt: `${date(-index)}T10:00:00+09:00`,
      assignedStaff: staff(index), status: index < 4 ? "수임전환" : index < 7 ? "상담완료" : index < 9 ? "재통화필요" : "신규접수",
      detailStage: index < 4 ? "착수금착수" : index < 7 ? "상담" : index < 9 ? "예약" : "신규디비",
      applicationType: index === 2 ? "개인파산" : "개인회생", memo: "영업 시연용 가상 고객입니다. 실제 연락처·외부 발송 정보가 없습니다.",
      ...(index < 4 ? { convertedClientId: id("CLIENT", number), convertedCaseId: id("CASE", number) } : {}),
      consultation: { memoLog: [{ id: id("MEMO", number), at: `${date(-index)}T11:00:00+09:00`, staff: staff(index), tag: index === 7 ? "재통화" : "일반", text: index < 4 ? "[시연] 상담 완료 후 계약 진행" : "[시연] 채무 및 소득 확인 후 상담 안내" }] } };
  });
  const clients: Client[] = leads.slice(0, 4).map((lead, index) => ({ id: id("CLIENT", index + 1), name: lead.name, phone: "", registeredAt: date(-index), assignedStaff: lead.assignedStaff, fromLeadId: lead.id, applicationType: lead.applicationType, consultation: lead.consultation, memo: "가상 시연 고객" }));
  const amounts = [3300000, 4400000, 2750000, 3850000];
  const stages: CaseRecord["stage"][] = ["서류준비", "법원접수", "개시_선고", "종결"];
  const cases: CaseRecord[] = clients.map((client, index) => ({ id: id("CASE", index + 1), clientId: client.id, caseNumber: `시연-${month.replace("-", "")}-${String(index + 1).padStart(3, "0")}`,
    caseType: index === 2 ? "개인파산" : "개인회생", court: "시연 관할법원", stage: stages[index], stageUpdatedAt: date(-index), status: index === 3 ? "종결" : "진행중", assignedStaff: staff(index),
    totalDebt: [52000000, 74000000, 38000000, 61000000][index], monthlyRepayment: index === 2 ? 0 : 350000,
    contractAmount: amounts[index], contractDate: date(-index - 1), paidAmount: index === 3 ? amounts[index] : amounts[index] / 2,
    installmentCount: 2, paymentMethod: "단순분납", memo: "[영업 시연] 가상 계약이며 실제 사건·전자계약이 아닙니다.", fromLeadId: leads[index].id }));
  const installments: Installment[] = cases.flatMap((record, index) => [
    { id: id("PAY", index * 2 + 1), caseId: record.id, seq: 1, dueDate: date(-index - 1), amount: record.contractAmount / 2, actualPaidAmount: record.contractAmount / 2, status: "완료", paidDate: date(-index - 1) },
    { id: id("PAY", index * 2 + 2), caseId: record.id, seq: 2, dueDate: date(index === 0 ? -2 : 4), amount: record.contractAmount / 2,
      status: index === 3 ? "완료" : index === 0 ? "연체" : "예정", ...(index === 3 ? { actualPaidAmount: record.contractAmount / 2, paidDate: date(-1) } : {}) },
  ]);
  const schedules: ScheduleItem[] = [
    { id: id("SCHEDULE", 1), caseId: cases[0].id, clientId: clients[0].id, type: "서류제출기한", date: date(2), title: "[시연] 개인회생 서류 확인", done: false },
    { id: id("SCHEDULE", 2), caseId: cases[1].id, clientId: clients[1].id, type: "법원기일", date: date(3), title: "[시연] 사건 진행 점검", done: false },
    { id: id("SCHEDULE", 3), caseId: cases[2].id, clientId: clients[2].id, type: "상담예약", date: date(1), title: "[시연] 추가 상담", done: false },
  ];
  const posts: BoardPost[] = [{ id: id("POST", 1), title: "TEST 영업 시연 안내", body: "이 로펌의 고객·계약·수납은 모두 가상 데이터입니다. 실제 연락처와 외부 연동은 등록되어 있지 않습니다.", writer: "TEST 관리자", date: seedDate, isNotice: true, noticeOrder: 1, attachments: [] }];
  const lawyers: LawyerConfig = { version: 1, lawyers: [{ id: id("LAWYER", 1), name: "시연 변호사 A", isActive: true }, { id: id("LAWYER", 2), name: "시연 변호사 B", isActive: true }],
    assignments: Object.fromEntries(cases.slice(0, 3).map((record, index) => [record.id, id("LAWYER", index % 2 + 1)])) };
  return { leads, clients, cases, installments, schedules, posts, lawyers };
}
