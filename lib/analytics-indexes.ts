/** Groups retain input order and duplicate rows, just like Array.filter. */
export function groupByKey<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * Index the original related-row sequence, including duplicate rows. A row is
 * included once per group even when both its own key and a related owner match.
 * Duplicate owner IDs can belong to multiple groups, matching filter/some.
 */
export function groupRelatedRows<Owner, Row, K, Id>(
  owners: readonly Owner[],
  rows: readonly Row[],
  ownerKey: (owner: Owner) => K,
  ownerId: (owner: Owner) => Id,
  rowOwnerId: (row: Row) => Id,
  rowKey?: (row: Row) => K,
): Map<K, Row[]> {
  const memberships = new Map<Id, Set<K>>();
  for (const owner of owners) {
    const id = ownerId(owner);
    const keys = memberships.get(id) ?? new Set<K>();
    keys.add(ownerKey(owner));
    memberships.set(id, keys);
  }
  const groups = new Map<K, Row[]>();
  for (const row of rows) {
    const keys = new Set(memberships.get(rowOwnerId(row)));
    if (rowKey) keys.add(rowKey(row));
    for (const key of keys) {
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
  }
  return groups;
}

/** Use separate keys for firm/staff pairs, including missing and empty values. */
export function createStaffScopeKey(globalSuperView: boolean) {
  const firms = new Map<string | undefined, Map<string, object>>();
  return (row: { assignedStaff: string; _lawFirmId?: string }): object => {
    const firmId = globalSuperView ? row._lawFirmId : undefined;
    const staff = firms.get(firmId) ?? new Map<string, object>();
    firms.set(firmId, staff);
    const key = staff.get(row.assignedStaff) ?? {};
    staff.set(row.assignedStaff, key);
    return key;
  };
}
