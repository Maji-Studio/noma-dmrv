import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../../src/db/schema";

export function createDbConnection() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/app_template_test";
  const pool = new Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), pool };
}
