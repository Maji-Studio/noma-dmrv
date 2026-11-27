import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedstocks, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns } from "@/db/schema";
import { withLineageFixture, type LineageFixture } from "./certification-lineage-fixture";
import { TEST_ORG_ID } from "./test-org";

export const FAILED_START = new Date("2026-06-14T08:00:00Z");
export const FAILED_END = new Date("2026-06-14T12:00:00Z");
const MATERIAL_END = new Date("2026-06-13T12:00:00Z");
const INTAKE_WET_KG = 2_000;
const INTAKE_DRY_KG = 1_800;
const DRAW_WET_KG = 100;
const DRAW_DRY_KG = 90;

/** Keeps a complete material lineage and adds an independent emissions-only source. */
export async function withFailedRunLineage(
  work: (fixture: LineageFixture, run: typeof productionRuns.$inferSelect) => Promise<void>,
  holder: "none" | "removal" | "ghgStatement" = "removal",
) {
  await withLineageFixture(async fixture => {
    await db.update(productionRuns).set({ status: "complete", endTime: MATERIAL_END, outputPostedAt: MATERIAL_END })
      .where(eq(productionRuns.id, fixture.productionRunId));
    await db.update(feedstocks).set({ massWetKg: INTAKE_WET_KG, massDryKg: INTAKE_DRY_KG })
      .where(eq(feedstocks.id, fixture.feedstockId));
    const [run] = await db.insert(productionRuns).values({
      organizationId: TEST_ORG_ID, facilityId: fixture.facilityId, reactorId: fixture.reactorId,
      code: `E2E-FAILED-${crypto.randomUUID()}`, status: "failed", startTime: FAILED_START, endTime: FAILED_END,
      feedstockWetMassKg: DRAW_WET_KG, feedstockMassDryKg: DRAW_DRY_KG, feedstockMoisturePercent: 10,
      dieselOperationLiters: 2, electricityKwh: 3,
    }).returning();
    await db.insert(productionRunFeedstockDraws).values({ organizationId: TEST_ORG_ID,
      productionRunId: run.id, storageLocationId: fixture.feedstockBinId, wetMassKg: DRAW_WET_KG });
    await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
      productionRunId: run.id, feedstockId: fixture.feedstockId, wetMassUsedKg: DRAW_WET_KG });
    try { await work(fixture, run); }
    finally {
      await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, run.id));
      await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, run.id));
      await db.delete(productionRuns).where(eq(productionRuns.id, run.id));
    }
  }, holder);
}
