/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { creditBatches } from "@/db/schema";
import { IDEMPOTENCY_RETRY_AFTER_SECONDS } from "@/config/operations";
import { updateSampleFn } from "@/fn/samples";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createApiLabFixture, expectProblem, removeApiLabFixture, type ApiLabFixture } from "./helpers/api-lab-sample-fixture";
import {
  labIdempotencyRecords, labSampleAudits, labSampleBody, labSampleRows, patchLabSample, postLabSample, readRestLabSample, seedRestLabSample,
} from "./helpers/api-lab-sample-write-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
const poolEnv = vi.hoisted(() => {
  const original = process.env.DB_POOL_MAX;
  process.env.DB_POOL_MAX = "4";
  return original;
});
const TIMEOUT_MS = 60_000;
const BARRIER_CONNECTIONS = 2;
let f: ApiLabFixture;
let barrierPool: Pool;
beforeAll(() => { barrierPool = createTestPool(BARRIER_CONNECTIONS); });
beforeEach(async () => {
  f = await createApiLabFixture();
  auth.requireOrgContext.mockResolvedValue(f.ctx);
}, TIMEOUT_MS);
afterEach(async () => { await removeApiLabFixture(f); auth.requireOrgContext.mockReset(); });
afterAll(async () => {
  await barrierPool.end();
  if (poolEnv === undefined) delete process.env.DB_POOL_MAX;
  else process.env.DB_POOL_MAX = poolEnv;
});

/**
 * Hold the credit batch row in a separate transaction, start each writer in
 * order and wait until it queues behind the barrier, then release them. Row
 * locks queue first come, first served, so the start order is the commit order.
 */
async function race<T>(writers: (() => Promise<T>)[]): Promise<T[]> {
  const barrier = await openOperationBarrier(barrierPool);
  const pending: Promise<T>[] = [];
  try {
    await barrier.tx.select({ id: creditBatches.id }).from(creditBatches)
      .where(and(eq(creditBatches.id, f.batchA.id), eq(creditBatches.organizationId, f.ctx.organizationId))).for("update");
    for (const writer of writers) {
      pending.push(writer());
      await waitForBlockedOperations(barrierPool, barrier.pid, pending.length);
    }
    await barrier.commit();
    return await Promise.all(pending);
  } finally {
    await barrier.rollback();
    await Promise.allSettled(pending);
  }
}

describe("lab sample REST races", { timeout: TIMEOUT_MS }, () => {
  it("refuses the held duplicate, then replays exactly one sample, audit row and idempotency record", async () => {
    const key = randomUUID();
    const body = labSampleBody(f);
    const barrier = await openOperationBarrier(barrierPool);
    let first: Promise<Response> | undefined;
    let originalText: string;
    let originalEtag: string | null;
    try {
      await barrier.tx.select({ id: creditBatches.id }).from(creditBatches)
        .where(and(eq(creditBatches.id, f.batchA.id), eq(creditBatches.organizationId, f.ctx.organizationId))).for("update");
      first = postLabSample(f, body, key);
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      const duplicate = await postLabSample(f, body, key);
      expect(await expectProblem(duplicate, 409, "idempotency_in_progress")).toMatchObject({ retryable: true });
      expect(duplicate.headers.get("retry-after")).toBe(String(IDEMPOTENCY_RETRY_AFTER_SECONDS));
      expect(await labSampleRows(f)).toEqual([]);
      await barrier.commit();
      const original = await first;
      expect(original.status).toBe(201);
      expect(original.headers.get("idempotent-replayed")).toBeNull();
      originalText = await original.text(); originalEtag = original.headers.get("etag");
    } finally {
      await barrier.rollback();
      if (first) await Promise.allSettled([first]);
    }
    const replay = await postLabSample(f, body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(originalEtag);
    expect(await replay.text()).toBe(originalText);
    expect(await labSampleRows(f)).toHaveLength(1);
    expect(await labSampleAudits(f)).toMatchObject([{ operationId: "record_lab_sample", outcomeCode: "created", transport: "rest" }]);
    const records = await labIdempotencyRecords(f);
    expect(records).toMatchObject([{ idempotencyKey: key, operationId: "record_lab_sample", credentialId: f.writeCredentialId }]);
    expect(records[0].outcome).not.toBeNull();
  });

  it("gives two parallel creates with different keys two samples with different codes", async () => {
    const responses = await race([randomUUID(), randomUUID()].map((key) => () => postLabSample(f, labSampleBody(f), key)));
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const rows = await labSampleRows(f);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.sampleCode)).size).toBe(2);
    expect(await labSampleAudits(f)).toHaveLength(2);
  });

  it.each([
    ["REST first", ["rest", "action"]],
    ["the UI action first", ["action", "rest"]],
  ] as const)("serializes a REST update and the UI's update from one version when %s: one wins, the other is stale", async (_name, order) => {
    const saved = await seedRestLabSample(f);
    const writers = {
      rest: () => patchLabSample(f, saved.row.id, { labName: "REST Lab" }, saved.etag),
      action: () => updateSampleFn({ sampleId: saved.row.id, expectedVersion: saved.row.version, labName: "UI Lab" }),
    };
    const results = await race<unknown>(order.map((name) => writers[name]));
    const byName = Object.fromEntries(order.map((name, index) => [name, results[index]])) as unknown as { rest: Response; action: Awaited<ReturnType<typeof updateSampleFn>> };
    const [winner, loser] = order;
    if (winner === "rest") {
      expect(byName.rest.status).toBe(200);
      expect(byName.action).toMatchObject({ success: false, code: "stale_version" });
    } else {
      expect(byName.action).toMatchObject({ success: true });
      expect((await expectProblem(byName.rest, 412, "stale_version")).current).toMatchObject({ id: saved.row.id, version: 2, labName: "UI Lab" });
    }
    const current = await readRestLabSample(f, saved.row.id);
    expect(current.row.version).toBe(2);
    expect(current.row.labName).toBe(winner === "rest" ? "REST Lab" : "UI Lab");
    expect(loser).toBeDefined();
    // Only the REST write is audited as an API write, and only when it won.
    expect((await labSampleAudits(f)).filter((row) => row.operationId === "update_lab_sample")).toHaveLength(winner === "rest" ? 1 : 0);
  });
});
