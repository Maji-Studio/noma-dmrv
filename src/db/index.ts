/**
 * Database connection and client
 * Provides drizzle ORM instance with PostgreSQL connection
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config/env";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX ?? 20,
  idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS ?? 30_000,
  connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 10_000,
});

export const db = drizzle(pool, { schema });
