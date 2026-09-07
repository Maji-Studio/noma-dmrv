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
