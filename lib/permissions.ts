export const PERMISSION_GROUPS = [
  {
    id: "dashboard",
    label: "대시보드",
    description: "대시보드 상단 실적, 투두, 캘린더, 통계, 금액정보를 각각 분리해서 제어합니다.",
    items: [
      ["dashboard.view", "대시보드 조회", "대시보드 메뉴와 기본 상단 KPI에 접근"],
      ["dashboard.company_metrics", "전사 상단 실적 조회", "개인 실적이 아닌 전체 실무 담당자의 상단 KPI/계약건을 조회"],
      ["dashboard.company_todo", "전사 투두리스트 조회", "재통화약속·상담중·고려중 목록을 전체 담당자 기준으로 조회"],
      ["dashboard.finance", "대시보드 금액정보 조회", "계약금액·결제완료액·미수금 등 금액성 정보를 조회"],
      ["dashboard.installment_calendar", "분납 캘린더 조회", "대시보드의 월별 분납 일정과 예정/완료 금액 조회"],
      ["dashboard.schedule_calendar", "기일·제출기한 캘린더 조회", "법원 기일/제출기한 캘린더 조회"],
      ["dashboard.statistics", "기간별 통계/차트 조회", "기간별 통계, 사건유형 결제구성, 절차단계 현황 조회"],
    ],
  },
  {
    id: "db",
    label: "DB관리",
    description: "상담 리드의 조회 범위부터 상담일지·진행단계·예약·담당자 변경·고객전환까지 제어합니다.",
    items: [
      ["db.view", "DB관리 조회", "DB관리 메뉴 및 본인 담당 DB 목록 조회"],
      ["db.view_all", "전체 담당자 DB 조회", "본인 담당이 아닌 다른 실무 담당자의 DB까지 조회"],
      ["db.view_finance", "DB 금액요약 조회", "상단 계약금·납부금·미수금 및 상담일지 금액요약 조회"],
      ["db.create", "신규 DB 등록", "신규 상담 DB를 직접 등록"],
      ["db.edit_basic", "DB 기본정보 수정", "상담후방향·리드 기본정보 등 일반 항목 수정"],
      ["db.view_consultation", "상담일지 조회", "상담일지와 상담메모·기대출정보를 열람"],
      ["db.edit_consultation", "상담일지 작성/수정", "상담일지 전체 입력·수정·메모 추가·채무파일 반영"],
      ["db.change_stage", "진행단계 변경", "신규디비·부재·착수금 안내·예약·상담 등 진행단계 변경"],
      ["db.change_assignee", "DB 담당자 변경", "DB 담당자를 다른 실무 담당자로 재배정"],
      ["db.manage_reservation", "예약일정 등록/수정", "고객 목록과 상담일지에서 예약 O/X 및 날짜·시간 변경"],
      ["db.convert", "고객/계약관리 전환", "필수 상담일지 완료 DB를 계약관리용 고객으로 전환"],
    ],
  },
  {
    id: "cases",
    label: "계약관리",
    description: "계약 목록과 금액정보, 계약 등록, 담당자 지정, 분납, 전자계약, 서류안내 권한입니다.",
    items: [
      ["cases.view", "계약관리 조회", "계약관리 메뉴 및 본인 담당 계약 조회"],
      ["cases.view_all", "전체 담당자 계약 조회", "다른 담당자의 계약까지 조회"],
      ["cases.view_finance", "계약 금액정보 조회", "계약금액·납부금·미수금·분납금액 조회"],
      ["cases.create", "계약 등록", "신규 계약 생성"],
      ["cases.change_assignee", "계약 담당자 지정/변경", "계약 등록 시 다른 담당자 선택 및 기존 담당자 변경"],
      ["cases.manage_installments", "분납관리", "분납 일정 추가·삭제·금액·상태·실입금일 변경"],
      ["cases.econtract", "전자계약서", "전자계약서 화면 조회 및 향후 실제 전송 기능 사용"],
      ["cases.send_docs", "서류안내문 전송", "서류안내문 작성·미제출 서류 확인·전송 기능 사용"],
    ],
  },
  {
    id: "settlements",
    label: "정산",
    description: "정산 조회 범위, 파일 내보내기, 담당자별 정산요율 설정을 제어합니다.",
    items: [
      ["settlements.view", "정산 조회", "정산 메뉴 및 본인 담당 계약의 정산 조회"],
      ["settlements.view_all", "전체 담당자 정산 조회", "전사 계약/입금/미수금 및 담당자별 정산 조회"],
      ["settlements.export", "정산 CSV 내보내기", "결제완료 내역 파일 다운로드"],
      ["settlement_settings.view", "정산설정 조회", "담당자별 결제수단 정산요율 조회"],
      ["settlement_settings.edit", "정산설정 수정", "담당자별 정산요율 변경"],
    ],
  },
  {
    id: "standards",
    label: "운영기준/설정",
    description: "상담 계산에 사용하는 운영 기준과 설정값을 제어합니다.",
    items: [
      ["living.view", "최저생계비 조회", "최저생계비 계산기 및 현재 기준액 조회"],
      ["living.edit", "최저생계비 수정", "가구원수별 기준액과 추가 가구원 기준액 변경"],
    ],
  },
  {
    id: "history",
    label: "이력/집계",
    description: "업무 변경이력과 데이터집계의 조회 범위·금액 노출을 세분화합니다.",
    items: [
      ["changes.view", "기간별 변동내역 조회", "본인이 발생시킨 DB·계약·설정 변경 이력 조회"],
      ["changes.view_all", "전체 직원 변동내역 조회", "모든 직원의 변경 이력 조회"],
      ["analytics.view", "데이터집계 조회", "본인 담당 고객/사건 기준의 통계 화면 조회"],
      ["analytics.view_all", "전사 데이터집계 조회", "전체 담당자 실적과 전체 사건 통계 조회"],
      ["analytics.finance", "데이터집계 금액 조회", "계약금액·결제완료액·미수금·결제율 등 금액성 통계 조회"],
    ],
  },
] as const;

