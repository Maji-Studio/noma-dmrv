/**
 * Application evidence must remain independent from certification readiness.
 *
 * Application records can retain supporting files for verification, but the
 * active protocol does not make a typed Application mass record a Removal gate.
 * This flow guards that invariant for an Application carrying zero evidence
 * documents: both the Removal checklist and the applications list must still
 * read Ready.
 */
import { and, eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import * as schema from "../../src/db/schema";
import { test, expect, type SeededChainData } from "./fixtures";
import {
  type SeededReadyBatch,
  seedUngroupedReadyBatchWithChain,
} from "./fixtures/certification-helpers";
import { createDbConnection } from "./fixtures/db";
import type { GisBoundary } from "../../src/schemas/gis-boundary";

const COLD_COMPILE_TIMEOUT_MS = 30_000;
const GIS_BOUNDARY: GisBoundary = {
  version: 1,
  source: "paste",
  fileName: null,
  capturedAt: "2026-07-28T08:00:00.000Z",
  collection: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "E2E readiness area" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [39.27, -6.81],
              [39.29, -6.81],
              [39.29, -6.79],
              [39.27, -6.79],
              [39.27, -6.81],
            ],
          ],
        },
      },
    ],
    bbox: [39.27, -6.81, 39.29, -6.79],
  },
  stats: {
    features: 1,
    vertices: 5,
    areaHectares: 488.96,
    bbox: [39.27, -6.81, 39.29, -6.79],
    center: [39.28, -6.8],
  },
  notes: [],
};

function chainRefs(seededData: SeededChainData) {
  return {
    facilityId: seededData.facility.id,
    reactorId: seededData.reactor.id,
    formulationId: seededData.formulation.id,
    feedstockId: seededData.feedstock.id,
    feedstockStorageLocationId: seededData.feedstockStorageLocation.id,
    biocharStorageLocationId: seededData.biocharStorageLocation.id,
    productStorageLocationId: seededData.productStorageLocation.id,
    customerId: seededData.customer.id,
    customerLocationId: seededData.customerLocation.id,
    vehicleId: seededData.vehicle.id,
  };
}

/**
 * Strip every evidence document from the Application and put it on the boundary
 * method with a valid GIS reference. Under the current rule the GIS reference is
 * the whole boundary requirement, so this leaves an Application that is fully
 * ready while holding zero evidence files.
 */
async function clearEvidenceDocumentsAndSetBoundary(
  batch: SeededReadyBatch,
): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.documents)
        .where(
          and(
            eq(schema.documents.entityType, "application"),
            eq(schema.documents.entityId, batch.applicationId),
          ),
        );
      await tx
        .update(schema.applications)
        .set({
          evidenceMethod: "boundary",
          gisBoundary: GIS_BOUNDARY,
        })
        .where(eq(schema.applications.id, batch.applicationId));
    });
  } finally {
    await pool.end();
  }
}

async function expectRemovalReadyWithoutApplicationEvidence(
  page: Page,
  batch: SeededReadyBatch,
  facilityId: string,
): Promise<void> {
  await page.goto(
    `/credit-batches/${batch.creditBatchId}?facility=${facilityId}`,
  );
  const checklist = page.getByTestId("batch-health-strip");
  await expect(
    checklist.getByText("All batch data checks passed"),
  ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
  await expect(
    checklist.getByText("Application evidence", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      new RegExp(`${batch.applicationCode}: boundary logbook evidence`),
    ),
  ).toHaveCount(0);
}

test.describe("application evidence and certification readiness", () => {
  test("keeps Application and Removal ready with no evidence documents", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const facilityId = seededData.facility.id;
    const testRunId = seededData.facility.code.replace(/^E2E-FAC-/, "");
    let batch: SeededReadyBatch | undefined;

    try {
      batch = await seedUngroupedReadyBatchWithChain(
        chainRefs(seededData),
        `READINESS-${testRunId}`,
      );
      await clearEvidenceDocumentsAndSetBoundary(batch);

      // A missing mass record is retained-evidence health, not a gate.
      await expectRemovalReadyWithoutApplicationEvidence(
        page,
        batch,
        facilityId,
      );

      // The applications list badge must agree with the Removal checklist.
      await page.goto(`/applications?facility=${facilityId}`);
      const row = page.locator("tr", { hasText: batch.applicationCode });
      await expect(row).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      await expect(row.getByLabel("Ready for certification")).toBeVisible();
    } finally {
      await batch?.cleanup();
    }
  });
});
