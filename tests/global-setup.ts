import { config } from "dotenv";
import { Client } from "pg";
import journal from "../drizzle/meta/_journal.json";
import { getPgPoolConfig } from "../src/lib/pg-pool-config";
import { assertThrowawayTestDatabase, resolveTestDatabaseUrl } from "./helpers/throwaway-database";

const MISSING_MIGRATION_TABLE_CODES = ["42P01", "3F000"];

export default async function setup() {
  config({ path: ".env.test", quiet: true });
  if (process.env.VITEST_SKIP_MIGRATION_CHECK === "1") return;
  const databaseUrl = resolveTestDatabaseUrl(process.env);
  if (!databaseUrl) return;
  assertThrowawayTestDatabase(databaseUrl);

  const client = new Client(getPgPoolConfig(databaseUrl));
  try {
    await client.connect();
    const { rows: [applied] } = await client.query<{ count: string; latest: string | null }>(
      "SELECT count(*) AS count, max(created_at) AS latest FROM drizzle.__drizzle_migrations",
    ).catch((error: unknown) => {
      if (MISSING_MIGRATION_TABLE_CODES.includes((error as { code?: string }).code ?? "")) {
        return { rows: [{ count: "0", latest: null }] };
      }
      throw error;
    });
    const expected = journal.entries.at(-1)!;
    const count = Number(applied.count);
    const latest = Number(applied.latest);
    if (count === journal.entries.length && latest === expected.when) return;

    const missing = Math.max(0, journal.entries.length - count);
    const status = missing > 0 ? `is missing ${missing} migration(s)` : "has diverged migration history";
    const latestTag = journal.entries.find((entry) => entry.when === latest)?.tag ?? applied.latest ?? "none";
    const dbName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    throw new Error(
      `Test database ${dbName} ${status} (latest applied ${latestTag}, expected ${expected.tag}). Run: ` +
      "TEST_DATABASE_URL=<test-db-url> DATABASE_URL=<test-db-url> pnpm db:migrate " +
      "(or reset the worktree test DB)",
    );
  } finally {
    await client.end();
  }
}
