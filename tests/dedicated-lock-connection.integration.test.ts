/**
 * Regression coverage for the evidence-ledger lock connection.
 *
 * Run with:
 *   pnpm exec vitest run tests/dedicated-lock-connection.integration.test.ts
 *
 * The test skips when DATABASE_URL is unset or the configured database cannot
 * be reached. It does not load an env file.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { getPgPoolConfig } from "@/lib/pg-pool-config";

const COMPLETION_TIMEOUT_MS = 2_000;
const TEST_QUERY_RESULT = 1;

describe("withDedicatedLockConnection", () => {
  it("leaves a max=1 shared pool available while the lock is held", async (ctx) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      ctx.skip();
      return;
    }

    const sharedPool = new Pool({
      ...getPgPoolConfig(databaseUrl),
      max: 1,
      connectionTimeoutMillis: COMPLETION_TIMEOUT_MS,
    });

    try {
      try {
        await sharedPool.query("select 1");
      } catch {
        ctx.skip();
        return;
      }

      const sharedDb = drizzle(sharedPool);
      // The app pool must be the QA-failure shape (max=1) for this test to
      // pin the regression: a helper reverted to `db.transaction` would hold
      // the app pool's only connection and deadlock the inner `db` query.
      process.env.DB_POOL_MAX = "1";
      const { db, withDedicatedLockConnection } = await import("@/db");
      const { acquireCertificationArtifactLocksSorted } = await import(
        "@/lib/certification/submission-lock"
      );

      const startedAt = performance.now();
      const result = await withDedicatedLockConnection(async (tx) => {
        await acquireCertificationArtifactLocksSorted(tx, [
          {
            provider: "isometric",
            localEntityType: "removal",
            localEntityId: "dedicated-lock-connection-test",
          },
        ]);
        // Exercise BOTH the app's global db (the connection the old code
        // deadlocked on) and an explicit max=1 pool while the lock is held.
        const appRows = await db.execute<{ value: number }>(
          sql`select 1 as value`,
        );
        if (appRows.rows[0]?.value !== TEST_QUERY_RESULT) {
          throw new Error("app db query returned unexpected result");
        }
        const rows = await sharedDb.execute<{ value: number }>(
          sql`select 1 as value`,
        );
        return rows.rows[0]?.value;
      });

      expect(result).toBe(TEST_QUERY_RESULT);
      expect(performance.now() - startedAt).toBeLessThan(COMPLETION_TIMEOUT_MS);
    } finally {
      await sharedPool.end();
    }
  });
});
