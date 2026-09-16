/**
 * Database connection and client
 * Provides drizzle ORM instance with PostgreSQL connection
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions/db-connections";
import { env } from "@/config/env";
import { logger } from "@/lib/log";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { createObservedClient, createObservedPool } from "./observed-pg";
import { resolveAppPoolConfig } from "./pool-config";
import * as schema from "./schema";

const poolConfig = resolveAppPoolConfig({
  connection: getPgPoolConfig(env.DATABASE_URL),
  configuredMax: env.DB_POOL_MAX,
  configuredIdleTimeoutMs: env.DB_POOL_IDLE_TIMEOUT_MS,
  configuredConnectionTimeoutMs: env.DB_POOL_CONNECTION_TIMEOUT_MS,
  configuredLockTimeoutMs: env.DB_POOL_LOCK_TIMEOUT_MS,
  isVercel: process.env.VERCEL === "1",
});
// Logger import waiver for `src/db/`: see docs/architecture.md, "Structured
// logging". The pool is built at module scope, so the telemetry logger is
// resolved here and injected into everything below it.
const poolLog = logger.child({
  computeRegion: process.env.VERCEL_REGION ?? "non-vercel",
});
const telemetryOptions = { enabled: env.DB_POOL_TELEMETRY, log: poolLog };
const pool = createObservedPool(poolConfig, telemetryOptions);

// Fluid Compute shares this module-scope pool across concurrent invocations.
// Keep the instance alive until pg's idle timer releases unused connections.
attachDatabasePool(pool);

if (env.DB_POOL_TELEMETRY) {
  poolLog.info(
    {
      maxConnections: poolConfig.max,
      idleTimeoutMs: poolConfig.idleTimeoutMillis,
      connectionTimeoutMs: poolConfig.connectionTimeoutMillis,
      lockTimeoutMs: poolConfig.lock_timeout,
    },
    "database pool telemetry enabled",
  );
}

export const db = drizzle(pool, { schema });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Hold a session-scoped advisory lock while the callback performs separately
 * committed work through the shared pool. Session and transaction advisory
 * locks share PostgreSQL's lock namespace, so this serializes with callers of
 * `withDedicatedLockConnection` that use the same key.
 */
export async function withDedicatedSessionAdvisoryLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = createObservedClient(
    {
      ...getPgPoolConfig(env.DATABASE_URL),
      connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
    },
    telemetryOptions,
  );

  try {
    await client.connect();
    await client.query(
      "select pg_advisory_lock(hashtextextended($1, 0))",
      [lockKey],
    );
    try {
      return await fn();
    } finally {
      await client.query(
        "select pg_advisory_unlock(hashtextextended($1, 0))",
        [lockKey],
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Hold a transaction-scoped lock without consuming a connection from the
 * shared application pool. Per-call connections are intentional: lock-backed
 * certification work is infrequent and may perform heavyweight nested work
 * through the shared pool while the lock remains held.
 */
export async function withDedicatedLockConnection<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const client = createObservedClient(
    {
      ...getPgPoolConfig(env.DATABASE_URL),
      connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
    },
    telemetryOptions,
  );

  try {
    await client.connect();
    const lockDb = drizzle(client, { schema });
    return await lockDb.transaction(async (tx) => fn(tx));
  } finally {
    await client.end();
  }
}
