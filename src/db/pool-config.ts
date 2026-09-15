import type { PoolConfig } from "pg";

export const DB_POOL_EXPERIMENT_CANDIDATES = [1, 3, 5] as const;
export const DEFAULT_DB_POOL_MAX = DB_POOL_EXPERIMENT_CANDIDATES[0];
export const MAX_VERCEL_DB_POOL_MAX = DB_POOL_EXPERIMENT_CANDIDATES.at(-1)!;
export const DEFAULT_DB_POOL_IDLE_TIMEOUT_MS = 5_000;
export const DEFAULT_DB_POOL_CONNECTION_TIMEOUT_MS = 10_000;
export const DEFAULT_DB_POOL_LOCK_TIMEOUT_MS = 1_000;

interface AppPoolConfigInput {
  connection: PoolConfig;
  configuredMax?: number;
  configuredIdleTimeoutMs?: number;
  configuredConnectionTimeoutMs?: number;
  configuredLockTimeoutMs?: number;
  isVercel: boolean;
}

/**
 * Resolve the shared application-pool limits without guessing the database's
 * total connection budget. Vercel pools multiply across active Fluid Compute
 * instances, so a deliberately configured value above the tested candidate
 * ceiling fails closed instead of silently risking connection exhaustion.
 */
export function resolveAppPoolConfig({
  connection,
  configuredMax,
  configuredIdleTimeoutMs,
  configuredConnectionTimeoutMs,
  configuredLockTimeoutMs,
  isVercel,
}: AppPoolConfigInput): PoolConfig {
  const max = configuredMax ?? DEFAULT_DB_POOL_MAX;

  if (isVercel && max > MAX_VERCEL_DB_POOL_MAX) {
    throw new Error(
      `DB_POOL_MAX cannot exceed ${MAX_VERCEL_DB_POOL_MAX} on Vercel; pool capacity multiplies across Fluid Compute instances`,
    );
  }

  return {
    ...connection,
    max,
    idleTimeoutMillis:
      configuredIdleTimeoutMs ?? DEFAULT_DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis:
      configuredConnectionTimeoutMs ??
      DEFAULT_DB_POOL_CONNECTION_TIMEOUT_MS,
    // Fail a waiting pooled statement before it monopolizes a scarce pool slot.
    // Dedicated remote-mutation connections must keep their locks until completion.
    lock_timeout: configuredLockTimeoutMs ?? DEFAULT_DB_POOL_LOCK_TIMEOUT_MS,
  };
}
