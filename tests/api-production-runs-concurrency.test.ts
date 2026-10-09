import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiIdempotencyRecords, productionRuns } from "@/db/schema";
import { IDEMPOTENCY_RETRY_AFTER_SECONDS } from "@/config/operations";
import { lockBinStock } from "@/data-access/lock-bin-stocks";
import { GET as LIST } from "@/app/api/v1/production-runs/route";
import { addFixtureReactor, createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import {
  binWetStock, createApiProductionRunFixture, removeApiFeedstockFixture, seedApiFeedstock, patchFeedstock,
  readFeedstock, productionRunInput, productionRunRequest, expectFeedstockProblem as problem, type ApiProductionRunFixture,
} from "./helpers/api-feedstock-fixture";
import {
  postProductionRun, seedApiProductionRun, patchProductionRun, readProductionRun, getProductionRun,
  captureProductionRunState, productionRunAudits, completionPatch, RUN_INTAKE_WET_KG, RUN_DRAW_WET_KG,
} from "./helpers/api-production-run-fixture";

const poolEnv = vi.hoisted(() => {
  const original = { max: process.env.DB_POOL_MAX, lockTimeout: process.env.DB_POOL_LOCK_TIMEOUT_MS };
  process.env.DB_POOL_MAX = "4";
  process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000";
  return original;
});
const TIMEOUT_MS = 30_000;
const BARRIER_CONNECTIONS = 2;
const CONCURRENT_WRITERS = 2;
const RACE_INTAKE_KG = 100;
const RACE_DRAW_KG = 80;
const REDUCED_INTAKE_KG = 60;
const SAFE_REDUCED_INTAKE_KG = 4000;
const REPLACEMENT_DRAW_KG = 600;
let fixture: ApiProductionRunFixture;
let barrierPool: Pool;
beforeAll(() => { barrierPool = createTestPool(BARRIER_CONNECTIONS); });
beforeEach(async () => { fixture = await createApiProductionRunFixture("run-race"); });
afterEach(async () => { vi.restoreAllMocks(); await removeApiFeedstockFixture(fixture); });
afterAll(async () => {
  await barrierPool.end();
  if (poolEnv.max === undefined) delete process.env.DB_POOL_MAX;
  else process.env.DB_POOL_MAX = poolEnv.max;
  if (poolEnv.lockTimeout === undefined) delete process.env.DB_POOL_LOCK_TIMEOUT_MS;
  else process.env.DB_POOL_LOCK_TIMEOUT_MS = poolEnv.lockTimeout;
});

/** Start both writers while a separate transaction holds their shared bin. */
async function race(writers: (() => Promise<Response>)[]) {
  const barrier = await openOperationBarrier(barrierPool);
  const pending: Promise<Response>[] = [];
  try {
    await lockBinStock(fixture.ctx, barrier.tx, fixture.binId);
    pending.push(...writers.map((writer) => writer()));
    const pids = await waitForBlockedOperations(barrierPool, barrier.pid, CONCURRENT_WRITERS);
    expect(new Set(pids).size).toBe(CONCURRENT_WRITERS);
    await barrier.commit();
    return await Promise.all(pending);
  } finally {
    await barrier.rollback();
    await Promise.allSettled(pending);
  }
}

describe("production run REST stock races", { timeout: TIMEOUT_MS }, () => {
  it("refuses the held duplicate, then replays exactly one run, draw, allocation, stock effect and audit", async () => {
    await seedApiFeedstock(fixture, RUN_INTAKE_WET_KG);
    const key = randomUUID();
    const input = productionRunInput(fixture);
    const barrier = await openOperationBarrier(barrierPool);
    let first: Promise<Response> | undefined;
    let originalText: string;
    let originalEtag: string | null;
    try {
      await lockBinStock(fixture.ctx, barrier.tx, fixture.binId);
      first = postProductionRun(fixture, input, key);
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      const duplicate = await postProductionRun(fixture, input, key);
      expect(await problem(duplicate, 409, "idempotency_in_progress")).toMatchObject({ retryable: true });
      expect(duplicate.headers.get("retry-after")).toBe(String(IDEMPOTENCY_RETRY_AFTER_SECONDS));
      expect((await captureProductionRunState(fixture)).runs).toEqual([]);
      expect(await binWetStock(fixture)).toBe(RUN_INTAKE_WET_KG);
      await barrier.commit();
      const original = await first;
      expect(original.status).toBe(201);
      expect(original.headers.get("idempotent-replayed")).toBeNull();
      originalText = await original.text(); originalEtag = original.headers.get("etag");
    } finally {
      await barrier.rollback();
      if (first) await Promise.allSettled([first]);
    }
    const replay = await postProductionRun(fixture, input, key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(originalEtag);
    expect(await replay.text()).toBe(originalText);
    const state = await captureProductionRunState(fixture);
    expect(state.runs).toHaveLength(1);
    expect(state.draws).toHaveLength(1);
    expect(state.allocations).toHaveLength(1);
    expect(state.draws[0]).toMatchObject({ productionRunId: state.runs[0].id, wetMassKg: RUN_DRAW_WET_KG });
    expect(state.wetStock).toBe(RUN_INTAKE_WET_KG - RUN_DRAW_WET_KG);
    expect(await productionRunAudits(fixture)).toMatchObject([{ operationId: "start_production_run", outcomeCode: "created" }]);
    expect(await productionRunAudits(fixture)).toHaveLength(1);
    const records = await db.select().from(apiIdempotencyRecords).where(and(
      eq(apiIdempotencyRecords.organizationId, fixture.ctx.organizationId),
      eq(apiIdempotencyRecords.credentialId, fixture.credentialId), eq(apiIdempotencyRecords.operationId, "start_production_run"),
    ));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ idempotencyKey: key });
    expect(records[0].outcome).not.toBeNull();
  });

  it("refuses one of a bin draw and an intake reduction rather than committing negative stock", async () => {
    const intake = await seedApiFeedstock(fixture, RACE_INTAKE_KG);
    const responses = await race([
      () => postProductionRun(fixture, { ...productionRunInput(fixture), feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: RACE_DRAW_KG }] }),
      () => patchFeedstock(fixture, intake.row, intake.etag, { massWetKg: REDUCED_INTAKE_KG }),
    ]);
    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    const loser = responses.find((response) => !response.ok)!;
    // Draw validation and intake stock protection retain their established codes.
    await problem(loser, 409, "insufficient_stock");
    const state = await captureProductionRunState(fixture);
    const currentIntake = await readFeedstock(fixture, intake.row.id);
    if (responses[0].ok) {
      expect(currentIntake.row).toEqual(intake.row);
      expect(state.runs).toHaveLength(1); expect(state.draws).toHaveLength(1); expect(state.allocations).toHaveLength(1);
      expect(state.wetStock).toBe(RACE_INTAKE_KG - RACE_DRAW_KG);
    } else {
      expect(currentIntake.row).toMatchObject({ massWetKg: REDUCED_INTAKE_KG, version: intake.row.version + 1 });
      expect(state.runs).toEqual([]); expect(state.draws).toEqual([]); expect(state.allocations).toEqual([]);
      expect(state.wetStock).toBe(REDUCED_INTAKE_KG);
    }
    expect(state.wetStock).toBeGreaterThanOrEqual(0);
  });

  it("allows exactly one of two different reactors to draw the last stock from a bin", async () => {
    await seedApiFeedstock(fixture, RACE_INTAKE_KG);
    const otherReactorId = await addFixtureReactor(fixture, "race-second");
    const draw = [{ storageLocationId: fixture.binId, wetMassKg: RACE_INTAKE_KG }];
    const responses = await race([fixture.reactorId, otherReactorId].map((reactorId) =>
      () => postProductionRun(fixture, { ...productionRunInput(fixture), reactorId, feedstockDraws: draw })));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const shortage = await problem(responses.find((response) => response.status !== 201)!, 409, "insufficient_stock");
    expect(shortage.errors).toContainEqual(expect.objectContaining({ pointer: "/feedstockDraws/0/storageLocationId",
      meta: { storageLocationId: fixture.binId, availableWetKg: 0, requestedWetKg: RACE_INTAKE_KG, unit: "kg" } }));
    const state = await captureProductionRunState(fixture);
    expect(state.runs).toHaveLength(1); expect(state.draws).toHaveLength(1); expect(state.allocations).toHaveLength(1);
    expect(state.draws[0]).toMatchObject({ wetMassKg: RACE_INTAKE_KG });
    expect(state.wetStock).toBe(0);
    expect(await productionRunAudits(fixture)).toHaveLength(1);
  });

  it("finishes a run status change and an edit of its drawn feedstock without a deadlock (40P01)", async () => {
    const intake = await seedApiFeedstock(fixture, RUN_INTAKE_WET_KG);
    const saved = await seedApiProductionRun(fixture);
    const responses = await race([
      () => patchProductionRun(fixture, saved.row, saved.etag, completionPatch(fixture)),
      () => patchFeedstock(fixture, intake.row, intake.etag, { massWetKg: SAFE_REDUCED_INTAKE_KG }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200); // A mapped 40P01 or other transaction failure fails this assertion.
      expect(await response.json()).not.toHaveProperty("code");
    }
    expect((await readProductionRun(fixture, saved.row.id)).row).toMatchObject({ status: "complete", version: saved.row.version + 1 });
    expect((await readFeedstock(fixture, intake.row.id)).row).toMatchObject({ massWetKg: SAFE_REDUCED_INTAKE_KG, version: intake.row.version + 1 });
    expect(await binWetStock(fixture)).toBe(SAFE_REDUCED_INTAKE_KG - RUN_DRAW_WET_KG);
  });
});

