import type { requirePlatformUser } from "@/lib/platform/server";

type Admin = Awaited<ReturnType<typeof requirePlatformUser>>["admin"];

// The directory no longer needs the legacy six-month billing computation or
// removed supply/Sheet/Meta status columns. The default API remains compatible.
export async function loadFirmDirectory(admin: Admin, now = new Date()) {
  const firms: { id: string; name: string; firm_code: string; representative_name: string | null; status: string; created_at: string }[] = [];
  let after: string | undefined;
  for (;;) {
    let query = admin.from("law_firms").select("id,name,firm_code,representative_name,status,created_at").order("id").limit(500);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    const last = String(data[data.length - 1].id);
    if (!last || last === after) throw new Error("로펌 목록 페이지를 확인할 수 없습니다.");
    firms.push(...data); after = last;
  }
  firms.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const since = new Date(now.getTime() - 86400000).toISOString();
  const rows: any[] = Array(firms.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++; if (index >= firms.length) return;
      const firm = firms[index];
      const results = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).eq("is_active", true).eq("is_work_staff", true),
        admin.from("app_leads").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id),
        admin.from("app_cases").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id),
        admin.from("integration_ingest_errors").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).gte("created_at", since),
        admin.from("meta_event_queue").select("id", { count: "exact", head: true }).eq("law_firm_id", firm.id).eq("status", "failed"),
        admin.from("app_change_logs").select("id,data,created_at").eq("law_firm_id", firm.id).order("created_at", { ascending: false }).limit(1),
      ]);
      for (const result of results) if (result.error) throw result.error;
      const [members, leads, cases, ingest, failed, activity] = results;
      const last = activity.data?.[0];
      rows[index] = { ...firm, memberCount: members.count ?? 0, leadCount: leads.count ?? 0, caseCount: cases.count ?? 0,
        ingestError24hCount: ingest.count ?? 0, metaFailedCount: failed.count ?? 0, integrationErrorCount: (ingest.count ?? 0) + (failed.count ?? 0),
        lastActivityAt: last?.created_at ?? null, lastActivityStaff: last?.data?.staff ?? null,
        lastActivityAction: last ? `${last.data?.category ?? "업무"} · ${last.data?.action ?? "변경"}` : null };
    }
  }
  const logsPromise = Promise.all([
    admin.from("platform_audit_logs").select("id,actor_name,actor_role,law_firm_id,action,target_type,target_id,detail,created_at").order("created_at", { ascending: false }).limit(100),
    admin.from("app_change_logs").select("id,law_firm_id,data,created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  const [logs] = await Promise.all([logsPromise, ...Array.from({ length: Math.min(3, firms.length) }, worker)]);
  const [audits, activities] = logs;
  if (audits.error) throw audits.error;
  if (activities.error) throw activities.error;
  const names = new Map(firms.map(firm => [firm.id, firm.name]));
  return { firms: rows, auditLogs: audits.data ?? [], recentActivities: (activities.data ?? []).map(row => ({
    id: row.id, lawFirmId: row.law_firm_id, firmName: names.get(row.law_firm_id) ?? "알 수 없는 로펌", category: row.data?.category ?? "업무", action: row.data?.action ?? "변경",
    targetName: row.data?.targetName ?? "-", detail: row.data?.detail ?? "", staff: row.data?.staff ?? "시스템", at: row.data?.at ?? row.created_at,
  })) };
}
