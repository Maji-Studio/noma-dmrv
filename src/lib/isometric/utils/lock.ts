/**
 * Shared TTL for in-flight certifier submission locks. Used by:
 *   - data-access/certification.ts (server-side claim/recovery logic)
 *   - components/certification/certification-page.tsx (client UI flag)
 *   - scripts/isometric-clear-stale-lock.ts (manual recovery CLI)
 * Keep these in sync via this single constant.
 */
export const LOCK_TTL_MS = 10 * 60 * 1000;
