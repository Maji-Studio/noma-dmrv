/**
 * A generated-code collision recovers inside the runner's transaction
 * (data-entry API plan, Phase 0 b): the colliding insert runs in a savepoint,
 * so the unique violation rolls back that attempt only and the retry reads the
 * winning row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import * as schema from "@/db/schema";
import { feedstocks } from "@/db/schema";
import { generateNextCodes } from "@/data-access/code-generator";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { runOperation } from "@/lib/operations/runner";
import {
  createIntakeFixture,
  createTestPool,
  feedstockCount,
  removeIntakeFixture,
  type IntakeFixture,
} from "./helpers/operation-fixture";

const SUITE_TIMEOUT_MS = 30_000;
const LOCK_WAIT_POLL_MS = 20;
const LOCK_WAIT_MAX_POLLS = 100;

let fixture: IntakeFixture;
let pool: Pool;

beforeAll(async () => {
  fixture = await createIntakeFixture("autocode");
  pool = createTestPool(3);
});

afterAll(async () => {
  await pool.end();
  await removeIntakeFixture(fixture);
});

function codeSuffix(code: string): number {
  return Number(/(\d+)$/.exec(code)?.[1]);
}

describe("savepointed auto-codes", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("retries a colliding feedstock code inside the same transaction", async () => {
    // A competing transaction takes the next code and holds it uncommitted.
    const competitor = await pool.connect();
    const competitorDb = drizzle(competitor, { schema });
    let competitorCode: string;
    try {
      await competitor.query("begin");
      [competitorCode] = await generateNextCodes(
        fixture.ctx,
        "FS",
        feedstocks,
        feedstocks.code,
        1,
        competitorDb,
      );
      await competitorDb.insert(feedstocks).values({
        organizationId: fixture.ctx.organizationId,
        code: competitorCode,
        facilityId: fixture.facilityId,
        feedstockTypeId: fixture.feedstockTypeId,
        massDryKg: 1,
      });

      // The runner cannot see that row, generates the same code, and its
      // insert waits on the competitor's unique-index entry.
      const running = runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), { pool });
      const observer = await pool.connect();
      let waitingQuery: string | undefined;
      try {
        for (let poll = 0; poll < LOCK_WAIT_MAX_POLLS && !waitingQuery; poll++) {
          const { rows } = await observer.query<{ query: string }>(
            "select query from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
          );
          waitingQuery = rows[0]?.query;
          if (!waitingQuery) await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
        }
      } finally {
        observer.release();
      }
      // It waits on the code's unique index, not on a row lock taken earlier.
      expect(waitingQuery).toMatch(/^insert into "feedstocks"/);
      await competitor.query("commit");

      const result = await running;
      const [created] = result.data.feedstocks;
      expect(codeSuffix(created.code)).toBe(codeSuffix(competitorCode) + 1);
      expect(await feedstockCount(fixture)).toBe(2);
    } finally {
      await competitorDb.execute(sql`rollback`).catch(() => undefined);
      competitor.release();
    }
  });
});
