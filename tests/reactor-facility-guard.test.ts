import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, organizations, productionRuns, reactors } from "@/db/schema";
import { createProductionRunInTransaction } from "@/data-access/production-runs";
import { deleteReactor, updateReactor } from "@/data-access/reactors";
import { makeTestOrgContext } from "./helpers/test-org";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];

async function fixture() {
  const tag = randomUUID();
  const ctx = { ...makeTestOrgContext(), organizationId: `reactor-move-${tag}` };
  await db.insert(organizations).values({ id: ctx.organizationId, name: "Reactor guard", slug: ctx.organizationId });
  const sites = await db.insert(facilities).values(["source", "destination"].map((name) => ({
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

  it("serializes a move against concurrent production-run creation", async () => {
    const { ctx, reactor, source, destination } = await seed();
    const results = await Promise.allSettled([
      updateReactor(ctx, reactor.id, { expectedVersion: reactor.version, facilityId: destination.id }),
      db.transaction((tx) => createProductionRunInTransaction(ctx, tx, {
        code: "PR-RACE", reactorId: reactor.id, facilityId: source.id,
        startTime: new Date("2026-01-01T00:00:00Z"), endTime: null,
      })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [saved] = await db.select().from(reactors).where(eq(reactors.id, reactor.id));
    const runs = await db.select().from(productionRuns).where(eq(productionRuns.organizationId, ctx.organizationId));
    for (const run of runs) expect(run.facilityId).toBe(saved.facilityId);
  });

  it("does not allow a foreign organization to move the reactor", async () => {
    const { ctx, reactor, destination } = await seed();
    await expect(updateReactor({ ...ctx, organizationId: `foreign-${randomUUID()}` }, reactor.id, {
      expectedVersion: reactor.version, facilityId: destination.id,
    })).rejects.toThrow();
  });
});
