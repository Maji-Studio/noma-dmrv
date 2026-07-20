/**
 * Database connection and client
 * Provides drizzle ORM instance with PostgreSQL connection
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { env } from "@/config/env";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import * as schema from "./schema";

const pool = new Pool({
  ...getPgPoolConfig(env.DATABASE_URL),
  max: env.DB_POOL_MAX ?? 1,
  idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS ?? 10_000,
  connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 10_000,
});

export const db = drizzle(pool, { schema });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Hold a transaction-scoped lock without consuming a connection from the
 * shared application pool. Per-call connections are intentional: lock-backed
 * certification work is infrequent and may perform heavyweight nested work
 * through the shared pool while the lock remains held.
 */
export async function withDedicatedLockConnection<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const client = new Client({
    ...getPgPoolConfig(env.DATABASE_URL),
    connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 10_000,
  });

  try {
    await client.connect();
    const lockDb = drizzle(client, { schema });
    return await lockDb.transaction(async (tx) => fn(tx));
  } finally {
    await client.end();
  }
}
