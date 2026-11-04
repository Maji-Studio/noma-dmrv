import { randomUUID } from "node:crypto";
import { TransactionRollbackError, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, type DbTransaction } from "@/db";
import { facilities, productionRuns, reactors, storageLocations } from "@/db/schema";
import { ensureTestOrg, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

const COMPLETE_OUTPUT_CONSTRAINT = "production_runs_complete_has_output";
const OUTPUT_WET_KG = 100;
const OUTPUT_MOISTURE_PERCENT = 5;
const START_TIME = new Date("2026-10-06T10:00:00Z");
const END_TIME = new Date("2026-10-06T11:00:00Z");
type RunValues = typeof productionRuns.$inferInsert;

/** Direct writes exercise the database guard without application validation. */
async function withRunFixture(assert: (tx: DbTransaction, values: RunValues) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await ensureTestOrg(tx);
      const tag = randomUUID();
      const [facility] = await tx.insert(facilities).values({
        ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, timezone: "UTC",
        code: `FAC-CHECK-${tag}`, name: "Production run check fixture",
      }).returning();
      const [reactor] = await tx.insert(reactors).values({
        organizationId: TEST_ORG_ID, facilityId: facility.id,
        code: `RE-CHECK-${tag}`, identifier: `Check reactor ${tag}`, reactorType: "auger",
      }).returning();
      const [bin] = await tx.insert(storageLocations).values({
        organizationId: TEST_ORG_ID, facilityId: facility.id,
        code: `BIN-CHECK-${tag}`, name: "Check output bin", type: "biochar_bin",
      }).returning();
      await assert(tx, {
        organizationId: TEST_ORG_ID, facilityId: facility.id, reactorId: reactor.id,
        code: `PR-CHECK-${tag}`, status: "complete", startTime: START_TIME, endTime: END_TIME,
        biocharOutputKg: OUTPUT_WET_KG, biocharMoisturePercent: OUTPUT_MOISTURE_PERCENT,
        biocharStorageLocationId: bin.id,
      });
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

describe("production_runs complete output check constraint", () => {
  it.each([undefined, null])("refuses a complete run without moisture: %s", async (moisture) => {
    await expect(withRunFixture(async (tx, values) => {
      await tx.insert(productionRuns).values({ ...values, biocharMoisturePercent: moisture });
    })).rejects.toMatchObject({ cause: { code: "23514", constraint: COMPLETE_OUTPUT_CONSTRAINT } });
  });

  it.each([0, OUTPUT_MOISTURE_PERCENT])("accepts a complete run with output, bin and moisture: %s", async (moisture) => {
    await withRunFixture(async (tx, values) => {
      const [saved] = await tx.insert(productionRuns).values({ ...values, biocharMoisturePercent: moisture }).returning();
      expect(saved).toMatchObject({
        status: "complete", biocharOutputKg: OUTPUT_WET_KG,
        biocharMoisturePercent: moisture, biocharStorageLocationId: values.biocharStorageLocationId,
      });
    });
  });

  it("accepts a running run without moisture, output or bin", async () => {
    await withRunFixture(async (tx, values) => {
      const [saved] = await tx.insert(productionRuns).values({
        ...values, status: "running", endTime: null,
        biocharMoisturePercent: null, biocharOutputKg: null, biocharStorageLocationId: null,
      }).returning();
      expect(saved).toMatchObject({ status: "running", biocharMoisturePercent: null });
    });
  });

  it.each([
    // A CHECK passes when it evaluates to null, so a null output needs its own `is not null`.
    { biocharOutputKg: null },
    { biocharOutputKg: 0 },
    { biocharOutputKg: -1 },
    { biocharStorageLocationId: null },
  ])("refuses a complete run with invalid output: %j", async (patch) => {
    await expect(withRunFixture(async (tx, values) => {
      await tx.insert(productionRuns).values({ ...values, ...patch });
    })).rejects.toMatchObject({ cause: { code: "23514", constraint: COMPLETE_OUTPUT_CONSTRAINT } });
  });

  it("refuses clearing moisture on an existing complete run", async () => {
    await expect(withRunFixture(async (tx, values) => {
      const [saved] = await tx.insert(productionRuns).values(values).returning();
      await tx.update(productionRuns).set({ biocharMoisturePercent: null }).where(eq(productionRuns.id, saved.id));
    })).rejects.toMatchObject({ cause: { code: "23514", constraint: COMPLETE_OUTPUT_CONSTRAINT } });
  });
});
