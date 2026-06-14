/**
 * Certification — New-Removal wizard + review-route consolidation E2E.
 *
 * The Stage-4 5-step guided Review flow was consolidated into the New-Removal
 * wizard (design doc §4 / §10 step 6). These tests cover the two entry points:
 *   1. the "New removal" CTA on the Removals overview opens the wizard at its
 *      first step (Select credit batches), and Cancel closes it;
 *   2. the retired `/[removalId]/review` deep link redirects to the overview
 *      with `?resume=<removalId>`, which opens the wizard on that removal at the
 *      requirements step.
 *
 * Both run on a DB-seeded certifier mapping (the operational routes are gated on
 * a linked registry — ADR 0007) with a throwaway project id, so NO sandbox creds
 * are required: `loadFacilityCertifierFacts` lists safely-empty without them, so
 * the wizard still mounts and renders each step's chrome. The full
 * create → submit happy path (a "ready" batch + a live sandbox submit) is left
 * to a manual/seeded run — it depends on a guaranteed-ready batch and the live
 * registry, which are too fragile for CI.
 */
import { expect, test } from "./fixtures";
import {
  type SeededGroupedRemoval,
  seedCertifierMapping,
  seedGroupedRemovalWithChain,
} from "./fixtures/certification-helpers";

// DB-only link target; never reaches Isometric, so any string is fine.
const FAKE_PROJECT_ID = "e2e-new-removal-fake-project";

// First navigation to a not-yet-compiled certification route can take 10-30s in
// dev (Turbopack cold compile); give assertions room so the test isn't flaky.
const COLD_COMPILE_TIMEOUT_MS = 30_000;

test.describe("Certification — New-Removal wizard", () => {
  test("opens the wizard from the New removal CTA and closes it", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData; // activate fixture auto-cleanup

    const facilityId = seededData.facility.id;
    const mapping = await seedCertifierMapping(facilityId, {
      externalProjectId: FAKE_PROJECT_ID,
    });

    try {
      await page.goto(`/certification/removals?facility=${facilityId}`);

      // The primary CTA (the header one; the empty-state nudge shares the label,
      // so take the first in DOM order).
      await page
        .getByRole("button", { name: "New removal", exact: true })
        .first()
        .click();

      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "New removal", level: 2 }),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      // Step 1 chrome.
      await expect(
        dialog.getByRole("heading", { name: "Select credit batches" }),
      ).toBeVisible();

      // Cancel closes the wizard (the Modal unmounts the dialog).
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      await mapping.cleanup();
    }
  });

  test("redirects the legacy review route into the wizard resume step", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    const facilityId = seededData.facility.id;
    const testRunId = seededData.facility.code.replace(/^E2E-FAC-/, "");
    const mapping = await seedCertifierMapping(facilityId, {
      externalProjectId: FAKE_PROJECT_ID,
    });
    let removal: SeededGroupedRemoval | undefined;

    try {
      // Seed inside try so a thrown seed still runs the mapping cleanup.
      removal = await seedGroupedRemovalWithChain(
        {
          facilityId,
          reactorId: seededData.reactor.id,
          formulationId: seededData.formulation.id,
          feedstockId: seededData.feedstock.id,
          feedstockStorageLocationId: seededData.feedstockStorageLocation.id,
          biocharStorageLocationId: seededData.biocharStorageLocation.id,
          customerId: seededData.customer.id,
          customerLocationId: seededData.customerLocation.id,
          vehicleId: seededData.vehicle.id,
        },
        testRunId,
      );

      await page.goto(
        `/certification/removals/${removal.removalId}/review?facility=${facilityId}`,
      );

      // The old /review route now redirects to the Removals hub with ?resume=.
      await expect(page).toHaveURL(
        new RegExp(`/certification/removals\\?.*resume=${removal.removalId}`),
        { timeout: COLD_COMPILE_TIMEOUT_MS },
      );

      // ...and the wizard opens on that removal in resume mode — it skips the
      // select step and lands on "Confirm & submit" (the step that absorbed the
      // old Requirements step — see new-removal-dialog/submit-step.tsx). Assert
      // via the step rail's active item (rendered immediately) rather than the
      // step body, which is gated on the removal context query (that query hits
      // the Isometric API, so its success is environment-dependent — irrelevant
      // to the redirect + resume-entry behavior under test here).
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "New removal", level: 2 }),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      await expect(dialog.locator('[aria-current="step"]')).toContainText(
        "Confirm & submit",
      );
      // Resume jumps past step 1, so its heading must be absent.
      await expect(
        dialog.getByRole("heading", { name: "Select credit batches" }),
      ).toHaveCount(0);
    } finally {
      try {
        await removal?.cleanup();
      } finally {
        await mapping.cleanup();
      }
    }
  });
});
