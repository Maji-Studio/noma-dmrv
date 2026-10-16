/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { IDEMPOTENCY_RETRY_AFTER_SECONDS } from "@/config/operations";
import { createApiKey } from "@/data-access/api-keys";
import { lockBinStock } from "@/data-access/lock-bin-stocks";
import { GET as GET_RUN, PATCH as PATCH_RUN } from "@/app/api/v1/production-runs/[idOrCode]/route";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { runOperationInProcess } from "@/lib/operations/runner";
import { preAuthGuard, postAuthGuard } from "@/lib/api/guards";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createApiProductFixture, expectProblem, FIRST_LOSS_AT, removeApiProductFixture, type ApiProductFixture } from "./helpers/api-biochar-product-fixture";
import {
  captureProductWriteState, lossBody, countBody, postMovementRest, postProductRest, productWriteAudits, pureProductBody,
  WRITE_LOSS_AT, writeIdempotencyRecords, writeRequest,
} from "./helpers/api-biochar-write-fixture";

vi.mock("@/lib/api/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/guards")>();
  return { ...actual, preAuthGuard: vi.fn(actual.preAuthGuard), postAuthGuard: vi.fn(actual.postAuthGuard) };
});
const poolEnv = vi.hoisted(() => {
  const original = { max: process.env.DB_POOL_MAX, lockTimeout: process.env.DB_POOL_LOCK_TIMEOUT_MS };
  process.env.DB_POOL_MAX = "4";
  process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000";
  return original;
});
const TIMEOUT_MS = 60_000;
const BARRIER_CONNECTIONS = 2;
const LAST_STOCK_WET_KG = 1000;
const SOURCE_DRY_KG = 1500;
const FIRST_DRAW_DRY_KG = 900;
const LOSS_WET_KG = 100;
const LOSS_DRY_KG = 90;
const COUNTED_WET_KG = 1000;
const COUNTED_DRY_KG = 900;
let f: ApiProductFixture;
let barrierPool: Pool;
beforeAll(() => { barrierPool = createTestPool(BARRIER_CONNECTIONS); });
beforeEach(async () => {
  f = await createApiProductFixture();
  vi.mocked(preAuthGuard).mockClear();
  vi.mocked(postAuthGuard).mockClear();
}, TIMEOUT_MS);
afterEach(async () => { await removeApiProductFixture(f); });
afterAll(async () => {
  await barrierPool.end();
  if (poolEnv.max === undefined) delete process.env.DB_POOL_MAX;
  else process.env.DB_POOL_MAX = poolEnv.max;
  if (poolEnv.lockTimeout === undefined) delete process.env.DB_POOL_LOCK_TIMEOUT_MS;
  else process.env.DB_POOL_LOCK_TIMEOUT_MS = poolEnv.lockTimeout;
});

/** Start every writer while a separate transaction holds the shared bin, then release them together. */
async function race<T>(binId: string, writers: (() => Promise<T>)[]): Promise<T[]> {
  const barrier = await openOperationBarrier(barrierPool);
  const pending: Promise<T>[] = [];
  try {
    await lockBinStock(f.ctx, barrier.tx, binId);
    pending.push(...writers.map((writer) => writer()));
    const pids = await waitForBlockedOperations(barrierPool, barrier.pid, writers.length);
    expect(new Set(pids).size).toBe(writers.length);
    await barrier.commit();
    return await Promise.all(pending);
  } finally {
    await barrier.rollback();
    await Promise.allSettled(pending);
  }
}

/** Posted movements of the loss and count kinds in posting order, as numbers. */
async function ledger() {
  return (await captureProductWriteState(f)).movements
    .filter((movement) => movement.outputKind === "loss" || movement.outputKind === "count")
    .map((movement) => ({ kind: movement.outputKind, before: Number(movement.balanceBeforeDryKg), after: Number(movement.balanceAfterDryKg) }));
}

