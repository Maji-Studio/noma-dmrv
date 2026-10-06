/**
 * Idempotency claim protocol and replay (data-entry API plan, Phase 0 c).
 * Races run on separate connections of a pool of their own, so a waiting
 * claim really waits on PostgreSQL rather than on the pool.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { db, type DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import { apiIdempotencyRecords, suppliers } from "@/db/schema";
import {
  IDEMPOTENCY_CLAIM_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_RETENTION_DAYS,
} from "@/config/operations";
import {
  claimIdempotencyKey,
  recordIdempotencyOutcome,
  type IdempotencyClaim,
} from "@/data-access/api-idempotency-records";
import { DomainError } from "@/lib/operations/errors";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { runOperation, type Operation } from "@/lib/operations/runner";
import {
  createIntakeFixture,
  createTestPool,
  feedstockCount,
  removeIntakeFixture,
  type IntakeFixture,
} from "./helpers/operation-fixture";

const SUITE_TIMEOUT_MS = 30_000;
const CLAIM_ANSWER_SLACK_MS = 400;
const HOLD_BEFORE_RELEASE_MS = 150;
const DAY_MS = 86_400_000;
const PARALLEL_DUPLICATES = 3;

let fixture: IntakeFixture;
let pool: Pool;

beforeAll(async () => {
  fixture = await createIntakeFixture("idem");
  pool = createTestPool(PARALLEL_DUPLICATES + 1);
});

afterAll(async () => {
  await pool.end();
  await removeIntakeFixture(fixture);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function claimFor(key: string, fingerprint = "fp-a"): IdempotencyClaim {
  return { credentialId: "cred_idem", key, operationId: "test_op", fingerprint };
}

/**
 * Open a transaction on its own connection and hand back controls, so a test
 * can interleave two transactions step by step.
 */
async function openTransaction() {
  const client: PoolClient = await pool.connect();
  const connection = drizzle(client, { schema });
  let finish!: (commit: boolean) => void;
  const decided = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  let ready!: (tx: DbTransaction) => void;
  const txReady = new Promise<DbTransaction>((resolve) => {
    ready = resolve;
  });
  const done = connection
    .transaction(async (tx) => {
      ready(tx);
      if (!(await decided)) throw new Error("rollback requested");
    })
    .catch((error: unknown) => {
      if (!(error instanceof Error && error.message === "rollback requested")) throw error;
    })
    .finally(() => client.release());
  return {
    tx: await txReady,
    commit: async () => {
      finish(true);
      await done;
    },
    rollback: async () => {
      finish(false);
      await done;
    },
  };
}

