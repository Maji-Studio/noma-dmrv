/** JSONB object key order is not stable. Compare the frozen identity and mass fields explicitly. */
const ALLOCATION_BASIS_FIELDS = ['allocationId', 'feedstockId', 'wetMassKg', 'feedstockTypeId', 'storageLocationId', 'facilityId', 'status'] as const;

function allocationBasis(value: unknown): string | null {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object')) return null;
  return JSON.stringify(value.map(row => ALLOCATION_BASIS_FIELDS.map(field => (row as Record<string, unknown>)[field])).map(row => JSON.stringify(row)).sort());
}

export function sameReturnAllocationBasis(saved: unknown, proposed: unknown): boolean {
  const original = allocationBasis(saved);
  return original !== null && original === allocationBasis(proposed);
}
