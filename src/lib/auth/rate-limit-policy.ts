import { isLocalAppUrl } from "@/config/env-validation";

/**
 * Auth rate limits are opt-out with DISABLE_RATE_LIMIT=true, except in a
 * production build serving a real origin. CI production builds that serve a
 * loopback origin (hermetic E2E and the live Isometric E2E) keep the opt-out.
 */
export function authRateLimitEnabled(nodeEnv: string, appUrl: string): boolean {
  if (process.env.DISABLE_RATE_LIMIT !== "true") return true;
  if (nodeEnv !== "production") return false;
  const isCI = ["1", "true"].includes((process.env.CI ?? "").toLowerCase());
  return !(isCI && isLocalAppUrl(appUrl));
}