/** Pause after a real SELECT has materialized its rows, before its reader resumes. */
function pauseQuery<T extends object>(builder: T, pause: () => Promise<void>): T {
  return new Proxy(builder, {
    get(target, key, receiver) {
      if (key === "then") return async (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) => {
        try {
          const rows = await (target as unknown as PromiseLike<unknown>);
          await pause();
          return resolve(rows);
        } catch (error) { return reject(error); }
      };
      const member = Reflect.get(target, key, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(member, target, args);
        return result && typeof result === "object" ? pauseQuery(result, pause) : result;
      };
    },
  });
}

describe("production run read snapshot regression", { timeout: TIMEOUT_MS }, () => {
  it.each(["get", "list", "stale-current"] as const)("%s cannot combine an old version with newly replaced draws", async (kind) => {
    await seedApiFeedstock(fixture, RUN_INTAKE_WET_KG);
    const saved = await seedApiProductionRun(fixture);
    // For 412, advance the version first so the request definitely reaches current.
    const before = kind === "stale-current"
      ? await (async () => {
        expect((await patchProductionRun(fixture, saved.row, saved.etag, { feedingRateKgHr: REPLACEMENT_DRAW_KG })).status).toBe(200);
        return readProductionRun(fixture, saved.row.id);
      })() : saved;
    let reached!: () => void;
    let release!: () => void;
    const materialized = new Promise<void>((resolve) => { reached = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const select = db.select.bind(db);
    let armed = true;
    vi.spyOn(db, "select").mockImplementation((fields) => {
      const builder = select(fields);
      if (armed && fields?.startTime === productionRuns.startTime && fields?.version === productionRuns.version) {
        armed = false;
        return pauseQuery(builder, async () => { reached(); await resume; });
      }
      return builder;
    });
    const pending = kind === "list" ? LIST(productionRunRequest(fixture, "GET"))
      : kind === "get" ? getProductionRun(fixture, saved.row.id)
        : patchProductionRun(fixture, saved.row, saved.etag, {});
    try {
      await materialized;
      const response = await patchProductionRun(fixture, before.row, before.etag,
        { feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: REPLACEMENT_DRAW_KG }] });
      expect(response.status).toBe(200);
      const current = (await response.json()).data;
      expect(current.version).toBe(before.row.version + 1);
      release();
      const read = await pending;
      expect(read.status).toBe(kind === "stale-current" ? 412 : 200);
      const body = await read.json();
      const observed = kind === "list" ? body.data[0] : kind === "stale-current" ? body.current : body.data;
      expect(observed.version).toBe(before.row.version);
      expect(observed.feedstockDraws).toEqual(before.row.feedstockDraws);
      expect(current.feedstockDraws).toEqual([{ storageLocationId: fixture.binId, wetMassKg: REPLACEMENT_DRAW_KG }]);
    } finally {
      release();
      await Promise.allSettled([pending]);
      vi.restoreAllMocks();
    }
    expect((await readProductionRun(fixture, saved.row.id)).row.feedstockDraws).toEqual([
      { storageLocationId: fixture.binId, wetMassKg: REPLACEMENT_DRAW_KG },
    ]);
  });
});
