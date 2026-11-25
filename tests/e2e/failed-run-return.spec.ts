/**
 * Failed-run return to an uncarbonized bin (#439).
 *
 * Fails a run that drew 50 kg wet at 15% moisture (42.5 kg dry), returns 50 kg
 * wet at 30% moisture (35 kg dry) to an uncarbonized bin of the same feedstock
 * type, checks the return on the run and in the bin's stock history, then
 * reverses it with a reason. Data uses the E2E- code prefix the teardown sweeps.
 */
import type { Page } from "@playwright/test";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { binMovements, storageLocations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createDbConnection } from "./fixtures/db";
import { test, expect, type SeededChainData } from "./fixtures";
import { selectEntity, waitForFacilityHydration, waitForSideSheet, waitForSideSheetClose } from "./fixtures/page-helpers";
import { chooseRunStatus } from "./helpers/run-status";

const RUN_DATE = "2025-02-05";
const DRAW_WET_KG = "50";
const DRAW_MOISTURE = "15";
const RETURN_WET_KG = "50";
const RETURN_MOISTURE = "30";
const FIRST_DRAW_SELECTOR = 'input[name="feedstockDraws.0.wetMassKg"]';

/** Create a Running run that drew from the seeded feedstock bin, then fail it. */
async function createFailedRun(page: Page, seededData: SeededChainData) {
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await waitForFacilityHydration(page, seededData.facility.name);
  await page.getByRole("button", { name: "New production run" }).click();
  await waitForSideSheet(page);
  await chooseRunStatus(page, "running");
  await selectEntity(page, "Reactor", seededData.reactor.id, seededData.reactor.identifier);
  await page.fill('input[name="startDate"]', RUN_DATE);
  await page.fill('input[name="startTime"]', "08:00");
  await selectEntity(page, "Source Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
  await page.fill(FIRST_DRAW_SELECTOR, DRAW_WET_KG);
  await page.fill('input[name="feedstockMoisturePercent"]', DRAW_MOISTURE);
  await page.locator('[role="dialog"]').locator('button:has-text("Create production run")').click();
  await waitForSideSheetClose(page);

  await expect(async () => {
    await page.locator("tbody tr").first().getByRole("button", { name: /Actions for/ }).click({ timeout: 5000 });
    await page.getByRole("menuitem", { name: "Edit" }).click({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await waitForSideSheet(page);
  const sheet = page.locator('[role="dialog"]');
  await sheet.locator('input[name="endDate"]').fill(RUN_DATE);
  await sheet.locator('input[name="endTime"]').fill("12:00");
  await chooseRunStatus(sheet, "failed");
  await sheet.locator('button:has-text("Save changes")').click();
  await waitForSideSheetClose(page);
}

test.describe("Failed-run return to storage (#439)", () => {
  test("returns leftover material to an uncarbonized bin and reverses it", async ({ adminPage: page, seededData }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const binId = crypto.randomUUID();
    const binName = `E2E Uncarbonized Bin ${tag}`;
    const { db, pool } = createDbConnection();
    try {
      await db.insert(storageLocations).values({
        id: binId, organizationId: DEC_ORG_ID, code: `E2E-BIN-UNC-${tag}`, name: binName, type: "feedstock_bin",
        facilityId: seededData.facility.id, feedstockTypeId: seededData.feedstockType.id, uncarbonized: true,
      });
    } finally {
      await pool.end();
    }

    try {
      await createFailedRun(page, seededData);

      // The Failed run's view carries the section and its action.
      await page.locator("tbody tr").first().click();
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog").first();
      await expect(sheet.getByRole("heading", { name: "Leftover material" })).toBeVisible();
      await expect(sheet.getByText("Nothing has gone back to storage yet.")).toBeVisible();
      await sheet.getByRole("button", { name: "Return to storage" }).click();

      // 50 kg wet at 30% moisture is 35 kg dry of the 42.5 kg the run consumed.
      const form = page.getByRole("dialog", { name: "Return to storage" });
      await selectEntity(page, "Destination bin", binId, binName);
      await form.locator("#wetMassKg").fill(RETURN_WET_KG);
      await form.locator("#moisturePercent").fill(RETURN_MOISTURE);
      await form.locator("#return-reason").fill("Material left in the reactor after the feed failed");
      await form.getByRole("button", { name: "Return to storage" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Return saved" })).toBeVisible();

      // The run lists the return, linked to its bin.
      await expect(sheet.getByRole("link", { name: binName })).toBeVisible();
      await expect(sheet.getByText("50 kg wet mass")).toBeVisible();
      await expect(sheet.getByText("30% moisture, 35 kg dry")).toBeVisible();

      // The bin's stock history carries the return, with a link back to the run.
      await page.goto(`/storage-bins?facility=${seededData.facility.id}&bin=${binId}`);
      await page.getByRole("button", { name: "History" }).click();
      const history = page.getByRole("dialog", { name: "Stock history", exact: true });
      const entry = history.locator("details").filter({ hasText: "Failed-run return" });
      await expect(entry).toBeVisible();
      await expect(entry).toContainText("+50 kg wet mass");
      await entry.locator("summary").click();
      await expect(entry.getByRole("link", { name: /Open\s+production run/ })).toBeVisible();

      // Reverse it from the run, with a reason.
      await page.goto(`/production-runs?facility=${seededData.facility.id}`);
      await page.locator("tbody tr").first().click();
      await waitForSideSheet(page);
      await page.getByRole("dialog").first().getByRole("button", { name: "Reverse" }).click();
      const reverse = page.getByRole("dialog", { name: /Reverse return/ });
      await reverse.getByRole("button", { name: "Reverse return" }).click();
      await expect(reverse.getByText("Enter why you reverse this entry.")).toBeVisible();
      await reverse.locator("#return-reverse-reason").fill("Weighed on the wrong scale");
      await reverse.getByRole("button", { name: "Reverse return" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Return reversed" })).toBeVisible();
      await expect(page.getByRole("dialog").first().getByText("Reversed", { exact: true })).toBeVisible();
    } finally {
      // The bin carries ledger rows; they go first so the seeded facility can be removed.
      const cleanup = createDbConnection();
      try {
        await cleanup.db.delete(binMovements).where(eq(binMovements.storageLocationId, binId));
        await cleanup.db.delete(storageLocations).where(eq(storageLocations.id, binId));
      } finally {
        await cleanup.pool.end();
      }
    }
  });
});
