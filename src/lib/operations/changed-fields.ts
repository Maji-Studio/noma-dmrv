const NOT_CHANGES = new Set(["formulationId", "supplierId", "customerId", "expectedVersion"]);

/** Field names only; target IDs and version preconditions are not changes. */
export function changedFields(input: object): string[] {
  return Object.entries(input).filter(([key, value]) => value !== undefined && !NOT_CHANGES.has(key)).map(([key]) => key).sort();
}
