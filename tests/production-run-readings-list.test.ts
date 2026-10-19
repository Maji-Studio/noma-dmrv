import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { PRODUCTION_RUN_READINGS_LIMIT } from "@/config/production-run-readings";
import { getProductionRunReadingsList } from "@/data-access/production-run-readings";
import { db } from "@/db";
import { facilities, organizations, productionRunReadings, productionRuns, reactors } from "@/db/schema";
import { getProductionRunReadingsListFn } from "@/fn/production-run-readings";
import { requireOrgContext } from "@/lib/auth/server";
import { makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

vi.mock("@/lib/auth/server", async (original) => ({
  ...await original<typeof import("@/lib/auth/server")>(),
  requireOrgContext: vi.fn(),
}));

const START = new Date("2026-10-01T08:00:00Z");
const READING_INTERVAL_MS = 1_000;

it("bounds org-scoped readings in stable newest-first order and signals truncation", async () => {
  const organizationIds = [randomUUID(), randomUUID()];
  const ctx = { ...makeTestOrgContext(), organizationId: organizationIds[0] };
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  try {
    await db.insert(organizations).values(organizationIds.map((id) => ({
      id, name: "Readings list test", slug: id,
    })));
    async function createRun(organizationId: string) {
      const [facility] = await db.insert(facilities).values({
        ...TEST_SITE_POSITION, timezone: "UTC", organizationId,
        code: randomUUID(), name: `Readings list ${randomUUID()}`,
      }).returning();
      const [reactor] = await db.insert(reactors).values({
        organizationId, facilityId: facility.id, code: randomUUID(),
        identifier: "Readings list test", reactorType: "batch",
      }).returning();
      const [run] = await db.insert(productionRuns).values({
        organizationId, facilityId: facility.id, reactorId: reactor.id,
        code: randomUUID(), startTime: START,
      }).returning();
      return run;
    }
    const run = await createRun(ctx.organizationId);
    const tiedRun = await createRun(ctx.organizationId);
    const foreignRun = await createRun(organizationIds[1]);
    const rows = Array.from({ length: PRODUCTION_RUN_READINGS_LIMIT + 1 }, (_, index) => ({
      id: randomUUID(), organizationId: ctx.organizationId, productionRunId: run.id,
      timestamp: new Date(START.getTime() + index * READING_INTERVAL_MS),
    }));
    await db.insert(productionRunReadings).values(rows);
    // Equal timestamps across runs exercise the ID tie-breaker. Insert the
    // smaller ID first so timestamp-only ordering cannot satisfy the contract.
    const tiedTime = new Date("2026-10-02T08:00:00Z");
    const lowerId = "00000000-0000-4000-8000-000000000001";
    const higherId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await db.insert(productionRunReadings).values([
      { id: lowerId, organizationId: ctx.organizationId, productionRunId: run.id, timestamp: tiedTime },
      { id: higherId, organizationId: ctx.organizationId, productionRunId: tiedRun.id, timestamp: tiedTime },
      { organizationId: organizationIds[1], productionRunId: foreignRun.id, timestamp: new Date("2026-10-03T08:00:00Z") },
    ]);

    const result = await getProductionRunReadingsList(ctx);
    expect(result.readings).toHaveLength(PRODUCTION_RUN_READINGS_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.readings.map((row) => row.id)).toEqual([
      higherId, lowerId, ...[...rows].reverse().slice(0, PRODUCTION_RUN_READINGS_LIMIT - 2).map((row) => row.id),
    ]);
    expect(await getProductionRunReadingsList(ctx)).toEqual(result);

    const filtered = await getProductionRunReadingsList(ctx, run.id, run.facilityId);
    expect(filtered.readings).toHaveLength(PRODUCTION_RUN_READINGS_LIMIT);
    expect(filtered.truncated).toBe(true);
    expect(filtered.readings.every((row) => row.productionRunId === run.id)).toBe(true);
    expect(await getProductionRunReadingsList(ctx, undefined, run.facilityId)).toEqual(filtered);
    expect(await getProductionRunReadingsListFn(run.id, run.facilityId)).toEqual({ success: true, data: filtered });
    expect(await getProductionRunReadingsList(ctx, foreignRun.id)).toEqual({ readings: [], truncated: false });
    expect(await getProductionRunReadingsList(ctx, undefined, foreignRun.facilityId)).toEqual({ readings: [], truncated: false });

    await db.delete(productionRunReadings).where(eq(productionRunReadings.id, lowerId));
    await db.delete(productionRunReadings).where(eq(productionRunReadings.id, rows[0].id));
    const exact = await getProductionRunReadingsList(ctx, run.id);
    expect(exact.readings).toHaveLength(PRODUCTION_RUN_READINGS_LIMIT);
    expect(exact.truncated).toBe(false);
    expect(await getProductionRunReadingsList(ctx, tiedRun.id)).toMatchObject({
      readings: [{ id: higherId }], truncated: false,
    });
  } finally {
    await db.delete(productionRunReadings).where(inArray(productionRunReadings.organizationId, organizationIds));
    await db.delete(productionRuns).where(inArray(productionRuns.organizationId, organizationIds));
    await db.delete(reactors).where(inArray(reactors.organizationId, organizationIds));
    await db.delete(facilities).where(inArray(facilities.organizationId, organizationIds));
    await db.delete(organizations).where(inArray(organizations.id, organizationIds));
  }
});
