import { randomUUID } from "crypto";
import type { User } from "@supabase/supabase-js";
import type { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_LOGIN_IDS, normalizeLoginIdentifier } from "@/lib/auth/login-identifier";
import { DEFAULT_STAFF_PERMISSIONS } from "@/lib/permissions";
import { LAWYER_SETTINGS_KEY } from "@/lib/performance/lawyers";
import { buildSalesDemo, SALES_DEMO_CODE, SALES_DEMO_COUNTS, SALES_DEMO_KEY, SALES_DEMO_KIND, SALES_DEMO_REPRESENTATIVE } from "./sales-demo";

type Admin = ReturnType<typeof createAdminClient>;
type LoginId = typeof DEMO_LOGIN_IDS[number];
type Account = { loginId: LoginId; displayName: string; role: "firm_admin" | "staff" };
export type DemoProvisionResult = { firmId: string; alreadyExists: boolean; accounts: Account[]; counts: typeof SALES_DEMO_COUNTS };
type Marker = {
  version: 1; kind: typeof SALES_DEMO_KIND; firmId: string; seedDate: string;
  phase: "creating" | "incomplete" | "ready";
  leaseToken: string; leaseExpiresAt: string; revision: number;
  accountIds: Partial<Record<LoginId, string>>;
  initializedProfiles: Partial<Record<LoginId, boolean>>;
  lawyersSeeded: boolean;
};
type MarkerRow = { value: Marker; updated_at: string };
type EntityRow = { id: string; law_firm_id: string; data: Record<string, unknown>; updated_at: string };
const LEASE_MS = 120_000;
const ACCOUNTS: Account[] = DEMO_LOGIN_IDS.map((loginId, index) => ({ loginId, displayName: index === 0 ? "TEST 관리자" : `TEST${index}`, role: index === 0 ? "firm_admin" : "staff" }));

export class DemoProvisionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
function conflict(message: string): never { throw new DemoProvisionError(message, 409); }
function result(firmId: string, alreadyExists: boolean): DemoProvisionResult {
  return { firmId, alreadyExists, accounts: ACCOUNTS.map((account) => ({ ...account })), counts: { ...SALES_DEMO_COUNTS } };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function readMarker(value: unknown, firmId: string): Marker {
  if (!record(value) || value.version !== 1 || value.kind !== SALES_DEMO_KIND || value.firmId !== firmId ||
    typeof value.seedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.seedDate) ||
    !["creating", "incomplete", "ready"].includes(String(value.phase)) ||
    typeof value.leaseToken !== "string" || !value.leaseToken || typeof value.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(value.leaseExpiresAt)) ||
    !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !record(value.accountIds) || !record(value.initializedProfiles) || typeof value.lawyersSeeded !== "boolean") {
    return conflict("TEST 로펌의 생성 소유 표시가 올바르지 않습니다. 기존 자료는 변경하지 않았습니다.");
  }
  for (const [key, id] of Object.entries(value.accountIds)) if (!DEMO_LOGIN_IDS.some((alias) => alias === key) || typeof id !== "string" || !id) conflict("TEST 계정 소유 정보를 확인해주세요.");
  for (const [key, initialized] of Object.entries(value.initializedProfiles)) if (!DEMO_LOGIN_IDS.some((alias) => alias === key) || typeof initialized !== "boolean") conflict("TEST 계정 초기화 정보를 확인해주세요.");
  const { accountIds, initializedProfiles } = value;
  if (value.phase === "ready" && (!value.lawyersSeeded || DEMO_LOGIN_IDS.some((id) => !accountIds[id] || initializedProfiles[id] !== true))) conflict("TEST 완료 상태에 계정 생성 정보가 누락되어 있습니다.");
  buildSalesDemo(firmId, value.seedDate);
  return value as unknown as Marker;
}
function ownsUser(user: User, firmId: string) {
  return user.app_metadata?.salesDemoKind === SALES_DEMO_KIND && user.app_metadata?.salesDemoFirmId === firmId;
}
async function findAliasUsers(admin: Admin) {
  const emails = new Set(ACCOUNTS.map((account) => normalizeLoginIdentifier(account.loginId)));
  const found = new Map<string, User>();
  const seen = new Set<string>();
  // Do not rely on one 1,000-user page or the SDK's parsed nextPage value.
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new DemoProvisionError("기존 로그인 계정 중복 여부를 확인하지 못했습니다.");
    if (!data.users.length) break;
    let added = 0;
    for (const user of data.users) {
      if (!seen.has(user.id)) { seen.add(user.id); added++; }
      const email = user.email?.toLowerCase() || "";
      if (emails.has(email)) {
        if (found.has(email) && found.get(email)?.id !== user.id) conflict("테스트 로그인 이메일이 중복되어 생성할 수 없습니다.");
        found.set(email, user);
      }
    }
    if (!added) throw new DemoProvisionError("계정 목록 페이지를 확인하지 못했습니다. 다시 시도해주세요.");
    if (found.size === emails.size || ("total" in data && data.total > 0 && seen.size >= data.total)) break;
  }
  return found;
}
async function existingFirm(admin: Admin) {
  const { data, error } = await admin.from("law_firms").select("id,name,firm_code,representative_name,status")
    .or(`name.ilike.TEST,firm_code.eq.${SALES_DEMO_CODE}`);
  if (error) throw new DemoProvisionError("기존 TEST 로펌 정보를 확인하지 못했습니다.");
  if ((data?.length || 0) > 1) conflict("TEST 이름 또는 시연용 로펌 코드가 이미 사용 중입니다. 기존 로펌은 변경하지 않았습니다.");
  const firm = data?.[0];
  if (firm && (firm.name !== "TEST" || firm.firm_code !== SALES_DEMO_CODE || firm.representative_name !== SALES_DEMO_REPRESENTATIVE)) conflict("TEST 이름 또는 시연용 로펌 코드가 이미 사용 중입니다. 기존 로펌은 변경하지 않았습니다.");
  return firm || null;
}

