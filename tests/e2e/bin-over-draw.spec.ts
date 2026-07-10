/**
 * Bin over-draw block (issue #116)
 *
 * Exercises the production-run feedstock draw path end-to-end through the UI:
 *   (a) a draw exceeding the bin's on-hand stock is rejected server-side with an
 *       error that quotes the available quantity, and the run is NOT created;
 *   (b) a within-stock draw succeeds and the side sheet closes.
 *
 * The seeded feedstock bin holds a single 100 kg (dry) batch and has no prior
 * consumption, so a draw whose derived dry mass exceeds 100 kg over-draws it.
 */
import type { Page } from "@playwright/test";
import { test, expect, type SeededChainData } from "./fixtures";
import {
  selectEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

/** The seeded feedstock bin's total recorded dry mass (see seed-chain-data). */
const SEEDED_BIN_DRY_KG = 100;

test.describe("Bin over-draw block", () => {
  async function openNewRunForm(page: Page, seededData: SeededChainData) {
    await page.goto(`/production-runs?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Production Run" }).click();
    await waitForSideSheet(page);

    await page.selectOption('select[name="status"]', "draft");
    await selectEntity(
      page,
      "Reactor",
      seededData.reactor.id,
      seededData.reactor.identifier,
    );
    const today = new Date().toISOString().split("T")[0];
    await page.fill('input[name="startDate"]', today);
    await selectEntity(
      page,
      "Source Bin",
      seededData.feedstockStorageLocation.id,
      seededData.feedstockStorageLocation.name,
    );
  }

  test("rejects a feedstock draw larger than the bin holds", async ({
    adminPage: page,
    seededData,
  }) => {
    await openNewRunForm(page, seededData);

    // 200 kg wet at 0% moisture derives to 200 kg dry — double the 100 kg on hand.
    await page.fill('input[name="feedstockWetMassKg"]', "200");
    await page.fill('input[name="feedstockMoisturePercent"]', "0");

    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("Create Production Run")').click();

    // The block surfaces as a server-error alert quoting the available quantity.
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("on hand");
    await expect(alert).toContainText(`${SEEDED_BIN_DRY_KG} kg`);

    // The side sheet must stay open — the run was not created.
    await expect(dialog).toBeVisible();
  });

  test("allows a feedstock draw within the bin's on-hand stock", async ({
    adminPage: page,
    seededData,
  }) => {
    await openNewRunForm(page, seededData);

    // 50 kg wet at 15% moisture derives to 42.5 kg dry — well under 100 kg.
    await page.fill('input[name="feedstockWetMassKg"]', "50");
    await page.fill('input[name="feedstockMoisturePercent"]', "15");

    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("Create Production Run")').click();

    // Success closes the side sheet and the run lands in the list.
    await waitForSideSheetClose(page);
    await expect(
      page.locator("table tbody tr, [role='row']").first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
