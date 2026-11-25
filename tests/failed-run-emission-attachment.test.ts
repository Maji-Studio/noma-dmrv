import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatchProductionRuns, creditBatchApplications, creditBatches, feedstocks, feedstockTypes, productionRuns, productionRunFeedstocks } from "@/db/schema";
import { loadBatchEmissionContributors, loadRunEmissionContributors } from "@/data-access/credit-batch-emission-contributors";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { failedRunFixture } from "./helpers/failed-run-fixture";

const ROLLBACK = new Error("rollback failed attachment fixture");
beforeAll(() => ensureTestOrg());
const ctx = makeTestOrgContext();

describe("computed failed emission attachment", () => {
  it.each([
    ["UTC", "2026-03-01T00:00:00Z", "2026-03-01"],
    ["UTC", "2026-03-31T23:59:59Z", "2026-03-31"],
    ["Africa/Dar_es_Salaam", "2026-02-28T22:00:00Z", "2026-03-01"],
    ["America/Los_Angeles", "2026-04-01T06:59:59Z", "2026-03-31"],
    ["America/Los_Angeles", "2026-03-08T10:00:00Z", "2026-03-08"],
  ])("uses inclusive facility end day in %s at %s", async (timezone, endTime, endDay) => {
    await expect(db.transaction(async tx => {
      const fixture = await failedRunFixture(tx, { timezone, endTime });
      const result = await loadBatchEmissionContributors(ctx, [fixture.batch!.id], tx);
      expect(result[fixture.batch!.id].materialMembers).toEqual([]);
      expect(result[fixture.batch!.id].failedContributors).toEqual([expect.objectContaining({ runId: fixture.run.id, endDay, creditBatchId: fixture.batch!.id })]);
      expect(await tx.select().from(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.organizationId, ctx.organizationId), eq(creditBatchProductionRuns.productionRunId, fixture.run.id)))).toEqual([]);
      expect(await tx.select().from(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, fixture.batch!.id)))).toEqual([]);
      expect(await loadRunEmissionContributors({ ...ctx, organizationId: crypto.randomUUID() }, [fixture.run.id], tx)).toEqual([]);
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  });

  it("resolves after later batch creation without changing the failed run", async () => {
    await expect(db.transaction(async tx => {
      const fixture = await failedRunFixture(tx, { batch: false });
      expect((await loadRunEmissionContributors(ctx, [fixture.run.id], tx))[0].unresolvedReason).toBe("no-batch");
      const [batch] = await tx.insert(creditBatches).values(fixture.batchValues).returning();
      expect((await loadRunEmissionContributors(ctx, [fixture.run.id], tx))[0]).toMatchObject({ creditBatchId: batch.id, version: fixture.run.version });
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  });

  it("deduplicates same-type draws and leaves mixed and empty provenance unresolved", async () => {
    await expect(db.transaction(async tx => {
      const fixture = await failedRunFixture(tx);
      const [stock] = await tx.insert(feedstocks).values({ ...fixture.stock, id: undefined, code: `FR-S2-${crypto.randomUUID()}` }).returning();
      await tx.insert(productionRunFeedstocks).values({ ...fixture.org, productionRunId: fixture.run.id, feedstockId: stock.id, wetMassUsedKg: 1 });
      expect((await loadRunEmissionContributors(ctx, [fixture.run.id, fixture.run.id], tx))).toHaveLength(1);
      const [type] = await tx.insert(feedstockTypes).values({ ...fixture.type, id: undefined, code: `FR-T2-${crypto.randomUUID()}` }).returning();
      await tx.update(feedstocks).set({ feedstockTypeId: type.id }).where(eq(feedstocks.id, stock.id));
      expect((await loadRunEmissionContributors(ctx, [fixture.run.id], tx))[0].unresolvedReason).toBe("mixed-feedstock");
      await tx.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, fixture.run.id));
      expect((await loadRunEmissionContributors(ctx, [fixture.run.id], tx))[0].unresolvedReason).toBe("empty-feedstock");
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  });
});

it("isolates facilities and types even when the same local window overlaps", async () => {
  await expect(db.transaction(async tx => {
    const a = await failedRunFixture(tx);
    const b = await failedRunFixture(tx);
    await tx.update(creditBatches).set({ feedstockTypeId: a.type.id }).where(eq(creditBatches.id, b.batch!.id));
    expect((await loadBatchEmissionContributors(ctx, [b.batch!.id], tx))[b.batch!.id].failedContributors).toEqual([]);
    await tx.update(creditBatches).set({ facilityId: a.facility.id, feedstockTypeId: b.type.id }).where(eq(creditBatches.id, b.batch!.id));
    expect((await loadBatchEmissionContributors(ctx, [b.batch!.id], tx))[b.batch!.id].failedContributors).toEqual([]);
    expect((await loadRunEmissionContributors(ctx, [a.run.id], tx))[0].creditBatchId).toBe(a.batch!.id);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});

it("uses the facility day independently of the process timezone", async () => {
  try {
    await expect(db.transaction(async tx => {
      const fixture = await failedRunFixture(tx, { timezone: "Africa/Dar_es_Salaam", endTime: "2026-02-28T22:00:00Z" });
      for (const timezone of ["Pacific/Honolulu", "Asia/Tokyo", "UTC"]) {
        vi.stubEnv("TZ", timezone);
        expect((await loadRunEmissionContributors(ctx, [fixture.run.id], tx))[0]).toMatchObject({ endDay: "2026-03-01", creditBatchId: fixture.batch!.id });
      }
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  } finally { vi.unstubAllEnvs(); }
});

it("fails closed on ambiguous active or archived-inclusive matches", async () => {
  await expect(db.transaction(async tx => {
    const fixture = await failedRunFixture(tx);
    const [overlap] = await tx.insert(creditBatches).values({ ...fixture.batchValues, code: `FR-OVERLAP-${crypto.randomUUID()}` }).returning();
    await expect(loadBatchEmissionContributors(ctx, [fixture.batch!.id], tx)).rejects.toThrow("matches multiple credit batches");
    await tx.update(creditBatches).set({ archivedAt: new Date("2026-04-01") }).where(eq(creditBatches.id, overlap.id));
    expect((await loadRunEmissionContributors(ctx, [fixture.run.id], tx))[0].creditBatchId).toBe(fixture.batch!.id);
    await expect(loadRunEmissionContributors(ctx, [fixture.run.id], tx, { includeArchived: true })).rejects.toThrow("matches multiple credit batches");
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});

it.each(["running", "cancelled"] as const)("excludes %s runs", async status => {
  await expect(db.transaction(async tx => {
    const fixture = await failedRunFixture(tx);
    await tx.update(productionRuns).set({ status, cancellationReason: status === "cancelled" ? "Recorded in error" : null }).where(eq(productionRuns.id, fixture.run.id));
    expect((await loadBatchEmissionContributors(ctx, [fixture.batch!.id], tx))[fixture.batch!.id].failedContributors).toEqual([]);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});
