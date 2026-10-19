export const API_RATE_LIMITS = {
  ip: 300,
  connectorIp: 6_000,
  credential: { read: 600, write: 120 },
  organization: { read: 1_200, write: 240 },
} as const;
export const API_CONNECTOR_EGRESS_CIDRS = ["160.79.104.0/21"] as const;
export const API_ADMIT_RATE_LIMIT = API_RATE_LIMITS.credential.read + API_RATE_LIMITS.credential.write;
export const RATE_LIMIT_SECONDS_PER_MINUTE = 60;
/** All configured buckets refill in one minute; a day idle is safe to discard. */
export const RATE_LIMIT_IDLE_RETENTION_MS = 86_400_000;
