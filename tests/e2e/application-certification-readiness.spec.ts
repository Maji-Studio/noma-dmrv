/**
 * Shared application certification-readiness regression (issue #246).
 *
 * The application list derives its badge from the same evidence requirements
 * that feed the credit-batch / Removal submission context. This authenticated
 * browser flow guards both the cross-surface verdict and the React Query
 * invalidation after evidence upload/delete.
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
import { waitForSideSheet } from "./fixtures/page-helpers";

const COLD_COMPILE_TIMEOUT_MS = 30_000;
const EVIDENCE_FILE_NAME = "application-boundary-logbook.pdf";
const BOUNDARY_REFERENCE = "https://maps.example.test/readiness-boundary";
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

function chainRefs(seededData: SeededChainData) {
  return {
    facilityId: seededData.facility.id,
    reactorId: seededData.reactor.id,
    formulationId: seededData.formulation.id,
    feedstockId: seededData.feedstock.id,
    feedstockStorageLocationId: seededData.feedstockStorageLocation.id,
    biocharStorageLocationId: seededData.biocharStorageLocation.id,
    customerId: seededData.customer.id,
    customerLocationId: seededData.customerLocation.id,
    vehicleId: seededData.vehicle.id,
  };
}

async function makeBoundaryEvidenceIncomplete(
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
          gisBoundaryReference: BOUNDARY_REFERENCE,
        })
        .where(eq(schema.applications.id, batch.applicationId));
    });
  } finally {
    await pool.end();
  }
}

async function expectRemovalEvidenceGap(
  page: Page,
  batch: SeededReadyBatch,
  facilityId: string,
): Promise<void> {
  await page.goto(
    `/credit-batches/${batch.creditBatchId}?facility=${facilityId}`,
  );
  const checklist = page.getByTestId("batch-health-strip");
  await expect(checklist).toContainText(
    `Application ${batch.applicationCode}: boundary logbook evidence`,
    { timeout: COLD_COMPILE_TIMEOUT_MS },
  );
  await expect(checklist.getByText("1 issue open")).toBeVisible();
}

test.describe("application certification readiness", () => {
  test("keeps list and Removal readiness aligned through evidence upload and delete", async ({
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
      await makeBoundaryEvidenceIncomplete(batch);

      // The same missing logbook blocks the Removal/batch context and the list.
      await expectRemovalEvidenceGap(page, batch, facilityId);
      await page.goto(`/applications?facility=${facilityId}`);
      const row = page.locator("tr", { hasText: batch.applicationCode });
      await expect(row).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      await expect(
        row.getByLabel(
          "Incomplete for certification with 1 gap — activate to see what's missing",
        ),
      ).toBeVisible();

      // Upload a classified boundary logbook from the real application editor.
      await row.locator("td").first().click();
      await waitForSideSheet(page);
      await page.getByRole("button", { name: "Edit Application" }).click();
      await page
        .locator(`#application-${batch.applicationId}-boundary-evidence-upload`)
        .setInputFiles({
          name: EVIDENCE_FILE_NAME,
          mimeType: "application/pdf",
          buffer: PDF_BYTES,
        });
      await expect(
        page.locator('[role="dialog"] li', { hasText: EVIDENCE_FILE_NAME }),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      await expect(row.getByLabel("Ready for certification")).toBeVisible({
        timeout: COLD_COMPILE_TIMEOUT_MS,
      });

      // A fresh Removal readiness load now clears the same authoritative gate.
      await page.goto(
        `/credit-batches/${batch.creditBatchId}?facility=${facilityId}`,
      );
      await expect(
        page.getByTestId("batch-health-strip").getByText("Ready to certify"),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });

      // Delete the evidence in the editor; the already-mounted list row must
      // refetch immediately instead of lingering as Ready for its 30s staleTime.
      await page.goto(`/applications?facility=${facilityId}`);
      const refreshedRow = page.locator("tr", { hasText: batch.applicationCode });
      await refreshedRow.locator("td").first().click();
      await waitForSideSheet(page);
      await page.getByRole("button", { name: "Edit Application" }).click();
      await page
        .getByRole("button", { name: `Delete ${EVIDENCE_FILE_NAME}` })
        .click();
      const deleteDialog = page.getByRole("dialog", {
        name: "Delete Evidence",
      });
      await deleteDialog
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(
        refreshedRow.getByLabel(
          "Incomplete for certification with 1 gap — activate to see what's missing",
        ),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });

      await expectRemovalEvidenceGap(page, batch, facilityId);
    } finally {
      await batch?.cleanup();
    }
  });
});
