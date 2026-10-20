import * as crypto from "crypto";
import { test, expect, waitForSideSheet } from "./fixtures";
import { setFacilityDurabilityTier } from "./fixtures/certification-mapping-helpers";
import { selectEntity } from "./fixtures/page-helpers";
import { seedCreditBatch } from "./fixtures/seed-chain-data";

const REACTIVE_RESIDUAL_OVER_100 = "Reactive and residual carbon add up to 110%. They can be at most 100%.";

test.describe("Sample carbon feedback", () => {
  test("shows and clears concise reconciliation errors while entering carbon values", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/samples?facility=${seededData.facility.id}`);
    await expect(
      page.locator("aside").getByText(seededData.facility.name, { exact: false }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "New Sample" }).click();
    await waitForSideSheet(page);

    const dialog = page.getByRole("dialog");
    const totalCarbon = dialog.locator('input[name="totalCarbonPercent"]');
    const organicCarbon = dialog.locator('input[name="organicCarbonPercent"]');
    const inorganicCarbon = dialog.locator(
      'input[name="inorganicCarbonPercent"]',
    );

    await totalCarbon.fill("75");
    await organicCarbon.fill("76");
    await expect(
      dialog.getByText(
        "Organic carbon cannot exceed total carbon by more than 0.5 percentage points. Correct the carbon values.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(organicCarbon).toBeFocused();

    await organicCarbon.fill("74");
    await expect(
      dialog.getByText(
        "Organic carbon cannot exceed total carbon by more than 0.5 percentage points. Correct the carbon values.",
        { exact: true },
      ),
    ).toHaveCount(0);

    await inorganicCarbon.fill("2");
    await expect(
      dialog.getByText(
        "Organic plus inorganic carbon cannot exceed total carbon by more than 0.5 percentage points. Correct the carbon values.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(inorganicCarbon).toBeFocused();

    await inorganicCarbon.fill("1");
    await expect(
      dialog.getByText(
        "Organic plus inorganic carbon cannot exceed total carbon by more than 0.5 percentage points. Correct the carbon values.",
        { exact: true },
      ),
    ).toHaveCount(0);
  });

  test("refuses reactive plus residual carbon above 100% and asks for the sampling time on Save", async ({
    adminPage: page,
    seededData,
  }) => {
    // Reactive and residual carbon are 1000-year TGA fields.
    await setFacilityDurabilityTier(seededData.facility.id, "1000_year");
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(seededData.facility.id, `TGA-${tag}`, seededData.feedstockType.id);

    await page.goto(`/samples?facility=${seededData.facility.id}`);
    await expect(
      page.locator("aside").getByText(seededData.facility.name, { exact: false }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "New Sample" }).click();
    await waitForSideSheet(page);
    await selectEntity(page, "Credit Batch", batch.id, batch.code);

    const dialog = page.getByRole("dialog");
    const reactiveCarbon = dialog.locator('input[name="reactiveCarbonPercent"]');
    const residualCarbon = dialog.locator('input[name="residualCarbonPercent"]');
    await expect(reactiveCarbon).toBeVisible({ timeout: 15000 });

    await reactiveCarbon.fill("40");
    await residualCarbon.fill("60.5");
    await expect(dialog.getByText(REACTIVE_RESIDUAL_OVER_100, { exact: true })).toHaveCount(0);
    await residualCarbon.fill("70");
    await expect(dialog.getByText(REACTIVE_RESIDUAL_OVER_100, { exact: true })).toBeVisible();

    await dialog.getByRole("button", { name: "Save" }).click();
    const summary = dialog.locator("[data-form-error-summary]");
    await expect(summary.getByRole("link", { name: /Sampling time/ })).toBeVisible();
    await expect(summary).toContainText("Enter the sampling time.");
    await expect(summary).toContainText(REACTIVE_RESIDUAL_OVER_100);
    await expect(summary).not.toContainText("Invalid input");

    await residualCarbon.fill("60");
    await expect(dialog.getByText(REACTIVE_RESIDUAL_OVER_100, { exact: true })).toHaveCount(0);
  });
});
