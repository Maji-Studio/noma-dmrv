/**
 * Shared TTL for in-flight certifier submission locks. Used by:
 *   - data-access/certification.ts (server-side claim/recovery logic)
 *   - components/certification/certification-page.tsx (client UI flag)
 *   - scripts/isometric-clear-stale-lock.ts (manual recovery CLI)
 * Keep these in sync via this single constant.
 */
export const LOCK_TTL_MS = 10 * 60 * 1000;

export function isLockedInFlight(row: {
  status: string;
  lockedAt: Date | null;
}): boolean {
  if (row.status !== "draft" || !row.lockedAt) return false;
  return Date.now() - row.lockedAt.getTime() < LOCK_TTL_MS;
}
