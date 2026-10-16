import { and, eq } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { db } from "@/db";
import { documents, productionRunReadings, productionRuns } from "@/db/schema";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { buildEntityReadinessResult } from "@/fn/certification/certify-readiness-gaps";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const RUN_END = new Date("2026-06-13T12:00:00Z");

beforeAll(() => ensureTestOrg());

it("requires only uploaded sensor-data CSV evidence with zero parsed readings", async () => {
  await withLineageFixture(async (fixture) => {
    const runScope = and(
      eq(productionRuns.organizationId, ctx.organizationId),
      eq(productionRuns.id, fixture.productionRunId),
    );
    const documentScope = and(
      eq(documents.organizationId, ctx.organizationId),
      eq(documents.entityId, fixture.productionRunId),
    );
    const readingsScope = and(
      eq(productionRunReadings.organizationId, ctx.organizationId),
      eq(productionRunReadings.productionRunId, fixture.productionRunId),
    );
    await db.update(productionRuns).set({
      status: "complete",
      endTime: RUN_END,
      dieselOperationLiters: 0,
      dieselGensetLiters: 0,
      preprocessingFuelLiters: 0,
      electricityKwh: 0,
    }).where(runScope);

    async function assertReadiness(hasReadingsFile: boolean) {
      const runs = await getProductionRunsForCertification(ctx, [fixture.productionRunId]);
      expect(runs).toHaveLength(1);
      expect(runs[0].hasReadingsFile).toBe(hasReadingsFile);
      expect(deriveEntityCertifyReadiness("productionRun", runs[0])).toMatchObject({
        state: hasReadingsFile ? "ready" : "incomplete",
        gaps: hasReadingsFile ? [] : [expect.objectContaining({ key: "hasReadingsFile" })],
      });
      expect(buildEntityReadinessResult(
        runs, [], { feedstock: [], biochar: [], sample: [] }, [],
      ).gaps).toEqual(hasReadingsFile ? [] : [
        `Production run ${runs[0].code}: Readings CSV file`,
      ]);
    }

    try {
      await assertReadiness(false);
      await db.insert(documents).values({
        organizationId: ctx.organizationId,
        entityType: "production_run",
        entityId: fixture.productionRunId,
        documentType: "sensor_data",
        fileName: "pressure-original.csv",
        mimeType: "text/csv",
        storageProvider: "local-fs",
        storageBucket: "local",
        storageKey: `test-readings/${fixture.productionRunId}/pressure-original.csv`,
        fileUrl: "https://example.test/pressure-original.csv",
        uploadStatus: "pending",
      });
      await assertReadiness(false);
      await db.update(documents).set({ uploadStatus: "failed" }).where(documentScope);
      await assertReadiness(false);
      await db.update(documents).set({ uploadStatus: "uploaded" }).where(documentScope);
      await assertReadiness(true);

      expect(await db.select({ id: productionRunReadings.id }).from(productionRunReadings).where(readingsScope)).toEqual([]);

      await db.update(documents).set({ documentType: "calibration_certificate" }).where(documentScope);
      await assertReadiness(false);
      await db.update(documents).set({ documentType: "sensor_data", entityType: "reactor" }).where(documentScope);
      await assertReadiness(false);
      await db.update(documents).set({ entityType: "production_run", fileName: "pressure.pdf" }).where(documentScope);
      await assertReadiness(false);
      await db.delete(documents).where(documentScope);
      await db.insert(productionRunReadings).values({
        organizationId: ctx.organizationId,
        productionRunId: fixture.productionRunId,
        timestamp: RUN_END,
        temperatureC: 500,
        pressureBar: 0.9,
      });
      // Even populated structured readings cannot substitute for the file.
      await assertReadiness(false);
    } finally {
      await db.delete(documents).where(documentScope);
      await db.delete(productionRunReadings).where(readingsScope);
    }
  }, "none");
});
