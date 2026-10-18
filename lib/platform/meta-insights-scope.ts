import type { InsightSnapshot } from "./meta-insights";

/** User-approved reporting scope: match the ad name itself, without inference. */
export function isRehabilitationAdName(name: unknown): boolean {
  return typeof name === "string" && name.includes("회생");
}

/** Keep the original account cache intact; return a reporting-only view. */
export function rehabilitationInsightSnapshot(snapshot: InsightSnapshot): InsightSnapshot {
  return { ...snapshot, rows: snapshot.rows.filter(row => isRehabilitationAdName(row?.adName)) };
}
