/**
 * Production-process operator surface (ADR 0017 Track 1.5) + the process-grained
 * Method-B baseline count (Track 1.1).
 *
 * Exercises `getProductionProcessSummariesByFacility` end-to-end through the UI:
 * a seeded production process with ONE credit batch carrying THREE eligible
 * replicate samples must surface on /production-processes as "3 / 30 eligible
 * samples" with its cadence met.
 *
 * This is the DB-backed regression for the re-grain: the baseline counter is
 * scoped to the production process (via credit_batches.production_process_id),
 * so the row reflects exactly that process's samples — not 0 (a broken join) and
 * not a reactor-pooled total that would leak across feedstocks/campaigns. Pure
 * UI + DB (no Isometric) — runs in PR CI, NOT @live.
 */
import * as crypto from "crypto";
import { test, expect } from "./fixtures/auth-fixtures";
import { seedDurabilityBatch } from "./fixtures/seed-chain-data";

test.describe("production processes", () => {
  test("a process surfaces its own ≥3-sample baseline count and cadence", async ({
    adminPage,
    seededData,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    // Seeds a fresh production process for the seeded feedstock with one credit
    // batch + three eligible replicates. The base seed creates no samples, so a
    // "3 / 30" row uniquely identifies this process.
    await seedDurabilityBatch(
      seededData.facility.id,
      seededData.reactor.id,
      seededData.feedstockType.id,
      tag,
    );

    await adminPage.goto(
      `/production-processes?facility=${seededData.facility.id}`,
    );

    await expect(
      adminPage.getByRole("heading", { name: "Production Processes" }),
    ).toBeVisible();

    // The process row counts exactly its own three replicate samples toward the
    // ≥30 baseline — process-scoped, not pooled, not zero.
    const baselineCell = adminPage.getByText("3 / 30 eligible samples").first();
    await expect(baselineCell).toBeVisible();

    // Method A every-batch cadence is satisfied (its 1 batch is sampled).
    await expect(adminPage.getByText("On cadence").first()).toBeVisible();

    // Under Method A, the 3-sample process is below the 30 baseline → not yet
    // Method-B-eligible.
    await expect(
      adminPage.getByText("27 more to qualify").first(),
    ).toBeVisible();
  });
});
