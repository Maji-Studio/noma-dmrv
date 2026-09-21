import type { PoolConfig } from "pg";

/** Conservative per-instance size that holds until a deployment sets its own. */
export const DEFAULT_DB_POOL_MAX = 1;
/**
 * Permanent fail-closed ceiling for serverless deployments. Vercel pools
 * multiply across concurrent Fluid Compute instances, so a larger configured
 * value is treated as a misconfiguration rather than a tuning choice.
 */
export const MAX_VERCEL_DB_POOL_MAX = 5;
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
 * instances, so a configured value above `MAX_VERCEL_DB_POOL_MAX` fails closed
 * instead of silently risking connection exhaustion.
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
