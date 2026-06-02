/**
 * Tiny in-memory sliding-window rate limiter.
 *
 * Defense-in-depth abuse protection for expensive server actions (the
 * certification submit pipeline POSTs to the Isometric registry). Correctness
 * is NOT this module's job — ADR 0006 idempotency already dedupes retries; this
 * only caps how fast a single user can fire an action.
 *
 * Backing store is a process-local Map, so on Fluid Compute (multiple reused
 * instances) the effective ceiling is `max × instanceCount` rather than an
 * exact global limit. That is an accepted trade for a non-correctness guard:
 * it needs no table, migration, or per-call DB I/O. If an exact cross-instance
 * limit is ever required, swap this for a DB/Redis-backed bucket.
 */

// Window timestamps per key. Pruned lazily on access, so a key that stops being
// hit simply ages out the next time anything touches it (no background timer).
const hits = new Map<string, number[]>();

export interface RateLimitOptions {
  /** Stable identifier for the limited operation, e.g. "cert:submit-removal". */
  key: string;
  /** Max events allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest in-window hit expires (0 when allowed). */
  retryAfterSeconds: number;
}

/**
 * Record an attempt for `key` and report whether it is within the limit.
 * Reads `now` as an argument so tests stay deterministic without faking timers.
 */
export function checkRateLimit(
  { key, max, windowMs }: RateLimitOptions,
  now: number = Date.now()
): RateLimitResult {
  const windowStart = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((ts) => ts > windowStart);

  if (recent.length >= max) {
    const oldest = recent[0];
    hits.set(key, recent);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** @internal — for tests only */
export function __resetRateLimitForTests(): void {
  hits.clear();
}