async function recordFor(key: string) {
  const [record] = await db
    .select()
    .from(apiIdempotencyRecords)
    .where(
      and(
        eq(apiIdempotencyRecords.organizationId, fixture.ctx.organizationId),
        eq(apiIdempotencyRecords.idempotencyKey, key),
      ),
    );
  return record;
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<DomainError> {
  const error = await promise.then(
    () => {
      throw new Error(`expected ${code}, but it succeeded`);
    },
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  return error as DomainError;
}

describe("idempotency claim protocol", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("answers a concurrent duplicate as still running before the first is released, then replays", async () => {
    const key = crypto.randomUUID();
    const first = await openTransaction();
    const owner = await claimIdempotencyKey(fixture.ctx, first.tx, claimFor(key));
    expect(owner.kind).toBe("owner");

    const second = await openTransaction();
    const started = Date.now();
    const busy = await expectDomainError(
      claimIdempotencyKey(fixture.ctx, second.tx, claimFor(key)),
      "idempotency_in_progress",
    );
    expect(Date.now() - started).toBeLessThan(IDEMPOTENCY_CLAIM_LOCK_TIMEOUT_MS + CLAIM_ANSWER_SLACK_MS);
    expect(busy.retryAfterSeconds).toBeGreaterThan(0);
    await second.rollback();

    if (owner.kind !== "owner") throw new Error("unreachable");
    await recordIdempotencyOutcome(fixture.ctx, first.tx, owner.recordId, { code: "FS-26-001" });
    await first.commit();

    const third = await openTransaction();
    const replay = await claimIdempotencyKey(fixture.ctx, third.tx, claimFor(key));
    await third.rollback();
    expect(replay).toEqual({ kind: "replay", outcome: { code: "FS-26-001" } });
  });

  it("hands the key to the waiting request when the first rolls back", async () => {
    const key = crypto.randomUUID();
    const first = await openTransaction();
    await claimIdempotencyKey(fixture.ctx, first.tx, claimFor(key));

    const second = await openTransaction();
    const waiting = claimIdempotencyKey(fixture.ctx, second.tx, claimFor(key));
    await sleep(HOLD_BEFORE_RELEASE_MS);
    await first.rollback();

    expect((await waiting).kind).toBe("owner");
    await second.rollback();
  });

  it("refuses a committed key reused for a different request", async () => {
    const key = crypto.randomUUID();
    const first = await openTransaction();
    const owner = await claimIdempotencyKey(fixture.ctx, first.tx, claimFor(key));
    if (owner.kind !== "owner") throw new Error("expected to own the key");
    await recordIdempotencyOutcome(fixture.ctx, first.tx, owner.recordId, { ok: true });
    await first.commit();

    const second = await openTransaction();
    await expectDomainError(
      claimIdempotencyKey(fixture.ctx, second.tx, claimFor(key, "fp-b")),
      "idempotency_key_reused",
    );
    await second.rollback();
  });

  it("lets a key be reused as a new request once its record expired", async () => {
    const key = crypto.randomUUID();
    const first = await openTransaction();
    const owner = await claimIdempotencyKey(fixture.ctx, first.tx, claimFor(key));
    if (owner.kind !== "owner") throw new Error("expected to own the key");
    await recordIdempotencyOutcome(fixture.ctx, first.tx, owner.recordId, { ok: true });
    await first.commit();

    const later = new Date(Date.now() + (IDEMPOTENCY_RETENTION_DAYS + 1) * DAY_MS);
    const second = await openTransaction();
    const reclaimed = await claimIdempotencyKey(fixture.ctx, second.tx, claimFor(key, "fp-b"), later);
    expect(reclaimed.kind).toBe("owner");
    await second.rollback();
  });

  it("answers a concurrent reclaim of the same expired key as still running", async () => {
    const key = crypto.randomUUID();
    const first = await openTransaction();
    const owner = await claimIdempotencyKey(fixture.ctx, first.tx, claimFor(key));
    if (owner.kind !== "owner") throw new Error("expected to own the key");
    await recordIdempotencyOutcome(fixture.ctx, first.tx, owner.recordId, { ok: true });
    await first.commit();

    // Another reclaimer has read the expired record and is deleting it: it
    // holds the row, as its DELETE would, but has not inserted a new one yet.
    const reclaimer = await openTransaction();
    await reclaimer.tx
      .select({ id: apiIdempotencyRecords.id })
      .from(apiIdempotencyRecords)
      .where(
        and(
          eq(apiIdempotencyRecords.organizationId, fixture.ctx.organizationId),
          eq(apiIdempotencyRecords.idempotencyKey, key),
        ),
      )
      .for("update");

    const later = new Date(Date.now() + (IDEMPOTENCY_RETENTION_DAYS + 1) * DAY_MS);
    const rival = await openTransaction();
    const started = Date.now();
    await expectDomainError(
      claimIdempotencyKey(fixture.ctx, rival.tx, claimFor(key, "fp-c"), later),
      "idempotency_in_progress",
    );
    expect(Date.now() - started).toBeLessThan(IDEMPOTENCY_CLAIM_LOCK_TIMEOUT_MS + CLAIM_ANSWER_SLACK_MS);
    await rival.rollback();
    await reclaimer.rollback();
  });
});

describe("runner idempotency", { timeout: SUITE_TIMEOUT_MS }, () => {
  const idempotencyFor = (key: string) => ({ credentialId: "cred_runner_idem", key });

  it("writes once for parallel duplicates and replays the same body afterwards", async () => {
    const before = await feedstockCount(fixture);
    const idempotency = idempotencyFor(crypto.randomUUID());
    const outcomes = await Promise.allSettled(
      Array.from({ length: PARALLEL_DUPLICATES }, () =>
        runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), { idempotency, pool }),
      ),
    );

    const succeeded = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const refused = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(succeeded).toHaveLength(1);
    for (const outcome of refused) {
      expect((outcome.reason as DomainError).code).toBe("idempotency_in_progress");
    }
    expect(await feedstockCount(fixture)).toBe(before + 1);

    const replay = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
      idempotency,
      pool,
    });
    expect(replay.replayed).toBe(true);
    const original = (succeeded[0] as PromiseFulfilledResult<typeof replay>).value;
    expect(replay.data).toEqual(original.data);
    expect(await feedstockCount(fixture)).toBe(before + 1);
  });

  it("replays reordered JSON and refuses a different payload under the same key", async () => {
    const idempotency = idempotencyFor(crypto.randomUUID());
    const input = fixture.input();
    await runOperation(logFeedstockDelivery, fixture.ctx, input, { idempotency, pool });

    const reordered = Object.fromEntries(Object.entries(input).reverse());
    const replay = await runOperation(logFeedstockDelivery, fixture.ctx, reordered, {
      idempotency,
      pool,
    });
    expect(replay.replayed).toBe(true);

    await expectDomainError(
      runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(1234), { idempotency, pool }),
      "idempotency_key_reused",
    );
  });

  it("keeps the namespace per credential", async () => {
    const before = await feedstockCount(fixture);
    const key = crypto.randomUUID();
    await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
      idempotency: { credentialId: "cred_one", key },
      pool,
    });
    const other = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
      idempotency: { credentialId: "cred_two", key },
      pool,
    });
    expect(other.replayed).toBe(false);
    expect(await feedstockCount(fixture)).toBe(before + 2);
  });

  it("never claims a key on a dry run, and refuses a dry run on a committed key", async () => {
    const before = await feedstockCount(fixture);
    const idempotency = idempotencyFor(crypto.randomUUID());

    await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
      idempotency,
      pool,
      dryRun: true,
    });
    expect(await recordFor(idempotency.key)).toBeUndefined();

    const real = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
      idempotency,
      pool,
    });
    expect(real.replayed).toBe(false);
    expect(await feedstockCount(fixture)).toBe(before + 1);

    await expectDomainError(
      runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
        idempotency,
        pool,
        dryRun: true,
      }),
      "key_already_used",
    );
  });

  it("leaves no record when the write fails, so a retry runs afresh", async () => {
    const idempotency = idempotencyFor(crypto.randomUUID());
    let attempts = 0;
    const flaky: Operation<z.ZodObject, { attempt: number }> = {
      id: "test_flaky",
      input: z.object({}),
      supportsDryRun: false,
      execute: async ({ ctx, tx }) => {
        attempts++;
        await tx.insert(suppliers).values({
          organizationId: ctx.organizationId,
          code: `SUP-FLAKY-${attempts}-${idempotency.key.slice(0, 8)}`,
          name: `Flaky ${attempts}`,
        });
        if (attempts === 1) throw new Error("stock conflict");
        return { attempt: attempts };
      },
    };

    await expect(runOperation(flaky, fixture.ctx, {}, { idempotency, pool })).rejects.toThrow(
      "stock conflict",
    );
    expect(await recordFor(idempotency.key)).toBeUndefined();

    const retry = await runOperation(flaky, fixture.ctx, {}, { idempotency, pool });
    expect(retry).toEqual({ data: { attempt: 2 }, dryRun: false, replayed: false });
  });

  it("reports a lost commit acknowledgement as unknown, and a retry with the key replays it", async () => {
    const before = await feedstockCount(fixture);
    const idempotency = idempotencyFor(crypto.randomUUID());
    // A pool whose next connection commits, then loses the acknowledgement.
    const lossyPool = {
      connect: async () => {
        const client = await pool.connect();
        const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        (client as unknown as { query: unknown }).query = async (...args: unknown[]) => {
          const config = args[0] as string | { text?: string };
          const text = typeof config === "string" ? config : config.text;
          const result = await query(...args);
          if (text?.trim().toLowerCase() === "commit") {
            throw new Error("Connection terminated unexpectedly");
          }
          return result;
        };
        return client;
      },
    } as unknown as Pool;

    const unknown = await expectDomainError(
      runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
        idempotency,
        pool: lossyPool,
      }),
      "outcome_unknown",
    );
    expect(unknown.retryable).toBe(true);
    expect(await feedstockCount(fixture)).toBe(before + 1);

    const retry = await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(), {
      idempotency,
      pool,
    });
    expect(retry.replayed).toBe(true);
    expect(await feedstockCount(fixture)).toBe(before + 1);
  });
});
