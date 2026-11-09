export const WALKTHROUGH_ORIGINS: readonly string[] = [
  "https://noma.maji.studio",
];
export const WALKTHROUGH_PREVIEW_ORIGIN = /^https:\/\/noma-site-[a-z0-9-]+-maji-studio\.vercel\.app$/;
export const WALKTHROUGH_LOCAL_ORIGINS: readonly string[] = [
  "http://localhost:3120",
  "http://127.0.0.1:3120",
];
export const WALKTHROUGH_PREFLIGHT_MAX_AGE_SECONDS = 600;
export const WALKTHROUGH_RATE_LIMIT = { capacity: 5, refillPerMinute: 5 / 60 } as const;
/** Site-wide cap on sent requests, so rotating IPs cannot flood the inbox or the shared Resend sender. */
export const WALKTHROUGH_DAILY_BUDGET = { key: "walkthrough:all", capacity: 50, refillPerMinute: 50 / 1440 } as const;
export const WALKTHROUGH_MAX_BODY_BYTES = 16_384;
export const WALKTHROUGH_FIELD_LIMITS = {
  requiredMin: 1,
  name: 200,
  email: 320,
  company: 200,
  size: 60,
  message: 4_000,
} as const;
export const WALKTHROUGH_STATUS = {
  ok: 200,
  preflight: 204,
  invalid: 400,
  forbidden: 403,
  tooLarge: 413,
  rateLimited: 429,
  sendFailed: 502,
  unavailable: 503,
} as const;
