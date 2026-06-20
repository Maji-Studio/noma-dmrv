/**
 * 200-year durability readiness surfaces (Tier-1 Phase 5).
 *
 * Exercises the credit-batch re-grain (ADR 0016) end-to-end through the UI: a
 * single-feedstock credit batch spanning TWO production runs, with THREE lab
 * samples distributed across both runs/days, must roll up to:
 *   - the credit-batch detail's durability panel (sample table + readiness
 *     chips + the submitted mean ± s.d.), and
 *   - the lab-sample form's derived-batch progress preview.
 *
 * Pure UI + DB (no Isometric) — runs in PR CI, NOT @live. The live
 * measurement-samples POST is gated (`DURABILITY_MEASUREMENT_SAMPLES_LIVE`), so
 * the submit path itself is out of scope here; the per-batch aggregation +
 * gates are covered by the offline unit/integration suites.
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

    // The three readiness signals: ≥3 met, distributed across runs/days, eligible.
    const signals = panel.getByTestId("durability-readiness-signals");
    await expect(signals).toContainText("3 of 3 replicates");
    await expect(signals).toContainText("distinct runs/days");
    await expect(signals).toContainText("Eligible");

    // The raw replicates roll up into the batch.
    for (const code of batch.sampleCodes) {
      await expect(panel.getByText(code)).toBeVisible();
    }

    // The batch-level figure block the measurement-sample submission sends.
    await expect(
      panel.getByText("Submitted to registry (mean ± s.d.)"),
    ).toBeVisible();
  });

  test("lab-sample form previews the derived credit batch's sampling progress", async ({
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

    // Selecting one of the batch's runs derives the credit batch it characterises.
    await selectEntity(adminPage, "Production Run", batch.runIds[0]);

    const progress = adminPage.getByTestId("sample-batch-progress");
    await expect(progress).toContainText(
      `Characterises credit batch ${batch.creditBatchCode}`,
    );
    await expect(
      progress.getByTestId("durability-readiness-signals"),
    ).toContainText("3 of 3 replicates");
    await expect(progress).toContainText("Eligible");
  });
});
