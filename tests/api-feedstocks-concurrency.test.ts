/** REST races on real, separate PostgreSQL connections. Reviewer execution only. */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { apiIdempotencyRecords, feedstocks } from "@/db/schema";
import { IDEMPOTENCY_RETRY_AFTER_SECONDS } from "@/config/operations";
import { lockBinStock } from "@/data-access/lock-bin-stocks";
import { updateFeedstockFn } from "@/fn/feedstocks";
import { createTestPool, feedstockCount } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import {
  binWetStock, committedFeedstocks, createApiFeedstockFixture, decodedIntake,
  expectFeedstockProblem, patchFeedstock, postFeedstock, readFeedstock, removeApiFeedstockFixture,
  seedApiFeedstock, seedFeedstockDraw, type ApiFeedstockFixture,
} from "./helpers/api-feedstock-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(),
  requireOrgContext: auth.requireOrgContext,
}));

// As in operation-runner.test.ts, size the real app pool before imports read
// env. Four slots allow two writers plus credential checks; barriers/observers
// use a different pool. The lock budget exceeds the bounded observer polling.
const poolEnv = vi.hoisted(() => {
  const original = { max: process.env.DB_POOL_MAX, lockTimeout: process.env.DB_POOL_LOCK_TIMEOUT_MS };
  process.env.DB_POOL_MAX = "4";
  process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000";
  return original;
});

const SUITE_TIMEOUT_MS = 30_000;
const BARRIER_CONNECTIONS = 2;
const CONCURRENT_WRITERS = 2;
const INTAKE_WET_KG = 100;
const DRAW_PER_INTAKE_WET_KG = 60;
const REDUCED_WET_KG = 40;
const EXPECTED_REMAINING_WET_KG = 20;
const INITIAL_VERSION = 1;
const NEXT_VERSION = 2;

let fixture: ApiFeedstockFixture;
let barrierPool: Pool;

beforeAll(() => { barrierPool = createTestPool(BARRIER_CONNECTIONS); });
beforeEach(async () => {
  fixture = await createApiFeedstockFixture("rest-race");
  auth.requireOrgContext.mockResolvedValue(fixture.ctx);
});
afterEach(async () => {
  await removeApiFeedstockFixture(fixture);
  auth.requireOrgContext.mockReset();
});
afterAll(async () => {
  await barrierPool.end();
  if (poolEnv.max === undefined) delete process.env.DB_POOL_MAX;
  else process.env.DB_POOL_MAX = poolEnv.max;
  if (poolEnv.lockTimeout === undefined) delete process.env.DB_POOL_LOCK_TIMEOUT_MS;
  else process.env.DB_POOL_LOCK_TIMEOUT_MS = poolEnv.lockTimeout;
});

