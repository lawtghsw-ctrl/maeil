export type StaffAutomation = {
  id?: string; staff_profile_id?: string | null; staff_name: string; sender_number_id: string | null;
  new_lead_enabled: boolean; absence_enabled: boolean;
  new_lead_template: string; absence_template: string;
  new_lead_image_paths: string[]; absence_image_paths: string[];
};

export const STAFF_AUTOMATION_COLUMNS = "id,law_firm_id,staff_profile_id,staff_name,sender_number_id,new_lead_enabled,absence_enabled,new_lead_template,absence_template,new_lead_image_paths,absence_image_paths";

/** Self-service updates never submit ownership, sender or audit columns. */
export function ownStaffAutomationValues(value: StaffAutomation) {
  return {
    new_lead_enabled: value.new_lead_enabled, absence_enabled: value.absence_enabled,
    new_lead_template: value.new_lead_template, absence_template: value.absence_template,
    new_lead_image_paths: value.new_lead_image_paths, absence_image_paths: value.absence_image_paths,
  };
}

export function automationError(error: unknown, fallback: string): string {
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
  if (/SMS_AUTOMATION_IDENTITY|duplicate key|sms_staff_auto_firm_staff_uq/.test(message)) return "직원 계정과 자동발송 설정의 이름 연결을 확인해야 합니다. 관리자에게 문의해주세요.";
  if (/SMS_AUTOMATION_IMMUTABLE/.test(message)) return "본인 문구·이미지·체크 설정만 변경할 수 있습니다. 설정을 다시 불러와주세요.";
  if (/SMS_AUTOMATION_IMAGE_PATH/.test(message)) return "본인이 새로 첨부한 이미지만 추가할 수 있습니다. 이미지를 다시 선택해주세요.";
  if (/SMS_AUTOMATION_FORBIDDEN/.test(message)) return "본인 자동발송 설정에 접근할 수 없습니다. 계정 상태와 문자 조회 권한을 관리자에게 확인해주세요.";
  return message;
}

export function validAutomationImagePaths(value: unknown, firmId: string): value is string[] {
  return Array.isArray(value) && value.length <= 3 && new Set(value).size === value.length && value.every(path =>
    typeof path === "string" && path.length <= 500 && path.startsWith(`${firmId}/`) &&
    !/[\\\x00-\x1f\x7f?#%]/.test(path) && !path.split("/").some(part => !part || part === "." || part === "..") && /\.(?:jpe?g|png|gif)$/i.test(path));
}

export function isStaffAutomation(value: unknown, firmId: string): value is StaffAutomation & { law_firm_id: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.law_firm_id === firmId && typeof row.id === "string" && typeof row.staff_name === "string" &&
    (row.staff_profile_id === undefined || row.staff_profile_id === null || typeof row.staff_profile_id === "string") &&
    (row.sender_number_id === null || typeof row.sender_number_id === "string") &&
    typeof row.new_lead_enabled === "boolean" && typeof row.absence_enabled === "boolean" &&
    typeof row.new_lead_template === "string" && typeof row.absence_template === "string" &&
    // Historical attachments must remain editable/removable even if they cannot be sent.
    [row.new_lead_image_paths, row.absence_image_paths].every(paths => Array.isArray(paths) && paths.every(path => typeof path === "string"));
}

// Do not acknowledge a save merely because the transport returned no error.
// The persisted row must belong to this workspace and contain the requested values.
export function confirmedStaffAutomation(value: unknown, expected: StaffAutomation, firmId: string): value is StaffAutomation & { law_firm_id: string } {
  if (!isStaffAutomation(value, firmId)) return false;
  return (expected.staff_profile_id === undefined || value.staff_profile_id === expected.staff_profile_id) &&
    value.staff_name === expected.staff_name && value.sender_number_id === expected.sender_number_id &&
    value.new_lead_enabled === expected.new_lead_enabled && value.absence_enabled === expected.absence_enabled &&
    value.new_lead_template === expected.new_lead_template && value.absence_template === expected.absence_template &&
    JSON.stringify(value.new_lead_image_paths) === JSON.stringify(expected.new_lead_image_paths) &&
    JSON.stringify(value.absence_image_paths) === JSON.stringify(expected.absence_image_paths);
}
