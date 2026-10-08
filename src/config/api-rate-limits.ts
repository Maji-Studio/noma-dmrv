export const API_RATE_LIMITS = {
  ip: 300,
  credential: { read: 600, write: 120 },
  organization: { read: 1_200, write: 240 },
} as const;
export const RATE_LIMIT_SECONDS_PER_MINUTE = 60;
/** All configured buckets refill in one minute; a day idle is safe to discard. */
export const RATE_LIMIT_IDLE_RETENTION_MS = 86_400_000;