describe("feedstock REST concurrency", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("answers the held duplicate with Retry-After, then replays one row, stock effect and record", async () => {
    const key = randomUUID();
    const command = decodedIntake(fixture, INTAKE_WET_KG);
    const barrier = await openOperationBarrier(barrierPool);
    let first: Promise<Response> | undefined;
    let originalText: string;
    let originalEtag: string | null;
    try {
      await lockBinStock(fixture.ctx, barrier.tx, fixture.binId);
      first = postFeedstock(fixture, command, key);
      // Reaching the bin lock proves the first request already claimed the
      // key, but has not inserted its intake or committed the outcome.
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      const duplicate = await postFeedstock(fixture, command, key);
      const busy = await expectFeedstockProblem(duplicate, 409, "idempotency_in_progress");
      expect(busy.retryable).toBe(true);
      expect(duplicate.headers.get("retry-after")).toBe(String(IDEMPOTENCY_RETRY_AFTER_SECONDS));
      expect(await feedstockCount(fixture)).toBe(0);
      expect(await binWetStock(fixture)).toBe(0);

      await barrier.commit();
      const original = await first;
      expect(original.status).toBe(201);
      expect(original.headers.get("idempotent-replayed")).toBeNull();
      originalText = await original.text();
      originalEtag = original.headers.get("etag");
    } finally {
      await barrier.rollback();
      if (first) await Promise.allSettled([first]);
    }

    const replay = await postFeedstock(fixture, command, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(originalEtag);
    expect(await replay.text()).toBe(originalText);
    expect(await feedstockCount(fixture)).toBe(1);
    expect(await binWetStock(fixture)).toBe(INTAKE_WET_KG);
    const records = await db.select().from(apiIdempotencyRecords).where(and(
      eq(apiIdempotencyRecords.organizationId, fixture.ctx.organizationId),
      eq(apiIdempotencyRecords.credentialId, fixture.credentialId),
    ));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ idempotencyKey: key, operationId: "log_feedstock_delivery" });
    expect(records[0].outcome).not.toBeNull();
  });

  it("serializes reductions of two intakes in one drawn bin and rolls back the loser", async () => {
    const intakes = [
      await seedApiFeedstock(fixture, INTAKE_WET_KG),
      await seedApiFeedstock(fixture, INTAKE_WET_KG),
    ];
    await seedFeedstockDraw(fixture, intakes.map(({ row }) => ({
      feedstockId: row.id, wetMassUsedKg: DRAW_PER_INTAKE_WET_KG,
    })));
    expect(await binWetStock(fixture)).toBe(CONCURRENT_WRITERS * (INTAKE_WET_KG - DRAW_PER_INTAKE_WET_KG));
    const before = await committedFeedstocks(fixture);
    const barrier = await openOperationBarrier(barrierPool);
    const pending: Promise<Response>[] = [];
    let responses: Response[];
    try {
      await lockBinStock(fixture.ctx, barrier.tx, fixture.binId);
      pending.push(...intakes.map(({ row, etag }) => patchFeedstock(fixture, row, etag, { massWetKg: REDUCED_WET_KG })));
      // Both requests have locked different intake rows and are concurrently
      // waiting for this bin. Each reduction alone is affordable; both are not.
      const waitingPids = await waitForBlockedOperations(barrierPool, barrier.pid, CONCURRENT_WRITERS);
      expect(new Set(waitingPids).size).toBe(CONCURRENT_WRITERS);
      await barrier.commit();
      responses = await Promise.all(pending);
    } finally {
      await barrier.rollback();
      await Promise.allSettled(pending);
    }

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    const loserIndex = responses.findIndex((response) => response.status !== 200);
    const loser = responses[loserIndex];
    expect([409, 412]).toContain(loser.status);
    await expectFeedstockProblem(loser, loser.status, loser.status === 412 ? "stale_version" : "conflict");
    const winnerIndex = loserIndex === 0 ? 1 : 0;
    const winner = (await responses[winnerIndex].json()).data;
    expect(winner).toMatchObject({ id: intakes[winnerIndex].row.id, massWetKg: REDUCED_WET_KG, version: NEXT_VERSION });

    const stored = await committedFeedstocks(fixture);
    expect(stored).toHaveLength(CONCURRENT_WRITERS);
    expect(stored.find((row) => row.id === winner.id)).toMatchObject({ massWetKg: REDUCED_WET_KG, version: NEXT_VERSION });
    const loserId = intakes[loserIndex].row.id;
    expect(stored.find((row) => row.id === loserId)).toEqual(before.find((row) => row.id === loserId));
    expect(stored.find((row) => row.id === loserId)?.version).toBe(INITIAL_VERSION);
    const stock = await binWetStock(fixture);
    expect(stock).toBeGreaterThanOrEqual(0);
    expect(stock).toBe(EXPECTED_REMAINING_WET_KG);
  });

  it("commits exactly one simultaneous UI vs REST update from a shared version", async () => {
    const saved = await seedApiFeedstock(fixture, INTAKE_WET_KG);
    const barrier = await openOperationBarrier(barrierPool);
    let ui: ReturnType<typeof updateFeedstockFn> | undefined;
    let rest: Promise<Response> | undefined;
    try {
      await barrier.tx.select({ id: feedstocks.id }).from(feedstocks).where(and(
        eq(feedstocks.organizationId, fixture.ctx.organizationId), eq(feedstocks.id, saved.row.id),
      )).for("update");
      ui = updateFeedstockFn({ feedstockId: saved.row.id, expectedVersion: saved.row.version, notes: "UI writer" });
      rest = patchFeedstock(fixture, saved.row, saved.etag, { notes: "REST writer" });
      await waitForBlockedOperations(barrierPool, barrier.pid, CONCURRENT_WRITERS);
      await barrier.commit();

      const [action, response] = await Promise.all([ui, rest]);
      const current = await readFeedstock(fixture, saved.row.id);
      expect(current.row.version).toBe(NEXT_VERSION);
      if (action.success) {
        expect(action.data).toMatchObject({ version: NEXT_VERSION, notes: "UI writer" });
        const stale = await expectFeedstockProblem(response, 412, "stale_version");
        expect(stale.current).toEqual(current.row);
        expect(current.row.notes).toBe("UI writer");
      } else {
        expect(action.code).toBe("stale_version");
        expect(response.status).toBe(200);
        expect((await response.json()).data).toEqual(current.row);
        expect(current.row.notes).toBe("REST writer");
      }
      expect(await feedstockCount(fixture)).toBe(1);
      expect(await binWetStock(fixture)).toBe(INTAKE_WET_KG);
    } finally {
      await barrier.rollback();
      await Promise.allSettled([ui, rest].filter((operation) => operation !== undefined));
    }
  });
});
