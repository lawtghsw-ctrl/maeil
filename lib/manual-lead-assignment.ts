import { DB_INTAKE_OWNER, type StaffName } from "./types";

export function manualLeadAssignee(currentStaff: StaffName | undefined, workStaffNames: readonly StaffName[], isAdmin: boolean): StaffName {
  // Staff-created leads belong to the signed-in staff member, even while the directory is loading.
  if (currentStaff && (!isAdmin || workStaffNames.includes(currentStaff))) return currentStaff;
  if (!isAdmin) return "";
  return workStaffNames.includes(DB_INTAKE_OWNER) ? DB_INTAKE_OWNER : workStaffNames[0] || "";
}
