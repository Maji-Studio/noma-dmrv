import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import { Client } from "pg";
import journal from "../drizzle/meta/_journal.json";
import { getPgPoolConfig } from "../src/lib/pg-pool-config";
import { assertThrowawayTestDatabase, resolveTestDatabaseUrl } from "./helpers/throwaway-database";
import { isWorktreeTestDatabaseUrl } from "./helpers/worktree-test-database";

const MISSING_MIGRATION_TABLE_CODES = ["42P01", "3F000"];
const MIGRATION_TIMEOUT_MS = 120_000;

type AppliedMigrations = { count: string; latest: string | null };

async function readAppliedMigrations(client: Client): Promise<AppliedMigrations> {
  const { rows: [applied] } = await client.query<AppliedMigrations>(
    "SELECT count(*) AS count, max(created_at) AS latest FROM drizzle.__drizzle_migrations",
  ).catch((error: unknown) => {
    if (MISSING_MIGRATION_TABLE_CODES.includes((error as { code?: string }).code ?? "")) {
      return { rows: [{ count: "0", latest: null }] };
    }
    throw error;
  });
  return applied;
}

function migrationsMatchJournal(applied: AppliedMigrations): boolean {
  return Number(applied.count) === journal.entries.length
    && Number(applied.latest) === journal.entries.at(-1)!.when;
}

function isJournalPrefix(applied: AppliedMigrations): boolean {
  const count = Number(applied.count);
  return count === 0
    ? applied.latest === null
    : Number(applied.latest) === journal.entries.at(count - 1)?.when;
}

function migrateWorktreeTestDatabase(databaseUrl: string, dbName: string): void {
  try {
    execFileSync("pnpm", ["db:migrate"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
      timeout: MIGRATION_TIMEOUT_MS,
    });
  } catch (error) {
    const failure = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const output = [failure.stdout, failure.stderr].filter(Boolean).join("\n");
    throw new Error(
      `Failed to migrate test database ${dbName}: ${output || failure.message || String(error)}`,
      { cause: error },
    );
  }
}

function throwMigrationMismatch(applied: AppliedMigrations, dbName: string): never {
  const expected = journal.entries.at(-1)!;
  const missing = Math.max(0, journal.entries.length - Number(applied.count));
  const status = missing > 0 ? `is missing ${missing} migration(s)` : "has diverged migration history";
  const latestTag = journal.entries.find((entry) => entry.when === Number(applied.latest))?.tag ?? applied.latest ?? "none";
  const remedy = missing > 0
    ? "Run: TEST_DATABASE_URL=<test-db-url> DATABASE_URL=<test-db-url> pnpm db:migrate (or reset the worktree test DB)"
    : "The test DB is ahead of or diverged from this branch's journal. Reset it: scripts/worktree.sh teardown <name> and new again, or drop the test DB and migrate it from empty";
  throw new Error(
    `Test database ${dbName} ${status} (latest applied ${latestTag}, expected ${expected.tag}). ${remedy}`,
  );
}

export default async function setup() {
  config({ path: ".env.test", quiet: true });
  if (process.env.VITEST_SKIP_MIGRATION_CHECK === "1") return;
  const databaseUrl = resolveTestDatabaseUrl(process.env);
  if (!databaseUrl) return;
  assertThrowawayTestDatabase(databaseUrl);

  const client = new Client(getPgPoolConfig(databaseUrl));
  try {
    await client.connect();
    let applied = await readAppliedMigrations(client);
    if (migrationsMatchJournal(applied)) return;

    const dbName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    const missing = journal.entries.length - Number(applied.count);
    if (missing > 0 && !process.env.CI && isJournalPrefix(applied)
      && isWorktreeTestDatabaseUrl(databaseUrl)) {
      migrateWorktreeTestDatabase(databaseUrl, dbName);
      applied = await readAppliedMigrations(client);
      if (migrationsMatchJournal(applied)) {
        console.log(`Test database ${dbName} was missing ${missing} migration(s); migrated it (worktree test DB).`);
        return;
      }
    }
    throwMigrationMismatch(applied, dbName);
  } finally {
    await client.end();
  }
}
