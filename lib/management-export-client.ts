"use client";
import { authJson } from "@/lib/platform/client";
export async function recordManagementExport(input: { firmId?: string; start: string; end: string; staff?: string; format: "xlsx" | "csv"; kind: "ledger" | "meeting" | "settlements" }) {
  if (!input.firmId) throw new Error("다운로드할 로펌을 먼저 선택해주세요.");
  await authJson("/api/admin/management-export", { method: "POST", body: JSON.stringify(input) });
}