export type PermissionKey = (typeof PERMISSION_GROUPS)[number]["items"][number][0];
export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

const PERMISSION_DEPENDENCIES: Partial<Record<PermissionKey, PermissionKey[]>> = {
  "dashboard.company_metrics": ["dashboard.view"],
  "dashboard.company_todo": ["dashboard.view"],
  "dashboard.finance": ["dashboard.view"],
  "dashboard.installment_calendar": ["dashboard.view"],
  "dashboard.schedule_calendar": ["dashboard.view"],
  "dashboard.statistics": ["dashboard.view"],
  "db.view_all": ["db.view"],
  "db.view_finance": ["db.view"],
  "db.create": ["db.view"],
  "db.edit_basic": ["db.view"],
  "db.view_consultation": ["db.view"],
  "db.edit_consultation": ["db.view", "db.view_consultation"],
  "db.change_stage": ["db.view"],
  "db.change_assignee": ["db.view", "db.view_all"],
  "db.manage_reservation": ["db.view", "db.change_stage"],
  "db.convert": ["db.view", "db.view_consultation"],
  "cases.view_all": ["cases.view"],
  "cases.view_finance": ["cases.view"],
  "cases.create": ["cases.view"],
  "cases.change_assignee": ["cases.view", "cases.view_all"],
  "cases.manage_installments": ["cases.view", "cases.view_finance"],
  "cases.econtract": ["cases.view", "cases.view_finance"],
  "cases.send_docs": ["cases.view"],
  "settlements.view_all": ["settlements.view"],
  "settlements.export": ["settlements.view"],
  "settlement_settings.edit": ["settlement_settings.view"],
  "living.edit": ["living.view"],
  "changes.view_all": ["changes.view"],
  "analytics.view_all": ["analytics.view"],
  "analytics.finance": ["analytics.view"],
};

export function normalizePermissions(input: PermissionMap): PermissionMap {
  const next: PermissionMap = { ...input };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [rawKey, deps] of Object.entries(PERMISSION_DEPENDENCIES) as Array<[PermissionKey, PermissionKey[]]>) {
      if (next[rawKey] !== true) continue;
      for (const dep of deps) {
        if (next[dep] !== true) {
          next[dep] = true;
          changed = true;
        }
      }
    }
  }
  return next;
}

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_GROUPS.flatMap((group) =>
  group.items.map((item) => item[0])
) as PermissionKey[];

