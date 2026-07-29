/**
 * 200-year durability readiness surfaces (Tier-1 Phase 5).
 *
 * Exercises the credit-batch re-grain (ADR 0016) end-to-end through the UI: a
 * single-feedstock credit batch spanning TWO production runs, with THREE lab
 * samples distributed across both runs/days, must roll up to:
 *   - the credit-batch detail's durability panel (sample table + readiness
 *     chips + the submitted mean ± s.d.), and
 *   - the lab-sample form's batch progress preview (the sample anchors on the
 *     credit batch directly — issue #309).
 *
 * Pure UI + DB (no Isometric) — runs in PR CI, NOT @live. The 200-year
 * measurement-samples POST remains unavailable, so the submit path itself is
 * out of scope here; the per-batch aggregation + gates are covered by the
 * offline unit/integration suites.
 */
import * as crypto from "crypto";
import { test, expect } from "./fixtures/auth-fixtures";
import { seedDurabilityBatch } from "./fixtures/seed-chain-data";
import { selectEntity, waitForSideSheet } from "./fixtures/page-helpers";

test.describe("200-year durability readiness", () => {
  test("credit-batch durability panel rolls up a multi-run batch's ≥3 distributed samples", async ({
    adminPage,
    seededData,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedDurabilityBatch(
      seededData.facility.id,
      seededData.reactor.id,
      seededData.feedstockType.id,
      tag,
    );

    await adminPage.goto(
      `/credit-batches/${batch.creditBatchId}?facility=${seededData.facility.id}`,
    );

    const panel = adminPage.getByTestId("credit-batch-durability-panel");
    await expect(panel).toBeVisible();

    // The readiness signals: the §8.3.1 ≥3 count and the §3 Table 2 verdict.
    // §8.3.1 requires no within-batch run/day distribution, so no such signal.
    const signals = panel.getByTestId("durability-readiness-signals");
    await expect(signals).toContainText("3 of 3 usable Samples");
    await expect(signals).toContainText("Chemistry eligible");
    await expect(signals).not.toContainText("distinct runs/days");

    await panel.getByText("View chemistry details", { exact: true }).click();

    // The raw replicates roll up into the batch.
    const replicateTableBody = panel.locator("tbody");
    for (const code of batch.sampleCodes) {
      await expect(
        replicateTableBody.getByText(code, { exact: true }),
      ).toBeVisible();
    }

    // The batch-level figure block the measurement-sample submission sends.
    const submittedStats = panel
      .getByText("Submitted to registry (mean ± s.d.)", { exact: true })
      .locator("..");
    await expect(submittedStats).toBeVisible();
    for (const label of [
      "H/C_org (molar)",
      "Total carbon",
      "Inorganic carbon",
      "Product mass",
    ]) {
      await expect(
        submittedStats.getByText(label, { exact: true }),
      ).toBeVisible();
    }
  });

  test("lab-sample form previews the selected credit batch's sampling progress", async ({
    adminPage,
    seededData,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedDurabilityBatch(
      seededData.facility.id,
      seededData.reactor.id,
      seededData.feedstockType.id,
      tag,
    );

    await adminPage.goto(`/samples?facility=${seededData.facility.id}`);
    await adminPage.getByRole("button", { name: "New Sample" }).click();
    await waitForSideSheet(adminPage);

    // Samples anchor on the credit batch directly (issue #309).
    await selectEntity(adminPage, "Credit Batch", batch.creditBatchId);

    const progress = adminPage.getByTestId("sample-batch-progress");
    await expect(progress).toContainText(
      `Characterises credit batch ${batch.creditBatchCode}`,
    );
    await expect(
      progress.getByTestId("durability-readiness-signals"),
    ).toContainText("3 of 3 usable Samples");
    await expect(progress).toContainText("Chemistry eligible");
  });
});
