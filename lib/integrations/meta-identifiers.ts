export const META_IDENTIFIER_PREFIXES = {
  metaLeadId: "l:",
  adId: "ag:",
  adsetId: "as:",
  campaignId: "c:",
  formId: "f:",
} as const;

export type MetaIdentifierField = keyof typeof META_IDENTIFIER_PREFIXES;
export type SheetMetaIdentifiers = Record<MetaIdentifierField, string | null>;

/** Meta identifiers must remain strings: a JS number can already have lost digits. */
export function normalizeMetaIdentifier(value: unknown, field: MetaIdentifierField): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const prefix = META_IDENTIFIER_PREFIXES[field];
  const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return /^[1-9]\d{0,31}$/.test(id) ? id : null;
}

export function sheetMetaIdentifiers(row: Partial<Record<MetaIdentifierField, unknown>>, bodyFormId?: unknown) {
  const formValue = row.formId == null || (typeof row.formId === "string" && !row.formId.trim())
    ? bodyFormId : row.formId;
  const values = { ...row, formId: formValue };
  const ids = {} as SheetMetaIdentifiers;
  const invalidFields: MetaIdentifierField[] = [];
  for (const field of Object.keys(META_IDENTIFIER_PREFIXES) as MetaIdentifierField[]) {
    const value = values[field];
    ids[field] = normalizeMetaIdentifier(value, field);
    const supplied = value != null && !(typeof value === "string" && !value.trim());
    if (supplied && !ids[field]) invalidFields.push(field);
  }
  return { ids, invalidFields };
}
