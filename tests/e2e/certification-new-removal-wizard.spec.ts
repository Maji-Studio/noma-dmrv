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
  type SeededIncompleteBatch,
  SANDBOX_PROJECT_ID,
  seedCertifierMapping,
  seedGroupedRemovalWithChain,
  seedUngroupedIncompleteBatch,
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

  // The one readiness source (Phase 0) renders this neutral requirement label
  // — from `CERT_REQUIREMENT_META` — on every surface. A runless batch is
  // deterministically missing its production data, so this row is always open.
  const PRODUCTION_REQUIREMENT = "Linked production data";
  // The retired problem-phrased headline the batch page used to show for this
  // same gap — its absence proves the migration to the shared requirement label.
  const OLD_PRODUCTION_HEADLINE = "Production data not linked";
  // Phase 1 tucks the raw protocol reasoning behind an ⓘ "Why?" so the primary
  // requirement label stays plain. Distinctive substring of the production
  // check's `whyDetail` (from CERT_REQUIREMENT_META), only present once opened.
  const PRODUCTION_WHY_DETAIL = "trace back to at least one production run";

  test("batch checklist shows the neutral requirement label, not the old contradictory copy (Phase 0)", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    const facilityId = seededData.facility.id;
    const testRunId = seededData.facility.code.replace(/^E2E-FAC-/, "");
    // No certifier mapping here: the batch-detail health strip evaluates the
    // batch's own data without any Isometric call, so this runs in hermetic PR
    // CI. The wizard surface (which needs a registry link) is covered by the
    // @live cross-surface test below.
    let batch: SeededIncompleteBatch | undefined;

    try {
      batch = await seedUngroupedIncompleteBatch(
        { facilityId, feedstockTypeId: seededData.feedstockType.id },
        testRunId,
      );

      await page.goto(
        `/credit-batches/${batch.creditBatchId}?facility=${facilityId}`,
      );
      const healthStrip = page.getByTestId("batch-health-strip");
      // The open gap reads as the plain requirement…
      await expect(healthStrip).toContainText(PRODUCTION_REQUIREMENT, {
        timeout: COLD_COMPILE_TIMEOUT_MS,
      });
      // …never the old problem-phrased headline (or an affirmative "…complete").
      await expect(healthStrip).not.toContainText(OLD_PRODUCTION_HEADLINE);
    } finally {
      await batch?.cleanup();
    }
  });

  test("tucks the requirement's protocol reasoning behind an ⓘ 'Why?' affordance (Phase 1)", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    const facilityId = seededData.facility.id;
    const testRunId = seededData.facility.code.replace(/^E2E-FAC-/, "");
    // Same hermetic seed as the Phase 0 test above (no certifier mapping → no
    // Isometric call), so this runs in PR CI.
    let batch: SeededIncompleteBatch | undefined;

    try {
      batch = await seedUngroupedIncompleteBatch(
        { facilityId, feedstockTypeId: seededData.feedstockType.id },
        testRunId,
      );

      await page.goto(
        `/credit-batches/${batch.creditBatchId}?facility=${facilityId}`,
      );
      const healthStrip = page.getByTestId("batch-health-strip");
      // The open production gap renders as a plain requirement row…
      const productionRow = healthStrip.locator("li", {
        hasText: PRODUCTION_REQUIREMENT,
      });
      await expect(productionRow).toBeVisible({
        timeout: COLD_COMPILE_TIMEOUT_MS,
      });
      // …with the raw protocol reasoning hidden until the ⓘ is opened (the
      // tooltip mounts on open, so it is absent from the DOM up front).
      await expect(page.getByText(PRODUCTION_WHY_DETAIL)).toBeHidden();

      // Opening the ⓘ reveals the whyDetail. The tooltip portals to <body>, so
      // assert on the page rather than within the row.
      await productionRow
        .getByRole("button", { name: "Why is this required?" })
        .hover();
      await expect(page.getByText(PRODUCTION_WHY_DETAIL)).toBeVisible();
    } finally {
      await batch?.cleanup();
    }
  });
});

// @live — the wizard's selection step needs a linked registry, so this asserts
// the cross-surface identity against the real Isometric sandbox. Excluded from
// PR CI (e2e.yml runs --grep-invert @live) and run by the nightly e2e-live
// workflow; the CI-safe batch-page half is covered above.
test.describe("Certification — New-Removal wizard (Phase 0 cross-surface)", { tag: "@live" }, () => {
  test.skip(
    !SANDBOX_PROJECT_ID,
    "Requires ISOMETRIC_DEMO_PROJECT_ID (real sandbox project) to link the facility.",
  );

  const PRODUCTION_REQUIREMENT = "Linked production data";

  test("shows the same plain-language gap string on the batch page and the wizard", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    const facilityId = seededData.facility.id;
    const testRunId = seededData.facility.code.replace(/^E2E-FAC-/, "");
    const mapping = await seedCertifierMapping(facilityId, {
      externalProjectId: SANDBOX_PROJECT_ID as string,
    });
    let batch: SeededIncompleteBatch | undefined;

    try {
      batch = await seedUngroupedIncompleteBatch(
        { facilityId, feedstockTypeId: seededData.feedstockType.id },
        testRunId,
      );

      // Surface 1 — the credit-batch detail page's certification checklist.
      await page.goto(
        `/credit-batches/${batch.creditBatchId}?facility=${facilityId}`,
      );
      await expect(page.getByTestId("batch-health-strip")).toContainText(
        PRODUCTION_REQUIREMENT,
        { timeout: COLD_COMPILE_TIMEOUT_MS },
      );

      // Surface 2 — the New-Removal wizard's selection card for the SAME batch.
      await page.goto(`/certification/removals?facility=${facilityId}`);
      await page
        .getByRole("button", { name: "New removal", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "Select credit batches" }),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      await expect(dialog.getByText(batch.code)).toBeVisible({
        timeout: COLD_COMPILE_TIMEOUT_MS,
      });
      // The identical requirement string appears in the wizard too.
      await expect(dialog.getByText(PRODUCTION_REQUIREMENT).first()).toBeVisible();
    } finally {
      try {
        await batch?.cleanup();
      } finally {
        await mapping.cleanup();
      }
    }
  });
});
