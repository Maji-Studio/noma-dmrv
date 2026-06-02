/**
 * In-memory sliding-window rate limiter unit tests.
 *
 * `now` is injected so the window behaviour is asserted without faking timers.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  __resetRateLimitForTests,
} from "@/lib/rate-limit/in-memory";

const OPTS = { key: "test:op", max: 3, windowMs: 60_000 };

beforeEach(() => {
  __resetRateLimitForTests();
});

describe("checkRateLimit", () => {
  it("allows up to `max` events inside the window", () => {
    expect(checkRateLimit(OPTS, 1_000).allowed).toBe(true);
    expect(checkRateLimit(OPTS, 1_100).allowed).toBe(true);
    expect(checkRateLimit(OPTS, 1_200).allowed).toBe(true);
  });

  it("blocks the (max+1)th event and reports retryAfter", () => {
    checkRateLimit(OPTS, 1_000);
    checkRateLimit(OPTS, 1_100);
    checkRateLimit(OPTS, 1_200);
    const blocked = checkRateLimit(OPTS, 1_300);
    expect(blocked.allowed).toBe(false);
    // Oldest hit (1_000) expires at 61_000; ~60s out from now=1_300.
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("lets events through again once the window slides past old hits", () => {
    checkRateLimit(OPTS, 1_000);
    checkRateLimit(OPTS, 1_100);
    checkRateLimit(OPTS, 1_200);
    // 61s later the first three are outside the 60s window.
    expect(checkRateLimit(OPTS, 62_000).allowed).toBe(true);
  });

  it("scopes counters independently per key", () => {
    checkRateLimit(OPTS, 1_000);
    checkRateLimit(OPTS, 1_100);
    checkRateLimit(OPTS, 1_200);
    expect(checkRateLimit(OPTS, 1_300).allowed).toBe(false);
    // A different key has its own budget.
    expect(
      checkRateLimit({ ...OPTS, key: "test:other" }, 1_300).allowed
    ).toBe(true);
  });

  it("never reports retryAfter below 1 second when blocked", () => {
    checkRateLimit(OPTS, 1_000);
    checkRateLimit(OPTS, 1_100);
    checkRateLimit(OPTS, 1_200);
    // now is 1ms before the oldest hit expires → ceil to 1, not 0.
    const blocked = checkRateLimit(OPTS, 60_999);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
  });
});
