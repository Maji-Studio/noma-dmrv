/**
 * Certification — full New-Removal happy path (create → requirements → submit).
 *
 * Unlike `certification-new-removal-wizard.spec.ts` (which proves the wizard
 * chrome with a throwaway project id and NO creds), this spec drives a
 * genuinely "ready" ungrouped credit batch through the wizard against the REAL
 * sandbox project, so the deferred-create and the facility-level requirements
 * actually resolve.
 *
 * Two-phase by design (see the handoff decision):
 *   • COMMITTED (always, when sandbox creds are present): select the ready
 *     batch → Confirm (deferred-create) → land on the Requirements step with
 *     every facility check met and the "Submit" button enabled. NO external
 *     writes — the assertion stops at the registry boundary.
 *   • LIVE (opt-in, `E2E_LIVE_SUBMIT=1` only): additionally click through to a
 *     real sandbox submit and assert the success state shows the external
 *     removal id + the "View on Isometric" deep link. This POSTs real records
 *     to the Isometric sandbox registry on every run, so it never fires in CI
 *     or by accident — it's a manual verification switch.
 *
 * Gated on `SANDBOX_PROJECT_ID`: without sandbox creds the certifier loaders
 * list empty, the default template can't resolve, and the batch can never be
 * "ready", so there is nothing to drive.
 */
import { expect, test } from "./fixtures";
import {
  DEFAULT_FACILITY_EMISSION_CONFIG,
  SANDBOX_PROJECT_ID,
  type SeededMapping,
  type SeededReadyBatch,
  fetchSubmittableSandboxRemovalTemplateId,
  seedCertifierMapping,
  seedUngroupedReadyBatchWithChain,
  teardownWizardRemovalForBatch,
} from "./fixtures/certification-helpers";

// First navigation to a not-yet-compiled certification route can take 10-30s in
// dev (Turbopack cold compile); the select + requirements steps ALSO wait on
// live Isometric round-trips (projects + templates + blueprints, plus a context
// build per ungrouped batch), which can slow further under cumulative load when
// the sandbox API throttles and the client backs off. Give those steps a wide
// budget so the creds-gated path rides out transient backoff rather than flaking.
const COLD_COMPILE_TIMEOUT_MS = 45_000;
const LIVE_SUBMIT_TIMEOUT_MS = 60_000;

// Opt-in switch for the real sandbox submit (see file header). Off by default.
const RUN_LIVE_SUBMIT = process.env.E2E_LIVE_SUBMIT === "1";

// @live — talks to the real Isometric sandbox; excluded from PR CI (e2e.yml
// runs --grep-invert @live) and exercised by the nightly e2e-live workflow.
test.describe("Certification — full New-Removal submit", { tag: "@live" }, () => {
  test.skip(
    !SANDBOX_PROJECT_ID,
    "requires Isometric sandbox creds (ISOMETRIC_DEMO_PROJECT_ID)",
  );

  test("create → requirements → (opt-in) submit a ready batch", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData; // activate fixture auto-cleanup

    const facilityId = seededData.facility.id;
    const testRunId = seededData.facility.code.replace(/^E2E-FAC-/, "");
    const projectId = SANDBOX_PROJECT_ID as string;

    // Resolve a SUBMITTABLE default removal template (all fixed inputs bound) —
    // not merely the first one, which may pass the wizard's Requirements step
    // yet fail the live submit on an unbound fixed input. null ⇒ skip rather
    // than fail (mirrors the wizard spec's creds-gated stance).
    const defaultRemovalTemplateId =
      await fetchSubmittableSandboxRemovalTemplateId(projectId);
    test.skip(
      !defaultRemovalTemplateId,
      "sandbox project has no fully-bound (submittable) removal template",
    );

    const mapping: SeededMapping = await seedCertifierMapping(facilityId, {
      externalProjectId: projectId,
      defaultRemovalTemplateId,
      // A live submit reads these; harmless for the committed (no-submit) path.
      emissionConfig: DEFAULT_FACILITY_EMISSION_CONFIG,
    });

    let batch: SeededReadyBatch | undefined;
    try {
      batch = await seedUngroupedReadyBatchWithChain(
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
      const code = batch.code;

      await page.goto(`/certification/removals?facility=${facilityId}`);

      // ── Step 1: open the wizard and select the ready batch ──────────────
      await page
        .getByRole("button", { name: "New removal", exact: true })
        .first()
        .click();

      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "New removal", level: 2 }),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      await expect(
        dialog.getByRole("heading", { name: "Select credit batches" }),
      ).toBeVisible();

      // The seeded ready batch renders a selectable checkbox (incomplete
      // siblings, e.g. the chain seed's own E2E-CB batch, render no checkbox).
      const checkbox = dialog.getByRole("checkbox", {
        name: `Select credit batch ${code}`,
        exact: true,
      });
      await expect(checkbox).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });
      await checkbox.check();

      // ── Confirm = deferred-create; advance to the Requirements step ─────
      await dialog.getByRole("button", { name: "Confirm", exact: true }).click();

      // The step rail's active item flips to Requirements...
      await expect(dialog.locator('[aria-current="step"]')).toContainText(
        "Requirements",
        { timeout: COLD_COMPILE_TIMEOUT_MS },
      );
      // ...and the requirements body renders (not the loading/error fallback) —
      // proof the removal context resolved against the real project.
      await expect(
        dialog.getByRole("heading", { name: "Registry requirements" }),
      ).toBeVisible({ timeout: COLD_COMPILE_TIMEOUT_MS });

      // Every facility-level check met ⇒ the footer "Submit" button is enabled.
      // This is the canonical "removal is ready to submit" signal (it gates on
      // `deriveRemovalReadiness(...).state === "ready"`). The COMMITTED assertion
      // stops here — no external write.
      const submitButton = dialog.getByRole("button", {
        name: "Submit",
        exact: true,
      });
      await expect(submitButton).toBeEnabled({
        timeout: COLD_COMPILE_TIMEOUT_MS,
      });

      if (!RUN_LIVE_SUBMIT) {
        test.info().annotations.push({
          type: "note",
          description:
            "Live submit skipped (set E2E_LIVE_SUBMIT=1 to POST to the sandbox registry).",
        });
        return;
      }

      // ── LIVE (opt-in): real sandbox submit + success-state assertions ───
      await submitButton.click();
      await expect(
        dialog.getByRole("heading", { name: "Submit", exact: true }),
      ).toBeVisible();

      await dialog
        .getByRole("button", { name: "Submit removal", exact: true })
        .click();

      // Success block: confirmation copy + external id + the verified deep link.
      await expect(
        dialog.getByText("Removal submitted to the registry."),
      ).toBeVisible({ timeout: LIVE_SUBMIT_TIMEOUT_MS });

      const viewLink = dialog.getByRole("link", { name: /View on Isometric/ });
      await expect(viewLink).toBeVisible();
      // Deep link shape verified against a live removal (design doc §7): the
      // supplier's private, project-scoped Certify "ghg-entry" edit view.
      await expect(viewLink).toHaveAttribute(
        "href",
        /registry\.sandbox\.isometric\.com\/account\/certify\/project\/.+\/ghg-entry\/.+\/edit/,
      );
    } finally {
      // The wizard's deferred-create grouped the batch into a fresh removal (and,
      // on the live path, wrote a submission row); tear those down before the
      // seed's own batch + chain cleanup.
      if (batch) {
        try {
          await teardownWizardRemovalForBatch(batch.creditBatchId);
        } finally {
          await batch.cleanup();
        }
      }
      await mapping.cleanup();
    }
  });
});
