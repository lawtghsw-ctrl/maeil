/** Keep API document actions within the same staff assignment scope as cases UI. */
export async function getFirmEsignCase(admin: any, profile: any, caseId: string) {
  const manager = profile.platform_role === "super_admin" || profile.platform_role === "firm_admin" || profile.role === "admin";
  let permissions: Record<string, unknown> = {};
  if (!manager) {
    const { data, error } = await admin.from("profiles").select("permissions").eq("id", profile.id).maybeSingle();
    if (error || data?.permissions?.["cases.econtract"] !== true) throw new Error("FORBIDDEN");
    permissions = data.permissions;
  }
  let query = admin.from("app_cases").select("id,data,law_firm_id").eq("id", caseId);
  if (profile.platform_role !== "super_admin") query = query.eq("law_firm_id", profile.law_firm_id);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error("계약을 찾지 못했습니다.");
  if (!manager && permissions["cases.view_all"] !== true) {
    const staff = String(profile.staff_name || profile.display_name || "").trim();
    if (!staff || data.data?.assignedStaff !== staff) throw new Error("FORBIDDEN");
  }
  return data;
}
