import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRateLimitEnabled } from "./rate-limit-policy";

const APP_URL = "https://app.example";
const LOOPBACK_URL = "http://localhost:3100";

describe("authRateLimitEnabled", () => {
  beforeEach(() => {
    vi.stubEnv("CI", "");
    vi.stubEnv("NOMA_HERMETIC_CI", "");
    vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "true", "false", "TRUE", ""])(
    "keeps production limits on with DISABLE_RATE_LIMIT=%s", flag => {
      vi.stubEnv("DISABLE_RATE_LIMIT", flag);
      expect(authRateLimitEnabled("production", APP_URL)).toBe(true);
    },
  );

  it.each(["development", "test"])("allows an explicit opt-out in %s", nodeEnv => {
    expect(authRateLimitEnabled(nodeEnv, LOOPBACK_URL)).toBe(false);
    vi.stubEnv("DISABLE_RATE_LIMIT", "false");
    expect(authRateLimitEnabled(nodeEnv, LOOPBACK_URL)).toBe(true);
  });

  it.each([["true", "true"], ["1", ""]])("keeps the loopback CI bypass with CI=%s, NOMA_HERMETIC_CI=%s", (ci, marker) => {
    vi.stubEnv("CI", ci);
    vi.stubEnv("NOMA_HERMETIC_CI", marker);
    expect(authRateLimitEnabled("production", LOOPBACK_URL)).toBe(false);
    vi.stubEnv("DISABLE_RATE_LIMIT", "false");
    expect(authRateLimitEnabled("production", LOOPBACK_URL)).toBe(true);
  });

  it.each([
    ["", "true", LOOPBACK_URL],
    ["true", "true", APP_URL],
    ["true", "true", "ftp://localhost"],
  ])("refuses a bypass outside CI or on a real origin (%s, %s, %s)", (ci, marker, appUrl) => {
    vi.stubEnv("CI", ci);
    vi.stubEnv("NOMA_HERMETIC_CI", marker);
    expect(authRateLimitEnabled("production", appUrl)).toBe(true);
  });
});
