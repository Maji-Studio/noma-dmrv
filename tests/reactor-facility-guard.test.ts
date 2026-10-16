import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { facilities, organizations, productionRuns, reactors } from "@/db/schema";
import { createProductionRunInTransaction } from "@/data-access/production-runs";
import { deleteReactor, updateReactor } from "@/data-access/reactors";
import { nextVersion } from "@/data-access/row-version";
import { makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";

const BARRIER_CONNECTIONS = 2;
let barrierPool: Pool;

beforeAll(() => { barrierPool = createTestPool(BARRIER_CONNECTIONS); });
afterAll(async () => {
  await barrierPool.end();
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];

async function fixture() {
  const tag = randomUUID();
  const ctx = { ...makeTestOrgContext(), organizationId: `reactor-move-${tag}` };
  await db.insert(organizations).values({ id: ctx.organizationId, name: "Reactor guard", slug: ctx.organizationId });
  const sites = await db.insert(facilities).values(["source", "destination"].map((name) => ({
    ...TEST_SITE_POSITION,
    organizationId: ctx.organizationId, name, code: name, timezone: "Africa/Dar_es_Salaam", country: "Tanzania",
  }))).returning();
  const [source, destination] = sites;
  const [reactor] = await db.insert(reactors).values({
    organizationId: ctx.organizationId, facilityId: source.id, code: "R-1", identifier: "Reactor", reactorType: "batch",
  }).returning();
  return { ctx, source, destination, reactor };
}

async function seed() {
  const value = await fixture();
  fixtures.push(value);
  return value;
}

afterEach(async () => {
  for (const { ctx } of fixtures.splice(0)) {
    for (const table of [productionRuns, reactors, facilities]) {
      await db.delete(table).where(eq(table.organizationId, ctx.organizationId));
    }
    await db.delete(organizations).where(eq(organizations.id, ctx.organizationId));
  }
});

describe("reactor facility changes", () => {
  it("allows moving an unused reactor", async () => {
    const { ctx, reactor, destination } = await seed();
    const moved = await updateReactor(ctx, reactor.id, { expectedVersion: reactor.version, facilityId: destination.id });
    expect(moved.facilityId).toBe(destination.id);
    expect(moved.version).toBeGreaterThan(reactor.version);
  });

  it.each(["running", "cancelled", "failed", "complete"] as const)("blocks a move with a %s production run but allows edits at the same facility", async (status) => {
    const { ctx, reactor, source, destination } = await seed();
    const startTime = new Date("2026-01-01T00:00:00Z");
    await db.insert(productionRuns).values({
      organizationId: ctx.organizationId, code: "PR-1", facilityId: source.id,
      reactorId: reactor.id, status, startTime,
      cancellationReason: status === "cancelled" ? "Recorded in error" : null,
      endTime: status === "running" ? null : new Date("2026-01-01T01:00:00Z"),
    });
    await expect(updateReactor(ctx, reactor.id, { expectedVersion: reactor.version, facilityId: destination.id }))
      .rejects.toThrow(/Cannot move a reactor with associated production runs/);
    await expect(deleteReactor(ctx, reactor.id, reactor.version)).rejects.toThrow(/associated production runs/);
    const edited = await updateReactor(ctx, reactor.id, {
      expectedVersion: reactor.version, facilityId: source.id, identifier: "Renamed reactor",
    });
    expect(edited.facilityId).toBe(source.id);
    expect(edited.identifier).toBe("Renamed reactor");
  });

  it("waits for a run's reactor share lock, then rejects the move after the run commits", async () => {
    const { ctx, reactor, source, destination } = await seed();
    const barrier = await openOperationBarrier(barrierPool);
    let move: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await barrier.tx.select({ id: reactors.id }).from(reactors)
        .where(and(eq(reactors.id, reactor.id), eq(reactors.organizationId, ctx.organizationId))).for("share");
      move = Promise.allSettled([
        updateReactor(ctx, reactor.id, { expectedVersion: reactor.version, facilityId: destination.id }),
      ]);
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      await createProductionRunInTransaction(ctx, barrier.tx, {
        code: "PR-RACE", reactorId: reactor.id, facilityId: source.id,
        startTime: new Date("2026-01-01T00:00:00Z"), endTime: null,
      });
      // The move still cannot acquire the reactor until the run commits.
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      await barrier.commit();
      expect((await move)[0]).toMatchObject({
        status: "rejected", reason: { message: expect.stringContaining("associated production runs") },
      });
      const [saved] = await db.select().from(reactors)
        .where(and(eq(reactors.id, reactor.id), eq(reactors.organizationId, ctx.organizationId)));
      const runs = await db.select().from(productionRuns).where(eq(productionRuns.organizationId, ctx.organizationId));
      expect(saved.facilityId).toBe(source.id);
      expect(runs).toMatchObject([{ facilityId: source.id, reactorId: reactor.id }]);
    } finally {
      await barrier.rollback();
      await move;
    }
  });

  it("waits for an uncommitted reactor move, then rejects the run at the old facility", async () => {
    const { ctx, reactor, source, destination } = await seed();
    const barrier = await openOperationBarrier(barrierPool);
    let creation: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await barrier.tx.select({ id: reactors.id }).from(reactors)
        .where(and(eq(reactors.id, reactor.id), eq(reactors.organizationId, ctx.organizationId))).for("update");
      await barrier.tx.update(reactors).set({ facilityId: destination.id, version: nextVersion(reactors.version) })
        .where(and(eq(reactors.id, reactor.id), eq(reactors.organizationId, ctx.organizationId)));
      creation = Promise.allSettled([
        db.transaction((tx) => createProductionRunInTransaction(ctx, tx, {
          code: "PR-RACE", reactorId: reactor.id, facilityId: source.id,
          startTime: new Date("2026-01-01T00:00:00Z"), endTime: null,
        })),
      ]);
      // The unlocked preflight sees the source facility; the locked recheck waits.
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      await barrier.commit();
      expect((await creation)[0]).toMatchObject({
        status: "rejected", reason: { message: "Reactor does not belong to the selected facility" },
      });
      const [saved] = await db.select().from(reactors)
        .where(and(eq(reactors.id, reactor.id), eq(reactors.organizationId, ctx.organizationId)));
      expect(saved.facilityId).toBe(destination.id);
      expect(await db.select().from(productionRuns).where(eq(productionRuns.organizationId, ctx.organizationId))).toEqual([]);
    } finally {
      await barrier.rollback();
      await creation;
    }
  });

  it("does not allow a foreign organization to move the reactor", async () => {
    const { ctx, reactor, destination } = await seed();
    await expect(updateReactor({ ...ctx, organizationId: `foreign-${randomUUID()}` }, reactor.id, {
      expectedVersion: reactor.version, facilityId: destination.id,
    })).rejects.toThrow();
  });
});
