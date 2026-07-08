/**
 * Certification — GHG-statement empty-period guard (#245, redesign §5.2).
 *
 * HERMETIC — no sandbox creds needed. The create drawer's period + contents
 * steps make NO Isometric call: the preview reads the DB-only
 * `loadOpenRemovalsForFacility`, and the route is un-gated with a throwaway
 * `certifier_projects` row (operational routes are gated on a registry link —
 * ADR 0007 — but the gate reads the DB-only `loadFacilityCertifierSummary`).
 *
 * The guard has three layers; this covers the client one end-to-end:
 *   - server `createGhgStatementDraft` refuses a 0-removal period,
 *   - server `submitGhgStatementToVerifier` refuses a 0-linked statement,
 *   - here: the drawer can't advance/create an empty period.
 *
 * A far-past period end (2020) makes the in-window set provably empty
 * regardless of what the base chain seed contains — no removal completed before
 * then — so the assertion is seed-independent.
 */
import { expect, test } from "./fixtures";
import { seedCertifierMapping } from "./fixtures/certification-helpers";

// DB-only link target; never reaches Isometric, so any string is fine.
const FAKE_PROJECT_ID = "e2e-ghg-empty-guard-fake-project";

// First navigation to a not-yet-compiled certification route can take 10-30s in
// dev (Turbopack cold compile); give assertions room so the test isn't flaky.
const COLD_COMPILE_TIMEOUT_MS = 30_000;

// A period end far enough in the past that nothing the chain seed created can
// fall inside it — guarantees the empty-window branch.
const EMPTY_PERIOD_END = "2020-01-01";

test.describe("Certification — GHG statement empty-period guard", () => {
  test("blocks advancing and creating a statement for a period with no removals", async ({
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
      await page.goto(`/certification/ghg-statements?facility=${facilityId}`);

      await page
        .getByRole("button", { name: "New GHG Statement", exact: true })
        .click();

      const drawer = page.getByRole("dialog");
      await expect(
        drawer.getByRole("heading", { name: "New GHG Statement", level: 2 }),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });

      // Step 1 — the honest plain-language lead sentence (§5.1), not "pick a date".
      await expect(
        drawer.getByText(
          /bundles the removals you've already submitted this period/i,
        ),
      ).toBeVisible();

      // Pick a period end that provably contains no removals.
      await drawer.getByLabel("Reporting period end").fill(EMPTY_PERIOD_END);

      // Advance to the Contents step (the date is valid + non-overlapping).
      await drawer.getByRole("button", { name: "Next", exact: true }).click();

      // The empty-period callout replaces the accordion, and the count reads 0.
      await expect(
        drawer.getByText("Expected in this statement (0)"),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      await expect(
        drawer.getByText(
          /This period has no submitted removals yet — a statement now would be empty/i,
        ),
      ).toBeVisible();

      // The gate: Next is disabled — no dead-end empty statement can be created.
      await expect(
        drawer.getByRole("button", { name: "Next", exact: true }),
      ).toBeDisabled();
    } finally {
      await mapping.cleanup();
    }
  });
});