describe("biochar product and movement REST races", { timeout: TIMEOUT_MS }, () => {
  it("refuses the held duplicate, then replays exactly one product, draw, audit row and idempotency record", async () => {
    const key = randomUUID();
    const body = pureProductBody(f);
    const barrier = await openOperationBarrier(barrierPool);
    let first: Promise<Response> | undefined;
    let originalText: string;
    let originalEtag: string | null;
    try {
      await lockBinStock(f.ctx, barrier.tx, f.source.id);
      first = postProductRest(f, body, key);
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      const duplicate = await postProductRest(f, body, key);
      expect(await expectProblem(duplicate, 409, "idempotency_in_progress")).toMatchObject({ retryable: true });
      expect(duplicate.headers.get("retry-after")).toBe(String(IDEMPOTENCY_RETRY_AFTER_SECONDS));
      expect((await captureProductWriteState(f)).products).toEqual([]);
      await barrier.commit();
      const original = await first;
      expect(original.status).toBe(201);
      expect(original.headers.get("idempotent-replayed")).toBeNull();
      originalText = await original.text(); originalEtag = original.headers.get("etag");
    } finally {
      await barrier.rollback();
      if (first) await Promise.allSettled([first]);
    }
    const replay = await postProductRest(f, body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(originalEtag);
    expect(await replay.text()).toBe(originalText);
    const state = await captureProductWriteState(f);
    expect(state.products).toHaveLength(1);
    expect(state.movements).toHaveLength(1);
    expect(await productWriteAudits(f)).toMatchObject([{ operationId: "make_biochar_product", action: "created", source: "rest" }]);
    const records = await writeIdempotencyRecords(f);
    expect(records).toMatchObject([{ idempotencyKey: key, operationId: "make_biochar_product", credentialId: f.writeCredentialId }]);
    expect(records[0].outcome).not.toBeNull();
  });

  it("lets exactly one of two creates take the last stock and refuses the other with insufficient_stock", async () => {
    const responses = await race(f.source.id, [randomUUID(), randomUUID()].map((key) =>
      () => postProductRest(f, pureProductBody(f, { biocharWetMassKg: LAST_STOCK_WET_KG }), key)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const refusal = await expectProblem(responses.find((response) => response.status !== 201)!, 409, "insufficient_stock");
    expect(refusal.errors).toContainEqual(expect.objectContaining({
      pointer: "/biocharWetMassKg",
      meta: expect.objectContaining({ storageLocationId: f.source.id, availableSolidsKg: SOURCE_DRY_KG - FIRST_DRAW_DRY_KG, requestedSolidsKg: FIRST_DRAW_DRY_KG }),
    }));
    const state = await captureProductWriteState(f);
    expect(state.products).toHaveLength(1);
    expect(state.movements).toHaveLength(1);
    expect(await productWriteAudits(f)).toHaveLength(1);
    expect(await writeIdempotencyRecords(f)).toHaveLength(1);
  });

  it("answers a stale fingerprint with a preview, never claims the key, charges one admission, and the retry on the preview's fingerprint saves", async () => {
    const dryRun = await postProductRest(f, pureProductBody(f), randomUUID(), "?dryRun=true");
    const stale: string = (await dryRun.json()).basisFingerprint;
    expect((await postMovementRest(f, f.source.id, lossBody({ occurredAt: FIRST_LOSS_AT, wetMassKg: LOSS_WET_KG }))).status).toBe(201);
    const records = (await writeIdempotencyRecords(f)).length;
    const audits = (await productWriteAudits(f, "movement")).length;
    vi.mocked(preAuthGuard).mockClear();
    vi.mocked(postAuthGuard).mockClear();

    const key = randomUUID();
    const refusal = await expectProblem(await postProductRest(f, { ...pureProductBody(f), basisFingerprint: stale }, key), 409, "stock_basis_changed");
    expect(refusal.conflict).toBeDefined();
    expect(refusal.preview.basisFingerprint).toEqual(expect.any(String));
    expect(refusal.preview.basisFingerprint).not.toBe(stale);
    expect(refusal.preview.stockEffects).toContainEqual(expect.objectContaining({ storageLocationId: f.source.id }));
    // One admission for the request; the fallback preview re-enters neither guard.
    expect(preAuthGuard).toHaveBeenCalledTimes(1);
    expect(postAuthGuard).toHaveBeenCalledTimes(1);
    // The failed attempt rolled back, and the preview is a dry run that claims no key.
    expect((await captureProductWriteState(f)).products).toEqual([]);
    expect(await writeIdempotencyRecords(f)).toHaveLength(records);
    expect(await productWriteAudits(f)).toEqual([]);
    expect(await productWriteAudits(f, "movement")).toHaveLength(audits);

    const retry = await postProductRest(f, { ...pureProductBody(f), basisFingerprint: refusal.preview.basisFingerprint }, key);
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBeNull();
    expect((await captureProductWriteState(f)).products).toHaveLength(1);
    expect(await writeIdempotencyRecords(f)).toHaveLength(records + 1);
  });

  it("answers a stale fingerprint on a movement with a preview, and the retry saves", async () => {
    const dryRun = await postMovementRest(f, f.source.id, lossBody(), randomUUID(), "?dryRun=true");
    const stale: string = (await dryRun.json()).basisFingerprint;
    expect((await postMovementRest(f, f.source.id, lossBody({ wetMassKg: LOSS_WET_KG }))).status).toBe(201);
    const key = randomUUID();
    const refusal = await expectProblem(await postMovementRest(f, f.source.id, lossBody({ basisFingerprint: stale }), key), 409, "stock_basis_changed");
    expect(refusal.preview.basisFingerprint).not.toBe(stale);
    expect(await ledger()).toHaveLength(1);
    const retry = await postMovementRest(f, f.source.id, lossBody({ basisFingerprint: refusal.preview.basisFingerprint }), key);
    expect(retry.status).toBe(201);
    expect(await ledger()).toHaveLength(2);
  });

  it("serializes a loss and a count on one bin into a continuous ledger", async () => {
    const responses = await race(f.source.id, [
      () => postMovementRest(f, f.source.id, lossBody({ wetMassKg: LOSS_WET_KG })),
      () => postMovementRest(f, f.source.id, countBody(COUNTED_WET_KG)),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const [first, second] = await ledger();
    expect(first.before).toBe(SOURCE_DRY_KG);
    expect(second.before).toBe(first.after);
    // Loss first leaves 1410 for the count to reset; count first leaves 900 for the loss to take 90 from.
    expect([first.after, second.after])
      .toEqual(first.kind === "loss" ? [SOURCE_DRY_KG - LOSS_DRY_KG, COUNTED_DRY_KG] : [COUNTED_DRY_KG, COUNTED_DRY_KG - LOSS_DRY_KG]);
    expect(await productWriteAudits(f, "movement")).toHaveLength(2);
  });

  it("serializes the UI's in-process posting and a REST posting on one bin", async () => {
    const [rest, ui] = await race<unknown>(f.source.id, [
      () => postMovementRest(f, f.source.id, lossBody({ wetMassKg: LOSS_WET_KG })),
      () => runOperationInProcess(recordOutputStockMovement, f.ctx, {
        storageLocationId: f.source.id, kind: "loss", occurredAt: WRITE_LOSS_AT, wetMassKg: LOSS_WET_KG,
        moisturePercent: 10, reason: "E2E UI loss", idempotencyKey: randomUUID(),
      }),
    ]);
    expect((rest as Response).status).toBe(201);
    expect(ui).toMatchObject({ movementId: expect.any(String) });
    const [first, second] = await ledger();
    expect([first.before, first.after, second.before, second.after]).toEqual([
      SOURCE_DRY_KG, SOURCE_DRY_KG - LOSS_DRY_KG, SOURCE_DRY_KG - LOSS_DRY_KG, SOURCE_DRY_KG - 2 * LOSS_DRY_KG,
    ]);
    // Only the REST posting is audited as an API write.
    expect(await productWriteAudits(f, "movement")).toHaveLength(1);
  });

  it("never leaves a product drawn from a run whose status change also committed", async () => {
    const runWriter = await createApiKey(f.ctx, { name: "Run writer", scopes: ["production-runs:read", "production-runs:write"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    const runRequest = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
      writeRequest(f, method, `/production-runs/${f.r1}`, body, headers, runWriter.key);
    const read = await GET_RUN(runRequest("GET"), { params: Promise.resolve({ idOrCode: f.r1 }) });
    expect(read.status).toBe(200);
    const etag = read.headers.get("etag")!;
    const [product, run] = await race(f.source.id, [
      () => postProductRest(f, pureProductBody(f)),
      () => PATCH_RUN(runRequest("PATCH", { status: "cancelled", cancellationReason: "E2E race", endTime: "2026-09-09T12:00:00Z" }, { "if-match": etag }),
        { params: Promise.resolve({ idOrCode: f.r1 }) }),
    ]);
    // Exactly one writer commits; the other is refused by a domain rule, never a server error.
    expect([product.status === 201, run.status === 200].filter(Boolean)).toHaveLength(1);
    const loser = product.status === 201 ? run : product;
    expect([409, 422]).toContain(loser.status);
    const state = await captureProductWriteState(f);
    const [row] = await db.select({ status: productionRuns.status }).from(productionRuns).where(eq(productionRuns.id, f.r1));
    if (product.status === 201) {
      expect(state.products).toHaveLength(1);
      expect(row.status).toBe("complete");
    } else {
      expect(state.products).toEqual([]);
      expect(row.status).toBe("cancelled");
    }
  });
});
