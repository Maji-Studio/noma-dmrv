/**
 * GHG statement membership check: true only when the statement's local GHG
 * entry set and the registry's are the same set (no duplicates, no extras on
 * either side). The registry's own carbon figures are read through
 * `fn/certification/ghg-statement-breakdown.ts`; nothing is recomputed here.
 */
export function hasExactGhgEntryMembership(
  localEntryIds: string[],
  remoteEntryIds: string[],
): boolean {
  if (localEntryIds.length === 0 || remoteEntryIds.length === 0) return false;
  const localIds = new Set(localEntryIds);
  const remoteIds = new Set(remoteEntryIds);
  if (
    localIds.size !== localEntryIds.length ||
    remoteIds.size !== remoteEntryIds.length ||
    localIds.size !== remoteIds.size
  ) {
    return false;
  }
  return Array.from(localIds).every((id) => remoteIds.has(id));
}
