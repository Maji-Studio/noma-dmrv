/** Shared session/transaction fence, independent of the registered project. */
export function certifierStorageSiteLockKey(organizationId: string, customerLocationId: string): string {
  return `certifier-storage-site:${organizationId}:${customerLocationId}`;
}