/** Only call after the route has authenticated an active platform super administrator. */
export async function provisionSalesDemo(admin: Admin, actorId: string, password: string): Promise<DemoProvisionResult> {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) throw new DemoProvisionError("비밀번호는 8~128자로 입력해주세요.");
  let firm = await existingFirm(admin);
  let markerRow: MarkerRow | null = null;
  if (firm) {
    const { data, error } = await admin.from("firm_settings").select("value,updated_at").eq("law_firm_id", firm.id).eq("key", SALES_DEMO_KEY).maybeSingle();
    if (error) throw new DemoProvisionError("TEST 생성 상태를 확인하지 못했습니다.");
    if (!data) conflict("기존 TEST 로펌에 생성 소유 표시가 없습니다. 안전을 위해 자동으로 덮어쓰거나 이어서 생성하지 않습니다.");
    markerRow = { ...data, value: readMarker(data.value, firm.id) };
    // A completed run is strictly read-only, including passwords, profiles and audit logs.
    if (markerRow.value.phase === "ready") return result(firm.id, true);
    if (firm.status !== "active") conflict("중단된 TEST 로펌이 비활성 상태입니다. 기존 설정은 변경하지 않았습니다.");
    if (markerRow.value.phase === "creating" && Date.parse(markerRow.value.leaseExpiresAt) > Date.now()) conflict("TEST 로펌을 다른 요청에서 생성 중입니다. 잠시 후 다시 확인해주세요.");
  }
  const aliases = await findAliasUsers(admin);
  for (const account of ACCOUNTS) {
    const user = aliases.get(normalizeLoginIdentifier(account.loginId));
    const savedId = markerRow?.value.accountIds[account.loginId];
    if (user && (!firm || !ownsUser(user, firm.id))) conflict("테스트 로그인 아이디가 기존 계정에서 사용 중입니다. 기존 계정과 비밀번호는 변경하지 않았습니다.");
    if (savedId && (!user || user.id !== savedId)) conflict("이전에 생성된 테스트 계정 정보가 변경되었습니다. 기존 계정은 덮어쓰지 않습니다.");
  }
  const leaseToken = randomUUID();
  const now = () => new Date().toISOString();
  const leaseEnd = () => new Date(Date.now() + LEASE_MS).toISOString();
  if (!firm) {
    const { data, error } = await admin.from("law_firms").insert({
      name: "TEST", firm_code: SALES_DEMO_CODE, representative_name: SALES_DEMO_REPRESENTATIVE,
      status: "active", billing_type: "per_lead", lead_unit_price: 0, phone: null, business_number: null,
    }).select("id,name,firm_code,representative_name,status").single();
    if (error?.code === "23505") conflict("시연용 로펌 코드가 이미 생성 중이거나 사용 중입니다. 다시 확인해주세요.");
    if (error || !data) throw new DemoProvisionError("TEST 로펌을 생성하지 못했습니다.");
    firm = data;
    const marker: Marker = {
      version: 1, kind: SALES_DEMO_KIND, firmId: firm.id,
      seedDate: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
      phase: "creating", leaseToken, leaseExpiresAt: leaseEnd(), revision: 0,
      accountIds: {}, initializedProfiles: {}, lawyersSeeded: false,
    };
    const { data: saved, error: markerError } = await admin.from("firm_settings").insert({ law_firm_id: firm.id, key: SALES_DEMO_KEY, value: marker, updated_by: actorId, updated_at: now() }).select("value,updated_at").single();
    // No adoption or deletion if the process stops between firm and marker creation.
    if (markerError || !saved) throw new DemoProvisionError("TEST 로펌은 생성되었지만 생성 소유 표시 저장에 실패했습니다. 중복 생성하지 말고 관리자에게 확인해주세요.", 409);
    markerRow = { ...saved, value: readMarker(saved.value, firm.id) };
  }
  const firmId = String(firm.id);
  let current = markerRow!;
  let leaseOwned = current.value.leaseToken === leaseToken;
  async function saveMarker(patch: Partial<Marker> = {}) {
    const value: Marker = { ...current.value, ...patch, revision: current.value.revision + 1 };
    const { data, error } = await admin.from("firm_settings").update({ value, updated_by: actorId, updated_at: now() })
      .eq("law_firm_id", firmId).eq("key", SALES_DEMO_KEY).eq("updated_at", current.updated_at)
      .eq("value->>leaseToken", current.value.leaseToken).eq("value->>revision", String(current.value.revision))
      .select("value,updated_at").maybeSingle();
    if (error) throw new DemoProvisionError("TEST 생성 진행 상태를 저장하지 못했습니다.");
    if (!data) conflict("TEST 생성 상태가 다른 요청에서 변경되었습니다. 잠시 후 다시 확인해주세요.");
    current = { ...data, value: readMarker(data.value, firmId) };
  }
  async function renew() { await saveMarker({ phase: "creating", leaseToken, leaseExpiresAt: leaseEnd() }); leaseOwned = true; }
  const seedOwner = { kind: SALES_DEMO_KIND, firmId, seedDate: current.value.seedDate };
  function assertOwnedRow(row: EntityRow) {
    const owner = row.data?.salesDemoSeed;
    if (row.law_firm_id !== firmId || !record(owner) || owner.kind !== seedOwner.kind || owner.firmId !== firmId || owner.seedDate !== seedOwner.seedDate) conflict("샘플 자료 ID가 기존 자료와 충돌합니다. 기존 자료는 변경하지 않았습니다.");
  }
  async function rowsFor(table: string, ids: string[]) {
    const { data, error } = await admin.from(table).select("id,law_firm_id,data,updated_at").in("id", ids);
    if (error) throw new DemoProvisionError("샘플 자료 소유 정보를 확인하지 못했습니다.");
    const rows = (data || []) as EntityRow[];
    rows.forEach(assertOwnedRow);
    return rows;
  }
  try {
    await renew();
    for (const account of ACCOUNTS) {
      const email = normalizeLoginIdentifier(account.loginId);
      let user = aliases.get(email);
      if (!user) {
        await renew();
        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
          app_metadata: { salesDemoKind: SALES_DEMO_KIND, salesDemoFirmId: firmId },
          user_metadata: { display_name: account.displayName, staff_name: account.displayName },
        });
        if (error || !data.user) throw new DemoProvisionError("테스트 계정 생성이 중단되었습니다. 이메일 중복 또는 비밀번호 정책을 확인한 뒤 같은 비밀번호로 다시 시도해주세요.");
        user = data.user;
        if (!ownsUser(user, firmId)) conflict("생성된 테스트 계정의 소유 정보를 확인하지 못했습니다.");
      }
      await saveMarker({ accountIds: { ...current.value.accountIds, [account.loginId]: user.id } });
      const { data: profile, error: profileError } = await admin.from("profiles").select("id,email,law_firm_id,platform_role,role,is_active,display_name,staff_name,updated_at")
        .eq("id", user.id).maybeSingle();
      if (profileError || !profile) throw new DemoProvisionError("테스트 계정 프로필을 확인하지 못했습니다. 같은 비밀번호로 다시 시도해주세요.");
      if (profile.law_firm_id && profile.law_firm_id !== firmId) conflict("테스트 계정이 다른 로펌에 연결되어 있어 진행하지 않았습니다.");
      if (!current.value.initializedProfiles[account.loginId]) {
        if (profile.law_firm_id === firmId) {
          if (profile.platform_role !== account.role || profile.is_active !== true || profile.display_name !== account.displayName) conflict("중단된 테스트 계정 설정이 변경되었습니다. 기존 설정은 덮어쓰지 않습니다.");
        } else {
          if (profile.is_active !== false || profile.role !== "staff" || profile.platform_role !== "staff" || profile.email?.toLowerCase() !== email) conflict("테스트 계정 초기 프로필이 변경되어 자동 설정하지 않았습니다.");
          await renew();
          const { data: initialized, error } = await admin.from("profiles").update({
            email, display_name: account.displayName, staff_name: account.displayName,
            law_firm_id: firmId, role: account.role === "firm_admin" ? "admin" : "staff", platform_role: account.role,
            is_active: true, is_work_staff: account.role === "staff", auto_assign_leads: false,
            lead_assignment_order: account.role === "firm_admin" ? 1000 : Number(account.loginId.slice(4)) * 10,
            permissions: account.role === "staff" ? { ...DEFAULT_STAFF_PERMISSIONS } : {}, updated_at: now(),
          }).eq("id", user.id).is("law_firm_id", null).eq("updated_at", profile.updated_at).eq("is_active", false)
            .eq("role", "staff").eq("platform_role", "staff").eq("email", profile.email)
            .select("id").maybeSingle();
          if (error) throw new DemoProvisionError("테스트 계정 프로필 설정이 중단되었습니다. 같은 비밀번호로 다시 시도해주세요.");
          if (!initialized) conflict("테스트 계정이 다른 요청에서 수정되었습니다. 기존 설정은 덮어쓰지 않습니다.");
        }
        await saveMarker({ initializedProfiles: { ...current.value.initializedProfiles, [account.loginId]: true } });
      } else if (profile.law_firm_id !== firmId) conflict("테스트 계정의 소속이 변경되었습니다. 기존 설정은 덮어쓰지 않습니다.");
    }
    const fixture = buildSalesDemo(firmId, current.value.seedDate);
    const leadBases = fixture.leads.map(({ convertedClientId, convertedCaseId, ...lead }) => lead);
    const groups = [
      ["app_leads", leadBases], ["app_clients", fixture.clients], ["app_cases", fixture.cases],
      ["app_installments", fixture.installments], ["app_schedule_items", fixture.schedules], ["app_board_posts", fixture.posts],
    ] as const;
    // Detect every existing ID collision before inserting any business fixtures.
    for (const [table, items] of groups) await rowsFor(table, items.map((item) => item.id));
    for (const [table, items] of groups) {
      const existing = new Set((await rowsFor(table, items.map((item) => item.id))).map((row) => row.id));
      const missing = items.filter((item) => !existing.has(item.id)).map((item) => ({ id: item.id, law_firm_id: firmId, created_by: actorId, data: { ...item, salesDemoSeed: seedOwner } }));
      if (missing.length) {
        await renew();
        const { error } = await admin.from(table).upsert(missing, { onConflict: "id", ignoreDuplicates: true });
        if (error) throw new DemoProvisionError("샘플 자료 생성이 중단되었습니다. 같은 비밀번호로 다시 시도하면 누락된 자료만 이어서 생성합니다.");
      }
      if ((await rowsFor(table, items.map((item) => item.id))).length !== items.length) throw new DemoProvisionError("샘플 자료 일부가 저장되지 않았습니다. 다시 시도해주세요.");
    }
    // Lead conversion triggers synthesize zero-value cases if the linked rows
    // do not exist yet. Connect only our own lead rows after full cases exist.
    for (const lead of fixture.leads.filter((item) => item.convertedCaseId)) {
      const row = (await rowsFor("app_leads", [lead.id]))[0];
      if (!row) throw new DemoProvisionError("전환할 샘플 DB를 확인하지 못했습니다.");
      if (row.data.convertedClientId === lead.convertedClientId && row.data.convertedCaseId === lead.convertedCaseId) continue;
      if (row.data.convertedClientId || row.data.convertedCaseId) conflict("샘플 DB의 고객 전환 연결이 변경되었습니다. 기존 연결은 덮어쓰지 않습니다.");
      await renew();
      const { data, error } = await admin.from("app_leads").update({ data: { ...row.data, convertedClientId: lead.convertedClientId, convertedCaseId: lead.convertedCaseId } })
        .eq("id", row.id).eq("law_firm_id", firmId).eq("updated_at", row.updated_at).eq("data", JSON.stringify(row.data)).select("id").maybeSingle();
      if (error) throw new DemoProvisionError("샘플 고객 전환 연결이 중단되었습니다. 다시 시도해주세요.");
      if (!data) conflict("샘플 DB가 다른 요청에서 수정되었습니다. 기존 자료는 덮어쓰지 않습니다.");
    }
    if (!current.value.lawyersSeeded) {
      await renew();
      const { error } = await admin.from("firm_settings").upsert({ law_firm_id: firmId, key: LAWYER_SETTINGS_KEY, value: fixture.lawyers, updated_by: actorId }, { onConflict: "law_firm_id,key", ignoreDuplicates: true });
      if (error) throw new DemoProvisionError("샘플 변호사 설정 저장이 중단되었습니다.");
      const { data: saved, error: readError } = await admin.from("firm_settings").select("value").eq("law_firm_id", firmId).eq("key", LAWYER_SETTINGS_KEY).maybeSingle();
      if (readError || !saved) throw new DemoProvisionError("샘플 변호사 설정을 확인하지 못했습니다.");
      // JSONB changes object-key order, so compare without depending on it.
      const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) => record(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
      if (stable(saved.value) !== stable(fixture.lawyers)) conflict("기존 변호사 설정이 있어 샘플 설정으로 덮어쓰지 않았습니다.");
      await saveMarker({ lawyersSeeded: true });
    }
    await saveMarker({ phase: "ready", leaseExpiresAt: now() });
    return result(firmId, false);
  } catch (error) {
    if (leaseOwned) {
      try { await saveMarker({ phase: "incomplete", leaseExpiresAt: now() }); } catch { /* A newer lease must never be overwritten. */ }
    }
    if (error instanceof DemoProvisionError) throw error;
    throw new DemoProvisionError("TEST 로펌 생성이 중단되었습니다. 기존 자료는 유지되며 같은 비밀번호로 다시 시도할 수 있습니다.");
  }
}
