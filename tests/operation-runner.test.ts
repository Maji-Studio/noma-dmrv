/**
 * The operation runner at the app's default pool size of one connection
 * (data-entry API plan, Phase 0 b and e). The global pool is shrunk before any
 * module reads the env, so a stray read through `db` inside the runner's
 * transaction would wait on its own connection and fail this suite.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

vi.hoisted(() => {
  process.env.DB_POOL_MAX = "1";
});

import { db } from "@/db";
import { storageLocations, suppliers } from "@/db/schema";
import { DomainError } from "@/lib/operations/errors";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { runOperation, type Operation } from "@/lib/operations/runner";
import {
  createIntakeFixture,
  feedstockCount,
  removeIntakeFixture,
  type IntakeFixture,
} from "./helpers/operation-fixture";

const SUITE_TIMEOUT_MS = 30_000;
/** Far below the pool's 10 s connection timeout, which a self-deadlock would hit. */
const NO_SELF_WAIT_MS = 3_000;
const SHORT_DEADLINE_MS = 400;
const QUEUED_ANSWER_SLACK_MS = 300;
const SETTLE_MS = 150;
const FEEDSTOCK_CODE = /^FS-\d{2}-\d{3,}$/;

let fixture: IntakeFixture;

beforeAll(async () => {
  fixture = await createIntakeFixture("runner");
});

afterAll(async () => {
  await removeIntakeFixture(fixture);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function supplierNamed(name: string) {
  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.name, name));
  return row;
}

