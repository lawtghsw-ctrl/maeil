import { DB_LEAD_DEFAULT_STAGE_BY_STATUS, type CaseRecord, type DbLead } from "./types";

// Array.find returns the first match, including when legacy data repeats a key.
export function firstByKey<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T> {
  const index = new Map<K, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!index.has(key)) index.set(key, item);
  }
  return index;
}

export function countByKey<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function positionsByKey<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, number[]> {
  const index = new Map<K, number[]>();
  items.forEach((item, position) => {
    const key = keyOf(item);
    const positions = index.get(key);
    if (positions) positions.push(position);
    else index.set(key, [position]);
  });
  return index;
}

export interface LeadSearchText {
  text: string;
  compactText: string;
}

// Keep the original case-array order and OR-match semantics. Deduplicate array
// positions, not IDs: a repeated ID can still represent two original rows.
export function buildLeadSearchIndex(leads: readonly DbLead[], cases: readonly CaseRecord[]): Map<DbLead, LeadSearchText> {
  const byLead = positionsByKey(cases, (record) => record.fromLeadId);
  const byCase = positionsByKey<CaseRecord, string | undefined>(cases, (record) => record.id);
  const byClient = positionsByKey(cases, (record) => record.clientId);
  const index = new Map<DbLead, LeadSearchText>();

  for (const lead of leads) {
    const positions = new Set([
      ...(byLead.get(lead.id) ?? []),
      ...(byCase.get(lead.convertedCaseId) ?? []),
      ...(lead.convertedClientId ? byClient.get(lead.convertedClientId) ?? [] : []),
    ]);
    const relatedCaseNumbers = [...positions]
      .sort((a, b) => a - b)
      .map((position) => cases[position].caseNumber)
      .join(" ");
    const memoLogText = (lead.consultation?.memoLog ?? [])
      .map((entry) => `${entry.text} ${entry.tag} ${entry.staff}`)
      .join(" ");
    const text = [
      lead.name,
      lead.phone,
      lead.email ?? "",
      lead.adName ?? "",
      lead.debtRaw ?? "",
      lead.incomeRaw ?? "",
      lead.consultTime ?? "",
      lead.consultTimeRaw ?? "",
      lead.debtRange ?? "",
      lead.incomeRange ?? "",
      lead.assignedStaff ?? "",
      lead.detailStage ?? DB_LEAD_DEFAULT_STAGE_BY_STATUS[lead.status],
      lead.memo ?? "",
      lead.consultation?.memo ?? "",
      memoLogText,
      relatedCaseNumbers,
    ].join(" ").toLowerCase();
    index.set(lead, { text, compactText: text.replace(/[\s\-().]/g, "") });
  }

  return index;
}