export const DEFAULT_STAFF_PERMISSIONS: PermissionMap = {
  "dashboard.view": true,
  "dashboard.finance": true,
  "dashboard.installment_calendar": true,
  "dashboard.schedule_calendar": true,
  "dashboard.statistics": true,
  "db.view": true,
  "db.view_finance": true,
  "db.create": true,
  "db.edit_basic": true,
  "db.view_consultation": true,
  "db.edit_consultation": true,
  "db.change_stage": true,
  "db.manage_reservation": true,
  "db.convert": true,
  "cases.view": true,
  "cases.view_finance": true,
  "cases.create": true,
  "cases.manage_installments": true,
  "cases.econtract": true,
  "cases.send_docs": true,
  "living.view": true,
};

function keysMap(keys: PermissionKey[]): PermissionMap {
  return Object.fromEntries(keys.map((key) => [key, true])) as PermissionMap;
}

export const PERMISSION_PRESETS: Array<{ id: string; label: string; description: string; permissions: PermissionMap }> = [
  {
    id: "default_staff",
    label: "상담·계약 실무 기본",
    description: "본인 담당 DB 상담부터 계약/분납까지 처리하는 기본 실무 권한",
    permissions: DEFAULT_STAFF_PERMISSIONS,
  },
  {
    id: "db_staff",
    label: "DB·상담 전담",
    description: "본인 담당 DB 등록/상담일지/진행단계/예약/전환 중심",
    permissions: keysMap([
      "dashboard.view",
      "dashboard.schedule_calendar",
      "db.view",
      "db.view_finance",
      "db.create",
      "db.edit_basic",
      "db.view_consultation",
      "db.edit_consultation",
      "db.change_stage",
      "db.manage_reservation",
      "db.convert",
      "living.view",
    ]),
  },
  {
    id: "case_staff",
    label: "계약·분납 전담",
    description: "본인 담당 계약 등록/분납/전자계약/서류안내 중심",
    permissions: keysMap([
      "dashboard.view",
      "dashboard.finance",
      "dashboard.installment_calendar",
      "cases.view",
      "cases.view_finance",
      "cases.create",
      "cases.manage_installments",
      "cases.econtract",
      "cases.send_docs",
      "living.view",
    ]),
  },
  {
    id: "office_full",
    label: "실무 전체권한",
    description: "직원계정관리와 운영기준/정산요율 수정만 제외한 전사 실무 권한",
    permissions: keysMap(
      ALL_PERMISSION_KEYS.filter((key) => key !== "settlement_settings.edit" && key !== "living.edit")
    ),
  },
  {
    id: "manager_read",
    label: "전사 조회 중심",
    description: "전사 DB/계약/대시보드/정산/집계를 조회하되 업무 수정은 최소화",
    permissions: keysMap([
      "dashboard.view",
      "dashboard.company_metrics",
      "dashboard.company_todo",
      "dashboard.finance",
      "dashboard.installment_calendar",
      "dashboard.schedule_calendar",
      "dashboard.statistics",
      "db.view",
      "db.view_all",
      "db.view_finance",
      "db.view_consultation",
      "cases.view",
      "cases.view_all",
      "cases.view_finance",
      "settlements.view",
      "settlements.view_all",
      "settlement_settings.view",
      "living.view",
      "changes.view",
      "changes.view_all",
      "analytics.view",
      "analytics.view_all",
      "analytics.finance",
    ]),
  },
  {
    id: "readonly",
    label: "본인 조회 전용",
    description: "본인 담당 DB/상담일지/계약과 기본 대시보드만 조회",
    permissions: keysMap([
      "dashboard.view",
      "db.view",
      "db.view_consultation",
      "cases.view",
      "cases.view_finance",
      "living.view",
    ]),
  },
  { id: "none", label: "권한 없음", description: "활성화 전 권한을 직접 선택하기 위한 빈 설정", permissions: {} },
];

export const ROUTE_PERMISSION: Array<{ prefix: string; permission?: PermissionKey; adminOnly?: boolean }> = [
  { prefix: "/staff-accounts", adminOnly: true },
  { prefix: "/settlement-settings", permission: "settlement_settings.view" },
  { prefix: "/min-living-cost", permission: "living.view" },
  { prefix: "/settlements", permission: "settlements.view" },
  { prefix: "/analytics", permission: "analytics.view" },
  { prefix: "/schedule", permission: "dashboard.schedule_calendar" },
  { prefix: "/changes", permission: "changes.view" },
  { prefix: "/cases", permission: "cases.view" },
  { prefix: "/db", permission: "db.view" },
  { prefix: "/", permission: "dashboard.view" },
];

export function permissionForPath(pathname: string) {
  return ROUTE_PERMISSION.find(({ prefix }) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