/** Inserts a supplier, then runs `afterInsert` in the same transaction. */
function supplierThen(
  name: string,
  afterInsert: (tx: Parameters<Operation<z.ZodObject, null>["execute"]>[0]["tx"]) => Promise<void>,
): Operation<z.ZodObject, null> {
  return {
    id: "test_supplier_then",
    input: z.object({}),
    supportsDryRun: true,
    execute: async ({ ctx, tx }) => {
      await tx.insert(suppliers).values({
        organizationId: ctx.organizationId,
        code: `SUP-${crypto.randomUUID().slice(0, 8)}`,
        name,
      });
      await afterInsert(tx);
      return null;
    },
  };
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<DomainError> {
  const error = await promise.then(
    () => {
      throw new Error(`expected ${code}, but the operation succeeded`);
    },
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  return error as DomainError;
}

describe("operation runner at pool size 1", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("runs on the app's single-connection pool", () => {
    expect(db.$client.options.max).toBe(1);
  });

  it("logs a feedstock delivery without waiting on its own connection", async () => {
    const before = await feedstockCount(fixture);
    const started = Date.now();

    const result = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input());

    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
    expect(result.dryRun).toBe(false);
    const [created] = result.data.feedstocks;
    expect(created.code).toMatch(FEEDSTOCK_CODE);
    expect(created.massWetKg).toBe(4200);
    expect(created.massDryKg).toBeCloseTo(2835, 3);
    expect(created.deliveryDate).toBe("2026-10-06T00:00:00.000Z");
    expect(created.transportDistanceKm).toBe(18);
    expect(await feedstockCount(fixture)).toBe(before + 1);
  });

  it("returns a dry run's would-be delivery and writes nothing", async () => {
    const dryFixture = await createIntakeFixture("dryrun");
    try {
      const result = await runOperation(logFeedstockDelivery, dryFixture.ctx, dryFixture.input(), {
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.data.feedstocks[0].code).toMatch(FEEDSTOCK_CODE);
      expect(result.data.feedstocks[0].deliveryDate).toBe("2026-10-06T00:00:00.000Z");
      expect(await feedstockCount(dryFixture)).toBe(0);
      const [bin] = await db
        .select({ feedstockTypeId: storageLocations.feedstockTypeId })
        .from(storageLocations)
        .where(eq(storageLocations.id, dryFixture.binId));
      expect(bin.feedstockTypeId).toBeNull();
    } finally {
      await removeIntakeFixture(dryFixture);
    }
  });

  it("refuses invalid input with the path of every issue", async () => {
    const error = await expectDomainError(
      runOperation(logFeedstockDelivery, fixture.ctx, {
        ...fixture.input(),
        deliveryDate: "2026-02-31",
        totalWetMassKg: "-1",
      }),
      "validation_failed",
    );
    const paths = error.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["deliveryDate", "totalWetMassKg"]));
  });

  it("never starts a request whose deadline passed while it waited for the connection", async () => {
    const before = await feedstockCount(fixture);
    const held = await db.$client.connect();
    let released = false;
    try {
      const started = Date.now();
      await expectDomainError(
        runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
          deadlineMs: SHORT_DEADLINE_MS,
        }),
        "deadline_exceeded",
      );
      expect(Date.now() - started).toBeLessThan(SHORT_DEADLINE_MS + QUEUED_ANSWER_SLACK_MS);

      held.release();
      released = true;
      await sleep(SETTLE_MS);
      expect(await feedstockCount(fixture)).toBe(before);
    } finally {
      if (!released) held.release();
    }

    // The late connection went back to the pool: the next request runs.
    await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input());
    expect(await feedstockCount(fixture)).toBe(before + 1);
  });

  it("cancels a statement that overruns the budget and rolls back", async () => {
    const name = `Overrun ${crypto.randomUUID()}`;
    await expectDomainError(
      runOperation(
        supplierThen(name, async (tx) => {
          await tx.execute(sql`select pg_sleep(2)`);
        }),
        fixture.ctx,
        {},
        { deadlineMs: SHORT_DEADLINE_MS },
      ),
      "deadline_exceeded",
    );
    expect(await supplierNamed(name)).toBeUndefined();
  });

  it("rolls back short statements that together overrun the budget, before COMMIT", async () => {
    const name = `Many short ${crypto.randomUUID()}`;
    const error = await expectDomainError(
      runOperation(
        supplierThen(name, async (tx) => {
          for (let i = 0; i < 12; i++) await tx.execute(sql`select pg_sleep(0.05)`);
        }),
        fixture.ctx,
        {},
        { deadlineMs: SHORT_DEADLINE_MS },
      ),
      "deadline_exceeded",
    );
    expect(error.message).toContain("before saving");
    expect(await supplierNamed(name)).toBeUndefined();
  });

  it("runs after-commit hooks only after a real commit, and a failing hook keeps the write", async () => {
    const calls: string[] = [];
    const name = `Hooked ${crypto.randomUUID()}`;
    const operation: Operation<z.ZodObject, null> = {
      ...supplierThen(name, async () => undefined),
      execute: async (scope, input) => {
        scope.afterCommit(() => {
          calls.push("hook");
        });
        scope.afterCommit(() => {
          throw new Error("telemetry down");
        });
        return supplierThen(name, async () => undefined).execute(scope, input);
      },
    };

    await runOperation(operation, fixture.ctx, {}, { dryRun: true });
    expect(calls).toEqual([]);

    await runOperation(operation, fixture.ctx, {});
    expect(calls).toEqual(["hook"]);
    expect(await supplierNamed(name)).toBeDefined();
  });

  it("runs after-commit hooks once the connection is free, so a hook can read through db", async () => {
    const name = `Hook reads ${crypto.randomUUID()}`;
    let seen = -1;
    const operation: Operation<z.ZodObject, null> = {
      ...supplierThen(name, async () => undefined),
      execute: async (scope, input) => {
        scope.afterCommit(async () => {
          seen = (await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, name))).length;
        });
        return supplierThen(name, async () => undefined).execute(scope, input);
      },
    };
    const started = Date.now();

    await runOperation(operation, fixture.ctx, {});

    expect(seen).toBe(1);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
  });

  it("answers a duplicate idempotency key at once while the first request waits for the connection", async () => {
    const before = await feedstockCount(fixture);
    const idempotency = { credentialId: "cred_runner", key: crypto.randomUUID() };
    const held = await db.$client.connect();
    let first: Promise<unknown> | undefined;
    try {
      first = runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), { idempotency });
      const started = Date.now();
      const duplicate = await expectDomainError(
        runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), { idempotency }),
        "idempotency_in_progress",
      );
      expect(Date.now() - started).toBeLessThan(QUEUED_ANSWER_SLACK_MS);
      expect(duplicate.retryable).toBe(true);
    } finally {
      held.release();
    }
    await first;
    expect(await feedstockCount(fixture)).toBe(before + 1);

    const replay = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
      idempotency,
    });
    expect(replay.replayed).toBe(true);
    expect(await feedstockCount(fixture)).toBe(before + 1);
  });
});
