import { MILLISECONDS_PER_SECOND, SECONDS_PER_DAY } from "./api-keys";

export const OAUTH_RESTART_MESSAGE = "Start again from the app.";

export const OAUTH_ACCESS_TOKEN_PREFIX = "noma_oat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "noma_ort_";
export const OAUTH_ACCESS_TOKEN_SECONDS = 60 * 60;
export const OAUTH_CODE_SECONDS = 10 * 60;
export const OAUTH_CODE_LIFETIME_MS = OAUTH_CODE_SECONDS * MILLISECONDS_PER_SECOND;
export const OAUTH_IDLE_DAYS = 30;
export const OAUTH_IDLE_LIMIT_MS = OAUTH_IDLE_DAYS * SECONDS_PER_DAY * MILLISECONDS_PER_SECOND;
export const OAUTH_REFRESH_TOKEN_SECONDS = OAUTH_IDLE_DAYS * SECONDS_PER_DAY;
export const OAUTH_REFRESH_REPLAY_SECONDS = 30;
export const OAUTH_PLUGIN_REPLAY_SECONDS = 120;
export const OAUTH_TOKEN_DEADLINE_SECONDS = 30;
export const OAUTH_LAST_USED_THROTTLE_MS = 60 * MILLISECONDS_PER_SECOND;
/** Per-instance endpoint limits; the shared per-IP bucket is separate. */
export const OAUTH_ENDPOINT_LIMITS = {
  token: { window: 60, max: 120 },
  authorize: { window: 60, max: 120 },
  revoke: { window: 60, max: 120 },
  consent: { window: 60, max: 120 },
  continue: { window: 60, max: 120 },
} as const;
export const OAUTH_DISCOVERY_CACHE_CONTROL = "public, max-age=300";
export const OAUTH_CIMD_FETCH_POLICY = {
  minimumFetchInterval: 1,
  maximumConcurrentFetches: 16,
  maximumConcurrentFetchesPerOrigin: 4,
  maximumFetchesPerMinute: 120,
  maximumFetchesPerOriginPerMinute: 30,
} as const;
export const OAUTH_CIMD_MAX_CACHE_ENTRIES = 100;

export function isOAuthGenerationIdle(lastUsedAt: Date, now: Date): boolean {
  return now.getTime() - lastUsedAt.getTime() >= OAUTH_IDLE_LIMIT_MS;
}
