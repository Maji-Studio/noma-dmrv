import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";

export const REMOVAL_DELETION_LEASE_KEY = "removalDeletionLockedAt";

export function removalDeletionLeaseTimestamp(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[REMOVAL_DELETION_LEASE_KEY];
  return typeof value === "string" ? value : null;
}

export function hasFreshRemovalDeletionLease(metadata: unknown): boolean {
  const timestamp = removalDeletionLeaseTimestamp(metadata);
  return timestamp !== null && Date.now() - Date.parse(timestamp) < LOCK_TTL_MS;
}
