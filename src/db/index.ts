/**
 * Database connection and client
 * Provides drizzle ORM instance with PostgreSQL connection
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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
