import { test, expect, waitForSideSheet } from "./fixtures";

test.describe("Sample carbon feedback", () => {
  test("shows and clears concise reconciliation errors while entering carbon values", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto(`/samples?facility=${seededData.facility.id}`);
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
});
